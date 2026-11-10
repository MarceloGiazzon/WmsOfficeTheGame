import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { Metricas, PacoteCenario } from '../sim/model';
import { calcularScore } from '../sim/score';
import { remapearIds } from './idsUuid';
import { NpdevClient } from './npdevClient';
import {
  abandonarPartida, buscarPartidaEmAndamento, buscarScoreDaPartida, concluirPartida, iniciarPartida, ranking, VERSAO_MOTOR,
} from './partidas';
import { ServidorFalso } from './servidorFalso';

const banco = remapearIds(whA as unknown as PacoteCenario, 3).pacote;
const CENARIO = banco.cenario.id;

// Mesmas métricas do exemplo "Estratégia A" do README / n3_jogador.py: score oficial 50,40.
const METRICAS: Metricas = {
  distanciaRealCm: 824000, distanciaTeoricaCm: 400000, ordensTotal: 100, ordensAtrasadas: 14, eventosConflito: 6, ocupacaoFinalCentesimos: 6200,
};
const scoreDe = (m: Metricas): number => { const r = calcularScore(m); if (!r.sucesso) throw new Error(r.motivo); return r.scoreCentesimos; };

async function montar(usuarios: string[] = ['ana']) {
  const servidor = new ServidorFalso({
    pacotes: [banco], usuarios: Object.fromEntries(usuarios.map(u => [u, { senha: 's' }])),
  });
  const clientes: Record<string, NpdevClient> = {};
  for (const u of usuarios) {
    clientes[u] = new NpdevClient({ fetch: servidor.fetch });
    await clientes[u].login(u, 's');
  }
  return { servidor, clientes, ana: clientes.ana };
}

describe('iniciarPartida', () => {
  it('cria a SimPartida do jogador logado (dono = username da sessão) em andamento', async () => {
    const { servidor, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'Consolidacao', iniciadaEm: new Date('2026-11-10T08:00:00.123Z') });
    expect(p).toMatchObject({ cenarioId: CENARIO, jogador: 'ana', politica: 'Consolidacao', situacao: 'EmAndamento', iniciadaEm: '2026-11-10T08:00:00.123Z' });
    const post = servidor.chamadas.find(c => c.caminho === '/sim_partidas')!;
    expect(post.corpo).toEqual({ cenarioId: CENARIO, jogador: 'ana', politica: 'Consolidacao', versaoMotor: VERSAO_MOTOR, iniciadaEm: '2026-11-10T08:00:00.123Z' });
    expect(servidor.partidas.get(p.id)?.situacao).toBe('EmAndamento');
  });

  it('convidado: offline, sem rede', async () => {
    const servidor = new ServidorFalso({ pacotes: [banco] });
    const erro = await iniciarPartida(new NpdevClient({ fetch: servidor.fetch }), { cenarioId: CENARIO, politica: 'WmsReal' }).catch(e => e);
    expect(erro).toMatchObject({ tipo: 'offline' });
    expect(servidor.chamadas).toHaveLength(0);
  });

  it('cenário que não existe → requisicao_invalida (422 do bond); política fora do enum é erro de tipo no cliente', async () => {
    const { ana } = await montar();
    await expect(iniciarPartida(ana, { cenarioId: 'nao-existe', politica: 'WmsReal' })).rejects.toMatchObject({ tipo: 'requisicao_invalida', codigo: 'bond_target_not_found' });
  });

  it('403 (regra por linha) e resposta com situação inesperada', async () => {
    const { servidor, ana } = await montar();
    servidor.falharProximas(1, { status: 403, corpo: { code: 'ROW_SCOPE_DENIED', message: 'negado' } });
    await expect(iniciarPartida(ana, { cenarioId: CENARIO, politica: 'WmsReal' })).rejects.toMatchObject({ tipo: 'proibido' });
    servidor.falharProximas(1, { status: 201, corpo: { id: 'x', cenarioId: CENARIO, jogador: 'ana', politica: 'WmsReal', situacao: 'Concluida', iniciadaEm: '2026-11-10T08:00:00Z' } });
    await expect(iniciarPartida(ana, { cenarioId: CENARIO, politica: 'WmsReal' })).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });
});

describe('concluirPartida', () => {
  it('score certo: o servidor valida e devolve o score gravado', async () => {
    const { servidor, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    const r = await concluirPartida(ana, p.id, METRICAS, 5040);
    expect(scoreDe(METRICAS)).toBe(5040);
    expect(r).toMatchObject({ partidaId: p.id, scoreServidorCentesimos: 5040, scoreClienteCentesimos: 5040, validadoServidor: true });
    expect(servidor.partidas.get(p.id)?.situacao).toBe('Concluida');
    expect(servidor.scores.get(r.scoreId)?.validadoServidor).toBe(true);
    // o corpo enviado é {partidaId, ...métricas, scoreCentesimos}
    const corpo = servidor.chamadas.find(c => c.caminho === '/flows/ConcluirPartida/execute')!.corpo;
    expect(corpo).toEqual({ partidaId: p.id, ...METRICAS, scoreCentesimos: 5040 });
  });

  it('score adulterado NÃO é aceito como válido: o servidor grava o recalculado, fora do ranking, e o cliente vê validadoServidor=false', async () => {
    const { clientes, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    const r = await concluirPartida(ana, p.id, METRICAS, 9999);
    expect(r).toMatchObject({ validadoServidor: false, scoreServidorCentesimos: 5040, scoreClienteCentesimos: 9999 });
    expect((await ranking(clientes.ana, CENARIO)).entradas).toEqual([]);
  });

  it('métricas inválidas → recusado/metricas_invalidas com o motivo do servidor; a partida segue em andamento', async () => {
    const { servidor, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    const erro = await concluirPartida(ana, p.id, { ...METRICAS, ordensAtrasadas: 101 }, 5040).catch(e => e);
    expect(erro).toMatchObject({ tipo: 'recusado', codigo: 'metricas_invalidas', recuperavel: false });
    expect(erro.message).toBe('ordensAtrasadas > ordensTotal');
    expect(servidor.partidas.get(p.id)?.situacao).toBe('EmAndamento');
  });

  it('partida já concluída (ou abandonada) → recusado/partida_encerrada, sem segundo score', async () => {
    const { servidor, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    await concluirPartida(ana, p.id, METRICAS, 5040);
    await expect(concluirPartida(ana, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'recusado', codigo: 'partida_encerrada' });
    expect(servidor.scores.size).toBe(1);

    const q = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    await abandonarPartida(ana, q.id);
    await expect(concluirPartida(ana, q.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'recusado', codigo: 'partida_encerrada' });
  });

  it('partida inexistente ou de outro jogador → nao_encontrado', async () => {
    const { clientes } = await montar(['ana', 'bia']);
    const p = await iniciarPartida(clientes.ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    await expect(concluirPartida(clientes.bia, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'nao_encontrado', codigo: 'CONCEPT_NOT_FOUND' });
    await expect(concluirPartida(clientes.ana, 'nao-existe', METRICAS, 5040)).rejects.toMatchObject({ tipo: 'nao_encontrado' });
  });

  it('falhas de infraestrutura são explícitas e recuperáveis: rede caída, timeout do plugin, 500, login vencido', async () => {
    const { servidor, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    servidor.rede = false;
    await expect(concluirPartida(ana, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'rede', recuperavel: true });
    servidor.rede = true;
    servidor.falharProximas(1, { status: 422, corpo: { status: 'FAILED', errorCode: 'system_exception', error: 'PLUGIN_EXECUTION_TIMEOUT: Sandboxed plugin execution timed out after 5000 ms' } });
    await expect(concluirPartida(ana, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'servidor', recuperavel: true });
    servidor.falharProximas(1, { status: 500 });
    await expect(concluirPartida(ana, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'servidor' });
    servidor.revogarTokens();
    await expect(concluirPartida(ana, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'nao_autenticado', recuperavel: true });
    expect(servidor.partidas.get(p.id)?.situacao).toBe('EmAndamento'); // nada foi gravado em nenhuma dessas
  });

  it('respostas malformadas → resposta_invalida (nunca um sucesso inventado)', async () => {
    const { ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    const env = (output: unknown, status = 'OK') => ({ status: 200, corpo: { status, output } });
    const casos = [
      env(null), env({ conceptName: 'SimPartida', data: {} }), env({ conceptName: 'SimScore', data: { partidaId: 'outra', id: 'x', scoreCentesimos: 1, validadoServidor: true } }),
      env({ conceptName: 'SimScore', data: { partidaId: p.id, id: 'x', scoreCentesimos: '5040', validadoServidor: true } }),
      env({ conceptName: 'SimScore', data: { partidaId: p.id, id: 'x', scoreCentesimos: 5040 } }), env({}, 'RUNNING'),
      { status: 200, corpo: [] },
    ];
    for (const resposta of casos) {
      const { servidor, ana: outra } = await montar();
      servidor.falharProximas(1, resposta, c => c.caminho.startsWith('/flows/'));
      await expect(concluirPartida(outra, p.id, METRICAS, 5040)).rejects.toMatchObject({ tipo: 'resposta_invalida' });
    }
  });
});

describe('abandonarPartida', () => {
  it('EmAndamento → Abandonada', async () => {
    const { servidor, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'WmsReal' });
    await abandonarPartida(ana, p.id);
    expect(servidor.partidas.get(p.id)?.situacao).toBe('Abandonada');
  });

  it('partida já concluída: recusado/partida_encerrada (o lifecycle não permite)', async () => {
    const { ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'WmsReal' });
    await concluirPartida(ana, p.id, METRICAS, 5040);
    await expect(abandonarPartida(ana, p.id)).rejects.toMatchObject({ tipo: 'recusado', codigo: 'partida_encerrada' });
  });

  it('inexistente → nao_encontrado; rede caída → rede; convidado → offline', async () => {
    const { servidor, ana } = await montar();
    await expect(abandonarPartida(ana, 'nao-existe')).rejects.toMatchObject({ tipo: 'nao_encontrado' });
    servidor.rede = false;
    await expect(abandonarPartida(ana, 'x')).rejects.toMatchObject({ tipo: 'rede' });
    await expect(abandonarPartida(new NpdevClient({ fetch: servidor.fetch }), 'x')).rejects.toMatchObject({ tipo: 'offline' });
  });
});

describe('consultas de idempotência', () => {
  it('buscarScoreDaPartida: acha o score gravado ou devolve null', async () => {
    const { ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'WmsReal' });
    expect(await buscarScoreDaPartida(ana, p.id)).toBeNull();
    const r = await concluirPartida(ana, p.id, METRICAS, 5040);
    expect(await buscarScoreDaPartida(ana, p.id)).toEqual({ id: r.scoreId, partidaId: p.id, scoreCentesimos: 5040, validadoServidor: true });
  });

  it('buscarPartidaEmAndamento: compara o INSTANTE de início (o servidor devolve em outro fuso) e só olha as em andamento', async () => {
    const { servidor, ana } = await montar();
    const p = await iniciarPartida(ana, { cenarioId: CENARIO, politica: 'WmsReal', iniciadaEm: '2026-11-10T08:00:00.000Z' });
    servidor.partidas.get(p.id)!.iniciadaEm = '2026-11-10T05:00:00-03:00'; // mesmo instante, outro formato
    expect((await buscarPartidaEmAndamento(ana, CENARIO, 'WmsReal', '2026-11-10T08:00:00Z'))?.id).toBe(p.id);
    expect(await buscarPartidaEmAndamento(ana, CENARIO, 'WmsReal', '2026-11-10T08:00:01Z')).toBeNull();
    expect(await buscarPartidaEmAndamento(ana, CENARIO, 'Consolidacao', '2026-11-10T08:00:00Z')).toBeNull();
    await concluirPartida(ana, p.id, METRICAS, 5040);
    expect(await buscarPartidaEmAndamento(ana, CENARIO, 'WmsReal', '2026-11-10T08:00:00Z')).toBeNull();
  });
});

describe('ranking', () => {
  const m = (atrasadas: number): Metricas => ({ ...METRICAS, ordensAtrasadas: atrasadas });

  async function jogar(c: NpdevClient, metricas: Metricas, scoreCliente = scoreDe(metricas)) {
    const p = await iniciarPartida(c, { cenarioId: CENARIO, politica: 'AbcProximidade' });
    return { partida: p, resultado: await concluirPartida(c, p.id, metricas, scoreCliente) };
  }

  it('lista só scores validados, do melhor para o pior, com a posição do jogador e da partida', async () => {
    const { clientes } = await montar(['ana', 'bia', 'caio']);
    await jogar(clientes.ana, m(20));
    const bia = await jogar(clientes.bia, m(2));
    await jogar(clientes.caio, m(10));
    await jogar(clientes.caio, m(60), 10000); // adulterado: fora do ranking
    const r = await ranking(clientes.caio, CENARIO, { partidaId: bia.partida.id });
    expect(r.entradas.map(e => [e.posicao, e.jogador, e.scoreCentesimos])).toEqual([
      [1, 'bia', scoreDe(m(2))], [2, 'caio', scoreDe(m(10))], [3, 'ana', scoreDe(m(20))],
    ]);
    expect(r).toMatchObject({ total: 3, posicaoDaPartida: 1, melhorPosicaoDoJogador: 2, truncado: false });
    expect(r.entradas.filter(e => e.souEu).map(e => e.jogador)).toEqual(['caio']);
    expect(r.entradas[0]).toMatchObject({ distanciaRealCm: METRICAS.distanciaRealCm, ordensTotal: 100, ordensAtrasadas: 2 });
  });

  it('jogador sem partida validada: posição null; partida pedida fora do ranking: null', async () => {
    const { clientes } = await montar(['ana', 'bia']);
    const adulterada = await jogar(clientes.bia, m(5), 1);
    await jogar(clientes.ana, m(5));
    const r = await ranking(clientes.bia, CENARIO, { partidaId: adulterada.partida.id });
    expect(r.melhorPosicaoDoJogador).toBeNull();
    expect(r.posicaoDaPartida).toBeNull();
    expect(r.entradas).toHaveLength(1);
  });

  it('com limite menor que o ranking: truncado, e quem está além do limite não ganha posição inventada', async () => {
    const { clientes } = await montar(['ana', 'bia', 'caio']);
    await jogar(clientes.ana, m(1));
    await jogar(clientes.bia, m(2));
    const caio = await jogar(clientes.caio, m(3));
    const r = await ranking(clientes.caio, CENARIO, { limite: 2, partidaId: caio.partida.id });
    expect(r.entradas).toHaveLength(2);
    expect(r).toMatchObject({ total: 3, truncado: true, posicaoDaPartida: null, melhorPosicaoDoJogador: null });
  });

  it('cenário sem partidas: ranking vazio (não é erro)', async () => {
    const { ana } = await montar();
    expect(await ranking(ana, CENARIO)).toMatchObject({ entradas: [], total: 0, truncado: false });
  });

  it('erros: convidado → offline; 403; linha não validada no ranking ou campo faltando → resposta_invalida', async () => {
    const { servidor, ana } = await montar();
    await expect(ranking(new NpdevClient({ fetch: servidor.fetch }), CENARIO)).rejects.toMatchObject({ tipo: 'offline' });
    servidor.falharProximas(1, { status: 403, corpo: { error: 'forbidden' } }, c => c.caminho === '/queries/RankingPorCenario');
    await expect(ranking(ana, CENARIO)).rejects.toMatchObject({ tipo: 'proibido' });
    const linha = { id: 'x', partidaId: 'p', jogador: 'z', scoreCentesimos: 1, distanciaRealCm: 1, distanciaTeoricaCm: 1, ordensTotal: 1, ordensAtrasadas: 0, eventosConflito: 0, ocupacaoFinalCentesimos: 0 };
    servidor.falharProximas(1, { status: 200, corpo: { rows: [{ ...linha, validadoServidor: false }], total: 1 } }, c => c.caminho === '/queries/RankingPorCenario');
    await expect(ranking(ana, CENARIO)).rejects.toMatchObject({ tipo: 'resposta_invalida' });
    servidor.falharProximas(1, { status: 200, corpo: { rows: [{ ...linha, validadoServidor: true, scoreCentesimos: undefined }], total: 1 } }, c => c.caminho === '/queries/RankingPorCenario');
    await expect(ranking(ana, CENARIO)).rejects.toMatchObject({ tipo: 'resposta_invalida' });
    servidor.falharProximas(1, { status: 200, corpo: { linhas: [] } }, c => c.caminho === '/queries/RankingPorCenario');
    await expect(ranking(ana, CENARIO)).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });
});
