// HUD: indicadores do turno (relógio, ordens, atrasos, distância, conflitos, ocupação, score), controles de
// velocidade e a faixa de estado (cenário, política ativa, situação do turno).

import type { Velocidade } from '../app/relogio';
import { formatarHorario, formatarKm, formatarPercentual, formatarScore } from '../app/formato';
import { ROTULO_DIFICULDADE } from '../app/fonteCenarios';
import { TEXTO_POLITICA } from '../app/politicasTexto';
import type { Cenario, Politica } from '../sim/model';
import { formatarHora, type Snapshot } from '../sim/simulation';
import { definirTexto, el } from './dom';

const BOTOES_VELOCIDADE: { id: string; v: Velocidade }[] = [
  { id: 'btn-pause', v: 0 }, { id: 'btn-play-1x', v: 1 }, { id: 'btn-play-2x', v: 2 }, { id: 'btn-play-5x', v: 5 },
];

export class Hud {
  private readonly relogio = el('kpi-clock');
  private readonly relogioSub = el('kpi-clock-sub');
  private readonly ordens = el('kpi-orders');
  private readonly ordensSub = el('kpi-orders-sub');
  private readonly atrasadas = el('kpi-late');
  private readonly atrasadasCard = el('kpi-late-card');
  private readonly distancia = el('kpi-distance');
  private readonly distanciaSub = el('kpi-distance-sub');
  private readonly conflitos = el('kpi-conflicts');
  private readonly ocupacao = el('kpi-occupancy');
  private readonly score = el('kpi-score');
  private readonly scoreRotulo = el('kpi-score-label');
  private readonly scoreSub = el('kpi-score-sub');
  private readonly cenario = el('status-cenario');
  private readonly dificuldade = el('status-dificuldade');
  private readonly politicaChip = el('status-politica');
  private readonly politicaNome = el('status-politica-nome');
  private readonly estado = el('status-estado');
  private readonly verResultado = el('btn-ver-resultado');

  private velocidade: Velocidade = 1;
  private aguardandoServidor = false;
  private terminadoAgora = false;
  private politicaMostrada: Politica | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(aoMudarVelocidade: (v: Velocidade) => void, aoAbrirPolitica: () => void, aoVerResultado: () => void) {
    for (const b of BOTOES_VELOCIDADE) {
      el(b.id).addEventListener('click', () => {
        this.marcarVelocidade(b.v);
        aoMudarVelocidade(b.v);
      });
    }
    this.politicaChip.addEventListener('click', aoAbrirPolitica);
    this.verResultado.addEventListener('click', aoVerResultado);
    this.ligarIndicadoresExtras();
  }

  /**
   * Celular: distância, conflitos e ocupação ficam num painel que o botão "mais indicadores" abre por cima do mapa
   * (o HUD essencial — relógio, ordens, atrasadas e score — fica sempre visível). No desktop o botão nem aparece.
   */
  private ligarIndicadoresExtras(): void {
    const cabecalho = el('hud-header');
    const botao = el('btn-hud-mais');
    const definir = (aberto: boolean) => {
      cabecalho.classList.toggle('expandido', aberto);
      botao.setAttribute('aria-expanded', String(aberto));
      botao.setAttribute('aria-label', aberto ? 'Esconder os indicadores extras' : 'Mostrar mais indicadores');
    };
    botao.addEventListener('click', () => definir(!cabecalho.classList.contains('expandido')));
    // tocar no mapa (ou em qualquer coisa fora do cabeçalho) fecha o painel; Esc também
    document.addEventListener('pointerdown', e => {
      if (cabecalho.classList.contains('expandido') && !cabecalho.contains(e.target as Node)) definir(false);
    }, true);
    cabecalho.addEventListener('keydown', e => {
      if (e.key === 'Escape' && cabecalho.classList.contains('expandido')) { definir(false); botao.focus(); }
    });
  }

  /** O jogo está parado esperando o servidor decidir o destino de um palete (política WmsReal). */
  marcarAguardandoServidor(aguardando: boolean): void {
    this.aguardandoServidor = aguardando;
    this.desenharEstado();
  }

  private desenharEstado(): void {
    if (this.terminadoAgora) {
      definirTexto(this.estado, 'Turno encerrado');
      this.estado.dataset.estado = 'fim';
    } else if (this.aguardandoServidor) {
      definirTexto(this.estado, 'Aguardando o servidor…');
      this.estado.dataset.estado = 'espera';
    } else {
      definirTexto(this.estado, this.velocidade === 0 ? 'Pausado' : `Em andamento · ${this.velocidade}x`);
      this.estado.dataset.estado = this.velocidade === 0 ? 'pausa' : 'ativo';
    }
  }

  marcarVelocidade(v: Velocidade): void {
    this.velocidade = v;
    for (const b of BOTOES_VELOCIDADE) {
      const botao = el(b.id);
      botao.classList.toggle('active', b.v === v);
      botao.setAttribute('aria-pressed', String(b.v === v));
    }
  }

  /** Cenário em jogo (a faixa de estado e a explicação do horário do turno). */
  definirCenario(c: Cenario): void {
    definirTexto(this.cenario, c.nome);
    definirTexto(this.dificuldade, ROTULO_DIFICULDADE[c.dificuldade]);
    this.dificuldade.dataset.dificuldade = c.dificuldade;
    definirTexto(this.relogioSub, `turno ${formatarHorario(c.inicioTurnoSeg)}–${formatarHorario(c.fimTurnoSeg)}`);
  }

  /** Chama a atenção para a política ativa por um instante (troca no meio do turno). */
  destacarPolitica(): void {
    this.politicaChip.classList.remove('flash');
    void this.politicaChip.offsetWidth; // reinicia a animação se a troca for repetida
    this.politicaChip.classList.add('flash');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.politicaChip.classList.remove('flash'), 2000);
  }

  atualizar(s: Snapshot): void {
    definirTexto(this.relogio, formatarHora(s.relogioSeg));
    definirTexto(this.ordens, `${s.ordensConcluidas} / ${s.ordensTotal}`);
    definirTexto(this.ordensSub, `${s.ordensLiberadas} liberadas`);
    definirTexto(this.atrasadas, String(s.metricas.ordensAtrasadas));
    this.atrasadasCard.classList.toggle('kpi-alerta', s.metricas.ordensAtrasadas > 0);
    definirTexto(this.distancia, formatarKm(s.metricas.distanciaRealCm));
    definirTexto(this.distanciaSub, `teórica ${formatarKm(s.metricas.distanciaTeoricaCm)}`);
    definirTexto(this.conflitos, String(s.metricas.eventosConflito));
    definirTexto(this.ocupacao, formatarPercentual(s.ocupacaoCentesimos));
    // parcial durante o turno (a distância teórica é a do turno todo); oficial quando `terminado`
    definirTexto(this.score, s.score.sucesso ? formatarScore(s.score.scoreCentesimos) : '—');
    definirTexto(this.scoreRotulo, s.terminado ? 'SCORE FINAL' : 'SCORE PARCIAL');
    definirTexto(this.scoreSub, s.terminado ? 'de 100,00 · turno encerrado' : 'de 100,00 · muda até o fim');

    if (s.politica !== this.politicaMostrada) {
      const t = TEXTO_POLITICA[s.politica];
      definirTexto(this.politicaNome, t.curto);
      this.politicaChip.title = `${t.rotulo}: ${t.regra} Clique para trocar.`;
      this.politicaChip.setAttribute('aria-label', `Política ativa: ${t.rotulo}. Abre o seletor para trocar.`);
      this.politicaMostrada = s.politica;
    }

    this.terminadoAgora = s.terminado;
    this.desenharEstado();
    this.verResultado.hidden = !s.terminado;
  }
}
