// Envio do rastro da partida (src/sim/rastro.ts) ao servidor: uma linha de `SimEvento` por evento, para a ponte
// Jogo ↔ WmsOffice (backend/ponte) traduzir a partida em documentos do corporativo.
//
// Idempotente por `seq`: lê o que o servidor já tem da partida e só envia o que falta. Falha no meio (rede) = rejeita;
// chamar de novo completa. Quem chama decide o que mostrar (partidaOnline.ts: falha nunca derruba o resultado).
//
// O concept SimEvento não é editável pelo jogador (só read/create) e só enxerga as próprias linhas (regra `jogador`).

import type { EventoRastro } from '../sim/rastro';
import { emParalelo, listarConceito, PARALELISMO } from './leitura';
import type { Http } from './npdevClient';

export interface ResultadoEnvioRastro {
  /** Linhas criadas agora. */
  enviados: number;
  /** Linhas que o servidor já tinha (de uma tentativa anterior). */
  jaExistiam: number;
}

/**
 * Corpo do POST de um evento. Campos nulos são omitidos (referências opcionais).
 * ATENÇÃO: o campo `tSeg` do concept se escreve `tseg` (o Jackson baixa a 1ª maiúscula de getTSeg); `tSeg` dá 422
 * "required field tSeg is missing". Já o /page devolve `tSeg`. Ver backend/ponte/modelos/ALTERACOES_BACKEND.md.
 */
export function corpoDoEvento(partidaId: string, jogador: string, e: Readonly<EventoRastro>): Record<string, unknown> {
  const corpo: Record<string, unknown> = { partidaId, jogador, seq: e.seq, tipo: e.tipo, tseg: e.tSeg };
  for (const campo of ['ordemId', 'ordemSaidaId', 'produtoId', 'localId', 'localDestinoId'] as const) {
    if (e[campo] !== null) corpo[campo] = e[campo];
  }
  return corpo;
}

export async function enviarRastro(
  http: Http, partidaId: string, jogador: string, eventos: readonly Readonly<EventoRastro>[],
): Promise<ResultadoEnvioRastro> {
  const existentes = new Set<number>();
  for (const linha of await listarConceito(http, 'SimEvento', { partidaId })) {
    if (typeof linha.seq === 'number') existentes.add(linha.seq);
  }
  const faltam = eventos.filter(e => !existentes.has(e.seq));
  await emParalelo(faltam, PARALELISMO, e => http.post('/sim_eventos', corpoDoEvento(partidaId, jogador, e)));
  return { enviados: faltam.length, jaExistiam: eventos.length - faltam.length };
}
