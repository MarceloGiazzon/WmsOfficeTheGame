// Fila de envio offline (outbox): toda partida terminada é GUARDADA primeiro e enviada depois. Assim, fechar a aba,
// cair a rede ou o servidor estar fora do ar no último segundo não perde a partida.
//
// Ciclo de um item:  registrar → [guardado] → sincronizar → { aceito: sai da fila | adiado: continua | rejeitado: fica marcado }
//
// Idempotência (o envio são DUAS chamadas — criar a SimPartida e concluí-la — e a conexão pode cair entre elas ou
// logo depois de o servidor aceitar uma):
//   - o `partidaId` criado é gravado no item antes de concluir; a próxima rodada retoma dali, sem criar outra;
//   - se a criação chegou mas a resposta se perdeu, a rodada seguinte acha a partida EmAndamento com o mesmo
//     `iniciadaEm` (`buscarPartidaEmAndamento`) em vez de criar uma segunda;
//   - se a conclusão chegou mas a resposta se perdeu, o servidor responde "partida não está EmAndamento"; aí a fila
//     consulta o SimScore da partida (`buscarScoreDaPartida`) e trata como aceito.
// Rejeitado ≠ adiado: erro de rede/servidor/login adia (o item segue na fila e nada é perdido); recusa do servidor
// (métrica inválida, cenário que não existe mais, 403, score que o servidor não valida) marca o item `rejeitado` com o
// motivo e NÃO reenvia sozinho — só `reenviar(id)` volta o item para pendente. Itens rejeitados não somem: o jogador vê.
// Um item só é enviado pelo jogador que o jogou (`jogador` = username): partida de outro usuário na mesma máquina espera.

import type { Metricas, Politica } from '../sim/model';
import { POLITICAS } from '../sim/model';
import { ErroArmazenamento, type ArmazenamentoJson } from './cache';
import { descreverErro, NpdevError } from './erros';
import type { Http } from './npdevClient';
import { buscarCenario } from './pacote';
import {
  buscarPartidaEmAndamento, buscarScoreDaPartida, concluirPartida, iniciarPartida, VERSAO_MOTOR,
  type ResultadoConclusao,
} from './partidas';

export type SituacaoItem = 'pendente' | 'rejeitado';

export interface ErroItem {
  mensagem: string;
  tipo: string;
  /** ISO. */
  em: string;
}

export interface RejeicaoItem {
  motivo: string;
  /** `score_divergente`, `cenario_inexistente`, `metricas_invalidas`, `partida_abandonada`, `negado`, `recusado`, `resposta_invalida`. */
  codigo: string;
  em: string;
}

/** O que a UI entrega no fim da partida. */
export interface RegistroPartida {
  cenarioCodigo: string;
  politica: Politica;
  metricas: Metricas;
  /** Score calculado no cliente (`calcularScore` de src/sim/score.ts), em centésimos. */
  scoreCentesimos: number;
  /** ISO (relógio do cliente). */
  iniciadaEm: string;
  /** ISO (relógio do cliente; o servidor grava o dele). */
  concluidaEm: string;
  versaoMotor?: string;
  /** Se a partida já foi criada no servidor ao iniciar (`iniciarPartida`), o id dela. */
  partidaId?: string;
  /** Dono da partida, se a sessão já caiu mas a UI lembra quem era. Padrão: o usuário logado. */
  jogador?: string;
}

export interface ItemFila {
  /** Id local do item (não é o da partida). */
  id: string;
  jogador: string;
  cenarioCodigo: string;
  politica: Politica;
  metricas: Metricas;
  scoreCentesimos: number;
  iniciadaEm: string;
  concluidaEm: string;
  versaoMotor: string;
  situacao: SituacaoItem;
  /** Quando entrou na fila (ISO). */
  criadoEm: string;
  /** SimPartida criada no servidor para este item (preenchido durante o envio). */
  partidaId?: string;
  tentativas: number;
  /** Último erro recuperável (item pendente). */
  ultimoErro?: ErroItem;
  /** Por que foi rejeitado (item rejeitado). */
  rejeicao?: RejeicaoItem;
  /** Se o servidor chegou a gravar o score (rejeição por divergência): o que ele gravou. */
  resultado?: ResultadoConclusao;
}

export interface ResumoFila {
  /** Aguardando envio — o número do indicador "N partidas pendentes". */
  pendentes: number;
  /** Recusadas pelo servidor, à espera de o jogador ver/descartar/reenviar. */
  rejeitados: number;
  /** De quem são as contagens (`null` = de todos, quando não há sessão). */
  jogador: string | null;
}

export type ResultadoRegistro =
  /** Sem sessão (convidado): nada foi guardado nem enviado. */
  | { estado: 'convidado' }
  /** O servidor aceitou e validou o score; a partida não está mais na fila. */
  | { estado: 'enviado'; resultado: ResultadoConclusao }
  /** Guardada; segue na fila e vai quando houver rede/login. `erro` diz por que não foi agora. */
  | { estado: 'pendente'; item: ItemFila; erro: NpdevError }
  /** O servidor recusou (ou o score não bateu): fica marcada na fila com o motivo. */
  | { estado: 'rejeitado'; item: ItemFila };

export interface ResultadoSincronizacao {
  /** Aceitos nesta rodada (já saíram da fila). */
  enviados: ResultadoConclusao[];
  /** Rejeitados nesta rodada. */
  rejeitados: ItemFila[];
  /** Quantos itens deste jogador seguem pendentes. */
  pendentes: number;
  /** O que interrompeu a rodada (sem rede, sem login, servidor fora). `null` = processou tudo. */
  erro: NpdevError | null;
}

export interface OpcoesFila {
  armazenamento: ArmazenamentoJson;
  http: Http;
  agora?: () => Date;
  /** Gerador do id local do item. */
  gerarId?: () => string;
}

/** Tentativas com resposta ilegível do servidor antes de desistir (rede caída não conta: é esperada). */
const MAX_RESPOSTAS_INVALIDAS = 5;
const PREFIXO = 'fila:';

let contador = 0;
const idPadrao = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(contador++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function lerItem(bruto: unknown): ItemFila | null {
  if (bruto === null || typeof bruto !== 'object') return null;
  const i = bruto as Partial<ItemFila>;
  const ok = typeof i.id === 'string' && typeof i.jogador === 'string' && typeof i.cenarioCodigo === 'string'
    && (POLITICAS as readonly unknown[]).includes(i.politica) && typeof i.metricas === 'object' && i.metricas !== null
    && typeof i.scoreCentesimos === 'number' && typeof i.iniciadaEm === 'string' && typeof i.concluidaEm === 'string'
    && typeof i.versaoMotor === 'string' && (i.situacao === 'pendente' || i.situacao === 'rejeitado')
    && typeof i.criadoEm === 'string' && typeof i.tentativas === 'number';
  return ok ? (i as ItemFila) : null;
}

type Desfecho =
  | { tipo: 'aceito'; resultado: ResultadoConclusao }
  | { tipo: 'rejeitado'; item: ItemFila }
  | { tipo: 'adiado'; item: ItemFila; erro: NpdevError };

export class FilaEnvio {
  private readonly armazenamento: ArmazenamentoJson;
  private readonly http: Http;
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly observadores = new Set<(r: ResumoFila) => void>();
  /** Serializa o processamento: dois envios do mesmo item ao mesmo tempo criariam partida em dobro. */
  private fila: Promise<unknown> = Promise.resolve();
  private emSincronizacao: Promise<ResultadoSincronizacao> | null = null;
  private readonly emRegistro = new Set<string>();

  constructor(opcoes: OpcoesFila) {
    this.armazenamento = opcoes.armazenamento;
    this.http = opcoes.http;
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? idPadrao;
  }

  // ---- API ------------------------------------------------------------------------------------------------------

  /**
   * Fim de partida: guarda o resultado e tenta enviar na hora. Nunca perde o resultado: se não der agora, devolve
   * `pendente` com o motivo. Convidado (sem sessão e sem `jogador`) não guarda nada. Lança `ErroArmazenamento` só se
   * não houver como guardar E o envio imediato também falhar.
   */
  async registrar(reg: RegistroPartida): Promise<ResultadoRegistro> {
    const jogador = reg.jogador ?? this.http.usuario;
    if (jogador === null) return { estado: 'convidado' };
    const item: ItemFila = {
      id: this.gerarId(), jogador, cenarioCodigo: reg.cenarioCodigo, politica: reg.politica,
      metricas: { ...reg.metricas }, scoreCentesimos: reg.scoreCentesimos, iniciadaEm: reg.iniciadaEm,
      concluidaEm: reg.concluidaEm, versaoMotor: reg.versaoMotor ?? VERSAO_MOTOR, situacao: 'pendente',
      criadoEm: this.agora().toISOString(), tentativas: 0,
      ...(reg.partidaId !== undefined ? { partidaId: reg.partidaId } : {}),
    };

    this.emRegistro.add(item.id); // a rodada de `sincronizar` que estiver correndo não pode pegar este item: o resultado é nosso
    try {
      try {
        await this.gravar(item);
      } catch (e) {
        // sem onde guardar: só resta tentar enviar agora; se também falhar, o jogador precisa saber que perdeu a partida
        if (this.http.usuario !== jogador) throw new ErroArmazenamento(`Não foi possível guardar a partida para enviar depois: ${descreverErro(e)}`, e);
        const desfecho = await this.serializar(() => this.enviar(item, new Map(), false));
        if (desfecho.tipo === 'adiado') {
          throw new ErroArmazenamento(`Não foi possível guardar a partida para enviar depois (${descreverErro(e)}) e o envio agora falhou: ${desfecho.erro.message}`, e);
        }
        return this.paraResultado(desfecho);
      }
      this.notificar();
      if (this.http.usuario !== jogador) {
        return { estado: 'pendente', item, erro: new NpdevError('offline', 'Sem login deste jogador: a partida será enviada depois de entrar.') };
      }
      const desfecho = await this.serializar(() => this.processar(item.id, new Map()));
      if (desfecho) return this.paraResultado(desfecho);
      return { estado: 'pendente', item, erro: new NpdevError('requisicao_invalida', 'O item foi descartado antes do envio.') };
    } finally {
      this.emRegistro.delete(item.id);
    }
  }

  /**
   * Envia, um por vez e na ordem em que foram jogados, os itens pendentes do jogador logado. Para no primeiro erro
   * recuperável (sem rede / sem login / servidor fora): o resto espera. Chamadas simultâneas dividem a mesma rodada.
   */
  sincronizar(): Promise<ResultadoSincronizacao> {
    if (this.emSincronizacao) return this.emSincronizacao;
    const rodada = this.serializar(() => this.sincronizarTudo()).finally(() => { this.emSincronizacao = null; });
    this.emSincronizacao = rodada;
    return rodada;
  }

  /** Todos os itens guardados (pendentes e rejeitados), do mais antigo ao mais novo. */
  async listar(): Promise<ItemFila[]> {
    const itens: ItemFila[] = [];
    for (const chave of await this.armazenamento.chaves(PREFIXO)) {
      const item = lerItem(await this.armazenamento.ler(chave));
      if (item) itens.push(item);
    }
    return itens.sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : a.id < b.id ? -1 : 1));
  }

  /** Contagens para o indicador. Do jogador logado; sem sessão, de todos. */
  async resumo(): Promise<ResumoFila> {
    const jogador = this.http.usuario;
    const itens = (await this.listar()).filter(i => jogador === null || i.jogador === jogador);
    return {
      pendentes: itens.filter(i => i.situacao === 'pendente').length,
      rejeitados: itens.filter(i => i.situacao === 'rejeitado').length,
      jogador,
    };
  }

  /** Tira o item da fila (o jogador viu o motivo e não quer mais). Vale para pendente também. */
  async descartar(id: string): Promise<void> {
    await this.armazenamento.remover(PREFIXO + id);
    this.notificar();
  }

  /** Devolve um item rejeitado para pendente (ex.: o admin corrigiu a role ou reativou o cenário). */
  async reenviar(id: string): Promise<void> {
    const item = lerItem(await this.armazenamento.ler(PREFIXO + id));
    if (!item || item.situacao !== 'rejeitado') return;
    const pendente: ItemFila = { ...item, situacao: 'pendente', tentativas: 0 };
    delete pendente.rejeicao;
    delete pendente.resultado;
    await this.gravar(pendente);
    this.notificar();
  }

  /** Avisa a cada mudança na fila (guardou, enviou, rejeitou, descartou). Devolve a função que cancela. */
  observar(ouvinte: (resumo: ResumoFila) => void): () => void {
    this.observadores.add(ouvinte);
    return () => { this.observadores.delete(ouvinte); };
  }

  // ---- internos -------------------------------------------------------------------------------------------------

  private serializar<T>(fn: () => Promise<T>): Promise<T> {
    const proxima = this.fila.then(fn, fn);
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }

  private notificar(): void {
    if (this.observadores.size === 0) return;
    void this.resumo().then(r => {
      // um ouvinte que lança (bug da UI) não pode impedir os outros nem virar rejeição sem dono
      for (const o of this.observadores) { try { o(r); } catch { /* ignorado */ } }
    }, () => undefined);
  }

  private gravar(item: ItemFila): Promise<void> {
    return this.armazenamento.gravar(PREFIXO + item.id, item);
  }

  private paraResultado(d: Desfecho): ResultadoRegistro {
    if (d.tipo === 'aceito') return { estado: 'enviado', resultado: d.resultado };
    if (d.tipo === 'rejeitado') return { estado: 'rejeitado', item: d.item };
    return { estado: 'pendente', item: d.item, erro: d.erro };
  }

  private async sincronizarTudo(): Promise<ResultadoSincronizacao> {
    const resultado: ResultadoSincronizacao = { enviados: [], rejeitados: [], pendentes: 0, erro: null };
    const eu = this.http.usuario;
    if (eu === null || !this.http.logado) {
      resultado.erro = new NpdevError('offline', 'Sem login: as partidas pendentes serão enviadas depois de entrar.');
      resultado.pendentes = (await this.resumo()).pendentes;
      return resultado;
    }
    const cenarios = new Map<string, string>();
    const meus = (await this.listar()).filter(i => i.jogador === eu && i.situacao === 'pendente' && !this.emRegistro.has(i.id));
    for (const item of meus) {
      const d = await this.processar(item.id, cenarios);
      if (!d) continue;
      if (d.tipo === 'aceito') resultado.enviados.push(d.resultado);
      else if (d.tipo === 'rejeitado') resultado.rejeitados.push(d.item);
      else { resultado.erro = d.erro; break; }
    }
    resultado.pendentes = (await this.listar()).filter(i => i.jogador === eu && i.situacao === 'pendente').length;
    return resultado;
  }

  /** Relê o item do armazenamento (pode ter sido enviado/descartado enquanto esperava a vez) e o envia. */
  private async processar(id: string, cenarios: Map<string, string>): Promise<Desfecho | null> {
    const item = lerItem(await this.armazenamento.ler(PREFIXO + id));
    if (!item || item.situacao !== 'pendente') return null;
    if (item.jogador !== this.http.usuario) return null; // de outro usuário: espera ele entrar
    return this.enviar(item, cenarios, true);
  }

  private async enviar(inicial: ItemFila, cenarios: Map<string, string>, persistir: boolean): Promise<Desfecho> {
    let item = inicial;
    const salvar = async (novo: ItemFila): Promise<ItemFila> => {
      item = novo;
      if (persistir) await this.gravar(novo);
      return novo;
    };
    const rejeitar = async (codigo: string, motivo: string, resultado?: ResultadoConclusao): Promise<Desfecho> => {
      const rejeitado = await salvar({ ...item, situacao: 'rejeitado', rejeicao: { motivo, codigo, em: this.agora().toISOString() }, ...(resultado ? { resultado } : {}) });
      this.notificar();
      return { tipo: 'rejeitado', item: rejeitado };
    };
    const aceitar = async (r: ResultadoConclusao): Promise<Desfecho> => {
      if (!r.validadoServidor) {
        // o servidor gravou a partida (Concluida) com o score DELE, fora do ranking: não há o que reenviar
        return rejeitar('score_divergente',
          `O servidor recalculou o score em ${(r.scoreServidorCentesimos / 100).toFixed(2)} (o cliente enviou ${(r.scoreClienteCentesimos / 100).toFixed(2)}): partida registrada fora do ranking.`, r);
      }
      if (persistir) await this.armazenamento.remover(PREFIXO + item.id);
      this.notificar();
      return { tipo: 'aceito', resultado: r };
    };

    try {
      let cenarioId = cenarios.get(item.cenarioCodigo);
      if (cenarioId === undefined) {
        cenarioId = (await buscarCenario(this.http, item.cenarioCodigo)).id;
        cenarios.set(item.cenarioCodigo, cenarioId);
      }

      // No máximo duas voltas: a segunda só acontece se a partida guardada no item sumiu do servidor.
      for (let volta = 0; volta < 2; volta++) {
        if (item.partidaId === undefined) {
          const existente = await buscarPartidaEmAndamento(this.http, cenarioId, item.politica, item.iniciadaEm);
          const partida = existente ?? await iniciarPartida(this.http, {
            cenarioId, politica: item.politica, versaoMotor: item.versaoMotor, iniciadaEm: item.iniciadaEm,
          });
          await salvar({ ...item, partidaId: partida.id });
        }
        try {
          return await aceitar(await concluirPartida(this.http, item.partidaId!, item.metricas, item.scoreCentesimos));
        } catch (e) {
          if (!(e instanceof NpdevError)) throw e;
          if (e.tipo === 'recusado' && e.codigo === 'partida_encerrada') {
            // ou a conclusão anterior chegou e só a resposta se perdeu (há SimScore), ou a partida foi abandonada
            const score = await buscarScoreDaPartida(this.http, item.partidaId!);
            if (score) {
              return await aceitar({
                partidaId: item.partidaId!, scoreId: score.id, scoreServidorCentesimos: score.scoreCentesimos,
                scoreClienteCentesimos: item.scoreCentesimos, validadoServidor: score.validadoServidor,
              });
            }
            return await rejeitar('partida_abandonada', 'A partida no servidor foi abandonada e não pode mais ser concluída.');
          }
          if (e.tipo === 'nao_encontrado' && volta === 0) {
            const semPartida: ItemFila = { ...item }; // a partida sumiu do servidor: cria outra na volta seguinte
            delete semPartida.partidaId;
            await salvar(semPartida);
            continue;
          }
          throw e;
        }
      }
      throw new NpdevError('nao_encontrado', 'A partida do item não existe no servidor.');
    } catch (e) {
      if (!(e instanceof NpdevError)) throw e; // erro de programação: não esconder
      const agora = this.agora().toISOString();
      const tentativas = item.tentativas + 1;
      if (e.tipo === 'resposta_invalida' && tentativas >= MAX_RESPOSTAS_INVALIDAS) {
        return rejeitar('resposta_invalida', `O servidor respondeu em formato inesperado ${tentativas} vezes: ${e.message}`);
      }
      if (e.recuperavel || e.tipo === 'resposta_invalida') {
        const adiado = await salvar({ ...item, tentativas, ultimoErro: { mensagem: e.message, tipo: e.tipo, em: agora } });
        this.notificar();
        return { tipo: 'adiado', item: adiado, erro: e };
      }
      // recusa definitiva: não adianta tentar de novo sem o jogador/admin mudar algo
      const codigo = e.tipo === 'nao_encontrado' ? 'cenario_inexistente' : e.tipo === 'proibido' ? 'negado'
        : e.tipo === 'recusado' && e.codigo ? e.codigo : 'recusado';
      return rejeitar(codigo, e.message);
    }
  }
}
