// Rastro de uma partida: o que aconteceu no turno, palete a palete. É só um registro (o motor não lê de volta).
// Formato de arquivo: backend/ponte/rastro.schema.json ("rastro-v1"). Online, cada evento vira uma linha de SimEvento.
// Quem usa: a ponte Jogo ↔ WmsOffice (backend/ponte), que traduz o rastro em documentos do corporativo.

export type TipoEventoRastro = 'EstoqueInicial' | 'Putaway' | 'Picking' | 'CrossDock' | 'OrdemConcluida';

/** Os 8 campos estão sempre presentes; `null` quando não se aplicam ao tipo (ver as x-regras do schema). */
export interface EventoRastro {
  /** 0, 1, 2… na ordem em que o motor registrou, sem buracos. */
  seq: number;
  tipo: TipoEventoRastro;
  /** Segundos desde 00:00 do dia do turno. EstoqueInicial pode ser anterior ao início do turno (até 30 dias antes). */
  tSeg: number;
  /** Putaway/Picking/OrdemConcluida: a ordem. CrossDock: a ordem Inbound de onde o palete veio. */
  ordemId: string | null;
  /** CrossDock: a ordem Outbound que recebeu o palete. */
  ordemSaidaId: string | null;
  produtoId: string | null;
  /** Putaway: onde foi guardado. Picking: de onde saiu. CrossDock: a doca de entrada. EstoqueInicial: onde está. */
  localId: string | null;
  /** CrossDock: a doca de saída. */
  localDestinoId: string | null;
}

/** O que o motor informa a cada evento; o `seq` é atribuído por quem grava. */
export type EventoRastroSemSeq = Omit<EventoRastro, 'seq'>;
