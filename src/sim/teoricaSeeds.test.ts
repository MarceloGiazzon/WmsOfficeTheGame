// Os seeds do backend (SimCenario.qtdOrdens / distanciaTeoricaCm) são a referência com que o ConcluirPartida confere as
// métricas do cliente. Este teste amarra os dois lados: se o motor, o layout ou as ordens mudarem e os seeds não forem
// regenerados, o servidor passaria a recusar partidas legítimas — melhor descobrir aqui.
import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import seedA from '../../backend/npdev/definition/seeds/cenario-wh-a-pequeno.json';
import seedB from '../../backend/npdev/definition/seeds/cenario-wh-b-mega.json';
import type { PacoteCenario } from './model';
import { Simulacao } from './simulation';

const CASOS = [
  { nome: 'WH-A-PEQUENO', seed: seedA, pacote: whA as unknown as PacoteCenario },
  { nome: 'WH-B-MEGA', seed: seedB, pacote: whB as unknown as PacoteCenario },
];

describe.each(CASOS)('seed do cenário $nome × motor do front', ({ seed, pacote }) => {
  const registros = seed.records as { concept: string; data: Record<string, unknown> }[];
  const cenario = registros.find(r => r.concept === 'SimCenario')!.data;

  it('qtdOrdens do seed é o número de SimOrdem do próprio seed e do pacote', () => {
    expect(cenario.qtdOrdens).toBe(registros.filter(r => r.concept === 'SimOrdem').length);
    expect(cenario.qtdOrdens).toBe(pacote.ordens.length);
  });

  it('distanciaTeoricaCm do seed é a que o motor calcula (rode tools/gerar_seeds_cenarios.py se falhar)', () => {
    expect(cenario.distanciaTeoricaCm).toBe(new Simulacao(pacote, 'AbcProximidade').distanciaTeoricaCm);
  });

  it('as métricas de uma partida completa passam nas conferências do servidor (ordens, teórica, piso de metade)', () => {
    const sim = new Simulacao(pacote, 'AbcProximidade');
    const duracao = pacote.cenario.fimTurnoSeg - pacote.cenario.inicioTurnoSeg;
    for (let i = 0; i < duracao + 5; i++) sim.tick();
    const m = sim.snapshot().metricas;
    expect(m.ordensTotal).toBe(cenario.qtdOrdens);
    expect(m.distanciaTeoricaCm).toBe(cenario.distanciaTeoricaCm);
    expect(m.distanciaRealCm * 2).toBeGreaterThanOrEqual(cenario.distanciaTeoricaCm as number);
  });
});
