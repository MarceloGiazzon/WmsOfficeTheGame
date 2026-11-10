// HUD superior: relógio, KPIs e controles de velocidade.

import type { Velocidade } from '../app/relogio';
import { formatarHora, type Snapshot } from '../sim/simulation';

const BOTOES_VELOCIDADE: { id: string; v: Velocidade }[] = [
  { id: 'btn-pause', v: 0 }, { id: 'btn-play-1x', v: 1 }, { id: 'btn-play-2x', v: 2 }, { id: 'btn-play-5x', v: 5 },
];

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`elemento #${id} ausente no index.html`);
  return e;
}

export class Hud {
  private readonly relogio = el('kpi-clock');
  private readonly ordens = el('kpi-orders');
  private readonly ocupacao = el('kpi-occupancy');
  private readonly score = el('kpi-score');

  constructor(aoMudarVelocidade: (v: Velocidade) => void) {
    for (const b of BOTOES_VELOCIDADE) {
      el(b.id).addEventListener('click', () => {
        this.marcarVelocidade(b.v);
        aoMudarVelocidade(b.v);
      });
    }
  }

  marcarVelocidade(v: Velocidade): void {
    for (const b of BOTOES_VELOCIDADE) el(b.id).classList.toggle('active', b.v === v);
  }

  atualizar(s: Snapshot): void {
    this.relogio.textContent = formatarHora(s.relogioSeg) + (s.terminado ? ' ■' : '');
    this.ordens.textContent = `${s.ordensLiberadas}/${s.ordensTotal}`;
    this.ocupacao.textContent = `${(s.ocupacaoCentesimos / 100).toFixed(0)}%`;
    this.score.textContent = '—'; // F2: métricas reais da partida
  }
}
