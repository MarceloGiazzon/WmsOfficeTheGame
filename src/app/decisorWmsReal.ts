// WmsReal online (D2): quem decide o destino de cada palete é o servidor — o flow `SugerirDestinoJogo`, a
// `AllocationCapability.sugerirDestino` em Java —, e a porta TS (`src/sim/wmsReal.ts`) é o plano B e o conferente.
//
//   motor (Simulacao.tickSuspenso) ──consulta──► DecisorWmsReal ──► servidor (só a faixa de melhor prioridade)
//                                                     │               │
//                                                     │ ◄─ resposta ──┘   compara com a porta TS sobre a lista inteira
//                                                     └─ falhou? ► porta TS (o resto do turno, sem insistir)
//
// Regras deste módulo:
//  - O servidor manda: a resposta dele é o destino, mesmo quando difere da porta TS (isso é contado e aparece no resultado).
//  - Qualquer falha (rede, prazo, sessão, formato, "sem sucesso") vale UMA vez por turno: o palete daquela decisão e todos
//    os seguintes usam a porta TS, que é a mesma regra (o teste de paridade confere). Nada de insistir com o jogo parado.
//  - Sem login não há pergunta: é o jogo offline de sempre, e o resultado diz isso.
//  - Nada daqui rejeita: o motor nunca fica esperando uma promessa que não resolve.

import { NpdevError } from '../net/erros';
import { sugerirDestinoNoServidor } from '../net/alocacao';
import type { Http } from '../net/npdevClient';
import type { ConsultaDestino, DecisorDestino } from '../sim/simulation';
import { candidatosQueConcorrem, sugerirDestino } from '../sim/wmsReal';
import { causaEmPoucasPalavras } from './mensagensRede';

/**
 * Prazo de cada pergunta. O jogo fica parado esperando, então é curto: bem mais que os ~45 ms de uma resposta normal, e
 * menos que os ~3 s da primeira chamada depois de o servidor subir (para isso existe `aquecer`).
 */
export const PRAZO_DECISAO_MS = 6_000;
const PRAZO_AQUECIMENTO_MS = 15_000;
const TENTATIVAS_AQUECIMENTO = 3;

export interface EstatisticaDecisoes {
  /** Destinos que o servidor escolheu (e o jogo seguiu). */
  servidor: number;
  /** Destinos que a porta TS escolheu: sem login, ou depois da falha do servidor. */
  local: number;
  /** Das escolhas do servidor, quantas foram diferentes da porta TS (o jogo seguiu o servidor). */
  divergencias: number;
  /** A causa da primeira falha do servidor neste turno (frase curta, minúscula), ou null se não houve. */
  falha: string | null;
}

export interface OpcoesDecisor {
  prazoMs?: number;
  /** Uma pergunta ao servidor começou (true) ou terminou (false): o jogo está parado esperando. */
  aoAguardar?: (aguardando: boolean) => void;
  /** O servidor falhou pela primeira vez: o resto do turno usa a porta TS. `erro` é o original (para a UI distinguir sessão vencida). */
  aoFalhar?: (causa: string, erro: unknown) => void;
}

export class DecisorWmsReal {
  private readonly prazoMs: number;
  private servidor = 0;
  private local = 0;
  private divergencias = 0;
  private falha: string | null = null;
  private parado = false;
  private aquecido = false;
  private esperando = false;

  constructor(private readonly http: Http, private readonly opcoes: OpcoesDecisor = {}) {
    this.prazoMs = opcoes.prazoMs ?? PRAZO_DECISAO_MS;
  }

  get estatistica(): Readonly<EstatisticaDecisoes> {
    return { servidor: this.servidor, local: this.local, divergencias: this.divergencias, falha: this.falha };
  }

  /**
   * Faz uma pergunta à toa para o servidor no começo do turno: a primeira chamada de flow depois de ele subir leva ~3 s
   * (e pode falhar uma vez), e é melhor que isso aconteça antes de o jogo depender da resposta. Sem login não faz nada.
   * A resposta é descartada; falhar aqui não conta como falha do turno.
   */
  aquecer(): void {
    if (this.aquecido || this.parado || !this.http.logado) return;
    this.aquecido = true; // uma vez por turno: quem chama (início do turno, troca para WmsReal) não precisa se coordenar
    void (async () => {
      for (let i = 0; i < TENTATIVAS_AQUECIMENTO && !this.parado; i++) {
        try {
          await sugerirDestinoNoServidor(this.http, { loteId: 'aquecimento', candidatos: [{ localArmazenagemId: 'a', prioridade: 1 }] }, { timeoutMs: PRAZO_AQUECIMENTO_MS });
          return;
        } catch { /* tenta de novo; no pior caso a primeira decisão paga o aquecimento */ }
      }
    })();
  }

  /**
   * O turno acabou ou foi abandonado: não pergunta mais nada, a espera em curso é dada por encerrada e este decisor não
   * avisa mais a UI (que já pode estar esperando o decisor do turno seguinte). A pergunta em voo é respondida com a porta
   * TS quando chegar.
   */
  parar(): void {
    this.parado = true;
    if (this.esperando) { this.esperando = false; this.opcoes.aoAguardar?.(false); }
  }

  /** O decisor que o motor usa. */
  readonly decidir: DecisorDestino = (c: ConsultaDestino): string | null | Promise<string | null> => {
    const regraLocal = portaTs(c);
    if (this.parado || this.falha !== null || !this.http.logado) {
      this.local++;
      return regraLocal;
    }
    return this.perguntar(c, regraLocal);
  };

  private async perguntar(c: ConsultaDestino, regraLocal: string | null): Promise<string | null> {
    this.esperando = true;
    this.opcoes.aoAguardar?.(true);
    try {
      // Só a faixa de melhor prioridade pode ganhar (candidatosQueConcorrem): a WH-B manda ~dezenas em vez de ~570 locais.
      const r = await sugerirDestinoNoServidor(
        this.http, { loteId: c.loteId, candidatos: candidatosQueConcorrem(c.loteId, c.candidatos) }, { timeoutMs: this.prazoMs });
      if (!r.sucesso || r.localArmazenagemId === null) {
        throw new NpdevError('resposta_invalida', 'O servidor não escolheu nenhum local para o palete.');
      }
      if (this.parado) { this.local++; return regraLocal; }
      this.servidor++;
      if (r.localArmazenagemId !== regraLocal) this.divergencias++;
      return r.localArmazenagemId;
    } catch (e) {
      this.registrarFalha(e);
      this.local++;
      return regraLocal;
    } finally {
      if (this.esperando) { this.esperando = false; this.opcoes.aoAguardar?.(false); }
    }
  }

  private registrarFalha(e: unknown): void {
    if (this.falha !== null || this.parado) return;
    this.falha = causaEmPoucasPalavras(e);
    this.opcoes.aoFalhar?.(this.falha, e);
  }
}

/** A escolha da porta TS sobre TODOS os candidatos: o plano B e a régua para conferir o servidor. */
function portaTs(c: ConsultaDestino): string | null {
  const r = sugerirDestino(null, { loteId: c.loteId, candidatos: [...c.candidatos] });
  return r.sucesso ? r.localArmazenagemId : null;
}

/**
 * Uma ou duas frases para a tela de resultado dizendo DE ONDE vieram os destinos do WmsReal neste turno, ou null se
 * a política não decidiu nenhum palete (o aviso só existe para quem jogou WmsReal). Honesto: divergência e queda do
 * servidor aparecem, não são escondidas.
 */
export function resumoDecisoes(e: Readonly<EstatisticaDecisoes>): string | null {
  const total = e.servidor + e.local;
  if (total === 0) return null;
  const n = (x: number) => `${x} ${x === 1 ? 'palete' : 'paletes'}`;
  if (e.falha !== null) {
    return `WMS Office Real: ${e.servidor === 0 ? 'o servidor não respondeu' : `o servidor respondeu por ${n(e.servidor)} e depois parou`} (${e.falha}); ` +
      `${e.servidor === 0 ? n(e.local) : `os outros ${e.local}`} foram guardados pela regra do jogo, que é a mesma do servidor.` +
      (e.divergencias > 0 ? ` Em ${e.divergencias} das respostas do servidor, a escolha foi diferente da regra do jogo; o jogo seguiu o servidor.` : '');
  }
  if (e.servidor === 0) {
    return `WMS Office Real jogada sem o servidor: ${n(e.local)} foram guardados pela regra do jogo (a mesma regra, executada neste aparelho).`;
  }
  const alvo = total === e.servidor ? (total === 1 ? 'do único palete' : `de todos os ${total} paletes`) : `de ${n(e.servidor)}`;
  const origem = `WMS Office Real: o servidor escolheu o destino ${alvo}` +
    (e.local > 0 ? `; ${e.local === 1 ? 'o outro veio' : `os outros ${e.local} vieram`} da regra do jogo.` : '.');
  if (e.divergencias > 0) {
    return `${origem} Em ${e.divergencias} delas a escolha do servidor foi diferente da regra do jogo; o jogo seguiu o servidor.`;
  }
  const igual = e.local > 0 ? 'As do servidor foram iguais à regra do jogo.' : total === 1 ? 'Igual à regra do jogo.' : 'Todas iguais à regra do jogo.';
  return `${origem} ${igual}`;
}
