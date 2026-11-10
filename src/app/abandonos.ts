// Partidas que o jogador abandonou no meio mas que o servidor ainda não soube (sem rede, token vencido). Uma partida
// criada no servidor fica `EmAndamento` para sempre se ninguém a conclui nem abandona — e o Jogador não pode apagá-la
// (N3) —, então o pedido de abandono não pode se perder: fica guardado e é refeito a cada sincronização.
//
// Só vale para quem abandonou: o pedido é feito pelo mesmo usuário (o servidor devolve "não encontrada" para os outros).

import type { ArmazenamentoJson } from '../net/cache';
import { ehNpdevError } from '../net/erros';
import type { Http } from '../net/npdevClient';
import { abandonarPartida } from '../net/partidas';

const PREFIXO = 'abandono:';

interface PedidoAbandono {
  partidaId: string;
  jogador: string;
  /** ISO. */
  em: string;
}

function lerPedido(bruto: unknown): PedidoAbandono | null {
  if (bruto === null || typeof bruto !== 'object') return null;
  const p = bruto as Partial<PedidoAbandono>;
  return typeof p.partidaId === 'string' && typeof p.jogador === 'string' && typeof p.em === 'string' ? (p as PedidoAbandono) : null;
}

export class Abandonos {
  constructor(private readonly armazenamento: ArmazenamentoJson, private readonly http: Http, private readonly agora: () => Date = () => new Date()) {}

  /** Guarda o pedido para tentar de novo. Falha de armazenamento é engolida: não há mais o que fazer por essa partida. */
  async adiar(partidaId: string, jogador: string): Promise<void> {
    try {
      await this.armazenamento.gravar(PREFIXO + partidaId, { partidaId, jogador, em: this.agora().toISOString() } satisfies PedidoAbandono);
    } catch { /* sem onde guardar */ }
  }

  async pendentes(): Promise<number> {
    try { return (await this.armazenamento.chaves(PREFIXO)).length; } catch { return 0; }
  }

  /**
   * Refaz os pedidos do jogador logado. Some o que o servidor aceitou ou deixou de fazer sentido (partida já encerrada,
   * que não existe ou não é do jogador); fica o que falhou por rede/servidor/login. Devolve quantos abandonou agora.
   */
  async tentar(): Promise<number> {
    const eu = this.http.usuario;
    if (eu === null || !this.http.logado) return 0;
    let feitos = 0;
    let chaves: string[];
    try { chaves = await this.armazenamento.chaves(PREFIXO); } catch { return 0; }
    for (const chave of chaves) {
      let pedido: PedidoAbandono | null;
      try { pedido = lerPedido(await this.armazenamento.ler(chave)); } catch { continue; }
      if (!pedido) { await this.armazenamento.remover(chave).catch(() => undefined); continue; }
      if (pedido.jogador !== eu) continue; // de outro usuário deste aparelho: espera ele entrar
      try {
        await abandonarPartida(this.http, pedido.partidaId);
        feitos++;
      } catch (e) {
        if (!ehNpdevError(e)) throw e;
        if (e.recuperavel) break; // sem rede/servidor: o resto também falharia
        // recusado (já encerrada), não encontrada, sem permissão: não há o que repetir
      }
      await this.armazenamento.remover(chave).catch(() => undefined);
    }
    return feitos;
  }
}
