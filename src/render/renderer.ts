// Desenha o snapshot da simulação no canvas. Só lê o estado — nunca o altera.
//
// O armazém quase não muda de um quadro para o outro (câmera parada, 8 empilhadeiras andando, um vão ou outro
// trocando de ocupação). O que sobra por quadro foi enxugado, na ordem do que a medição (tools/perf) mostrou custar:
//
//  1. Quadro idêntico ao anterior (jogo pausado, 1x entre dois ticks, fim do turno): não desenha — o canvas mantém
//     os pixels. Era o maior ganho: parado, o jogo passa a custar ~0.
//  2. Culling pela viewport (no zoom, só os vãos visíveis) e sem alocações por quadro (sem filter/closures/strings
//     de cor por vão; rótulos montados uma vez; fonte definida uma vez por grupo de textos).
//  3. Rótulos dos vãos (~360 fillText, o item mais caro do desenho) e bordas num canvas auxiliar ("topo"), refeito só
//     quando câmera/tamanho/layout/fontes mudam. Só vale com zoom suficiente para haver rótulos (escala ≥ 0,25) e com
//     a câmera parada; no enquadrado do WH-B a camada custa mais (um blit de tela cheia) do que desenhar direto.
//     O piso/corredores/docas NÃO vão para camada: pintá-los direto custa o mesmo que copiar uma imagem.
//
// Ordem de composição: fundo → docas ocupadas → preenchimento dos vãos (ocupação / heatmap) → bordas e rótulos
// (por cima do preenchimento) → seleção → equipamentos.
//
// Enquanto a câmera se mexe (arrastar, pinça, roda, voo do duplo clique) o cache seria refeito a cada quadro e custaria
// mais que desenhar direto: nesses quadros bordas e rótulos são pintados direto no canvas principal (a mesma função,
// com culling). O cache só é montado quando a câmera fica igual à do quadro anterior.

import type { Layout, LayoutLocal, Retangulo } from '../sim/layout';
import type { Snapshot } from '../sim/simulation';
import type { Camera } from './camera';

/** Uma posição física (rua + posição); agrupa os andares, que no 2D ocupam o mesmo retângulo. */
export interface Vao {
  chave: string;
  ruaCodigo: string;
  posicao: number;
  /** "R01-07": texto do rótulo, montado uma vez (era remontado por quadro). */
  rotulo: string;
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
      v = {
        chave: k, ruaCodigo: l.ruaCodigo, posicao: l.posicao, rect: l.rect, andares: [],
        rotulo: `${l.ruaCodigo}-${String(l.posicao).padStart(2, '0')}`,
      };
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
  vaoCalor: '#ef4444',
  bordaVao: '#334155',
  docaIn: '#064e3b',
  docaInTexto: '#6ee7b7',
  docaOut: '#1e3a8a',
  docaOutTexto: '#93c5fd',
  equipamento: '#f59e0b',
  equipamentoEspera: '#ef4444',
  carga: '#e2e8f0',
  docaOcupada: '#fbbf24',
  selecao: '#facc15',
  texto: '#e2e8f0',
};

const FONTE = '"JetBrains Mono", monospace';
/** Rótulos e bordas fora da tela por até esta folga (cm) ainda são desenhados: o texto passa um pouco do vão. */
const FOLGA_CULLING_CM = 200;
/**
 * Valor "impossível" gravado em `ctx.miterLimit` (que o render não usa) ao fim de cada quadro. Se o canvas for
 * redimensionado, o navegador o limpa E reinicia o estado do contexto — mesmo com o mesmo tamanho. Ver o miterLimit
 * de volta ao padrão (10) é o sinal de que os pixels sumiram e o quadro precisa ser refeito.
 */
const SENTINELA = 7.5;

/** A partir desta escala (px/cm) os vãos ganham rótulo; abaixo, só o código de cada rua. */
const ESCALA_ROTULOS_VAO = 0.25;

export interface OpcoesRender {
  heatmap: boolean;
  vaoSelecionado: string | null;
}

export class Renderer {
  private vaos: Vao[] = [];
  private layoutAtual: Layout | null = null;

  // câmera/tamanho/layout do último quadro desenhado (para saber se a câmera está parada)
  private vistaLayout: Layout | null = null;
  private vistaEscala = NaN;
  private vistaOffsetX = NaN;
  private vistaOffsetY = NaN;
  private vistaLargura = 0;
  private vistaAltura = 0;
  private vistaFontes = -1;

  // camada "topo" (bordas e rótulos) em cache e a chave com que foi desenhada
  private topo: HTMLCanvasElement | null = null;
  private cacheLayout: Layout | null = null;
  private cacheEscala = NaN;
  private cacheOffsetX = NaN;
  private cacheOffsetY = NaN;
  private cacheLargura = 0;
  private cacheAltura = 0;
  private cacheFontes = -1;
  private versaoFontes = 0;

  // o que o canvas principal mostra agora (para pular quadros idênticos)
  private ultLocais: unknown = null;
  private ultRelogio = NaN;
  private ultHeatmap: boolean | null = null;
  private ultSelecao: string | null | undefined = undefined;

  /** Reaproveitados entre quadros (sem alocação por quadro). */
  private acessosVao = new Int32Array(0);
  private readonly docasOcupadas = new Set<string>();

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    // O canvas guarda a camada com a fonte que existia ao desenhar; se a JetBrains Mono chegar depois, refaz.
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', () => this.invalidar());
    }
  }

  /** Força o redesenho completo no próximo `desenhar` (use se algo visual mudar fora dos parâmetros dele). */
  invalidar(): void {
    this.versaoFontes++;
    this.ultRelogio = NaN;
  }

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
    const layout = s.layout;
    const vaos = this.vaosDe(layout);

    const camMudou = layout !== this.vistaLayout || cam.escala !== this.vistaEscala
      || cam.offsetX !== this.vistaOffsetX || cam.offsetY !== this.vistaOffsetY
      || width !== this.vistaLargura || height !== this.vistaAltura || this.versaoFontes !== this.vistaFontes;
    const igualAoDesenhado = !camMudou && ctx.miterLimit === SENTINELA && s.locais === this.ultLocais
      && s.relogioSeg === this.ultRelogio && op.heatmap === this.ultHeatmap && op.vaoSelecionado === this.ultSelecao;
    if (igualAoDesenhado) return;

    // câmera igual à do quadro anterior e com rótulos para cachear: usa a camada; senão desenha direto
    const topoEmCamada = !camMudou && cam.escala >= ESCALA_ROTULOS_VAO;
    if (topoEmCamada && this.cacheDesatualizado(layout, cam, width, height)) this.refazerTopo(layout, vaos, cam, width, height);
    this.vistaLayout = layout;
    this.vistaEscala = cam.escala;
    this.vistaOffsetX = cam.offsetX;
    this.vistaOffsetY = cam.offsetY;
    this.vistaLargura = width;
    this.vistaAltura = height;
    this.vistaFontes = this.versaoFontes;

    const px = 1 / cam.escala; // 1 pixel de tela em cm
    const vis = cam.mundoVisivel(width, height);
    const x0 = vis.x;
    const x1 = vis.x + vis.largura;
    const y0 = vis.y;
    const y1 = vis.y + vis.altura;

    this.pintarFundo(ctx, layout, cam, width, height);

    // docas atendendo uma ordem: borda amarela (a doca em si está no fundo)
    this.docasOcupadas.clear();
    for (const d of s.docas) if (d.ocupada) this.docasOcupadas.add(d.localId);
    if (this.docasOcupadas.size > 0) {
      ctx.strokeStyle = COR.docaOcupada;
      ctx.lineWidth = 3 * px;
      for (const d of layout.docas) {
        if (this.docasOcupadas.has(d.localId)) ctx.strokeRect(d.rect.x, d.rect.y + 10, d.rect.largura, d.rect.altura - 20);
      }
    }

    // preenchimento dos vãos (só os visíveis; o máximo do heatmap vale para o armazém todo)
    if (op.heatmap) this.preencherCalor(vaos, s, x0, x1, y0, y1);
    else this.preencherOcupacao(vaos, s, x0, x1, y0, y1);
    ctx.globalAlpha = 1;

    // bordas e rótulos por cima do preenchimento
    if (topoEmCamada) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.topo!, 0, 0);
      ctx.setTransform(cam.escala, 0, 0, cam.escala, cam.offsetX, cam.offsetY);
    } else {
      this.pintarTopo(ctx, layout, vaos, cam, width, height);
    }

    // seleção
    const sel = op.vaoSelecionado ? vaos.find(v => v.chave === op.vaoSelecionado) : undefined;
    if (sel) {
      ctx.strokeStyle = COR.selecao;
      ctx.lineWidth = 3 * px;
      ctx.strokeRect(sel.rect.x, sel.rect.y, sel.rect.largura, sel.rect.altura);
    }

    // equipamentos: vermelho = esperando o corredor (conflito); quadrado branco = carregando palete
    const rotular = cam.escala >= 0.2;
    if (rotular) {
      ctx.font = `${9 * px}px ${FONTE}`;
      ctx.textBaseline = 'middle';
    }
    const r = Math.max(45, 7 * px);
    for (const e of s.equipamentos) {
      ctx.fillStyle = e.estado === 'Aguardando' ? COR.equipamentoEspera : COR.equipamento;
      ctx.beginPath();
      ctx.arc(e.posicao.x, e.posicao.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (e.carga !== null) {
        ctx.fillStyle = COR.carga;
        ctx.fillRect(e.posicao.x - r * 0.45, e.posicao.y - r * 0.45, r * 0.9, r * 0.9);
      }
      if (rotular) {
        ctx.fillStyle = COR.texto;
        ctx.fillText(e.id, e.posicao.x + 60, e.posicao.y - 60);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.miterLimit = SENTINELA;
    this.ultLocais = s.locais;
    this.ultRelogio = s.relogioSeg;
    this.ultHeatmap = op.heatmap;
    this.ultSelecao = op.vaoSelecionado;
  }

  /** Vão sob um ponto do mundo (cm), ou null. */
  vaoEm(layout: Layout, x: number, y: number): Vao | null {
    return this.vaosDe(layout).find(v => x >= v.rect.x && x <= v.rect.x + v.rect.largura
      && y >= v.rect.y && y <= v.rect.y + v.rect.altura) ?? null;
  }

  // ---------------------------------------------------------------- dinâmico

  private preencherOcupacao(vaos: Vao[], s: Snapshot, x0: number, x1: number, y0: number, y1: number): void {
    const { ctx } = this;
    let corAtual = '';
    let alfaAtual = -1;
    for (const v of vaos) {
      const r = v.rect;
      if (r.x > x1 || r.x + r.largura < x0 || r.y > y1 || r.y + r.altura < y0) continue;
      let ocupados = 0;
      for (const a of v.andares) if (s.locais.get(a.localId)?.situacao === 'Ocupado') ocupados++;
      const cor = ocupados === 0 ? COR.vaoVazio : COR.vaoOcupado;
      const alfa = ocupados === 0 ? 1 : 0.35 + 0.65 * (ocupados / v.andares.length);
      if (cor !== corAtual) { ctx.fillStyle = cor; corAtual = cor; }
      if (alfa !== alfaAtual) { ctx.globalAlpha = alfa; alfaAtual = alfa; }
      ctx.fillRect(r.x, r.y, r.largura, r.altura);
    }
  }

  private preencherCalor(vaos: Vao[], s: Snapshot, x0: number, x1: number, y0: number, y1: number): void {
    const { ctx } = this;
    if (this.acessosVao.length !== vaos.length) this.acessosVao = new Int32Array(vaos.length);
    const acessos = this.acessosVao;
    let maximo = 1;
    for (let i = 0; i < vaos.length; i++) {
      let n = 0;
      for (const a of vaos[i].andares) n += s.locais.get(a.localId)?.acessos ?? 0;
      acessos[i] = n;
      if (n > maximo) maximo = n;
    }
    // cor fixa + globalAlpha: o mesmo cálculo de `rgba(239, 68, 68, a)`, sem montar/interpretar uma string por vão
    ctx.fillStyle = COR.vaoCalor;
    for (let i = 0; i < vaos.length; i++) {
      const r = vaos[i].rect;
      if (r.x > x1 || r.x + r.largura < x0 || r.y > y1 || r.y + r.altura < y0) continue;
      ctx.globalAlpha = 0.12 + (acessos[i] / maximo) * 0.8;
      ctx.fillRect(r.x, r.y, r.largura, r.altura);
    }
  }

  // ---------------------------------------------------------------- estático (cache)

  private camada(atual: HTMLCanvasElement | null, largura: number, altura: number): HTMLCanvasElement {
    const c = atual ?? document.createElement('canvas');
    if (c.width !== largura || c.height !== altura) {
      c.width = largura;
      c.height = altura;
    }
    return c;
  }

  private cacheDesatualizado(layout: Layout, cam: Camera, largura: number, altura: number): boolean {
    return layout !== this.cacheLayout || cam.escala !== this.cacheEscala || cam.offsetX !== this.cacheOffsetX
      || cam.offsetY !== this.cacheOffsetY || largura !== this.cacheLargura || altura !== this.cacheAltura
      || this.versaoFontes !== this.cacheFontes;
  }

  private refazerTopo(layout: Layout, vaos: Vao[], cam: Camera, largura: number, altura: number): void {
    this.topo = this.camada(this.topo, largura, altura);
    const t = this.topo.getContext('2d')!;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, largura, altura); // transparente: só bordas e texto, por cima do preenchimento
    t.setTransform(cam.escala, 0, 0, cam.escala, cam.offsetX, cam.offsetY);
    this.pintarTopo(t, layout, vaos, cam, largura, altura);
    this.cacheLayout = layout;
    this.cacheEscala = cam.escala;
    this.cacheOffsetX = cam.offsetX;
    this.cacheOffsetY = cam.offsetY;
    this.cacheLargura = largura;
    this.cacheAltura = altura;
    this.cacheFontes = this.versaoFontes;
  }

  /** Fundo: cor de fundo, piso, corredores e docas. Deixa `c` com a transformação da câmera. */
  private pintarFundo(c: CanvasRenderingContext2D, layout: Layout, cam: Camera, largura: number, altura: number): void {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = COR.fundo;
    c.fillRect(0, 0, largura, altura);
    c.setTransform(cam.escala, 0, 0, cam.escala, cam.offsetX, cam.offsetY);

    c.fillStyle = COR.piso;
    c.fillRect(0, 0, layout.largura, layout.altura);

    // corredores
    c.fillStyle = COR.corredor;
    for (const r of layout.ruas) {
      c.fillRect(r.rect.x, r.corredorY - 60, r.rect.largura, 120);
    }
    c.fillRect(layout.corredorPrincipalX - 60, 0, 120, layout.altura);

    // docas
    for (const d of layout.docas) {
      c.fillStyle = d.tipo === 'Inbound' ? COR.docaIn : COR.docaOut;
      c.fillRect(d.rect.x, d.rect.y + 10, d.rect.largura, d.rect.altura - 20);
    }
  }

  /** Bordas dos vãos e rótulos (vãos, ruas, docas). Espera `c` com a transformação da câmera. */
  private pintarTopo(c: CanvasRenderingContext2D, layout: Layout, vaos: Vao[], cam: Camera, largura: number, altura: number): void {
    const px = 1 / cam.escala;
    const vis = cam.mundoVisivel(largura, altura);
    const x0 = vis.x - FOLGA_CULLING_CM;
    const x1 = vis.x + vis.largura + FOLGA_CULLING_CM;
    const y0 = vis.y - FOLGA_CULLING_CM;
    const y1 = vis.y + vis.altura + FOLGA_CULLING_CM;
    const visivel = (r: Retangulo) => !(r.x > x1 || r.x + r.largura < x0 || r.y > y1 || r.y + r.altura < y0);

    // bordas dos vãos
    c.strokeStyle = COR.bordaVao;
    c.lineWidth = px;
    for (const v of vaos) {
      if (visivel(v.rect)) c.strokeRect(v.rect.x, v.rect.y, v.rect.largura, v.rect.altura);
    }

    // rótulo da doca só se couber nela (no WH-B enquadrado a doca tem ~50 px)
    c.textBaseline = 'middle';
    for (const d of layout.docas) {
      const entrada = d.tipo === 'Inbound';
      const larguraPx = d.rect.largura * cam.escala;
      if (larguraPx < 36) continue;
      const rotulo = larguraPx >= 90 ? `${entrada ? 'DOCA IN' : 'DOCA OUT'} ${d.numero}` : `${entrada ? 'IN' : 'OUT'} ${d.numero}`;
      c.font = `${Math.min(12, larguraPx / 5) * px}px ${FONTE}`;
      c.fillStyle = entrada ? COR.docaInTexto : COR.docaOutTexto;
      c.fillText(rotulo, d.rect.x + 6 * px, d.rect.y + d.rect.altura / 2);
    }

    // rótulos (só com zoom suficiente para ler)
    c.fillStyle = COR.texto;
    if (cam.escala >= ESCALA_ROTULOS_VAO) {
      c.font = `${9 * px}px ${FONTE}`;
      for (const v of vaos) {
        if (visivel(v.rect)) c.fillText(v.rotulo, v.rect.x + 8, v.rect.y + v.rect.altura / 2);
      }
    } else if (cam.escala >= 0.05) {
      // código da rua dentro da rack, à direita da última posição (fora do caminho dos equipamentos)
      c.font = `${10 * px}px ${FONTE}`;
      for (const r of layout.ruas) {
        c.fillText(r.codigo, r.rect.x + r.rect.largura + 6 * px, r.rect.y + r.rect.altura / 2);
      }
    }
  }
}
