import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import { ArmazenamentoMemoria, CachePacotes } from '../net/cache';
import { remapearIds } from '../net/idsUuid';
import { NpdevClient } from '../net/npdevClient';
import { ServidorFalso } from '../net/servidorFalso';
import type { PacoteCenario } from '../sim/model';
import { FonteEmbutida } from './fonteEmbutida';
import { avisoDoPacote, FonteRede } from './fonteRede';

const embutidoA = whA as unknown as PacoteCenario;
/** O que o servidor tem: o mesmo WH-A, mas com UUIDs (como o banco real). */
const bancoA = remapearIds(embutidoA, 11).pacote;
/** Cenário que só existe no servidor (um admin criou depois do app ser empacotado). */
const soServidor: PacoteCenario = (() => {
  const p = remapearIds(embutidoA, 12).pacote;
  return { ...p, cenario: { ...p.cenario, codigo: 'F5-NOVO', nome: 'Cenário novo', dificuldade: 'Medio' } };
})();

const embutida = () => new FonteEmbutida({ 'WH-A-PEQUENO': () => import('../data/cenarios/WH-A-PEQUENO.json') });

async function montar(opcoes: { logado?: boolean; pacotes?: PacoteCenario[] } = {}) {
  const servidor = new ServidorFalso({ pacotes: opcoes.pacotes ?? [bancoA], usuarios: { ana: { senha: 's' } } });
  const cliente = new NpdevClient({ fetch: servidor.fetch });
  if (opcoes.logado !== false) await cliente.login('ana', 's');
  const armazenamento = new ArmazenamentoMemoria();
  const cache = new CachePacotes(armazenamento, () => new Date(2026, 10, 9, 14, 2));
  const fonte = new FonteRede({ http: cliente, cache, embutida: embutida() });
  const chamadasDeDados = () => servidor.chamadas.filter(c => c.caminho !== '/auth/login').length;
  return { servidor, cliente, cache, fonte, armazenamento, chamadasDeDados };
}

describe('listar', () => {
  it('logado: o cenário que o servidor tem aparece uma vez, com origem "rede", sem aviso', async () => {
    const { fonte } = await montar();
    const lista = await fonte.listar();
    expect(lista.map(c => [c.codigo, c.origem])).toEqual([['WH-A-PEQUENO', 'rede']]);
    expect(lista[0]).toMatchObject({ ordensTotal: 60, locais: 48 });
    expect(fonte.avisoDaLista()).toBeNull();
  });

  it('logado: cenário que só o servidor tem é baixado uma vez (para o cartão) e vai para o cache; ordenado por dificuldade', async () => {
    const { fonte, cache, servidor } = await montar({ pacotes: [bancoA, soServidor] });
    const lista = await fonte.listar();
    expect(lista.map(c => [c.codigo, c.origem])).toEqual([['WH-A-PEQUENO', 'rede'], ['F5-NOVO', 'rede']]); // Fácil antes de Médio
    expect(await cache.codigos()).toEqual(['F5-NOVO']);
    // na 2ª abertura o cartão sai do cache: não baixa o pacote de novo
    const antes = servidor.contar(c => c.caminho.includes('/page'));
    await fonte.listar();
    expect(servidor.contar(c => c.caminho.includes('/page'))).toBe(antes);
  });

  it('logado, mas o servidor está fora: lista o que há no aparelho (embutido) e avisa em "alerta"', async () => {
    const { fonte, servidor } = await montar();
    servidor.rede = false;
    const lista = await fonte.listar();
    expect(lista.map(c => [c.codigo, c.origem])).toEqual([['WH-A-PEQUENO', 'embutido']]);
    const aviso = fonte.avisoDaLista();
    expect(aviso?.tipo).toBe('alerta');
    expect(aviso?.texto).toMatch(/sem conexão com o servidor/i);
  });

  it('logado e sem rede, com cache de uma visita anterior: o cartão mostra "cache"', async () => {
    const { fonte, servidor } = await montar();
    await fonte.carregar('WH-A-PEQUENO'); // baixa e guarda
    servidor.rede = false;
    const lista = await fonte.listar();
    expect(lista.map(c => [c.codigo, c.origem])).toEqual([['WH-A-PEQUENO', 'cache']]);
    expect(fonte.avisoDaLista()?.tipo).toBe('alerta');
  });

  it('convidado: só embutido/cache, nenhuma chamada de rede, aviso informativo', async () => {
    const { fonte, chamadasDeDados } = await montar({ logado: false });
    const lista = await fonte.listar();
    expect(lista.map(c => [c.codigo, c.origem])).toEqual([['WH-A-PEQUENO', 'embutido']]);
    expect(chamadasDeDados()).toBe(0);
    expect(fonte.avisoDaLista()).toMatchObject({ tipo: 'info' });
    expect(fonte.avisoDaLista()?.texto).toMatch(/convidado/i);
  });

  it('convidado com cache de uma sessão anterior: usa o cache (e o cenário só-servidor aparece)', async () => {
    const logado = await montar({ pacotes: [bancoA, soServidor] });
    await logado.fonte.carregar('WH-A-PEQUENO');
    await logado.fonte.carregar('F5-NOVO');
    const convidado = new FonteRede({ http: new NpdevClient({ fetch: logado.servidor.fetch }), cache: logado.cache, embutida: embutida() });
    const antes = logado.servidor.chamadas.length;
    const lista = await convidado.listar();
    expect(lista.map(c => [c.codigo, c.origem])).toEqual([['WH-A-PEQUENO', 'cache'], ['F5-NOVO', 'cache']]);
    expect(logado.servidor.chamadas).toHaveLength(antes);
  });

  it('cenário embutido que o servidor não lista continua jogável offline, com origem "embutido"', async () => {
    const { fonte } = await montar({ pacotes: [soServidor] });
    const lista = await fonte.listar();
    expect(lista.map(c => [c.codigo, c.origem]).sort()).toEqual([['F5-NOVO', 'rede'], ['WH-A-PEQUENO', 'embutido']]);
  });

  it('sem nenhum cenário utilizável: rejeita com mensagem (a tela mostra o erro)', async () => {
    const servidor = new ServidorFalso({ pacotes: [bancoA] });
    const vazia = { codigos: () => [], pacoteOuNada: async () => undefined };
    const fonte = new FonteRede({ http: new NpdevClient({ fetch: servidor.fetch }), cache: null, embutida: vazia });
    await expect(fonte.listar()).rejects.toThrow(/convidado|cenário/i);
  });
});

describe('carregar', () => {
  it('logado: baixa do servidor (origem "rede", ids do banco) e grava no cache', async () => {
    const { fonte, cache } = await montar();
    const c = await fonte.carregar('WH-A-PEQUENO');
    expect(c.origem).toBe('rede');
    expect(c.pacote.cenario.id).toBe(bancoA.cenario.id);
    expect(c.aviso).toBeUndefined();
    expect(c.salvoEm).toBe(new Date(2026, 10, 9, 14, 2).toISOString());
    expect((await cache.ler('WH-A-PEQUENO'))?.pacote.cenario.id).toBe(bancoA.cenario.id);
  });

  it('a rede cai depois do login: usa o cache e diz de quando é', async () => {
    const { fonte, servidor } = await montar();
    await fonte.carregar('WH-A-PEQUENO');
    servidor.rede = false;
    const c = await fonte.carregar('WH-A-PEQUENO');
    expect(c.origem).toBe('cache');
    expect(c.aviso).toMatch(/sem conexão com o servidor/i);
    expect(c.aviso).toMatch(/09\/11 14:02/);
  });

  it('a rede cai e não há cache: cai para o embutido, dizendo isso', async () => {
    const { fonte, servidor } = await montar();
    servidor.rede = false;
    const c = await fonte.carregar('WH-A-PEQUENO');
    expect(c.origem).toBe('embutido');
    expect(c.pacote.cenario.id).toBe(embutidoA.cenario.id); // alias do seed: a partida só vai ao servidor pela fila
    expect(c.aviso).toMatch(/embutido/i);
  });

  it('convidado: embutido e zero chamadas, sem aviso (é o esperado)', async () => {
    const { fonte, chamadasDeDados } = await montar({ logado: false });
    const c = await fonte.carregar('WH-A-PEQUENO');
    expect(c).toMatchObject({ origem: 'embutido' });
    expect(c.aviso).toBeUndefined();
    expect(chamadasDeDados()).toBe(0);
  });

  it('código que ninguém tem: erro legível (indisponivel)', async () => {
    const { fonte } = await montar();
    await expect(fonte.carregar('NAO-EXISTE')).rejects.toMatchObject({ tipo: 'indisponivel' });
  });

  it('falha do servidor (500) com sessão: mesmo caminho do cache/embutido, mencionando o servidor', async () => {
    const { fonte, servidor } = await montar();
    servidor.falharProximas(99, { status: 500, corpo: { error: 'Internal Server Error' } }, c => c.caminho.startsWith('/queries'));
    const c = await fonte.carregar('WH-A-PEQUENO');
    expect(c.origem).toBe('embutido');
    expect(c.aviso).toMatch(/servidor falhou/i);
  });
});

describe('avisoDoPacote', () => {
  it('sem falha de rede e sem avisos: nada a dizer', () => {
    expect(avisoDoPacote({ pacote: bancoA, origem: 'rede', salvoEm: null, falhaRede: null, avisos: [] })).toBeUndefined();
  });

  it('cache não atualizado vira aviso mesmo com a rede boa', () => {
    expect(avisoDoPacote({ pacote: bancoA, origem: 'rede', salvoEm: null, falhaRede: null, avisos: ['Cache não atualizado: cota cheia'] })).toMatch(/cota cheia/);
  });
});
