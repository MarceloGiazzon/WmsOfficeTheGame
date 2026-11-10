// Partidas no servidor: criar (`SimPartida`), concluir/abandonar (flows) e ranking. Só chamadas que a role Jogador
// pode fazer (N3): `POST /api/sim_partidas` (o jogador não tem update/delete de partida), flows `ConcluirPartida` e
// `AbandonarPartida` (só `callProcedure`) e a query `RankingPorCenario`.
//
// O servidor é a autoridade do score: `ConcluirPartida` recalcula pela fórmula oficial (Java), grava o SimScore com o
// valor RECALCULADO e marca `validadoServidor = (score do cliente == recalculado)`. Um score adulterado NÃO é
// recusado — é gravado como não validado e fica fora do ranking —, então `concluirPartida` devolve
// `validadoServidor: false` em vez de lançar; recusa de verdade (`recusado`) é métrica inválida, métrica de referência
// que não bate com o cenário no servidor (ordensTotal, distância teórica) ou partida que já não está em andamento.
//
// Limite do que o servidor garante: ele confere as referências do cenário e a coerência das métricas, mas distância
// real, atrasos, conflitos e ocupação vêm do cliente — quem montar essas métricas "perfeitas" à mão entra no ranking.
// Só um replay no servidor (docs/PLANO.md, anti-fraude) fecharia isso. O ranking compara apenas scores da mesma
// `VERSAO_MOTOR`.

import type { Metricas, Politica } from '../sim/model';
import { POLITICAS } from '../sim/model';
import { erroDeResposta, NpdevError } from './erros';
import { listarConceito, lerQuery } from './leitura';
import type { Http } from './npdevClient';
import { booleano, enumerado, erroDeFormato, inteiro, objeto, texto, type Obj } from './validacao';

/** Versão do conjunto de regras do motor (`src/sim`). Sobe quando uma regra muda (os goldens de simulation.test.ts mudam junto). */
export const VERSAO_MOTOR = '0.3.0';

export interface PartidaServidor {
  id: string;
  cenarioId: string;
  jogador: string;
  politica: Politica;
  situacao: 'EmAndamento' | 'Concluida' | 'Abandonada';
  /** ISO, como o servidor devolveu. */
  iniciadaEm: string;
}

const SITUACOES_PARTIDA = ['EmAndamento', 'Concluida', 'Abandonada'] as const;

function paraPartida(r: Obj, onde = 'partida'): PartidaServidor {
  return {
    id: texto(r, 'id', onde),
    cenarioId: texto(r, 'cenarioId', onde),
    jogador: texto(r, 'jogador', onde),
    politica: enumerado(r, 'politica', POLITICAS, onde),
    situacao: enumerado(r, 'situacao', SITUACOES_PARTIDA, onde),
    iniciadaEm: texto(r, 'iniciadaEm', onde),
  };
}

function exigirUsuario(http: Http): string {
  const u = http.usuario;
  if (!http.logado || u === null) throw new NpdevError('offline', 'Sem login: modo offline.');
  return u;
}

export interface DadosNovaPartida {
  /** `id` do banco do cenário (de `listarCenarios`/`buscarCenario`; o `id` de um pacote EMBUTIDO é alias e não serve). */
  cenarioId: string;
  politica: Politica;
  versaoMotor?: string;
  /** Padrão: agora. */
  iniciadaEm?: Date | string;
}

/**
 * Cria a `SimPartida` (situação `EmAndamento`) do jogador logado. O dono é o username da sessão — a regra por linha
 * do servidor recusa (403) criar partida em nome de outro.
 */
export async function iniciarPartida(http: Http, dados: DadosNovaPartida): Promise<PartidaServidor> {
  const jogador = exigirUsuario(http);
  const iniciadaEm = dados.iniciadaEm instanceof Date ? dados.iniciadaEm.toISOString() : dados.iniciadaEm ?? new Date().toISOString();
  const r = objeto(await http.post('/sim_partidas', {
    cenarioId: dados.cenarioId, jogador, politica: dados.politica,
    versaoMotor: dados.versaoMotor ?? VERSAO_MOTOR, iniciadaEm,
  }), 'SimPartida');
  const partida = paraPartida(r);
  if (partida.situacao !== 'EmAndamento') throw erroDeFormato(`a partida nova veio como ${partida.situacao}`);
  return partida;
}

export interface ResultadoConclusao {
  partidaId: string;
  scoreId: string;
  /** Score gravado pelo servidor: o RECALCULADO pela fórmula oficial (centésimos, 0–10000). */
  scoreServidorCentesimos: number;
  /** O score enviado pelo cliente. */
  scoreClienteCentesimos: number;
  /**
   * `true` = o score do cliente bateu com o recalculado e a partida entra no ranking.
   * `false` = divergência (bug do cliente ou adulteração): o servidor gravou o score dele, mas fora do ranking.
   */
  validadoServidor: boolean;
}

/** Corpo do flow → erro, quando o HTTP foi 200 mas o procedure disse não (`{sucesso:false, motivo}`). */
function recusa(motivo: string, corpo: unknown): NpdevError {
  // "Partida nao esta EmAndamento" (já concluída/abandonada) × métricas recusadas ("ordensAtrasadas > ordensTotal",
  // "ordensTotal nao confere com as ordens do cenario"…)
  const codigo = /EmAndamento/i.test(motivo) ? 'partida_encerrada' : 'metricas_invalidas';
  return new NpdevError('recusado', motivo, { codigo, corpo, status: 200 });
}

/** Resposta de `POST /flows/<nome>/execute`: devolve o `output`, lançando se o flow falhou. */
async function executarFlow(http: Http, nome: string, entrada: Record<string, unknown>): Promise<Obj> {
  const env = objeto(await http.post(`/flows/${nome}/execute`, entrada), `flow ${nome}`);
  if (env.status === 'FAILED') throw erroDeResposta(422, env);
  if (env.status !== 'OK') throw erroDeFormato(`flow ${nome} com status ${String(env.status)}`);
  return objeto(env.output, `flow ${nome}.output`);
}

/**
 * Fecha a partida com as métricas e o score calculados no cliente. Lança `NpdevError`:
 * `recusado` (código `partida_encerrada` ou `metricas_invalidas`), `nao_encontrado` (a partida não existe/não é sua),
 * e os de rede (`rede`, `timeout`, `servidor`, `nao_autenticado`, `offline`) — nesses, a conclusão pode ou não ter
 * chegado ao servidor; a fila de envio resolve isso consultando `buscarScoreDaPartida`.
 */
export async function concluirPartida(http: Http, partidaId: string, metricas: Metricas, scoreCentesimos: number): Promise<ResultadoConclusao> {
  exigirUsuario(http);
  const out = await executarFlow(http, 'ConcluirPartida', { partidaId, ...metricas, scoreCentesimos });
  if (out.sucesso === false) throw recusa(typeof out.motivo === 'string' ? out.motivo : 'recusado pelo servidor', out);
  if (out.conceptName !== 'SimScore') throw erroDeFormato('ConcluirPartida não devolveu um SimScore');
  const d = objeto(out.data, 'SimScore');
  if (texto(d, 'partidaId', 'SimScore') !== partidaId) throw erroDeFormato('o SimScore devolvido é de outra partida');
  return {
    partidaId,
    scoreId: texto(d, 'id', 'SimScore'),
    scoreServidorCentesimos: inteiro(d, 'scoreCentesimos', 'SimScore'),
    scoreClienteCentesimos: scoreCentesimos,
    validadoServidor: booleano(d, 'validadoServidor', 'SimScore'),
  };
}

/** Desiste da partida em andamento (`EmAndamento → Abandonada`). `recusado/partida_encerrada` se já terminou. */
export async function abandonarPartida(http: Http, partidaId: string): Promise<void> {
  exigirUsuario(http);
  try {
    const out = await executarFlow(http, 'AbandonarPartida', { partidaId });
    const d = objeto(out.data, 'SimPartida');
    if (d.situacao !== 'Abandonada') throw erroDeFormato(`AbandonarPartida devolveu a partida como ${String(d.situacao)}`);
  } catch (e) {
    // o lifecycle recusa Concluida→Abandonada com um 422 genérico; para quem chama é a mesma recusa de concluirPartida
    if (e instanceof NpdevError && /lifecycle transition is not allowed/i.test(e.message)) {
      throw new NpdevError('recusado', 'A partida já foi encerrada.', { codigo: 'partida_encerrada', status: e.status, corpo: e.corpo });
    }
    throw e;
  }
}

// ---- consultas que a fila usa para não duplicar -----------------------------------------------------------------

export interface ScoreRegistrado {
  id: string;
  partidaId: string;
  scoreCentesimos: number;
  validadoServidor: boolean;
}

/** O `SimScore` já gravado para a partida, ou `null`. Responde "a conclusão chegou antes de a conexão cair?". */
export async function buscarScoreDaPartida(http: Http, partidaId: string): Promise<ScoreRegistrado | null> {
  exigirUsuario(http);
  const [r] = await listarConceito(http, 'SimScore', { partidaId });
  if (!r) return null;
  return {
    id: texto(r, 'id', 'SimScore'), partidaId, scoreCentesimos: inteiro(r, 'scoreCentesimos', 'SimScore'),
    validadoServidor: booleano(r, 'validadoServidor', 'SimScore'),
  };
}

/**
 * Partida do jogador, em andamento, no cenário e política dados, iniciada naquele instante (compara o instante, não o
 * texto: o servidor devolve a data em outro fuso). Responde "o POST da criação chegou antes de a conexão cair?".
 */
export async function buscarPartidaEmAndamento(http: Http, cenarioId: string, politica: Politica, iniciadaEm: string): Promise<PartidaServidor | null> {
  exigirUsuario(http);
  const alvo = Date.parse(iniciadaEm);
  const linhas = await listarConceito(http, 'SimPartida', { cenarioId, politica, situacao: 'EmAndamento' });
  for (const l of linhas) {
    const p = paraPartida(l);
    if (Date.parse(p.iniciadaEm) === alvo) return p;
  }
  return null;
}

// ---- ranking ----------------------------------------------------------------------------------------------------

export interface EntradaRanking {
  /** 1 = melhor. Ordem do servidor: score (maior) e, no empate, menor distância. */
  posicao: number;
  scoreId: string;
  partidaId: string;
  jogador: string;
  scoreCentesimos: number;
  distanciaRealCm: number;
  distanciaTeoricaCm: number;
  ordensTotal: number;
  ordensAtrasadas: number;
  eventosConflito: number;
  ocupacaoFinalCentesimos: number;
  /** É do jogador logado. */
  souEu: boolean;
}

export interface Ranking {
  /** Só scores validados pelo servidor, do melhor para o pior (até `limite`). */
  entradas: EntradaRanking[];
  /** Quantos scores validados o cenário tem no total (pode ser maior que `entradas.length`). */
  total: number;
  /** Posição da partida pedida (`partidaId`), ou `null` se ela não está entre as `entradas` (não validada, ou fora do limite). */
  posicaoDaPartida: number | null;
  /** Melhor posição do jogador logado entre as `entradas`, ou `null`. */
  melhorPosicaoDoJogador: number | null;
  /** O ranking tem mais gente do que veio: `null` nas posições acima pode significar "fora do limite". */
  truncado: boolean;
}

export interface OpcoesRanking {
  /** Partida cuja posição interessa (a que acabou de terminar). */
  partidaId?: string;
  /** Quantas linhas pedir (o servidor corta em 1000). Padrão 100. */
  limite?: number;
  /** Versão do motor cujos scores comparar. Padrão: a deste build (`VERSAO_MOTOR`) — scores de versões diferentes não se misturam. */
  versaoMotor?: string;
}

/** Ranking do cenário e da versão do motor (query `RankingPorCenario`) com a posição do jogador. Leitura pública entre jogadores. */
export async function ranking(http: Http, cenarioId: string, opcoes: OpcoesRanking = {}): Promise<Ranking> {
  const eu = exigirUsuario(http);
  const { rows, total } = await lerQuery(http, 'RankingPorCenario', { cenarioId, versaoMotor: opcoes.versaoMotor ?? VERSAO_MOTOR }, opcoes.limite ?? 100);
  const entradas: EntradaRanking[] = rows.map((r, i) => {
    const onde = `ranking[${i}]`;
    if (!booleano(r, 'validadoServidor', onde)) throw erroDeFormato(`${onde} não validado veio no ranking`);
    const jogador = texto(r, 'jogador', onde);
    return {
      posicao: i + 1, scoreId: texto(r, 'id', onde), partidaId: texto(r, 'partidaId', onde), jogador,
      scoreCentesimos: inteiro(r, 'scoreCentesimos', onde), distanciaRealCm: inteiro(r, 'distanciaRealCm', onde),
      distanciaTeoricaCm: inteiro(r, 'distanciaTeoricaCm', onde), ordensTotal: inteiro(r, 'ordensTotal', onde),
      ordensAtrasadas: inteiro(r, 'ordensAtrasadas', onde), eventosConflito: inteiro(r, 'eventosConflito', onde),
      ocupacaoFinalCentesimos: inteiro(r, 'ocupacaoFinalCentesimos', onde), souEu: jogador === eu,
    };
  });
  const totalGeral = Math.max(total ?? entradas.length, entradas.length);
  return {
    entradas,
    total: totalGeral,
    posicaoDaPartida: opcoes.partidaId === undefined ? null : entradas.find(e => e.partidaId === opcoes.partidaId)?.posicao ?? null,
    melhorPosicaoDoJogador: entradas.find(e => e.souEu)?.posicao ?? null,
    truncado: totalGeral > entradas.length,
  };
}
