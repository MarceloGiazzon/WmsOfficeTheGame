export interface LocalArmazenagem {
  id: string;
  codigo: string;
  ruaId: string;
  ruaNome: string;
  predio: number;
  nivel: number;
  status: 'VAZIO' | 'OCUPADO';
  produtoNome?: string;
  classeABC?: 'A' | 'B' | 'C';
  acessosPicking: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface Empilhadeira {
  id: string;
  nome: string;
  x: number;
  y: number;
  velocidade: number;
  rota: Array<{ x: number; y: number }>;
}

export type PoliticaAlocacao = 
  | 'ABC_PROXIMITY'
  | 'FIFO_FIRST_AVAILABLE'
  | 'VOLUME_CONSOLIDATION'
  | 'RANDOM_STRESS';
