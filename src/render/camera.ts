// Câmera 2D: converte coordenadas do mundo (cm) em pixels de tela e vice-versa.
// Toda a matemática de zoom, pan, pinça e limites mora aqui (pura, testável); os gestos só a chamam.

import type { Ponto, Retangulo } from '../sim/layout';

/** O que define uma vista: o suficiente para guardar, comparar e animar entre duas câmeras. */
export interface EstadoCamera {
  escala: number;
  offsetX: number;
  offsetY: number;
}

export class Camera {
  /** pixels por cm */
  escala = 0.3;
  /** posição, em pixels, da origem do mundo na tela */
  offsetX = 0;
  offsetY = 0;

  /** Piso absoluto de zoom (antes de a câmera conhecer o armazém). */
  static readonly ESCALA_MIN = 0.02;
  static readonly ESCALA_MAX = 2;
  /** Depois de `enquadrar`, dá para afastar até o armazém ocupar esta fração do enquadramento (0,5 = metade). */
  static readonly AFASTAR_MAX = 0.5;
  /** Pan: sempre fica visível, no mínimo, esta fração da tela (por eixo) com armazém — não dá para "perdê-lo". */
  static readonly FRACAO_VISIVEL_MIN = 0.2;

  // Lembrados no `enquadrar` para os limites de zoom e pan (0 = ainda não enquadrou: sem limites de pan).
  private mundoLargura = 0;
  private mundoAltura = 0;
  private escalaEnquadrada = 0;
  /** A vista ainda é a do último `enquadrar`: nenhum zoom, pan, pinça nem centralização desde então. */
  private enquadradaIntacta = false;

  paraTela(p: Ponto): Ponto {
    return { x: p.x * this.escala + this.offsetX, y: p.y * this.escala + this.offsetY };
  }

  paraMundo(p: Ponto): Ponto {
    return { x: (p.x - this.offsetX) / this.escala, y: (p.y - this.offsetY) / this.escala };
  }

  /** Menor escala permitida: o piso absoluto ou, já enquadrada, a fração `AFASTAR_MAX` do enquadramento. */
  escalaMinima(): number {
    return Math.max(Camera.ESCALA_MIN, this.escalaEnquadrada * Camera.AFASTAR_MAX);
  }

  private limitarEscala(e: number): number {
    return Math.min(Camera.ESCALA_MAX, Math.max(this.escalaMinima(), e));
  }

  /** Enquadra um retângulo do mundo (largura × altura em cm) na tela, com margem em px. */
  enquadrar(larguraMundo: number, alturaMundo: number, larguraTela: number, alturaTela: number, margem = 40): void {
    const e = Math.min((larguraTela - 2 * margem) / larguraMundo, (alturaTela - 2 * margem) / alturaMundo);
    this.escala = Math.min(Camera.ESCALA_MAX, Math.max(Camera.ESCALA_MIN, e));
    this.offsetX = (larguraTela - larguraMundo * this.escala) / 2;
    this.offsetY = (alturaTela - alturaMundo * this.escala) / 2;
    this.mundoLargura = larguraMundo;
    this.mundoAltura = alturaMundo;
    this.escalaEnquadrada = this.escala;
    this.enquadradaIntacta = true;
  }

  /**
   * A tela mudou de tamanho (girar o celular, redimensionar a janela). Quem ainda está no enquadramento original
   * (ninguém mexeu na vista) volta a ter o armazém inteiro enquadrado na tela nova — senão o zoom ficaria na escala da
   * tela anterior, grande demais ou pequeno demais. Quem já deu zoom ou pan mantém o que escolheu: só o centro da vista
   * acompanha o centro da tela.
   */
  aoRedimensionar(antes: { largura: number; altura: number }, depois: { largura: number; altura: number }): void {
    if (this.enquadradaIntacta && this.mundoLargura > 0 && this.mundoAltura > 0) {
      this.enquadrar(this.mundoLargura, this.mundoAltura, depois.largura, depois.altura);
    } else if (antes.largura > 0) {
      this.deslocar((depois.largura - antes.largura) / 2, (depois.altura - antes.altura) / 2);
    }
  }

  /** Zoom multiplicativo mantendo fixo o ponto de tela `ancora`. */
  zoom(fator: number, ancora: Ponto): void {
    this.enquadradaIntacta = false;
    const antes = this.paraMundo(ancora);
    this.escala = this.limitarEscala(this.escala * fator);
    this.offsetX = ancora.x - antes.x * this.escala;
    this.offsetY = ancora.y - antes.y * this.escala;
  }

  mover(dx: number, dy: number): void {
    this.enquadradaIntacta = false;
    this.deslocar(dx, dy);
  }

  private deslocar(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  /**
   * Pinça com pan: os dois dedos foram de (a0, b0) para (a1, b1) (pontos de tela). O ponto do mundo que estava
   * no meio dos dedos acompanha o meio dos dedos (pan) e a escala segue a razão das distâncias (zoom).
   */
  pinca(a0: Ponto, b0: Ponto, a1: Ponto, b1: Ponto): void {
    this.enquadradaIntacta = false;
    const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
    const meio0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const meio1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
    const ancora = this.paraMundo(meio0);
    if (d0 > 0 && d1 > 0) this.escala = this.limitarEscala(this.escala * (d1 / d0));
    this.offsetX = meio1.x - ancora.x * this.escala;
    this.offsetY = meio1.y - ancora.y * this.escala;
  }

  /**
   * Põe `ponto` (mundo) no centro da tela. Com `aproximarAte`, também aproxima até essa escala (nunca afasta:
   * quem já está mais perto fica onde está).
   */
  centralizarEm(ponto: Ponto, larguraTela: number, alturaTela: number, aproximarAte = 0): void {
    this.enquadradaIntacta = false;
    this.escala = this.limitarEscala(Math.max(this.escala, aproximarAte));
    this.offsetX = larguraTela / 2 - ponto.x * this.escala;
    this.offsetY = alturaTela / 2 - ponto.y * this.escala;
    this.limitar(larguraTela, alturaTela);
  }

  /**
   * Mantém o armazém à vista: em cada eixo, pelo menos `FRACAO_VISIVEL_MIN` da tela (ou o armazém inteiro, se ele
   * for menor que isso) continua coberta por ele. Sem `enquadrar` prévio não há o que limitar.
   */
  limitar(larguraTela: number, alturaTela: number): void {
    if (this.mundoLargura <= 0 || this.mundoAltura <= 0) return;
    this.offsetX = Camera.prender(this.offsetX, this.mundoLargura * this.escala, larguraTela);
    this.offsetY = Camera.prender(this.offsetY, this.mundoAltura * this.escala, alturaTela);
  }

  /** Um eixo de `limitar`: `tamanho` do mundo em px, `tela` em px; devolve o offset já dentro dos limites. */
  private static prender(offset: number, tamanho: number, tela: number): number {
    const margem = Math.min(tamanho, tela * Camera.FRACAO_VISIVEL_MIN);
    return Math.min(tela - margem, Math.max(margem - tamanho, offset));
  }

  /** Cópia independente (inclui o que `enquadrar` aprendeu), para calcular um destino sem mexer na câmera viva. */
  clonar(): Camera {
    const c = new Camera();
    c.aplicar(this.estado());
    c.mundoLargura = this.mundoLargura;
    c.mundoAltura = this.mundoAltura;
    c.escalaEnquadrada = this.escalaEnquadrada;
    c.enquadradaIntacta = this.enquadradaIntacta;
    return c;
  }

  estado(): EstadoCamera {
    return { escala: this.escala, offsetX: this.offsetX, offsetY: this.offsetY };
  }

  aplicar(e: EstadoCamera): void {
    this.enquadradaIntacta = false;
    this.escala = e.escala;
    this.offsetX = e.offsetX;
    this.offsetY = e.offsetY;
  }

  /** Retângulo do mundo (cm) que aparece na tela — base do culling do render. */
  mundoVisivel(larguraTela: number, alturaTela: number): Retangulo {
    return {
      x: -this.offsetX / this.escala, y: -this.offsetY / this.escala,
      largura: larguraTela / this.escala, altura: alturaTela / this.escala,
    };
  }

  /**
   * Vista intermediária (t de 0 a 1) entre duas câmeras, para animar. Interpola a escala em proporção (zoom
   * parece uniforme) e o ponto do mundo que está no centro da tela — assim o movimento é um "voo" até o alvo,
   * não um deslizar de offsets que cruza o armazém torto.
   */
  static entre(de: EstadoCamera, para: EstadoCamera, t: number, larguraTela: number, alturaTela: number): EstadoCamera {
    const centro = (e: EstadoCamera) => ({ x: (larguraTela / 2 - e.offsetX) / e.escala, y: (alturaTela / 2 - e.offsetY) / e.escala });
    const c0 = centro(de);
    const c1 = centro(para);
    const escala = de.escala * Math.pow(para.escala / de.escala, t);
    const cx = c0.x + (c1.x - c0.x) * t;
    const cy = c0.y + (c1.y - c0.y) * t;
    return { escala, offsetX: larguraTela / 2 - cx * escala, offsetY: alturaTela / 2 - cy * escala };
  }
}
