// Tela do tutorial: um véu escuro com "furos" sobre os elementos reais do passo + um balão com o texto. A lógica (passos,
// transições, onde mostrar, posição do balão) é pura e mora em src/app/{tutorial,balao}.ts; aqui só se mede o DOM,
// se desenha e se repassam os cliques.
//
// Acessibilidade: o balão é um `role="dialog"` modal (aria-modal, título e texto ligados por aria-labelledby /
// aria-describedby); o resto do app fica `inert` e o foco fica preso nele (tudo isso vem do `Modal`, o mesmo das telas
// de pré-partida e resultado, que também desliga os atalhos de teclado do jogo enquanto está aberto). Esc pula; as
// setas navegam; o foco fica no botão principal. O texto do passo é uma região `aria-live` e o leitor de tela o lê de novo
// a cada passo.

import './tutorial.css';
import { expandir, posicionarBalao, uniao, type Retangulo } from '../app/balao';
import {
  ESTADO_FECHADO, PASSOS_TUTORIAL, deveMostrarTutorial, marcarTutorialVisto, podeVoltar, rotuloProgresso,
  rotuloProximo, transicao, tutorialJaVisto, type ArmazenamentoMinimo, type EstadoTutorial, type EventoTutorial,
} from '../app/tutorial';
import { el, h } from './dom';
import { Modal } from './modal';

/** O que o tutorial precisa do resto do jogo (injetado pelo main, para esta tela não conhecer a partida). */
export interface OpcoesTutorial {
  /** O tutorial abriu: pausar a simulação. */
  aoAbrir: () => void;
  /** O tutorial fechou (concluído ou pulado): retomar a simulação se ela estava andando. */
  aoFechar: () => void;
  /** A gaveta de configurações, que o passo do log abre e depois devolve como estava. */
  gaveta: { readonly aberta: boolean; definirAberta(aberta: boolean): void };
}

const NS_SVG = 'http://www.w3.org/2000/svg';
/** Respiro em volta do elemento destacado. */
const FOLGA_DESTAQUE_PX = 6;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, atributos: Record<string, string>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS_SVG, tag);
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  return e;
}

/** `localStorage`/`sessionStorage` podem lançar até no ACESSO à propriedade (dados de site bloqueados). */
function armazenamentos(): (ArmazenamentoMinimo | null)[] {
  const pegar = (f: () => Storage): ArmazenamentoMinimo | null => { try { return f(); } catch { return null; } };
  return [pegar(() => window.localStorage), pegar(() => window.sessionStorage)];
}

export class Tutorial {
  private estado: EstadoTutorial = ESTADO_FECHADO;
  private readonly modal: Modal;
  private mostradoNestaPagina = false;
  private gavetaAoAbrir = false;
  private quadro = 0;

  private readonly raiz: HTMLElement;
  private readonly furos: SVGGElement;
  private readonly aros: SVGGElement;
  private readonly area: HTMLElement;
  private readonly balao: HTMLElement;
  private readonly progresso: HTMLElement;
  private readonly barra: HTMLElement;
  private readonly titulo: HTMLElement;
  private readonly texto: HTMLElement;
  private readonly btnPular: HTMLButtonElement;
  private readonly btnVoltar: HTMLButtonElement;
  private readonly btnProximo: HTMLButtonElement;

  constructor(private readonly opcoes: OpcoesTutorial) {
    this.furos = svg('g', {});
    this.aros = svg('g', {});
    const mascara = svg('mask', { id: 'tutorial-mascara' });
    mascara.append(svg('rect', { width: '100%', height: '100%', fill: '#fff' }), this.furos);
    const veu = svg('svg', { class: 'tutorial-veu', 'aria-hidden': 'true', focusable: 'false' });
    const defs = svg('defs', {});
    defs.append(mascara);
    veu.append(
      defs,
      svg('rect', { class: 'tutorial-escuro', width: '100%', height: '100%', mask: 'url(#tutorial-mascara)' }),
      this.aros,
    );
    // clicar no véu não faz nada, e também não pode tirar o foco do botão (senão as setas deixam de chegar aqui)
    veu.addEventListener('mousedown', e => e.preventDefault());

    this.progresso = h('p', { class: 'tutorial-progresso' });
    this.barra = h('span', null);
    this.titulo = h('h2', { class: 'tutorial-titulo', id: 'tutorial-titulo' });
    this.texto = h('p', { class: 'tutorial-texto', id: 'tutorial-texto' });
    this.btnPular = h('button', { class: 'btn-fantasma tutorial-pular', type: 'button', onclick: () => this.enviar('pular') }, 'Pular');
    this.btnVoltar = h('button', { class: 'btn-secundario', type: 'button', onclick: () => this.enviar('anterior') }, 'Voltar');
    this.btnProximo = h('button', { class: 'btn-primary', type: 'button', onclick: () => this.enviar('proximo') }, 'Próximo');
    this.balao = h('div', {
      class: 'tutorial-balao', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tutorial-titulo',
      'aria-describedby': 'tutorial-texto', tabindex: '-1',
    },
      h('div', { class: 'tutorial-cabeca' }, this.progresso, h('div', { class: 'tutorial-barra', 'aria-hidden': 'true' }, this.barra)),
      h('div', { 'aria-live': 'polite' }, this.titulo, this.texto),
      h('div', { class: 'tutorial-acoes' }, this.btnPular, this.btnVoltar, this.btnProximo),
    );
    // sonda invisível com a área segura (fora do notch e das barras do sistema): o balão se posiciona dentro dela
    this.area = h('div', { class: 'tutorial-area', 'aria-hidden': 'true' });

    this.raiz = h('div', { id: 'tutorial', class: 'tutorial', hidden: true }, veu, this.area, this.balao);
    document.body.append(this.raiz);
    this.modal = new Modal(this.raiz, () => this.enviar('pular'));

    el('btn-ajuda').addEventListener('click', () => this.abrir());
  }

  get aberto(): boolean {
    return this.estado.aberto;
  }

  /** Chamado no começo de cada turno: abre sozinho só para quem nunca viu o guia (e uma vez por carregamento). */
  abrirSeNovato(): void {
    if (deveMostrarTutorial(tutorialJaVisto(armazenamentos()), this.mostradoNestaPagina)) this.abrir();
  }

  /** Abre pelo botão "?" (a qualquer hora) ou pela abertura automática. */
  abrir(): void {
    if (this.estado.aberto) return;
    this.estado = transicao(this.estado, 'abrir', PASSOS_TUTORIAL.length).estado;
    this.mostradoNestaPagina = true;
    marcarTutorialVisto(armazenamentos()); // marca ao abrir: recarregar no meio do guia não o repete em loop
    this.gavetaAoAbrir = this.opcoes.gaveta.aberta;
    this.opcoes.aoAbrir();
    this.modal.abrir(this.btnProximo); // mostra a raiz (precisa estar visível para medir), prende o foco e deixa o app inert
    this.desenhar();
    document.addEventListener('keydown', this.teclado);
    window.addEventListener('resize', this.agendarDesenho);
    window.addEventListener('orientationchange', this.agendarDesenho);
  }

  private fechar(): void {
    document.removeEventListener('keydown', this.teclado);
    window.removeEventListener('resize', this.agendarDesenho);
    window.removeEventListener('orientationchange', this.agendarDesenho);
    cancelAnimationFrame(this.quadro);
    this.opcoes.gaveta.definirAberta(this.gavetaAoAbrir);
    this.modal.fechar();
    this.opcoes.aoFechar();
  }

  private enviar(evento: EventoTutorial): void {
    const r = transicao(this.estado, evento, PASSOS_TUTORIAL.length);
    this.estado = r.estado;
    if (!this.estado.aberto) this.fechar();
    else this.desenhar();
  }

  private teclado = (e: KeyboardEvent): void => {
    if (!this.estado.aberto || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); this.enviar('proximo'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.enviar('anterior'); }
  };

  private agendarDesenho = (): void => {
    cancelAnimationFrame(this.quadro);
    this.quadro = requestAnimationFrame(() => { if (this.estado.aberto) this.desenhar(); });
  };

  // ---------------------------------------------------------------- desenho

  private desenhar(): void {
    const total = PASSOS_TUTORIAL.length;
    const { indice } = this.estado;
    const passo = PASSOS_TUTORIAL[indice];

    this.progresso.textContent = rotuloProgresso(indice, total);
    this.barra.style.width = `${((indice + 1) / total) * 100}%`;
    this.titulo.textContent = passo.titulo;
    this.texto.textContent = passo.texto;
    this.btnProximo.textContent = rotuloProximo(indice, total);
    this.btnVoltar.hidden = !podeVoltar(indice);
    this.balao.dataset.passo = passo.id;

    // o passo do log mostra a gaveta; os outros a deixam como o jogador a tinha
    this.opcoes.gaveta.definirAberta(passo.abreGaveta ? true : this.gavetaAoAbrir);

    const alvos = this.medirAlvos(passo.alvos);
    this.desenharDestaques(alvos);

    // posição do balão, em coordenadas da área segura
    const a = this.area.getBoundingClientRect();
    const alvoUnido = uniao(alvos.map(r => expandir(r, FOLGA_DESTAQUE_PX)));
    const relativo: Retangulo | null = alvoUnido ? { ...alvoUnido, x: alvoUnido.x - a.left, y: alvoUnido.y - a.top } : null;
    const pos = posicionarBalao(relativo, { largura: this.balao.offsetWidth, altura: this.balao.offsetHeight }, { largura: a.width, altura: a.height });
    this.balao.style.left = `${a.left + pos.x}px`;
    this.balao.style.top = `${a.top + pos.y}px`;
    this.balao.dataset.lado = pos.lado;
  }

  /** Retângulos (coordenadas da janela) dos elementos do passo que existem e estão visíveis. */
  private medirAlvos(seletores: readonly string[]): Retangulo[] {
    const retangulos: Retangulo[] = [];
    for (const seletor of seletores) {
      const e = document.querySelector<HTMLElement>(seletor);
      if (!e) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // fora de cena (display:none, recolhido…): o balão fica sem destaque
      retangulos.push({ x: r.left, y: r.top, largura: r.width, altura: r.height });
    }
    return retangulos;
  }

  private desenharDestaques(alvos: Retangulo[]): void {
    this.furos.replaceChildren();
    this.aros.replaceChildren();
    for (const r of alvos.map(a => expandir(a, FOLGA_DESTAQUE_PX))) {
      const geometria = { x: String(r.x), y: String(r.y), width: String(r.largura), height: String(r.altura), rx: '10', ry: '10' };
      this.furos.append(svg('rect', { ...geometria, fill: '#000' }));
      this.aros.append(svg('rect', { ...geometria, class: 'tutorial-aro' }));
    }
  }
}
