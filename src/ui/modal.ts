// Comportamento comum dos modais (pré-partida e resultado): o resto da página fica `inert` (sem foco, sem clique,
// fora da árvore de acessibilidade), o foco entra no modal e volta para onde estava ao fechar, Tab dá a volta dentro
// do modal e Esc PEDE para fechar — quem decide se fecha é o dono (a pré-partida inicial, por exemplo, não fecha).

const abertos: Modal[] = [];

/** Há algum modal aberto? Os atalhos de teclado do jogo consultam isto para não disparar por trás dele. */
export function algumModalAberto(): boolean {
  return abertos.length > 0;
}

const FOCAVEIS = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focaveis(raiz: HTMLElement): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(e => e.offsetParent !== null || e === document.activeElement);
}

export class Modal {
  private anterior: HTMLElement | null = null;

  /**
   * @param raiz elemento de fundo (`hidden` quando fechado) que contém o `role="dialog"`.
   * @param aoPedirFechar Esc ou clique no fundo; chame `fechar()` se fizer sentido fechar.
   */
  constructor(readonly raiz: HTMLElement, private readonly aoPedirFechar: () => void) {
    raiz.addEventListener('mousedown', e => { if (e.target === raiz) this.aoPedirFechar(); });
  }

  get aberto(): boolean {
    return !this.raiz.hidden;
  }

  /** Abre e leva o foco para `foco` (padrão: o primeiro controle do modal). Idempotente. */
  abrir(foco?: HTMLElement | null): void {
    if (this.aberto) return;
    this.anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.raiz.hidden = false;
    abertos.push(this);
    document.addEventListener('keydown', this.teclado, true);
    this.atualizarFundo();
    (foco ?? focaveis(this.raiz)[0] ?? this.raiz.querySelector<HTMLElement>('[role="dialog"]'))?.focus();
  }

  fechar(): void {
    if (!this.aberto) return;
    this.raiz.hidden = true;
    abertos.splice(abertos.indexOf(this), 1);
    document.removeEventListener('keydown', this.teclado, true);
    this.atualizarFundo();
    const volta = this.anterior;
    this.anterior = null;
    if (volta && volta.isConnected && volta.offsetParent !== null) volta.focus();
  }

  /** O app só volta a receber foco quando o último modal fecha. */
  private atualizarFundo(): void {
    const app = document.getElementById('app');
    if (app) app.inert = abertos.length > 0;
  }

  private teclado = (e: KeyboardEvent): void => {
    if (abertos[abertos.length - 1] !== this) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.aoPedirFechar();
      return;
    }
    if (e.key !== 'Tab') return;
    const lista = focaveis(this.raiz);
    if (lista.length === 0) { e.preventDefault(); return; }
    const primeiro = lista[0];
    const ultimo = lista[lista.length - 1];
    const ativo = document.activeElement;
    if (e.shiftKey && (ativo === primeiro || !this.raiz.contains(ativo))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (ativo === ultimo || !this.raiz.contains(ativo))) { e.preventDefault(); primeiro.focus(); }
  };
}
