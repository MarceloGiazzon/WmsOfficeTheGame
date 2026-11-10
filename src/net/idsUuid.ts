// Troca todos os ids de um pacote por UUIDs. No backend os ids são UUIDs aleatórios; os pacotes embutidos
// (src/data/cenarios) usam aliases legíveis do seed ("WHArua01"). Esta troca é determinística (mesmo `semente` = mesmos
// ids) para testar que a sim e a camada de rede não dependem do formato do id. Só os testes usam.

import { Rng } from '../sim/rng';
import type { PacoteCenario } from '../sim/model';

export function uuidV4(rng: Rng): string {
  const hex = (n: number) => Array.from({ length: n }, () => rng.nextInt(16).toString(16)).join('');
  // versão 4 e variante 10xx, como o `UUID.randomUUID()` do servidor
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[rng.nextInt(4)]}${hex(3)}-${hex(12)}`;
}

/**
 * O mesmo pacote com UUIDs no lugar de cada id (e de cada referência a ele). `mapa` é alias → UUID.
 * `gerarId` troca o formato (ex.: ids hostis com `:`, `/` e acentos) mantendo o resto igual.
 */
export function remapearIds(
  p: PacoteCenario, semente: number, gerarId: (rng: Rng) => string = uuidV4,
): { pacote: PacoteCenario; mapa: ReadonlyMap<string, string> } {
  const rng = new Rng(semente);
  const mapa = new Map<string, string>();
  const usados = new Set<string>();
  const novo = (id: string): string => {
    let u = mapa.get(id);
    if (u === undefined) {
      do { u = gerarId(rng); } while (usados.has(u));
      usados.add(u);
      mapa.set(id, u);
    }
    return u;
  };
  const pacote: PacoteCenario = {
    cenario: { ...p.cenario, id: novo(p.cenario.id), armazemId: novo(p.cenario.armazemId) },
    armazem: { ...p.armazem, id: novo(p.armazem.id) },
    areas: p.areas.map(a => ({ ...a, id: novo(a.id), armazemId: novo(a.armazemId) })),
    ruas: p.ruas.map(r => ({ ...r, id: novo(r.id), areaId: novo(r.areaId) })),
    locais: p.locais.map(l => ({ ...l, id: novo(l.id), ruaId: novo(l.ruaId) })),
    produtos: p.produtos.map(x => ({ ...x, id: novo(x.id) })),
    ordens: p.ordens.map(o => ({ ...o, id: novo(o.id), produtoId: novo(o.produtoId) })),
    rankingRuas: p.rankingRuas.map(r => ({ ...r, ruaId: novo(r.ruaId) })),
  };
  return { pacote, mapa };
}
