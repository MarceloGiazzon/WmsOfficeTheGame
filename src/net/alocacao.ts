// A regra de alocação do WMS Office no servidor: o flow `SugerirDestinoJogo` (AllocationCapability.sugerirDestino, em Java).
// Entrada e saída são as mesmas da porta TS (`src/sim/wmsReal.ts`), que o teste de paridade confere contra este flow.

import type { CandidatoDestino, ResultadoSugerirDestino } from '../sim/wmsReal';
import { NpdevError } from './erros';
import type { Http, OpcoesChamada } from './npdevClient';
import { executarFlow } from './partidas';
import { erroDeFormato } from './validacao';

export interface PerguntaDestino {
  loteId: string;
  candidatos: readonly CandidatoDestino[];
}

/**
 * `POST /flows/SugerirDestinoJogo/execute`. Devolve a resposta do servidor já validada: `sucesso: true` sempre traz um
 * `localArmazenagemId` que está entre os candidatos enviados (um id inventado seria o servidor com defeito, não uma
 * escolha). `sucesso: false` (sem candidatos) é resposta válida. Lança `NpdevError` para rede, prazo, login e formato.
 */
export async function sugerirDestinoNoServidor(http: Http, pergunta: PerguntaDestino, opcoes?: OpcoesChamada): Promise<ResultadoSugerirDestino> {
  if (!http.logado) throw new NpdevError('offline', 'Sem login: modo offline.');
  const out = await executarFlow(http, 'SugerirDestinoJogo', { loteId: pergunta.loteId, candidatos: pergunta.candidatos }, opcoes);
  if (typeof out.sucesso !== 'boolean') throw erroDeFormato('SugerirDestinoJogo.sucesso deveria ser verdadeiro ou falso');
  const motivo = typeof out.motivo === 'string' ? out.motivo : '';
  if (!out.sucesso) return { sucesso: false, localArmazenagemId: null, motivo };
  const local = out.localArmazenagemId;
  if (typeof local !== 'string' || !pergunta.candidatos.some(c => c.localArmazenagemId === local)) {
    throw erroDeFormato('SugerirDestinoJogo devolveu um local que não estava entre os candidatos');
  }
  return { sucesso: true, localArmazenagemId: local, motivo };
}
