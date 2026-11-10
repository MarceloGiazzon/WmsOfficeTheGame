import { describe, expect, it } from 'vitest';
import fixtures from '../../backend/npdev/tests/fixtures/score-cases.json';
import type { Metricas } from './model';
import { calcularScore } from './score';

// Mesmos casos que validam SimulacaoCapability.calcularScore (Java) — paridade TS × Java (D3).
describe('calcularScore — casos de referência compartilhados com o backend', () => {
  for (const c of fixtures.casos) {
    it(c.nome, () => {
      expect(calcularScore(c.metricas as Metricas)).toEqual({ sucesso: true, ...c.esperado });
    });
  }
  for (const c of fixtures.invalidos) {
    it(`inválido: ${c.nome}`, () => {
      const r = calcularScore(c.metricas as unknown as Metricas);
      expect(r.sucesso).toBe(false);
    });
  }

  it('distâncias acima de 2^53 / 3500 não perdem precisão', () => {
    const r = calcularScore({ distanciaRealCm: 2 ** 51, distanciaTeoricaCm: 2 ** 50, ordensTotal: 1,
      ordensAtrasadas: 0, eventosConflito: 0, ocupacaoFinalCentesimos: 0 });
    expect(r).toMatchObject({ sucesso: true, penalidades: { distancia: 3500 } });
  });
});
