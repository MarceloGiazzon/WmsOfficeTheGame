// Medidor leve, ligado com `?perf=1` na URL: mostra no canto da tela quadros/s e quanto cada fase do quadro custa
// (sim, desenho, UI). Serve para medir em aparelho de verdade (celular/APK), onde não há como rodar o puppeteer.
// Sem `?perf=1` o jogo nem instancia isto (main guarda `null` e cada chamada é um `?.` que não faz nada).
// Os números mais recentes também ficam em `window.__perfil` (leitura por script).

export type Fase = 'sim' | 'desenho' | 'ui';
const FASES: Fase[] = ['sim', 'desenho', 'ui'];
const JANELA_MS = 500;

export interface ResumoPerfil {
  fps: number;
  /** ms médios por quadro, por fase (só o JS: o raster do canvas acontece depois, fora do alcance do JS) */
  ms: Record<Fase, number>;
  total: number;
  ticksPorSeg: number;
}

export class Perfil {
  private readonly el: HTMLElement;
  private quadros = 0;
  private ticks = 0;
  private inicioJanela = 0;
  private marcaQuadro = 0;
  private readonly soma: Record<Fase, number> = { sim: 0, desenho: 0, ui: 0 };

  private constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;padding:4px 8px;border-radius:4px;'
      + 'background:rgba(0,0,0,.75);color:#a7f3d0;font:11px/1.3 monospace;pointer-events:none;white-space:pre';
    document.body.appendChild(this.el);
  }

  /** Instancia só se a URL tiver `perf=1`. */
  static daUrl(): Perfil | null {
    return new URLSearchParams(location.search).get('perf') === '1' ? new Perfil() : null;
  }

  inicio(agoraMs: number): void {
    if (this.inicioJanela === 0) this.inicioJanela = agoraMs;
    this.marcaQuadro = performance.now();
    this.quadros++;
    if (agoraMs - this.inicioJanela >= JANELA_MS) this.fecharJanela(agoraMs);
  }

  /** Atribui à `fase` o tempo desde a marca anterior. */
  fase(f: Fase): void {
    const t = performance.now();
    this.soma[f] += t - this.marcaQuadro;
    this.marcaQuadro = t;
  }

  fim(ticks: number): void {
    this.ticks += ticks;
  }

  private fecharJanela(agoraMs: number): void {
    const seg = (agoraMs - this.inicioJanela) / 1000;
    const n = Math.max(1, this.quadros);
    const ms = { sim: this.soma.sim / n, desenho: this.soma.desenho / n, ui: this.soma.ui / n };
    const r: ResumoPerfil = {
      fps: this.quadros / seg, ms, total: ms.sim + ms.desenho + ms.ui, ticksPorSeg: this.ticks / seg,
    };
    (window as unknown as { __perfil: ResumoPerfil }).__perfil = r;
    const f = (x: number) => x.toFixed(2);
    this.el.textContent = `${r.fps.toFixed(0)} fps · JS ${f(r.total)} ms/quadro\n`
      + `sim ${f(ms.sim)} · desenho ${f(ms.desenho)} · ui ${f(ms.ui)}\n${r.ticksPorSeg.toFixed(0)} ticks/s`;
    this.quadros = 0;
    this.ticks = 0;
    this.inicioJanela = agoraMs;
    for (const k of FASES) this.soma[k] = 0;
  }
}
