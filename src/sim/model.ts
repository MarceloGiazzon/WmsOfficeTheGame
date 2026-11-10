// Tipos do domínio. Espelham os concepts do backend NPDev (backend/npdev/definition/concepts) e o
// "pacote do cenário" (N4): o que o cliente precisa para jogar offline.
// Unidades (D6): distância em cm, velocidade em cm/s, tempo em segundos desde 00:00, percentuais em centésimos.

export type Politica = 'AbcProximidade' | 'FifoPrimeiraLivre' | 'Consolidacao' | 'CrossDocking' | 'WmsReal';

export const POLITICAS: readonly Politica[] = [
  'AbcProximidade', 'FifoPrimeiraLivre', 'Consolidacao', 'CrossDocking', 'WmsReal'
];

export type Dificuldade = 'Facil' | 'Medio' | 'Dificil' | 'Extremo';
export type FuncaoArea = 'Armazenagem' | 'Recebimento' | 'Expedicao' | 'PrePicking' | 'Avarias' | 'CrossDocking';
export type SituacaoLocal = 'Disponivel' | 'Ocupado' | 'Reservado' | 'Bloqueado';
export type TipoOrdem = 'Inbound' | 'Outbound';

export interface Cenario {
  id: string;
  codigo: string;
  nome: string;
  dificuldade: Dificuldade;
  armazemId: string;
  seed: number;
  qtdDocasInbound: number;
  qtdDocasOutbound: number;
  qtdEquipamentos: number;
  velocidadeEquipamentoCmS: number;
  tempoDescargaSeg: number;
  inicioTurnoSeg: number;
  fimTurnoSeg: number;
}

export interface Armazem { id: string; nome: string; }
export interface Area { id: string; armazemId: string; nome: string; funcao: FuncaoArea; }
export interface Rua { id: string; areaId: string; codigo: string; qtdPosicoes: number; qtdAndares: number; }

export interface LocalArmazenagem {
  id: string;
  ruaId: string;
  posicao: number;
  andar: number;
  situacao: SituacaoLocal;
}

export interface Produto { id: string; codigo: string; nome: string; qtdCaixasPorPallet: number; }

export interface Ordem {
  id: string;
  numero: string;
  tipo: TipoOrdem;
  liberacaoSeg: number;
  slaSeg: number;
  produtoId: string;
  quantidadePaletes: number;
}

/** Estado de um local durante a partida. Nasce do pacote (situacao) + estoque inicial; muda com putaway/picking. */
export interface EstadoLocal {
  situacao: SituacaoLocal;
  produtoId: string | null;
  /** Segundo (desde 00:00) em que o palete entrou; negativo = antes do turno. Base do FIFO. */
  entradaSeg: number;
  /** Palete já separado para uma ordem de saída (ainda no local, à espera do equipamento). */
  reservadoSaida: boolean;
  /** Quantas vezes um equipamento operou na posição (heatmap). */
  acessos: number;
}

export interface RankingRua { ruaId: string; prioridade: number; }

/** Tudo o que uma partida precisa, numa estrutura só (N4). */
export interface PacoteCenario {
  cenario: Cenario;
  armazem: Armazem;
  areas: Area[];
  ruas: Rua[];
  locais: LocalArmazenagem[];
  produtos: Produto[];
  ordens: Ordem[];
  rankingRuas: RankingRua[];
}

/** Métricas de fim de partida — mesmas do SimScore e da SimulacaoCapability. */
export interface Metricas {
  distanciaRealCm: number;
  distanciaTeoricaCm: number;
  ordensTotal: number;
  ordensAtrasadas: number;
  eventosConflito: number;
  ocupacaoFinalCentesimos: number;
}
