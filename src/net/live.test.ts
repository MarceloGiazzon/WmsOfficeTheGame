// Teste AO VIVO contra o backend do jogo (NPDev, :8200). Só roda com NPDEV_LIVE=1; sem isso é `describe.skip` e o
// `npm test` continua offline:
//
//   NPDEV_LIVE=1 npx vitest run src/net/live.test.ts
//
// Variáveis: NPDEV_URL (padrão http://localhost:8200), NPDEV_USER/NPDEV_PASSWORD (jogador de teste, role Jogador),
// NPDEV_ADMIN_USER/NPDEV_ADMIN_PASSWORD (só para criar e apagar o cenário descartável).
//
// O que cria e como limpa: um SimCenario `F5-LIVE-<hora>` (no armazém do WH-A) e as partidas/scores dele; o admin
// apaga tudo no `afterAll`, mesmo se um teste falhar. Os cenários semeados (WH-A/WH-B) só são LIDOS.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import type { PacoteCenario, Politica } from '../sim/model';
import { Simulacao } from '../sim/simulation';
import { ArmazenamentoMemoria, CachePacotes, obterPacote } from './cache';
import { ehNpdevError, NpdevError } from './erros';
import { FilaEnvio } from './filaEnvio';
import { NpdevClient, type FetchLike } from './npdevClient';
import { buscarCenario, carregarPacote, listarCenarios } from './pacote';
import { diferencasDePacote } from './pacoteEquivalencia';
import { abandonarPartida, concluirPartida, iniciarPartida, ranking } from './partidas';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const VIVO = env.NPDEV_LIVE === '1';
const URL_BASE = env.NPDEV_URL ?? 'http://localhost:8200';
const USUARIO = env.NPDEV_USER ?? 'teste-jogador-1';
const SENHA = env.NPDEV_PASSWORD ?? 'Jogo!Teste2026';
const ADMIN = env.NPDEV_ADMIN_USER ?? 'admin';
const ADMIN_SENHA = env.NPDEV_ADMIN_PASSWORD ?? 'Teste123!';

const METRICAS = {
  distanciaRealCm: 824000, distanciaTeoricaCm: 400000, ordensTotal: 100, ordensAtrasadas: 14, eventosConflito: 6, ocupacaoFinalCentesimos: 6200,
}; // score oficial 50,40 (README, Estratégia A)

const embutidos: Record<string, PacoteCenario> = {
  'WH-A-PEQUENO': whA as unknown as PacoteCenario,
  'WH-B-MEGA': whB as unknown as PacoteCenario,
};

/** fetch real, com contagem de chamadas e a opção de simular queda de rede. */
function fetchContado() {
  const estado = { chamadas: 0, rede: true, perderResposta: null as null | ((url: string, init: Parameters<FetchLike>[1]) => boolean) };
  const fn: FetchLike = async (url, init) => {
    estado.chamadas++;
    if (!estado.rede) throw new TypeError('fetch failed (rede simulada)');
    const resp = await globalThis.fetch(url, init);
    const texto = await resp.text(); // a escrita já aconteceu no servidor
    if (estado.perderResposta?.(url, init)) { estado.perderResposta = null; throw new TypeError('fetch failed (resposta perdida)'); }
    return { ok: resp.ok, status: resp.status, text: async () => texto };
  };
  return { estado, fn };
}

/** O 1º flow depois de o app subir pode estourar o timeout de 5 s do plugin (PLUGIN_EXECUTION_TIMEOUT): tenta de novo. */
async function comRetentativa<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i < 3 && ehNpdevError(e) && e.tipo === 'servidor') continue;
      throw e;
    }
  }
}

async function apagar(token: string, caminho: string): Promise<void> {
  await globalThis.fetch(`${URL_BASE}/api${caminho}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

const suite = VIVO ? describe : describe.skip;

suite(`ao vivo (${URL_BASE})`, () => {
  const f = fetchContado();
  const novoCliente = () => new NpdevClient({ base: `${URL_BASE}/api`, fetch: f.fn, timeoutMs: 30_000 });
  const jogador = novoCliente();
  let adminToken = '';
  let cenarioTeste: { id: string; codigo: string } | null = null;

  beforeAll(async () => {
    await jogador.login(USUARIO, SENHA);
    const admin = new NpdevClient({ base: `${URL_BASE}/api`, fetch: globalThis.fetch as unknown as FetchLike });
    adminToken = (await admin.login(ADMIN, ADMIN_SENHA)).token;
    const wha = await buscarCenario(jogador, 'WH-A-PEQUENO');
    const codigo = `F5-LIVE-${Date.now()}`;
    const r = await globalThis.fetch(`${URL_BASE}/api/sim_cenarios`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, nome: 'F5 teste ao vivo', armazemId: wha.armazemId, seed: 5, ativo: true }),
    });
    if (r.status !== 201 && r.status !== 200) throw new Error(`não criou o cenário de teste: ${r.status} ${await r.text()}`);
    cenarioTeste = { id: ((await r.json()) as { id: string }).id, codigo };
  }, 60_000);

  afterAll(async () => {
    if (!adminToken) return;
    const get = async (caminho: string): Promise<{ id: string; cenarioId: string }[]> =>
      (await (await globalThis.fetch(`${URL_BASE}/api${caminho}`, { headers: { Authorization: `Bearer ${adminToken}` } })).json()) as { id: string; cenarioId: string }[];
    if (cenarioTeste) {
      for (const s of (await get('/sim_scores')).filter(x => x.cenarioId === cenarioTeste!.id)) await apagar(adminToken, `/sim_scores/${s.id}`);
      for (const p of (await get('/sim_partidas')).filter(x => x.cenarioId === cenarioTeste!.id)) await apagar(adminToken, `/sim_partidas/${p.id}`);
      await apagar(adminToken, `/sim_cenarios/${cenarioTeste.id}`);
      const sobrou = (await get('/sim_cenarios')).some(c => c.id === cenarioTeste!.id);
      if (sobrou) console.warn(`ATENÇÃO: cenário de teste ${cenarioTeste.codigo} não foi removido`);
    }
  }, 60_000);

  it('login e /auth/me como jogador; a role Jogador não escreve no catálogo (403 → proibido)', async () => {
    expect((await jogador.me()).username).toBe(USUARIO);
    expect(jogador.sessao()?.roles).toContain('Jogador');
    const { armazemId } = await buscarCenario(jogador, 'WH-A-PEQUENO'); // corpo válido: a negativa tem de vir da role, não da validação
    await expect(jogador.post('/sim_cenarios', { codigo: 'X', nome: 'x', armazemId, seed: 1 })).rejects.toMatchObject({ tipo: 'proibido', status: 403 });
    expect(jogador.logado).toBe(true); // 403 não derruba a sessão
  });

  it('senha errada → nao_autenticado; token lixo → nao_autenticado e a UI é avisada', async () => {
    await expect(novoCliente().login(USUARIO, 'errada')).rejects.toMatchObject({ tipo: 'nao_autenticado', status: 401, message: 'Usuário ou senha inválidos.' });
    let avisos = 0;
    const c = new NpdevClient({ base: `${URL_BASE}/api`, fetch: f.fn, aoSessaoExpirar: () => { avisos++; } });
    expect(c.restaurarSessao({ token: 'abc.def.ghi', username: USUARIO, roles: ['Jogador'], expiraEmMs: null })).toBe(true);
    await expect(c.me()).rejects.toMatchObject({ tipo: 'nao_autenticado' });
    expect(c.logado).toBe(false);
    expect(avisos).toBe(1);
  });

  it('listarCenarios traz os cenários semeados', async () => {
    const codigos = (await listarCenarios(jogador)).map(c => c.codigo);
    expect(codigos).toEqual(expect.arrayContaining(['WH-A-PEQUENO', 'WH-B-MEGA']));
  });

  describe.each(['WH-A-PEQUENO', 'WH-B-MEGA'])('pacote %s pelo REST × pacote embutido', codigo => {
    let pacote: PacoteCenario;
    const embutido = embutidos[codigo];

    it('carregarPacote monta o pacote completo (mesmas quantidades, mesma topologia, mesmas ordens, mesmos campos e tipos)', async () => {
      const antes = f.estado.chamadas;
      const t0 = Date.now();
      pacote = await carregarPacote(jogador, codigo);
      console.info(`[vivo] ${codigo}: ${f.estado.chamadas - antes} chamadas, ${Date.now() - t0} ms, ${pacote.locais.length} locais, ${pacote.ordens.length} ordens`);

      for (const secao of ['areas', 'ruas', 'locais', 'produtos', 'ordens', 'rankingRuas'] as const) {
        expect(pacote[secao], secao).toHaveLength(embutido[secao].length);
      }
      expect(diferencasDePacote(embutido, pacote)).toEqual([]);
    }, 120_000);

    it('ids são UUIDs do banco e as referências fecham; só os campos do modelo', () => {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect([pacote.cenario.id, pacote.armazem.id, pacote.areas[0].id, pacote.ruas[0].id, pacote.locais[0].id, pacote.produtos[0].id, pacote.ordens[0].id].every(id => uuid.test(id))).toBe(true);
      expect(Object.keys(pacote.locais[0]).sort()).toEqual(Object.keys(embutido.locais[0]).sort());
      expect(Object.keys(pacote.cenario).sort()).toEqual(Object.keys(embutido.cenario).sort());
    });

    it('o pacote do REST joga: a sim roda o turno inteiro com ele (resultado do pacote embutido registrado no log)', () => {
      const rodar = (p: PacoteCenario, politica: Politica) => {
        const sim = new Simulacao(p, politica);
        while (!sim.terminado) sim.tick();
        const s = sim.snapshot();
        return { score: s.score.sucesso ? s.score.scoreCentesimos : -1, concluidas: s.ordensConcluidas };
      };
      const politica: Politica = 'AbcProximidade';
      const rest = rodar(pacote, politica);
      const local = rodar(embutido, politica);
      console.info(`[vivo] ${codigo} ${politica}: REST ${rest.score} (${rest.concluidas} ordens) × embutido ${local.score} (${local.concluidas}) — difere pelo desempate por id (ver uuid.test.ts)`);
      expect(rest.score).toBeGreaterThan(0);
      expect(rest.concluidas).toBeGreaterThanOrEqual(Math.floor(embutido.ordens.length * 0.9));
    }, 120_000);
  });

  it('obterPacote: rede → cache; com a rede caída, usa o cache; convidado usa o embutido', async () => {
    const cache = new CachePacotes(new ArmazenamentoMemoria());
    const embutido = (c: string) => embutidos[c];
    const online = await obterPacote('WH-A-PEQUENO', { http: jogador, cache, embutido });
    expect(online.origem).toBe('rede');
    f.estado.rede = false;
    try {
      const offline = await obterPacote('WH-A-PEQUENO', { http: jogador, cache, embutido });
      expect(offline.origem).toBe('cache');
      expect(offline.falhaRede?.tipo).toBe('rede');
      expect(offline.pacote.cenario.id).toBe(online.pacote.cenario.id);
    } finally { f.estado.rede = true; }
    const convidado = await obterPacote('WH-A-PEQUENO', { http: novoCliente(), embutido });
    expect(convidado.origem).toBe('embutido');
  }, 60_000);

  describe('partidas (cenário descartável)', () => {
    it('iniciar → concluir (validado) → ranking com a posição; adulterado fica fora do ranking; conclusão repetida é recusada', async () => {
      const p = await iniciarPartida(jogador, { cenarioId: cenarioTeste!.id, politica: 'AbcProximidade' });
      expect(p).toMatchObject({ situacao: 'EmAndamento', jogador: USUARIO });
      const r = await comRetentativa(() => concluirPartida(jogador, p.id, METRICAS, 5040));
      expect(r).toMatchObject({ validadoServidor: true, scoreServidorCentesimos: 5040 });

      const rk = await ranking(jogador, cenarioTeste!.id, { partidaId: p.id });
      expect(rk).toMatchObject({ posicaoDaPartida: 1, melhorPosicaoDoJogador: 1, total: 1 });
      expect(rk.entradas[0]).toMatchObject({ jogador: USUARIO, scoreCentesimos: 5040, souEu: true });

      await expect(concluirPartida(jogador, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'recusado', codigo: 'partida_encerrada' });
      await expect(abandonarPartida(jogador, p.id)).rejects.toMatchObject({ tipo: 'recusado', codigo: 'partida_encerrada' });

      const q = await iniciarPartida(jogador, { cenarioId: cenarioTeste!.id, politica: 'WmsReal' });
      const falsa = await concluirPartida(jogador, q.id, METRICAS, 9999);
      expect(falsa).toMatchObject({ validadoServidor: false, scoreServidorCentesimos: 5040, scoreClienteCentesimos: 9999 });
      expect((await ranking(jogador, cenarioTeste!.id)).total).toBe(1); // o adulterado não entra

      const e = await iniciarPartida(jogador, { cenarioId: cenarioTeste!.id, politica: 'Consolidacao' });
      await expect(concluirPartida(jogador, e.id, { ...METRICAS, ordensAtrasadas: 101 }, 5040)).rejects.toMatchObject({ tipo: 'recusado', codigo: 'metricas_invalidas' });
      await abandonarPartida(jogador, e.id);
      await expect(concluirPartida(jogador, e.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'recusado', codigo: 'partida_encerrada' });
      await expect(concluirPartida(jogador, '00000000-0000-0000-0000-000000000000', METRICAS, 5040)).rejects.toMatchObject({ tipo: 'nao_encontrado' });
    }, 120_000);

    it('fila: partida jogada offline é enviada na volta da rede; resposta perdida DEPOIS de o servidor concluir não duplica', async () => {
      const fila = new FilaEnvio({ armazenamento: new ArmazenamentoMemoria(), http: jogador });
      const registro = (politica: Politica, minuto: number) => ({
        cenarioCodigo: cenarioTeste!.codigo, politica, metricas: METRICAS, scoreCentesimos: 5040,
        iniciadaEm: new Date(Date.UTC(2026, 10, 10, 8, minuto)).toISOString(), concluidaEm: new Date(Date.UTC(2026, 10, 10, 8, minuto + 20)).toISOString(),
      });
      const rankingAntes = (await ranking(jogador, cenarioTeste!.id)).total;

      f.estado.rede = false;
      const offline = await fila.registrar(registro('FifoPrimeiraLivre', 1));
      f.estado.rede = true;
      expect(offline).toMatchObject({ estado: 'pendente', erro: { tipo: 'rede' } });
      expect(await fila.resumo()).toMatchObject({ pendentes: 1 });
      const s = await comRetentativaFila(fila);
      expect(s).toMatchObject({ pendentes: 0, erro: null });
      expect(s.enviados[0]).toMatchObject({ validadoServidor: true });
      expect((await ranking(jogador, cenarioTeste!.id)).total).toBe(rankingAntes + 1);

      // a conclusão chega ao servidor, a resposta se perde: a fila tem de reconhecer o score gravado, não criar outro
      f.estado.perderResposta = url => url.endsWith('/flows/ConcluirPartida/execute');
      const perdida = await fila.registrar(registro('Consolidacao', 2));
      expect(perdida).toMatchObject({ estado: 'pendente', erro: { tipo: 'rede' } });
      const s2 = await comRetentativaFila(fila);
      expect(s2).toMatchObject({ pendentes: 0, erro: null, rejeitados: [] });
      expect(s2.enviados).toHaveLength(1);
      expect((await ranking(jogador, cenarioTeste!.id)).total).toBe(rankingAntes + 2);

      // score adulterado na fila: o servidor grava sem validar → item rejeitado, nunca reenviado
      const ruim = await fila.registrar({ ...registro('CrossDocking', 3), scoreCentesimos: 9999 });
      expect(ruim).toMatchObject({ estado: 'rejeitado', item: { rejeicao: { codigo: 'score_divergente' } } });
      const apos = f.estado.chamadas;
      expect(await fila.sincronizar()).toMatchObject({ enviados: [], pendentes: 0 });
      expect(f.estado.chamadas).toBe(apos);
      expect((await ranking(jogador, cenarioTeste!.id)).total).toBe(rankingAntes + 2);
    }, 180_000);
  });
});

/** `sincronizar` com a mesma folga para o timeout do plugin na 1ª chamada. */
async function comRetentativaFila(fila: FilaEnvio) {
  let r = await fila.sincronizar();
  for (let i = 0; i < 3 && r.erro instanceof NpdevError && r.erro.tipo === 'servidor'; i++) r = await fila.sincronizar();
  return r;
}
