// Cliente HTTP do backend NPDev (WmsOfficeTheGame, :8200). Puro: sem DOM; `fetch` e relógio são injetados.
//
// - Base `/api`: mesma origem em produção (D5) e proxy do Vite em dev — sem CORS.
// - O JWT fica só em MEMÓRIA. Quem quiser sobreviver a um F5 guarda `sessao()` onde preferir e chama
//   `restaurarSessao()` na volta (o token vale 8 h; guardá-lo em localStorage é decisão da UI, não da rede).
// - Modo convidado = sem sessão = offline: toda chamada autenticada falha na hora com `NpdevError('offline')`, sem
//   tocar na rede. Só `login()` fala com o servidor sem token.
// - Erro é sempre explícito (NpdevError). 401 com sessão ativa derruba a sessão e avisa `aoSessaoExpirar`.

import { erroDeResposta, NpdevError } from './erros';
import { objeto, lista, texto } from './validacao';

export interface Sessao {
  token: string;
  /** Nome canônico do usuário (o `sub` do JWT). É o que vai em `SimPartida.jogador` (a regra por linha compara com ele). */
  username: string;
  roles: string[];
  /** Instante (ms desde 1970) em que o token deixa de valer; `null` se o servidor não informou. */
  expiraEmMs: number | null;
}

export interface Usuario {
  id: string;
  username: string;
  displayName: string | null;
}

export type ParametrosQuery = Record<string, string | number | boolean | undefined>;

/**
 * O que `pacote.ts`, `partidas.ts` e a fila precisam do cliente. Existe para os testes poderem trocar o cliente
 * por um falso sem fetch, e para deixar claro que esses módulos só leem `logado`/`usuario` e fazem get/post.
 */
export interface Http {
  readonly logado: boolean;
  readonly usuario: string | null;
  get(caminho: string, query?: ParametrosQuery): Promise<unknown>;
  post(caminho: string, corpo: unknown, opcoes?: OpcoesChamada): Promise<unknown>;
}

/** Ajustes de uma chamada só. */
export interface OpcoesChamada {
  /** Prazo desta chamada; sem ele vale o do cliente (20 s). Quem espera a resposta com o jogo parado usa um bem menor. */
  timeoutMs?: number;
}

export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface OpcoesCliente {
  /** Prefixo das rotas. Padrão `/api`. */
  base?: string;
  fetch?: FetchLike;
  /** Relógio em ms (injetável para testar expiração). */
  agora?: () => number;
  /** Prazo de cada chamada. Padrão 20 s (a primeira chamada de flow após subir o app pode levar ~5 s). */
  timeoutMs?: number;
  /** Chamado quando a sessão cai (401 ou token vencido). A UI volta para a tela de login / modo offline. */
  aoSessaoExpirar?: () => void;
}

const TIMEOUT_PADRAO_MS = 20_000;
/** Folga antes do vencimento: não começar uma partida com um token que morre no meio. */
const FOLGA_EXPIRACAO_MS = 30_000;

/** Lê `sub` e `exp` do payload do JWT, só para saber quem somos e até quando. Não verifica assinatura (é papel do servidor). */
function lerJwt(token: string): { sub?: string; expMs?: number } {
  try {
    const parte = token.split('.')[1];
    const json = atob(parte.replace(/-/g, '+').replace(/_/g, '/'));
    const p = JSON.parse(json) as Record<string, unknown>;
    return {
      sub: typeof p.sub === 'string' && p.sub !== '' ? p.sub : undefined,
      expMs: typeof p.exp === 'number' ? p.exp * 1000 : undefined,
    };
  } catch {
    return {};
  }
}

export class NpdevClient implements Http {
  private readonly base: string;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly agora: () => number;
  private readonly timeoutMs: number;
  private readonly aoSessaoExpirar: (() => void) | undefined;
  private sessaoAtual: Sessao | null = null;

  constructor(opcoes: OpcoesCliente = {}) {
    this.base = (opcoes.base ?? '/api').replace(/\/+$/, '');
    this.fetchImpl = opcoes.fetch;
    this.agora = opcoes.agora ?? Date.now;
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.aoSessaoExpirar = opcoes.aoSessaoExpirar;
  }

  // ---- sessão ---------------------------------------------------------------------------------------------------

  /** Há sessão com token ainda válido. Convidado (sem sessão) é `false`: tudo roda offline. */
  get logado(): boolean {
    return this.sessaoValida() !== null;
  }

  get usuario(): string | null {
    return this.sessaoValida()?.username ?? null;
  }

  /** Cópia da sessão atual (para a UI guardar), ou `null`. */
  sessao(): Sessao | null {
    const s = this.sessaoValida();
    return s ? { ...s, roles: [...s.roles] } : null;
  }

  /** Retoma uma sessão guardada. Devolve `false` (e não restaura nada) se ela já venceu ou está malformada. */
  restaurarSessao(s: Sessao): boolean {
    const ok = typeof s?.token === 'string' && s.token !== '' && typeof s.username === 'string' && s.username !== ''
      && Array.isArray(s.roles) && (s.expiraEmMs === null || (typeof s.expiraEmMs === 'number' && this.agora() < s.expiraEmMs - FOLGA_EXPIRACAO_MS));
    if (!ok) return false;
    this.sessaoAtual = { token: s.token, username: s.username, roles: [...s.roles], expiraEmMs: s.expiraEmMs };
    return true;
  }

  /** Sair (ou virar convidado). Não chama o servidor: o JWT é stateless. */
  limparSessao(): void {
    this.sessaoAtual = null;
  }

  private sessaoValida(): Sessao | null {
    const s = this.sessaoAtual;
    if (s && s.expiraEmMs !== null && this.agora() >= s.expiraEmMs - FOLGA_EXPIRACAO_MS) {
      this.sessaoAtual = null; // venceu: some daqui, a UI é avisada na próxima chamada autenticada
    }
    return this.sessaoAtual;
  }

  // ---- auth -----------------------------------------------------------------------------------------------------

  /** `POST /auth/login`. Guarda o JWT em memória. Falha com `nao_autenticado` se usuário/senha não batem. */
  async login(username: string, password: string): Promise<Sessao> {
    if (username.trim() === '' || password === '') {
      throw new NpdevError('requisicao_invalida', 'Informe usuário e senha.');
    }
    const r = objeto(await this.requisitar('POST', '/auth/login', { corpo: { username: username.trim(), password }, autenticado: false }), 'login');
    const token = texto(r, 'token', 'login');
    const roles = r.roles === undefined ? [] : lista(r.roles, 'login.roles').filter((x): x is string => typeof x === 'string');
    const jwt = lerJwt(token);
    const expiresIn = typeof r.expiresInSeconds === 'number' ? r.expiresInSeconds * 1000 + this.agora() : null;
    this.sessaoAtual = {
      token,
      username: jwt.sub ?? username.trim(),
      roles,
      expiraEmMs: jwt.expMs ?? expiresIn,
    };
    return this.sessao()!;
  }

  /** `GET /auth/me`. */
  async me(): Promise<Usuario> {
    const r = objeto(await this.get('/auth/me'), 'me');
    return {
      id: texto(r, 'id', 'me'),
      username: texto(r, 'username', 'me'),
      displayName: typeof r.displayName === 'string' ? r.displayName : null,
    };
  }

  // ---- chamadas autenticadas ------------------------------------------------------------------------------------

  get(caminho: string, query?: ParametrosQuery): Promise<unknown> {
    return this.requisitar('GET', caminho, { query, autenticado: true });
  }

  post(caminho: string, corpo: unknown, opcoes?: OpcoesChamada): Promise<unknown> {
    return this.requisitar('POST', caminho, { corpo, autenticado: true, timeoutMs: opcoes?.timeoutMs });
  }

  private url(caminho: string, query?: ParametrosQuery): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
    const s = qs.toString();
    return `${this.base}${caminho.startsWith('/') ? '' : '/'}${caminho}${s ? `?${s}` : ''}`;
  }

  private async requisitar(metodo: 'GET' | 'POST', caminho: string, o: { query?: ParametrosQuery; corpo?: unknown; autenticado: boolean; timeoutMs?: number }): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.autenticado) {
      const s = this.sessaoValida();
      if (!s) {
        // sem token não há o que perguntar ao servidor: convidado/vencido = offline, sem chamada de rede
        throw new NpdevError('offline', 'Sem login: modo offline.');
      }
      headers.Authorization = `Bearer ${s.token}`;
    }
    if (o.corpo !== undefined) headers['Content-Type'] = 'application/json';

    const fetchImpl = this.fetchImpl ?? (globalThis.fetch?.bind(globalThis) as FetchLike | undefined);
    if (!fetchImpl) throw new NpdevError('rede', 'fetch indisponível neste ambiente.');

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? this.timeoutMs);
    let status: number;
    let ok: boolean;
    let bruto: string;
    try {
      const resp = await fetchImpl(this.url(caminho, o.query), {
        method: metodo, headers, signal: ctl.signal,
        ...(o.corpo !== undefined ? { body: JSON.stringify(o.corpo) } : {}),
      });
      status = resp.status;
      ok = resp.ok;
      bruto = await resp.text();
    } catch (e) {
      if (ctl.signal.aborted) throw new NpdevError('timeout', 'O servidor não respondeu a tempo.', { causa: e });
      throw new NpdevError('rede', 'Sem conexão com o servidor.', { causa: e });
    } finally {
      clearTimeout(timer);
    }

    let corpo: unknown = undefined;
    let legivel = true;
    if (bruto !== '') {
      try { corpo = JSON.parse(bruto); } catch { corpo = bruto; legivel = false; }
    }
    if (!ok) {
      const erro = erroDeResposta(status, corpo);
      // 401 com sessão ativa: o token morreu (venceu no servidor, chave trocada). Derruba e avisa a UI.
      if (status === 401 && o.autenticado) {
        this.sessaoAtual = null;
        this.aoSessaoExpirar?.();
      }
      throw erro;
    }
    if (!legivel) throw new NpdevError('resposta_invalida', 'Resposta do servidor inválida: o corpo não é JSON.', { status, corpo });
    return corpo;
  }
}

