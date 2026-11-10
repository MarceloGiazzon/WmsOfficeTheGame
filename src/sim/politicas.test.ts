import { beforeEach, describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import { calcularCurvaAbc } from './estoque';
import { construirLayout } from './layout';
import type { EstadoLocal, PacoteCenario } from './model';
import { escolherDestino, type ContextoPolitica } from './politicas';

const pacote = whA as unknown as PacoteCenario;

/** Contexto mínimo para testar a escolha de destino sem rodar o motor. Todo local livre; ranking = ordem das ruas. */
function contexto(): ContextoPolitica {
  const layout = construirLayout(pacote);
  const locais = new Map<string, EstadoLocal>(layout.locais.map(l => [l.localId,
    { situacao: 'Disponivel', produtoId: null, entradaSeg: 0, reservadoSaida: false, acessos: 0 }]));
  return {
    layout, locais, curva: calcularCurvaAbc(pacote), porProximidade: layout.locais,
    distExpedicao: new Map(layout.locais.map((l, i) => [l.localId, i])),
    ranking: new Map(pacote.rankingRuas.map(r => [r.ruaId, r.prioridade])),
  };
}

const ocupar = (ctx: ContextoPolitica, localId: string, produtoId: string, situacao: 'Ocupado' | 'Reservado' = 'Ocupado') =>
  Object.assign(ctx.locais.get(localId)!, { situacao, produtoId });

describe('Consolidacao', () => {
  let ctx: ContextoPolitica;
  beforeEach(() => { ctx = contexto(); });
  const ruaDe = (id: string | null) => ctx.layout.locais.find(l => l.localId === id)?.ruaId;
  const rua = (n: number) => ctx.layout.ruas[n].ruaId;
  const primeiroDaRua = (n: number) => ctx.layout.locais.find(l => l.ruaId === rua(n))!.localId;

  it('produto que ainda não está em lugar nenhum começa na melhor rua do ranking, na posição mais próxima', () => {
    const id = escolherDestino('Consolidacao', ctx, 'WHAprod01');
    expect(id).toBe(primeiroDaRua(0));
  });

  it('vai para a rua que já guarda mais paletes do produto, mesmo sendo pior no ranking', () => {
    const outraRua = ctx.layout.locais.filter(l => l.ruaId === rua(2));
    ocupar(ctx, outraRua[0].localId, 'WHAprod01');
    ocupar(ctx, outraRua[1].localId, 'WHAprod01');
    ocupar(ctx, primeiroDaRua(0), 'WHAprod01'); // 1 na melhor rua, 2 na rua 3
    expect(ruaDe(escolherDestino('Consolidacao', ctx, 'WHAprod01'))).toBe(rua(2));
  });

  it('palete reservado (a caminho) conta como estoque do produto', () => {
    ocupar(ctx, ctx.layout.locais.find(l => l.ruaId === rua(1))!.localId, 'WHAprod01', 'Reservado');
    expect(ruaDe(escolherDestino('Consolidacao', ctx, 'WHAprod01'))).toBe(rua(1));
  });

  it('produto de outro tipo não atrai: só conta o mesmo produto', () => {
    ocupar(ctx, ctx.layout.locais.find(l => l.ruaId === rua(2))!.localId, 'WHAprod02');
    expect(ruaDe(escolherDestino('Consolidacao', ctx, 'WHAprod01'))).toBe(rua(0));
  });

  it('rua cheia: usa a próxima com o produto; sem nenhum local livre devolve null', () => {
    for (const l of ctx.layout.locais) ocupar(ctx, l.localId, 'WHAprod02');
    expect(escolherDestino('Consolidacao', ctx, 'WHAprod01')).toBeNull();
    const livre = ctx.layout.locais[ctx.layout.locais.length - 1];
    Object.assign(ctx.locais.get(livre.localId)!, { situacao: 'Disponivel', produtoId: null });
    expect(escolherDestino('Consolidacao', ctx, 'WHAprod01')).toBe(livre.localId);
  });
});

describe('WmsReal (porta de sugerirDestino + RankingRua)', () => {
  it('escolhe o local livre da rua de menor prioridade no ranking', () => {
    const ctx = contexto();
    const ruaMelhor = pacote.rankingRuas.find(r => r.prioridade === 1)!.ruaId;
    expect(ctx.layout.locais.find(l => l.localId === escolherDestino('WmsReal', ctx, 'WHAprod01'))!.ruaId).toBe(ruaMelhor);
  });

  it('inverte o ranking → muda a escolha (o RankingRua é o que manda, não a ordem de varredura)', () => {
    const ctx = contexto();
    const n = pacote.rankingRuas.length;
    const invertido = { ...ctx, ranking: new Map(pacote.rankingRuas.map(r => [r.ruaId, n + 1 - r.prioridade])) };
    const ruaPior = pacote.rankingRuas.find(r => r.prioridade === n)!.ruaId;
    const id = escolherDestino('WmsReal', invertido, 'WHAprod01');
    expect(invertido.layout.locais.find(l => l.localId === id)!.ruaId).toBe(ruaPior);
  });

  it('rua fora do ranking só entra se não houver nenhuma ranqueada livre', () => {
    const ctx = contexto();
    const semRanking = ctx.layout.ruas[ctx.layout.ruas.length - 1].ruaId;
    const parcial = { ...ctx, ranking: new Map([...ctx.ranking].filter(([r]) => r !== semRanking)) };
    for (const l of parcial.layout.locais) if (l.ruaId !== semRanking) ocupar(parcial, l.localId, 'WHAprod02');
    const id = escolherDestino('WmsReal', parcial, 'WHAprod01');
    expect(parcial.layout.locais.find(l => l.localId === id)!.ruaId).toBe(semRanking);
  });

  it('sem local livre devolve null', () => {
    const ctx = contexto();
    for (const l of ctx.layout.locais) ocupar(ctx, l.localId, 'WHAprod02');
    expect(escolherDestino('WmsReal', ctx, 'WHAprod01')).toBeNull();
  });
});
