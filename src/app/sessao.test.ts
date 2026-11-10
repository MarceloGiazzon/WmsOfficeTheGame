import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { PacoteCenario } from '../sim/model';
import { remapearIds } from '../net/idsUuid';
import { NpdevClient } from '../net/npdevClient';
import { ServidorFalso } from '../net/servidorFalso';
import { ControladorSessao, type ArmazenamentoSimples, type EventoSessao } from './sessao';

const banco = remapearIds(whA as unknown as PacoteCenario, 1).pacote;

/** Storage falso; `quebrado` faz toda operação lançar (janela privada, cota, cookies bloqueados). */
function storage(quebrado = false): ArmazenamentoSimples & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  const falha = () => { if (quebrado) throw new DOMException('bloqueado', 'SecurityError'); };
  return {
    dados,
    getItem: k => { falha(); return dados.get(k) ?? null; },
    setItem: (k, v) => { falha(); dados.set(k, v); },
    removeItem: k => { falha(); dados.delete(k); },
  };
}

function montar(opcoes: { relogio?: { t: number }; session?: ArmazenamentoSimples | null; local?: ArmazenamentoSimples | null } = {}) {
  const relogio = opcoes.relogio ?? { t: Date.parse('2026-11-10T08:00:00Z') };
  const servidor = new ServidorFalso({ pacotes: [banco], usuarios: { ana: { senha: 's' }, bia: { senha: 's' } }, agora: () => relogio.t });
  let controlador!: ControladorSessao;
  const cliente = new NpdevClient({ fetch: servidor.fetch, agora: () => relogio.t, aoSessaoExpirar: () => controlador.aoExpirar() });
  const agendados: { fn: () => void; ms: number; cancelado: boolean }[] = [];
  const session = opcoes.session === undefined ? storage() : opcoes.session;
  const local = opcoes.local === undefined ? storage() : opcoes.local;
  controlador = new ControladorSessao(cliente, {
    sessionStorage: session, localStorage: local, agora: () => relogio.t,
    agendar: (fn, ms) => { const a = { fn, ms, cancelado: false }; agendados.push(a); return () => { a.cancelado = true; }; },
  });
  const eventos: { estado: ReturnType<ControladorSessao['estado']['valueOf']>; evento: EventoSessao }[] = [];
  controlador.observar((estado, evento) => eventos.push({ estado, evento }));
  return { servidor, cliente, controlador, relogio, agendados, session, local, eventos };
}

describe('login', () => {
  it('entra, vira logado com o username do token, guarda a sessão na aba e o último usuário', async () => {
    const { controlador, cliente, session, eventos } = montar();
    await controlador.entrar('ana', 's');
    expect(controlador.estado).toEqual({ modo: 'logado', usuario: 'ana', escolheu: true });
    expect(cliente.logado).toBe(true);
    expect(eventos.map(e => e.evento)).toEqual(['entrou']);
    expect((session as ReturnType<typeof storage>).dados.get('wmsgame:sessao')).toContain('"username":"ana"');
    expect(controlador.ultimoUsuario).toBe('ana');
  });

  it('senha errada: NpdevError nao_autenticado, continua convidado e nada é guardado', async () => {
    const { controlador, session } = montar();
    await expect(controlador.entrar('ana', 'errada')).rejects.toMatchObject({ tipo: 'nao_autenticado' });
    expect(controlador.estado.modo).toBe('convidado');
    expect((session as ReturnType<typeof storage>).dados.size).toBe(0);
  });

  it('rede caída: NpdevError rede, continua convidado', async () => {
    const { controlador, servidor } = montar();
    servidor.rede = false;
    await expect(controlador.entrar('ana', 's')).rejects.toMatchObject({ tipo: 'rede' });
    expect(controlador.estado.modo).toBe('convidado');
  });

  it('servidor com 500: NpdevError servidor', async () => {
    const { controlador, servidor } = montar();
    servidor.falharProximas(1, { status: 500, corpo: { error: 'Internal Server Error' } });
    await expect(controlador.entrar('ana', 's')).rejects.toMatchObject({ tipo: 'servidor' });
  });

  it('campos vazios: erro explícito, sem chamar a rede', async () => {
    const { controlador, servidor } = montar();
    await expect(controlador.entrar('  ', 's')).rejects.toMatchObject({ tipo: 'requisicao_invalida' });
    expect(servidor.chamadas).toHaveLength(0);
  });
});

describe('convidado = offline', () => {
  it('escolher convidado não faz nenhuma chamada de rede e lembra a escolha na aba', () => {
    const { controlador, servidor, eventos } = montar();
    controlador.escolherConvidado();
    expect(controlador.estado).toEqual({ modo: 'convidado', usuario: null, escolheu: true });
    expect(servidor.chamadas).toHaveLength(0);
    expect(eventos.map(e => e.evento)).toEqual(['convidado']);
  });

  it('um controlador novo na mesma aba (F5) sabe que já escolheu convidado', () => {
    const { controlador, session } = montar();
    controlador.escolherConvidado();
    const outro = new ControladorSessao(new NpdevClient({}), { sessionStorage: session, localStorage: null });
    expect(outro.estado.escolheu).toBe(true);
    expect(outro.estado.modo).toBe('convidado');
  });

  it('abertura sem sessão guardada e sem escolha: ainda não escolheu (a UI oferece o login)', () => {
    const { controlador } = montar();
    expect(controlador.estado).toEqual({ modo: 'convidado', usuario: null, escolheu: false });
    expect(controlador.restaurar()).toBe(false);
  });
});

describe('restaurar entre recargas', () => {
  it('F5: a sessão da aba volta, sem nova chamada de login', async () => {
    const a = montar();
    await a.controlador.entrar('ana', 's');
    const chamadasDoLogin = a.servidor.chamadas.length;
    // "página nova": cliente e controlador novos, mesmo sessionStorage e mesmo relógio
    const cliente2 = new NpdevClient({ fetch: a.servidor.fetch, agora: () => a.relogio.t });
    const c2 = new ControladorSessao(cliente2, { sessionStorage: a.session, localStorage: a.local, agora: () => a.relogio.t, agendar: () => () => undefined });
    expect(c2.restaurar()).toBe(true);
    expect(c2.estado).toEqual({ modo: 'logado', usuario: 'ana', escolheu: true });
    expect(cliente2.logado).toBe(true);
    expect(a.servidor.chamadas).toHaveLength(chamadasDoLogin);
  });

  describe('validarNoServidor (depois de restaurar)', () => {
    /** "Página nova" com o mesmo storage e servidor; `aoSessaoExpirar` ligado como no app. */
    function paginaNova(a: ReturnType<typeof montar>) {
      let c2!: ControladorSessao;
      const cliente2 = new NpdevClient({ fetch: a.servidor.fetch, agora: () => a.relogio.t, aoSessaoExpirar: () => c2.aoExpirar() });
      c2 = new ControladorSessao(cliente2, { sessionStorage: a.session, localStorage: a.local, agora: () => a.relogio.t, agendar: () => () => undefined });
      const eventos: EventoSessao[] = [];
      c2.observar((_e, ev) => eventos.push(ev));
      return { c2, cliente2, eventos };
    }
    const chamadasMe = (a: ReturnType<typeof montar>) => a.servidor.contar(c => c.caminho === '/auth/me');

    it('o servidor aceita o token: confirma e segue logado', async () => {
      const a = montar();
      await a.controlador.entrar('ana', 's');
      const { c2, eventos } = paginaNova(a);
      expect(c2.restaurar()).toBe(true);
      expect(await c2.validarNoServidor()).toBe(true);
      expect(c2.estado.modo).toBe('logado');
      expect(chamadasMe(a)).toBe(1);
      expect(eventos).toEqual(['restaurada']);
    });

    it('o servidor recusa o token (401): vira convidado AGORA, com o evento `expirou`, e esquece a sessão guardada', async () => {
      const a = montar();
      await a.controlador.entrar('ana', 's');
      // o que ficou guardado na aba deixou de valer no servidor (chave trocada, usuário removido…)
      (a.session as ReturnType<typeof storage>).dados.set('wmsgame:sessao', JSON.stringify({ token: 'lixo.lixo.lixo', username: 'ana', roles: [], expiraEmMs: null }));
      const { c2, cliente2, eventos } = paginaNova(a);
      expect(c2.restaurar()).toBe(true);
      expect(await c2.validarNoServidor()).toBe(false);
      expect(c2.estado).toEqual({ modo: 'convidado', usuario: null, escolheu: true });
      expect(cliente2.logado).toBe(false);
      expect(eventos).toEqual(['restaurada', 'expirou']);
      expect((a.session as ReturnType<typeof storage>).dados.has('wmsgame:sessao')).toBe(false);
    });

    it('sem conexão não derruba a sessão: jogar offline é normal (resultado "não sei")', async () => {
      const a = montar();
      await a.controlador.entrar('ana', 's');
      const { c2, cliente2 } = paginaNova(a);
      c2.restaurar();
      a.servidor.rede = false;
      expect(await c2.validarNoServidor()).toBeNull();
      expect(c2.estado.modo).toBe('logado');
      expect(cliente2.logado).toBe(true);
    });

    it('servidor com erro 500 também não derruba', async () => {
      const a = montar();
      await a.controlador.entrar('ana', 's');
      const { c2 } = paginaNova(a);
      c2.restaurar();
      a.servidor.falharProximas(1, { status: 500, corpo: { error: 'Internal Server Error' } }, c => c.caminho === '/auth/me');
      expect(await c2.validarNoServidor()).toBeNull();
      expect(c2.estado.modo).toBe('logado');
    });

    it('convidado: não chama o servidor', async () => {
      const a = montar();
      expect(await a.controlador.validarNoServidor()).toBe(false);
      expect(chamadasMe(a)).toBe(0);
    });
  });

  it('token vencido na volta: não restaura e esquece o que estava guardado', async () => {
    const a = montar();
    await a.controlador.entrar('ana', 's');
    a.relogio.t += 9 * 3600 * 1000; // o token vale 8 h
    const c2 = new ControladorSessao(new NpdevClient({ agora: () => a.relogio.t }), { sessionStorage: a.session, localStorage: null, agora: () => a.relogio.t });
    expect(c2.restaurar()).toBe(false);
    expect((a.session as ReturnType<typeof storage>).dados.has('wmsgame:sessao')).toBe(false);
    expect(c2.estado.modo).toBe('convidado');
  });

  it('JSON corrompido no armazenamento é ignorado', () => {
    const s = storage();
    s.setItem('wmsgame:sessao', '{nao é json');
    const c = new ControladorSessao(new NpdevClient({}), { sessionStorage: s, localStorage: null });
    expect(c.restaurar()).toBe(false);
    s.setItem('wmsgame:sessao', JSON.stringify({ token: 1 }));
    expect(c.restaurar()).toBe(false);
  });

  it('sessionStorage que LANÇA em tudo (janela privada): login e jogo funcionam, só não restaura', async () => {
    const { controlador, cliente } = montar({ session: storage(true), local: storage(true) });
    expect(controlador.restaurar()).toBe(false);
    await controlador.entrar('ana', 's');
    expect(cliente.logado).toBe(true);
    expect(controlador.estado.modo).toBe('logado');
    controlador.sair();
    expect(controlador.estado.modo).toBe('convidado');
    expect(controlador.ultimoUsuario).toBeNull();
  });

  it('sem armazenamento algum (null): idem', async () => {
    const { controlador } = montar({ session: null, local: null });
    await controlador.entrar('ana', 's');
    expect(controlador.estado.usuario).toBe('ana');
  });
});

describe('sair', () => {
  it('volta a convidado, derruba o token, esquece a sessão guardada e não chama o servidor', async () => {
    const { controlador, cliente, servidor, session } = montar();
    await controlador.entrar('ana', 's');
    const chamadas = servidor.chamadas.length;
    controlador.sair();
    expect(controlador.estado).toEqual({ modo: 'convidado', usuario: null, escolheu: true });
    expect(cliente.logado).toBe(false);
    expect((session as ReturnType<typeof storage>).dados.has('wmsgame:sessao')).toBe(false);
    expect(servidor.chamadas).toHaveLength(chamadas);
  });

  it('trocar de usuário: sair e entrar como outro', async () => {
    const { controlador } = montar();
    await controlador.entrar('ana', 's');
    controlador.sair();
    await controlador.entrar('bia', 's');
    expect(controlador.estado.usuario).toBe('bia');
  });
});

describe('expiração', () => {
  it('401 numa chamada autenticada: volta a convidado com o evento "expirou"', async () => {
    const { controlador, cliente, servidor, eventos } = montar();
    await controlador.entrar('ana', 's');
    servidor.revogarTokens(); // o servidor reiniciou com outra chave
    await expect(cliente.get('/queries/CenariosAtivos')).rejects.toMatchObject({ tipo: 'nao_autenticado' });
    expect(controlador.estado.modo).toBe('convidado');
    expect(eventos.map(e => e.evento)).toEqual(['entrou', 'expirou']);
  });

  it('token vencido pelo relógio: o temporizador percebe sem esperar uma chamada falhar', async () => {
    const { controlador, relogio, agendados, eventos } = montar();
    await controlador.entrar('ana', 's');
    expect(agendados).toHaveLength(1);
    // 8 h de token − 30 s de folga (+ 500 ms de margem do controlador)
    expect(agendados[0].ms).toBe(8 * 3600 * 1000 - 30_000 + 500);
    relogio.t += agendados[0].ms;
    agendados[0].fn();
    expect(controlador.estado.modo).toBe('convidado');
    expect(eventos.map(e => e.evento)).toEqual(['entrou', 'expirou']);
  });

  it('temporizador adiantado (token ainda vale): reagenda em vez de derrubar', async () => {
    const { controlador, agendados } = montar();
    await controlador.entrar('ana', 's');
    agendados[0].fn(); // dispara cedo demais: o relógio não andou
    expect(controlador.estado.modo).toBe('logado');
    expect(agendados).toHaveLength(2);
    expect(agendados[1].ms).toBeGreaterThan(0);
  });

  it('sair cancela o temporizador; "expirou" depois de convidado não faz nada', async () => {
    const { controlador, agendados, eventos } = montar();
    await controlador.entrar('ana', 's');
    controlador.sair();
    expect(agendados[0].cancelado).toBe(true);
    controlador.aoExpirar();
    expect(eventos.map(e => e.evento)).toEqual(['entrou', 'saiu']);
  });

  it('um ouvinte que lança não impede os outros nem a transição', async () => {
    const { controlador } = montar();
    controlador.observar(() => { throw new Error('bug da UI'); });
    let chamado = 0;
    controlador.observar(() => { chamado++; });
    await controlador.entrar('ana', 's');
    expect(chamado).toBe(1);
    expect(controlador.estado.modo).toBe('logado');
  });
});
