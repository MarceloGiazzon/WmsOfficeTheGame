// Decisão do arrasto da alça da gaveta (bottom sheet do celular). Pura: a UI mede o deslocamento vertical do dedo e
// pergunta o que fazer. Sem DOM, com teste.

/** Até aqui o dedo "tremeu": é um toque, e quem alterna a gaveta é o próprio clique do botão. */
export const LIMIAR_TOQUE_PX = 8;
/** Arrasto mínimo para abrir (para cima) ou recolher (para baixo): longe o bastante para não ser acidente. */
export const LIMIAR_ARRASTO_PX = 40;

export type ResultadoArraste = 'toque' | 'abrir' | 'recolher' | 'nada';

/**
 * @param dy deslocamento vertical do dedo, em px: positivo = para baixo (fim - início).
 * @param aberta a gaveta estava aberta quando o dedo encostou.
 * Arrastar para baixo com ela aberta recolhe; para cima com ela recolhida abre; o resto (sentido errado ou curto
 * demais) não faz nada, e a gaveta volta para onde estava.
 */
export function resultadoDoArraste(dy: number, aberta: boolean): ResultadoArraste {
  if (Math.abs(dy) <= LIMIAR_TOQUE_PX) return 'toque';
  if (aberta && dy >= LIMIAR_ARRASTO_PX) return 'recolher';
  if (!aberta && dy <= -LIMIAR_ARRASTO_PX) return 'abrir';
  return 'nada';
}

/** Quanto a gaveta aberta acompanha o dedo durante o arrasto: só desce (nunca passa do ponto de partida para cima). */
export function deslocamentoVisual(dy: number, aberta: boolean): number {
  return aberta ? Math.max(0, dy) : 0;
}
