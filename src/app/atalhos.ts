// Atalhos de teclado do jogo: espaço pausa/retoma; 1, 2 e 5 escolhem a velocidade. Decisão pura (sem DOM): a UI só
// repassa o evento, o estado da partida e se há modal aberto.

import type { Velocidade } from './relogio';

export type AcaoAtalho = { tipo: 'alternarPausa' } | { tipo: 'velocidade'; v: Velocidade };

export interface EventoTecla {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Tecla mantida pressionada: o espaço não pode ficar pausando e retomando a cada repetição. */
  repeat: boolean;
  /** `tagName` do elemento em foco (ou do alvo do evento), em maiúsculas; null = nenhum. */
  alvoTag: string | null;
  alvoEditavel: boolean;
}

/** Onde o espaço/números têm outro significado (digitar, abrir o seletor, ativar o botão em foco). */
const ALVOS_PROPRIOS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY']);

/**
 * `ativo` = há partida em andamento e nenhum modal aberto (pré-partida e resultado pausam a sim e comem as teclas).
 * Devolve null quando a tecla não é atalho ou não vale agora.
 */
export function acaoDoAtalho(e: EventoTecla, ativo: boolean): AcaoAtalho | null {
  if (!ativo || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.alvoEditavel || (e.alvoTag !== null && ALVOS_PROPRIOS.has(e.alvoTag))) return null;
  switch (e.key) {
    case ' ': return { tipo: 'alternarPausa' };
    case '1': return { tipo: 'velocidade', v: 1 };
    case '2': return { tipo: 'velocidade', v: 2 };
    case '5': return { tipo: 'velocidade', v: 5 };
    default: return null;
  }
}
