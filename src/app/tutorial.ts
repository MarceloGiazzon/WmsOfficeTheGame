// Tutorial guiado do primeiro turno (F6): os passos, a máquina de estados e a regra de "quando mostrar". Tudo puro (sem
// DOM, sem relógio): a tela (src/ui/tutorial.ts) só desenha o passo atual e repassa os cliques.

export interface PassoTutorial {
  id: string;
  titulo: string;
  /** Poucas frases, em português simples: o balão precisa caber num celular em paisagem. */
  texto: string;
  /** Seletores CSS dos elementos reais a destacar (todos os que existirem e estiverem visíveis). */
  alvos: readonly string[];
  /** O alvo mora na gaveta de configurações: abre a gaveta neste passo (e a devolve como estava ao sair). */
  abreGaveta?: boolean;
}

export const PASSOS_TUTORIAL: readonly PassoTutorial[] = [
  {
    id: 'mapa',
    titulo: 'O armazém visto de cima',
    texto: 'Docas verdes (IN) recebem paletes; docas azuis (OUT) despacham. Os quadrados azuis nos racks são posições ' +
      'ocupadas. Os círculos laranja são as empilhadeiras, e ficam vermelhos quando esperam o corredor.',
    alvos: ['#warehouse-canvas'],
  },
  {
    id: 'relogio',
    titulo: 'Relógio e velocidade',
    texto: 'O relógio marca a hora dentro do turno simulado. Os botões pausam ou aceleram (1x, 2x, 5x); no teclado, ' +
      'use espaço, 1, 2 e 5. Pausar não custa nada.',
    alvos: ['#kpi-clock-card', '.hud-controls'],
  },
  {
    id: 'ordens',
    titulo: 'Ordens e prazo (SLA)',
    texto: 'Cada ordem de entrada ou de saída tem um prazo, o SLA. Aqui você vê quantas já terminaram e quantas estão ' +
      'atrasadas. Ordem atrasada tira pontos.',
    alvos: ['#kpi-orders-card', '#kpi-late-card'],
  },
  {
    id: 'score',
    titulo: 'Score parcial',
    texto: 'É a sua nota de 0 a 100 neste momento, e ela muda até o fim do turno. Perdem pontos a distância ' +
      'percorrida, as ordens atrasadas e os conflitos de corredor. Ocupação entre 75% e 88% dá bônus.',
    alvos: ['#kpi-score-card'],
  },
  {
    id: 'politica',
    titulo: 'Política de armazenagem',
    texto: 'É a regra que decide onde cada palete que chega será guardado. Toque aqui para trocar quando quiser: a ' +
      'nova regra vale só para os próximos paletes.',
    alvos: ['#status-politica'],
  },
  {
    id: 'inspector',
    titulo: 'Olhar uma posição',
    texto: 'Toque (ou clique) num rack do mapa para ver o que há em cada andar daquela posição e quantas vezes ela foi ' +
      'acessada. O X fecha o cartão.',
    alvos: ['#warehouse-canvas'],
  },
  {
    id: 'log',
    titulo: 'Log operacional',
    texto: 'O log conta o que acontece no turno: ordens liberadas, paletes separados e trocas de política, sempre com ' +
      'o horário. Ele fica no painel de configurações, junto da política e do cenário.',
    alvos: ['#painel-log'],
    abreGaveta: true,
  },
  {
    id: 'ajuda',
    titulo: 'Pronto para jogar',
    texto: 'Ao concluir, o turno volta a andar. Para rever este guia, toque no botão ? aqui no topo.',
    alvos: ['#btn-ajuda'],
  },
];

// ---------------------------------------------------------------- máquina de passos

export interface EstadoTutorial {
  aberto: boolean;
  /** Índice do passo atual (0 quando fechado). */
  indice: number;
}

export type EventoTutorial = 'abrir' | 'proximo' | 'anterior' | 'pular';
export type FimTutorial = 'concluido' | 'pulado';

export const ESTADO_FECHADO: EstadoTutorial = { aberto: false, indice: 0 };

/**
 * Próximo estado do tutorial. `fim` vem preenchido só na transição que o fecha: "Próximo" no último passo conclui;
 * "pular" (botão ou Esc) pula de qualquer passo. Eventos de navegação com o tutorial fechado não fazem nada, e "abrir"
 * com ele já aberto também não (um segundo clique em "?" não reinicia o guia).
 */
export function transicao(estado: EstadoTutorial, evento: EventoTutorial, total: number): { estado: EstadoTutorial; fim: FimTutorial | null } {
  if (evento === 'abrir') return { estado: estado.aberto ? estado : { aberto: true, indice: 0 }, fim: null };
  if (!estado.aberto) return { estado, fim: null };
  switch (evento) {
    case 'proximo':
      if (estado.indice >= total - 1) return { estado: ESTADO_FECHADO, fim: 'concluido' };
      return { estado: { aberto: true, indice: estado.indice + 1 }, fim: null };
    case 'anterior':
      return { estado: { aberto: true, indice: Math.max(0, estado.indice - 1) }, fim: null };
    case 'pular':
      return { estado: ESTADO_FECHADO, fim: 'pulado' };
  }
}

export const rotuloProgresso = (indice: number, total: number): string => `Passo ${indice + 1} de ${total}`;
export const rotuloProximo = (indice: number, total: number): string => (indice >= total - 1 ? 'Concluir' : 'Próximo');
export const podeVoltar = (indice: number): boolean => indice > 0;

// ---------------------------------------------------------------- quando mostrar

/** Chave da flag "já viu o tutorial". Subir o sufixo (v2…) se um dia o guia mudar tanto que valha reapresentar. */
export const CHAVE_TUTORIAL_VISTO = 'wmsoffice.tutorial.visto';

/** O que precisamos de um Storage (facilita o teste com um falso). */
export interface ArmazenamentoMinimo {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

/**
 * Lê a flag em cada armazenamento (localStorage, depois sessionStorage). Qualquer um pode lançar — modo privado,
 * dados de site bloqueados, cota —, e então é ignorado: na dúvida, "não visto" (o pior caso é ver o guia de novo).
 */
export function tutorialJaVisto(armazens: readonly (ArmazenamentoMinimo | null)[]): boolean {
  return armazens.some(a => {
    try { return a?.getItem(CHAVE_TUTORIAL_VISTO) === '1'; } catch { return false; }
  });
}

/**
 * Grava a flag no primeiro armazenamento que aceitar (localStorage; o sessionStorage é a reserva para quando o primeiro
 * falha, e evita repetir o guia a cada recarga da mesma aba). Devolve se algum aceitou.
 */
export function marcarTutorialVisto(armazens: readonly (ArmazenamentoMinimo | null)[]): boolean {
  for (const a of armazens) {
    try {
      if (!a) continue;
      a.setItem(CHAVE_TUTORIAL_VISTO, '1');
      return true;
    } catch { /* tenta o próximo */ }
  }
  return false;
}

/**
 * Abrir sozinho no começo de um turno? Só para quem nunca viu e só uma vez por carregamento da página (se nenhum
 * armazenamento funciona, a memória da própria página impede de repetir a cada "Jogar de novo").
 */
export function deveMostrarTutorial(jaVisto: boolean, mostradoNestaPagina: boolean): boolean {
  return !jaVisto && !mostradoNestaPagina;
}
