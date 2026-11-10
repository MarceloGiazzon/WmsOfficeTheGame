// Monta a camada de rede com o que o navegador oferece. É o único ponto que decide IndexedDB × memória e `/api`;
// o resto de src/net recebe tudo por parâmetro (por isso é testável sem DOM).

import { CachePacotes, criarArmazenamentoPadrao, type ArmazenamentoJson } from './cache';
import { FilaEnvio } from './filaEnvio';
import { NpdevClient, type OpcoesCliente } from './npdevClient';

export interface Rede {
  /** Login, sessão e chamadas HTTP. Sem `login()` = convidado = offline. */
  cliente: NpdevClient;
  /** Pacotes de cenário guardados para jogar sem rede. */
  cache: CachePacotes;
  /** Partidas à espera de envio. */
  fila: FilaEnvio;
  armazenamento: ArmazenamentoJson;
}

export interface OpcoesRede extends OpcoesCliente {
  /** Padrão: IndexedDB do navegador (ou memória, se ele não existir). */
  armazenamento?: ArmazenamentoJson;
}

export function criarRede(opcoes: OpcoesRede = {}): Rede {
  const armazenamento = opcoes.armazenamento ?? criarArmazenamentoPadrao();
  const cliente = new NpdevClient(opcoes);
  return {
    cliente, armazenamento,
    cache: new CachePacotes(armazenamento),
    fila: new FilaEnvio({ armazenamento, http: cliente }),
  };
}
