// Tabela do ranking para a tela de resultado: as `limite` primeiras posições + a posição desta partida (ou, se ela não
// está no ranking, a melhor do próprio jogador) quando cai fora delas. Puro, para testar sem DOM.

import type { Ranking } from '../net/partidas';
import type { LinhaRanking } from './resultado';

export const LINHAS_DO_TOPO = 10;

export function montarLinhasRanking(r: Ranking, partidaId: string | null, limite = LINHAS_DO_TOPO): LinhaRanking[] {
  const linha = (e: Ranking['entradas'][number]): LinhaRanking => ({
    posicao: e.posicao, jogador: e.jogador, scoreCentesimos: e.scoreCentesimos, distanciaCm: e.distanciaRealCm,
    destaque: partidaId !== null && e.partidaId === partidaId, souEu: e.souEu,
  });
  const linhas = r.entradas.slice(0, limite).map(linha);
  // Fora do topo: mostra a partida que acabou de terminar; se ela não entrou (não validada) ou não coube na lista, a
  // melhor do jogador — o que ele quer saber é "onde estou".
  const desta = partidaId === null ? undefined : r.entradas.find(e => e.partidaId === partidaId);
  const extra = desta ?? r.entradas.find(e => e.souEu);
  if (extra && extra.posicao > limite) linhas.push(linha(extra));
  return linhas;
}
