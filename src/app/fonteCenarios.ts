// De onde vêm os cenários. A UI (pré-partida) e o `Jogo` só conhecem esta interface, nunca de onde o pacote veio.
//
// Hoje há uma implementação (`fonteEmbutida.ts`: os JSON gerados dos seeds, no próprio bundle). A F5 pluga a rede e o
// cache offline aqui SEM mexer na UI: basta uma classe que implemente `FonteCenarios` (por exemplo, tentar a rede,
// cair para o cache do IndexedDB e por último para o embutido) e devolva a `origem` de cada cenário, que a tela
// mostra como selo no cartão e no resultado.

import type { Dificuldade, PacoteCenario } from '../sim/model';

/** De onde o pacote veio: no bundle ('embutido'), do cache local da última vez que baixou ('cache') ou do backend ('rede'). */
export type OrigemCenario = 'embutido' | 'cache' | 'rede';

export const ROTULO_ORIGEM: Readonly<Record<OrigemCenario, string>> = {
  embutido: 'Embutido (offline)',
  cache: 'Em cache',
  rede: 'Servidor',
};

/** O que o cartão do cenário mostra. Tudo derivável do `PacoteCenario` (ver `resumirCenario`). */
export interface ResumoCenario {
  codigo: string;
  nome: string;
  dificuldade: Dificuldade;
  origem: OrigemCenario;
  ordensTotal: number;
  ordensEntrada: number;
  ordensSaida: number;
  /** Locais de armazenagem (rua × posição × andar), sem contar docas. */
  locais: number;
  ruas: number;
  empilhadeiras: number;
  docasEntrada: number;
  docasSaida: number;
  inicioTurnoSeg: number;
  fimTurnoSeg: number;
}

export interface PacoteCarregado {
  pacote: PacoteCenario;
  origem: OrigemCenario;
  /** Quando o pacote foi baixado (ISO), se veio da rede ou do cache; `null` para o embutido. */
  salvoEm?: string | null;
  /** Frase para o jogador quando a fonte não foi a esperada (rede caiu e o jogo usou o cache/embutido). */
  aviso?: string;
}

/** Aviso sobre a LISTA de cenários (ex.: servidor inalcançável, modo convidado): a pré-partida mostra acima dos cartões. */
export interface AvisoFonte {
  tipo: 'info' | 'alerta';
  texto: string;
}

export interface FonteCenarios {
  /**
   * Cenários disponíveis, na ordem em que a tela os mostra. Rápida o bastante para abrir a pré-partida: uma
   * implementação de rede pode montar o resumo a partir da lista de cenários e só baixar o pacote em `carregar`.
   * Rejeita se não houver nenhum cenário utilizável (a tela mostra o erro).
   */
  listar(): Promise<ResumoCenario[]>;
  /** O pacote completo do cenário. Rejeita com `Error` de mensagem legível se o código não existir ou a origem falhar. */
  carregar(codigo: string): Promise<PacoteCarregado>;
  /** Aviso da ÚLTIMA `listar()` (opcional): servidor inalcançável, modo convidado… `null` = nada a dizer. */
  avisoDaLista?(): AvisoFonte | null;
}

/** Resumo de um pacote já em mãos: serve a qualquer fonte que tenha o pacote (embutida, cache, rede). */
export function resumirCenario(pacote: PacoteCenario, origem: OrigemCenario): ResumoCenario {
  const { cenario } = pacote;
  // Mesmas contas do layout (`construirLayout`), para o cartão mostrar o que de fato vai a campo: ruas de armazenagem
  // = Rua.qtdPosicoes × qtdAndares; docas = posições das ruas das áreas de Recebimento/Expedição.
  const funcaoDaArea = new Map(pacote.areas.map(a => [a.id, a.funcao]));
  const ruasDe = (funcao: string) => pacote.ruas.filter(r => funcaoDaArea.get(r.areaId) === funcao);
  const posicoes = (rs: { qtdPosicoes: number }[]) => rs.reduce((n, r) => n + r.qtdPosicoes, 0);
  const armazenagem = ruasDe('Armazenagem');
  const ordensEntrada = pacote.ordens.filter(o => o.tipo === 'Inbound').length;
  return {
    codigo: cenario.codigo,
    nome: cenario.nome,
    dificuldade: cenario.dificuldade,
    origem,
    ordensTotal: pacote.ordens.length,
    ordensEntrada,
    ordensSaida: pacote.ordens.length - ordensEntrada,
    locais: armazenagem.reduce((n, r) => n + r.qtdPosicoes * r.qtdAndares, 0),
    ruas: armazenagem.length,
    empilhadeiras: cenario.qtdEquipamentos,
    docasEntrada: posicoes(ruasDe('Recebimento')),
    docasSaida: posicoes(ruasDe('Expedicao')),
    inicioTurnoSeg: cenario.inicioTurnoSeg,
    fimTurnoSeg: cenario.fimTurnoSeg,
  };
}

export const ROTULO_DIFICULDADE: Readonly<Record<Dificuldade, string>> = {
  Facil: 'Fácil',
  Medio: 'Médio',
  Dificil: 'Difícil',
  Extremo: 'Extremo',
};
