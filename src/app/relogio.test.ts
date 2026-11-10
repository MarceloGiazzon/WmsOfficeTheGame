import { describe, expect, it } from 'vitest';
import { Relogio, SEGUNDOS_SIM_POR_SEGUNDO_REAL } from './relogio';

describe('Relogio', () => {
  it('1x: 1 s real = 30 ticks, mesmo em frames de 16 ms', () => {
    const r = new Relogio();
    let ticks = 0;
    for (let i = 0; i < 125; i++) ticks += r.avancar(8); // 1000 ms em frames de 8 ms
    expect(ticks).toBe(SEGUNDOS_SIM_POR_SEGUNDO_REAL);
  });

  it('5x multiplica os ticks; pausa não avança', () => {
    const r = new Relogio();
    r.velocidade = 5;
    expect(r.avancar(1000)).toBe(150);
    r.velocidade = 0;
    expect(r.avancar(1000)).toBe(0);
  });

  it('limita os ticks depois de uma pausa longa da aba', () => {
    const r = new Relogio();
    r.velocidade = 5;
    expect(r.avancar(60 * 60 * 1000)).toBe(600);
    expect(r.avancar(0)).toBe(0);
  });
});
