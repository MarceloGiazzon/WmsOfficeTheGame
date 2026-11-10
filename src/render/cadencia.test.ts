import { describe, expect, it } from 'vitest';
import { Cadencia } from './cadencia';

describe('Cadencia', () => {
  it('deixa passar no máximo uma vez por intervalo', () => {
    const c = new Cadencia(100);
    expect(c.pronto(0)).toBe(true);
    expect(c.pronto(16)).toBe(false);
    expect(c.pronto(99)).toBe(false);
    expect(c.pronto(100)).toBe(true);
    expect(c.pronto(150)).toBe(false);
  });

  it('com fonte/versão, só passa quando algo mudou', () => {
    const c = new Cadencia(100);
    const sim = {};
    expect(c.pronto(0, sim, 10)).toBe(true);
    expect(c.pronto(500, sim, 10)).toBe(false); // intervalo venceu, mas nada mudou (pausado)
    expect(c.pronto(600, sim, 11)).toBe(true);
    expect(c.pronto(1000, {}, 11)).toBe(true); // simulação nova com o mesmo relógio também conta
  });

  it('mudança dentro do intervalo fica pendente até o intervalo vencer', () => {
    const c = new Cadencia(100);
    const sim = {};
    expect(c.pronto(0, sim, 1)).toBe(true);
    expect(c.pronto(40, sim, 2)).toBe(false);
    expect(c.pronto(80, sim, 3)).toBe(false);
    expect(c.pronto(120, sim, 3)).toBe(true);
    expect(c.pronto(300, sim, 3)).toBe(false);
  });
});
