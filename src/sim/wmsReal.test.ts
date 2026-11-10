import { describe, expect, it } from 'vitest';
import fixtures from '../../backend/npdev/tests/fixtures/alocacao-casos.json';
import { Rng } from './rng';
import { candidatosQueConcorrem, sugerirDestino, sugerirOrigem, type CandidatoDestino } from './wmsReal';

// Mesmos casos que o flow SugerirDestinoJogo roda contra o Java (tests/f3_paridade_alocacao.py) — paridade TS × Java (D3).
describe('sugerirDestino — casos compartilhados com AllocationCapability', () => {
  for (const c of fixtures.destino) {
    it(c.nome, () => {
      expect(sugerirDestino((c as { crossDockings?: never[] }).crossDockings ?? null, c.entrada as never)).toEqual(c.esperado);
    });
  }
});

describe('sugerirOrigem — casos compartilhados com AllocationCapability', () => {
  for (const c of fixtures.origem) {
    it(c.nome, () => {
      expect(sugerirOrigem((c as { crossDockings?: never[] }).crossDockings ?? null, c.entrada as never)).toEqual(c.esperado);
    });
  }
});

// A redução que o app usa para perguntar só sobre a faixa de melhor prioridade (WH-B: ~570 locais livres → dezenas) tem de
// escolher EXATAMENTE o que `sugerirDestino` escolheria sobre a lista inteira — em qualquer entrada, não só nas do jogo.
describe('candidatosQueConcorrem — a redução não muda a escolha de sugerirDestino', () => {
  const escolha = (loteId: string | null, candidatos: CandidatoDestino[]) => sugerirDestino(null, { loteId, candidatos });

  it('todas as fixtures de destino dão a mesma resposta com a lista reduzida', () => {
    for (const c of fixtures.destino) {
      const entrada = c.entrada as { loteId?: string | null; candidatos?: CandidatoDestino[] };
      if ((c as { crossDockings?: unknown }).crossDockings || !entrada.candidatos) continue;
      const reduzida = { ...entrada, candidatos: candidatosQueConcorrem(entrada.loteId, entrada.candidatos) };
      expect(sugerirDestino(null, reduzida as never), c.nome).toEqual(sugerirDestino(null, entrada as never));
    }
  });

  it('5000 entradas aleatórias: empates de prioridade, mesmo lote, prioridade ausente/ilegível/texto, ids parecidos', () => {
    const rng = new Rng(20261110);
    const ids = ['A', 'B', 'a', 'b', 'A1', 'A10', 'A2', 'Z', 'rua-1/01', 'rua-1/02', 'rua-10/01', 'x'];
    const prioridades: (number | string | null | undefined)[] = [1, 1, 2, 2, 3, 10, -1, 0, '2', ' 3 ', 'abc', '', null, undefined, 2147483647, '2147483648'];
    const lotes = ['L1', 'L2', 'L3', null];
    for (let i = 0; i < 5000; i++) {
      const n = 1 + rng.nextInt(ids.length);
      const candidatos: CandidatoDestino[] = ids.slice().sort(() => rng.next() - 0.5).slice(0, n).map(id => ({
        localArmazenagemId: id,
        loteOcupanteId: rng.next() < 0.3 ? lotes[rng.nextInt(lotes.length)] : null,
        prioridade: prioridades[rng.nextInt(prioridades.length)],
      }));
      const lote = lotes[rng.nextInt(lotes.length)];
      const reduzida = candidatosQueConcorrem(lote, candidatos);
      expect(reduzida.length).toBeGreaterThan(0);
      expect(reduzida.length).toBeLessThanOrEqual(candidatos.length);
      expect(escolha(lote, reduzida), JSON.stringify({ lote, candidatos })).toEqual(escolha(lote, candidatos));
    }
  });

  it('lista vazia continua vazia; sem ninguém do mesmo lote fica só a menor prioridade', () => {
    expect(candidatosQueConcorrem('L', [])).toEqual([]);
    const r = candidatosQueConcorrem('L', [
      { localArmazenagemId: 'a', prioridade: 2 }, { localArmazenagemId: 'b', prioridade: 1 }, { localArmazenagemId: 'c', prioridade: 1 }, { localArmazenagemId: 'd', prioridade: 3 },
    ]);
    expect(r.map(c => c.localArmazenagemId)).toEqual(['b', 'c']);
  });
});
