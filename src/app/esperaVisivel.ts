// "Aguardando o servidor…" só aparece se a espera durar: o jogo pergunta ao servidor a cada palete (algumas centenas por
// turno) e uma resposta normal leva ~45 ms; mostrar o aviso a cada pergunta o faria piscar o tempo todo.

/** Quanto a espera precisa durar para o jogador ser avisado. */
export const ATRASO_AVISO_ESPERA_MS = 350;

export class EsperaVisivel {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private visivel = false;

  constructor(private readonly mostrar: (visivel: boolean) => void, private readonly atrasoMs = ATRASO_AVISO_ESPERA_MS) {}

  /** Começou uma espera. Esperas seguidas (uma pergunta logo depois da outra) contam como uma só: o prazo não reinicia. */
  iniciar(): void {
    if (this.visivel || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.visivel = true;
      this.mostrar(true);
    }, this.atrasoMs);
  }

  /** A espera acabou: some o aviso (ou cancela o que ainda não apareceu). */
  terminar(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.visivel) { this.visivel = false; this.mostrar(false); }
  }
}
