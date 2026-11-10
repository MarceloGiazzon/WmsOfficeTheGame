// Avisos temporários (toasts) da integração com o servidor: sessão expirou, partidas enviadas, rede caiu e o jogo usou o
// cache. Ficam FORA do `#app` (que fica `inert` com modal aberto), numa região `aria-live`, para o leitor de tela
// anunciar e para valerem também por cima de um modal. Não bloqueiam nada e somem sozinhos; o "✕" fecha antes.

import { h } from './dom';
import './rede.css';

export type TipoAviso = 'info' | 'ok' | 'alerta' | 'erro';

/** Quanto cada aviso fica na tela. Alerta e erro ficam mais: costumam trazer uma instrução. */
const DURACAO_MS: Readonly<Record<TipoAviso, number>> = { info: 6000, ok: 6000, alerta: 12000, erro: 15000 };
const MAXIMO_NA_TELA = 4;

export class Avisos {
  private readonly raiz = h('div', { class: 'rede-avisos', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });

  constructor() {
    document.body.append(this.raiz);
  }

  mostrar(texto: string, tipo: TipoAviso = 'info'): void {
    // o mesmo texto repetido (ex.: duas falhas seguidas) não empilha
    for (const a of this.raiz.children) if (a.getAttribute('data-texto') === texto) a.remove();
    const aviso = h('div', { class: 'rede-aviso', 'data-tipo': tipo, 'data-texto': texto },
      h('p', null, texto),
      h('button', { class: 'rede-aviso-fechar', type: 'button', 'aria-label': 'Fechar aviso', onclick: () => aviso.remove() }, '✕'));
    this.raiz.append(aviso);
    while (this.raiz.children.length > MAXIMO_NA_TELA) this.raiz.firstElementChild?.remove();
    setTimeout(() => aviso.remove(), DURACAO_MS[tipo]);
  }
}
