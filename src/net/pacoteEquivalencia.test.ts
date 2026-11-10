import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { PacoteCenario } from '../sim/model';
import { remapearIds } from './idsUuid';
import { diferencasDePacote } from './pacoteEquivalencia';

const base = whA as unknown as PacoteCenario;

// O teste ao vivo e o do servidor falso só valem se o comparador enxerga diferença de verdade.
describe('diferencasDePacote', () => {
  it('pacote com ids trocados é equivalente', () => {
    expect(diferencasDePacote(base, remapearIds(base, 1).pacote)).toEqual([]);
  });

  const quebras: [string, (p: PacoteCenario) => void, RegExp][] = [
    ['quantidade de paletes de uma ordem', p => { p.ordens[3].quantidadePaletes += 1; }, /quantidadePaletes/],
    ['produto de uma ordem', p => { p.ordens[0].produtoId = p.produtos[5].id; }, /produtoId/],
    ['local a menos', p => { p.locais.pop(); }, /locais/],
    ['andares da rua', p => { p.ruas[3].qtdAndares = 2; }, /qtdAndares/],
    ['tipo do campo (texto no lugar de número)', p => { (p.locais[5] as unknown as Record<string, unknown>).posicao = '3'; }, /posicao/],
    ['situação de um local', p => { p.locais[7].situacao = 'Bloqueado'; }, /situacao/],
    ['velocidade do cenário', p => { p.cenario.velocidadeEquipamentoCmS += 1; }, /velocidadeEquipamentoCmS/],
    ['prioridade do ranking', p => { p.rankingRuas[0].prioridade = 9; }, /prioridade/],
    ['produto que não tem ordem some', p => { p.produtos = p.produtos.filter(x => x.codigo !== 'WHA-P12'); }, /produtos/],
    ['rua do local aponta para outra rua', p => { p.locais[10].ruaId = p.ruas[3].id; }, /ruaId|posicao/],
  ];
  it.each(quebras)('detecta: %s', (_, quebra, onde) => {
    const outro = remapearIds(base, 2).pacote;
    quebra(outro);
    const d = diferencasDePacote(base, outro);
    expect(d.length).toBeGreaterThan(0);
    expect(d.join('\n')).toMatch(onde);
  });
});
