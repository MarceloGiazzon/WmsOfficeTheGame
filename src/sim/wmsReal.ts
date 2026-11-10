// Porta TS de AllocationCapability.sugerirDestino / sugerirOrigem (Java, backend/npdev) — D3.
//
// Mesmos formatos de entrada e saída do Java (JSON), para que as fixtures de paridade
// (backend/npdev/tests/fixtures/alocacao-casos.json) rodem idênticas nos dois lados: aqui no vitest, e lá no flow
// `SugerirDestinoJogo` (tests/f3_paridade_alocacao.py). Se a regra mudar no Java, o teste de paridade quebra.
//
// Detalhes que vêm do Java e não podem ser "melhorados" aqui:
//  - desempate por id é a ordem de unidades UTF-16 de String.compareTo (não localeCompare);
//  - prioridade ausente/ilegível = Integer.MAX_VALUE; data ausente/ilegível = LocalDate.MAX;
//  - a ordenação do Java é estável (List.sort) — Array.prototype.sort também.

export interface CandidatoDestino {
  localArmazenagemId: string;
  loteOcupanteId?: string | null;
  prioridade?: number | string | null;
}

export interface CrossDockingRef {
  recebimentoId?: string | null;
  expedicaoId?: string | null;
  situacao?: string | null;
  baiaLocalArmazenagemId?: string | null;
}

export interface EntradaSugerirDestino {
  recebimentoId?: string | null;
  loteId?: string | null;
  candidatos?: CandidatoDestino[] | null;
}

export interface ResultadoSugerirDestino {
  localArmazenagemId: string | null;
  motivo: string;
  sucesso: boolean;
}

export interface CandidatoOrigem {
  localArmazenagemId: string;
  loteId?: string | null;
  dataValidade?: string | null;
  prioridade?: number | string | null;
  quantidadeDisponivel?: number | string | null;
}

export interface EntradaSugerirOrigem {
  expedicaoId?: string | null;
  quantidadeNecessaria?: number | string | null;
  candidatos?: CandidatoOrigem[] | null;
}

export interface ResultadoSugerirOrigem {
  alocacoes?: { localArmazenagemId: string; loteId: string | null; quantidadeAlocada: number }[];
  quantidadeAtendida?: number;
  atendeuTotal?: boolean;
  motivo?: string;
  localArmazenagemId?: null;
  sucesso: boolean;
}

const INT_MAX = 2147483647;
const DATA_MAX = '9999-99-99'; // LocalDate.MAX: depois de qualquer data real (comparação por texto)

const mesmoId = (a: unknown, b: unknown): boolean => a != null && b != null && String(a) === String(b);

function prioridade(v: unknown): number {
  if (v == null) return INT_MAX;
  if (typeof v === 'number') return Math.trunc(v);
  const t = String(v).trim();
  const n = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
  return Number.isInteger(n) && n >= -2147483648 && n <= INT_MAX ? n : INT_MAX; // Integer.parseInt: fora do int → erro
}

function paraLong(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Math.trunc(v);
  const t = String(v).trim();
  return /^[+-]?\d+$/.test(t) ? Number(t) : 0;
}

/** Data ISO `yyyy-MM-dd` comparável como texto; qualquer outra coisa vira "para sempre" (como o Java). */
function data(v: unknown): string {
  if (v == null) return DATA_MAX;
  const t = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return DATA_MAX;
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(t) ? t : DATA_MAX; // 2026-02-30 não existe
}

const cmpTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function baiaAtiva(cds: readonly CrossDockingRef[] | null | undefined, campo: 'recebimentoId' | 'expedicaoId',
                   id: unknown): string | null {
  if (id == null || !cds) return null;
  for (const cd of cds) {
    if (mesmoId(cd[campo], id) && cd.situacao === 'Ativo' && cd.baiaLocalArmazenagemId != null) {
      return cd.baiaLocalArmazenagemId;
    }
  }
  return null;
}

/** `AllocationCapability.sugerirDestino`. */
export function sugerirDestino(crossDockings: readonly CrossDockingRef[] | null, entrada: EntradaSugerirDestino): ResultadoSugerirDestino {
  const baia = baiaAtiva(crossDockings, 'recebimentoId', entrada.recebimentoId);
  if (baia !== null) {
    return { localArmazenagemId: baia, motivo: 'Cross-Docking ativo: destino fixado na baia de cross-docking', sucesso: true };
  }
  const candidatos = entrada.candidatos;
  if (!candidatos || candidatos.length === 0) {
    return { localArmazenagemId: null, motivo: 'Nenhum local candidato informado', sucesso: false };
  }
  const loteId = entrada.loteId;
  const ordenados = [...candidatos].sort((a, b) =>
    Number(!mesmoId(a.loteOcupanteId, loteId)) - Number(!mesmoId(b.loteOcupanteId, loteId))
    || prioridade(a.prioridade) - prioridade(b.prioridade)
    || cmpTexto(String(a.localArmazenagemId), String(b.localArmazenagemId)));
  const escolhido = ordenados[0];
  return {
    localArmazenagemId: escolhido.localArmazenagemId,
    motivo: mesmoId(escolhido.loteOcupanteId, loteId)
      ? 'Local ja ocupado pelo mesmo lote (completar pallet)'
      : 'Local disponivel com maior prioridade de ranking',
    sucesso: true,
  };
}

/** `AllocationCapability.sugerirOrigem` (FEFO: validade, depois prioridade). */
export function sugerirOrigem(crossDockings: readonly CrossDockingRef[] | null, entrada: EntradaSugerirOrigem): ResultadoSugerirOrigem {
  const necessaria = paraLong(entrada.quantidadeNecessaria);
  const baia = baiaAtiva(crossDockings, 'expedicaoId', entrada.expedicaoId);
  if (baia !== null) {
    return {
      alocacoes: [{ localArmazenagemId: baia, loteId: null, quantidadeAlocada: necessaria }],
      quantidadeAtendida: necessaria,
      atendeuTotal: true,
      motivo: 'Cross-Docking ativo: origem fixada na baia de cross-docking',
      sucesso: true,
    };
  }
  const candidatos = entrada.candidatos;
  if (!candidatos || candidatos.length === 0) {
    return { localArmazenagemId: null, motivo: 'Nenhum local candidato informado', sucesso: false };
  }
  const ordenados = [...candidatos].sort((a, b) =>
    cmpTexto(data(a.dataValidade), data(b.dataValidade)) || prioridade(a.prioridade) - prioridade(b.prioridade));
  const alocacoes: NonNullable<ResultadoSugerirOrigem['alocacoes']> = [];
  let restante = necessaria;
  for (const c of ordenados) {
    if (restante <= 0) break;
    const disponivel = paraLong(c.quantidadeDisponivel);
    if (disponivel <= 0) continue;
    const alocado = Math.min(disponivel, restante);
    alocacoes.push({ localArmazenagemId: c.localArmazenagemId, loteId: c.loteId ?? null, quantidadeAlocada: alocado });
    restante -= alocado;
  }
  return { alocacoes, quantidadeAtendida: necessaria - restante, atendeuTotal: restante <= 0, sucesso: true };
}
