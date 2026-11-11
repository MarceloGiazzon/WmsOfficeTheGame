// Uma partida ligada ao servidor, do "Iniciar turno" ao resultado. Sem DOM: a rede entra por parâmetro e os testes
// usam o `ServidorFalso`.
//
//   Iniciar turno  ─►  criar SimPartida (em segundo plano; falhar NÃO atrapalha o jogo)
//   Fim do turno   ─►  fila.registrar(métricas + score do cliente)  ─►  ranking()  ─►  ExtrasResultado
//   Desistir       ─►  abandonarPartida (ou fica na lista de abandonos pendentes, se não der agora)
//
// Regras que seguem do desenho da F5:
//  - O servidor só é autoridade do score: o cliente envia o que calculou e mostra o que o servidor respondeu. Score
//    que o servidor recalculou diferente NÃO é escondido (vira `validadoServidor: false` com os dois números).
//  - O resultado vai SEMPRE pela fila (`registrar` guarda antes de enviar): rede caída = "partida salva", nunca perdida.
//  - Convidado (ninguém logado) não guarda nada: o resultado é local. A única saída é entrar e enviar ESTE resultado,
//    que fica só na memória da aba (ver `concluir`).
//  - Dono da partida = quem estava logado ao iniciar. Se a sessão cai no meio (expiração), o dono continua o mesmo: o
//    resultado vai para a fila DELE. Se o jogador SAI de propósito, a partida do servidor é abandonada e o turno segue
//    como local (de ninguém) — ver `soltar`.
//  - `iniciarPartida` só roda com pacote da rede (`origem === 'rede'`): o `cenario.id` de um pacote embutido é um alias do
//    seed, não o id do banco. Nos demais casos a fila cria a partida no envio, achando o cenário pelo código.

import { ErroArmazenamento } from '../net/cache';
import { ehNpdevError, NpdevError } from '../net/erros';
import type { FilaEnvio, ItemFila, RegistroPartida, ResultadoRegistro } from '../net/filaEnvio';
import type { Http } from '../net/npdevClient';
import { buscarCenario } from '../net/pacote';
import { EnvioWmsOffice } from './envioWmsOffice';
import { abandonarPartida, iniciarPartida, ranking, type PartidaServidor, type ResultadoConclusao } from '../net/partidas';
import { enviarRastro } from '../net/rastro';
import type { Abandonos } from './abandonos';
import { formatarScore } from './formato';
import type { OrigemCenario } from './fonteCenarios';
import { mensagemDeErro } from './mensagensRede';
import { montarLinhasRanking } from './rankingTabela';
import type { ExtrasResultado, ResultadoPartida } from './resultado';

export interface DepsPartidaOnline {
  http: Http;
  fila: Pick<FilaEnvio, 'registrar'>;
  /** Pedidos de abandono que não deram certo na hora. Sem isto, a falha só é perdida. */
  abandonos?: Pick<Abandonos, 'adiar'>;
  /** Abre o login (modal) e resolve `true` se o jogador entrou. Habilita "Entrar e enviar esta partida" para convidados. */
  pedirLogin?: () => Promise<boolean>;
  /** Depois do envio: a hora de esvaziar o que ficou na fila de partidas anteriores. */
  aoTerminar?: () => void;
  agora?: () => Date;
  /** Endereço do WmsOffice para o botão "Enviar ao WmsOffice" (ex.: `http://localhost:8100`). Sem ele, não há botão. */
  alvoWmsOffice?: string | null;
  /** Para os testes do acompanhamento (padrão: setTimeout). */
  esperar?: (ms: number) => Promise<void>;
}

export interface DadosPartida {
  cenarioCodigo: string;
  /** `id` do cenário no pacote. Só é o id do banco quando `origem === 'rede'`. */
  cenarioId: string;
  politica: ResultadoPartida['politicaInicial'];
  origem: OrigemCenario;
}

export class PartidaOnline {
  /** ISO. O MESMO valor vai para `iniciarPartida` e para a fila (é a chave de idempotência da partida). */
  readonly iniciadaEm: string;
  /** A UI liga aqui para receber os extras que chegam depois (ex.: o convidado que entrou e enviou). */
  aoNovosExtras: ((extras: ExtrasResultado) => void) | null = null;

  private dono: string | null;
  private criacao: Promise<PartidaServidor | null>;
  private situacao: 'andamento' | 'concluida' | 'desistida' = 'andamento';
  private envioWms: EnvioWmsOffice | null = null;
  /** Por que a partida não foi criada no servidor ao iniciar (a fila cria no envio; é só informação). */
  erroInicio: unknown = null;

  constructor(private readonly dep: DepsPartidaOnline, private readonly dados: DadosPartida) {
    this.iniciadaEm = (dep.agora?.() ?? new Date()).toISOString();
    this.dono = dep.http.logado ? dep.http.usuario : null;
    this.criacao = this.criar();
  }

  /** Quem iniciou o turno logado (`null` = convidado). */
  get jogador(): string | null {
    return this.dono;
  }

  /** O resultado vai ser enviado? (logado agora ou dono definido): a tela mostra "Enviando…" até a resposta. */
  get vaiEnviar(): boolean {
    return this.dono !== null || this.dep.http.logado;
  }

  /** O que a tela de resultado mostra enquanto `concluir` não responde. */
  extrasIniciais(): ExtrasResultado {
    return this.vaiEnviar ? { envio: 'enviando' } : {};
  }

  private async criar(): Promise<PartidaServidor | null> {
    if (this.dono === null || this.dados.origem !== 'rede') return null;
    try {
      return await iniciarPartida(this.dep.http, {
        cenarioId: this.dados.cenarioId, politica: this.dados.politica, iniciadaEm: this.iniciadaEm,
      });
    } catch (e) {
      // O turno segue offline e o resultado vai para a fila, que cria a partida no envio. Não é erro para o jogador.
      this.erroInicio = e;
      if (!ehNpdevError(e)) console.error('Falha inesperada ao iniciar a partida no servidor', e);
      return null;
    }
  }

  // ---- desistir / sair ------------------------------------------------------------------------------------------

  /** Trocar de cenário ou reiniciar no meio do turno: abandona a partida do servidor. No-op se já terminou. */
  async desistir(): Promise<void> {
    this.envioWms?.parar(); // o jogador saiu desta tela de resultado: deixa de consultar
    if (this.situacao !== 'andamento') return;
    this.situacao = 'desistida';
    await this.abandonarNoServidor();
  }

  /**
   * O jogador saiu da conta no meio do turno. A partida do servidor era DELE, então é abandonada (antes de a sessão
   * cair: é preciso o token); o turno continua, agora como partida local.
   */
  async soltar(): Promise<void> {
    if (this.situacao !== 'andamento' || this.dono === null) return;
    await this.abandonarNoServidor();
    this.dono = null;
  }

  private async abandonarNoServidor(): Promise<void> {
    const partida = await this.criacao;
    this.criacao = Promise.resolve(null);
    if (!partida || this.dono === null) return;
    try {
      await abandonarPartida(this.dep.http, partida.id);
    } catch (e) {
      if (!ehNpdevError(e)) throw e;
      // já encerrada / não é mais dela: nada a fazer. Rede, servidor ou login: guarda o pedido e refaz na próxima sincronização.
      if (e.recuperavel) await this.dep.abandonos?.adiar(partida.id, this.dono);
    }
  }

  // ---- fim do turno ---------------------------------------------------------------------------------------------

  /** Fim do turno. Nunca lança: o que der errado vira texto nos extras. */
  async concluir(r: ResultadoPartida): Promise<ExtrasResultado> {
    this.situacao = 'concluida';
    const { http } = this.dep;
    const jogador = this.dono ?? http.usuario;
    if (jogador === null) return this.extrasConvidado(r);

    // Convidado que entrou no meio do turno (`dono` null): nada foi criado no servidor; a fila cria no envio.
    const partida = await this.criacao;
    const registro: RegistroPartida = {
      cenarioCodigo: r.cenarioCodigo,
      // a SimPartida do servidor nasce com a política INICIAL; as trocas durante o turno ficam só no resultado local
      politica: r.politicaInicial,
      metricas: r.metricas,
      scoreCentesimos: r.scoreCentesimos,
      iniciadaEm: this.iniciadaEm,
      concluidaEm: (this.dep.agora?.() ?? new Date()).toISOString(),
      jogador,
      ...(partida ? { partidaId: partida.id } : {}),
    };
    let extras: ExtrasResultado;
    try {
      extras = await this.paraExtras(await this.dep.fila.registrar(registro), r, jogador);
    } catch (e) {
      extras = this.extrasFalha(e);
    }
    this.dep.aoTerminar?.();
    return extras;
  }

  private extrasConvidado(r: ResultadoPartida): ExtrasResultado {
    const extras: ExtrasResultado = {
      mensagem: 'Você jogou como convidado: esta partida não foi enviada nem guardada. Entre para jogar valendo ranking.',
    };
    const pedirLogin = this.dep.pedirLogin;
    if (pedirLogin) {
      extras.acao = {
        rotulo: 'Entrar e enviar esta partida',
        aoClicar: () => { void this.entrarEEnviar(r, pedirLogin); },
      };
    }
    return extras;
  }

  /** O resultado do convidado só existe na memória desta aba; ao entrar, é enviado como partida do usuário que entrou. */
  private async entrarEEnviar(r: ResultadoPartida, pedirLogin: () => Promise<boolean>): Promise<void> {
    if (!(await pedirLogin())) return;
    this.aoNovosExtras?.({ envio: 'enviando' });
    this.aoNovosExtras?.(await this.concluir(r));
  }

  private extrasFalha(e: unknown): ExtrasResultado {
    if (e instanceof ErroArmazenamento) return { envio: 'falhou', mensagem: e.message };
    // erro de programação (não NpdevError): o jogador precisa saber que o envio não aconteceu, e o console precisa do detalhe
    console.error('Falha inesperada ao enviar a partida', e);
    return { envio: 'falhou', mensagem: `Falha inesperada ao enviar a partida: ${e instanceof Error ? e.message : String(e)}` };
  }

  // ---- resposta da fila → extras --------------------------------------------------------------------------------

  private async paraExtras(res: ResultadoRegistro, r: ResultadoPartida, jogador: string): Promise<ExtrasResultado> {
    switch (res.estado) {
      case 'enviado': return this.comRastro(await this.extrasEnviado(res.resultado, r), res.resultado.partidaId, r, jogador);
      case 'rejeitado': return extrasRejeitado(res.item);
      case 'pendente': return extrasPendente(res.erro, jogador, this.dep.http.usuario);
      case 'convidado': return this.extrasConvidado(r); // sem sessão e sem dono: não deveria chegar aqui
    }
  }

  private async extrasEnviado(c: ResultadoConclusao, r: ResultadoPartida): Promise<ExtrasResultado> {
    if (!c.validadoServidor) return extrasDivergente(c); // a fila já trata como rejeitado; defesa
    const extras: ExtrasResultado = { validadoServidor: true };
    try {
      const rk = await ranking(this.dep.http, await this.cenarioId(r.cenarioCodigo), { partidaId: c.partidaId });
      extras.ranking = montarLinhasRanking(rk, c.partidaId);
      extras.rankingTotal = rk.total;
      if (rk.posicaoDaPartida !== null) extras.posicaoRanking = rk.posicaoDaPartida;
      else extras.mensagem = `Partida validada, mas fora das ${rk.entradas.length} primeiras posições do ranking.`;
    } catch (e) {
      extras.mensagem = `Partida validada e registrada, mas não foi possível carregar o ranking: ${mensagemDeErro(e)}`;
    }
    return extras;
  }

  /**
   * Depois que o servidor aceitou a partida, manda o rastro (para a ponte com o WmsOffice). Falha NUNCA derruba o
   * resultado: vira uma frase nos extras. Partida que ficou `pendente` na fila não manda rastro (limitação aceita: o
   * rastro só existe na memória desta aba e a fila guarda só o resultado).
   */
  private async comRastro(extras: ExtrasResultado, partidaId: string, r: ResultadoPartida, jogador: string): Promise<ExtrasResultado> {
    if (r.rastro.length === 0) return extras;
    // pacote embutido: os ids dos locais/ordens/produtos são aliases do seed, não existem no banco
    if (this.dados.origem === 'embutido') return semRastro(extras, 'o cenário embutido usa ids que o servidor não conhece');
    try {
      await enviarRastro(this.dep.http, partidaId, jogador, r.rastro);
      return this.comBotaoWmsOffice(extras, partidaId, jogador);
    } catch (e) {
      if (!ehNpdevError(e)) console.error('Falha inesperada ao enviar o rastro', e);
      return semRastro(extras, mensagemDeErro(e));
    }
  }

  /** Rastro no servidor: já dá para pedir o envio ao WmsOffice. A cada mudança de estado a tela recebe os extras de novo. */
  private comBotaoWmsOffice(extras: ExtrasResultado, partidaId: string, jogador: string): ExtrasResultado {
    const alvo = this.dep.alvoWmsOffice;
    if (!alvo) return extras;
    this.envioWms?.parar();
    const base = extras;
    const envio: EnvioWmsOffice = new EnvioWmsOffice({
      http: this.dep.http, partidaId, jogador, alvoUrl: alvo, esperar: this.dep.esperar,
      aoMudar: estado => this.aoNovosExtras?.({ ...base, wmsOffice: { estado, pedir } }),
    });
    const pedir = (): void => { void envio.solicitar(); };
    this.envioWms = envio;
    return { ...base, wmsOffice: { estado: envio.estado, pedir } };
  }

  private async cenarioId(codigo: string): Promise<string> {
    // pacote da rede: o id é o do banco; os demais (cache de outra época, embutido) só se resolvem pelo código
    if (this.dados.origem === 'rede') return this.dados.cenarioId;
    return (await buscarCenario(this.dep.http, codigo)).id;
  }
}

// ---- mensagens (puras, testadas) ------------------------------------------------------------------------------------

/** O rastro não foi enviado: avisa, sem esconder o resto do resultado. */
function semRastro(extras: ExtrasResultado, motivo: string): ExtrasResultado {
  const aviso = `O rastro não foi enviado; esta partida não poderá ir ao WmsOffice. (${motivo})`;
  return { ...extras, mensagem: extras.mensagem ? `${extras.mensagem} ${aviso}` : aviso };
}

function extrasDivergente(c: ResultadoConclusao): ExtrasResultado {
  return {
    validadoServidor: false,
    mensagem: `O servidor recalculou o score em ${formatarScore(c.scoreServidorCentesimos)} (o jogo calculou ${formatarScore(c.scoreClienteCentesimos)}). ` +
      'A partida foi registrada com o valor do servidor, mas fica fora do ranking.',
  };
}

export function extrasRejeitado(item: ItemFila): ExtrasResultado {
  if (item.rejeicao?.codigo === 'score_divergente' && item.resultado) return extrasDivergente(item.resultado);
  return {
    envio: 'recusada',
    mensagem: `${item.rejeicao?.motivo ?? 'O servidor recusou a partida.'} ` +
      'Ela ficou guardada em "partidas para enviar" como rejeitada: dá para ver o motivo, descartar ou tentar de novo.',
  };
}

export function extrasPendente(erro: NpdevError, dono: string, usuarioAtual: string | null): ExtrasResultado {
  const base: ExtrasResultado = { envio: 'pendente' };
  if (usuarioAtual !== dono) {
    return { ...base, mensagem: `Partida salva neste aparelho: será enviada quando ${dono} entrar.` };
  }
  switch (erro.tipo) {
    case 'rede':
    case 'timeout':
      return { ...base, mensagem: 'Partida salva para envio quando a rede voltar. O servidor não pôde ser alcançado agora.' };
    case 'servidor':
      return { ...base, mensagem: `Partida salva para envio: o servidor está com problemas agora. ${mensagemDeErro(erro)}` };
    case 'nao_autenticado':
    case 'offline':
      return { ...base, mensagem: 'Sua sessão expirou: a partida foi salva e será enviada quando você entrar de novo.' };
    default:
      return { ...base, mensagem: `Partida salva para envio depois: ${mensagemDeErro(erro)}` };
  }
}
