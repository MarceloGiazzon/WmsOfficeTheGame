// Bootstrap: liga sim (estado) → render (canvas) → ui (DOM). Cada camada só conhece a de baixo.
//
//   requestAnimationFrame ─► Relogio.avancar(dt) ─► n × Simulacao.tick()
//                         └► Renderer.desenhar(snapshot)  +  Hud/Drawer.atualizar(snapshot)

import { Relogio } from './app/relogio';
import { Camera } from './render/camera';
import { ligarEntrada } from './render/input';
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

  private readonly hud = new Hud(v => { this.relogio.velocidade = v; });
  private readonly inspector = new Inspector(() => { this.vaoSelecionado = null; });
  private readonly drawer = new Drawer(
    Object.keys(CENARIOS),
    p => { this.politica = p; this.sim?.setPolitica(p); },
    c => void this.carregar(c),
  );

  async iniciar(): Promise<void> {
    this.redimensionar();
    window.addEventListener('resize', () => this.redimensionar());
    ligarEntrada(this.canvas, this.camera, p => this.clicar(p.x, p.y));
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
    if (sim) {
      const ticks = this.relogio.avancar(dt);
      for (let i = 0; i < ticks && !sim.terminado; i++) sim.tick();
      const s = sim.snapshot();
      this.renderer.desenhar(s, this.camera, { heatmap: this.heatmap, vaoSelecionado: this.vaoSelecionado });
      this.hud.atualizar(s);
      this.drawer.atualizarLog(s.eventos);
    }
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

  private redimensionar(): void {
    const pai = this.canvas.parentElement!;
    this.canvas.width = pai.clientWidth;
    this.canvas.height = pai.clientHeight;
  }

  private enquadrar(): void {
    if (!this.sim) return;
    this.camera.enquadrar(this.sim.layout.largura, this.sim.layout.altura, this.canvas.width, this.canvas.height);
  }
}

void new Jogo().iniciar();
