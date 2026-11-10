import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

// Valores da referência JS de mulberry32 — a mesma que backend/npdev/tests/n2_simulacao_capability.py compara,
// bit a bit, com SimulacaoCapability.Mulberry32 (Java). Logo: TS == JS == Java.
const GABARITO: Record<number, number[]> = {
  42: [0.6011037519201636, 0.44829055899754167, 0.8524657934904099],
  20261110: [0.47585524804890156, 0.4372278384398669, 0.7736968537792563],
  [-1]: [0.8964226141106337, 0.189478256739676, 0.7156526781618595],
};

describe('Rng (mulberry32)', () => {
  for (const [seed, esperado] of Object.entries(GABARITO)) {
    it(`seed ${seed} reproduz o gabarito`, () => {
      const r = new Rng(Number(seed));
      expect([r.next(), r.next(), r.next()]).toEqual(esperado);
    });
  }

  it('seed fora de 32 bits usa os 32 bits baixos, como o (int) do Java', () => {
    // -(2^53 - 1) tem os 32 bits baixos = 1
    const a = new Rng(-9007199254740991);
    const b = new Rng(1);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });

  it('nextInt fica em [0, n)', () => {
    const r = new Rng(7);
    const vistos = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      vistos.add(v);
    }
    expect(vistos.size).toBe(5);
  });
});
