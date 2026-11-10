// Sessão do jogador: convidado (offline) ou logado (NPDev). Controlador puro, sem DOM: a UI só chama e observa.
//
//   convidado ──entrar()──► logado ──sair()──► convidado
//                              └──aoExpirar()/verificar()──► convidado (com aviso; a partida em curso NÃO é tocada)
//
// - O JWT mora na memória do `NpdevClient`. Para sobreviver a um F5 ele é copiado no `sessionStorage` (por aba: fechar
//   a aba esquece), sempre dentro de try/catch — janela privada ou armazenamento bloqueado fazem o acesso LANÇAR, e o
//   jogo continua funcionando, só sem restaurar. O token vale 8 h e fica legível por script da página (aceito: o jogo
//   não carrega conteúdo de terceiros; `localStorage` seria pior, pois sobrevive à aba).
// - "Já escolhi convidado" também vai para o `sessionStorage`: recarregar a página não pergunta de novo, mas a
//   próxima aba pergunta (o login nunca bloqueia o jogo: convidado é um clique, e Esc também).
// - Expiração: o servidor derruba com 401 (o cliente avisa por `aoSessaoExpirar`) e o próprio token tem validade; um
//   temporizador (injetável) cobre o segundo caso sem esperar a próxima chamada falhar.

import type { NpdevClient, Sessao } from '../net/npdevClient';

/** O que o controlador precisa do `Storage` do navegador (e dos falsos dos testes). */
export interface ArmazenamentoSimples {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export type ModoSessao = 'convidado' | 'logado';

export interface EstadoSessao {
  modo: ModoSessao;
  /** Username canônico (o `sub` do JWT); `null` = convidado. */
  usuario: string | null;
  /** Já escolheu entrar ou jogar como convidado (nesta aba): a abertura não pergunta de novo. */
  escolheu: boolean;
}

/** Por que o estado mudou — a UI escolhe o aviso (ex.: `expirou` pede uma mensagem, `entrou` não). */
export type EventoSessao = 'restaurada' | 'entrou' | 'saiu' | 'convidado' | 'expirou';

export interface OpcoesControladorSessao {
  /** Padrão: `window.sessionStorage`, se o navegador deixar acessá-lo. `null` = sem persistência. */
  sessionStorage?: ArmazenamentoSimples | null;
  /** Só guarda o último nome de usuário digitado (conveniência; nunca a senha nem o token). */
  localStorage?: ArmazenamentoSimples | null;
  agora?: () => number;
  /** Agenda `fn` daqui a `ms`; devolve o cancelamento. Padrão: `setTimeout`. */
  agendar?: (fn: () => void, ms: number) => () => void;
}

const CHAVE_SESSAO = 'wmsgame:sessao';
const CHAVE_CONVIDADO = 'wmsgame:convidado';
const CHAVE_USUARIO = 'wmsgame:ultimo-usuario';
/** Folga do `NpdevClient` antes do vencimento do token (não exportada por ele); o temporizador só dispara depois dela. */
const FOLGA_MS = 30_000;
const TETO_SETTIMEOUT_MS = 2 ** 31 - 1;

/** `window.sessionStorage`/`localStorage` — o próprio ACESSO pode lançar (SecurityError em janela privada/cookies bloqueados). */
function doNavegador(nome: 'sessionStorage' | 'localStorage'): ArmazenamentoSimples | null {
  try {
    return typeof window === 'undefined' ? null : window[nome];
  } catch {
    return null;
  }
}

function agendarPadrao(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, Math.min(ms, TETO_SETTIMEOUT_MS));
  return () => clearTimeout(t);
}

/** Lê o que foi guardado e só aceita o formato exato (JSON corrompido/antigo = sem sessão). */
function lerSessaoGuardada(bruto: string | null): Sessao | null {
  if (bruto === null) return null;
  try {
    const s = JSON.parse(bruto) as Partial<Sessao>;
    const ok = typeof s.token === 'string' && s.token !== '' && typeof s.username === 'string' && s.username !== ''
      && Array.isArray(s.roles) && s.roles.every(r => typeof r === 'string')
      && (s.expiraEmMs === null || typeof s.expiraEmMs === 'number');
    return ok ? (s as Sessao) : null;
  } catch {
    return null;
  }
}

export class ControladorSessao {
  private readonly session: ArmazenamentoSimples | null;
  private readonly local: ArmazenamentoSimples | null;
  private readonly agora: () => number;
  private readonly agendar: (fn: () => void, ms: number) => () => void;
  private readonly observadores = new Set<(estado: EstadoSessao, evento: EventoSessao) => void>();
  private cancelarExpiracao: (() => void) | null = null;
  private atual: EstadoSessao = { modo: 'convidado', usuario: null, escolheu: false };

  constructor(private readonly cliente: NpdevClient, opcoes: OpcoesControladorSessao = {}) {
    this.session = opcoes.sessionStorage === undefined ? doNavegador('sessionStorage') : opcoes.sessionStorage;
    this.local = opcoes.localStorage === undefined ? doNavegador('localStorage') : opcoes.localStorage;
    this.agora = opcoes.agora ?? Date.now;
    this.agendar = opcoes.agendar ?? agendarPadrao;
    this.atual.escolheu = this.ler(this.session, CHAVE_CONVIDADO) === '1';
  }

  get estado(): EstadoSessao {
    return { ...this.atual };
  }

  /** Último usuário que entrou neste aparelho, para preencher o campo (nunca a senha). */
  get ultimoUsuario(): string | null {
    return this.ler(this.local, CHAVE_USUARIO);
  }

  /** Avisa a cada mudança de estado. Devolve a função que cancela. */
  observar(ouvinte: (estado: EstadoSessao, evento: EventoSessao) => void): () => void {
    this.observadores.add(ouvinte);
    return () => { this.observadores.delete(ouvinte); };
  }

  // ---- transições -----------------------------------------------------------------------------------------------

  /**
   * Retoma a sessão guardada pela aba (F5). `false` = não havia ou já venceu/estava corrompida (e foi esquecida).
   * Não consulta o servidor: se ele já não aceitar o token, a primeira chamada devolve 401 e `aoExpirar` cuida.
   */
  restaurar(): boolean {
    const guardada = lerSessaoGuardada(this.ler(this.session, CHAVE_SESSAO));
    if (!guardada || !this.cliente.restaurarSessao(guardada)) {
      this.esquecer(this.session, CHAVE_SESSAO);
      return false;
    }
    this.atual = { modo: 'logado', usuario: this.cliente.usuario, escolheu: true };
    this.agendarExpiracao();
    this.notificar('restaurada');
    return true;
  }

  /** Login no servidor. Lança `NpdevError` (`nao_autenticado`, `rede`, `servidor`…) — a UI mostra `mensagemDeErro`. */
  async entrar(usuario: string, senha: string): Promise<void> {
    const sessao = await this.cliente.login(usuario, senha);
    this.gravar(this.session, CHAVE_SESSAO, JSON.stringify(sessao));
    this.gravar(this.local, CHAVE_USUARIO, sessao.username);
    this.esquecer(this.session, CHAVE_CONVIDADO); // agora a escolha é "logado"; sair() volta a lembrar convidado
    this.atual = { modo: 'logado', usuario: sessao.username, escolheu: true };
    this.agendarExpiracao();
    this.notificar('entrou');
  }

  /** Sai (volta a convidado). Não chama o servidor: o JWT é stateless. */
  sair(): void {
    this.cliente.limparSessao();
    this.virarConvidado('saiu');
  }

  /** "Jogar como convidado": tudo offline, nenhuma chamada de rede. */
  escolherConvidado(): void {
    this.cliente.limparSessao();
    this.virarConvidado('convidado');
  }

  /** O servidor recusou o token (401) ou ele venceu: volta a convidado SEM mexer na partida em andamento. */
  aoExpirar(): void {
    if (this.atual.modo !== 'logado') return;
    this.cliente.limparSessao();
    this.virarConvidado('expirou');
  }

  /** Confere se a sessão que o controlador acha que tem ainda vale (token vencido sem nenhuma chamada para perceber). */
  verificar(): void {
    if (this.atual.modo === 'logado' && !this.cliente.logado) this.aoExpirar();
  }

  // ---- internos -------------------------------------------------------------------------------------------------

  private virarConvidado(evento: EventoSessao): void {
    this.cancelarExpiracao?.();
    this.cancelarExpiracao = null;
    this.esquecer(this.session, CHAVE_SESSAO);
    this.gravar(this.session, CHAVE_CONVIDADO, '1');
    this.atual = { modo: 'convidado', usuario: null, escolheu: true };
    this.notificar(evento);
  }

  private agendarExpiracao(): void {
    this.cancelarExpiracao?.();
    this.cancelarExpiracao = null;
    const venceEm = this.cliente.sessao()?.expiraEmMs;
    if (venceEm === null || venceEm === undefined) return;
    // +500 ms: o cliente já considera o token vencido FOLGA_MS antes; disparar no ms exato arriscaria um frame "ainda logado"
    const espera = Math.max(0, venceEm - FOLGA_MS - this.agora()) + 500;
    this.cancelarExpiracao = this.agendar(() => {
      this.cancelarExpiracao = null;
      this.verificar();
      if (this.atual.modo === 'logado') this.agendarExpiracao(); // timer adiantado: tenta de novo
    }, espera);
  }

  private notificar(evento: EventoSessao): void {
    const estado = this.estado;
    // um ouvinte com bug não pode impedir os outros nem desfazer a transição
    for (const o of this.observadores) { try { o(estado, evento); } catch { /* ignorado */ } }
  }

  private ler(onde: ArmazenamentoSimples | null, chave: string): string | null {
    try { return onde?.getItem(chave) ?? null; } catch { return null; }
  }

  private gravar(onde: ArmazenamentoSimples | null, chave: string, valor: string): void {
    try { onde?.setItem(chave, valor); } catch { /* sem armazenamento: o jogo segue, só não restaura no F5 */ }
  }

  private esquecer(onde: ArmazenamentoSimples | null, chave: string): void {
    try { onde?.removeItem(chave); } catch { /* idem */ }
  }
}
