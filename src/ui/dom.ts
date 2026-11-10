// Auxiliares mínimos de DOM para as telas (pré-partida, resultado). Sem innerHTML: todo texto entra por textContent,
// então nome de cenário, jogador do ranking etc. nunca viram HTML.

type Filho = Node | string | null | undefined | false;

export type Atributos = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/**
 * `h('button', { class: 'btn', type: 'button', onclick: fn }, 'Texto')`. Atributo `onXxx` com função vira listener;
 * `true` liga um atributo booleano, `false`/null/undefined o omite.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, atributos: Atributos | null, ...filhos: Filho[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [nome, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (typeof valor === 'function') e.addEventListener(nome.replace(/^on/, ''), valor);
    else e.setAttribute(nome, valor === true ? '' : String(valor));
  }
  for (const f of filhos) if (f !== null && f !== undefined && f !== false) e.append(f);
  return e;
}

/** `pai.replaceChildren(...)` que ignora filhos ausentes (null/false). */
export function preencher(pai: HTMLElement, ...filhos: Filho[]): void {
  pai.replaceChildren(...filhos.filter((f): f is Node | string => f !== null && f !== undefined && f !== false));
}

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`elemento #${id} ausente no index.html`);
  return e as T;
}

/** Escreve o texto só se mudou: o HUD roda a cada frame e mexer no DOM sem necessidade custa layout. */
export function definirTexto(e: HTMLElement, texto: string): void {
  if (e.textContent !== texto) e.textContent = texto;
}
