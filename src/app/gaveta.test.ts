import { describe, expect, it } from 'vitest';
import { LIMIAR_ARRASTO_PX, LIMIAR_TOQUE_PX, deslocamentoVisual, resultadoDoArraste } from './gaveta';

describe('resultadoDoArraste', () => {
  it('movimento minúsculo é toque, aberta ou não', () => {
    expect(resultadoDoArraste(0, true)).toBe('toque');
    expect(resultadoDoArraste(LIMIAR_TOQUE_PX, false)).toBe('toque');
    expect(resultadoDoArraste(-LIMIAR_TOQUE_PX, true)).toBe('toque');
  });

  it('aberta: arrastar para baixo o bastante recolhe', () => {
    expect(resultadoDoArraste(LIMIAR_ARRASTO_PX, true)).toBe('recolher');
    expect(resultadoDoArraste(200, true)).toBe('recolher');
  });

  it('recolhida: arrastar para cima o bastante abre', () => {
    expect(resultadoDoArraste(-LIMIAR_ARRASTO_PX, false)).toBe('abrir');
    expect(resultadoDoArraste(-150, false)).toBe('abrir');
  });

  it('arrasto curto ou no sentido errado não faz nada', () => {
    expect(resultadoDoArraste(LIMIAR_ARRASTO_PX - 1, true)).toBe('nada');
    expect(resultadoDoArraste(-80, true)).toBe('nada'); // aberta, puxando para cima: já está aberta
    expect(resultadoDoArraste(80, false)).toBe('nada'); // recolhida, puxando para baixo: já está recolhida
    expect(resultadoDoArraste(-(LIMIAR_ARRASTO_PX - 1), false)).toBe('nada');
  });
});

describe('deslocamentoVisual', () => {
  it('a gaveta aberta só acompanha o dedo para baixo', () => {
    expect(deslocamentoVisual(70, true)).toBe(70);
    expect(deslocamentoVisual(-30, true)).toBe(0);
  });

  it('a pílula recolhida não se move', () => {
    expect(deslocamentoVisual(70, false)).toBe(0);
    expect(deslocamentoVisual(-70, false)).toBe(0);
  });
});
