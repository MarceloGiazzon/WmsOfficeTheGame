// Fórmula oficial do score (README §6, teto de 100) — porta de SimulacaoCapability.calcularScore (Java).
// Tudo em inteiros: centésimos, arredondamento "meio para cima" em cada termo.
// Casos de referência compartilhados com o Java: backend/npdev/tests/fixtures/score-cases.json.

import type { Metricas } from './model';

export const MAX_SCORE = 10_000;
const MAX_P_DIST = 3_500;
const PESO_ATRASO = 4_000;
const MAX_P_CONFLITO = 1_500;
const P_POR_CONFLITO = 150;
const BONUS_OCUPACAO = 500;
const OCUPACAO_MIN = 7_500;
const OCUPACAO_MAX = 8_800;

export interface Penalidades {
  distancia: number;
  atraso: number;
  conflito: number;
  bonusOcupacao: number;
}

export type ResultadoScore =
  | { sucesso: true; scoreCentesimos: number; penalidades: Penalidades }
  | { sucesso: false; motivo: string };

/** Divisão inteira com arredondamento meio-para-cima (num, den >= 0; den > 0). Usa BigInt: num pode passar de 2^53. */
function divRound(num: bigint, den: bigint): number {
  return Number((2n * num + den) / (2n * den));
}

function validar(m: Metricas): string | null {
  const campos: (keyof Metricas)[] = ['distanciaRealCm', 'distanciaTeoricaCm', 'ordensTotal', 'ordensAtrasadas',
    'eventosConflito', 'ocupacaoFinalCentesimos'];
  for (const c of campos) {
    const v = m[c];
    if (v === undefined || v === null) return `metrica obrigatoria ausente: ${c}`;
    if (!Number.isInteger(v)) return `metrica deve ser inteira: ${c}`;
    if (v < 0) return `metrica negativa: ${c}`;
  }
  if (m.ordensTotal <= 0) return 'ordensTotal deve ser > 0';
  if (m.ordensAtrasadas > m.ordensTotal) return 'ordensAtrasadas > ordensTotal';
  if (m.ocupacaoFinalCentesimos > 10_000) return 'ocupacaoFinalCentesimos > 10000';
  return null;
}

export function calcularScore(m: Metricas): ResultadoScore {
  const erro = validar(m);
  if (erro) return { sucesso: false, motivo: erro };

  let distancia: number;
  if (m.distanciaTeoricaCm === 0) {
    distancia = m.distanciaRealCm === 0 ? 0 : MAX_P_DIST;
  } else {
    const excesso = BigInt(Math.max(0, m.distanciaRealCm - m.distanciaTeoricaCm));
    distancia = Math.min(MAX_P_DIST, divRound(excesso * BigInt(MAX_P_DIST), BigInt(m.distanciaTeoricaCm)));
  }
  const atraso = divRound(BigInt(m.ordensAtrasadas) * BigInt(PESO_ATRASO), BigInt(m.ordensTotal));
  const conflito = Math.min(MAX_P_CONFLITO, m.eventosConflito * P_POR_CONFLITO);
  const bonusOcupacao = m.ocupacaoFinalCentesimos >= OCUPACAO_MIN && m.ocupacaoFinalCentesimos <= OCUPACAO_MAX
    ? BONUS_OCUPACAO : 0;
  const scoreCentesimos = Math.min(MAX_SCORE, Math.max(0, MAX_SCORE - (distancia + atraso + conflito)) + bonusOcupacao);
  return { sucesso: true, scoreCentesimos, penalidades: { distancia, atraso, conflito, bonusOcupacao } };
}
