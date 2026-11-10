import { describe, expect, it } from 'vitest';
import { POLITICAS } from '../sim/model';
import { TEXTO_POLITICA } from './politicasTexto';

describe('texto das políticas', () => {
  it('toda política do modelo tem nome curto, rótulo e regra', () => {
    for (const p of POLITICAS) {
      const t = TEXTO_POLITICA[p];
      expect(t, p).toBeDefined();
      expect(t.curto.length, p).toBeGreaterThan(0);
      expect(t.rotulo.length, p).toBeGreaterThan(0);
      expect(t.regra.length, p).toBeGreaterThan(40);
    }
    expect(Object.keys(TEXTO_POLITICA).sort()).toEqual([...POLITICAS].sort());
  });

  it('nomes curtos e rótulos não se repetem (a linha do tempo do resultado depende disso)', () => {
    expect(new Set(POLITICAS.map(p => TEXTO_POLITICA[p].curto)).size).toBe(POLITICAS.length);
    expect(new Set(POLITICAS.map(p => TEXTO_POLITICA[p].rotulo)).size).toBe(POLITICAS.length);
  });
});
