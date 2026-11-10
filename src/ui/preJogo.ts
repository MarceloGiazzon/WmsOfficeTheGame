// Tela de pré-partida: cartões dos cenários + política com a regra de cada uma. A sim só nasce em "Iniciar turno".
// A tela não sabe de onde os cenários vêm (ver `FonteCenarios`): recebe os resumos e devolve escolhas.

import { formatarDuracao, formatarHorario } from '../app/formato';
import { ROTULO_DIFICULDADE, ROTULO_ORIGEM, type AvisoFonte, type ResumoCenario } from '../app/fonteCenarios';
import { TEXTO_POLITICA } from '../app/politicasTexto';
import { POLITICAS, type Politica } from '../sim/model';
import { el, h, preencher } from './dom';
import { Modal } from './modal';

export interface EstadoPreJogo {
  cenarios: ResumoCenario[];
  cenario: string;
  politica: Politica;
  /** Há uma partida para a qual voltar (Esc / "Voltar à partida"). Na abertura do jogo não há. */
  podeCancelar: boolean;
  /** O turno atual ainda está rodando: avisa que iniciar outro o descarta (turno já encerrado não perde nada). */
  avisoDescarte: boolean;
  /** Sobre a lista (F5): servidor inalcançável, modo convidado… Aparece acima dos cartões. */
  aviso?: AvisoFonte | null;
}

export interface AcoesPreJogo {
  aoIniciar: (codigo: string, politica: Politica) => void;
  aoCancelar: () => void;
}

export class PreJogo {
  private readonly modal: Modal;
  private readonly corpo = el('prejogo-corpo');
  private readonly rodape = el('prejogo-rodape');
  private podeCancelar = false;

  constructor(private readonly acoes: AcoesPreJogo) {
    this.modal = new Modal(el('modal-prejogo'), () => { if (this.podeCancelar) this.acoes.aoCancelar(); });
  }

  get aberto(): boolean {
    return this.modal.aberto;
  }

  abrir(estado: EstadoPreJogo): void {
    this.podeCancelar = estado.podeCancelar;
    this.desenhar(estado);
    // O foco começa no cenário marcado, não em "Iniciar turno": quem abre isto no meio do jogo está com a mão no espaço
    // (pausa), e o espaço num botão em foco o acionaria e descartaria o turno.
    this.modal.abrir(this.corpo.querySelector<HTMLElement>('input[name="cenario"]:checked'));
  }

  /** "Iniciar turno" em andamento (carregar o pacote e montar a sim leva um instante): trava os botões. */
  ocupado(sim: boolean): void {
    const botao = this.rodape.querySelector<HTMLButtonElement>('.btn-primary');
    if (!botao) return;
    botao.disabled = sim;
    botao.textContent = sim ? 'Carregando…' : 'Iniciar turno';
  }

  fechar(): void {
    this.modal.fechar();
  }

  /** Falha ao listar os cenários (rede, cache…): mensagem e "tentar de novo", sem deixar o jogador numa tela vazia. */
  mostrarErro(mensagem: string, aoTentarDeNovo: () => void, podeCancelar: boolean): void {
    this.podeCancelar = podeCancelar;
    preencher(this.corpo, h('p', { class: 'aviso-erro', role: 'alert' }, `Não foi possível carregar os cenários: ${mensagem}`));
    preencher(this.rodape, 
      podeCancelar ? h('button', { class: 'btn-fantasma', type: 'button', onclick: () => this.acoes.aoCancelar() }, 'Voltar à partida') : null,
      h('button', { class: 'btn-primary', type: 'button', onclick: aoTentarDeNovo }, 'Tentar de novo'),
    );
    this.modal.abrir(this.rodape.querySelector<HTMLElement>('.btn-primary'));
  }

  private desenhar(estado: EstadoPreJogo): void {
    let cenario = estado.cenario;
    let politica = estado.politica;
    const resumoDe = () => estado.cenarios.find(c => c.codigo === cenario) ?? estado.cenarios[0];
    const linhaResumo = h('span', { class: 'rodape-resumo' });
    const atualizarResumo = () => {
      linhaResumo.textContent = `${resumoDe().nome} · ${TEXTO_POLITICA[politica].rotulo}` +
        (estado.avisoDescarte ? ' — iniciar descarta o turno em andamento' : '');
    };

    const cartoes = estado.cenarios.map(c => cartaoCenario(c, c.codigo === cenario, () => {
      cenario = c.codigo;
      atualizarResumo();
    }));
    const opcoes = POLITICAS.map(p => opcaoPolitica(p, p === politica, () => {
      politica = p;
      atualizarResumo();
    }));

    preencher(this.corpo,
      estado.aviso ? h('p', { class: `aviso-lista aviso-lista-${estado.aviso.tipo}`, role: 'status' }, estado.aviso.texto) : null,
      h('div', { class: 'prejogo-colunas' },
        h('fieldset', { class: 'grupo' },
          h('legend', null, '1. Cenário'),
          h('div', { class: 'lista-cartoes' }, ...cartoes)),
        h('fieldset', { class: 'grupo' },
          h('legend', null, '2. Política de armazenagem'),
          h('p', { class: 'grupo-dica' }, 'Dá para trocar durante o turno; vale só para os paletes guardados depois.'),
          h('div', { class: 'lista-politicas' }, ...opcoes))),
    );

    atualizarResumo();
    preencher(this.rodape, 
      linhaResumo,
      estado.podeCancelar ? h('button', { class: 'btn-fantasma', type: 'button', onclick: () => this.acoes.aoCancelar() }, 'Voltar à partida') : null,
      h('button', { class: 'btn-primary', type: 'button', onclick: () => this.acoes.aoIniciar(cenario, politica) }, 'Iniciar turno'),
    );
  }
}

function cartaoCenario(c: ResumoCenario, marcado: boolean, aoMarcar: () => void): HTMLElement {
  const dado = (rotulo: string, valor: string, detalhe?: string) =>
    h('div', null, h('dt', null, rotulo), h('dd', null, valor, detalhe ? h('small', null, ` ${detalhe}`) : null));
  const turno = c.fimTurnoSeg - c.inicioTurnoSeg;
  return h('label', { class: 'cartao-cenario' },
    h('input', { type: 'radio', name: 'cenario', value: c.codigo, checked: marcado, onchange: aoMarcar }),
    h('span', { class: 'cartao-topo' },
      h('span', { class: 'cartao-nome' }, c.nome),
      h('span', { class: 'selo', 'data-dificuldade': c.dificuldade }, ROTULO_DIFICULDADE[c.dificuldade])),
    h('span', { class: 'cartao-codigo font-mono' }, c.codigo, h('span', { class: 'selo selo-origem', 'data-origem': c.origem }, ROTULO_ORIGEM[c.origem])),
    h('dl', { class: 'cartao-dados' },
      dado('Ordens', String(c.ordensTotal), `(${c.ordensEntrada} entradas, ${c.ordensSaida} saídas)`),
      dado('Locais', String(c.locais), `(${c.ruas} ruas)`),
      dado('Empilhadeiras', String(c.empilhadeiras)),
      dado('Docas', `${c.docasEntrada + c.docasSaida}`, `(${c.docasEntrada} entrada, ${c.docasSaida} saída)`),
      dado('Turno', `${formatarHorario(c.inicioTurnoSeg)}–${formatarHorario(c.fimTurnoSeg)}`, `(${formatarDuracao(turno)})`)),
  );
}

function opcaoPolitica(p: Politica, marcada: boolean, aoMarcar: () => void): HTMLElement {
  const t = TEXTO_POLITICA[p];
  return h('label', { class: 'opcao-politica' },
    h('input', { type: 'radio', name: 'politica', value: p, checked: marcada, onchange: aoMarcar }),
    h('span', { class: 'opcao-nome' }, t.rotulo),
    h('span', { class: 'opcao-regra' }, t.regra),
  );
}
