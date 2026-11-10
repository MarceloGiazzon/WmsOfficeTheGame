// Estado e gatilhos do envio das partidas guardadas (a fila de `src/net/filaEnvio.ts`). Sem DOM.
//
// Quem chama `sincronizar()`: o login, o evento `online` do navegador, a abertura do jogo (se houver sessão), o fim de
// cada partida e o botão "Enviar agora". A fila já junta chamadas simultâneas numa rodada só, então chamar de vários
// lugares é seguro; aqui fica o que a UI precisa saber: quantas pendem, quantas foram rejeitadas, se há rodada em
// curso e o que aconteceu na última.
//
// Quando uma rodada para por falha de rede/servidor com partidas ainda na fila, o sincronizador tenta de novo sozinho,
// com espera crescente (backoff exponencial, com teto e um pouco de aleatoriedade para não bater todos os aparelhos no
// servidor ao mesmo tempo). Qualquer chamada de fora (login, `online`, "Enviar agora", fim de partida) recomeça a
// contagem. Só as tentativas que enviam ou rejeitam algo avisam o jogador; as que falham de novo ficam em silêncio.

import { ehNpdevError } from '../net/erros';
import type { FilaEnvio, ItemFila, ResultadoSincronizacao } from '../net/filaEnvio';
import type { Http } from '../net/npdevClient';
import type { Abandonos } from './abandonos';
import { formatarScore, plural } from './formato';
import { mensagemDeErro } from './mensagensRede';

export interface EstadoSincronizacao {
  pendentes: number;
  rejeitados: number;
  sincronizando: boolean;
  /** Frase sobre a última rodada ("2 partidas enviadas", "Sem conexão…"); `null` = ainda nada a dizer. */
  ultimaMensagem: string | null;
  /** A última rodada terminou por falha de rede/servidor (as pendentes seguem na fila). */
  ultimaFalhou: boolean;
  /** Espera (ms) da retentativa automática agendada; `null` = nenhuma agendada. */
  proximaTentativaEmMs: number | null;
}

/** Primeira espera e teto da retentativa automática (a n-ésima espera é `base × 2^(n-1)`, até o teto). */
export const RETENTATIVA_BASE_MS = 5_000;
export const RETENTATIVA_TETO_MS = 5 * 60_000;

/** Espera antes da retentativa automática nº `tentativa` (1, 2, 3…): exponencial, com teto, ±20% de aleatoriedade (`aleatorio` em [0, 1)). */
export function atrasoDeRetentativaMs(tentativa: number, aleatorio: () => number = Math.random): number {
  const bruto = Math.min(RETENTATIVA_TETO_MS, RETENTATIVA_BASE_MS * 2 ** Math.max(0, tentativa - 1));
  return Math.round(bruto * (0.8 + 0.4 * aleatorio()));
}

export interface OpcoesSincronizador {
  abandonos?: Pick<Abandonos, 'tentar'>;
  /** Depois de cada rodada que enviou ou rejeitou algo (a UI avisa com um aviso temporário). */
  aoRodada?: (r: ResultadoSincronizacao, mensagem: string) => void;
  /** Agenda `fn` daqui a `ms`; devolve o cancelamento. Padrão: `setTimeout` (os testes injetam um relógio falso). */
  agendar?: (fn: () => void, ms: number) => () => void;
  /** Espera antes da retentativa automática nº `tentativa` (1, 2, 3…). Padrão: `atrasoDeRetentativaMs`. */
  atraso?: (tentativa: number) => number;
}

function agendarPadrao(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

export class Sincronizador {
  private atual: EstadoSincronizacao = { pendentes: 0, rejeitados: 0, sincronizando: false, ultimaMensagem: null, ultimaFalhou: false, proximaTentativaEmMs: null };
  private cancelarRetentativa: (() => void) | null = null;
  private tentativas = 0;
  private readonly observadores = new Set<(e: EstadoSincronizacao) => void>();
  private desligar: (() => void) | null = null;

  constructor(private readonly fila: Pick<FilaEnvio, 'sincronizar' | 'resumo' | 'observar'>, private readonly http: Http, private readonly opcoes: OpcoesSincronizador = {}) {}

  get estado(): EstadoSincronizacao {
    return { ...this.atual };
  }

  observar(ouvinte: (e: EstadoSincronizacao) => void): () => void {
    this.observadores.add(ouvinte);
    return () => { this.observadores.delete(ouvinte); };
  }

  /** Começa a acompanhar a fila (contagens) e lê o estado atual. Idempotente. */
  async iniciar(): Promise<void> {
    if (!this.desligar) this.desligar = this.fila.observar(r => this.mudar({ pendentes: r.pendentes, rejeitados: r.rejeitados }));
    await this.atualizar();
  }

  /** Relê as contagens (ao entrar/sair: a fila conta por jogador, e "quem sou eu" mudou). */
  async atualizar(): Promise<void> {
    if (!this.http.logado) this.desistirDaRetentativa(); // saiu/expirou: não há mais o que reenviar sozinho
    try {
      const r = await this.fila.resumo();
      this.mudar({ pendentes: r.pendentes, rejeitados: r.rejeitados });
    } catch { /* armazenamento indisponível: o indicador fica como estava */ }
  }

  /**
   * Envia o que está na fila. Sem login não faz nada (convidado não chama a rede) e diz por quê. Nunca lança.
   * Devolve o resultado da rodada, ou `null` se não houve rodada.
   */
  async sincronizar(): Promise<ResultadoSincronizacao | null> {
    this.desistirDaRetentativa(); // alguém pediu agora: a contagem do backoff recomeça
    return this.rodar();
  }

  private async rodar(): Promise<ResultadoSincronizacao | null> {
    if (!this.http.logado) {
      this.mudar({ ultimaMensagem: this.atual.pendentes > 0 ? 'Entre para enviar as partidas guardadas.' : null, ultimaFalhou: false });
      return null;
    }
    this.mudar({ sincronizando: true });
    try {
      await this.opcoes.abandonos?.tentar();
      const r = await this.fila.sincronizar();
      const mensagem = descreverRodada(r);
      this.mudar({ pendentes: r.pendentes, ultimaMensagem: mensagem, ultimaFalhou: r.erro !== null });
      if (r.enviados.length > 0 || r.rejeitados.length > 0) this.opcoes.aoRodada?.(r, mensagem);
      if (r.erro !== null && r.pendentes > 0 && ehNpdevError(r.erro) && r.erro.recuperavel) this.agendarRetentativa();
      else this.tentativas = 0; // enviou tudo, ou a falha não se resolve esperando
      void this.atualizar(); // `rejeitados` não vem na rodada
      return r;
    } catch (e) {
      // a fila só lança erro de programação; o indicador precisa dizer que não enviou
      this.mudar({ ultimaMensagem: `Não foi possível enviar agora: ${mensagemDeErro(e)}`, ultimaFalhou: true });
      return null;
    } finally {
      this.mudar({ sincronizando: false });
    }
  }

  private agendarRetentativa(): void {
    if (!this.http.logado) return;
    this.cancelarRetentativa?.();
    this.tentativas++;
    const espera = (this.opcoes.atraso ?? atrasoDeRetentativaMs)(this.tentativas);
    this.mudar({ proximaTentativaEmMs: espera });
    this.cancelarRetentativa = (this.opcoes.agendar ?? agendarPadrao)(() => {
      this.cancelarRetentativa = null;
      this.mudar({ proximaTentativaEmMs: null });
      // quem saiu (ou esvaziou a fila) nesse meio-tempo não precisa de mais uma rodada
      if (this.http.logado && this.atual.pendentes > 0) void this.rodar();
    }, espera);
  }

  /** Cancela a retentativa agendada e zera a contagem do backoff. */
  private desistirDaRetentativa(): void {
    this.cancelarRetentativa?.();
    this.cancelarRetentativa = null;
    this.tentativas = 0;
    this.mudar({ proximaTentativaEmMs: null });
  }

  private mudar(parte: Partial<EstadoSincronizacao>): void {
    const novo = { ...this.atual, ...parte };
    if (JSON.stringify(novo) === JSON.stringify(this.atual)) return;
    this.atual = novo;
    for (const o of this.observadores) { try { o(this.estado); } catch { /* um ouvinte com bug não derruba os outros */ } }
  }
}

/** Frase sobre uma rodada: o que foi enviado/rejeitado e, se parou, por quê. */
export function descreverRodada(r: ResultadoSincronizacao): string {
  const partes: string[] = [];
  if (r.enviados.length > 0) partes.push(`${plural(r.enviados.length, 'partida enviada', 'partidas enviadas')} ao servidor`);
  if (r.rejeitados.length > 0) {
    const motivo = r.rejeitados[0].rejeicao?.motivo;
    partes.push(`${plural(r.rejeitados.length, 'partida rejeitada', 'partidas rejeitadas')}${motivo ? `: ${motivo}` : ''}`);
  }
  if (r.erro) partes.push(`Envio interrompido: ${mensagemDeErro(r.erro)}${r.pendentes > 0 ? ` ${plural(r.pendentes, 'partida segue', 'partidas seguem')} na fila.` : ''}`);
  // cada parte entra sem ponto final (as mensagens de erro já trazem) e a frase fecha com um só
  return partes.length > 0 ? `${partes.map(p => p.replace(/[.\s]+$/, '')).join('. ')}.` : 'Nada pendente para enviar.';
}

/** Rótulo curto do estado de um item da fila (a lista de pendentes/rejeitadas). */
export function situacaoDoItem(item: ItemFila): { rotulo: string; detalhe: string } {
  if (item.situacao === 'rejeitado') {
    // score que o servidor recalculou diferente: os dois números, no mesmo formato do resto da tela (o motivo da fila usa ponto)
    if (item.rejeicao?.codigo === 'score_divergente' && item.resultado) {
      return {
        rotulo: 'Rejeitada',
        detalhe: `O servidor recalculou o score em ${formatarScore(item.resultado.scoreServidorCentesimos)} (o jogo calculou ${formatarScore(item.resultado.scoreClienteCentesimos)}): partida registrada fora do ranking.`,
      };
    }
    return { rotulo: 'Rejeitada', detalhe: item.rejeicao?.motivo ?? 'O servidor recusou a partida.' };
  }
  if (item.ultimoErro) return { rotulo: 'Aguardando envio', detalhe: `Última tentativa falhou: ${item.ultimoErro.mensagem}` };
  return { rotulo: 'Aguardando envio', detalhe: 'Ainda não houve tentativa.' };
}
