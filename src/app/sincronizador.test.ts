import { describe, expect, it, vi } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import { ArmazenamentoMemoria } from '../net/cache';
import { FilaEnvio, type RegistroPartida } from '../net/filaEnvio';
import { remapearIds } from '../net/idsUuid';
import { NpdevClient } from '../net/npdevClient';
import { ServidorFalso } from '../net/servidorFalso';
import type { Metricas, PacoteCenario } from '../sim/model';
import { Abandonos } from './abandonos';
import { descreverRodada, Sincronizador, situacaoDoItem } from './sincronizador';

const banco = remapearIds(whA as unknown as PacoteCenario, 31).pacote;
const METRICAS: Metricas = {
  distanciaRealCm: 824000, distanciaTeoricaCm: 400000, ordensTotal: 100, ordensAtrasadas: 14, eventosConflito: 6, ocupacaoFinalCentesimos: 6200,
};
const reg = (extra: Partial<RegistroPartida> = {}): RegistroPartida => ({
  cenarioCodigo: 'WH-A-PEQUENO', politica: 'AbcProximidade', metricas: METRICAS, scoreCentesimos: 5040,
  iniciadaEm: '2026-11-10T08:00:00.000Z', concluidaEm: '2026-11-10T08:20:00.000Z', ...extra,
});

async function montar(logado = true) {
  const servidor = new ServidorFalso({ pacotes: [banco], usuarios: { ana: { senha: 's' } } });
  const cliente = new NpdevClient({ fetch: servidor.fetch });
  if (logado) await cliente.login('ana', 's');
  const armazenamento = new ArmazenamentoMemoria();
  const fila = new FilaEnvio({ armazenamento, http: cliente });
  const abandonos = new Abandonos(armazenamento, cliente);
  const aoRodada = vi.fn();
  const sinc = new Sincronizador(fila, cliente, { abandonos, aoRodada });
  return { servidor, cliente, fila, sinc, aoRodada, abandonos };
}

describe('Sincronizador', () => {
  it('acompanha a fila: o indicador sobe ao guardar e desce ao enviar', async () => {
    const { servidor, fila, sinc } = await montar();
    await sinc.iniciar();
    const vistos: number[] = [];
    sinc.observar(e => vistos.push(e.pendentes));
    servidor.rede = false;
    await fila.registrar(reg());
    await vi.waitFor(() => expect(sinc.estado.pendentes).toBe(1));
    servidor.rede = true;
    const r = await sinc.sincronizar();
    expect(r?.enviados).toHaveLength(1);
    expect(sinc.estado).toMatchObject({ pendentes: 0, rejeitados: 0, sincronizando: false, ultimaFalhou: false });
    expect(sinc.estado.ultimaMensagem).toBe('1 partida enviada ao servidor.');
    expect(vistos).toContain(1);
    expect(vistos[vistos.length - 1]).toBe(0);
  });

  it('sem rede: a rodada falha sem perder nada e diz por quê; o indicador continua em 1', async () => {
    const { servidor, fila, sinc } = await montar();
    servidor.rede = false;
    await fila.registrar(reg());
    await sinc.iniciar();
    const r = await sinc.sincronizar();
    expect(r?.erro).toMatchObject({ tipo: 'rede' });
    expect(sinc.estado).toMatchObject({ pendentes: 1, ultimaFalhou: true, sincronizando: false });
    expect(sinc.estado.ultimaMensagem).toMatch(/Envio interrompido.*sem conexão/i);
    expect(sinc.estado.ultimaMensagem).toMatch(/1 partida segue na fila/);
  });

  it('convidado: não chama a rede; com pendentes de uma sessão anterior, pede o login', async () => {
    const { servidor, fila, sinc, cliente } = await montar();
    servidor.rede = false;
    await fila.registrar(reg());
    cliente.limparSessao();
    servidor.rede = true;
    const antes = servidor.chamadas.length;
    await sinc.iniciar();
    expect(sinc.estado.pendentes).toBe(1); // sem sessão, conta as de todos
    expect(await sinc.sincronizar()).toBeNull();
    expect(servidor.chamadas).toHaveLength(antes);
    expect(sinc.estado.ultimaMensagem).toMatch(/Entre para enviar/);
  });

  it('rejeitada pelo servidor: vai para o contador de rejeitadas e avisa a UI', async () => {
    const { fila, sinc, aoRodada, servidor } = await montar();
    servidor.rede = false;
    await fila.registrar(reg({ metricas: { ...METRICAS, ordensAtrasadas: 500 }, scoreCentesimos: 1 }));
    servidor.rede = true;
    await sinc.iniciar();
    await sinc.sincronizar();
    await vi.waitFor(() => expect(sinc.estado.rejeitados).toBe(1));
    expect(sinc.estado.pendentes).toBe(0);
    expect(aoRodada).toHaveBeenCalledTimes(1);
    expect(aoRodada.mock.calls[0][1]).toMatch(/1 partida rejeitada/);
  });

  it('chamadas simultâneas dividem a mesma rodada (a fila não envia em dobro)', async () => {
    const { servidor, fila, sinc } = await montar();
    servidor.rede = false;
    await fila.registrar(reg());
    servidor.rede = true;
    const [a, b, c] = await Promise.all([sinc.sincronizar(), sinc.sincronizar(), sinc.sincronizar()]);
    expect(a?.enviados).toHaveLength(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(servidor.partidas.size).toBe(1);
  });

  it('refaz os abandonos pendentes junto com a rodada', async () => {
    const { sinc, abandonos } = await montar();
    await abandonos.adiar('id-que-nao-existe', 'ana');
    expect(await abandonos.pendentes()).toBe(1);
    await sinc.sincronizar();
    expect(await abandonos.pendentes()).toBe(0); // "não encontrada" não se repete
  });

  it('o estado emitido é uma cópia (a UI não consegue mexer no interno)', async () => {
    const { sinc } = await montar();
    const e = sinc.estado;
    e.pendentes = 99;
    expect(sinc.estado.pendentes).toBe(0);
  });
});

describe('textos', () => {
  const item = (extra: object) => ({
    id: 'x', jogador: 'ana', cenarioCodigo: 'WH-A-PEQUENO', politica: 'AbcProximidade', metricas: METRICAS, scoreCentesimos: 5040,
    iniciadaEm: 'a', concluidaEm: 'b', versaoMotor: '0', situacao: 'pendente', criadoEm: 'c', tentativas: 0, ...extra,
  }) as Parameters<typeof situacaoDoItem>[0];

  it('situacaoDoItem: rejeitada mostra o motivo; pendente mostra a última falha ou que não houve tentativa', () => {
    expect(situacaoDoItem(item({ situacao: 'rejeitado', rejeicao: { motivo: 'Cenário sumiu', codigo: 'cenario_inexistente', em: 'x' } }))).toEqual({ rotulo: 'Rejeitada', detalhe: 'Cenário sumiu' });
    expect(situacaoDoItem(item({ ultimoErro: { mensagem: 'Sem conexão com o servidor.', tipo: 'rede', em: 'x' } })).detalhe).toMatch(/Sem conexão/);
    expect(situacaoDoItem(item({})).detalhe).toMatch(/Ainda não houve tentativa/);
  });

  it('situacaoDoItem: score divergente mostra os dois números formatados', () => {
    const r = { partidaId: 'p', scoreId: 's', scoreServidorCentesimos: 8100, scoreClienteCentesimos: 8552, validadoServidor: false };
    const { detalhe } = situacaoDoItem(item({ situacao: 'rejeitado', rejeicao: { motivo: 'x', codigo: 'score_divergente', em: 'x' }, resultado: r }));
    expect(detalhe).toBe('O servidor recalculou o score em 81,00 (o jogo calculou 85,52): partida registrada fora do ranking.');
  });

  it('descreverRodada: nada, enviadas, rejeitadas, erro', () => {
    expect(descreverRodada({ enviados: [], rejeitados: [], pendentes: 0, erro: null })).toBe('Nada pendente para enviar.');
    const env = { partidaId: 'p', scoreId: 's', scoreServidorCentesimos: 1, scoreClienteCentesimos: 1, validadoServidor: true };
    expect(descreverRodada({ enviados: [env, env], rejeitados: [], pendentes: 0, erro: null })).toBe('2 partidas enviadas ao servidor.');
  });
});
