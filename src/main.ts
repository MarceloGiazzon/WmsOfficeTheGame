import { WarehouseEngine } from './game/WarehouseEngine';
import { NPDevClient } from './services/npdevClient';
import { LocalArmazenagem, PoliticaAlocacao } from './models/types';

class GameController {
  private engine!: WarehouseEngine;
  private client: NPDevClient = new NPDevClient();
  private speed: number = 1.0;
  private simulatedSeconds: number = 8 * 3600;

  constructor() {
    window.addEventListener('DOMContentLoaded', () => this.init());
  }

  private init() {
    const canvas = document.getElementById('warehouse-canvas') as HTMLCanvasElement;
    this.engine = new WarehouseEngine(canvas, (l) => this.showInspector(l));

    const speeds = [
      { id: 'btn-pause', v: 0 }, { id: 'btn-play-1x', v: 1 },
      { id: 'btn-play-2x', v: 2 }, { id: 'btn-play-5x', v: 5 }
    ];
    speeds.forEach(s => {
      document.getElementById(s.id)?.addEventListener('click', () => {
        speeds.forEach(b => document.getElementById(b.id)?.classList.remove('active'));
        document.getElementById(s.id)?.classList.add('active');
        this.speed = s.v;
      });
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.engine.zoom(0.2));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.engine.zoom(-0.2));
    document.getElementById('btn-reset-cam')?.addEventListener('click', () => this.engine.resetCamera());
    document.getElementById('btn-toggle-heatmap')?.addEventListener('click', () => this.engine.toggleHeatmap());
    document.getElementById('inspector-close')?.addEventListener('click', () => {
      document.getElementById('inspector-card')?.classList.add('hidden');
    });

    document.getElementById('btn-inject-batch')?.addEventListener('click', async () => {
      this.log('Novo lote de NF-e injetado na Doca 01.');
      await this.client.injetarLoteNotasFiscais('warehouse-a-small');
    });

    document.getElementById('select-policy')?.addEventListener('change', async (e) => {
      const val = (e.target as HTMLSelectElement).value as PoliticaAlocacao;
      this.log(`Política alterada: ${val}`);
      await this.client.atualizarPolitica(val);
    });

    setInterval(() => {
      if (this.speed > 0) {
        this.simulatedSeconds += this.speed;
        this.engine.update(this.speed);
        const clock = document.getElementById('kpi-clock');
        if (clock) clock.innerText = this.formatTime(this.simulatedSeconds);
      }
    }, 1000 / 30);
  }

  private showInspector(local: LocalArmazenagem) {
    const card = document.getElementById('inspector-card');
    card?.classList.remove('hidden');
    (document.getElementById('inspector-title') as HTMLElement).innerText = `Posição: ${local.codigo}`;
    (document.getElementById('inspector-rua') as HTMLElement).innerText = local.ruaNome;
    (document.getElementById('inspector-produto') as HTMLElement).innerText = local.produtoNome || 'Livre';
    (document.getElementById('inspector-abc') as HTMLElement).innerText = `Classe ${local.classeABC || 'N/A'}`;
    (document.getElementById('inspector-pickings') as HTMLElement).innerText = `${local.acessosPicking} ciclos`;
  }

  private log(msg: string) {
    const ul = document.getElementById('sim-events-log');
    if (!ul) return;
    const li = document.createElement('li');
    li.innerText = `[${this.formatTime(this.simulatedSeconds)}] ${msg}`;
    ul.prepend(li);
  }

  private formatTime(s: number) {
    const h = String(Math.floor(s / 3600) % 24).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }
}

new GameController();
