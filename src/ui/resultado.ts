// Tela de resultado: aparece ao fim do turno, com a sim parada no estado final.
//
// Pontos de extensão para a F5 (integração com o servidor):
//   - `mostrarResultado(resultado, extras?)` pode ser chamado DE NOVO com o modal aberto (ex.: depois que o servidor
//     validou a partida): o conteúdo é redesenhado e o foco não se mexe. Sem `extras` (ou sem `validadoServidor`) a tela
//     mostra "partida local — não enviada ao ranking" — é o modo offline.
//   - `extras.ranking` / `posicaoRanking` / `mensagem` / `origem` viram, respectivamente, a tabela do ranking, a
//     posição, uma linha de aviso e o selo de origem do cenário.

import { formatarKm, formatarPercentual, formatarHorario, formatarDuracao, formatarPontos, formatarScore, plural } from '../app/formato';
import { ROTULO_DIFICULDADE } from '../app/fonteCenarios';
import { TEXTO_POLITICA } from '../app/politicasTexto';
import {
  estadoEnvio, montarBreakdown, rotuloOrigem, segmentosPolitica,
  type ExtrasResultado, type LinhaBreakdown, type ResultadoPartida,
} from '../app/resultado';
import type { Politica } from '../sim/model';
import { el, h } from './dom';
import { Modal } from './modal';
import './rede.css';

export interface AcoesResultado {
  aoJogarDeNovo: () => void;
  aoTrocar: () => void;
  /** "Ver o armazém" / Esc: fecha o modal e deixa o jogador olhar o estado final do mapa. */
  aoFechar: () => void;
}

/** Uma cor por política na linha do tempo (o `Record` obriga a colorir política nova); o nome sempre aparece escrito junto. */
const COR_POLITICA: Record<Politica, string> = {
  AbcProximidade: '#38bdf8', FifoPrimeiraLivre: '#a78bfa', Consolidacao: '#34d399', CrossDocking: '#fbbf24', WmsReal: '#fb7185',
};

export class TelaResultado {
  private readonly modal: Modal;
  private readonly corpo = el('resultado-corpo');
  private readonly eyebrow = el('resultado-eyebrow');
  private readonly repetir = el('btn-resultado-repetir');
  atual: ResultadoPartida | null = null;

  constructor(acoes: AcoesResultado) {
    this.modal = new Modal(el('modal-resultado'), acoes.aoFechar);
    this.repetir.addEventListener('click', acoes.aoJogarDeNovo);
    el('btn-resultado-trocar').addEventListener('click', acoes.aoTrocar);
    el('btn-resultado-fechar').addEventListener('click', acoes.aoFechar);
  }

  get aberto(): boolean {
    return this.modal.aberto;
  }

  fechar(): void {
    this.modal.fechar();
  }

  /** Abre a tela (ou, se já aberta, a atualiza com os novos `extras`). */
  mostrarResultado(r: ResultadoPartida, extras?: ExtrasResultado): void {
    this.atual = r;
    this.eyebrow.textContent = `${r.cenarioNome} · ${ROTULO_DIFICULDADE[r.dificuldade]} · ${formatarHorario(r.inicioTurnoSeg)}–${formatarHorario(r.fimTurnoSeg)}`;
    this.repetir.textContent = `Jogar de novo (${TEXTO_POLITICA[r.politicaInicial].curto})`;
    this.repetir.title = `Mesma política do início do turno: ${TEXTO_POLITICA[r.politicaInicial].rotulo}`;
    this.corpo.replaceChildren(
      this.blocoScore(r, extras),
      h('div', { class: 'resultado-colunas' },
        h('div', null, this.blocoBreakdown(r)),
        h('div', null, this.blocoMetricas(r), this.blocoPoliticas(r), this.blocoRanking(extras))),
    );
    // foco no próprio diálogo (o leitor de tela lê o título): "Jogar de novo" em foco seria acionado por um espaço de quem pausava
    this.modal.abrir(this.modal.raiz.querySelector<HTMLElement>('[role="dialog"]'));
  }

  // ---------------------------------------------------------------- blocos

  private blocoScore(r: ResultadoPartida, extras?: ExtrasResultado): HTMLElement {
    const envio = estadoEnvio(extras);
    const origem = rotuloOrigem(extras?.origem);
    return h('section', { class: 'bloco-score', 'aria-label': 'Score final' },
      h('div', { class: 'score-numero' },
        h('span', { class: 'score-valor font-mono', id: 'resultado-score' }, formatarScore(r.scoreCentesimos)),
        h('span', { class: 'score-max' }, '/ 100')),
      h('div', { class: 'score-lado' },
        h('p', { class: 'score-rotulo' }, 'Score de eficiência'),
        h('p', { class: `aviso-envio envio-${envio.tipo}`, role: 'status' }, envio.texto),
        extras?.mensagem ? h('p', { class: 'aviso-mensagem' }, extras.mensagem) : null,
        extras?.acao ? h('button', { class: 'btn-secundario aviso-acao', type: 'button', onclick: extras.acao.aoClicar }, extras.acao.rotulo) : null,
        origem ? h('p', { class: 'aviso-origem' }, h('span', { class: 'selo selo-origem' }, `Cenário: ${origem}`)) : null),
    );
  }

  private blocoBreakdown(r: ResultadoPartida): HTMLElement {
    const b = montarBreakdown(r.metricas, r.penalidades, r.scoreCentesimos);
    const linha = (l: LinhaBreakdown) => {
      const bonus = l.tipo === 'bonus';
      return h('li', { class: `termo termo-${l.tipo}`, 'data-termo': l.id },
        h('div', { class: 'termo-topo' },
          h('span', { class: 'termo-nome' }, l.rotulo),
          h('span', { class: 'termo-valor font-mono' }, formatarPontos(l.centesimos, bonus ? '+' : '−'))),
        h('div', { class: 'termo-barra', role: 'img', 'aria-label': `${l.rotulo}: ${formatarPontos(l.centesimos, bonus ? '+' : '−')} de no máximo ${formatarScore(l.maximo)}` },
          h('span', { style: `width:${Math.round((l.centesimos / l.maximo) * 100)}%` })),
        h('p', { class: 'termo-explicacao' }, l.explicacao));
    };
    return h('section', { class: 'bloco' },
      h('h3', null, 'De onde veio o score'),
      h('p', { class: 'bloco-intro' }, `Começa em ${formatarScore(b.base)}; cada problema do turno desconta pontos e a ocupação certa dá um bônus.`),
      h('ol', { class: 'termos' }, ...b.linhas.map(linha)),
      h('p', { class: 'conta font-mono' },
        `${formatarScore(b.base)} − ${formatarScore(b.totalPenalidades)} + ${formatarScore(b.bonus)} = `,
        h('b', null, formatarScore(b.scoreCentesimos))),
      b.limitadoNoTeto ? h('p', { class: 'conta-nota' }, 'O score nunca passa de 100: o excesso do bônus não conta.') : null,
    );
  }

  private blocoMetricas(r: ResultadoPartida): HTMLElement {
    const m = r.metricas;
    const itens: [string, string, string?][] = [
      ['Ordens concluídas', `${r.ordensConcluidas} de ${m.ordensTotal}`],
      ['Ordens atrasadas', `${m.ordensAtrasadas} de ${m.ordensTotal}`, 'inclui as que não terminaram no turno'],
      ['Distância (real × teórica)', `${formatarKm(m.distanciaRealCm)} × ${formatarKm(m.distanciaTeoricaCm)}`],
      ['Conflitos de corredor', plural(m.eventosConflito, 'espera', 'esperas')],
      ['Ocupação final', formatarPercentual(m.ocupacaoFinalCentesimos)],
    ];
    return h('section', { class: 'bloco' },
      h('h3', null, 'Métricas do turno'),
      h('dl', { class: 'metricas' }, ...itens.map(([k, v, nota]) =>
        h('div', null, h('dt', null, k), h('dd', { class: 'font-mono' }, v, nota ? h('small', null, nota) : null)))),
    );
  }

  private blocoPoliticas(r: ResultadoPartida): HTMLElement {
    const segs = segmentosPolitica(r.trocasPolitica, r.fimTurnoSeg);
    const unica = segs.length <= 1;
    return h('section', { class: 'bloco' },
      h('h3', null, 'Políticas durante o turno'),
      unica ? h('p', { class: 'bloco-intro' }, `Sem trocas: ${TEXTO_POLITICA[r.politicaInicial].rotulo} o turno inteiro.`) : null,
      h('div', { class: 'linha-tempo', role: 'img', 'aria-label': `Linha do tempo das políticas: ${segs.map(s => `${TEXTO_POLITICA[s.politica].curto} das ${formatarHorario(s.deSeg)} às ${formatarHorario(s.ateSeg)}`).join('; ')}` },
        ...segs.map(s => h('span', { style: `flex:${Math.max(s.fracao, 0.002)};background:${COR_POLITICA[s.politica]}`, title: TEXTO_POLITICA[s.politica].rotulo }))),
      h('ul', { class: 'legenda-tempo' }, ...segs.map(s => h('li', null,
        h('span', { class: 'amostra', style: `background:${COR_POLITICA[s.politica]}` }),
        h('span', { class: 'legenda-nome' }, TEXTO_POLITICA[s.politica].rotulo),
        h('span', { class: 'legenda-hora font-mono' }, `${formatarHorario(s.deSeg)}–${formatarHorario(s.ateSeg)} · ${formatarDuracao(s.duracaoSeg)}`)))),
      unica ? null : h('p', { class: 'bloco-intro' }, `${segs.length - 1} ${segs.length - 1 === 1 ? 'troca' : 'trocas'} de política no turno.`),
    );
  }

  private blocoRanking(extras?: ExtrasResultado): HTMLElement | null {
    const ranking = extras?.ranking;
    if (!ranking || ranking.length === 0) return null;
    const total = extras?.rankingTotal;
    // Top 10 + a posição da partida: as linhas trazem a posição real (sem ela, vale a ordem da lista) e, quando há
    // salto entre elas, uma linha "…" mostra que o ranking continua entre uma e outra.
    const linhas: HTMLElement[] = [];
    let anterior = 0;
    ranking.forEach((l, i) => {
      const posicao = l.posicao ?? i + 1;
      if (anterior > 0 && posicao > anterior + 1) {
        linhas.push(h('tr', { class: 'separador', 'aria-hidden': 'true' }, h('td', { colspan: 4 }, '⋮')));
      }
      anterior = posicao;
      const destaque = l.destaque ?? extras?.posicaoRanking === posicao;
      linhas.push(h('tr', { class: destaque ? 'voce' : l.souEu ? 'meu' : null, 'data-posicao': posicao },
        h('td', null, String(posicao)), h('td', null, l.jogador),
        h('td', { class: 'font-mono' }, formatarScore(l.scoreCentesimos)), h('td', { class: 'font-mono' }, formatarKm(l.distanciaCm))));
    });
    return h('section', { class: 'bloco' },
      h('h3', null, 'Ranking do cenário'),
      total !== undefined ? h('p', { class: 'bloco-intro' }, `${plural(total, 'partida validada', 'partidas validadas')} no ranking deste cenário.`) : null,
      h('div', { class: 'tabela-rolavel' },
        h('table', { class: 'tabela-ranking' },
          h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Jogador'), h('th', null, 'Score'), h('th', null, 'Distância'))),
          h('tbody', null, ...linhas))),
    );
  }
}
