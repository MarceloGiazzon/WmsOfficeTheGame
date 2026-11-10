import { beforeEach, describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { PacoteCenario } from '../sim/model';
import {
  ArmazenamentoIndexedDb, ArmazenamentoMemoria, assinarPacote, CachePacotes, criarArmazenamentoPadrao, ErroArmazenamento,
  FORMATO_CACHE, obterPacote, type ArmazenamentoJson,
} from './cache';
import { remapearIds } from './idsUuid';
import { NpdevClient } from './npdevClient';
import { diferencasDePacote } from './pacoteEquivalencia';
import { ServidorFalso } from './servidorFalso';

const embutido = whA as unknown as PacoteCenario;
const doBanco = remapearIds(embutido, 7).pacote;

// ---- IndexedDB falso: só o que ArmazenamentoIndexedDb usa, com a assincronia e os eventos do real ----------------------

function idbFalso(opcoes: { abortarEscrita?: boolean; falharAoAbrir?: boolean } = {}) {
  const bancos = new Map<string, Map<string, unknown>>();
  const fabrica = {
    open(nome: string) {
      const req: Record<string, unknown> = { result: undefined, error: null };
      setTimeout(() => {
        if (opcoes.falharAoAbrir) { req.error = new Error('SecurityError'); (req.onerror as () => void)?.(); return; }
        const novo = !bancos.has(nome);
        if (novo) bancos.set(nome, new Map());
        const dados = bancos.get(nome)!;
        const stores = new Set<string>(novo ? [] : ['kv']);
        const db = {
          objectStoreNames: { contains: (n: string) => stores.has(n) },
          createObjectStore: (n: string) => { stores.add(n); },
          close: () => undefined,
          transaction(_store: string, modo: string) {
            const tx: Record<string, unknown> = { error: null };
            const pedido = <T>(fn: () => T) => {
              const r: Record<string, unknown> = { result: undefined };
              if (modo === 'readwrite' && opcoes.abortarEscrita) {
                setTimeout(() => { tx.error = new Error('QuotaExceededError'); (tx.onabort as () => void)?.(); }, 0);
                return r;
              }
              r.result = fn();
              setTimeout(() => { (r.onsuccess as (() => void) | undefined)?.(); (tx.oncomplete as () => void)?.(); }, 0);
              return r;
            };
            tx.objectStore = () => ({
              get: (k: string) => pedido(() => (dados.has(k) ? structuredClone(dados.get(k)) : undefined)),
              put: (v: unknown, k: string) => pedido(() => { dados.set(k, structuredClone(v)); return k; }),
              delete: (k: string) => pedido(() => { dados.delete(k); }),
              getAllKeys: () => pedido(() => [...dados.keys()]),
            });
            return tx;
          },
        };
        req.result = db;
        (req.onupgradeneeded as () => void)?.();
        (req.onsuccess as () => void)?.();
      }, 0);
      return req;
    },
  };
  return fabrica as unknown as IDBFactory;
}

function contratoDeArmazenamento(nome: string, criar: () => ArmazenamentoJson) {
  describe(`${nome}: contrato chave → JSON`, () => {
    let a: ArmazenamentoJson;
    beforeEach(() => { a = criar(); });

    it('grava, lê, substitui e remove; chave ausente é undefined', async () => {
      expect(await a.ler('x')).toBeUndefined();
      await a.gravar('x', { n: 1, lista: [1, 2] });
      expect(await a.ler('x')).toEqual({ n: 1, lista: [1, 2] });
      await a.gravar('x', { n: 2 });
      expect(await a.ler('x')).toEqual({ n: 2 });
      await a.remover('x');
      expect(await a.ler('x')).toBeUndefined();
      await a.remover('x'); // remover o que não existe não é erro
    });

    it('chaves por prefixo, em ordem', async () => {
      await a.gravar('pacote:B', 1); await a.gravar('pacote:A', 2); await a.gravar('fila:1', 3);
      expect(await a.chaves('pacote:')).toEqual(['pacote:A', 'pacote:B']);
      expect(await a.chaves()).toEqual(['fila:1', 'pacote:A', 'pacote:B']);
    });

    it('guarda cópia: mexer no objeto depois de gravar não altera o guardado, nem o lido', async () => {
      const o = { v: [1] };
      await a.gravar('k', o);
      o.v.push(2);
      const lido = (await a.ler('k')) as typeof o;
      lido.v.push(3);
      expect(await a.ler('k')).toEqual({ v: [1] });
    });
  });
}

contratoDeArmazenamento('ArmazenamentoMemoria', () => new ArmazenamentoMemoria());
contratoDeArmazenamento('ArmazenamentoIndexedDb (IDB falso)', () => new ArmazenamentoIndexedDb({ fabrica: idbFalso() }));

describe('ArmazenamentoIndexedDb: falhas viram ErroArmazenamento', () => {
  it('banco que não abre (janela privada, bloqueio)', async () => {
    const a = new ArmazenamentoIndexedDb({ fabrica: idbFalso({ falharAoAbrir: true }) });
    await expect(a.ler('x')).rejects.toBeInstanceOf(ErroArmazenamento);
    await expect(a.gravar('x', 1)).rejects.toBeInstanceOf(ErroArmazenamento);
  });

  it('escrita abortada (cota cheia)', async () => {
    const a = new ArmazenamentoIndexedDb({ fabrica: idbFalso({ abortarEscrita: true }) });
    await expect(a.gravar('x', 1)).rejects.toMatchObject({ name: 'ErroArmazenamento' });
  });

  it('sem IndexedDB no ambiente: `disponivel` é falso e o armazenamento padrão cai para memória', async () => {
    expect(ArmazenamentoIndexedDb.disponivel(undefined)).toBe(false);
    expect(criarArmazenamentoPadrao()).toBeInstanceOf(ArmazenamentoMemoria); // vitest roda em Node: sem indexedDB
  });
});

describe('CachePacotes', () => {
  it('guarda o pacote por código, com data e assinatura; lê de volta igual', async () => {
    const cache = new CachePacotes(new ArmazenamentoMemoria(), () => new Date('2026-11-10T12:00:00Z'));
    const gravada = await cache.gravar(doBanco);
    expect(gravada).toMatchObject({ formato: FORMATO_CACHE, codigo: 'WH-A-PEQUENO', salvoEm: '2026-11-10T12:00:00.000Z' });
    const lida = await cache.ler('WH-A-PEQUENO');
    expect(lida?.assinatura).toBe(assinarPacote(doBanco));
    expect(diferencasDePacote(embutido, lida!.pacote)).toEqual([]);
    expect(await cache.codigos()).toEqual(['WH-A-PEQUENO']);
    await cache.remover('WH-A-PEQUENO');
    expect(await cache.ler('WH-A-PEQUENO')).toBeNull();
  });

  it('a assinatura muda quando o conteúdo muda (e só então)', () => {
    const outro = structuredClone(doBanco);
    expect(assinarPacote(outro)).toBe(assinarPacote(doBanco));
    outro.ordens[0].quantidadePaletes += 1;
    expect(assinarPacote(outro)).not.toBe(assinarPacote(doBanco));
  });

  it('cache ruim vira "sem cache": formato antigo, código trocado, pacote inválido, lixo, armazenamento quebrado', async () => {
    const arm = new ArmazenamentoMemoria();
    const cache = new CachePacotes(arm);
    const boa = await cache.gravar(doBanco);
    for (const estragada of [
      { ...boa, formato: FORMATO_CACHE + 1 },
      { ...boa, codigo: 'OUTRO' },
      { ...boa, pacote: { ...boa.pacote, locais: [] } },
      { ...boa, assinatura: 42 },
      'texto', 42, null,
    ]) {
      await arm.gravar('pacote:WH-A-PEQUENO', estragada);
      expect(await cache.ler('WH-A-PEQUENO')).toBeNull();
    }
    const quebrado: ArmazenamentoJson = { ...arm, ler: async () => { throw new ErroArmazenamento('disco cheio'); }, gravar: arm.gravar.bind(arm), remover: arm.remover.bind(arm), chaves: async () => { throw new Error('x'); } };
    expect(await new CachePacotes(quebrado).ler('WH-A-PEQUENO')).toBeNull();
    expect(await new CachePacotes(quebrado).codigos()).toEqual([]);
  });
});

describe('obterPacote: rede → cache → embutido', () => {
  const embutidoFn = (codigo: string) => (codigo === 'WH-A-PEQUENO' ? embutido : undefined);

  async function montar() {
    const servidor = new ServidorFalso({ pacotes: [doBanco] });
    const cliente = new NpdevClient({ fetch: servidor.fetch });
    const cache = new CachePacotes(new ArmazenamentoMemoria(), () => new Date('2026-11-10T12:00:00Z'));
    return { servidor, cliente, cache };
  }

  it('logado e com rede: baixa, devolve origem `rede` e atualiza o cache', async () => {
    const { cliente, cache } = await montar();
    await cliente.login('jogador', 'senha-certa');
    const r = await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn });
    expect(r).toMatchObject({ origem: 'rede', salvoEm: '2026-11-10T12:00:00.000Z', falhaRede: null, avisos: [] });
    expect(r.pacote.cenario.id).toBe(doBanco.cenario.id); // UUID do servidor, não o alias do embutido
    expect((await cache.ler('WH-A-PEQUENO'))?.pacote.cenario.id).toBe(doBanco.cenario.id);
  });

  it('rede cai: usa o cache (origem `cache`) e diz por que a rede falhou; voltou a rede: `rede` de novo', async () => {
    const { servidor, cliente, cache } = await montar();
    await cliente.login('jogador', 'senha-certa');
    await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn });

    servidor.rede = false;
    const offline = await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn });
    expect(offline).toMatchObject({ origem: 'cache', salvoEm: '2026-11-10T12:00:00.000Z' });
    expect(offline.falhaRede).toMatchObject({ tipo: 'rede' });
    expect(offline.pacote.cenario.id).toBe(doBanco.cenario.id);

    servidor.rede = true;
    expect((await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn })).origem).toBe('rede');
  });

  it('sem cache e sem rede: cai para o pacote embutido (origem `embutido`)', async () => {
    const { servidor, cliente, cache } = await montar();
    await cliente.login('jogador', 'senha-certa');
    servidor.rede = false;
    const r = await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn });
    expect(r).toMatchObject({ origem: 'embutido', salvoEm: null });
    expect(r.pacote).toBe(embutido);
    expect(r.falhaRede?.tipo).toBe('rede');
  });

  it('convidado: nenhuma chamada de rede; cache se houver, senão embutido (que pode ser assíncrono, como o import() do WH-B)', async () => {
    const { servidor, cliente, cache } = await montar();
    const semCache = await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: async c => embutidoFn(c) });
    expect(semCache).toMatchObject({ origem: 'embutido', falhaRede: null });
    await cache.gravar(doBanco);
    expect((await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn })).origem).toBe('cache');
    expect(servidor.chamadas).toHaveLength(0);
  });

  it('sessão vencida no servidor (401): usa o cache e avisa com falhaRede nao_autenticado', async () => {
    const { servidor, cliente, cache } = await montar();
    await cliente.login('jogador', 'senha-certa');
    await cache.gravar(doBanco);
    servidor.revogarTokens();
    const r = await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn });
    expect(r.origem).toBe('cache');
    expect(r.falhaRede).toMatchObject({ tipo: 'nao_autenticado' });
  });

  it('servidor devolvendo lixo também cai no cache (não explode)', async () => {
    const { servidor, cliente, cache } = await montar();
    await cliente.login('jogador', 'senha-certa');
    await cache.gravar(doBanco);
    servidor.falharProximas(1, { status: 200, textoBruto: '<html>portal</html>' }, c => c.caminho === '/queries/CenariosAtivos');
    const r = await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn });
    expect(r).toMatchObject({ origem: 'cache' });
    expect(r.falhaRede).toMatchObject({ tipo: 'resposta_invalida' });
  });

  it('cache corrompido + sem rede → embutido', async () => {
    const { servidor, cliente } = await montar();
    const arm = new ArmazenamentoMemoria();
    await arm.gravar('pacote:WH-A-PEQUENO', { formato: 99 });
    await cliente.login('jogador', 'senha-certa');
    servidor.rede = false;
    expect((await obterPacote('WH-A-PEQUENO', { http: cliente, cache: new CachePacotes(arm), embutido: embutidoFn })).origem).toBe('embutido');
  });

  it('cache que não grava não impede jogar: origem `rede` com aviso', async () => {
    const { cliente } = await montar();
    await cliente.login('jogador', 'senha-certa');
    const arm = new ArmazenamentoMemoria();
    arm.gravar = async () => { throw new ErroArmazenamento('cota cheia'); };
    const r = await obterPacote('WH-A-PEQUENO', { http: cliente, cache: new CachePacotes(arm), embutido: embutidoFn });
    expect(r.origem).toBe('rede');
    expect(r.avisos[0]).toContain('cota cheia');
  });

  it('nada em lugar nenhum: indisponivel, com o motivo da rede', async () => {
    const { servidor, cliente, cache } = await montar();
    await cliente.login('jogador', 'senha-certa');
    servidor.rede = false;
    const erro = await obterPacote('WH-B-MEGA', { http: cliente, cache, embutido: embutidoFn }).catch(e => e);
    expect(erro).toMatchObject({ tipo: 'indisponivel', recuperavel: false });
    expect(erro.message).toContain('rede falhou');
    const convidado = new NpdevClient({ fetch: servidor.fetch });
    await expect(obterPacote('WH-B-MEGA', { http: convidado })).rejects.toMatchObject({ tipo: 'indisponivel' });
  });

  it('cenário que sumiu do servidor (nao_encontrado) mas está no cache: segue jogável, com o motivo em falhaRede', async () => {
    const servidor = new ServidorFalso({ pacotes: [] }); // nenhum cenário ativo
    servidor.adicionarUsuario('jogador', 'senha-certa');
    const cliente = new NpdevClient({ fetch: servidor.fetch });
    await cliente.login('jogador', 'senha-certa');
    const cache = new CachePacotes(new ArmazenamentoMemoria());
    await cache.gravar(doBanco);
    const r = await obterPacote('WH-A-PEQUENO', { http: cliente, cache, embutido: embutidoFn });
    expect(r.origem).toBe('cache');
    expect(r.falhaRede).toMatchObject({ tipo: 'nao_encontrado' });
  });
});
