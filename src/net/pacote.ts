// N4, opção A: monta o `PacoteCenario` (src/sim/model.ts) no cliente, só com chamadas REST que a role Jogador pode
// fazer. O resultado é o mesmo formato dos pacotes embutidos em src/data/cenarios/*.json (gerados dos seeds), com
// UUIDs do banco no lugar dos aliases do seed.
//
// Por que NÃO usar `GET /api/<concept>` (a lista "óbvia"): o REST gerado ignora filtros e devolve no máximo 1000
// linhas (cabeçalho `X-List-Truncated: true`, sem offset). Os cenários semeados têm 1500 locais — a lista cortaria em
// silêncio e a sim jogaria um armazém incompleto. O que existe e funciona para a role Jogador:
//   - `GET /api/concepts/<Concept>/page` — paginado no banco, com filtro de IGUALDADE por qualquer campo
//     (`?ruaId=…`), `sort`, `offset`, `limit` (máx. 1000) e `{items,total,hasMore}`;
//   - `GET /api/queries/<Nome>` — `CenariosAtivos` e `OrdensPorCenario?cenarioId=` (também paginam, máx. 1000);
// `/page` num concept que a role não lê responde 200 com lista VAZIA (não 403) — por isso `validarPacote` recusa
// pacote sem locais/ordens em vez de entregar um armazém vazio.
//
// O que o REST não dá e como o pacote resolve:
//   - Local só aponta para a Rua (sem armazém): busca-se por rua, não por armazém.
//   - Produto não é do cenário: vêm os do `PerfilAlocacao` das ruas (RankingRua) e, para garantir, os das ordens.
//   - Ordem dos registros: o banco devolve por id (UUID, aleatório). O pacote sai em ordem canônica (rua, posição,
//     andar; código; liberação), independente do servidor — a sim não deve depender da ordem de chegada.

import type {
  Area, Armazem, Cenario, Dificuldade, FuncaoArea, LocalArmazenagem, Ordem, PacoteCenario, Produto, RankingRua, Rua,
  SituacaoLocal, TipoOrdem,
} from '../sim/model';
import { NpdevError } from './erros';
import type { Http } from './npdevClient';
import { emParalelo, listarConceito, listarQuery, PARALELISMO } from './leitura';
import { enumerado, inteiro, lista, objeto, texto, erroDeFormato, type Obj } from './validacao';

const DIFICULDADES = ['Facil', 'Medio', 'Dificil', 'Extremo'] as const satisfies readonly Dificuldade[];
const FUNCOES = ['Armazenagem', 'Recebimento', 'Expedicao', 'PrePicking', 'Avarias', 'CrossDocking'] as const satisfies readonly FuncaoArea[];
const SITUACOES = ['Disponivel', 'Ocupado', 'Reservado', 'Bloqueado'] as const satisfies readonly SituacaoLocal[];
const TIPOS_ORDEM = ['Inbound', 'Outbound'] as const satisfies readonly TipoOrdem[];

// ---- mapeadores linha REST → tipo do modelo (só os campos do modelo; o resto — version, tenantId, ativo… — cai) ---

const paraCenario = (r: Obj, onde = 'cenario'): Cenario => ({
  id: texto(r, 'id', onde),
  codigo: texto(r, 'codigo', onde),
  nome: texto(r, 'nome', onde),
  dificuldade: enumerado(r, 'dificuldade', DIFICULDADES, onde),
  armazemId: texto(r, 'armazemId', onde),
  seed: inteiro(r, 'seed', onde),
  qtdDocasInbound: inteiro(r, 'qtdDocasInbound', onde),
  qtdDocasOutbound: inteiro(r, 'qtdDocasOutbound', onde),
  qtdEquipamentos: inteiro(r, 'qtdEquipamentos', onde),
  velocidadeEquipamentoCmS: inteiro(r, 'velocidadeEquipamentoCmS', onde),
  tempoDescargaSeg: inteiro(r, 'tempoDescargaSeg', onde),
  inicioTurnoSeg: inteiro(r, 'inicioTurnoSeg', onde),
  fimTurnoSeg: inteiro(r, 'fimTurnoSeg', onde),
  // opcional: só aparece quando o cenário veio do WmsOffice corporativo (qualquer outro valor/ausência = do jogo)
  ...(r.procedencia === 'Corporativo' ? { procedencia: 'Corporativo' as const } : {}),
});

const paraArmazem = (r: Obj, onde = 'armazem'): Armazem => ({ id: texto(r, 'id', onde), nome: texto(r, 'nome', onde) });

const paraArea = (r: Obj, onde = 'area'): Area => ({
  id: texto(r, 'id', onde), armazemId: texto(r, 'armazemId', onde), nome: texto(r, 'nome', onde),
  funcao: enumerado(r, 'funcao', FUNCOES, onde),
});

const paraRua = (r: Obj, onde = 'rua'): Rua => ({
  id: texto(r, 'id', onde), areaId: texto(r, 'areaId', onde), codigo: texto(r, 'codigo', onde),
  qtdPosicoes: inteiro(r, 'qtdPosicoes', onde), qtdAndares: inteiro(r, 'qtdAndares', onde),
});

const paraLocal = (r: Obj, onde = 'local'): LocalArmazenagem => ({
  id: texto(r, 'id', onde), ruaId: texto(r, 'ruaId', onde), posicao: inteiro(r, 'posicao', onde),
  andar: inteiro(r, 'andar', onde), situacao: enumerado(r, 'situacao', SITUACOES, onde),
});

const paraProduto = (r: Obj, onde = 'produto'): Produto => ({
  id: texto(r, 'id', onde), codigo: texto(r, 'codigo', onde), nome: texto(r, 'nome', onde),
  qtdCaixasPorPallet: inteiro(r, 'qtdCaixasPorPallet', onde),
});

const paraOrdem = (r: Obj, onde = 'ordem'): Ordem => ({
  id: texto(r, 'id', onde), numero: texto(r, 'numero', onde), tipo: enumerado(r, 'tipo', TIPOS_ORDEM, onde),
  liberacaoSeg: inteiro(r, 'liberacaoSeg', onde), slaSeg: inteiro(r, 'slaSeg', onde),
  produtoId: texto(r, 'produtoId', onde), quantidadePaletes: inteiro(r, 'quantidadePaletes', onde),
});

const paraRanking = (r: Obj, onde = 'rankingRua'): RankingRua => ({
  ruaId: texto(r, 'ruaId', onde), prioridade: inteiro(r, 'prioridade', onde),
});

const unicos = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

// ---- cenários ---------------------------------------------------------------------------------------------------

/** Cenários ativos (query `CenariosAtivos`), por código. Alimenta a tela de seleção quando há login. */
export async function listarCenarios(http: Http): Promise<Cenario[]> {
  const linhas = await listarQuery(http, 'CenariosAtivos');
  return linhas.map((r, i) => paraCenario(r, `CenariosAtivos[${i}]`)).sort((a, b) => cmp(a.codigo, b.codigo));
}

/** O cenário ativo com este código (com o `id` do banco, que `SimPartida.cenarioId` exige). `nao_encontrado` se não há. */
export async function buscarCenario(http: Http, codigo: string): Promise<Cenario> {
  const cenario = (await listarCenarios(http)).find(c => c.codigo === codigo);
  if (!cenario) throw new NpdevError('nao_encontrado', `Cenário ${codigo} não encontrado entre os cenários ativos.`);
  return cenario;
}

// ---- pacote -----------------------------------------------------------------------------------------------------

/**
 * Monta o pacote do cenário `codigo` pela API do jogo. Para jogar offline, guarde o resultado (`cache.ts`).
 * Falha com `NpdevError` (nunca devolve pacote parcial): `nao_encontrado` se o cenário não está ativo,
 * `resposta_invalida` se o servidor devolveu algo incompleto/inconsistente, e os demais tipos de `erros.ts`.
 */
export async function carregarPacote(http: Http, codigo: string): Promise<PacoteCenario> {
  const cenario = await buscarCenario(http, codigo);

  const [armazens, areasRows, ordensRows] = await Promise.all([
    listarConceito(http, 'Armazem', { id: cenario.armazemId }),
    listarConceito(http, 'Area', { armazemId: cenario.armazemId }),
    listarQuery(http, 'OrdensPorCenario', { cenarioId: cenario.id }),
  ]);
  if (armazens.length === 0) throw new NpdevError('nao_encontrado', `Armazém do cenário ${codigo} não encontrado.`);
  const armazem = paraArmazem(armazens[0], 'armazem');
  const areas = areasRows.map((r, i) => paraArea(r, `areas[${i}]`));
  const ordens = ordensRows.map((r, i) => paraOrdem(r, `ordens[${i}]`));

  const ruas = (await emParalelo(areas, PARALELISMO, a => listarConceito(http, 'Rua', { areaId: a.id })))
    .flat().map((r, i) => paraRua(r, `ruas[${i}]`));
  const [locaisPorRua, rankingPorRua] = await Promise.all([
    emParalelo(ruas, PARALELISMO, r => listarConceito(http, 'LocalArmazenagem', { ruaId: r.id })),
    emParalelo(ruas, PARALELISMO, r => listarConceito(http, 'RankingRua', { ruaId: r.id })),
  ]);
  const locais = locaisPorRua.flat().map((r, i) => paraLocal(r, `locais[${i}]`));

  // Produtos do cenário = os do perfil de alocação das suas ruas (inclui os que não têm ordem) + os das ordens.
  const rankingRows = rankingPorRua.flat();
  const perfis = unicos(rankingRows.flatMap(r => (typeof r.perfilAlocacaoId === 'string' ? [r.perfilAlocacaoId] : [])));
  const produtosPorPerfil = new Map<string, Produto[]>();
  await emParalelo(perfis, PARALELISMO, async p => {
    produtosPorPerfil.set(p, (await listarConceito(http, 'Produto', { perfilAlocacaoId: p })).map((r, i) => paraProduto(r, `produtos[${i}]`)));
  });
  // Mais de um perfil nas ruas do cenário não acontece nos seeds; se acontecer, vale o que cobre mais produtos das ordens.
  const idsOrdens = new Set(ordens.map(o => o.produtoId));
  const perfil = [...perfis].sort((a, b) => cmp(a, b))
    .map(p => ({ p, cobre: produtosPorPerfil.get(p)!.filter(x => idsOrdens.has(x.id)).length }))
    .sort((a, b) => b.cobre - a.cobre)[0]?.p;
  const produtos = new Map((perfil !== undefined ? produtosPorPerfil.get(perfil)! : []).map(p => [p.id, p]));
  const faltantes = [...idsOrdens].filter(id => !produtos.has(id));
  await emParalelo(faltantes, PARALELISMO, async id => {
    const achado = await listarConceito(http, 'Produto', { id });
    if (achado.length === 0) throw new NpdevError('nao_encontrado', `Produto ${id} de uma ordem do cenário ${codigo} não existe.`);
    produtos.set(id, paraProduto(achado[0], 'produto'));
  });

  // RankingRua do perfil escolhido (uma prioridade por rua; havendo repetição, a menor).
  const prioridade = new Map<string, number>();
  for (const r of rankingRows) {
    if (perfil !== undefined && r.perfilAlocacaoId !== perfil) continue;
    const { ruaId, prioridade: pr } = paraRanking(r);
    prioridade.set(ruaId, Math.min(pr, prioridade.get(ruaId) ?? Infinity));
  }

  return validarPacote({
    cenario, armazem, areas, ruas, locais, produtos: [...produtos.values()], ordens,
    rankingRuas: [...prioridade].map(([ruaId, pr]) => ({ ruaId, prioridade: pr })),
  });
}

/**
 * Confere e normaliza um pacote vindo de fora do tipo (REST, cache em disco): cada campo é validado como na leitura do
 * REST, as referências têm de fechar e as listas essenciais não podem estar vazias. Devolve em ordem canônica.
 * Lança `NpdevError('resposta_invalida')` — quem lê o cache trata isso como "cache inutilizável".
 */
export function validarPacote(v: unknown): PacoteCenario {
  const o = objeto(v, 'pacote');
  const lerLista = <T>(campo: string, ler: (r: Obj, onde: string) => T): T[] =>
    lista(o[campo], `pacote.${campo}`).map((x, i) => ler(objeto(x, `pacote.${campo}[${i}]`), `${campo}[${i}]`));

  const cenario = paraCenario(objeto(o.cenario, 'pacote.cenario'));
  const armazem = paraArmazem(objeto(o.armazem, 'pacote.armazem'));
  const areas = lerLista('areas', paraArea);
  const ruas = lerLista('ruas', paraRua);
  const locais = lerLista('locais', paraLocal);
  const produtos = lerLista('produtos', paraProduto);
  const ordens = lerLista('ordens', paraOrdem);
  const rankingRuas = lerLista('rankingRuas', paraRanking);

  for (const [nome, n] of [['areas', areas.length], ['ruas', ruas.length], ['locais', locais.length], ['produtos', produtos.length], ['ordens', ordens.length]] as const) {
    // vazio quase sempre é permissão negada silenciosa (/page devolve 200 e lista vazia) ou banco sem seed
    if (n === 0) throw erroDeFormato(`o pacote do cenário ${cenario.codigo} veio sem ${nome}`);
  }
  if (cenario.armazemId !== armazem.id) throw erroDeFormato('o armazém do pacote não é o do cenário');
  if (cenario.inicioTurnoSeg >= cenario.fimTurnoSeg) throw erroDeFormato('turno com início depois do fim');
  const areaIds = new Set(areas.map(a => a.id));
  const ruaPorId = new Map(ruas.map(r => [r.id, r]));
  const produtoIds = new Set(produtos.map(p => p.id));
  if (areas.some(a => a.armazemId !== armazem.id)) throw erroDeFormato('área de outro armazém');
  if (ruas.some(r => !areaIds.has(r.areaId))) throw erroDeFormato('rua fora das áreas do armazém');
  if (locais.some(l => !ruaPorId.has(l.ruaId))) throw erroDeFormato('local fora das ruas do armazém');
  if (ordens.some(x => !produtoIds.has(x.produtoId))) throw erroDeFormato('ordem com produto que não está no pacote');
  if (rankingRuas.some(r => !ruaPorId.has(r.ruaId))) throw erroDeFormato('ranking de rua que não está no pacote');

  const codigoRua = (id: string): string => ruaPorId.get(id)!.codigo;
  return {
    cenario, armazem,
    areas: areas.sort((a, b) => cmp(a.nome, b.nome) || cmp(a.id, b.id)),
    ruas: ruas.sort((a, b) => cmp(a.codigo, b.codigo) || cmp(a.id, b.id)),
    locais: locais.sort((a, b) => cmp(codigoRua(a.ruaId), codigoRua(b.ruaId)) || a.posicao - b.posicao || a.andar - b.andar || cmp(a.id, b.id)),
    produtos: produtos.sort((a, b) => cmp(a.codigo, b.codigo) || cmp(a.id, b.id)),
    ordens: ordens.sort((a, b) => a.liberacaoSeg - b.liberacaoSeg || cmp(a.numero, b.numero) || cmp(a.id, b.id)),
    rankingRuas: rankingRuas.sort((a, b) => a.prioridade - b.prioridade || cmp(codigoRua(a.ruaId), codigoRua(b.ruaId))),
  };
}
