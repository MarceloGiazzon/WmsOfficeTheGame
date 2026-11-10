import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { PacoteCenario } from '../sim/model';
import { Simulacao } from '../sim/simulation';
import { Camera } from './camera';
import { Renderer } from './renderer';

// Um CanvasRenderingContext2D de mentira: conta as chamadas e guarda as propriedades que o render escreve.
// Basta para testar QUANDO o render desenha e ONDE (canvas principal × camada auxiliar), sem navegador.
class CtxFalso {
  chamadas: Record<string, number> = {};
  /** Argumentos de cada chamada (só dos métodos que os testes de dpr conferem). */
  args: Record<string, number[][]> = {};
  miterLimit = 10; // padrão do canvas: é o que o render usa para detectar que o canvas foi limpo
  constructor(readonly canvas: { width: number; height: number }) {
    return new Proxy(this, {
      get: (alvo, prop: string) => {
        if (prop in alvo) return (alvo as unknown as Record<string, unknown>)[prop];
        return (...a: number[]) => {
          alvo.chamadas[prop] = (alvo.chamadas[prop] ?? 0) + 1;
          if (prop === 'setTransform' || prop === 'fillRect') (alvo.args[prop] ??= []).push(a);
        };
      },
    });
  }
  zerar(): void { this.chamadas = {}; this.args = {}; }
  total(): number { return Object.values(this.chamadas).reduce((a, b) => a + b, 0); }
}

const LARGURA = 1000;
const ALTURA = 600;

interface Ambiente { ctx: CtxFalso; camadas: CtxFalso[]; sim: Simulacao; renderer: Renderer; cam: Camera; principal: { width: number; height: number }; }

function montar(): Ambiente {
  const camadas: CtxFalso[] = [];
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ctxCamada };
      const ctxCamada = new CtxFalso(canvas);
      camadas.push(ctxCamada);
      return canvas;
    },
  };
  const principal = { width: LARGURA, height: ALTURA };
  const ctx = new CtxFalso(principal);
  const sim = new Simulacao(whA as unknown as PacoteCenario, 'AbcProximidade');
  const cam = new Camera();
  cam.enquadrar(sim.layout.largura, sim.layout.altura, LARGURA, ALTURA);
  return { ctx, camadas, sim, renderer: new Renderer(ctx as unknown as CanvasRenderingContext2D), cam, principal };
}

describe('Renderer: quadros idênticos', () => {
  let a: Ambiente;
  beforeEach(() => { a = montar(); });
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });

  const desenhar = (opcoes = { heatmap: false, vaoSelecionado: null as string | null }) =>
    a.renderer.desenhar(a.sim.snapshot(), a.cam, opcoes);

  it('o primeiro quadro desenha; o segundo, igual, não toca no canvas', () => {
    desenhar();
    expect(a.ctx.total()).toBeGreaterThan(0);
    a.ctx.zerar();
    desenhar();
    desenhar();
    expect(a.ctx.total()).toBe(0);
  });

  it('desenha de novo quando a sim avança, a câmera mexe, o heatmap liga ou a seleção muda', () => {
    desenhar();
    for (const mudanca of [
      () => a.sim.tick(),
      () => a.cam.mover(5, 0),
      () => a.cam.zoom(1.1, { x: 100, y: 100 }),
    ]) {
      a.ctx.zerar();
      mudanca();
      desenhar();
      expect(a.ctx.total()).toBeGreaterThan(0);
    }
    a.ctx.zerar();
    desenhar({ heatmap: true, vaoSelecionado: null });
    expect(a.ctx.total()).toBeGreaterThan(0);
    a.ctx.zerar();
    desenhar({ heatmap: true, vaoSelecionado: a.renderer.vaosDe(a.sim.layout)[0].chave });
    expect(a.ctx.total()).toBeGreaterThan(0);
  });

  it('canvas limpo pelo navegador (width = width reinicia o estado do contexto) força o redesenho', () => {
    desenhar();
    a.ctx.zerar();
    a.ctx.miterLimit = 10; // o que o navegador faz ao limpar o canvas
    desenhar();
    expect(a.ctx.total()).toBeGreaterThan(0);
  });

  it('invalidar() força o redesenho (ex.: a fonte dos rótulos chegou)', () => {
    desenhar();
    a.ctx.zerar();
    a.renderer.invalidar();
    desenhar();
    expect(a.ctx.total()).toBeGreaterThan(0);
  });

  it('simulação nova com o mesmo relógio também redesenha', () => {
    desenhar();
    a.ctx.zerar();
    a.sim = new Simulacao(whA as unknown as PacoteCenario, 'FifoPrimeiraLivre');
    desenhar();
    expect(a.ctx.total()).toBeGreaterThan(0);
  });
});

describe('Renderer: camada de bordas e rótulos', () => {
  let a: Ambiente;
  beforeEach(() => { a = montar(); });
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });

  const quadro = () => { a.sim.tick(); a.renderer.desenhar(a.sim.snapshot(), a.cam, { heatmap: false, vaoSelecionado: null }); };

  it('com zoom de rótulos, a câmera mexendo desenha direto e a câmera parada usa a camada', () => {
    a.cam.escala = 0.6;
    quadro();
    expect(a.camadas).toHaveLength(0); // 1º quadro: câmera mudou desde "nada" → direto
    expect(a.ctx.chamadas.strokeRect).toBeGreaterThan(0);
    a.ctx.zerar();
    quadro(); // câmera igual à do quadro anterior → monta a camada e a copia
    expect(a.camadas).toHaveLength(1);
    expect(a.camadas[0].chamadas.strokeRect).toBeGreaterThan(0);
    expect(a.camadas[0].chamadas.fillText).toBeGreaterThan(0);
    expect(a.ctx.chamadas.drawImage).toBe(1);
    expect(a.ctx.chamadas.strokeRect ?? 0).toBeLessThanOrEqual(1); // só a seleção/docas, nada de bordas de vão
    a.ctx.zerar();
    a.camadas[0].zerar();
    quadro(); // outro quadro, mesma câmera: a camada é reaproveitada, não redesenhada
    expect(a.camadas[0].total()).toBe(0);
    expect(a.ctx.chamadas.drawImage).toBe(1);
    a.cam.mover(10, 0);
    a.ctx.zerar();
    quadro(); // câmera mexeu: volta a desenhar direto
    expect(a.ctx.chamadas.drawImage ?? 0).toBe(0);
    expect(a.ctx.chamadas.strokeRect).toBeGreaterThan(0);
  });

  it('com a câmera parada, mudar o zoom refaz a camada na próxima parada', () => {
    a.cam.escala = 0.6;
    quadro();
    quadro();
    a.camadas[0].zerar();
    a.cam.zoom(1.2, { x: 300, y: 200 });
    quadro(); // direto
    expect(a.camadas[0].total()).toBe(0);
    quadro(); // parada de novo → refaz a camada
    expect(a.camadas[0].chamadas.strokeRect).toBeGreaterThan(0);
  });

  it('sem zoom de rótulos (enquadrado) não usa camada', () => {
    a.cam.escala = 0.1;
    quadro();
    quadro();
    quadro();
    expect(a.camadas).toHaveLength(0);
    expect(a.ctx.chamadas.drawImage ?? 0).toBe(0);
  });
});

describe('Renderer: culling', () => {
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });

  it('com zoom, só os vãos visíveis são preenchidos', () => {
    const a = montar();
    const vaos = a.renderer.vaosDe(a.sim.layout);
    a.renderer.desenhar(a.sim.snapshot(), a.cam, { heatmap: false, vaoSelecionado: null });
    const enquadrado = a.ctx.chamadas.fillRect;
    a.cam.escala = 1;
    a.cam.offsetX = -a.sim.layout.corredorPrincipalX; // mostra só o começo das ruas
    a.cam.offsetY = 0;
    a.ctx.zerar();
    a.renderer.desenhar(a.sim.snapshot(), a.cam, { heatmap: false, vaoSelecionado: null });
    expect(a.ctx.chamadas.fillRect).toBeLessThan(enquadrado);
    expect(vaos.length).toBeGreaterThan(40);
  });
});

describe('Renderer: alta densidade (dpr)', () => {
  let a: Ambiente;
  beforeEach(() => { a = montar(); });
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });

  const desenhar = () => a.renderer.desenhar(a.sim.snapshot(), a.cam, { heatmap: false, vaoSelecionado: null });
  /** O canvas com dpr tem `CSS × dpr` px: aqui o "CSS" é LARGURA × ALTURA e o bitmap cresce. */
  const comDpr = (dpr: number) => {
    a.principal.width = Math.round(LARGURA * dpr);
    a.principal.height = Math.round(ALTURA * dpr);
    a.renderer.dpr = dpr;
  };
  const transformacoesDeMundo = () => (a.ctx.args.setTransform ?? []).filter(t => t[0] !== 1 || t[3] !== 1);

  it('a transformação do mundo é escala da câmera × dpr e offset × dpr (a câmera continua em px de CSS)', () => {
    comDpr(2);
    desenhar();
    const t = transformacoesDeMundo()[0];
    expect(t[0]).toBeCloseTo(a.cam.escala * 2);
    expect(t[3]).toBeCloseTo(a.cam.escala * 2);
    expect(t[4]).toBeCloseTo(a.cam.offsetX * 2);
    expect(t[5]).toBeCloseTo(a.cam.offsetY * 2);
  });

  it('o fundo preenche o bitmap inteiro (px de dispositivo), não só a área de CSS', () => {
    comDpr(3);
    desenhar();
    expect(a.ctx.args.fillRect[0]).toEqual([0, 0, LARGURA * 3, ALTURA * 3]);
  });

  it('bordas e fontes mantêm o tamanho visual: a espessura em cm é 1 px de CSS, igual com qualquer dpr', () => {
    // lineWidth está em cm do mundo; × escala × dpr dá a espessura em px de dispositivo = dpr px = 1 px de CSS
    for (const dpr of [1, 2, 3]) {
      const b = montar();
      b.principal.width = LARGURA * dpr;
      b.principal.height = ALTURA * dpr;
      b.renderer.dpr = dpr;
      b.cam.escala = 0.6; // com rótulos e vãos grandes
      b.renderer.desenhar(b.sim.snapshot(), b.cam, { heatmap: false, vaoSelecionado: b.renderer.vaosDe(b.sim.layout)[0].chave });
      const k = b.ctx.args.setTransform.find(t => t[0] !== 1)![0];
      const lineWidth = (b.ctx as unknown as { lineWidth: number }).lineWidth; // última: a seleção (3 px de CSS)
      expect(lineWidth * k).toBeCloseTo(3 * dpr);
    }
  });

  it('mudar o dpr força o redesenho completo, mesmo com o resto igual', () => {
    desenhar();
    a.ctx.zerar();
    desenhar();
    expect(a.ctx.total()).toBe(0); // quadro idêntico: nada
    comDpr(2);
    desenhar();
    expect(a.ctx.total()).toBeGreaterThan(0);
  });

  it('a camada de bordas e rótulos é refeita quando o dpr muda', () => {
    a.cam.escala = 0.6;
    const quadro = () => { a.sim.tick(); desenhar(); };
    quadro();
    quadro(); // câmera parada: monta a camada
    expect(a.camadas).toHaveLength(1);
    const camada = a.camadas[0];
    camada.zerar();
    comDpr(2);
    quadro(); // dpr mudou: direto
    quadro(); // parada de novo: refaz a camada, agora com a transformação ×2
    const t = (camada.args.setTransform ?? []).find(x => x[0] !== 1)!;
    expect(t[0]).toBeCloseTo(0.6 * 2);
  });

  it('culling usa a área de CSS (bitmap ÷ dpr), não o bitmap', () => {
    // mesma vista em CSS: com dpr 2 o número de preenchimentos tem de ser o mesmo que com dpr 1
    const pintar = (dpr: number) => {
      const b = montar();
      b.principal.width = LARGURA * dpr;
      b.principal.height = ALTURA * dpr;
      b.renderer.dpr = dpr;
      Object.assign(b.cam, { escala: 1, offsetX: -b.sim.layout.corredorPrincipalX, offsetY: 0 });
      b.renderer.desenhar(b.sim.snapshot(), b.cam, { heatmap: false, vaoSelecionado: null });
      return b.ctx.chamadas.fillRect;
    };
    expect(pintar(2)).toBe(pintar(1));
    expect(pintar(3)).toBe(pintar(1));
  });
});
