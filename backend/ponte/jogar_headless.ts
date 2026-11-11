// Roda um turno inteiro do motor SEM navegador e imprime métricas, score e o rastro (formato rastro-v1).
// É o que alimenta a ponte Jogo ↔ WmsOffice quando não há uma partida jogada de verdade (testes, demonstração, P2).
//
// Uso (da raiz do repo):
//   npx vite-node backend/ponte/jogar_headless.ts <pacote.json> <politica> [--partida <uuid>] [--saida <rastro.json>]
// Saída (stdout, UMA linha): {"metricas": {...}, "scoreCentesimos": 8552, "rastro": "<caminho>" | {...o rastro...}}
//   (com --saida o rastro vai para o arquivo e a linha traz o caminho; sem, vem inline).
// Mensagens de erro vão para o stderr, com saída 2 (uso) ou 1 (falha).
import { readFileSync, writeFileSync } from 'node:fs';
import { POLITICAS, type PacoteCenario, type Politica } from '../../src/sim/model';
import { Simulacao } from '../../src/sim/simulation';
import { VERSAO_MOTOR } from '../../src/net/partidas';

const PARTIDA_PADRAO = '00000000-0000-4000-8000-000000000000';

function uso(msg: string): never {
  process.stderr.write(`${msg}\nuso: jogar_headless.ts <pacote.json> <politica> [--partida <uuid>] [--saida <rastro.json>]\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const posicionais: string[] = [];
let partidaId = PARTIDA_PADRAO;
let saida: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--partida') partidaId = args[++i] ?? uso('--partida pede um valor');
  else if (args[i] === '--saida') saida = args[++i] ?? uso('--saida pede um valor');
  else posicionais.push(args[i]);
}
if (posicionais.length !== 2) uso('faltam argumentos');
const [arquivo, politicaTexto] = posicionais;
if (!(POLITICAS as readonly string[]).includes(politicaTexto)) uso(`política desconhecida: ${politicaTexto} (${POLITICAS.join(', ')})`);
const politica = politicaTexto as Politica;
if (politica === 'WmsReal') {
  uso('WmsReal precisa do servidor (a decisão de destino vem do SugerirDestinoJogo); aqui só as políticas locais.');
}

const pacote = JSON.parse(readFileSync(arquivo, 'utf8')) as PacoteCenario;
const sim = new Simulacao(pacote, politica);
while (!sim.terminado) sim.tick();

const score = sim.snapshot().score;
const scoreCentesimos = score.sucesso ? score.scoreCentesimos : null;
const rastro = {
  formato: 'rastro-v1',
  partidaId,
  cenarioId: pacote.cenario.id,
  cenarioCodigo: pacote.cenario.codigo,
  versaoMotor: VERSAO_MOTOR,
  politicaInicial: politica,
  scoreCentesimos,
  eventos: sim.rastro(),
};

if (saida) writeFileSync(saida, JSON.stringify(rastro, null, 1) + '\n');
process.stdout.write(JSON.stringify({ metricas: sim.metricas(), scoreCentesimos, rastro: saida ?? rastro }) + '\n');
