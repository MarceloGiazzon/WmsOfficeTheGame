import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { Metricas, PacoteCenario } from '../sim/model';
import { calcularScore } from '../sim/score';
import { Simulacao } from '../sim/simulation';
import {
  estadoEnvio, LIMITES_SCORE, montarBreakdown, resultadoDaPartida, rotuloOrigem, segmentosPolitica,
} from './resultado';

const pacoteA = whA as unknown as PacoteCenario;

const base: Metricas = {
  distanciaRealCm: 1_000_000, distanciaTeoricaCm: 1_000_000, ordensTotal: 60, ordensAtrasadas: 0,
  eventosConflito: 0, ocupacaoFinalCentesimos: 5000,
};
const score = (m: Metricas) => {
  const r = calcularScore(m);
  if (!r.sucesso) throw new Error(r.motivo);
  return r;
};

describe('LIMITES_SCORE × calcularScore (a regra mudou lá? quebra aqui)', () => {
  it('teto de cada penalidade', () => {
    const pior = score({ ...base, distanciaRealCm: 10_000_000, ordensAtrasadas: 60, eventosConflito: 1000 }).penalidades;
    expect(pior.distancia).toBe(LIMITES_SCORE.distancia);
    expect(pior.atraso).toBe(LIMITES_SCORE.atraso);
    expect(pior.conflito).toBe(LIMITES_SCORE.conflito);
  });

  it('custo por conflito e distância proporcional ao excesso', () => {
    expect(score({ ...base, eventosConflito: 1 }).penalidades.conflito).toBe(LIMITES_SCORE.conflitoPorEvento);
    expect(score({ ...base, distanciaRealCm: 1_010_000 }).penalidades.distancia).toBe(LIMITES_SCORE.distancia / 100); // +1%
    expect(score({ ...base, distanciaRealCm: 2_000_000 }).penalidades.distancia).toBe(LIMITES_SCORE.distancia); // +100%
  });

  it('bônus e faixa de ocupação (limites inclusivos)', () => {
    const bonus = (o: number) => score({ ...base, ocupacaoFinalCentesimos: o }).penalidades.bonusOcupacao;
    expect(bonus(LIMITES_SCORE.ocupacaoMin)).toBe(LIMITES_SCORE.bonusOcupacao);
    expect(bonus(LIMITES_SCORE.ocupacaoMax)).toBe(LIMITES_SCORE.bonusOcupacao);
    expect(bonus(LIMITES_SCORE.ocupacaoMin - 1)).toBe(0);
    expect(bonus(LIMITES_SCORE.ocupacaoMax + 1)).toBe(0);
  });

  it('base = score máximo', () => {
    expect(score(base).scoreCentesimos).toBe(LIMITES_SCORE.base);
  });
});

describe('montarBreakdown', () => {
  it('quatro linhas com os valores de calcularScore e a conta fecha', () => {
    const m: Metricas = { ...base, distanciaRealCm: 1_230_000, ordensAtrasadas: 3, eventosConflito: 4, ocupacaoFinalCentesimos: 8000 };
    const r = score(m);
    const b = montarBreakdown(m, r.penalidades, r.scoreCentesimos);
    expect(b.linhas.map(l => l.id)).toEqual(['distancia', 'atraso', 'conflito', 'ocupacao']);
    expect(b.linhas.map(l => l.centesimos)).toEqual([
      r.penalidades.distancia, r.penalidades.atraso, r.penalidades.conflito, r.penalidades.bonusOcupacao,
    ]);
    expect(b.linhas.map(l => l.tipo)).toEqual(['penalidade', 'penalidade', 'penalidade', 'bonus']);
    expect(b.totalPenalidades).toBe(r.penalidades.distancia + r.penalidades.atraso + r.penalidades.conflito);
    expect(b.base - b.totalPenalidades + b.bonus).toBe(r.scoreCentesimos); // sem teto neste caso
    expect(b.limitadoNoTeto).toBe(false);
    for (const l of b.linhas) expect(l.centesimos).toBeLessThanOrEqual(l.maximo);
  });

  it('explica com os números da partida', () => {
    const m: Metricas = { ...base, distanciaRealCm: 1_230_000, ordensAtrasadas: 3, eventosConflito: 4, ocupacaoFinalCentesimos: 8000 };
    const r = score(m);
    const [dist, atraso, conflito, ocup] = montarBreakdown(m, r.penalidades, r.scoreCentesimos).linhas;
    expect(dist.explicacao).toContain('12,30 km contra 10,00 km');
    expect(dist.explicacao).toContain('23% a mais');
    expect(atraso.explicacao).toContain('3 de 60 ordens atrasaram (5%)');
    expect(atraso.explicacao).toContain('0,67 pt');
    expect(conflito.explicacao).toContain('4 esperas');
    expect(conflito.explicacao).toContain('1,50 pt');
    expect(ocup.explicacao).toContain('80%');
    expect(ocup.explicacao).toContain('este turno ganhou');
  });

  it('casos sem penalidade e singular', () => {
    const r = score(base);
    const [dist, atraso, conflito, ocup] = montarBreakdown(base, r.penalidades, r.scoreCentesimos).linhas;
    expect(dist.explicacao).toContain('sem penalidade');
    expect(atraso.explicacao).toContain('Nenhuma das 60 ordens atrasou');
    expect(conflito.explicacao).toContain('Nenhuma empilhadeira esperou');
    expect(ocup.explicacao).not.toContain('este turno ganhou');
    const um = { ...base, eventosConflito: 1 };
    expect(montarBreakdown(um, score(um).penalidades, 0).linhas[2].explicacao).toContain('1 espera por corredor');
  });

  it('o teto de 100: bônus não passa de 100 e o breakdown avisa', () => {
    const m: Metricas = { ...base, ocupacaoFinalCentesimos: 8000 };
    const r = score(m);
    expect(r.scoreCentesimos).toBe(10_000);
    const b = montarBreakdown(m, r.penalidades, r.scoreCentesimos);
    expect(b.limitadoNoTeto).toBe(true);
    expect(b.base - b.totalPenalidades + b.bonus).toBeGreaterThan(r.scoreCentesimos);
  });

  it('distância teórica zero não quebra', () => {
    const m: Metricas = { ...base, distanciaTeoricaCm: 0, distanciaRealCm: 5000 };
    const r = score(m);
    expect(montarBreakdown(m, r.penalidades, r.scoreCentesimos).linhas[0].explicacao).toContain('penalidade máxima');
  });
});

describe('resultadoDaPartida', () => {
  it('só existe com o turno terminado; copia métricas e trocas do snapshot', () => {
    const sim = new Simulacao(pacoteA, 'AbcProximidade');
    expect(resultadoDaPartida(sim.snapshot(), pacoteA.cenario, sim.rastro())).toBeNull();
    for (let i = 0; i < 3600; i++) sim.tick();
    sim.setPolitica('FifoPrimeiraLivre');
    while (!sim.terminado) sim.tick();
    const s = sim.snapshot();
    const r = resultadoDaPartida(s, pacoteA.cenario, sim.rastro())!;
    expect(r.cenarioCodigo).toBe('WH-A-PEQUENO');
    expect(r.politicaInicial).toBe('AbcProximidade');
    expect(r.politicaFinal).toBe('FifoPrimeiraLivre');
    expect(r.trocasPolitica).toEqual(sim.trocasPolitica());
    expect(r.trocasPolitica).not.toBe(s.trocasPolitica);
    expect(r.metricas).toEqual(sim.metricas());
    expect(r.ordensConcluidas).toBe(s.ordensConcluidas);
    expect(r.rastro).toEqual(sim.rastro());
    expect(r.rastro).not.toBe(sim.rastro()); // cópia: sobrevive ao motor
    // o resultado reproduz o score oficial a partir das métricas
    const oficial = score(r.metricas);
    expect(r.scoreCentesimos).toBe(oficial.scoreCentesimos);
    expect(r.penalidades).toEqual(oficial.penalidades);
  });

  it('o breakdown de uma partida de verdade fecha com o score', () => {
    const sim = new Simulacao(pacoteA, 'FifoPrimeiraLivre');
    while (!sim.terminado) sim.tick();
    const r = resultadoDaPartida(sim.snapshot(), pacoteA.cenario, sim.rastro())!;
    const b = montarBreakdown(r.metricas, r.penalidades, r.scoreCentesimos);
    const bruto = b.base - b.totalPenalidades + b.bonus;
    expect(b.scoreCentesimos).toBe(Math.min(10_000, bruto));
    expect(b.limitadoNoTeto).toBe(bruto > 10_000);
  });
});

describe('segmentosPolitica', () => {
  it('uma política o turno inteiro', () => {
    expect(segmentosPolitica([{ seg: 28800, politica: 'WmsReal' }], 64800)).toEqual([
      { politica: 'WmsReal', deSeg: 28800, ateSeg: 64800, duracaoSeg: 36000, fracao: 1 },
    ]);
  });

  it('trocas viram trechos contíguos que somam o turno', () => {
    const seg = segmentosPolitica([
      { seg: 28800, politica: 'AbcProximidade' }, { seg: 36000, politica: 'Consolidacao' }, { seg: 50400, politica: 'CrossDocking' },
    ], 64800);
    expect(seg.map(s => [s.deSeg, s.ateSeg])).toEqual([[28800, 36000], [36000, 50400], [50400, 64800]]);
    expect(seg.map(s => s.duracaoSeg)).toEqual([7200, 14400, 14400]);
    expect(seg.reduce((n, s) => n + s.fracao, 0)).toBeCloseTo(1, 10);
    expect(seg[0].fracao).toBeCloseTo(0.2, 10);
  });

  it('sem trocas devolve vazio; turno de duração zero divide por igual', () => {
    expect(segmentosPolitica([], 100)).toEqual([]);
    expect(segmentosPolitica([{ seg: 100, politica: 'WmsReal' }], 100)[0].fracao).toBe(1);
  });
});

describe('estadoEnvio e origem', () => {
  it('sem extras (ou sem validadoServidor): partida local', () => {
    expect(estadoEnvio().tipo).toBe('local');
    expect(estadoEnvio().texto).toBe('Partida local — não enviada ao ranking.');
    expect(estadoEnvio({ origem: 'embutido', mensagem: 'x' }).tipo).toBe('local');
  });

  it('validado e não validado, com posição no ranking', () => {
    expect(estadoEnvio({ validadoServidor: true, posicaoRanking: 3 })).toEqual({ tipo: 'validado', texto: 'Score validado pelo servidor. Você ficou em 3º lugar no ranking.' });
    expect(estadoEnvio({ validadoServidor: false }).tipo).toBe('naoValidado');
  });

  it('envio em andamento, guardado, recusado ou perdido: cada um tem o seu aviso (nunca "local")', () => {
    expect(estadoEnvio({ envio: 'enviando' })).toEqual({ tipo: 'enviando', texto: 'Enviando a partida ao servidor…' });
    expect(estadoEnvio({ envio: 'pendente' }).tipo).toBe('pendente');
    expect(estadoEnvio({ envio: 'pendente' }).texto).toMatch(/fila de envio/);
    expect(estadoEnvio({ envio: 'recusada' }).tipo).toBe('recusada');
    expect(estadoEnvio({ envio: 'falhou' }).texto).toMatch(/nem guardar/);
  });

  it('o veredito do servidor vale mais que o estado do envio', () => {
    expect(estadoEnvio({ envio: 'enviando', validadoServidor: true }).tipo).toBe('validado');
  });

  it('rótulo da origem: conhecido, livre ou ausente', () => {
    expect(rotuloOrigem('embutido')).toBe('Embutido (offline)');
    expect(rotuloOrigem('rede')).toBe('Servidor');
    expect(rotuloOrigem('outra coisa')).toBe('outra coisa');
    expect(rotuloOrigem(undefined)).toBeNull();
  });
});
