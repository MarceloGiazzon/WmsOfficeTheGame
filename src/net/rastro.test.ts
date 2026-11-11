import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { PacoteCenario } from '../sim/model';
import type { EventoRastro } from '../sim/rastro';
import { Simulacao } from '../sim/simulation';
import { remapearIds } from './idsUuid';
import { NpdevClient } from './npdevClient';
import { iniciarPartida } from './partidas';
import { corpoDoEvento, enviarRastro } from './rastro';
import { ServidorFalso, type Chamada } from './servidorFalso';

const banco = remapearIds(whA as unknown as PacoteCenario, 31).pacote;

/** O rastro de um turno de verdade do WH-A (com os ids do "banco": UUIDs, como online). */
function rastroDoTurno(): readonly Readonly<EventoRastro>[] {
  const sim = new Simulacao(banco, 'AbcProximidade');
  while (!sim.terminado) sim.tick();
  return sim.rastro();
}
const RASTRO = rastroDoTurno();

async function montar() {
  const servidor = new ServidorFalso({ pacotes: [banco], usuarios: { ana: { senha: 's' }, bia: { senha: 's' } } });
  const http = new NpdevClient({ fetch: servidor.fetch });
  await http.login('ana', 's');
  const partida = await iniciarPartida(http, { cenarioId: banco.cenario.id, politica: 'AbcProximidade' });
  return { servidor, http, partida };
}

const ehPostEvento = (c: Chamada) => c.metodo === 'POST' && c.caminho === '/sim_eventos';

describe('enviarRastro', () => {
  it('o rastro do turno não é vazio e tem os 5 tipos de campo', () => {
    expect(RASTRO.length).toBeGreaterThan(100);
  });

  it('envia todos os eventos da partida, com tseg (e não tSeg) e sem os campos nulos', async () => {
    const { servidor, http, partida } = await montar();
    const r = await enviarRastro(http, partida.id, 'ana', RASTRO);
    expect(r).toEqual({ enviados: RASTRO.length, jaExistiam: 0 });
    expect(servidor.eventos).toHaveLength(RASTRO.length);
    const posts = servidor.chamadas.filter(ehPostEvento);
    expect(posts).toHaveLength(RASTRO.length);
    const corpo = posts.find(c => (c.corpo as { seq: number }).seq === 0)!.corpo as Record<string, unknown>;
    expect(corpo).toMatchObject({ partidaId: partida.id, jogador: 'ana', seq: 0, tipo: 'EstoqueInicial', tseg: RASTRO[0].tSeg });
    expect(corpo).not.toHaveProperty('tSeg');
    expect(corpo).not.toHaveProperty('ordemId'); // nulo = omitido
    // o servidor devolve tSeg no /page; os seq 0..n-1 chegaram todos
    expect(servidor.eventos.map(e => e.seq).sort((a, b) => Number(a) - Number(b))).toEqual(RASTRO.map(e => e.seq));
    expect(servidor.eventos[0]).toHaveProperty('tSeg');
  });

  it('reenviar só manda o que falta (idempotente por seq)', async () => {
    const { servidor, http, partida } = await montar();
    await enviarRastro(http, partida.id, 'ana', RASTRO.slice(0, 40));
    const antes = servidor.chamadas.filter(ehPostEvento).length;
    const r = await enviarRastro(http, partida.id, 'ana', RASTRO);
    expect(r).toEqual({ enviados: RASTRO.length - 40, jaExistiam: 40 });
    expect(servidor.chamadas.filter(ehPostEvento).length).toBe(antes + RASTRO.length - 40);
    const de_novo = await enviarRastro(http, partida.id, 'ana', RASTRO);
    expect(de_novo).toEqual({ enviados: 0, jaExistiam: RASTRO.length });
    expect(servidor.eventos).toHaveLength(RASTRO.length);
  });

  it('erro de rede num POST rejeita; um novo enviarRastro completa sem duplicar', async () => {
    const { servidor, http, partida } = await montar();
    servidor.falharProximas(1, { status: 503, corpo: { error: 'indisponivel' } }, c => ehPostEvento(c) && (c.corpo as { seq: number }).seq === 50);
    await expect(enviarRastro(http, partida.id, 'ana', RASTRO)).rejects.toThrow();
    expect(servidor.eventos.length).toBeLessThan(RASTRO.length);
    const r = await enviarRastro(http, partida.id, 'ana', RASTRO);
    expect(r.enviados + r.jaExistiam).toBe(RASTRO.length);
    expect(servidor.eventos).toHaveLength(RASTRO.length);
    expect(new Set(servidor.eventos.map(e => e.seq)).size).toBe(RASTRO.length);
  });

  it('resposta perdida depois de o servidor gravar: o reenvio reconhece o evento e não duplica', async () => {
    const { servidor, http, partida } = await montar();
    servidor.perderRespostaDasProximas(1, c => ehPostEvento(c) && (c.corpo as { seq: number }).seq === 10);
    await expect(enviarRastro(http, partida.id, 'ana', RASTRO.slice(0, 20))).rejects.toThrow();
    await enviarRastro(http, partida.id, 'ana', RASTRO.slice(0, 20));
    expect(servidor.eventos.filter(e => e.seq === 10)).toHaveLength(1);
    expect(servidor.eventos).toHaveLength(20);
  });

  it('o outro jogador não enxerga nem pode gravar na partida alheia', async () => {
    const { servidor, http, partida } = await montar();
    await enviarRastro(http, partida.id, 'ana', RASTRO.slice(0, 5));
    const bia = new NpdevClient({ fetch: servidor.fetch });
    await bia.login('bia', 's');
    await expect(enviarRastro(bia, partida.id, 'bia', RASTRO.slice(0, 5))).rejects.toThrow(); // a partida não é dela
    expect(servidor.eventos).toHaveLength(5);
  });

  it('corpoDoEvento: CrossDock leva as duas ordens e as duas docas', () => {
    const e: EventoRastro = { seq: 7, tipo: 'CrossDock', tSeg: 30200, ordemId: 'i', ordemSaidaId: 'o', produtoId: 'p', localId: 'a', localDestinoId: 'b' };
    expect(corpoDoEvento('P', 'ana', e)).toEqual({
      partidaId: 'P', jogador: 'ana', seq: 7, tipo: 'CrossDock', tseg: 30200, ordemId: 'i', ordemSaidaId: 'o', produtoId: 'p', localId: 'a', localDestinoId: 'b',
    });
  });
});
