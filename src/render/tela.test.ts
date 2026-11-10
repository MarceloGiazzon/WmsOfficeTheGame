import { describe, expect, it } from 'vitest';
import { aplicarTela, DPR_MAX, dprEfetivo, dprParaOrcamento, medirTela, mesmaTela, PIXELS_MAX, tamanhoBitmap } from './tela';

describe('dprEfetivo', () => {
  it('fica entre 1 e o máximo; lixo vira 1', () => {
    expect(dprEfetivo(1)).toBe(1);
    expect(dprEfetivo(2)).toBe(2);
    expect(dprEfetivo(2.625)).toBe(2.625);
    expect(dprEfetivo(0.75)).toBe(1); // zoom do navegador a 75%: não faz o canvas ficar menor que o CSS
    expect(dprEfetivo(5)).toBe(DPR_MAX);
    expect(dprEfetivo(4, 2)).toBe(2);
    for (const lixo of [undefined, NaN, 0, -2, Infinity]) expect(dprEfetivo(lixo as number)).toBe(1);
  });
});

describe('dprParaOrcamento', () => {
  it('não mexe quando cabe', () => {
    expect(dprParaOrcamento(390, 450, 3)).toBe(3); // celular: 1170 × 1350 = 1,6 MP
    expect(dprParaOrcamento(1280, 529, 2)).toBe(2); // desktop retina: 2560 × 1058 = 2,7 MP
    expect(dprParaOrcamento(1440, 700, 2)).toBe(2); // notebook retina: 2880 × 1400 = 4,0 MP
  });

  it('reduz o dpr em contêiner grande, mantendo os pixels dentro do orçamento', () => {
    const d = dprParaOrcamento(2560, 900, 2); // monitor largo com dpr 2 = 9,2 MP
    expect(d).toBeLessThan(2);
    expect(d).toBeGreaterThan(1);
    const b = tamanhoBitmap(2560, 900, d);
    expect(b.largura * b.altura).toBeLessThanOrEqual(PIXELS_MAX * 1.001);
  });

  it('nunca passa do dpr pedido nem cai abaixo de 1', () => {
    expect(dprParaOrcamento(100, 100, 2)).toBe(2);
    expect(dprParaOrcamento(10000, 10000, 3)).toBe(1); // nem em 1x cabe: fica em 1 (o piso é não borrar)
  });
});

describe('tamanhoBitmap / medirTela / aplicarTela', () => {
  it('bitmap = CSS × dpr arredondado, no mínimo 1 px', () => {
    expect(tamanhoBitmap(1280, 529, 1)).toEqual({ largura: 1280, altura: 529 });
    expect(tamanhoBitmap(390, 450, 3)).toEqual({ largura: 1170, altura: 1350 });
    expect(tamanhoBitmap(333, 201, 1.5)).toEqual({ largura: 500, altura: 302 }); // 499,5 → 500; 301,5 → 302
    expect(tamanhoBitmap(0, 0, 2)).toEqual({ largura: 1, altura: 1 });
  });

  it('medirTela devolve o tamanho de CSS do contêiner e o dpr efetivo', () => {
    expect(medirTela({ clientWidth: 390, clientHeight: 450 }, 3)).toEqual({ largura: 390, altura: 450, dpr: 3 });
    expect(medirTela({ clientWidth: 1280, clientHeight: 529 }, undefined)).toEqual({ largura: 1280, altura: 529, dpr: 1 });
    expect(medirTela({ clientWidth: 390, clientHeight: 450 }, 8).dpr).toBe(DPR_MAX); // dpr absurdo: teto
    expect(medirTela({ clientWidth: 1280, clientHeight: 529 }, 3).dpr).toBeLessThan(3); // 6,1 MP: cai para o orçamento
  });

  it('aplicarTela só mexe no canvas se o bitmap mudou (mexer em width/height limpa o canvas)', () => {
    let escritas = 0;
    const canvas = {
      _w: 0, _h: 0,
      get width() { return this._w; }, set width(v: number) { this._w = v; escritas++; },
      get height() { return this._h; }, set height(v: number) { this._h = v; escritas++; },
    };
    expect(aplicarTela(canvas, { largura: 390, altura: 450, dpr: 2 })).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([780, 900]);
    escritas = 0;
    expect(aplicarTela(canvas, { largura: 390, altura: 450, dpr: 2 })).toBe(false);
    expect(escritas).toBe(0);
    expect(aplicarTela(canvas, { largura: 390, altura: 450, dpr: 3 })).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([1170, 1350]);
  });

  it('mesmaTela compara tamanho e dpr', () => {
    const t = { largura: 10, altura: 20, dpr: 2 };
    expect(mesmaTela(t, { ...t })).toBe(true);
    expect(mesmaTela(t, { ...t, dpr: 1 })).toBe(false);
    expect(mesmaTela(t, { ...t, altura: 21 })).toBe(false);
  });
});
