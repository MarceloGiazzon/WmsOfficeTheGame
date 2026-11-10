// Textos das cinco políticas para a UI (pré-partida, drawer, resultado). Descrevem só a REGRA, como ela está em
// `src/sim/politicas.ts` e no motor — sem prometer resultado. Se a regra mudar lá, o texto muda aqui.

import type { Politica } from '../sim/model';

export interface TextoPolitica {
  /** Nome curto, cabe em chip do HUD e na linha do tempo do resultado. */
  curto: string;
  /** Nome completo, para listas e seletores. */
  rotulo: string;
  /** A regra em uma ou duas frases, linguagem de operação de armazém. */
  regra: string;
}

export const TEXTO_POLITICA: Readonly<Record<Politica, TextoPolitica>> = {
  AbcProximidade: {
    curto: 'Curva ABC',
    rotulo: 'Curva ABC por proximidade da doca',
    regra: 'Classifica os produtos pelo giro de saída. A classe A vai para os 20% de locais mais perto da expedição, ' +
      'a B para os 30% seguintes e a C para o resto. Se a faixa lota, o palete vai para a faixa vizinha.',
  },
  FifoPrimeiraLivre: {
    curto: 'FIFO',
    rotulo: 'FIFO + primeira posição livre',
    regra: 'Guarda cada palete no primeiro local livre, na ordem de varredura do armazém (rua a rua, posição a posição). ' +
      'Não olha o produto nem a distância até a doca.',
  },
  Consolidacao: {
    curto: 'Consolidação',
    rotulo: 'Consolidação de produto por rua',
    regra: 'Escolhe a rua que já guarda mais paletes do mesmo produto (os que estão a caminho contam). ' +
      'Empate: melhor rua do ranking, posição mais perto da doca, andar mais baixo.',
  },
  CrossDocking: {
    curto: 'Cross-docking',
    rotulo: 'Cross-docking (doca a doca)',
    regra: 'Se há uma saída pendente do mesmo produto, o palete descarregado vai direto da doca de entrada para a de ' +
      'saída, esperando até 10 min por ela. O que não for desviado é guardado como na Curva ABC.',
  },
  WmsReal: {
    curto: 'WmsOffice',
    rotulo: 'WmsOffice real (regras do WMS)',
    regra: 'Aplica a regra de sugestão de destino do WmsOffice (sugerirDestino) aos locais livres: melhor rua do ' +
      'ranking do cenário e, no empate, o menor id de local (ordem de texto). Roda no navegador, igual ao Java.',
  },
};
