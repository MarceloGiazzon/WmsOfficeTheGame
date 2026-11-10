import { describe, expect, it } from 'vitest';
import {
  formatarCentesimos, formatarDuracao, formatarHorario, formatarKm, formatarPercentual, formatarPontos, plural,
} from './formato';

describe('formato', () => {
  it('centésimos com vírgula e duas casas', () => {
    expect(formatarCentesimos(8552)).toBe('85,52');
    expect(formatarCentesimos(10_000)).toBe('100,00');
    expect(formatarCentesimos(5)).toBe('0,05');
    expect(formatarCentesimos(0)).toBe('0,00');
    expect(formatarCentesimos(-150)).toBe('-1,50');
  });

  it('pontos com sinal; zero não leva sinal', () => {
    expect(formatarPontos(1234, '−')).toBe('−12,34');
    expect(formatarPontos(500, '+')).toBe('+5,00');
    expect(formatarPontos(0, '−')).toBe('0,00');
  });

  it('percentual a partir de centésimos', () => {
    expect(formatarPercentual(6042)).toBe('60%');
    expect(formatarPercentual(5789, 1)).toBe('57,9%');
  });

  it('km a partir de cm', () => {
    expect(formatarKm(1_234_000)).toBe('12,34 km');
    expect(formatarKm(0)).toBe('0,00 km');
  });

  it('horário de turno e duração', () => {
    expect(formatarHorario(28800)).toBe('08:00');
    expect(formatarHorario(64800)).toBe('18:00');
    expect(formatarDuracao(36000)).toBe('10 h');
    expect(formatarDuracao(12000)).toBe('3 h 20 min');
    expect(formatarDuracao(2700)).toBe('45 min');
    expect(formatarDuracao(30)).toBe('30 s');
  });

  it('plural', () => {
    expect(plural(1, 'ordem', 'ordens')).toBe('1 ordem');
    expect(plural(0, 'ordem', 'ordens')).toBe('0 ordens');
  });
});
