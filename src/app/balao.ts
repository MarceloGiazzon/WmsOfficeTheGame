// Geometria do balão do tutorial: onde colocar a caixa de texto para que (1) nunca saia da tela e (2) cubra o mínimo
// possível do elemento destacado. Pura (sem DOM): a UI mede os retângulos, pergunta aqui e aplica o resultado.

export interface Retangulo { x: number; y: number; largura: number; altura: number }
export interface Tamanho { largura: number; altura: number }
export type Lado = 'abaixo' | 'acima' | 'direita' | 'esquerda' | 'dentro' | 'centro';
export interface Posicao { x: number; y: number; lado: Lado }

export interface OpcoesBalao {
  /** Distância mínima entre o balão e a borda da tela. */
  margem?: number;
  /** Distância entre o balão e o alvo quando ficam lado a lado. */
  folga?: number;
}

/** Menor retângulo que contém todos (o balão aponta para o conjunto de elementos de um passo). Sem retângulos: null. */
export function uniao(retangulos: readonly Retangulo[]): Retangulo | null {
  if (retangulos.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of retangulos) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.largura);
    y1 = Math.max(y1, r.y + r.altura);
  }
  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
}

/** O retângulo com `px` a mais em cada lado (o destaque respira um pouco em volta do elemento). */
export function expandir(r: Retangulo, px: number): Retangulo {
  return { x: r.x - px, y: r.y - px, largura: r.largura + 2 * px, altura: r.altura + 2 * px };
}

const limitar = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, Math.max(min, max)));

/**
 * Escolhe a posição do balão. Tenta, nesta ordem, abaixo, acima, à direita e à esquerda do alvo (o primeiro lado em que o
 * balão cabe INTEIRO sem encostar no alvo). Se nenhum cabe (alvo grande como o mapa, ou tela baixa como um celular em
 * paisagem), o balão vai para DENTRO do alvo, colado na borda de baixo. Sem alvo, fica no centro da tela.
 * Em todos os casos o retângulo devolvido fica dentro da tela com a `margem` — se o balão for maior que a tela, ele é
 * colado no canto superior esquerdo (a UI limita a altura e rola o texto).
 */
export function posicionarBalao(alvo: Retangulo | null, balao: Tamanho, tela: Tamanho, opcoes: OpcoesBalao = {}): Posicao {
  const margem = opcoes.margem ?? 12;
  const folga = opcoes.folga ?? 12;
  const xMax = tela.largura - balao.largura - margem;
  const yMax = tela.altura - balao.altura - margem;
  const naTelaX = (x: number) => limitar(x, margem, xMax);
  const naTelaY = (y: number) => limitar(y, margem, yMax);

  if (!alvo) return { x: naTelaX((tela.largura - balao.largura) / 2), y: naTelaY((tela.altura - balao.altura) / 2), lado: 'centro' };

  const centradoX = alvo.x + alvo.largura / 2 - balao.largura / 2;
  const centradoY = alvo.y + alvo.altura / 2 - balao.altura / 2;

  const abaixo = alvo.y + alvo.altura + folga;
  if (abaixo <= yMax) return { x: naTelaX(centradoX), y: abaixo, lado: 'abaixo' };

  const acima = alvo.y - folga - balao.altura;
  if (acima >= margem) return { x: naTelaX(centradoX), y: acima, lado: 'acima' };

  const direita = alvo.x + alvo.largura + folga;
  if (direita <= xMax) return { x: direita, y: naTelaY(centradoY), lado: 'direita' };

  const esquerda = alvo.x - folga - balao.largura;
  if (esquerda >= margem) return { x: esquerda, y: naTelaY(centradoY), lado: 'esquerda' };

  // dentro do alvo, encostado embaixo (zona do polegar): o mapa continua visível acima do balão
  return { x: naTelaX(centradoX), y: naTelaY(alvo.y + alvo.altura - balao.altura - folga), lado: 'dentro' };
}
