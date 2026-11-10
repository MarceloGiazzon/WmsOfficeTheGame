import { describe, expect, it } from 'vitest';
import type { EntradaRanking, Ranking } from '../net/partidas';
import { montarLinhasRanking } from './rankingTabela';

const entrada = (posicao: number, jogador: string, partidaId: string, souEu = false): EntradaRanking => ({
  posicao, scoreId: `s${posicao}`, partidaId, jogador, scoreCentesimos: 10000 - posicao * 10, distanciaRealCm: 100000 + posicao,
  distanciaTeoricaCm: 90000, ordensTotal: 60, ordensAtrasadas: 0, eventosConflito: 0, ocupacaoFinalCentesimos: 8000, souEu,
});

function ranking(n: number, eu: Record<number, string> = {}): Ranking {
  const entradas = Array.from({ length: n }, (_, i) => entrada(i + 1, eu[i + 1] ? 'ana' : `outro${i + 1}`, eu[i + 1] ?? `p${i + 1}`, i + 1 in eu));
  return { entradas, total: n, posicaoDaPartida: null, melhorPosicaoDoJogador: null, truncado: false };
}

describe('montarLinhasRanking', () => {
  it('ranking curto: tudo, com a linha desta partida em destaque', () => {
    const linhas = montarLinhasRanking(ranking(3, { 2: 'minha' }), 'minha');
    expect(linhas.map(l => l.posicao)).toEqual([1, 2, 3]);
    expect(linhas.map(l => l.destaque)).toEqual([false, true, false]);
    expect(linhas[1]).toMatchObject({ jogador: 'ana', souEu: true, scoreCentesimos: 9980, distanciaCm: 100002 });
  });

  it('top 10 + a posição desta partida quando ela está fora do topo', () => {
    const linhas = montarLinhasRanking(ranking(40, { 25: 'minha' }), 'minha');
    expect(linhas).toHaveLength(11);
    expect(linhas.slice(0, 10).map(l => l.posicao)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(linhas[10]).toMatchObject({ posicao: 25, destaque: true, souEu: true });
  });

  it('partida dentro do top 10 não é repetida', () => {
    const linhas = montarLinhasRanking(ranking(40, { 7: 'minha' }), 'minha');
    expect(linhas).toHaveLength(10);
    expect(linhas.filter(l => l.destaque)).toHaveLength(1);
  });

  it('partida fora do ranking (não validada): mostra a melhor do próprio jogador, sem destaque', () => {
    const linhas = montarLinhasRanking(ranking(40, { 18: 'antiga', 30: 'outra' }), 'nova-nao-validada');
    expect(linhas).toHaveLength(11);
    expect(linhas[10]).toMatchObject({ posicao: 18, destaque: false, souEu: true });
  });

  it('sem partidaId e sem partidas do jogador: só o topo', () => {
    expect(montarLinhasRanking(ranking(40), null)).toHaveLength(10);
    expect(montarLinhasRanking(ranking(0), null)).toEqual([]);
  });
});
