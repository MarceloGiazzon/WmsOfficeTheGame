// Câmera 2D: converte coordenadas do mundo (cm) em pixels de tela e vice-versa.

import type { Ponto } from '../sim/layout';

export class Camera {
  /** pixels por cm */
  escala = 0.3;
  /** posição, em pixels, da origem do mundo na tela */
  offsetX = 0;
  offsetY = 0;

  static readonly ESCALA_MIN = 0.02;
  static readonly ESCALA_MAX = 2;

  paraTela(p: Ponto): Ponto {
    return { x: p.x * this.escala + this.offsetX, y: p.y * this.escala + this.offsetY };
  }

  paraMundo(p: Ponto): Ponto {
    return { x: (p.x - this.offsetX) / this.escala, y: (p.y - this.offsetY) / this.escala };
  }

  /** Enquadra um retângulo do mundo (largura × altura em cm) na tela, com margem em px. */
  enquadrar(larguraMundo: number, alturaMundo: number, larguraTela: number, alturaTela: number, margem = 40): void {
    const e = Math.min((larguraTela - 2 * margem) / larguraMundo, (alturaTela - 2 * margem) / alturaMundo);
    this.escala = Math.min(Camera.ESCALA_MAX, Math.max(Camera.ESCALA_MIN, e));
    this.offsetX = (larguraTela - larguraMundo * this.escala) / 2;
    this.offsetY = (alturaTela - alturaMundo * this.escala) / 2;
  }

  /** Zoom multiplicativo mantendo fixo o ponto de tela `ancora`. */
  zoom(fator: number, ancora: Ponto): void {
    const antes = this.paraMundo(ancora);
    this.escala = Math.min(Camera.ESCALA_MAX, Math.max(Camera.ESCALA_MIN, this.escala * fator));
    this.offsetX = ancora.x - antes.x * this.escala;
    this.offsetY = ancora.y - antes.y * this.escala;
  }

  mover(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }
}
