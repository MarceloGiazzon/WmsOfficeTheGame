// Layout físico do armazém, em cm, derivado do pacote do cenário (Rua.qtdPosicoes × qtdAndares).
//
//   x →
//   ┌────────┬──────────┬──────────────────────────────────── corredor (acesso das posições de R01)
//   │ DOCA   │ corredor │ R01: P01 P02 P03 …              ← rack (andares empilhados no mesmo x,y)
//   │ OUT 1  │ principal├──────────────────────────────────── corredor (acesso de R02)
//   │ DOCA   │          │ R02: P01 P02 …
//   │ OUT 2  │          ├────────────────────────────────────
//   │  …     │          │ …
//   │ DOCA IN│          │ Rn
//   └────────┴──────────┴────────────────────────────────────
//
// - Docas na parede esquerda: as de SAÍDA no alto (perto de R01, a rua de prioridade 1 no RankingRua),
//   as de ENTRADA embaixo.
// - Posição 1 de cada rua é a mais próxima das docas. Cada posição é acessada pelo corredor logo acima da rack.
// - Distâncias e caminhos (F2) usam estes pontos de acesso; o render só desenha.

import type { PacoteCenario, TipoOrdem } from './model';

export const GEOMETRIA = {
  larguraPosicaoCm: 120,      // frente de um palete ao longo da rua
  profundidadeRackCm: 110,
  corredorCm: 300,            // corredor entre racks (acesso de uma rua)
  corredorPrincipalCm: 400,   // entre as docas e o início das ruas
  profundidadeDocaCm: 400,
  larguraDocaCm: 350,
} as const;

export interface Ponto { x: number; y: number; }
export interface Retangulo { x: number; y: number; largura: number; altura: number; }

export interface LayoutLocal {
  localId: string;
  ruaId: string;
  ruaCodigo: string;
  posicao: number;
  andar: number;
  rect: Retangulo;
  /** Onde o equipamento para para acessar a posição (no corredor da rua). */
  acesso: Ponto;
}

export interface LayoutDoca {
  localId: string;
  tipo: TipoOrdem;
  numero: number;
  rect: Retangulo;
  acesso: Ponto;
}

export interface LayoutRua {
  ruaId: string;
  codigo: string;
  indice: number;
  rect: Retangulo;
  /** Linha central do corredor que serve a rua. */
  corredorY: number;
}

export interface Layout {
  largura: number;
  altura: number;
  /** x da linha central do corredor principal (liga docas e corredores das ruas). */
  corredorPrincipalX: number;
  ruas: LayoutRua[];
  locais: LayoutLocal[];
  docas: LayoutDoca[];
}

export function construirLayout(p: PacoteCenario): Layout {
  const g = GEOMETRIA;
  const funcaoDaArea = new Map(p.areas.map(a => [a.id, a.funcao]));
  const ruasArmazenagem = p.ruas
    .filter(r => funcaoDaArea.get(r.areaId) === 'Armazenagem')
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
  const ruaDoca = (funcao: 'Recebimento' | 'Expedicao') => p.ruas.filter(r => funcaoDaArea.get(r.areaId) === funcao);

  const passo = g.profundidadeRackCm + g.corredorCm;
  const xRacks = g.profundidadeDocaCm + g.corredorPrincipalCm;
  const maxPosicoes = Math.max(1, ...ruasArmazenagem.map(r => r.qtdPosicoes));

  const ruas: LayoutRua[] = ruasArmazenagem.map((r, i) => ({
    ruaId: r.id,
    codigo: r.codigo,
    indice: i,
    rect: { x: xRacks, y: g.corredorCm + i * passo, largura: r.qtdPosicoes * g.larguraPosicaoCm,
            altura: g.profundidadeRackCm },
    corredorY: i * passo + g.corredorCm / 2,
  }));
  const ruaPorId = new Map(ruas.map(r => [r.ruaId, r]));

  const locais: LayoutLocal[] = [];
  for (const l of p.locais) {
    const r = ruaPorId.get(l.ruaId);
    if (!r) continue; // locais de doca entram em `docas`
    const x = r.rect.x + (l.posicao - 1) * g.larguraPosicaoCm;
    locais.push({
      localId: l.id, ruaId: r.ruaId, ruaCodigo: r.codigo, posicao: l.posicao, andar: l.andar,
      rect: { x, y: r.rect.y, largura: g.larguraPosicaoCm, altura: g.profundidadeRackCm },
      acesso: { x: x + g.larguraPosicaoCm / 2, y: r.corredorY },
    });
  }
  locais.sort((a, b) => a.ruaCodigo.localeCompare(b.ruaCodigo) || a.posicao - b.posicao || a.andar - b.andar);

  const alturaRacks = g.corredorCm + ruas.length * passo;
  const nOut = ruaDoca('Expedicao').reduce((n, r) => n + r.qtdPosicoes, 0);
  const nIn = ruaDoca('Recebimento').reduce((n, r) => n + r.qtdPosicoes, 0);
  const altura = Math.max(alturaRacks, (nOut + nIn + 1) * g.larguraDocaCm);
  const largura = xRacks + maxPosicoes * g.larguraPosicaoCm + g.corredorCm;
  const corredorPrincipalX = g.profundidadeDocaCm + g.corredorPrincipalCm / 2;

  const docas: LayoutDoca[] = [];
  const locaisDaRua = (ruaIds: Set<string>) => p.locais
    .filter(l => ruaIds.has(l.ruaId) && l.andar === 1)
    .sort((a, b) => a.posicao - b.posicao);
  const doca = (localId: string, tipo: TipoOrdem, numero: number, y: number): LayoutDoca => ({
    localId, tipo, numero,
    rect: { x: 0, y, largura: g.profundidadeDocaCm, altura: g.larguraDocaCm },
    acesso: { x: corredorPrincipalX, y: y + g.larguraDocaCm / 2 },
  });
  locaisDaRua(new Set(ruaDoca('Expedicao').map(r => r.id)))
    .forEach((l, i) => docas.push(doca(l.id, 'Outbound', i + 1, i * g.larguraDocaCm)));
  locaisDaRua(new Set(ruaDoca('Recebimento').map(r => r.id)))
    .forEach((l, i) => docas.push(doca(l.id, 'Inbound', i + 1, altura - (nIn - i) * g.larguraDocaCm)));

  return { largura, altura, corredorPrincipalX, ruas, locais, docas };
}

/** Distância Manhattan entre dois pontos (cm). */
export function manhattan(a: Ponto, b: Ponto): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
