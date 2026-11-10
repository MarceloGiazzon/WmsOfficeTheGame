// Servidor NPDev falso, só para os testes: um `fetch` que responde como o backend do jogo (formatos e códigos de
// erro conferidos ao vivo na 8200). Serve pacotes de cenário a partir de PacoteCenario (com UUIDs), login, partidas,
// flows e ranking, e deixa injetar falhas: rede caída, resposta perdida DEPOIS de o servidor aplicar a escrita, erro
// HTTP, timeout. Não é usado pelo app.

import type { Metricas, PacoteCenario } from '../sim/model';
import { calcularScore } from '../sim/score';
import type { FetchLike } from './npdevClient';

type Linha = Record<string, unknown>;
type Corpo = unknown;

export interface Chamada {
  metodo: string;
  /** Caminho sem `/api` e sem query. */
  caminho: string;
  query: Record<string, string>;
  corpo: unknown;
}

interface Resposta { status: number; corpo: Corpo; textoBruto?: string }

export interface OpcoesServidorFalso {
  /** Pacotes a servir (já com os ids que o "banco" terá, tipicamente UUIDs). O 1º é o que os testes usam. */
  pacotes: PacoteCenario[];
  usuarios?: Record<string, { senha: string; roles?: string[] }>;
  /** Relógio compartilhado com o cliente (expiração do JWT). */
  agora?: () => number;
  /** Máximo de linhas por página (o NPDev real: 1000). Valor pequeno força a paginação. */
  maxPagina?: number;
  /** Concepts que a role não lê: `/page` responde 200 com lista vazia, como o NPDev real. */
  semLeituraDe?: string[];
}

const PERFIL = 'perfil-padrao';
const uuidFalso = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export class ServidorFalso {
  /** Todas as chamadas recebidas, na ordem (mesmo as que falharam). */
  readonly chamadas: Chamada[] = [];
  /** `false` = conexão recusada (o `fetch` rejeita com TypeError). */
  rede = true;
  /** Partidas e scores gravados. */
  readonly partidas = new Map<string, Linha>();
  readonly scores = new Map<string, Linha>();

  private readonly tabelas = new Map<string, Linha[]>();
  private readonly usuarios: Record<string, { senha: string; roles: string[] }>;
  private readonly agora: () => number;
  private readonly maxPagina: number;
  private readonly semLeitura: Set<string>;
  private contador = 1;
  private readonly tokens = new Map<string, string>();
  private respostasFalsas: { n: number; filtro: (c: Chamada) => boolean; resposta: Resposta }[] = [];
  private perdas: { n: number; filtro: (c: Chamada) => boolean }[] = [];
  private travadas: { n: number; filtro: (c: Chamada) => boolean }[] = [];

  constructor(o: OpcoesServidorFalso) {
    this.usuarios = Object.fromEntries(Object.entries(o.usuarios ?? { jogador: { senha: 'senha-certa' } })
      .map(([u, v]) => [u, { senha: v.senha, roles: v.roles ?? ['Jogador'] }]));
    this.agora = o.agora ?? Date.now;
    this.maxPagina = o.maxPagina ?? 1000;
    this.semLeitura = new Set(o.semLeituraDe ?? []);
    for (const p of o.pacotes) this.carregar(p);
  }

  readonly fetch: FetchLike = (url, init) => this.tratar(url, init);

  // ---- injeção de falhas ----------------------------------------------------------------------------------------

  /** As próximas `n` chamadas que casarem com `filtro` recebem esta resposta HTTP, sem o servidor processar nada. */
  falharProximas(n: number, resposta: { status: number; corpo?: unknown; textoBruto?: string }, filtro: (c: Chamada) => boolean = () => true): void {
    this.respostasFalsas.push({ n, filtro, resposta: { status: resposta.status, corpo: resposta.corpo, textoBruto: resposta.textoBruto } });
  }

  /** As próximas `n` chamadas que casarem são PROCESSADAS (a escrita acontece), mas a resposta se perde: o `fetch` rejeita. */
  perderRespostaDasProximas(n: number, filtro: (c: Chamada) => boolean): void {
    this.perdas.push({ n, filtro });
  }

  /** As próximas `n` chamadas que casarem nunca respondem (só terminam se o cliente abortar por timeout). */
  travarProximas(n: number, filtro: (c: Chamada) => boolean = () => true): void {
    this.travadas.push({ n, filtro });
  }

  /** Cria um usuário (role Jogador por padrão). */
  adicionarUsuario(nome: string, senha: string, roles: string[] = ['Jogador']): void {
    this.usuarios[nome] = { senha, roles };
  }

  contar(filtro: (c: Chamada) => boolean): number {
    return this.chamadas.filter(filtro).length;
  }

  // ---- dados ----------------------------------------------------------------------------------------------------

  private tabela(nome: string): Linha[] {
    let t = this.tabelas.get(nome);
    if (!t) { t = []; this.tabelas.set(nome, t); }
    return t;
  }

  /** Linhas como o NPDev devolve: os campos do modelo + `version`/`tenantId` (e `ativo`), que o cliente tem de ignorar. */
  private carregar(p: PacoteCenario): void {
    const extra = { version: 0, tenantId: 'dev' };
    this.tabela('SimCenario').push({ ...p.cenario, ativo: true, ...extra });
    this.tabela('Armazem').push({ ...p.armazem, entidadeId: uuidFalso(0), ativo: true, latitude: null, longitude: null, ...extra });
    for (const a of p.areas) this.tabela('Area').push({ ...a, ativo: true, ...extra });
    for (const r of p.ruas) this.tabela('Rua').push({ ...r, ativo: true, bloqueiaExpedicao: false, bloqueiaMovimento: false, bloqueiaRecebimento: false, ...extra });
    for (const l of p.locais) this.tabela('LocalArmazenagem').push({ ...l, ...extra });
    const perfil = `${PERFIL}-${p.cenario.codigo}`;
    for (const x of p.produtos) this.tabela('Produto').push({ ...x, ativo: true, perfilAlocacaoId: perfil, ncm: null, pesoGramas: null, ...extra });
    for (const r of p.rankingRuas) this.tabela('RankingRua').push({ id: uuidFalso(this.contador++ + 100000), ruaId: r.ruaId, prioridade: r.prioridade, perfilAlocacaoId: perfil, ...extra });
    for (const o of p.ordens) this.tabela('SimOrdem').push({ ...o, cenarioId: p.cenario.id, ...extra });
  }

  // ---- HTTP -----------------------------------------------------------------------------------------------------

  private async tratar(url: string, init: Parameters<FetchLike>[1]): Promise<Awaited<ReturnType<FetchLike>>> {
    const u = new URL(url, 'http://servidor-falso');
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => { query[k] = v; });
    const chamada: Chamada = {
      metodo: init.method, caminho: u.pathname.replace(/^\/api/, ''), query,
      corpo: init.body !== undefined ? JSON.parse(init.body) : undefined,
    };
    this.chamadas.push(chamada);

    if (!this.rede) throw new TypeError('fetch failed (ECONNREFUSED)');

    const travada = this.consumir(this.travadas, chamada);
    if (travada) {
      await new Promise<never>((_, rejeitar) => {
        init.signal?.addEventListener('abort', () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    const falsa = this.respostasFalsas.find(f => f.n > 0 && f.filtro(chamada));
    if (falsa) { falsa.n--; return this.embalar(falsa.resposta); }

    const resposta = this.rotear(chamada, init.headers.Authorization);
    if (this.consumir(this.perdas, chamada)) throw new TypeError('fetch failed (connection reset)');
    return this.embalar(resposta);
  }

  private consumir(lista: { n: number; filtro: (c: Chamada) => boolean }[], c: Chamada): boolean {
    const f = lista.find(x => x.n > 0 && x.filtro(c));
    if (!f) return false;
    f.n--;
    return true;
  }

  private embalar(r: Resposta): Awaited<ReturnType<FetchLike>> {
    const texto = r.textoBruto ?? (r.corpo === undefined ? '' : JSON.stringify(r.corpo));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => texto };
  }

  private ok(corpo: Corpo): Resposta { return { status: 200, corpo }; }

  private rotear(c: Chamada, autorizacao: string | undefined): Resposta {
    if (c.metodo === 'POST' && c.caminho === '/auth/login') return this.login(c.corpo as Linha);

    const usuario = this.autenticar(autorizacao);
    if (typeof usuario !== 'string') return usuario;
    const jogador = usuario;

    if (c.metodo === 'GET' && c.caminho === '/auth/me') {
      return this.ok({ id: `id-${jogador}`, username: jogador, displayName: jogador, email: null, avatarUrl: null });
    }
    let m: RegExpExecArray | null;
    if (c.metodo === 'GET' && (m = /^\/queries\/(\w+)$/.exec(c.caminho))) return this.query(m[1], c.query, jogador);
    if (c.metodo === 'GET' && (m = /^\/concepts\/(\w+)\/page$/.exec(c.caminho))) return this.pagina(m[1], c.query, jogador);
    if (c.metodo === 'POST' && c.caminho === '/sim_partidas') return this.criarPartida(c.corpo as Linha, jogador);
    if (c.metodo === 'POST' && (m = /^\/flows\/(\w+)\/execute$/.exec(c.caminho))) return this.flow(m[1], c.corpo as Linha, jogador);
    return { status: 404, corpo: { timestamp: 'x', status: 404, error: 'Not Found', path: `/api${c.caminho}` } };
  }

  private login(corpo: Linha): Resposta {
    const u = this.usuarios[String(corpo?.username)];
    if (!u || u.senha !== corpo.password) return { status: 401, corpo: { error: 'invalid_credentials' } };
    const sub = String(corpo.username);
    const b64 = (o: unknown): string => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(this.agora() / 1000) + 28800;
    const token = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: 'wmsoffice', sub, exp, roles: u.roles })}.assinatura-${this.tokens.size}`;
    this.tokens.set(token, sub);
    return this.ok({ token, tokenType: 'Bearer', expiresInSeconds: 28800, roles: u.roles });
  }

  /** Devolve o username do token, ou a resposta 401. Token vencido no servidor também é 401. */
  private autenticar(autorizacao: string | undefined): string | Resposta {
    if (!autorizacao?.startsWith('Bearer ')) return { status: 401, corpo: { error: 'missing_bearer_token' } };
    const token = autorizacao.slice(7);
    const sub = this.tokens.get(token);
    if (!sub) return { status: 401, corpo: { error: 'invalid_jwt_header' } };
    try {
      const exp = (JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp: number }).exp;
      if (this.agora() / 1000 >= exp) return { status: 401, corpo: { error: 'jwt_expired' } };
    } catch { return { status: 401, corpo: { error: 'invalid_jwt_header' } }; }
    return sub;
  }

  /** Invalida todos os tokens (o servidor reiniciou com outra chave, por exemplo). */
  revogarTokens(): void {
    this.tokens.clear();
  }

  private visivel(conceito: string, linhas: Linha[], jogador: string): Linha[] {
    // regra por linha de SimPartida: só o dono; os outros concepts do jogo são legíveis
    return conceito === 'SimPartida' ? linhas.filter(l => l.jogador === jogador) : linhas;
  }

  private pagina(conceito: string, q: Record<string, string>, jogador: string): Resposta {
    const base = conceito === 'SimScore' ? [...this.scores.values()] : conceito === 'SimPartida' ? [...this.partidas.values()] : this.tabelas.get(conceito);
    if (!base) return { status: 400, corpo: { timestamp: 'x', status: 400, error: 'Bad Request', path: `/api/concepts/${conceito}/page` } };
    const reservados = new Set(['offset', 'limit', 'sort', 'direction', 'page', 'size']);
    let linhas = this.semLeitura.has(conceito) ? [] : this.visivel(conceito, base, jogador);
    for (const [campo, valor] of Object.entries(q)) {
      if (reservados.has(campo)) continue;
      if (base.length > 0 && !(campo in base[0])) { // filtro por campo que o concept não tem: 400, como o NPDev
        return { status: 400, corpo: { timestamp: 'x', status: 400, error: 'Bad Request', path: `/api/concepts/${conceito}/page` } };
      }
      linhas = linhas.filter(l => String(l[campo]) === valor);
    }
    linhas = [...linhas].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)); // o banco devolve por id (UUID): aleatório para o jogo
    const offset = Number(q.offset ?? 0);
    const limit = Math.min(Number(q.limit ?? 50), this.maxPagina);
    const items = linhas.slice(offset, offset + limit);
    return this.ok({ items, total: linhas.length, hasMore: offset + items.length < linhas.length, offset, limit });
  }

  private query(nome: string, q: Record<string, string>, jogador: string): Resposta {
    void jogador;
    const offset = Number(q.offset ?? 0);
    const limit = Math.min(Number(q.limit ?? 50), this.maxPagina);
    const resposta = (rows: Linha[]): Resposta => this.ok({
      query: nome, aggregate: false, rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit,
    });
    if (nome === 'CenariosAtivos') {
      return resposta(this.tabela('SimCenario').filter(c => c.ativo === true).sort((a, b) => (String(a.codigo) < String(b.codigo) ? -1 : 1)));
    }
    if (nome === 'OrdensPorCenario' || nome === 'RankingPorCenario') {
      if (!q.cenarioId) return { status: 400, corpo: { timestamp: 'x', status: 400, error: 'Bad Request', path: `/api/queries/${nome}` } };
      if (nome === 'OrdensPorCenario') {
        return resposta(this.tabela('SimOrdem').filter(o => o.cenarioId === q.cenarioId)
          .sort((a, b) => Number(a.liberacaoSeg) - Number(b.liberacaoSeg) || (String(a.numero) < String(b.numero) ? -1 : 1)));
      }
      return resposta([...this.scores.values()].filter(s => s.cenarioId === q.cenarioId && s.validadoServidor === true)
        .sort((a, b) => Number(b.scoreCentesimos) - Number(a.scoreCentesimos) || Number(a.distanciaRealCm) - Number(b.distanciaRealCm)));
    }
    return { status: 404, corpo: { timestamp: 'x', status: 404, error: 'Not Found', path: `/api/queries/${nome}` } };
  }

  private criarPartida(c: Linha, jogador: string): Resposta {
    if (c.jogador !== jogador) return { status: 403, corpo: { code: 'ROW_SCOPE_DENIED', message: 'Row-level access rule denied the write' } };
    if (!this.tabela('SimCenario').some(x => x.id === c.cenarioId)) {
      return { status: 422, corpo: { code: 'bond_target_not_found', concept: 'SimPartida', path: 'cenarioId', message: 'Referenced SimCenario was not found' } };
    }
    const id = uuidFalso(this.contador++ + 200000);
    const linha: Linha = {
      id, cenarioId: c.cenarioId, jogador, politica: c.politica, versaoMotor: c.versaoMotor, situacao: 'EmAndamento',
      iniciadaEm: c.iniciadaEm, concluidaEm: null, version: 0, tenantId: 'dev',
    };
    this.partidas.set(id, linha);
    return { status: 201, corpo: linha };
  }

  private envelope(output: unknown): Resposta {
    return this.ok({ executionId: 'x', flowName: 'x', status: 'OK', output, errorCode: null, error: null });
  }

  private flowFalhou(erro: string): Resposta {
    return { status: 422, corpo: { executionId: 'x', status: 'FAILED', output: null, errorCode: 'system_exception', error: erro } };
  }

  private flow(nome: string, entrada: Linha, jogador: string): Resposta {
    const partida = this.partidas.get(String(entrada?.partidaId));
    if (nome !== 'ConcluirPartida' && nome !== 'AbandonarPartida') return { status: 404, corpo: { error: 'flow desconhecido' } };
    if (!partida || partida.jogador !== jogador) {
      return this.flowFalhou(`CONCEPT_NOT_FOUND: Concept record not found: SimPartida:${String(entrada?.partidaId)}`);
    }
    if (nome === 'AbandonarPartida') {
      if (partida.situacao !== 'EmAndamento') {
        return this.flowFalhou(`PROCEDURE_STEP_FAILED: Concept lifecycle transition is not allowed: ${String(partida.situacao)} -> Abandonada`);
      }
      partida.situacao = 'Abandonada';
      return this.envelope({ conceptName: 'SimPartida', id: partida.id, data: { ...partida }, rowVersion: 1 });
    }

    const metricas = entrada as unknown as Metricas;
    const calculado = calcularScore(metricas);
    if (!calculado.sucesso) return this.envelope({ sucesso: false, valido: false, motivo: calculado.motivo });
    if (partida.situacao !== 'EmAndamento') return this.envelope({ sucesso: false, valido: false, motivo: 'Partida nao esta EmAndamento' });
    const id = uuidFalso(this.contador++ + 300000);
    const score: Linha = {
      id, partidaId: partida.id, cenarioId: partida.cenarioId, jogador, distanciaRealCm: metricas.distanciaRealCm,
      distanciaTeoricaCm: metricas.distanciaTeoricaCm, ordensTotal: metricas.ordensTotal, ordensAtrasadas: metricas.ordensAtrasadas,
      eventosConflito: metricas.eventosConflito, ocupacaoFinalCentesimos: metricas.ocupacaoFinalCentesimos,
      scoreCentesimos: calculado.scoreCentesimos, validadoServidor: calculado.scoreCentesimos === entrada.scoreCentesimos,
      version: 0, tenantId: 'dev',
    };
    this.scores.set(id, score);
    partida.situacao = 'Concluida';
    partida.concluidaEm = new Date(this.agora()).toISOString();
    return this.envelope({ conceptName: 'SimScore', id, data: { ...score }, rowVersion: 0 });
  }
}
