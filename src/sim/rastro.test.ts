import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { PacoteCenario, Politica } from './model';
import type { EventoRastro } from './rastro';
import { Simulacao } from './simulation';

const pacoteA = whA as unknown as PacoteCenario;
const CAMPOS = ['seq', 'tipo', 'tSeg', 'ordemId', 'ordemSaidaId', 'produtoId', 'localId', 'localDestinoId'];

function turnoCompleto(politica: Politica): Simulacao {
  const sim = new Simulacao(pacoteA, politica);
  while (!sim.terminado) sim.tick();
  return sim;
}

const contar = (r: readonly EventoRastro[], f: (e: EventoRastro) => boolean) => r.filter(f).length;

describe.each(['AbcProximidade', 'CrossDocking'] as const)('rastro do WH-A com %s', politica => {
  const sim = turnoCompleto(politica);
  const rastro = sim.rastro();
  const snap = sim.snapshot();

  it('tem seq 0..n-1, os 8 campos e os EstoqueInicial antes de tudo', () => {
    expect(rastro.length).toBeGreaterThan(0);
    rastro.forEach((e, i) => {
      expect(e.seq).toBe(i);
      expect(Object.keys(e)).toEqual(CAMPOS);
    });
    const primeiroOutro = rastro.findIndex(e => e.tipo !== 'EstoqueInicial');
    expect(rastro.slice(primeiroOutro).some(e => e.tipo === 'EstoqueInicial')).toBe(false);
  });

  it('tem um EstoqueInicial por local ocupado no início', () => {
    const inicial = new Simulacao(pacoteA, politica).snapshot();
    const ocupadosNoInicio = [...inicial.locais.values()].filter(l => l.situacao === 'Ocupado').length;
    expect(contar(rastro, e => e.tipo === 'EstoqueInicial')).toBe(ocupadosNoInicio);
  });

  it('conclui cada ordem uma só vez e o total bate com o snapshot', () => {
    const concluidas = rastro.filter(e => e.tipo === 'OrdemConcluida').map(e => e.ordemId);
    expect(new Set(concluidas).size).toBe(concluidas.length);
    expect(concluidas.length).toBe(snap.ordensConcluidas);
  });

  it('paletes de cada ordem concluída = quantidadePaletes (entradas: Putaway+CrossDock; saídas: Picking+CrossDock)', () => {
    for (const id of rastro.filter(e => e.tipo === 'OrdemConcluida').map(e => e.ordemId)) {
      const o = pacoteA.ordens.find(x => x.id === id)!;
      const n = o.tipo === 'Inbound'
        ? contar(rastro, e => (e.tipo === 'Putaway' || e.tipo === 'CrossDock') && e.ordemId === id)
        : contar(rastro, e => (e.tipo === 'Picking' && e.ordemId === id) || (e.tipo === 'CrossDock' && e.ordemSaidaId === id));
      expect(n, o.numero).toBe(o.quantidadePaletes);
    }
  });

  it('o replay (local → produto) termina com os locais Ocupado do fim do turno', () => {
    const replay = new Map<string, string>();
    for (const e of rastro) {
      if (e.tipo === 'EstoqueInicial' || e.tipo === 'Putaway') replay.set(e.localId!, e.produtoId!);
      else if (e.tipo === 'Picking') expect(replay.delete(e.localId!)).toBe(true);
    }
    const ocupados = [...snap.locais].filter(([, l]) => l.situacao === 'Ocupado').map(([id]) => id).sort();
    expect([...replay.keys()].sort()).toEqual(ocupados);
  });

  it('é determinístico', () => {
    expect(turnoCompleto(politica).rastro()).toEqual(rastro);
  });
});

describe('rastro: cross-docking', () => {
  // O WH-A com a política CrossDocking não cruza nenhum palete (as métricas são iguais às da AbcProximidade), então o
  // cenário vem de simulation.test.ts: uma saída de 31 paletes só fecha com os 2 recém-descarregados.
  const produto = 'WHAprod01';
  const t0 = pacoteA.cenario.inicioTurnoSeg;
  const p = structuredClone(pacoteA);
  p.ordens = [
    { id: 'i', numero: 'IN-X', tipo: 'Inbound', liberacaoSeg: t0 + 1, slaSeg: 7200, produtoId: produto, quantidadePaletes: 2 },
    { id: 'o', numero: 'OUT-X', tipo: 'Outbound', liberacaoSeg: t0 + 10, slaSeg: 7200, produtoId: produto, quantidadePaletes: 31 },
  ];

  it('registra um CrossDock por palete cruzado, com as duas docas e as duas ordens', () => {
    const sim = new Simulacao(p, 'CrossDocking');
    while (!sim.terminado) sim.tick();
    const rastro = sim.rastro();
    const cruzados = rastro.filter(e => e.tipo === 'CrossDock');
    expect(cruzados).toHaveLength(sim.auditoria().paletesCruzados);
    expect(cruzados).toHaveLength(2);
    for (const e of cruzados) {
      expect([e.ordemId, e.ordemSaidaId, e.produtoId]).toEqual(['i', 'o', produto]);
      expect(e.localId).not.toBe(e.localDestinoId);
      expect(e.localId && e.localDestinoId).toBeTruthy();
    }
    expect(rastro.filter(e => e.tipo === 'Putaway')).toHaveLength(0);
    expect(rastro.filter(e => e.tipo === 'Picking')).toHaveLength(29);
    // as duas ordens se concluem DEPOIS do último palete
    const ultimoCross = Math.max(...cruzados.map(e => e.seq));
    expect(rastro.filter(e => e.tipo === 'OrdemConcluida').every(e => e.seq > ultimoCross)).toBe(true);
  });
});
