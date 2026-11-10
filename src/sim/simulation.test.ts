import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { PacoteCenario } from './model';
import { formatarHora, Simulacao } from './simulation';

const pacote = whA as unknown as PacoteCenario;

function rodar(sim: Simulacao, ticks: number) {
  for (let i = 0; i < ticks; i++) sim.tick();
}

describe('Simulacao (F1)', () => {
  it('começa no início do turno, com todos os locais e equipamentos', () => {
    const s = new Simulacao(pacote, 'AbcProximidade').snapshot();
    expect(s.relogioSeg).toBe(pacote.cenario.inicioTurnoSeg);
    expect(s.locais.size).toBe(48);
    expect(s.equipamentos).toHaveLength(pacote.cenario.qtdEquipamentos);
    expect(s.ordensLiberadas).toBe(0);
    expect(s.terminado).toBe(false);
  });

  it('libera as ordens no horário de liberação', () => {
    const sim = new Simulacao(pacote, 'AbcProximidade');
    const ate = 32400; // 09:00
    rodar(sim, ate - pacote.cenario.inicioTurnoSeg);
    const esperado = pacote.ordens.filter(o => o.liberacaoSeg <= ate).length;
    expect(esperado).toBeGreaterThan(0);
    expect(sim.snapshot().ordensLiberadas).toBe(esperado);
    expect(sim.snapshot().eventos[0].seg).toBeLessThanOrEqual(ate);
  });

  it('para no fim do turno com todas as ordens liberadas', () => {
    const sim = new Simulacao(pacote, 'FifoPrimeiraLivre');
    rodar(sim, pacote.cenario.fimTurnoSeg - pacote.cenario.inicioTurnoSeg + 500);
    const s = sim.snapshot();
    expect(s.terminado).toBe(true);
    expect(s.relogioSeg).toBe(pacote.cenario.fimTurnoSeg);
    expect(s.ordensLiberadas).toBe(pacote.ordens.length);
    expect(s.eventos[0].texto).toBe('Fim do turno.');
  });

  it('determinística: duas simulações iguais produzem o mesmo log', () => {
    const a = new Simulacao(pacote, 'WmsReal');
    const b = new Simulacao(pacote, 'WmsReal');
    rodar(a, 5000);
    rodar(b, 5000);
    expect(a.snapshot().eventos).toEqual(b.snapshot().eventos);
  });

  it('troca de política é registrada', () => {
    const sim = new Simulacao(pacote, 'AbcProximidade');
    sim.setPolitica('Consolidacao');
    expect(sim.snapshot().politica).toBe('Consolidacao');
    expect(sim.snapshot().eventos[0].texto).toContain('Consolidacao');
  });

  it('formatarHora', () => {
    expect(formatarHora(28800)).toBe('08:00:00');
    expect(formatarHora(64799)).toBe('17:59:59');
  });
});
