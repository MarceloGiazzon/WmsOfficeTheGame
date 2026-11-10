// Como atualizar a lista do log de eventos sem refazê-la inteira a cada evento. Puro, sem DOM (o `Drawer` aplica).
//
// A sim devolve os eventos do mais novo para o mais antigo, e cada evento é um objeto que não muda: o que já está na tela
// continua valendo. Se o evento que estava no topo da última vez ainda aparece entre os `max` primeiros, só os que vieram
// antes dele são novos — basta acrescentá-los no topo e podar a cauda. Qualquer outra coisa (partida nova, log zerado,
// mais de `max` eventos novos de uma vez) refaz a lista.

export type PlanoLog =
  | { tipo: 'nada' }
  | { tipo: 'refazer' }
  /** Acrescentar os `novos` primeiros eventos no topo e podar a lista para `max` itens. */
  | { tipo: 'acrescentar'; novos: number };

export function planejarLog<E extends object>(ultimoNaTela: E | undefined, eventos: readonly E[], max: number): PlanoLog {
  if (eventos[0] === ultimoNaTela) return { tipo: 'nada' };
  if (ultimoNaTela === undefined) return { tipo: 'refazer' };
  const posicao = eventos.slice(0, max).indexOf(ultimoNaTela);
  return posicao > 0 ? { tipo: 'acrescentar', novos: posicao } : { tipo: 'refazer' };
}
