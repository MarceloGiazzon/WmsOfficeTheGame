// Drawer inferior: cenário, política e log operacional.

import { POLITICAS, type Politica } from '../sim/model';
import { formatarHora, type Evento } from '../sim/simulation';

const ROTULO_POLITICA: Record<Politica, string> = {
  AbcProximidade: 'Curva ABC por proximidade da doca',
  FifoPrimeiraLivre: 'FIFO + primeira posição livre',
  Consolidacao: 'Consolidação de lote/produto',
  CrossDocking: 'Cross-docking (doca a doca)',
  WmsReal: 'WmsOffice real (regras do WMS)',
};

export class Drawer {
  private readonly politica = document.getElementById('select-policy') as HTMLSelectElement;
  private readonly cenario = document.getElementById('select-scenario') as HTMLSelectElement;
  private readonly log = document.getElementById('sim-events-log')!;
  private ultimoEvento: Readonly<Evento> | undefined;

  constructor(cenarios: string[], aoMudarPolitica: (p: Politica) => void, aoMudarCenario: (codigo: string) => void) {
    this.politica.replaceChildren(...POLITICAS.map(p => new Option(ROTULO_POLITICA[p], p)));
    this.cenario.replaceChildren(...cenarios.map(c => new Option(c, c)));
    this.politica.addEventListener('change', () => aoMudarPolitica(this.politica.value as Politica));
    this.cenario.addEventListener('change', () => aoMudarCenario(this.cenario.value));
    document.getElementById('drawer-toggle')?.addEventListener('click', () => {
      document.getElementById('strategy-drawer')?.classList.toggle('collapsed');
    });
  }

  selecionar(cenario: string, politica: Politica): void {
    this.cenario.value = cenario;
    this.politica.value = politica;
  }

  /** Redesenha o log só quando chega evento novo. */
  atualizarLog(eventos: readonly Readonly<Evento>[]): void {
    if (eventos[0] === this.ultimoEvento) return;
    this.ultimoEvento = eventos[0];
    this.log.replaceChildren(...eventos.slice(0, 50).map(e => {
      const li = document.createElement('li');
      li.textContent = `[${formatarHora(e.seg)}] ${e.texto}`;
      return li;
    }));
  }
}
