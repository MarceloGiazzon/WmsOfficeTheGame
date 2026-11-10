// Leitura paginada do NPDev, compartilhada por pacote.ts e partidas.ts.
//
// Os dois caminhos que existem para a role Jogador (o REST `GET /api/<concept>` ignora filtros e corta em 1000 sem
// offset, então não serve — ver pacote.ts):
//   - `GET /api/concepts/<Concept>/page`: filtro de igualdade por campo, `sort`, `offset`, `limit` (máx. 1000);
//   - `GET /api/queries/<Nome>`: queries nomeadas do model.json, com os mesmos `offset`/`limit`.

import type { Http } from './npdevClient';
import { erroDeFormato, lista, objeto, type Obj } from './validacao';

/** Máximo que o NPDev aceita por página (`ConceptQuery.MAX_LIMIT`); pedir mais é cortado em silêncio. */
export const TAMANHO_PAGINA = 1000;
/** Trava contra servidor que nunca diz `hasMore:false` (ou devolve sempre as mesmas linhas). */
const MAX_PAGINAS = 200;
/** Chamadas simultâneas (uma por rua etc.): o bastante para o pacote do WH-B carregar rápido sem afogar um celular. */
export const PARALELISMO = 6;

export type Filtros = Record<string, string | number | boolean>;

/** Todas as linhas de `/concepts/<Concept>/page` com os filtros de igualdade dados, paginando até o fim. */
export async function listarConceito(http: Http, conceito: string, filtros: Filtros = {}): Promise<Obj[]> {
  const linhas: Obj[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    // sort=id: sem ordem estável, páginas por offset podem repetir/pular linhas
    const r = objeto(await http.get(`/concepts/${conceito}/page`, {
      ...filtros, sort: 'id', direction: 'asc', limit: TAMANHO_PAGINA, offset: linhas.length,
    }), conceito);
    const lote = lista(r.items, `${conceito}.items`).map((x, i) => objeto(x, `${conceito}.items[${i}]`));
    linhas.push(...lote);
    if (r.hasMore !== true) {
      if (typeof r.total === 'number' && linhas.length < r.total) {
        throw erroDeFormato(`${conceito}: vieram ${linhas.length} de ${r.total} linhas`);
      }
      return linhas;
    }
    if (lote.length === 0) throw erroDeFormato(`${conceito}: página vazia mas hasMore=true`);
  }
  throw erroDeFormato(`${conceito}: mais de ${MAX_PAGINAS} páginas`);
}

export interface RespostaQuery {
  rows: Obj[];
  /** Quantas linhas a query tem no total (ignorando limit/offset), se o servidor informou. */
  total: number | null;
}

/** Uma página de `/queries/<nome>`. `limite` é cortado em 1000 pelo servidor. */
export async function lerQuery(http: Http, nome: string, params: Filtros = {}, limite?: number, offset?: number): Promise<RespostaQuery> {
  const r = objeto(await http.get(`/queries/${nome}`, { ...params, ...(limite !== undefined ? { limit: limite } : {}), ...(offset !== undefined ? { offset } : {}) }), nome);
  return {
    rows: lista(r.rows, `${nome}.rows`).map((x, i) => objeto(x, `${nome}.rows[${i}]`)),
    total: typeof r.total === 'number' ? r.total : null,
  };
}

/** Todas as linhas de `/queries/<nome>`, paginando por offset até `total`. */
export async function listarQuery(http: Http, nome: string, params: Filtros = {}): Promise<Obj[]> {
  const linhas: Obj[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { rows, total } = await lerQuery(http, nome, params, TAMANHO_PAGINA, linhas.length);
    linhas.push(...rows);
    const esperado = total ?? linhas.length;
    if (linhas.length >= esperado) return linhas;
    if (rows.length === 0) throw erroDeFormato(`${nome}: vieram ${linhas.length} de ${esperado} linhas`);
  }
  throw erroDeFormato(`${nome}: mais de ${MAX_PAGINAS} páginas`);
}

/** `map` assíncrono com no máximo `limite` chamadas ao mesmo tempo; mantém a ordem; para de começar trabalho novo no primeiro erro. */
export async function emParalelo<T, R>(itens: readonly T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  let falhou = false;
  const trabalhador = async (): Promise<void> => {
    while (!falhou) {
      const i = proximo++;
      if (i >= itens.length) return;
      try { saida[i] = await fn(itens[i]); } catch (e) { falhou = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return saida;
}
