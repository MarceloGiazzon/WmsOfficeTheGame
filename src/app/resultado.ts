// Resultado de uma partida: o que a tela final mostra, em módulo puro (sem DOM) para ser testado.
//
//   Snapshot final ─► resultadoDaPartida() ─► ResultadoPartida ─► montarBreakdown() / segmentosPolitica()
//
// `ResultadoPartida` é também o que a F5 manda ao servidor (`ConcluirPartida`): métricas + política + trocas.

import type { Cenario, Dificuldade, Metricas, Politica } from '../sim/model';
import type { Penalidades } from '../sim/score';
import type { Snapshot, TrocaPolitica } from '../sim/simulation';
import { formatarCentesimos, formatarKm, formatarPercentual, plural } from './formato';
import { ROTULO_ORIGEM, type OrigemCenario } from './fonteCenarios';

// ---------------------------------------------------------------- resultado

export interface ResultadoPartida {
  cenarioCodigo: string;
  cenarioNome: string;
  dificuldade: Dificuldade;
  politicaInicial: Politica;
  politicaFinal: Politica;
  /** Da inicial (em `inicioTurnoSeg`) até a última. Copiado: sobrevive ao snapshot. */
  trocasPolitica: TrocaPolitica[];
  inicioTurnoSeg: number;
  fimTurnoSeg: number;
  metricas: Metricas;
  ordensConcluidas: number;
  scoreCentesimos: number;
  penalidades: Penalidades;
}

/** Resultado do turno que acabou, ou null se o turno ainda não terminou ou o score não pôde ser calculado. */
export function resultadoDaPartida(s: Snapshot, cenario: Cenario): ResultadoPartida | null {
  if (!s.terminado || !s.score.sucesso) return null;
  const trocas = s.trocasPolitica.map(t => ({ ...t }));
  return {
    cenarioCodigo: cenario.codigo,
    cenarioNome: cenario.nome,
    dificuldade: cenario.dificuldade,
    politicaInicial: trocas[0]?.politica ?? s.politica,
    politicaFinal: s.politica,
    trocasPolitica: trocas,
    inicioTurnoSeg: s.inicioTurnoSeg,
    fimTurnoSeg: s.fimTurnoSeg,
    metricas: { ...s.metricas },
    ordensConcluidas: s.ordensConcluidas,
    scoreCentesimos: s.score.scoreCentesimos,
    penalidades: { ...s.score.penalidades },
  };
}

// ---------------------------------------------------------------- breakdown do score

/**
 * Limites da fórmula oficial (`score.ts`), para a explicação e a barra de cada termo. `score.ts` não exporta suas
 * constantes (e não é daqui mexer nele), então `resultado.test.ts` confere estes números contra `calcularScore`:
 * se a regra mudar lá, o teste quebra aqui.
 */
export const LIMITES_SCORE = {
  base: 10_000,
  distancia: 3_500,
  atraso: 4_000,
  conflito: 1_500,
  conflitoPorEvento: 150,
  bonusOcupacao: 500,
  ocupacaoMin: 7_500,
  ocupacaoMax: 8_800,
} as const;

export type IdTermo = 'distancia' | 'atraso' | 'conflito' | 'ocupacao';

export interface LinhaBreakdown {
  id: IdTermo;
  rotulo: string;
  tipo: 'penalidade' | 'bonus';
  /** Quanto o termo vale (centésimos): o que custou, ou o que o bônus rendeu. */
  centesimos: number;
  /** O máximo que o termo poderia valer (centésimos). A barra é `centesimos / maximo`. */
  maximo: number;
  /** Uma frase em linguagem simples, com os números desta partida. */
  explicacao: string;
}

export interface Breakdown {
  base: number;
  linhas: LinhaBreakdown[];
  totalPenalidades: number;
  bonus: number;
  /** O teto de 100 entrou em ação (bônus de ocupação empurrou o score para além de 100). */
  limitadoNoTeto: boolean;
  scoreCentesimos: number;
}

const pts = (c: number): string => `${formatarCentesimos(c)} pt`;

function explicarDistancia(m: Metricas): string {
  const { distanciaRealCm: real, distanciaTeoricaCm: teorica } = m;
  if (teorica === 0) {
    return real === 0 ? 'Nenhum deslocamento.' : `Percorreu ${formatarKm(real)} e o cenário não tem distância teórica de referência: penalidade máxima.`;
  }
  const regra = `Cada 1% a mais custa ${pts(LIMITES_SCORE.distancia / 100)}; com 100% a mais ou pior, o máximo de ${pts(LIMITES_SCORE.distancia)}.`;
  if (real <= teorica) return `Percorreu ${formatarKm(real)}, dentro do mínimo teórico de ${formatarKm(teorica)}: sem penalidade. ${regra}`;
  const acima = Math.round(((real - teorica) * 100) / teorica);
  return `Percorreu ${formatarKm(real)} contra ${formatarKm(teorica)} do melhor caso teórico (${acima}% a mais). ${regra}`;
}

function explicarAtraso(m: Metricas): string {
  const { ordensAtrasadas: n, ordensTotal: total } = m;
  const cada = Math.round(LIMITES_SCORE.atraso / total);
  const regra = `Cada ordem fora do SLA custa ${pts(cada)} (${pts(LIMITES_SCORE.atraso)} se todas atrasarem).`;
  if (n === 0) return `Nenhuma das ${total} ordens atrasou: sem penalidade. ${regra}`;
  const centesimos = Math.round((n * 10_000) / total);
  const pct = centesimos < 100 ? 'menos de 1%' : formatarPercentual(centesimos); // 1 de 400 não é "0%"
  return `${n} de ${plural(total, 'ordem', 'ordens')} atrasaram (${pct}). ${regra}`;
}

function explicarConflito(m: Metricas): string {
  const n = m.eventosConflito;
  const max = LIMITES_SCORE.conflito / LIMITES_SCORE.conflitoPorEvento;
  const regra = `Cada espera custa ${pts(LIMITES_SCORE.conflitoPorEvento)}; o máximo é ${pts(LIMITES_SCORE.conflito)} (${max} esperas).`;
  if (n === 0) return `Nenhuma empilhadeira esperou corredor ocupado: sem penalidade. ${regra}`;
  return `${plural(n, 'espera', 'esperas')} por corredor ocupado. ${regra}`;
}

function explicarOcupacao(m: Metricas): string {
  const faixa = `${formatarPercentual(LIMITES_SCORE.ocupacaoMin)} e ${formatarPercentual(LIMITES_SCORE.ocupacaoMax)}`;
  const dentro = m.ocupacaoFinalCentesimos >= LIMITES_SCORE.ocupacaoMin && m.ocupacaoFinalCentesimos <= LIMITES_SCORE.ocupacaoMax;
  return `O armazém terminou com ${formatarPercentual(m.ocupacaoFinalCentesimos)} dos locais ocupados. ` +
    `Ganha +${pts(LIMITES_SCORE.bonusOcupacao)} quem termina entre ${faixa}${dentro ? ': este turno ganhou.' : '.'}`;
}

/** As quatro parcelas do score, com explicação, na ordem em que entram na conta. `p` vem de `calcularScore`. */
export function montarBreakdown(m: Metricas, p: Penalidades, scoreCentesimos: number): Breakdown {
  const linhas: LinhaBreakdown[] = [
    { id: 'distancia', rotulo: 'Distância percorrida', tipo: 'penalidade', centesimos: p.distancia, maximo: LIMITES_SCORE.distancia, explicacao: explicarDistancia(m) },
    { id: 'atraso', rotulo: 'Ordens atrasadas', tipo: 'penalidade', centesimos: p.atraso, maximo: LIMITES_SCORE.atraso, explicacao: explicarAtraso(m) },
    { id: 'conflito', rotulo: 'Conflitos de corredor', tipo: 'penalidade', centesimos: p.conflito, maximo: LIMITES_SCORE.conflito, explicacao: explicarConflito(m) },
    { id: 'ocupacao', rotulo: 'Bônus de ocupação', tipo: 'bonus', centesimos: p.bonusOcupacao, maximo: LIMITES_SCORE.bonusOcupacao, explicacao: explicarOcupacao(m) },
  ];
  const totalPenalidades = p.distancia + p.atraso + p.conflito;
  return {
    base: LIMITES_SCORE.base,
    linhas,
    totalPenalidades,
    bonus: p.bonusOcupacao,
    limitadoNoTeto: LIMITES_SCORE.base - totalPenalidades + p.bonusOcupacao > LIMITES_SCORE.base,
    scoreCentesimos,
  };
}

// ---------------------------------------------------------------- linha do tempo das políticas

export interface SegmentoPolitica {
  politica: Politica;
  deSeg: number;
  ateSeg: number;
  duracaoSeg: number;
  /** Fatia do turno (0–1); a soma dos segmentos é 1. */
  fracao: number;
}

/** Trechos do turno em que cada política valeu, do início do turno (primeira troca) a `fimSeg`. */
export function segmentosPolitica(trocas: readonly TrocaPolitica[], fimSeg: number): SegmentoPolitica[] {
  if (trocas.length === 0) return [];
  const inicio = trocas[0].seg;
  const total = Math.max(0, fimSeg - inicio);
  return trocas.map((t, i) => {
    const ate = Math.min(fimSeg, trocas[i + 1]?.seg ?? fimSeg);
    const duracaoSeg = Math.max(0, ate - t.seg);
    return {
      politica: t.politica, deSeg: t.seg, ateSeg: Math.max(t.seg, ate), duracaoSeg,
      fracao: total > 0 ? duracaoSeg / total : 1 / trocas.length,
    };
  });
}

// ---------------------------------------------------------------- extras do servidor (F5)

export interface LinhaRanking {
  jogador: string;
  scoreCentesimos: number;
  distanciaCm: number;
}

/**
 * O que a F5 acrescenta ao resultado depois de enviar a partida. Tudo opcional: sem extras (ou sem
 * `validadoServidor`) a tela mostra "partida local" — é o modo offline.
 */
export interface ExtrasResultado {
  /** Presente = a partida foi enviada. true: o servidor recalculou e bateu; false: enviou, mas o score não bateu. */
  validadoServidor?: boolean;
  /** 1 = primeiro lugar. */
  posicaoRanking?: number;
  ranking?: LinhaRanking[];
  /** Texto livre do servidor/cliente (ex.: "Enviada ao ranking", "Sem rede: partida na fila de envio"). */
  mensagem?: string;
  /** Origem do cenário ('embutido' | 'cache' | 'rede') ou texto livre. */
  origem?: string;
}

export interface EstadoEnvio {
  tipo: 'local' | 'validado' | 'naoValidado';
  texto: string;
}

export function estadoEnvio(extras?: ExtrasResultado): EstadoEnvio {
  if (extras?.validadoServidor === undefined) return { tipo: 'local', texto: 'Partida local — não enviada ao ranking.' };
  const pos = extras.posicaoRanking !== undefined ? ` Você ficou em ${extras.posicaoRanking}º lugar no ranking.` : '';
  return extras.validadoServidor
    ? { tipo: 'validado', texto: `Score validado pelo servidor.${pos}` }
    : { tipo: 'naoValidado', texto: `O servidor recalculou um score diferente: esta partida não entra no ranking.${pos}` };
}

/** Selo de origem do cenário: rótulo conhecido ou o texto como veio. */
export function rotuloOrigem(origem: string | undefined): string | null {
  if (!origem) return null;
  return ROTULO_ORIGEM[origem as OrigemCenario] ?? origem;
}
