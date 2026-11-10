// Converte tempo real em ticks da simulação (passo fixo de 1 s simulado).
// A sim continua determinística: a velocidade só muda QUANTOS ticks rodam por frame, nunca o tamanho do passo.

/** 1x = 30 s simulados por segundo real: um turno de 10 h dura 20 min. */
export const SEGUNDOS_SIM_POR_SEGUNDO_REAL = 30;
export const VELOCIDADES = [0, 1, 2, 5] as const;
export type Velocidade = (typeof VELOCIDADES)[number];

/** Teto de ticks por frame: depois de uma aba em segundo plano, não tenta recuperar horas de uma vez. */
const MAX_TICKS_POR_FRAME = 600;

export class Relogio {
  private acumuladoSeg = 0;
  velocidade: Velocidade = 1;

  /** Recebe o tempo real decorrido (ms) e devolve quantos ticks rodar agora. */
  avancar(dtRealMs: number): number {
    if (this.velocidade === 0 || dtRealMs <= 0) return 0;
    this.acumuladoSeg += (dtRealMs / 1000) * SEGUNDOS_SIM_POR_SEGUNDO_REAL * this.velocidade;
    // tolerância: somas de frações (ex.: 125 × 0,24) dão 29,999…; sem ela, o tick "atrasaria" um frame
    const ticks = Math.floor(this.acumuladoSeg + 1e-9);
    this.acumuladoSeg -= ticks;
    if (ticks > MAX_TICKS_POR_FRAME) {
      this.acumuladoSeg = 0;
      return MAX_TICKS_POR_FRAME;
    }
    return ticks;
  }
}
