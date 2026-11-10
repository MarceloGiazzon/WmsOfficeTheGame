// Distância teórica (denominador da penalidade de distância do score). Definição fechada da F2:
//
//   Cada palete movimentado no turno (quantidadePaletes de cada ordem, entrada e saída) custa, no melhor caso,
//   uma viagem de ida e volta entre a doca e o seu local: 2 × distância(doca, local).
//   O custo de um local é a média entre a distância à doca de entrada mais próxima e à de saída mais próxima:
//   o palete entra por uma e sai pela outra, então nenhum local é bom para as duas ao mesmo tempo.
//   O melhor caso é a alocação ótima por giro: os movimentos, do produto de maior giro para o de menor (curva ABC),
//   ocupam os locais do menor custo para o maior. Havendo mais movimentos que locais, a ordem é comprimida
//   proporcionalmente pelos locais.
//
// É um piso razoável, não um limite rígido: uma empilhadeira que encadeia tarefas pode andar menos que isso.
// A penalidade só conta o excesso (real − teórica), então terminar abaixo da teórica não gera bônus.

import type { CurvaAbc } from './estoque';
import type { Layout } from './layout';
import type { PacoteCenario } from './model';
import type { Malha } from './pathing';

export function calcularDistanciaTeorica(p: PacoteCenario, layout: Layout, malha: Malha, curva: CurvaAbc): number {
  const posicaoNaCurva = new Map(curva.ordem.map((id, i) => [id, i]));
  const movimentos: string[] = [];
  for (const o of p.ordens) for (let i = 0; i < o.quantidadePaletes; i++) movimentos.push(o.produtoId);
  if (movimentos.length === 0 || layout.locais.length === 0) return 0;
  movimentos.sort((a, b) => (posicaoNaCurva.get(a) ?? Infinity) - (posicaoNaCurva.get(b) ?? Infinity) || a.localeCompare(b));

  const maisPerto = (l: Layout['locais'][number], tipo: 'Inbound' | 'Outbound'): number | null => {
    const docas = layout.docas.filter(d => d.tipo === tipo);
    return docas.length ? Math.min(...docas.map(d => malha.distancia(d.acesso, l.acesso))) : null;
  };
  const custos = layout.locais.map(l => {
    const partes = [maisPerto(l, 'Inbound'), maisPerto(l, 'Outbound')].filter((x): x is number => x !== null);
    return partes.reduce((a, b) => a + b, 0) / Math.max(1, partes.length);
  }).sort((a, b) => a - b);

  const m = movimentos.length;
  const n = custos.length;
  let total = 0;
  for (let k = 0; k < m; k++) total += 2 * custos[m <= n ? k : Math.floor((k * n) / m)];
  return Math.round(total);
}
