// Desenha o snapshot da simulação no canvas. Só lê o estado — nunca o altera.

import type { Layout, LayoutLocal, Retangulo } from '../sim/layout';
import type { Snapshot } from '../sim/simulation';
import type { Camera } from './camera';

/** Uma posição física (rua + posição); agrupa os andares, que no 2D ocupam o mesmo retângulo. */
export interface Vao {
  chave: string;
  ruaCodigo: string;
  posicao: number;
  rect: Retangulo;
  andares: LayoutLocal[];
}

export function chaveVao(l: Pick<LayoutLocal, 'ruaId' | 'posicao'>): string {
  return `${l.ruaId}#${l.posicao}`;
}

export function agruparVaos(layout: Layout): Vao[] {
  const porChave = new Map<string, Vao>();
  for (const l of layout.locais) {
    const k = chaveVao(l);
    let v = porChave.get(k);
    if (!v) {
      v = { chave: k, ruaCodigo: l.ruaCodigo, posicao: l.posicao, rect: l.rect, andares: [] };
      porChave.set(k, v);
    }
    v.andares.push(l);
  }
  return [...porChave.values()];
}

const COR = {
  fundo: '#0b1120',
  piso: '#111827',
  corredor: '#1f2937',
  vaoVazio: '#1e293b',
  vaoOcupado: '#3b82f6',
  bordaVao: '#334155',
  docaIn: '#064e3b',
  docaInTexto: '#6ee7b7',
  docaOut: '#1e3a8a',
  docaOutTexto: '#93c5fd',
  equipamento: '#f59e0b',
  selecao: '#facc15',
  texto: '#e2e8f0',
};

export interface OpcoesRender {
  heatmap: boolean;
  vaoSelecionado: string | null;
}

export class Renderer {
  private vaos: Vao[] = [];
  private layoutAtual: Layout | null = null;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** Vãos do layout atual (recalculados só quando o layout muda). */
  vaosDe(layout: Layout): Vao[] {
    if (layout !== this.layoutAtual) {
      this.layoutAtual = layout;
      this.vaos = agruparVaos(layout);
    }
    return this.vaos;
  }

  desenhar(s: Snapshot, cam: Camera, op: OpcoesRender): void {
    const { ctx } = this;
    const { width, height } = ctx.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COR.fundo;
    ctx.fillRect(0, 0, width, height);

    ctx.setTransform(cam.escala, 0, 0, cam.escala, cam.offsetX, cam.offsetY);
    const px = 1 / cam.escala; // 1 pixel de tela em cm
    const layout = s.layout;

    ctx.fillStyle = COR.piso;
    ctx.fillRect(0, 0, layout.largura, layout.altura);

    // corredores
    ctx.fillStyle = COR.corredor;
    for (const r of layout.ruas) {
      ctx.fillRect(r.rect.x, r.corredorY - 60, r.rect.largura, 120);
    }
    ctx.fillRect(layout.corredorPrincipalX - 60, 0, 120, layout.altura);

    // docas
    for (const d of layout.docas) {
      const entrada = d.tipo === 'Inbound';
      ctx.fillStyle = entrada ? COR.docaIn : COR.docaOut;
      ctx.fillRect(d.rect.x, d.rect.y + 10, d.rect.largura, d.rect.altura - 20);
      // rótulo só se couber na doca (no WH-B enquadrado a doca tem ~50 px)
      const larguraPx = d.rect.largura * cam.escala;
      const rotulo = larguraPx >= 90 ? `${entrada ? 'DOCA IN' : 'DOCA OUT'} ${d.numero}` : `${entrada ? 'IN' : 'OUT'} ${d.numero}`;
      if (larguraPx >= 36) {
        this.texto(rotulo, d.rect.x + 6 * px, d.rect.y + d.rect.altura / 2, entrada ? COR.docaInTexto : COR.docaOutTexto,
          Math.min(12, larguraPx / 5) * px);
      }
    }

    // vãos
    const vaos = this.vaosDe(layout);
    let maxAcessos = 1;
    if (op.heatmap) {
      for (const v of vaos) maxAcessos = Math.max(maxAcessos, this.acessos(v, s));
    }
    for (const v of vaos) {
      if (op.heatmap) {
        const i = this.acessos(v, s) / maxAcessos;
        ctx.fillStyle = `rgba(239, 68, 68, ${0.12 + i * 0.8})`;
      } else {
        const ocupados = v.andares.filter(a => s.locais.get(a.localId)?.situacao === 'Ocupado').length;
        ctx.fillStyle = ocupados === 0 ? COR.vaoVazio : COR.vaoOcupado;
        ctx.globalAlpha = ocupados === 0 ? 1 : 0.35 + 0.65 * (ocupados / v.andares.length);
      }
      ctx.fillRect(v.rect.x, v.rect.y, v.rect.largura, v.rect.altura);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COR.bordaVao;
      ctx.lineWidth = px;
      ctx.strokeRect(v.rect.x, v.rect.y, v.rect.largura, v.rect.altura);
    }

    // rótulos (só com zoom suficiente para ler)
    if (cam.escala >= 0.25) {
      for (const v of vaos) {
        this.texto(`${v.ruaCodigo}-${String(v.posicao).padStart(2, '0')}`, v.rect.x + 8, v.rect.y + v.rect.altura / 2,
          COR.texto, 9 * px);
      }
    } else if (cam.escala >= 0.05) {
      // código da rua dentro da rack, à direita da última posição (fora do caminho dos equipamentos)
      for (const r of layout.ruas) {
        this.texto(r.codigo, r.rect.x + r.rect.largura + 6 * px, r.rect.y + r.rect.altura / 2, COR.texto, 10 * px);
      }
    }

    // seleção
    const sel = op.vaoSelecionado ? vaos.find(v => v.chave === op.vaoSelecionado) : undefined;
    if (sel) {
      ctx.strokeStyle = COR.selecao;
      ctx.lineWidth = 3 * px;
      ctx.strokeRect(sel.rect.x, sel.rect.y, sel.rect.largura, sel.rect.altura);
    }

    // equipamentos
    for (const e of s.equipamentos) {
      ctx.fillStyle = COR.equipamento;
      ctx.beginPath();
      ctx.arc(e.posicao.x, e.posicao.y, Math.max(45, 7 * px), 0, Math.PI * 2);
      ctx.fill();
      if (cam.escala >= 0.2) this.texto(e.id, e.posicao.x + 60, e.posicao.y - 60, COR.texto, 9 * px);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Vão sob um ponto do mundo (cm), ou null. */
  vaoEm(layout: Layout, x: number, y: number): Vao | null {
    return this.vaosDe(layout).find(v => x >= v.rect.x && x <= v.rect.x + v.rect.largura
      && y >= v.rect.y && y <= v.rect.y + v.rect.altura) ?? null;
  }

  private acessos(v: Vao, s: Snapshot): number {
    return v.andares.reduce((n, a) => n + (s.locais.get(a.localId)?.acessos ?? 0), 0);
  }

  private texto(t: string, x: number, y: number, cor: string, tamanho: number): void {
    this.ctx.fillStyle = cor;
    this.ctx.font = `${tamanho}px "JetBrains Mono", monospace`;
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(t, x, y);
  }
}
