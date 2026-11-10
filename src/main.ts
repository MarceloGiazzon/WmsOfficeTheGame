// Bootstrap: liga sim (estado) → render (canvas) → ui (DOM). Cada camada só conhece a de baixo.
//
//   requestAnimationFrame ─► Relogio.avancar(dt) ─► n × Simulacao.tick()
//                         └► Renderer.desenhar(snapshot)  +  Hud/Drawer.atualizar(snapshot)

import { Relogio } from './app/relogio';
import { Camera } from './render/camera';
import { Cadencia, INTERVALO_UI_MS } from './render/cadencia';
import { ligarEntrada } from './render/input';
import { Perfil } from './render/perf';
import { Renderer } from './render/renderer';
import type { PacoteCenario, Politica } from './sim/model';
import { Simulacao } from './sim/simulation';
import { Drawer } from './ui/drawer';
import { Hud } from './ui/hud';
import { Inspector } from './ui/inspector';

// Pacotes offline gerados dos seeds do backend (backend/npdev/tools/gerar_pacotes_front.py).
// F5 troca esta fonte pelo backend (com cache para offline).
const CENARIOS: Record<string, () => Promise<{ default: unknown }>> = {
  'WH-A-PEQUENO': () => import('./data/cenarios/WH-A-PEQUENO.json'),
  'WH-B-MEGA': () => import('./data/cenarios/WH-B-MEGA.json'),
};

class Jogo {
  private readonly canvas = document.getElementById('warehouse-canvas') as HTMLCanvasElement;
  private readonly renderer = new Renderer(this.canvas.getContext('2d')!);
  private readonly camera = new Camera();
  private readonly relogio = new Relogio();
  private sim: Simulacao | null = null;
  private politica: Politica = 'AbcProximidade';
  private heatmap = false;
  private vaoSelecionado: string | null = null;
  private ultimoFrame = 0;
  // DOM (HUD, log) a ~10 Hz e só quando o relógio andou; o canvas continua a cada quadro (F6)
  private readonly cadenciaHud = new Cadencia(INTERVALO_UI_MS);
  private readonly cadenciaLog = new Cadencia(INTERVALO_UI_MS);
  private readonly perf = Perfil.daUrl(); // só com ?perf=1

  private readonly hud = new Hud(v => { this.relogio.velocidade = v; });
  private readonly inspector = new Inspector(() => { this.vaoSelecionado = null; });
  private readonly drawer = new Drawer(
    Object.keys(CENARIOS),
    p => { this.politica = p; this.sim?.setPolitica(p); },
    c => void this.carregar(c),
  );

  async iniciar(): Promise<void> {
    this.redimensionar();
    // o canvas acompanha o tamanho do container (janela, drawer, fonte que chega e muda o cabeçalho), não só a janela
    new ResizeObserver(() => this.redimensionar()).observe(this.canvas.parentElement!);
    ligarEntrada(this.canvas, this.camera, {
      aoClicar: p => this.clicar(p.x, p.y),
      alvoDuploClique: p => this.centroDoVao(p),
    });
    const centro = () => ({ x: this.canvas.width / 2, y: this.canvas.height / 2 });
    document.getElementById('btn-zoom-in')!.addEventListener('click', () => this.camera.zoom(1.25, centro()));
    document.getElementById('btn-zoom-out')!.addEventListener('click', () => this.camera.zoom(1 / 1.25, centro()));
    document.getElementById('btn-reset-cam')!.addEventListener('click', () => this.enquadrar());
    document.getElementById('btn-toggle-heatmap')!.addEventListener('click', () => { this.heatmap = !this.heatmap; });
    this.hud.marcarVelocidade(this.relogio.velocidade);

    await this.carregar('WH-A-PEQUENO');
    requestAnimationFrame(this.frame);
  }

  private async carregar(codigo: string): Promise<void> {
    const pacote = (await CENARIOS[codigo]()).default as PacoteCenario;
    this.sim = new Simulacao(pacote, this.politica);
    this.vaoSelecionado = null;
    this.inspector.esconder();
    this.drawer.selecionar(codigo, this.politica);
    this.enquadrar();
  }

  private frame = (agora: number): void => {
    const dt = this.ultimoFrame ? agora - this.ultimoFrame : 0;
    this.ultimoFrame = agora;
    const sim = this.sim;
    const perf = this.perf;
    perf?.inicio(agora);
    let ticks = 0;
    if (sim) {
      ticks = this.relogio.avancar(dt);
      for (let i = 0; i < ticks && !sim.terminado; i++) sim.tick();
      perf?.fase('sim');
      const s = sim.snapshot();
      this.renderer.desenhar(s, this.camera, { heatmap: this.heatmap, vaoSelecionado: this.vaoSelecionado });
      perf?.fase('desenho');
      if (this.cadenciaHud.pronto(agora, s.layout, s.relogioSeg)) this.hud.atualizar(s);
      if (this.cadenciaLog.pronto(agora)) this.drawer.atualizarLog(s.eventos); // ela mesma só refaz o DOM se há evento novo
      perf?.fase('ui');
    }
    perf?.fim(ticks);
    requestAnimationFrame(this.frame);
  };

  private clicar(x: number, y: number): void {
    if (!this.sim) return;
    const s = this.sim.snapshot();
    const vao = this.renderer.vaoEm(s.layout, x, y);
    this.vaoSelecionado = vao?.chave ?? null;
    if (vao) this.inspector.mostrar(vao, s, this.sim.pacote);
    else this.inspector.esconder();
  }

  /** Alvo do duplo clique: o centro do vão sob o ponto (ou o próprio ponto, no chão). */
  private centroDoVao(p: { x: number; y: number }): { x: number; y: number } {
    const vao = this.sim ? this.renderer.vaoEm(this.sim.layout, p.x, p.y) : null;
    return vao ? { x: vao.rect.x + vao.rect.largura / 2, y: vao.rect.y + vao.rect.altura / 2 } : p;
  }

  private redimensionar(): void {
    const pai = this.canvas.parentElement!;
    const { clientWidth: w, clientHeight: h } = pai;
    if (w === this.canvas.width && h === this.canvas.height) return; // mexer em width/height limpa o canvas
    // o centro da vista fica onde está (celular girando, drawer abrindo/fechando)
    if (this.canvas.width > 0) this.camera.mover((w - this.canvas.width) / 2, (h - this.canvas.height) / 2);
    this.canvas.width = w;
    this.canvas.height = h;
  }

  private enquadrar(): void {
    if (!this.sim) return;
    this.camera.enquadrar(this.sim.layout.largura, this.sim.layout.altura, this.canvas.width, this.canvas.height);
  }
}

void new Jogo().iniciar();
