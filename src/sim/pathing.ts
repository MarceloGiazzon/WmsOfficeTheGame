// Malha de corredores e caminhos. Duas famílias de corredor (ver layout.ts):
//   - corredor principal: linha vertical x = corredorPrincipalX, liga docas e ruas (largo: não gera conflito);
//   - corredor de rua: linha horizontal y = corredorY, a partir do principal (estreito: uma empilhadeira por vez).
// Todo ponto de equipamento é (a) do corredor principal (x = corredorPrincipalX) ou (b) o acesso de um local
// (no corredor da sua rua). O caminho entre dois pontos é sempre ortogonal e passa pelo corredor principal.

import type { Layout, Ponto } from './layout';

export interface Trecho {
  para: Ponto;
  /** Corredor de rua em que o trecho corre (exige exclusividade); null no corredor principal. */
  ruaId: string | null;
  /** Este trecho termina no corredor principal, saindo do corredor da rua: a rua é liberada. */
  libera: boolean;
}

export class Malha {
  private readonly ruaPorY = new Map<number, string>();
  private readonly cx: number;

  constructor(layout: Layout) {
    this.cx = layout.corredorPrincipalX;
    for (const r of layout.ruas) this.ruaPorY.set(r.corredorY, r.ruaId);
  }

  /** Ponto de passagem do corredor principal, na altura do corredor de uma rua. */
  juncao(p: Ponto): Ponto {
    return { x: this.cx, y: p.y };
  }

  /** Rua cujo corredor contém o ponto; null se o ponto está no corredor principal. */
  ruaDe(p: Ponto): string | null {
    if (p.x === this.cx) return null;
    const r = this.ruaPorY.get(p.y);
    if (r === undefined) throw new Error(`ponto fora da malha de corredores: (${p.x}, ${p.y})`);
    return r;
  }

  /** Trechos de `a` até `b` (sem repetir o ponto de partida). */
  caminho(a: Ponto, b: Ponto): Trecho[] {
    const ra = this.ruaDe(a);
    const rb = this.ruaDe(b);
    if (ra !== null && ra === rb) {
      return a.x === b.x ? [] : [{ para: b, ruaId: ra, libera: false }];
    }
    const trechos: Trecho[] = [];
    let atual = a;
    if (ra !== null) {
      const j = this.juncao(a);
      trechos.push({ para: j, ruaId: ra, libera: true });
      atual = j;
    }
    if (atual.y !== b.y) {
      const j = { x: this.cx, y: b.y };
      trechos.push({ para: j, ruaId: null, libera: false });
      atual = j;
    }
    if (rb !== null) trechos.push({ para: b, ruaId: rb, libera: false });
    return trechos;
  }

  /** Distância (cm) percorrida pelo caminho de `a` até `b`. */
  distancia(a: Ponto, b: Ponto): number {
    let d = 0;
    let atual = a;
    for (const t of this.caminho(a, b)) {
      d += Math.abs(t.para.x - atual.x) + Math.abs(t.para.y - atual.y);
      atual = t.para;
    }
    return d;
  }
}
