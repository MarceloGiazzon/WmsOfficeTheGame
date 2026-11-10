// "Partidas para enviar": o que está na fila de envio e o que o servidor rejeitou, com o motivo e as ações possíveis
// (enviar agora, tentar de novo, descartar). A fila nunca esconde nada do jogador: rejeitada fica aqui até ele decidir.

import { formatarDataHora, formatarScore } from '../app/formato';
import { TEXTO_POLITICA } from '../app/politicasTexto';
import { situacaoDoItem, type EstadoSincronizacao } from '../app/sincronizador';
import type { ItemFila } from '../net/filaEnvio';
import { h, preencher } from './dom';
import { Modal } from './modal';
import './rede.css';

export interface AcoesFila {
  listar(): Promise<ItemFila[]>;
  reenviar(id: string): Promise<void>;
  descartar(id: string): Promise<void>;
  /** `sincronizar()` do `Sincronizador`. */
  enviarAgora(): Promise<unknown>;
  /** Abre o login (convidado com partidas guardadas). */
  entrar(): void;
}

/** Tempo para confirmar um descarte (descartar é irreversível: o item é a única cópia da partida). */
const CONFIRMAR_MS = 5000;

export class TelaFila {
  private readonly raiz = h('div', { id: 'modal-fila', class: 'modal-fundo', hidden: true });
  private readonly modal: Modal;
  private readonly sub = h('p', { class: 'modal-sub', role: 'status' });
  private readonly lista = h('ul', { class: 'lista-fila' });
  private readonly vazio = h('p', { class: 'fila-vazia' }, 'Nenhuma partida pendente nem rejeitada.');
  private readonly botaoEnviar = h('button', { class: 'btn-primary', type: 'button' }, 'Enviar agora');
  private estado: EstadoSincronizacao | null = null;
  private logado = false;
  private usuario: string | null = null;
  private confirmando: string | null = null;
  private temporizadorConfirmacao: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly acoes: AcoesFila) {
    this.botaoEnviar.addEventListener('click', () => {
      if (!this.logado) { this.acoes.entrar(); return; }
      void this.acoes.enviarAgora();
    });
    this.raiz.append(h('div', { class: 'modal modal-fila', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fila-titulo', tabindex: -1 },
      h('header', { class: 'modal-cabecalho' },
        h('p', { class: 'modal-eyebrow' }, 'Envio de partidas'),
        h('h2', { id: 'fila-titulo' }, 'Partidas para enviar'),
        this.sub),
      h('div', { class: 'modal-corpo' }, this.lista, this.vazio),
      h('footer', { class: 'modal-rodape' },
        h('button', { class: 'btn-fantasma', type: 'button', onclick: () => this.fechar() }, 'Fechar'),
        this.botaoEnviar)));
    document.body.append(this.raiz);
    this.modal = new Modal(this.raiz, () => this.fechar());
  }

  get aberto(): boolean {
    return this.modal.aberto;
  }

  fechar(): void {
    this.confirmando = null;
    clearTimeout(this.temporizadorConfirmacao);
    this.modal.fechar();
  }

  async abrir(logado: boolean, usuario: string | null, estado: EstadoSincronizacao): Promise<void> {
    this.logado = logado;
    this.usuario = usuario;
    this.estado = estado;
    await this.desenhar();
    this.modal.abrir(this.botaoEnviar);
  }

  /** O estado da sincronização mudou (rodada começou/terminou, contagem mudou): redesenha se estiver aberta. */
  atualizar(logado: boolean, usuario: string | null, estado: EstadoSincronizacao): void {
    this.logado = logado;
    this.usuario = usuario;
    this.estado = estado;
    if (this.aberto) void this.desenhar();
  }

  private async desenhar(): Promise<void> {
    const todos = await this.acoes.listar();
    // logado: só as dele (a fila não envia as dos outros usuários do aparelho); convidado: todas, com o dono à mostra
    const itens = todos.filter(i => this.usuario === null || i.jogador === this.usuario);
    const e = this.estado;
    this.sub.textContent = e?.sincronizando ? 'Enviando…' : (e?.ultimaMensagem ?? (this.logado
      ? 'Partidas jogadas sem rede ficam aqui até o servidor aceitá-las.'
      : 'Você não está logado: entre para enviar as partidas guardadas.'));
    this.botaoEnviar.textContent = this.logado ? (e?.sincronizando ? 'Enviando…' : 'Enviar agora') : 'Entrar para enviar';
    this.botaoEnviar.disabled = this.logado && (e?.sincronizando === true || !itens.some(i => i.situacao === 'pendente'));
    this.vazio.hidden = itens.length > 0;
    // redesenhar troca os botões: sem isto o foco do teclado se perderia a cada clique
    const ativo = document.activeElement instanceof HTMLElement && this.lista.contains(document.activeElement) ? document.activeElement : null;
    const marca = ativo ? { id: ativo.closest('li')?.getAttribute('data-id') ?? '', acao: ativo.getAttribute('data-acao') ?? '' } : null;
    preencher(this.lista, ...itens.map(i => this.itemDaLista(i)));
    if (marca) {
      const mesmo = [...this.lista.querySelectorAll<HTMLElement>('li')].find(li => li.getAttribute('data-id') === marca.id)
        ?.querySelector<HTMLElement>(`[data-acao="${marca.acao}"]`);
      (mesmo ?? this.raiz.querySelector<HTMLElement>('[role="dialog"]'))?.focus();
    }
  }

  private itemDaLista(item: ItemFila): HTMLElement {
    const { rotulo, detalhe } = situacaoDoItem(item);
    const rejeitado = item.situacao === 'rejeitado';
    const divergencia = item.rejeicao?.codigo === 'score_divergente' ? item.resultado : undefined;
    const confirmando = this.confirmando === item.id;
    return h('li', { class: 'item-fila', 'data-situacao': item.situacao, 'data-id': item.id },
      h('div', { class: 'item-fila-topo' },
        h('span', { class: 'item-fila-nome font-mono' }, item.cenarioCodigo),
        h('span', { class: 'item-fila-politica' }, TEXTO_POLITICA[item.politica].curto),
        h('span', { class: 'item-fila-score font-mono' }, `${formatarScore(item.scoreCentesimos)} pts`),
        h('span', { class: 'item-fila-data' }, formatarDataHora(item.concluidaEm)),
        this.usuario === null ? h('span', { class: 'item-fila-dono' }, `de ${item.jogador}`) : null,
        h('span', { class: `selo selo-fila selo-fila-${item.situacao}` }, rotulo)),
      h('p', { class: 'item-fila-detalhe' }, detalhe),
      divergencia
        ? h('p', { class: 'item-fila-detalhe' }, `O servidor gravou ${formatarScore(divergencia.scoreServidorCentesimos)}; o jogo tinha calculado ${formatarScore(divergencia.scoreClienteCentesimos)}.`)
        : null,
      h('div', { class: 'item-fila-acoes' },
        rejeitado && !divergencia
          ? h('button', { class: 'btn-secundario btn-pequeno', type: 'button', 'data-acao': 'reenviar', onclick: () => void this.reenviar(item.id) }, 'Tentar de novo')
          : null,
        h('button', {
          class: confirmando ? 'btn-perigo btn-pequeno' : 'btn-fantasma btn-pequeno', type: 'button', 'data-acao': 'descartar',
          onclick: () => void this.descartar(item.id),
        }, confirmando ? 'Confirmar: descartar a partida' : 'Descartar')));
  }

  private async reenviar(id: string): Promise<void> {
    await this.acoes.reenviar(id);
    if (this.logado) void this.acoes.enviarAgora();
    await this.desenhar();
  }

  private async descartar(id: string): Promise<void> {
    if (this.confirmando !== id) {
      this.confirmando = id;
      clearTimeout(this.temporizadorConfirmacao);
      this.temporizadorConfirmacao = setTimeout(() => { this.confirmando = null; void this.desenhar(); }, CONFIRMAR_MS);
      await this.desenhar();
      return;
    }
    this.confirmando = null;
    clearTimeout(this.temporizadorConfirmacao);
    await this.acoes.descartar(id);
    await this.desenhar();
  }
}
