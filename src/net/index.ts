// Camada de rede do jogo (F5): API pública. Sem DOM; só `criarRede` olha para o navegador (IndexedDB).
//
// Como a UI usa (esboço):
//   const { cliente, cache, fila } = criarRede({ aoSessaoExpirar: () => mostrarLogin() });
//
//   login:      await cliente.login(usuario, senha)          // erros: NpdevError tipo 'nao_autenticado' etc.
//               cliente.logado / cliente.usuario             // convidado = nunca chamou login() = tudo offline
//   cenários:   logado ? await listarCenarios(cliente) : <lista embutida>
//   pacote:     const r = await obterPacote(codigo, { http: cliente, cache, embutido })   // r.origem: 'rede'|'cache'|'embutido'
//   início:     const p = await iniciarPartida(cliente, { cenarioId, politica })           // opcional; a fila cria depois se faltar
//   fim:        const r = await fila.registrar({ cenarioCodigo, politica, metricas, scoreCentesimos, iniciadaEm, concluidaEm, partidaId })
//               r.estado: 'enviado' (r.resultado.validadoServidor) | 'pendente' | 'rejeitado' | 'convidado'
//   ranking:    await ranking(cliente, cenarioId, { partidaId })   // posição do jogador e top
//   indicador:  fila.observar(r => mostrar(r.pendentes)); await fila.resumo()
//   reconectou: await fila.sincronizar()                          // ex.: no evento 'online' e logo após o login

export * from './erros';
export { NpdevClient } from './npdevClient';
export type { FetchLike, Http, OpcoesCliente, OpcoesChamada, ParametrosQuery, Sessao, Usuario } from './npdevClient';
export { sugerirDestinoNoServidor } from './alocacao';
export type { PerguntaDestino } from './alocacao';
export { buscarCenario, carregarPacote, listarCenarios, validarPacote } from './pacote';
export {
  ArmazenamentoIndexedDb, ArmazenamentoMemoria, CachePacotes, criarArmazenamentoPadrao, ErroArmazenamento, FORMATO_CACHE,
  obterPacote,
} from './cache';
export type {
  ArmazenamentoJson, EntradaCachePacote, OpcoesIndexedDb, OpcoesObterPacote, OrigemPacote, ResultadoPacote,
} from './cache';
export {
  abandonarPartida, buscarPartidaEmAndamento, buscarScoreDaPartida, concluirPartida, iniciarPartida, ranking, VERSAO_MOTOR,
} from './partidas';
export type {
  DadosNovaPartida, EntradaRanking, OpcoesRanking, PartidaServidor, Ranking, ResultadoConclusao, ScoreRegistrado,
} from './partidas';
export { FilaEnvio } from './filaEnvio';
export type {
  ErroItem, ItemFila, OpcoesFila, RegistroPartida, RejeicaoItem, ResultadoRegistro, ResultadoSincronizacao, ResumoFila,
  SituacaoItem,
} from './filaEnvio';
export { criarRede } from './rede';
export type { OpcoesRede, Rede } from './rede';
