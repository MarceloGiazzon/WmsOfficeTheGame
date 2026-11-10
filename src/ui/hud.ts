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
  private readonly concluidas = el('kpi-done');
  private readonly distancia = el('kpi-distance');
  private readonly conflitos = el('kpi-conflicts');
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
    this.concluidas.textContent = `${s.ordensConcluidas} / ${s.metricas.ordensAtrasadas}`;
    this.distancia.textContent = `${(s.metricas.distanciaRealCm / 100_000).toFixed(2).replace('.', ',')} km`;
    this.conflitos.textContent = String(s.metricas.eventosConflito);
    this.ocupacao.textContent = `${(s.ocupacaoCentesimos / 100).toFixed(0)}%`;
    // parcial durante o turno (a distância teórica é a do turno todo); oficial quando `terminado`
    this.score.textContent = s.score.sucesso ? (s.score.scoreCentesimos / 100).toFixed(1).replace('.', ',') : '—';
    this.score.title = s.terminado ? 'Score final do turno' : 'Score parcial: muda até o fim do turno';
  }
}
