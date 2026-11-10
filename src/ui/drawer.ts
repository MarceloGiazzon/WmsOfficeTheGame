// Drawer inferior: política (trocável durante o turno), cenário e log operacional.
// No desktop é uma faixa fixa abaixo do mapa. No celular (layout compacto, ver mobile.css) é um bottom sheet SOBRE o
// mapa: recolhido vira uma pílula, e a alça aceita toque e arrasto (para cima abre, para baixo recolhe).

import { deslocamentoVisual, resultadoDoArraste } from '../app/gaveta';
import { planejarLog } from '../app/logIncremental';
import { ROTULO_DIFICULDADE } from '../app/fonteCenarios';
import { TEXTO_POLITICA } from '../app/politicasTexto';
import { POLITICAS, type Cenario, type Politica } from '../sim/model';
import { formatarHora, type Evento, type Snapshot } from '../sim/simulation';
import { definirTexto, el } from './dom';

/** Mesma consulta de mídia do layout compacto em mobile.css (celular em retrato ou paisagem, janela pequena). */
const LAYOUT_COMPACTO = '(max-width: 900px), (max-height: 500px)';

/** Quantos eventos o log mostra (a sim guarda mais; a lista de 50 já passa do que cabe na tela). */
const MAX_ITENS_LOG = 50;

function itemDoLog(e: Readonly<Evento>): HTMLLIElement {
  const li = document.createElement('li');
  li.textContent = `[${formatarHora(e.seg)}] ${e.texto}`;
  if (e.texto.startsWith('Política alterada')) li.className = 'log-politica';
  return li;
}

export class Drawer {
  private readonly politica = el<HTMLSelectElement>('select-policy');
  private readonly regra = el('policy-regra');
  private readonly feedback = el('policy-feedback');
  private readonly cenarioInfo = el('cenario-info');
  private readonly log = el('sim-events-log');
  private readonly alca = el('drawer-toggle');
  private readonly gaveta = el('strategy-drawer');
  private ultimoEvento: Readonly<Evento> | undefined;

  /** O último arrasto da alça já decidiu a ação; o clique que o navegador dispara em seguida não pode desfazê-la. */
  private suprimirClique = false;

  constructor(aoMudarPolitica: (p: Politica) => void, aoTrocarCenario: () => void) {
    this.politica.replaceChildren(...POLITICAS.map(p => new Option(TEXTO_POLITICA[p].rotulo, p)));
    this.politica.addEventListener('change', () => aoMudarPolitica(this.politica.value as Politica));
    el('btn-trocar-cenario').addEventListener('click', aoTrocarCenario);
    this.alca.addEventListener('click', () => {
      if (this.suprimirClique) { this.suprimirClique = false; return; }
      this.recolher(this.aberta);
    });
    this.ligarArrasto();
    // Esc dentro da gaveta aberta (celular) devolve o mapa inteiro
    this.gaveta.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !this.aberta || !this.compacto()) return;
      e.stopPropagation();
      this.recolher(true);
      this.alca.focus();
    });
    // No celular a gaveta começa recolhida: o mapa precisa do espaço, e a política ativa já aparece no HUD.
    if (this.compacto()) this.recolher(true);
  }

  private compacto(): boolean {
    return window.matchMedia(LAYOUT_COMPACTO).matches;
  }

  get aberta(): boolean {
    return !this.gaveta.classList.contains('collapsed');
  }

  /** Abre ou recolhe (o tutorial abre a gaveta para mostrar o log e devolve como estava). */
  definirAberta(aberta: boolean): void {
    this.recolher(!aberta);
  }

  private recolher(sim: boolean): void {
    this.gaveta.classList.toggle('collapsed', sim);
    this.alca.setAttribute('aria-expanded', String(!sim));
  }

  /**
   * Arrasto da alça (só no layout compacto): a gaveta aberta acompanha o dedo para baixo; ao soltar, `resultadoDoArraste`
   * decide. Pointer Events cobrem dedo, caneta e mouse; `touch-action: none` na alça (mobile.css) impede o navegador de
   * transformar o arrasto em rolagem e cancelar o gesto.
   */
  private ligarArrasto(): void {
    let id: number | null = null;
    let y0 = 0;
    let abertaNoInicio = false;
    const terminar = () => {
      id = null;
      this.gaveta.style.transform = '';
      this.gaveta.style.transition = '';
    };
    this.alca.addEventListener('pointerdown', e => {
      this.suprimirClique = false;
      if (!this.compacto() || e.button !== 0) return;
      id = e.pointerId;
      y0 = e.clientY;
      abertaNoInicio = this.aberta;
      this.alca.setPointerCapture(e.pointerId);
    });
    this.alca.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const dy = deslocamentoVisual(e.clientY - y0, abertaNoInicio);
      if (dy > 0) {
        this.gaveta.style.transition = 'none';
        this.gaveta.style.transform = `translateY(${dy}px)`;
      }
    });
    this.alca.addEventListener('pointerup', e => {
      if (e.pointerId !== id) return;
      const r = resultadoDoArraste(e.clientY - y0, abertaNoInicio);
      terminar();
      if (r === 'toque') return; // o clique que vem a seguir alterna
      this.suprimirClique = true;
      if (r === 'abrir') this.recolher(false);
      else if (r === 'recolher') this.recolher(true);
    });
    this.alca.addEventListener('pointercancel', terminar);
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

  /**
   * Atualiza o log só quando chega evento novo, e só mexe no que mudou: os eventos novos entram no topo e a cauda é
   * podada (refazer os 50 itens a cada evento custava 5–8 ms com layout). Partida nova ou log zerado refaz a lista.
   */
  atualizarLog(eventos: readonly Readonly<Evento>[]): void {
    const plano = planejarLog(this.ultimoEvento, eventos, MAX_ITENS_LOG);
    if (plano.tipo === 'nada') return;
    this.ultimoEvento = eventos[0];
    if (plano.tipo === 'refazer') {
      this.log.replaceChildren(...eventos.slice(0, MAX_ITENS_LOG).map(itemDoLog));
      return;
    }
    this.log.prepend(...eventos.slice(0, plano.novos).map(itemDoLog));
    while (this.log.childElementCount > MAX_ITENS_LOG) this.log.lastElementChild?.remove();
  }
}
