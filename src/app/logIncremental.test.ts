import { describe, expect, it } from 'vitest';
import { planejarLog } from './logIncremental';

const ev = (n: number) => ({ n });
/** Do mais novo para o mais antigo, como a sim entrega. */
const lista = (...ns: number[]) => ns.map(ev);

describe('planejarLog', () => {
  it('mesmo evento no topo: nada a fazer (inclusive log vazio sobre log vazio)', () => {
    const a = lista(3, 2, 1);
    expect(planejarLog(a[0], [...a], 50)).toEqual({ tipo: 'nada' });
    expect(planejarLog(undefined, [], 50)).toEqual({ tipo: 'nada' });
  });

  it('primeira vez (nada na tela): refaz', () => {
    expect(planejarLog(undefined, lista(2, 1), 50)).toEqual({ tipo: 'refazer' });
  });

  it('eventos novos no topo: acrescenta só os novos, na ordem', () => {
    const antes = lista(3, 2, 1);
    const depois = [ev(5), ev(4), ...antes]; // a sim reaproveita os objetos antigos
    expect(planejarLog(antes[0], depois, 50)).toEqual({ tipo: 'acrescentar', novos: 2 });
  });

  it('um evento novo por vez é o caso comum', () => {
    const antes = lista(3, 2, 1);
    expect(planejarLog(antes[0], [ev(4), ...antes], 50)).toEqual({ tipo: 'acrescentar', novos: 1 });
  });

  it('partida nova (objetos novos, nenhum igual ao do topo antigo): refaz', () => {
    expect(planejarLog(ev(9), lista(2, 1), 50)).toEqual({ tipo: 'refazer' });
  });

  it('log zerado depois de já ter eventos: refaz (esvazia)', () => {
    expect(planejarLog(ev(1), [], 50)).toEqual({ tipo: 'refazer' });
  });

  it('o antigo topo saiu da janela de `max` (chegaram `max` ou mais eventos de uma vez): refaz', () => {
    const antigo = ev(0);
    const novos = Array.from({ length: 5 }, (_, i) => ev(i + 1));
    expect(planejarLog(antigo, [...novos, antigo], 5)).toEqual({ tipo: 'refazer' }); // antigo ficou na posição 5, fora da janela
    expect(planejarLog(antigo, [...novos, antigo], 6)).toEqual({ tipo: 'acrescentar', novos: 5 });
  });

  it('simula uma sessão: o resultado incremental é igual ao de refazer, e a lista nunca passa de max', () => {
    const MAX = 5;
    let todos: { n: number }[] = [];
    let tela: number[] = [];
    let topo: { n: number } | undefined;
    let n = 0;
    for (const lote of [1, 1, 3, 1, 2, 7, 1, 1]) {
      const novos = Array.from({ length: lote }, () => ev(++n)).reverse();
      todos = [...novos, ...todos].slice(0, 200);
      const plano = planejarLog(topo, todos, MAX);
      if (plano.tipo === 'refazer') tela = todos.slice(0, MAX).map(e => e.n);
      else if (plano.tipo === 'acrescentar') tela = [...todos.slice(0, plano.novos).map(e => e.n), ...tela].slice(0, MAX);
      topo = todos[0];
      expect(tela).toEqual(todos.slice(0, MAX).map(e => e.n));
    }
  });
});
