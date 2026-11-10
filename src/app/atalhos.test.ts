import { describe, expect, it } from 'vitest';
import { acaoDoAtalho, type EventoTecla } from './atalhos';

const tecla = (key: string, extra: Partial<EventoTecla> = {}): EventoTecla => ({
  key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, alvoTag: 'BODY', alvoEditavel: false, ...extra,
});

describe('acaoDoAtalho', () => {
  it('espaço alterna a pausa; 1, 2 e 5 escolhem a velocidade', () => {
    expect(acaoDoAtalho(tecla(' '), true)).toEqual({ tipo: 'alternarPausa' });
    expect(acaoDoAtalho(tecla('1'), true)).toEqual({ tipo: 'velocidade', v: 1 });
    expect(acaoDoAtalho(tecla('2'), true)).toEqual({ tipo: 'velocidade', v: 2 });
    expect(acaoDoAtalho(tecla('5'), true)).toEqual({ tipo: 'velocidade', v: 5 });
  });

  it('modal aberto ou partida parada (ativo = false): nenhuma tecla dispara', () => {
    for (const k of [' ', '1', '2', '5']) expect(acaoDoAtalho(tecla(k), false), k).toBeNull();
  });

  it('outras teclas, repetição e combinações com modificador não são atalho', () => {
    expect(acaoDoAtalho(tecla('a'), true)).toBeNull();
    expect(acaoDoAtalho(tecla('3'), true)).toBeNull();
    expect(acaoDoAtalho(tecla(' ', { repeat: true }), true)).toBeNull();
    expect(acaoDoAtalho(tecla(' ', { ctrlKey: true }), true)).toBeNull();
    expect(acaoDoAtalho(tecla('1', { metaKey: true }), true)).toBeNull();
    expect(acaoDoAtalho(tecla('2', { altKey: true }), true)).toBeNull();
  });

  it('com foco em controle que usa a tecla (botão, seletor, campo de texto) o atalho não rouba', () => {
    for (const alvoTag of ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'A']) {
      expect(acaoDoAtalho(tecla(' ', { alvoTag }), true), alvoTag).toBeNull();
    }
    expect(acaoDoAtalho(tecla(' ', { alvoTag: 'DIV', alvoEditavel: true }), true)).toBeNull();
    expect(acaoDoAtalho(tecla(' ', { alvoTag: 'CANVAS' }), true)).toEqual({ tipo: 'alternarPausa' });
  });
});
