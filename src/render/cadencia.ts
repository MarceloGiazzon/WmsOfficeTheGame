// Limita a frequência de um trabalho caro (atualizar DOM) dentro do laço de quadros, que roda a 60 Hz ou mais.
// Mexer em textContent a cada quadro invalida estilo/layout da página inteira: o jogador não distingue 10 Hz de
// 60 Hz em números de KPI, mas o navegador sente a diferença (era ~12% da thread principal no WH-B a 5x).

/** Intervalo padrão da UI (HUD e log): ~10 Hz. */
export const INTERVALO_UI_MS = 100;

export class Cadencia {
  private ultimoMs = -Infinity;
  private fonte: unknown = undefined;
  private versao = NaN;

  constructor(private readonly intervaloMs: number) {}

  /**
   * `true` no máximo uma vez por intervalo. Com `fonte`/`versao`, só quando algo mudou desde a última vez que
   * deixou passar (ex.: a simulação trocou ou o relógio dela andou) — pausado, a UI para de ser tocada.
   * Se o intervalo não passou, a mudança fica pendente e passa assim que o intervalo vencer.
   */
  pronto(agoraMs: number, fonte?: unknown, versao = 0): boolean {
    if (agoraMs - this.ultimoMs < this.intervaloMs) return false;
    if (fonte !== undefined && fonte === this.fonte && versao === this.versao) return false;
    this.ultimoMs = agoraMs;
    this.fonte = fonte;
    this.versao = versao;
    return true;
  }
}
