// Compara dois pacotes ignorando o formato dos ids: cada id é trocado pela chave natural do registro (código da rua,
// "rua/posição/andar" do local, código do produto, número da ordem…) e as listas são ordenadas por ela. Serve para
// provar que o pacote montado pelo REST (UUIDs) é o mesmo do embutido (aliases do seed): mesmos campos, mesmos tipos,
// mesma topologia, mesmas ordens. Só os testes usam.

import type { PacoteCenario } from '../sim/model';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const ordemTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** O pacote com ids → chaves naturais, listas ordenadas por elas. */
export function normalizarPacote(p: PacoteCenario): Json {
  const chaveArea = new Map(p.areas.map(a => [a.id, a.nome]));
  const chaveRua = new Map(p.ruas.map(r => [r.id, r.codigo]));
  const chaveProduto = new Map(p.produtos.map(x => [x.id, x.codigo]));
  const chaveLocal = new Map(p.locais.map(l => [l.id, `${chaveRua.get(l.ruaId)}/${l.posicao}/${l.andar}`]));
  const k = (m: Map<string, string>, id: string): string => m.get(id) ?? `?${id}`; // referência que não fecha aparece como diferença
  const porChave = <T extends { chave: string }>(xs: T[]): T[] => [...xs].sort((a, b) => ordemTexto(a.chave, b.chave));
  const sem = <T extends { chave: string }>(xs: T[]): Json[] => porChave(xs).map(({ chave: _c, ...resto }) => resto as unknown as Json);

  return {
    cenario: { ...p.cenario, id: p.cenario.codigo, armazemId: 'armazem' },
    armazem: { ...p.armazem, id: 'armazem' },
    areas: sem(p.areas.map(a => ({ chave: a.nome, ...a, id: a.nome, armazemId: 'armazem' }))),
    ruas: sem(p.ruas.map(r => ({ chave: r.codigo, ...r, id: r.codigo, areaId: k(chaveArea, r.areaId) }))),
    locais: sem(p.locais.map(l => ({ chave: k(chaveLocal, l.id), ...l, id: k(chaveLocal, l.id), ruaId: k(chaveRua, l.ruaId) }))),
    produtos: sem(p.produtos.map(x => ({ chave: x.codigo, ...x, id: x.codigo }))),
    // a sim ordena as ordens por (liberação, número) — é a ordem que vale comparar, não a de chegada
    ordens: [...p.ordens].sort((a, b) => a.liberacaoSeg - b.liberacaoSeg || ordemTexto(a.numero, b.numero))
      .map(o => ({ ...o, id: o.numero, produtoId: k(chaveProduto, o.produtoId) })) as unknown as Json[],
    rankingRuas: sem(p.rankingRuas.map(r => ({ chave: k(chaveRua, r.ruaId), ruaId: k(chaveRua, r.ruaId), prioridade: r.prioridade }))),
  };
}

function comparar(a: Json | undefined, b: Json | undefined, caminho: string, saida: string[], limite: number): void {
  if (saida.length >= limite) return;
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { saida.push(`${caminho}: ${a.length} itens × ${b.length}`); return; }
    a.forEach((x, i) => comparar(x, b[i], `${caminho}[${i}]`, saida, limite));
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const chave of new Set([...Object.keys(a), ...Object.keys(b)])) comparar(a[chave], b[chave], `${caminho}.${chave}`, saida, limite);
    return;
  }
  saida.push(`${caminho}: ${JSON.stringify(a)} × ${JSON.stringify(b)}`);
}

/** Diferenças entre o pacote esperado e o recebido (vazio = equivalentes). No máximo `limite` linhas. */
export function diferencasDePacote(esperado: PacoteCenario, recebido: PacoteCenario, limite = 20): string[] {
  const saida: string[] = [];
  comparar(normalizarPacote(esperado), normalizarPacote(recebido), 'pacote', saida, limite);
  return saida;
}
