// Escolha de destino (putaway) e de origem (picking). Funções puras sobre o estado dos locais.
//
// F2 traz as duas políticas que não dependem de nada além do layout e da curva ABC. As demais (F3) ainda não
// existem: `politicaEfetiva` diz qual regra realmente roda, e a sim avisa no log quando cai no fallback.

import type { Layout, LayoutLocal } from './layout';
import type { CurvaAbc } from './estoque';
import type { EstadoLocal, Politica } from './model';

export interface ContextoPolitica {
  readonly layout: Layout;
  readonly locais: ReadonlyMap<string, EstadoLocal>;
  readonly curva: CurvaAbc;
  /** Locais de armazenagem do mais próximo ao mais distante da expedição (empate: ordem de varredura). */
  readonly porProximidade: readonly LayoutLocal[];
  /** Distância (cm) do local até a doca de saída mais próxima. */
  readonly distExpedicao: ReadonlyMap<string, number>;
}

export const POLITICA_FALLBACK: Politica = 'FifoPrimeiraLivre';
const IMPLEMENTADAS: readonly Politica[] = ['FifoPrimeiraLivre', 'AbcProximidade'];

export function politicaEfetiva(p: Politica): Politica {
  return IMPLEMENTADAS.includes(p) ? p : POLITICA_FALLBACK;
}

const livre = (ctx: ContextoPolitica, l: LayoutLocal): boolean => ctx.locais.get(l.localId)?.situacao === 'Disponivel';

/** Faixas da curva sobre os locais ordenados por proximidade: A = 20% mais próximos, B = próximos 30%, C = o resto. */
const FAIXAS: Record<'A' | 'B' | 'C', number> = { A: 0.2, B: 0.5, C: 1 };
const ORDEM_FAIXAS: Record<'A' | 'B' | 'C', readonly ('A' | 'B' | 'C')[]> = {
  A: ['A', 'B', 'C'], B: ['B', 'A', 'C'], C: ['C', 'B', 'A'],
};

/** Local livre para guardar um palete de `produtoId`, ou null se não há nenhum. */
export function escolherDestino(politica: Politica, ctx: ContextoPolitica, produtoId: string): string | null {
  const efetiva = politicaEfetiva(politica);
  if (efetiva === 'FifoPrimeiraLivre') {
    return ctx.layout.locais.find(l => livre(ctx, l))?.localId ?? null;
  }
  // AbcProximidade: classe A nas faixas mais próximas da expedição; se a faixa lota, transborda para a vizinha.
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
