// Curva ABC e estoque inicial do turno.
//
// O "peso" de um produto é o seu giro de saída real no turno: paletes das ordens Outbound do cenário (a classe ABC
// é por frequência de saída). Não depende do nome do produto nem de campo extra no backend, e é a mesma medida
// que a política AbcProximidade usa. Produto sem saída no turno não entra na curva (conta como classe C).
//
// Estoque inicial (decisão da F2): OCUPACAO_INICIAL_CENTESIMOS dos locais livres começam com um palete, escolhidos
// ao acaso (seed do cenário) e com o produto sorteado conforme o peso — então os produtos de maior giro de saída
// têm mais estoque, e as ordens de saída das 08:00 têm o que separar.

import { Rng } from './rng';
import type { PacoteCenario } from './model';

export type ClasseAbc = 'A' | 'B' | 'C';

export interface CurvaAbc {
  /** Produtos em ordem decrescente de giro de saída (empate: por id). Só entram produtos com giro > 0. */
  readonly ordem: readonly string[];
  readonly peso: ReadonlyMap<string, number>;
  readonly classe: ReadonlyMap<string, ClasseAbc>;
}

const LIMITE_A = 0.8;
const LIMITE_B = 0.95;

export function calcularCurvaAbc(p: PacoteCenario): CurvaAbc {
  const peso = new Map<string, number>();
  for (const o of p.ordens) if (o.tipo === 'Outbound') peso.set(o.produtoId, (peso.get(o.produtoId) ?? 0) + o.quantidadePaletes);
  // Empate de giro: pelo CÓDIGO do produto, não pelo id. O id é um alias no pacote embutido e um UUID no pacote do
  // backend; desempatar por ele fazia a mesma partida render estoques (e scores) diferentes online e offline.
  const codigo = new Map(p.produtos.map(x => [x.id, x.codigo]));
  const porCodigo = (id: string) => codigo.get(id) ?? id;
  const ordem = [...peso.keys()].sort((a, b) => peso.get(b)! - peso.get(a)! || porCodigo(a).localeCompare(porCodigo(b)) || a.localeCompare(b));
  const total = ordem.reduce((n, id) => n + peso.get(id)!, 0);
  const classe = new Map<string, ClasseAbc>();
  let acumulado = 0;
  for (const id of ordem) {
    // classe pela fatia acumulada ANTES do produto: o que cruza o limite ainda pertence à classe de cima
    const antes = total === 0 ? 1 : acumulado / total;
    classe.set(id, antes < LIMITE_A ? 'A' : antes < LIMITE_B ? 'B' : 'C');
    acumulado += peso.get(id)!;
  }
  return { ordem, peso, classe };
}

export const OCUPACAO_INICIAL_CENTESIMOS = 6000;
const SALT_SEED_ESTOQUE = 0x570c4b; // separa este sorteio do que gerou as ordens no backend (mesmo seed)
const IDADE_MAX_SEG = 30 * 86_400;

export interface PaleteInicial {
  localId: string;
  produtoId: string;
  entradaSeg: number;
}

/** `locaisLivres` na ordem de varredura do layout (determinística). */
export function gerarEstoqueInicial(p: PacoteCenario, locaisLivres: readonly string[], curva: CurvaAbc): PaleteInicial[] {
  const totalPeso = curva.ordem.reduce((n, id) => n + curva.peso.get(id)!, 0);
  if (totalPeso === 0 || locaisLivres.length === 0) return [];
  const rng = new Rng(p.cenario.seed + SALT_SEED_ESTOQUE);
  const alvo = Math.round((locaisLivres.length * OCUPACAO_INICIAL_CENTESIMOS) / 10_000);

  const ids = [...locaisLivres];
  for (let i = ids.length - 1; i > 0; i--) { // Fisher–Yates
    const j = rng.nextInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  return ids.slice(0, alvo).map(localId => {
    let sorteio = rng.next() * totalPeso;
    let produtoId = curva.ordem[curva.ordem.length - 1];
    for (const id of curva.ordem) {
      sorteio -= curva.peso.get(id)!;
      if (sorteio < 0) { produtoId = id; break; }
    }
    return { localId, produtoId, entradaSeg: p.cenario.inicioTurnoSeg - 1 - rng.nextInt(IDADE_MAX_SEG) };
  });
}
