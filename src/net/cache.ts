// Armazenamento offline: pacotes de cenário (aqui) e a fila de envio (filaEnvio.ts) guardam JSON numa interface
// assíncrona chave → valor. Duas implementações: IndexedDB (navegador) e memória (testes, ou quando o navegador
// recusa o IndexedDB — janela privada, cota). Nada aqui toca em `window`: o IndexedDB é injetado.
//
// `obterPacote` é o que a tela de seleção chama: rede (se logado) → cache → pacote embutido, e diz de onde veio.

import type { PacoteCenario } from '../sim/model';
import { descreverErro, ehNpdevError, NpdevError } from './erros';
import type { Http } from './npdevClient';
import { carregarPacote, validarPacote } from './pacote';

// ---- armazenamento chave → JSON --------------------------------------------------------------------------------

export class ErroArmazenamento extends Error {
  constructor(mensagem: string, causa?: unknown) {
    super(mensagem, causa === undefined ? undefined : { cause: causa });
    this.name = 'ErroArmazenamento';
  }
}

/** Valores são JSON puro (estruturas clonáveis). `ler` devolve `undefined` quando a chave não existe. */
export interface ArmazenamentoJson {
  ler(chave: string): Promise<unknown>;
  gravar(chave: string, valor: unknown): Promise<void>;
  remover(chave: string): Promise<void>;
  /** Chaves que começam com `prefixo` (todas, se omitido), em ordem alfabética. */
  chaves(prefixo?: string): Promise<string[]>;
}

/** Guarda cópias serializadas: mexer no objeto depois de gravar não altera o que está guardado (como no IndexedDB). */
export class ArmazenamentoMemoria implements ArmazenamentoJson {
  private readonly dados = new Map<string, string>();

  async ler(chave: string): Promise<unknown> {
    const s = this.dados.get(chave);
    return s === undefined ? undefined : JSON.parse(s);
  }

  async gravar(chave: string, valor: unknown): Promise<void> {
    this.dados.set(chave, JSON.stringify(valor));
  }

  async remover(chave: string): Promise<void> {
    this.dados.delete(chave);
  }

  async chaves(prefixo = ''): Promise<string[]> {
    return [...this.dados.keys()].filter(k => k.startsWith(prefixo)).sort();
  }
}

const STORE = 'kv';

export interface OpcoesIndexedDb {
  /** Nome do banco. Padrão `wmsoffice-game`. */
  nome?: string;
  /** Fábrica do IndexedDB (padrão `globalThis.indexedDB`; os testes injetam um falso). */
  fabrica?: IDBFactory;
}

export class ArmazenamentoIndexedDb implements ArmazenamentoJson {
  private readonly nome: string;
  private readonly fabrica: IDBFactory | undefined;
  private aberto: Promise<IDBDatabase> | null = null;

  constructor(opcoes: OpcoesIndexedDb = {}) {
    this.nome = opcoes.nome ?? 'wmsoffice-game';
    this.fabrica = opcoes.fabrica;
  }

  /** O navegador oferece IndexedDB? (Falso em janela privada de alguns navegadores e em SSR.) */
  static disponivel(fabrica: IDBFactory | undefined = globalThis.indexedDB): boolean {
    return fabrica !== undefined && fabrica !== null;
  }

  private abrir(): Promise<IDBDatabase> {
    if (this.aberto) return this.aberto;
    const fabrica = this.fabrica ?? globalThis.indexedDB;
    if (!fabrica) return Promise.reject(new ErroArmazenamento('IndexedDB indisponível neste navegador.'));
    this.aberto = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try { req = fabrica.open(this.nome, 1); } catch (e) { reject(new ErroArmazenamento('Não foi possível abrir o IndexedDB.', e)); return; }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); this.aberto = null; }; // outra aba atualizando o schema
        resolve(db);
      };
      req.onerror = () => reject(new ErroArmazenamento('Não foi possível abrir o IndexedDB.', req.error));
      req.onblocked = () => reject(new ErroArmazenamento('IndexedDB bloqueado por outra aba.'));
    }).catch(e => { this.aberto = null; throw e; }); // falhou: a próxima chamada tenta abrir de novo
    return this.aberto;
  }

  /** Uma transação por operação; só resolve quando ela COMPLETA (escrita durável), não quando o pedido é aceito. */
  private async transacao<T>(modo: IDBTransactionMode, pedido: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.abrir();
    return new Promise<T>((resolve, reject) => {
      let req: IDBRequest<T>;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, modo);
        req = pedido(tx.objectStore(STORE));
      } catch (e) { reject(new ErroArmazenamento('Falha ao acessar o IndexedDB.', e)); return; }
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(new ErroArmazenamento('Falha ao acessar o IndexedDB.', tx.error ?? req.error));
      tx.onabort = () => reject(new ErroArmazenamento('Transação do IndexedDB abortada (cota cheia?).', tx.error));
    });
  }

  async ler(chave: string): Promise<unknown> {
    return this.transacao('readonly', s => s.get(chave));
  }

  async gravar(chave: string, valor: unknown): Promise<void> {
    await this.transacao('readwrite', s => s.put(valor, chave));
  }

  async remover(chave: string): Promise<void> {
    await this.transacao('readwrite', s => s.delete(chave));
  }

  async chaves(prefixo = ''): Promise<string[]> {
    const todas = await this.transacao('readonly', s => s.getAllKeys());
    return todas.filter((k): k is string => typeof k === 'string' && k.startsWith(prefixo)).sort();
  }
}

/** IndexedDB se existir; senão memória (o jogo roda, mas nada sobrevive ao recarregar a página). */
export function criarArmazenamentoPadrao(): ArmazenamentoJson {
  return ArmazenamentoIndexedDb.disponivel() ? new ArmazenamentoIndexedDb() : new ArmazenamentoMemoria();
}

// ---- cache de pacotes -------------------------------------------------------------------------------------------

/** Versão do formato guardado. Subiu = entradas antigas são ignoradas (e regravadas no próximo carregamento). */
export const FORMATO_CACHE = 1;

export interface EntradaCachePacote {
  formato: number;
  codigo: string;
  /** Quando o pacote foi baixado (ISO, relógio do cliente). */
  salvoEm: string;
  /** Impressão digital do conteúdo: igual = o servidor não mudou nada desde o último download. */
  assinatura: string;
  pacote: PacoteCenario;
}

/** cyrb53: hash de 53 bits, suficiente para "mudou ou não". Não é criptográfico. */
export function assinarPacote(pacote: PacoteCenario): string {
  const s = JSON.stringify(pacote);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export class CachePacotes {
  constructor(private readonly armazenamento: ArmazenamentoJson, private readonly agora: () => Date = () => new Date()) {}

  private chave(codigo: string): string {
    return `pacote:${codigo}`;
  }

  /**
   * Pacote guardado para o cenário, ou `null` se não há ou não presta (formato antigo, JSON corrompido, falha de
   * leitura): cache ruim nunca derruba o jogo, só deixa de ajudar.
   */
  async ler(codigo: string): Promise<EntradaCachePacote | null> {
    try {
      const bruto = await this.armazenamento.ler(this.chave(codigo));
      if (bruto === undefined || bruto === null || typeof bruto !== 'object') return null;
      const e = bruto as Partial<EntradaCachePacote>;
      if (e.formato !== FORMATO_CACHE || e.codigo !== codigo || typeof e.salvoEm !== 'string' || typeof e.assinatura !== 'string') return null;
      const pacote = validarPacote(e.pacote);
      if (pacote.cenario.codigo !== codigo) return null;
      return { formato: FORMATO_CACHE, codigo, salvoEm: e.salvoEm, assinatura: e.assinatura, pacote };
    } catch {
      return null;
    }
  }

  /** Grava (substitui) o pacote do cenário. Lança `ErroArmazenamento` se o armazenamento recusar. */
  async gravar(pacote: PacoteCenario): Promise<EntradaCachePacote> {
    const entrada: EntradaCachePacote = {
      formato: FORMATO_CACHE, codigo: pacote.cenario.codigo, salvoEm: this.agora().toISOString(),
      assinatura: assinarPacote(pacote), pacote,
    };
    await this.armazenamento.gravar(this.chave(pacote.cenario.codigo), entrada);
    return entrada;
  }

  async remover(codigo: string): Promise<void> {
    await this.armazenamento.remover(this.chave(codigo));
  }

  /** Códigos dos cenários que podem ser jogados offline a partir do cache. */
  async codigos(): Promise<string[]> {
    try {
      return (await this.armazenamento.chaves('pacote:')).map(k => k.slice('pacote:'.length));
    } catch {
      return [];
    }
  }
}

// ---- rede → cache → embutido ------------------------------------------------------------------------------------

export type OrigemPacote = 'rede' | 'cache' | 'embutido';

export interface ResultadoPacote {
  pacote: PacoteCenario;
  /** De onde veio, para a UI avisar ("jogando com dados do cache de 09/11 14:02"). */
  origem: OrigemPacote;
  /** Quando o pacote foi baixado (ISO). `null` para o embutido (vem com o app). */
  salvoEm: string | null;
  /** Havia login e a rede falhou: o motivo (a UI pode oferecer "entrar de novo" se for `nao_autenticado`). */
  falhaRede: NpdevError | null;
  /** Problemas que não impediram o resultado (ex.: não conseguiu atualizar o cache). */
  avisos: string[];
}

export interface OpcoesObterPacote {
  http: Http;
  /** Sem cache, só há rede → embutido. */
  cache?: CachePacotes | null;
  /** Pacote que veio dentro do app (src/data/cenarios). Função porque o WH-B carrega sob demanda. */
  embutido?: (codigo: string) => PacoteCenario | undefined | Promise<PacoteCenario | undefined>;
}

/**
 * Pacote do cenário para jogar agora:
 *  1. logado → baixa da rede e atualiza o cache (origem `rede`);
 *  2. rede falhou (qualquer `NpdevError`) ou convidado → cache (origem `cache`);
 *  3. sem cache → pacote embutido (origem `embutido`);
 *  4. nada disso → `NpdevError('indisponivel')`.
 * Convidado nunca faz chamada de rede. Erro de programação (que não é NpdevError) sobe como está.
 */
export async function obterPacote(codigo: string, { http, cache = null, embutido }: OpcoesObterPacote): Promise<ResultadoPacote> {
  const avisos: string[] = [];
  let falhaRede: NpdevError | null = null;

  if (http.logado) {
    try {
      const pacote = await carregarPacote(http, codigo);
      let salvoEm: string | null = null;
      if (cache) {
        try { salvoEm = (await cache.gravar(pacote)).salvoEm; } catch (e) { avisos.push(`Cache não atualizado: ${descreverErro(e)}`); }
      }
      return { pacote, origem: 'rede', salvoEm, falhaRede: null, avisos };
    } catch (e) {
      if (!ehNpdevError(e)) throw e;
      falhaRede = e;
    }
  }

  const guardado = cache ? await cache.ler(codigo) : null;
  if (guardado) return { pacote: guardado.pacote, origem: 'cache', salvoEm: guardado.salvoEm, falhaRede, avisos };

  const dentroDoApp = embutido ? await embutido(codigo) : undefined;
  if (dentroDoApp) return { pacote: dentroDoApp, origem: 'embutido', salvoEm: null, falhaRede, avisos };

  throw new NpdevError('indisponivel',
    `Cenário ${codigo} indisponível: ${falhaRede ? `a rede falhou (${falhaRede.message})` : 'sem login'}, sem cache e sem pacote embutido.`,
    { causa: falhaRede });
}
