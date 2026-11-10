import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATRASO_AVISO_ESPERA_MS, EsperaVisivel } from './esperaVisivel';

describe('EsperaVisivel', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('espera curta (a resposta normal, ~45 ms) nunca mostra o aviso', () => {
    const mostrar = vi.fn();
    const e = new EsperaVisivel(mostrar);
    for (let i = 0; i < 100; i++) { e.iniciar(); vi.advanceTimersByTime(45); e.terminar(); }
    vi.advanceTimersByTime(10_000);
    expect(mostrar).not.toHaveBeenCalled();
  });

  it('espera que passa do atraso mostra o aviso, e some quando termina', () => {
    const mostrar = vi.fn();
    const e = new EsperaVisivel(mostrar);
    e.iniciar();
    vi.advanceTimersByTime(ATRASO_AVISO_ESPERA_MS - 1);
    expect(mostrar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mostrar).toHaveBeenLastCalledWith(true);
    e.terminar();
    expect(mostrar).toHaveBeenLastCalledWith(false);
    expect(mostrar).toHaveBeenCalledTimes(2);
  });

  it('iniciar de novo com o aviso visível não reinicia nada; terminar sem iniciar não faz nada', () => {
    const mostrar = vi.fn();
    const e = new EsperaVisivel(mostrar);
    e.terminar();
    e.iniciar();
    vi.advanceTimersByTime(ATRASO_AVISO_ESPERA_MS);
    e.iniciar();
    vi.advanceTimersByTime(1_000);
    expect(mostrar).toHaveBeenCalledTimes(1);
    e.terminar();
    e.terminar();
    expect(mostrar).toHaveBeenCalledTimes(2);
  });
});
