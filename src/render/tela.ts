// Tamanho do canvas em telas de alta densidade (celular, retina).
//
// Regra única: o MUNDO, a câmera, os gestos e o inspector vivem em px de CSS. Só o BITMAP do canvas tem
// `px de CSS × dpr` pixels — o Renderer multiplica a transformação por `dpr`, então tudo o que é medido em px de
// tela (bordas de 1 px, fontes de 9 px, limiares de rótulo) continua com o MESMO tamanho visual; o dpr só dá nitidez.
// O CSS do canvas segue sendo 100% do contêiner (o navegador reduz o bitmap maior para o tamanho de CSS).

/** Mais que isso não se enxerga em canvas de mapa e o fill-rate cresce com dpr². */
export const DPR_MAX = 3;
/**
 * Orçamento de pixels do bitmap. Em contêiner grande (monitor 4K, janela maximizada com dpr 2) o dpr efetivo cai
 * para caber aqui, em vez de preencher muitos megapixels por quadro. Medido no WH-B (Intel HD 5500, canvas 2D por GPU,
 * cena com rótulos): ~2,5 ms por megapixel de bitmap, ou seja ~10 ms a 4 MP e ~20 ms a 7 MP (dpr 3 em 1280×640).
 * 4,2 MP deixa passar celular (390×450 a dpr 3 = 1,6 MP), tablet e notebook retina (1440×700 a dpr 2 = 4,0 MP).
 */
export const PIXELS_MAX = 4_200_000;

/** Tamanho da área do canvas e densidade, com a largura/altura em px de CSS. */
export interface Tela {
  largura: number;
  altura: number;
  dpr: number;
}

/** O dpr que realmente se usa: nunca abaixo de 1 (não borra de propósito), nunca acima de `max`; lixo vira 1. */
export function dprEfetivo(dprBruto: number | undefined, max = DPR_MAX): number {
  if (typeof dprBruto !== 'number' || !Number.isFinite(dprBruto) || dprBruto <= 0) return 1;
  return Math.min(max, Math.max(1, dprBruto));
}

/** Reduz o dpr, se preciso, para que `largura × altura × dpr²` caiba em `maxPixels` (sem passar de `dpr`, sem ir abaixo de 1). */
export function dprParaOrcamento(larguraCss: number, alturaCss: number, dpr: number, maxPixels = PIXELS_MAX): number {
  const area = Math.max(1, larguraCss * alturaCss);
  return Math.max(1, Math.min(dpr, Math.sqrt(maxPixels / area)));
}

/** Pixels do bitmap para uma área de CSS (inteiros, no mínimo 1: canvas de 0 px não desenha). */
export function tamanhoBitmap(larguraCss: number, alturaCss: number, dpr: number): { largura: number; altura: number } {
  return { largura: Math.max(1, Math.round(larguraCss * dpr)), altura: Math.max(1, Math.round(alturaCss * dpr)) };
}

export function mesmaTela(a: Tela, b: Tela): boolean {
  return a.largura === b.largura && a.altura === b.altura && a.dpr === b.dpr;
}

/** Mede o contêiner (área de CSS do canvas) e decide o dpr efetivo. `dprBruto` vem do `devicePixelRatio` do navegador. */
export function medirTela(pai: { clientWidth: number; clientHeight: number }, dprBruto?: number): Tela {
  const largura = pai.clientWidth;
  const altura = pai.clientHeight;
  return { largura, altura, dpr: dprParaOrcamento(largura, altura, dprEfetivo(dprBruto)) };
}

/** Põe o bitmap do canvas em `css × dpr`. Mexer em width/height limpa o canvas: só toca se mudou. Devolve se mudou. */
export function aplicarTela(canvas: { width: number; height: number }, t: Tela): boolean {
  const b = tamanhoBitmap(t.largura, t.altura, t.dpr);
  if (canvas.width === b.largura && canvas.height === b.altura) return false;
  canvas.width = b.largura;
  canvas.height = b.altura;
  return true;
}

/**
 * Avisa quando o contêiner muda de tamanho OU o dpr muda (zoom do navegador, arrastar a janela para outro monitor):
 * o ResizeObserver cobre o primeiro (e o zoom do navegador, que muda o tamanho em px de CSS), o `matchMedia` de
 * resolução cobre o monitor com outra densidade e é reassinado a cada mudança (a consulta vale para um dpr só).
 * Devolve a função que desliga tudo.
 */
export function observarTela(pai: Element, aoMudar: () => void): () => void {
  const ro = new ResizeObserver(() => aoMudar());
  ro.observe(pai);

  let consulta: MediaQueryList | null = null;
  const assinar = () => {
    consulta = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    consulta.addEventListener('change', aoMudarDpr, { once: true });
  };
  const aoMudarDpr = () => {
    aoMudar();
    assinar();
  };
  assinar();

  return () => {
    ro.disconnect();
    consulta?.removeEventListener('change', aoMudarDpr);
  };
}
