// Reconhecedor de gestos: arrastar (pan), pinça (zoom + pan), roda, clique e duplo clique. Não conhece o DOM nem
// a simulação: recebe pontos de tela já relativos ao canvas e mexe só na Camera. O input.ts liga os eventos do
// navegador a ele; assim a lógica roda (e é testada) sem navegador.

import type { Ponto } from '../sim/layout';
import type { Camera } from './camera';

/** Movimento máximo (px, soma de |dx|+|dy|) para um "pressionar e soltar" ainda contar como clique. */
export const LIMIAR_CLIQUE_PX = 5;
/** Dedo treme mais que mouse: o limiar do clique por toque é maior. */
export const LIMIAR_CLIQUE_TOQUE_PX = 14;
/** Dois cliques mais próximos que isto (ms e px) formam um duplo clique. */
export const INTERVALO_DUPLO_MS = 350;
export const DISTANCIA_DUPLO_PX = 30;

/** Sensibilidade da roda: 100 de `deltaY` (um "clique" do mouse) ≈ ×1,16 — como o passo fixo antigo, mas proporcional. */
const K_RODA = 0.0015;
/** Pinça no trackpad chega como roda com Ctrl, com deltas pequenos: precisa de mais ganho. */
const K_RODA_PINCA = 0.01;
const FATOR_RODA_MAX = 1.5;

export interface AcoesGestos {
  /** Clique simples (sem arrasto, sem segundo dedo). `mundo` em cm. */
  aoClicar(mundo: Ponto): void;
  /** Segundo clique rápido e próximo do primeiro; no lugar do `aoClicar` do segundo. */
  aoDuploClique(mundo: Ponto): void;
  /** Qualquer gesto novo começou (dedo/mouse desceu, roda): quem anima a câmera deve parar. */
  aoIniciar?(): void;
}

export interface Tela { largura: number; altura: number; }

/** Fator de zoom de um evento de roda. `deltaMode`: 0 = pixels, 1 = linhas, 2 = páginas. */
export function fatorDaRoda(deltaY: number, deltaMode = 0, pinca = false): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
  const f = Math.exp(-px * (pinca ? K_RODA_PINCA : K_RODA));
  return Math.min(FATOR_RODA_MAX, Math.max(1 / FATOR_RODA_MAX, f));
}

export class Gestos {
  /** Dedos/ponteiros ativos, pela última posição vista. */
  private readonly ativos = new Map<number, Ponto>();
  /** Começou o gesto atual com mais de um dedo (ou o pan já passou do limiar): ao soltar não é clique. */
  private virouArrasto = false;
  private movido = 0;
  private limiar = LIMIAR_CLIQUE_PX;
  private ultimoClique: { t: number; p: Ponto } | null = null;

  constructor(
    private readonly cam: Camera,
    private readonly tela: () => Tela,
    private readonly acoes: AcoesGestos,
  ) {}

  get ativo(): boolean {
    return this.ativos.size > 0;
  }

  baixar(id: number, p: Ponto, toque = false): void {
    this.acoes.aoIniciar?.();
    if (this.ativos.size === 0) {
      this.virouArrasto = false;
      this.movido = 0;
      this.limiar = toque ? LIMIAR_CLIQUE_TOQUE_PX : LIMIAR_CLIQUE_PX;
    } else {
      // segundo dedo: vira pinça; o gesto todo deixa de ser um possível clique
      this.virouArrasto = true;
      this.ultimoClique = null;
    }
    this.ativos.set(id, p);
  }

  mover(id: number, p: Ponto): void {
    const anterior = this.ativos.get(id);
    if (!anterior) return;
    if (this.ativos.size === 1) {
      const dx = p.x - anterior.x;
      const dy = p.y - anterior.y;
      this.movido += Math.abs(dx) + Math.abs(dy);
      if (this.movido > this.limiar) this.virouArrasto = true;
      this.cam.mover(dx, dy);
    } else if (this.ativos.size === 2) {
      // pinça: os dois pontos antes e depois deste movimento (o outro dedo ainda está onde estava)
      const outro = [...this.ativos].find(([k]) => k !== id)![1];
      this.cam.pinca(anterior, outro, p, outro);
    }
    this.ativos.set(id, p);
    const t = this.tela();
    this.cam.limitar(t.largura, t.altura);
  }

  soltar(id: number, p: Ponto, agoraMs: number): void {
    if (!this.ativos.delete(id)) return;
    // o dedo que sobra continua como pan, sem salto: a próxima posição dele já parte de onde está
    if (this.ativos.size > 0 || this.virouArrasto) return;
    const mundo = this.cam.paraMundo(p);
    const anterior = this.ultimoClique;
    if (anterior && agoraMs - anterior.t <= INTERVALO_DUPLO_MS
      && Math.hypot(p.x - anterior.p.x, p.y - anterior.p.y) <= DISTANCIA_DUPLO_PX) {
      this.ultimoClique = null;
      this.acoes.aoDuploClique(mundo);
    } else {
      this.ultimoClique = { t: agoraMs, p };
      this.acoes.aoClicar(mundo);
    }
  }

  cancelar(id: number): void {
    this.ativos.delete(id);
    this.virouArrasto = true;
  }

  roda(deltaY: number, deltaMode: number, pinca: boolean, ancora: Ponto): void {
    this.acoes.aoIniciar?.();
    this.cam.zoom(fatorDaRoda(deltaY, deltaMode, pinca), ancora);
    const t = this.tela();
    this.cam.limitar(t.largura, t.altura);
  }
}
