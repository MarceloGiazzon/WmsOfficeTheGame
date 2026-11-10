// Escolha de destino (putaway) e de origem (picking). Funções puras sobre o estado dos locais.
//
// As cinco políticas do jogo. Todas escolhem o destino de UM palete (cada local guarda um palete):
//   FifoPrimeiraLivre — primeiro local livre na ordem de varredura.
//   AbcProximidade    — classe A nos locais mais próximos da expedição, B nos seguintes, C no resto.
//   Consolidacao      — junta o produto na mesma rua (porta da regra "mesmo lote primeiro" de sugerirDestino).
//   WmsReal           — a regra do WMS Office: `AllocationCapability.sugerirDestino` (porta TS em wmsReal.ts) com os
//                       candidatos ranqueados pelo `RankingRua`. Aqui é a porta TS; com login, o app pergunta ao flow
//                       `SugerirDestinoJogo` do backend (src/app/decisorWmsReal.ts) e esta função é o plano B.
//   CrossDocking      — desvia o palete descarregado direto para uma doca de saída quando há saída pendente do
//                       produto (isso é decidido no motor, em simulation.ts). O que não for desviado é guardado
//                       como em AbcProximidade, para a comparação isolar o ganho do desvio.

import type { Layout, LayoutLocal } from './layout';
import type { CurvaAbc } from './estoque';
import type { EstadoLocal, Politica } from './model';
import { sugerirDestino, type CandidatoDestino } from './wmsReal';

export interface ContextoPolitica {
  readonly layout: Layout;
  readonly locais: ReadonlyMap<string, EstadoLocal>;
  readonly curva: CurvaAbc;
  /** Locais de armazenagem do mais próximo ao mais distante da expedição (empate: ordem de varredura). */
  readonly porProximidade: readonly LayoutLocal[];
  /** Distância (cm) do local até a doca de saída mais próxima. */
  readonly distExpedicao: ReadonlyMap<string, number>;
  /** `RankingRua.prioridade` por rua (menor = preferida). Rua fora do ranking não tem entrada. */
  readonly ranking: ReadonlyMap<string, number>;
}

const livre = (ctx: ContextoPolitica, l: LayoutLocal): boolean => ctx.locais.get(l.localId)?.situacao === 'Disponivel';

/** Faixas da curva sobre os locais ordenados por proximidade: A = 20% mais próximos, B = próximos 30%, C = o resto. */
const FAIXAS: Record<'A' | 'B' | 'C', number> = { A: 0.2, B: 0.5, C: 1 };
const ORDEM_FAIXAS: Record<'A' | 'B' | 'C', readonly ('A' | 'B' | 'C')[]> = {
  A: ['A', 'B', 'C'], B: ['B', 'A', 'C'], C: ['C', 'B', 'A'],
};

/** Local livre para guardar um palete de `produtoId` (do lote `loteId`), ou null se não há nenhum. */
export function escolherDestino(politica: Politica, ctx: ContextoPolitica, produtoId: string, loteId: string = produtoId): string | null {
  switch (politica) {
    case 'FifoPrimeiraLivre': return primeiraLivre(ctx);
    case 'Consolidacao': return consolidar(ctx, produtoId);
    case 'WmsReal': return wmsReal(ctx, loteId);
    // CrossDocking: o desvio é do motor; o palete que fica no armazém segue a regra ABC.
    case 'AbcProximidade':
    case 'CrossDocking': return abc(ctx, produtoId);
  }
}

function primeiraLivre(ctx: ContextoPolitica): string | null {
  return ctx.layout.locais.find(l => livre(ctx, l))?.localId ?? null;
}

// ABC: classe A nas faixas mais próximas da expedição; se a faixa lota, transborda para a vizinha.
function abc(ctx: ContextoPolitica, produtoId: string): string | null {
  const lista = ctx.porProximidade;
  const n = lista.length;
  const classe = ctx.curva.classe.get(produtoId) ?? 'C';
  const limite = (f: 'A' | 'B' | 'C') => Math.ceil(n * FAIXAS[f]);
  const inicio = (f: 'A' | 'B' | 'C') => (f === 'A' ? 0 : limite(f === 'B' ? 'A' : 'B'));
  for (const f of ORDEM_FAIXAS[classe]) {
    for (let i = inicio(f); i < limite(f); i++) if (livre(ctx, lista[i])) return lista[i].localId;
  }
  return null;
}

/**
 * Consolidação: o local livre da rua que já guarda mais paletes do produto (os reservados contam). Empate: a rua
 * mais bem ranqueada, depois a posição mais perto da doca e o andar mais baixo — a mesma ordem de
 * `alocarComCandidatos` ("topOff" primeiro, depois posição, andar). Produto que ainda não está em rua nenhuma
 * começa na melhor rua do ranking.
 */
function consolidar(ctx: ContextoPolitica, produtoId: string): string | null {
  const doProduto = new Map<string, number>();
  for (const l of ctx.layout.locais) {
    const e = ctx.locais.get(l.localId);
    if (e && e.produtoId === produtoId && (e.situacao === 'Ocupado' || e.situacao === 'Reservado')) {
      doProduto.set(l.ruaId, (doProduto.get(l.ruaId) ?? 0) + 1);
    }
  }
  let melhor: LayoutLocal | null = null;
  const chave = (l: LayoutLocal) => [-(doProduto.get(l.ruaId) ?? 0), ctx.ranking.get(l.ruaId) ?? Infinity, l.posicao, l.andar];
  let chaveMelhor: number[] = [];
  for (const l of ctx.layout.locais) {
    if (!livre(ctx, l)) continue;
    const k = chave(l);
    if (melhor === null || menor(k, chaveMelhor)) { melhor = l; chaveMelhor = k; }
  }
  return melhor?.localId ?? null;
}

function menor(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * WMS Office (offline): `sugerirDestino` do Java sobre os locais livres, com a prioridade da rua no `RankingRua`.
 * Cada local do jogo guarda um palete inteiro, então nenhum candidato "completa pallet" (loteOcupanteId é sempre
 * nulo) e a regra se reduz a: melhor rua do ranking, depois o id do local em ordem de texto (como o Java).
 */
function wmsReal(ctx: ContextoPolitica, loteId: string): string | null {
  const r = sugerirDestino(null, { loteId, candidatos: candidatosWmsReal(ctx) });
  return r.sucesso ? r.localArmazenagemId : null;
}

/** A entrada de `sugerirDestino` para um palete: os locais livres, cada um com a prioridade da sua rua no `RankingRua`. */
export function candidatosWmsReal(ctx: ContextoPolitica): CandidatoDestino[] {
  const candidatos: CandidatoDestino[] = [];
  for (const l of ctx.layout.locais) {
    if (livre(ctx, l)) candidatos.push({ localArmazenagemId: l.localId, loteOcupanteId: null, prioridade: ctx.ranking.get(l.ruaId) ?? null });
  }
  return candidatos;
}

/** FIFO: os `qtd` paletes mais antigos do produto ainda não reservados (empate: o mais perto da expedição). */
export function escolherOrigens(ctx: ContextoPolitica, produtoId: string, qtd: number): string[] {
  const candidatos: { id: string; entrada: number; dist: number; ordem: number }[] = [];
  ctx.layout.locais.forEach((l, ordem) => {
    const e = ctx.locais.get(l.localId);
    if (e && e.situacao === 'Ocupado' && e.produtoId === produtoId && !e.reservadoSaida) {
      candidatos.push({ id: l.localId, entrada: e.entradaSeg, dist: ctx.distExpedicao.get(l.localId) ?? 0, ordem });
    }
  });
  candidatos.sort((a, b) => a.entrada - b.entrada || a.dist - b.dist || a.ordem - b.ordem);
  return candidatos.slice(0, qtd).map(c => c.id);
}
