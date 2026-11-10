// Drawer inferior: política (trocável durante o turno), cenário e log operacional.

import { ROTULO_DIFICULDADE } from '../app/fonteCenarios';
import { TEXTO_POLITICA } from '../app/politicasTexto';
import { POLITICAS, type Cenario, type Politica } from '../sim/model';
import { formatarHora, type Evento, type Snapshot } from '../sim/simulation';
import { definirTexto, el } from './dom';

export class Drawer {
  private readonly politica = el<HTMLSelectElement>('select-policy');
  private readonly regra = el('policy-regra');
  private readonly feedback = el('policy-feedback');
  private readonly cenarioInfo = el('cenario-info');
  private readonly log = el('sim-events-log');
  private readonly alca = el('drawer-toggle');
  private readonly gaveta = el('strategy-drawer');
  private ultimoEvento: Readonly<Evento> | undefined;

  constructor(aoMudarPolitica: (p: Politica) => void, aoTrocarCenario: () => void) {
    this.politica.replaceChildren(...POLITICAS.map(p => new Option(TEXTO_POLITICA[p].rotulo, p)));
    this.politica.addEventListener('change', () => aoMudarPolitica(this.politica.value as Politica));
    el('btn-trocar-cenario').addEventListener('click', aoTrocarCenario);
    this.alca.addEventListener('click', () => this.recolher(!this.gaveta.classList.contains('collapsed')));
    // No celular a gaveta começa recolhida: o mapa precisa do espaço, e a política ativa já aparece no HUD.
    if (window.matchMedia('(max-width: 900px)').matches) this.recolher(true);
  }

  private recolher(sim: boolean): void {
    this.gaveta.classList.toggle('collapsed', sim);
    this.alca.setAttribute('aria-expanded', String(!sim));
  }

  /** Abre a gaveta e leva o foco ao seletor (o chip "Política ativa" do HUD chama isto). */
  abrirPolitica(): void {
    this.recolher(false);
    this.politica.focus();
  }

  definirCenario(c: Cenario): void {
    definirTexto(this.cenarioInfo, `${c.nome} (${c.codigo}) · ${ROTULO_DIFICULDADE[c.dificuldade]}`);
  }

  /** Mantém o seletor e a descrição iguais à política ativa da sim (a sim é a fonte da verdade). */
  atualizar(s: Snapshot, emPartida: boolean): void {
    if (this.politica.value !== s.politica) this.politica.value = s.politica;
    definirTexto(this.regra, TEXTO_POLITICA[s.politica].regra);
    // sem partida em curso (ou com o turno encerrado) não há mais alocação para a troca afetar
    this.politica.disabled = !emPartida || s.terminado;
  }

  /** Feedback da troca ao lado do seletor (o log da sim registra a mesma troca com o horário). */
  avisarTroca(seg: number, politica: Politica): void {
    definirTexto(this.feedback, `${formatarHora(seg)} — política trocada para ${TEXTO_POLITICA[politica].rotulo}. ` +
      'Vale para os próximos paletes guardados; os que já estão a caminho seguem como estavam.');
  }

  limparAviso(): void {
    definirTexto(this.feedback, '');
  }

  /** Redesenha o log só quando chega evento novo. */
  atualizarLog(eventos: readonly Readonly<Evento>[]): void {
    if (eventos[0] === this.ultimoEvento) return;
    this.ultimoEvento = eventos[0];
    this.log.replaceChildren(...eventos.slice(0, 50).map(e => {
      const li = document.createElement('li');
      li.textContent = `[${formatarHora(e.seg)}] ${e.texto}`;
      if (e.texto.startsWith('Política alterada')) li.className = 'log-politica';
      return li;
    }));
  }
}
