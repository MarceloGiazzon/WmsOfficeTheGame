import { describe, expect, it, vi } from 'vitest';
import { ehNpdevError, erroDeResposta, NpdevError } from './erros';
import { NpdevClient, type FetchLike } from './npdevClient';
import { ServidorFalso } from './servidorFalso';

/** fetch roteirizado: devolve as respostas na ordem e registra o que recebeu. */
function fetchRoteirizado(...respostas: ({ status: number; corpo?: unknown; bruto?: string } | Error)[]) {
  const chamadas: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fn: FetchLike = async (url, init) => {
    chamadas.push({ url, init });
    const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
    if (r instanceof Error) throw r;
    const texto = r.bruto ?? (r.corpo === undefined ? '' : JSON.stringify(r.corpo));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => texto };
  };
  return { fn, chamadas };
}

const SESSAO_OK = { status: 200, corpo: { token: 'a.b.c', tokenType: 'Bearer', expiresInSeconds: 28800, roles: ['Jogador'] } };

async function logado(...depois: Parameters<typeof fetchRoteirizado>) {
  const f = fetchRoteirizado(SESSAO_OK, ...depois);
  const aoExpirar = vi.fn();
  const c = new NpdevClient({ fetch: f.fn, aoSessaoExpirar: aoExpirar });
  await c.login('jogador', 'senha');
  return { c, f, aoExpirar };
}

describe('NpdevClient: login e sessão', () => {
  it('faz POST /api/auth/login, guarda o JWT em memória e o usa nas chamadas seguintes', async () => {
    const f = fetchRoteirizado(SESSAO_OK, { status: 200, corpo: { ok: true } });
    const c = new NpdevClient({ fetch: f.fn });
    expect(c.logado).toBe(false);
    const s = await c.login('  jogador ', 'senha');
    expect(f.chamadas[0].url).toBe('/api/auth/login');
    expect(f.chamadas[0].init.method).toBe('POST');
    expect(JSON.parse(f.chamadas[0].init.body!)).toEqual({ username: 'jogador', password: 'senha' });
    expect(f.chamadas[0].init.headers.Authorization).toBeUndefined(); // login não leva token
    expect(s).toMatchObject({ token: 'a.b.c', username: 'jogador', roles: ['Jogador'] });
    expect(c.logado).toBe(true);

    await c.get('/queries/CenariosAtivos', { limit: 5, vazio: undefined });
    expect(f.chamadas[1].url).toBe('/api/queries/CenariosAtivos?limit=5'); // `undefined` não vira parâmetro
    expect(f.chamadas[1].init.headers.Authorization).toBe('Bearer a.b.c');
  });

  it('o username canônico é o `sub` do JWT (a regra por linha compara com ele, não com o que foi digitado)', async () => {
    const payload = btoa(JSON.stringify({ sub: 'teste-jogador-1', exp: 9999999999 })).replace(/=+$/, '');
    const f = fetchRoteirizado({ status: 200, corpo: { token: `h.${payload}.s`, roles: ['Jogador'] } });
    const c = new NpdevClient({ fetch: f.fn });
    const s = await c.login('Teste-Jogador-1', 'x');
    expect(s.username).toBe('teste-jogador-1');
    expect(c.usuario).toBe('teste-jogador-1');
  });

  it('senha errada: nao_autenticado com mensagem clara, sem sessão e sem acionar aoSessaoExpirar', async () => {
    const f = fetchRoteirizado({ status: 401, corpo: { error: 'invalid_credentials' } });
    const aoExpirar = vi.fn();
    const c = new NpdevClient({ fetch: f.fn, aoSessaoExpirar: aoExpirar });
    const erro = await c.login('jogador', 'errada').catch(e => e);
    expect(erro).toBeInstanceOf(NpdevError);
    expect(erro).toMatchObject({ tipo: 'nao_autenticado', status: 401, codigo: 'invalid_credentials', message: 'Usuário ou senha inválidos.' });
    expect(c.logado).toBe(false);
    expect(aoExpirar).not.toHaveBeenCalled();
  });

  it('usuário ou senha em branco: recusa antes de qualquer chamada de rede', async () => {
    const f = fetchRoteirizado(SESSAO_OK);
    const c = new NpdevClient({ fetch: f.fn });
    await expect(c.login('', 'x')).rejects.toMatchObject({ tipo: 'requisicao_invalida' });
    await expect(c.login('jogador', '')).rejects.toMatchObject({ tipo: 'requisicao_invalida' });
    expect(f.chamadas).toHaveLength(0);
  });

  it('login com resposta sem token é resposta_invalida (não cria sessão)', async () => {
    const c = new NpdevClient({ fetch: fetchRoteirizado({ status: 200, corpo: { tokenType: 'Bearer' } }).fn });
    await expect(c.login('jogador', 'senha')).rejects.toMatchObject({ tipo: 'resposta_invalida' });
    expect(c.logado).toBe(false);
  });

  it('GET /auth/me devolve o usuário; resposta sem username é resposta_invalida', async () => {
    const { c } = await logado({ status: 200, corpo: { id: 'u1', username: 'jogador', displayName: 'Jo', email: null } });
    expect(await c.me()).toEqual({ id: 'u1', username: 'jogador', displayName: 'Jo' });
    const ruim = await logado({ status: 200, corpo: { id: 'u1' } });
    await expect(ruim.c.me()).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });

  it('limparSessao volta ao modo convidado', async () => {
    const { c } = await logado();
    c.limparSessao();
    expect(c.logado).toBe(false);
    expect(c.usuario).toBeNull();
    expect(c.sessao()).toBeNull();
  });
});

describe('NpdevClient: modo convidado = offline, sem rede', () => {
  it('toda chamada autenticada falha com `offline` sem tocar no fetch', async () => {
    const f = fetchRoteirizado({ status: 200, corpo: {} });
    const c = new NpdevClient({ fetch: f.fn });
    for (const chamada of [() => c.get('/queries/CenariosAtivos'), () => c.post('/sim_partidas', {}), () => c.me()]) {
      const erro = await chamada().catch(e => e);
      expect(erro).toMatchObject({ tipo: 'offline', recuperavel: true });
    }
    expect(f.chamadas).toHaveLength(0);
  });
});

describe('NpdevClient: expiração e restauração da sessão', () => {
  it('token vencido (pelo relógio) vira convidado sem chamar a rede; restaurarSessao recusa sessão vencida', async () => {
    let agora = 1_000_000;
    const f = fetchRoteirizado(SESSAO_OK, { status: 200, corpo: {} });
    const c = new NpdevClient({ fetch: f.fn, agora: () => agora });
    await c.login('jogador', 'senha'); // expiresInSeconds 28800
    const guardada = c.sessao()!;
    expect(guardada.expiraEmMs).toBe(1_000_000 + 28_800_000);

    agora += 28_800_000 - 10_000; // faltam 10 s: dentro da folga de 30 s, já não vale começar nada
    expect(c.logado).toBe(false);
    await expect(c.get('/x')).rejects.toMatchObject({ tipo: 'offline' });
    expect(f.chamadas).toHaveLength(1); // só o login

    const novo = new NpdevClient({ fetch: f.fn, agora: () => agora });
    expect(novo.restaurarSessao(guardada)).toBe(false);
    expect(novo.logado).toBe(false);
    agora = 1_000_000 + 60_000;
    expect(novo.restaurarSessao(guardada)).toBe(true);
    expect(novo.usuario).toBe('jogador');
    expect(novo.restaurarSessao({ ...guardada, token: '' })).toBe(false);
  });

  it('401 numa chamada com sessão: derruba a sessão, avisa a UI e lança nao_autenticado', async () => {
    const { c, aoExpirar } = await logado({ status: 401, corpo: { error: 'invalid_jwt_header' } });
    const erro = await c.get('/queries/CenariosAtivos').catch(e => e);
    expect(erro).toMatchObject({ tipo: 'nao_autenticado', status: 401, recuperavel: true });
    expect(c.logado).toBe(false);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });
});

describe('NpdevClient: erros explícitos (nunca sucesso falso)', () => {
  const casos: [string, number, unknown, string, boolean][] = [
    ['403 → proibido', 403, { error: 'forbidden' }, 'proibido', false],
    ['404 → nao_encontrado', 404, undefined, 'nao_encontrado', false],
    ['422 de invariant → requisicao_invalida com a mensagem do servidor', 422, { code: 'invariant_failed', message: 'enum constraint violated for field politica' }, 'requisicao_invalida', false],
    ['400 do Spring → requisicao_invalida', 400, { timestamp: 'x', status: 400, error: 'Bad Request', path: '/api/x' }, 'requisicao_invalida', false],
    ['500 → servidor (recuperável)', 500, { error: 'Internal Server Error' }, 'servidor', true],
    ['503 do proxy sem corpo → servidor', 503, undefined, 'servidor', true],
    ['429 → servidor (tente depois)', 429, undefined, 'servidor', true],
  ];
  it.each(casos)('%s', async (_, status, corpo, tipo, recuperavel) => {
    const { c } = await logado({ status, corpo });
    const erro = (await c.get('/qualquer').catch(e => e)) as NpdevError;
    expect(ehNpdevError(erro)).toBe(true);
    expect(erro).toMatchObject({ tipo, status, recuperavel });
    expect(erro.message).not.toBe('');
  });

  it('403 não derruba a sessão (só 401 derruba)', async () => {
    const { c, aoExpirar } = await logado({ status: 403, corpo: { error: 'forbidden' } });
    await c.get('/recebimentos').catch(() => undefined);
    expect(c.logado).toBe(true);
    expect(aoExpirar).not.toHaveBeenCalled();
  });

  it('rede caída: tipo `rede`, recuperável, com a causa original', async () => {
    const causa = new TypeError('fetch failed');
    const { c } = await logado(causa);
    const erro = (await c.get('/x').catch(e => e)) as NpdevError;
    expect(erro).toMatchObject({ tipo: 'rede', recuperavel: true });
    expect(erro.cause).toBe(causa);
  });

  it('servidor que não responde: timeout (e o pedido é abortado)', async () => {
    const servidor = new ServidorFalso({ pacotes: [] });
    servidor.adicionarUsuario('jogador', 'senha');
    const c = new NpdevClient({ fetch: servidor.fetch, timeoutMs: 20 });
    await c.login('jogador', 'senha');
    servidor.travarProximas(1, ch => ch.caminho === '/queries/CenariosAtivos');
    const erro = await c.get('/queries/CenariosAtivos').catch(e => e);
    expect(erro).toMatchObject({ tipo: 'timeout', recuperavel: true });
  });

  it('200 com corpo que não é JSON (ex.: HTML de proxy/portal cativo) é resposta_invalida', async () => {
    const { c } = await logado({ status: 200, bruto: '<html>Bem-vindo ao Wi-Fi</html>' });
    await expect(c.get('/x')).rejects.toMatchObject({ tipo: 'resposta_invalida', status: 200 });
  });

  it('falha no meio da leitura do corpo também é `rede`', async () => {
    const fetchQuebrado: FetchLike = async url => url.endsWith('/login')
      ? { ok: true, status: 200, text: async () => JSON.stringify(SESSAO_OK.corpo) }
      : { ok: true, status: 200, text: async () => { throw new TypeError('terminated'); } };
    const c = new NpdevClient({ fetch: fetchQuebrado });
    await c.login('jogador', 'senha');
    await expect(c.get('/x')).rejects.toMatchObject({ tipo: 'rede' });
  });

  it('respeita a base configurada', async () => {
    const f = fetchRoteirizado({ status: 200, corpo: {} });
    const c = new NpdevClient({ fetch: f.fn, base: 'http://localhost:8200/api/' });
    await c.login('jogador', 'senha').catch(() => undefined);
    expect(f.chamadas[0].url).toBe('http://localhost:8200/api/auth/login');
  });
});

describe('erroDeResposta: classificação dos formatos do NPDev', () => {
  const flow = (error: string) => ({ status: 'FAILED', errorCode: 'system_exception', error, output: null });
  it('flow que estourou o timeout do plugin (acontece na 1ª chamada após subir o app) é recuperável, não recusa', () => {
    const e = erroDeResposta(422, flow('PLUGIN_EXECUTION_TIMEOUT: Sandboxed plugin execution timed out after 5000 ms'));
    expect(e).toMatchObject({ tipo: 'servidor', codigo: 'PLUGIN_EXECUTION_TIMEOUT', recuperavel: true });
  });
  it('flow com CONCEPT_NOT_FOUND (partida inexistente ou de outro jogador) → nao_encontrado', () => {
    const e = erroDeResposta(422, flow('CONCEPT_NOT_FOUND: Concept record not found: SimPartida:123'));
    expect(e).toMatchObject({ tipo: 'nao_encontrado', codigo: 'CONCEPT_NOT_FOUND', recuperavel: false });
    expect(e.message).toBe('Concept record not found: SimPartida:123');
  });
  it('ROW_SCOPE_DENIED e capability.invoke → proibido', () => {
    expect(erroDeResposta(403, { code: 'ROW_SCOPE_DENIED', message: 'negado' }).tipo).toBe('proibido');
    expect(erroDeResposta(422, flow('PERMISSION: capability.invoke required')).tipo).toBe('proibido');
  });
  it('transição de lifecycle e invariants → requisicao_invalida', () => {
    expect(erroDeResposta(422, flow('PROCEDURE_STEP_FAILED: Concept lifecycle transition is not allowed: Concluida -> Abandonada')).tipo).toBe('requisicao_invalida');
    expect(erroDeResposta(422, { code: 'bond_target_not_found', message: 'Referenced SimCenario was not found' }).tipo).toBe('requisicao_invalida');
  });
  it('corpo de texto puro e corpo ausente têm mensagem', () => {
    expect(erroDeResposta(502, 'Bad Gateway').message).toBe('Bad Gateway');
    expect(erroDeResposta(500, undefined).message).toBe('HTTP 500');
  });
});
