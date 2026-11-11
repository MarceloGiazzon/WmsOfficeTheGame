// Joga um turno inteiro SEM navegador, como um jogador logado: carrega o cenário do servidor, cria a SimPartida, roda o
// motor, conclui (o servidor recalcula o score) e envia o rastro (SimEvento). É o equivalente de linha de comando do que
// src/app/partidaOnline.ts faz na tela — com as mesmas funções de src/net — e é o que a ponte usa para ter uma partida
// REAL no servidor (exportar --partida, P1/P2).
//
// Uso (da raiz do repo):
//   npx vite-node backend/ponte/jogar_online.ts <codigo-do-cenario> <politica> [--url http://localhost:8200] [--sem-rastro]
// Credenciais: PONTE_JOGADOR_USUARIO / PONTE_JOGADOR_SENHA (padrão: o jogador de teste do n3_jogador.py).
// Saída (stdout, UMA linha): {"partidaId", "cenarioId", "jogador", "scoreCentesimos", "validadoServidor", "eventos"}.
// A partida e o rastro FICAM no servidor (quem chamou apaga, com o admin, quando acabar).
import type { PacoteCenario, Politica } from '../../src/sim/model';
import { POLITICAS } from '../../src/sim/model';
import { Simulacao } from '../../src/sim/simulation';
import { NpdevClient, type FetchLike } from '../../src/net/npdevClient';
import { carregarPacote } from '../../src/net/pacote';
import { concluirPartida, iniciarPartida } from '../../src/net/partidas';
import { enviarRastro } from '../../src/net/rastro';

function uso(msg: string): never {
  process.stderr.write(`${msg}\nuso: jogar_online.ts <codigo-do-cenario> <politica> [--url URL] [--sem-rastro]\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const posicionais: string[] = [];
let url = process.env.PONTE_JOGO_URL ?? 'http://localhost:8200';
let comRastro = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url') url = args[++i] ?? uso('--url pede um valor');
  else if (args[i] === '--sem-rastro') comRastro = false;
  else posicionais.push(args[i]);
}
if (posicionais.length !== 2) uso('faltam argumentos');
const [codigo, politicaTexto] = posicionais;
if (!(POLITICAS as readonly string[]).includes(politicaTexto)) uso(`política desconhecida: ${politicaTexto}`);
const politica = politicaTexto as Politica;
if (politica === 'WmsReal') uso('WmsReal precisa do servidor decidindo cada destino; aqui só as políticas locais.');

const fetchNode: FetchLike = async (u, init) => {
  const r = await fetch(u, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });
  return { ok: r.ok, status: r.status, text: () => r.text() };
};
const http = new NpdevClient({ base: `${url.replace(/\/+$/, '')}/api`, fetch: fetchNode, timeoutMs: 60_000 });
const usuario = process.env.PONTE_JOGADOR_USUARIO ?? 'teste-jogador-2';
await http.login(usuario, process.env.PONTE_JOGADOR_SENHA ?? 'Jogo!Teste2026');

const pacote: PacoteCenario = await carregarPacote(http, codigo);
const partida = await iniciarPartida(http, { cenarioId: pacote.cenario.id, politica, iniciadaEm: new Date().toISOString() });

const sim = new Simulacao(pacote, politica);
while (!sim.terminado) sim.tick();
const score = sim.snapshot().score;
if (!score.sucesso) throw new Error(`score não calculado: ${score.motivo}`);

const conclusao = await concluirPartida(http, partida.id, sim.metricas(), score.scoreCentesimos);
if (comRastro) await enviarRastro(http, partida.id, usuario, sim.rastro());
process.stdout.write(JSON.stringify({
  partidaId: partida.id, cenarioId: pacote.cenario.id, jogador: usuario, scoreCentesimos: conclusao.scoreServidorCentesimos,
  validadoServidor: conclusao.validadoServidor, eventos: comRastro ? sim.rastro().length : 0,
}) + '\n');
