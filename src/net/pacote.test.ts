import { beforeAll, describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import type { PacoteCenario } from '../sim/model';
import { ehNpdevError } from './erros';
import { remapearIds } from './idsUuid';
import { NpdevClient } from './npdevClient';
import { buscarCenario, carregarPacote, listarCenarios, validarPacote } from './pacote';
import { diferencasDePacote } from './pacoteEquivalencia';
import { ServidorFalso, type OpcoesServidorFalso } from './servidorFalso';

const embutidoA = whA as unknown as PacoteCenario;
const embutidoB = whB as unknown as PacoteCenario;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// O "banco" do servidor falso: os dois cenários, com UUIDs no lugar dos aliases do seed.
const doBanco = { A: remapearIds(embutidoA, 1).pacote, B: remapearIds(embutidoB, 2).pacote };

async function clienteLogado(opcoes: Partial<OpcoesServidorFalso> = {}) {
  const servidor = new ServidorFalso({ pacotes: [doBanco.A, doBanco.B], ...opcoes });
  const cliente = new NpdevClient({ fetch: servidor.fetch });
  await cliente.login('jogador', 'senha-certa');
  return { servidor, cliente };
}

describe('carregarPacote: o pacote do REST é o embutido (com UUIDs)', () => {
  let rodado: Awaited<ReturnType<typeof clienteLogado>>;
  let pacoteA: PacoteCenario;
  beforeAll(async () => {
    rodado = await clienteLogado();
    pacoteA = await carregarPacote(rodado.cliente, 'WH-A-PEQUENO');
  });

  it('WH-A: mesmos campos, tipos, topologia, estoque de produtos e ordens do pacote embutido', () => {
    expect(diferencasDePacote(embutidoA, pacoteA)).toEqual([]);
    expect(pacoteA.locais).toHaveLength(52);
    expect(pacoteA.ordens).toHaveLength(60);
  });

  it('os ids são os do servidor (UUIDs), não os aliases do seed', () => {
    for (const id of [pacoteA.cenario.id, pacoteA.armazem.id, pacoteA.areas[0].id, pacoteA.ruas[0].id, pacoteA.locais[0].id, pacoteA.produtos[0].id, pacoteA.ordens[0].id]) {
      expect(id).toMatch(UUID);
    }
    expect(pacoteA.cenario.armazemId).toBe(pacoteA.armazem.id);
  });

  it('só os campos do modelo: version, tenantId, ativo e afins ficam de fora', () => {
    expect(Object.keys(pacoteA.cenario).sort()).toEqual(Object.keys(embutidoA.cenario).sort());
    expect(Object.keys(pacoteA.locais[0]).sort()).toEqual(Object.keys(embutidoA.locais[0]).sort());
    expect(Object.keys(pacoteA.ruas[0]).sort()).toEqual(Object.keys(embutidoA.ruas[0]).sort());
    expect(Object.keys(pacoteA.produtos[0]).sort()).toEqual(Object.keys(embutidoA.produtos[0]).sort());
    expect(Object.keys(pacoteA.ordens[0]).sort()).toEqual(Object.keys(embutidoA.ordens[0]).sort());
  });

  it('não traz nada do outro cenário (o REST não filtra por armazém: o cliente filtra)', () => {
    const idsB = new Set([...doBanco.B.ruas, ...doBanco.B.produtos, ...doBanco.B.locais].map(x => x.id));
    expect([...pacoteA.ruas, ...pacoteA.produtos, ...pacoteA.locais].some(x => idsB.has(x.id))).toBe(false);
  });

  it('inclui produtos que não têm nenhuma ordem (vêm pelo perfil de alocação das ruas)', () => {
    const comOrdem = new Set(pacoteA.ordens.map(o => o.produtoId));
    expect(pacoteA.produtos.filter(p => !comOrdem.has(p.id))).toHaveLength(4); // WHAprod08/10/11/12
  });

  it('ordem canônica: ruas por código, locais por rua/posição/andar, ordens por liberação — igual à do embutido', () => {
    const codigo = new Map(pacoteA.ruas.map(r => [r.id, r.codigo]));
    const chave = (p: PacoteCenario, l: PacoteCenario['locais'][number]) => `${p.ruas.find(r => r.id === l.ruaId)!.codigo}/${l.posicao}/${l.andar}`;
    expect(pacoteA.locais.map(l => `${codigo.get(l.ruaId)}/${l.posicao}/${l.andar}`)).toEqual(embutidoA.locais.map(l => chave(embutidoA, l)));
    expect(pacoteA.ruas.map(r => r.codigo)).toEqual(embutidoA.ruas.map(r => r.codigo));
    expect(pacoteA.produtos.map(p => p.codigo)).toEqual(embutidoA.produtos.map(p => p.codigo));
    expect(pacoteA.ordens.map(o => o.numero)).toEqual(embutidoA.ordens.map(o => o.numero));
  });

  it('usa só as rotas que o Jogador acessa (concepts/…/page e queries); nunca a lista REST cortada em 1000', () => {
    const rotas = rodado.servidor.chamadas.map(c => c.caminho);
    expect(rotas.every(r => /^\/(concepts\/\w+\/page|queries\/\w+|auth\/login)$/.test(r))).toBe(true);
    expect(rotas.some(r => r === '/local_armazenagems')).toBe(false);
  });
});

describe('carregarPacote: WH-B (1448 locais) e paginação', () => {
  it('WH-B completo: nenhum local perdido, equivalente ao embutido', async () => {
    const { cliente } = await clienteLogado();
    const p = await carregarPacote(cliente, 'WH-B-MEGA');
    expect(diferencasDePacote(embutidoB, p)).toEqual([]);
    expect(p.locais).toHaveLength(1448);
    expect(p.ordens).toHaveLength(400);
  });

  it('com páginas minúsculas no servidor (força offset/hasMore), o resultado é o mesmo — sem repetir nem pular linhas', async () => {
    const { cliente, servidor } = await clienteLogado({ maxPagina: 7 });
    const p = await carregarPacote(cliente, 'WH-B-MEGA');
    expect(diferencasDePacote(embutidoB, p)).toEqual([]);
    expect(new Set(p.locais.map(l => l.id)).size).toBe(1448);
    expect(servidor.contar(c => c.caminho === '/queries/OrdensPorCenario')).toBe(Math.ceil(400 / 7));
  });
});

describe('carregarPacote: falhas explícitas, nunca pacote parcial', () => {
  it('cenário que não existe (ou está inativo) → nao_encontrado', async () => {
    const { cliente } = await clienteLogado();
    await expect(carregarPacote(cliente, 'WH-NAO-EXISTE')).rejects.toMatchObject({ tipo: 'nao_encontrado' });
    await expect(buscarCenario(cliente, 'WH-NAO-EXISTE')).rejects.toMatchObject({ tipo: 'nao_encontrado' });
  });

  it('listarCenarios devolve os ativos, por código, no formato do modelo', async () => {
    const { cliente } = await clienteLogado();
    const cs = await listarCenarios(cliente);
    expect(cs.map(c => c.codigo)).toEqual(['WH-A-PEQUENO', 'WH-B-MEGA']);
    expect(cs[0]).toEqual(doBanco.A.cenario);
  });

  it('convidado: offline, sem nenhuma chamada de rede', async () => {
    const servidor = new ServidorFalso({ pacotes: [doBanco.A] });
    const cliente = new NpdevClient({ fetch: servidor.fetch });
    await expect(carregarPacote(cliente, 'WH-A-PEQUENO')).rejects.toMatchObject({ tipo: 'offline' });
    expect(servidor.chamadas).toHaveLength(0);
  });

  it('rede cai no meio do carregamento → erro de rede (e não um pacote pela metade)', async () => {
    const { cliente, servidor } = await clienteLogado();
    servidor.perderRespostaDasProximas(1, c => c.caminho === '/concepts/LocalArmazenagem/page' && c.query.ruaId === doBanco.A.ruas[3].id);
    const erro = await carregarPacote(cliente, 'WH-A-PEQUENO').catch(e => e);
    expect(erro).toMatchObject({ tipo: 'rede', recuperavel: true });
  });

  it('sem permissão de leitura num concept o NPDev responde 200 com lista vazia: vira erro, não armazém vazio', async () => {
    const { cliente } = await clienteLogado({ semLeituraDe: ['LocalArmazenagem'] });
    const erro = await carregarPacote(cliente, 'WH-A-PEQUENO').catch(e => e);
    expect(erro).toMatchObject({ tipo: 'resposta_invalida' });
    expect(erro.message).toContain('sem locais');
  });

  it('401 no meio (token revogado): nao_autenticado', async () => {
    const { cliente, servidor } = await clienteLogado();
    servidor.revogarTokens();
    await expect(carregarPacote(cliente, 'WH-A-PEQUENO')).rejects.toMatchObject({ tipo: 'nao_autenticado' });
  });

  it('403 → proibido', async () => {
    const { cliente, servidor } = await clienteLogado();
    servidor.falharProximas(1, { status: 403, corpo: { error: 'forbidden' } }, c => c.caminho === '/queries/OrdensPorCenario');
    await expect(carregarPacote(cliente, 'WH-A-PEQUENO')).rejects.toMatchObject({ tipo: 'proibido' });
  });

  it('servidor devolvendo campo com tipo trocado → resposta_invalida apontando o campo', async () => {
    const { cliente, servidor } = await clienteLogado();
    servidor.falharProximas(1, { status: 200, corpo: { items: [{ id: 'x', ruaId: 'y', posicao: '3', andar: 1, situacao: 'Disponivel' }], total: 1, hasMore: false } },
      c => c.caminho === '/concepts/LocalArmazenagem/page');
    const erro = await carregarPacote(cliente, 'WH-A-PEQUENO').catch(e => e);
    expect(erro).toMatchObject({ tipo: 'resposta_invalida' });
    expect(erro.message).toMatch(/posicao/);
  });

  it('enum desconhecido (ex.: situação nova no servidor) → resposta_invalida', async () => {
    const { cliente, servidor } = await clienteLogado();
    servidor.falharProximas(1, { status: 200, corpo: { items: [{ id: 'x', ruaId: 'y', posicao: 3, andar: 1, situacao: 'Quebrado' }], total: 1, hasMore: false } },
      c => c.caminho === '/concepts/LocalArmazenagem/page');
    await expect(carregarPacote(cliente, 'WH-A-PEQUENO')).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });

  it('resposta que não é lista nem objeto, ou paginação que nunca termina → resposta_invalida', async () => {
    const { cliente, servidor } = await clienteLogado();
    servidor.falharProximas(1, { status: 200, corpo: { items: 'nada' } }, c => c.caminho === '/concepts/Area/page');
    await expect(carregarPacote(cliente, 'WH-A-PEQUENO')).rejects.toMatchObject({ tipo: 'resposta_invalida' });

    servidor.falharProximas(1, { status: 200, corpo: { items: [], total: 9, hasMore: true } }, c => c.caminho === '/concepts/Area/page');
    await expect(carregarPacote(cliente, 'WH-A-PEQUENO')).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });

  it('páginas que somam menos que o total anunciado → resposta_invalida (não entrega pacote incompleto)', async () => {
    const { cliente, servidor } = await clienteLogado();
    servidor.falharProximas(1, { status: 200, corpo: { items: [], total: 5, hasMore: false } }, c => c.caminho === '/concepts/Area/page');
    await expect(carregarPacote(cliente, 'WH-A-PEQUENO')).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });
});

describe('validarPacote', () => {
  it('aceita o pacote embutido e devolve em ordem canônica, sem campos extras', () => {
    const v = validarPacote({ ...embutidoA, cenario: { ...embutidoA.cenario, extra: 1 } });
    expect(v.cenario).toEqual(embutidoA.cenario);
    expect(diferencasDePacote(embutidoA, v)).toEqual([]);
  });

  it('recusa referência que não fecha, lista vazia, turno invertido e lixo', () => {
    const quebra = (f: (p: PacoteCenario) => unknown) => () => validarPacote(f(structuredClone(embutidoA)));
    expect(quebra(p => { p.locais[0].ruaId = 'nao-existe'; return p; })).toThrow(/local fora das ruas/);
    expect(quebra(p => { p.ordens[0].produtoId = 'nao-existe'; return p; })).toThrow(/produto que não está/);
    expect(quebra(p => { p.rankingRuas[0].ruaId = 'nao-existe'; return p; })).toThrow(/ranking/);
    expect(quebra(p => { p.ruas[0].areaId = 'nao-existe'; return p; })).toThrow(/rua fora das áreas/);
    expect(quebra(p => { p.ordens = []; return p; })).toThrow(/sem ordens/);
    expect(quebra(p => { p.cenario.fimTurnoSeg = p.cenario.inicioTurnoSeg; return p; })).toThrow(/turno/);
    expect(quebra(p => { p.cenario.armazemId = 'outro'; return p; })).toThrow(/armazém/);
    expect(() => validarPacote(null)).toThrow();
    expect(() => validarPacote('texto')).toThrow();
    for (const f of [() => validarPacote(null), () => validarPacote({})]) {
      const erro = (() => { try { f(); } catch (e) { return e; } })();
      expect(ehNpdevError(erro) && erro.tipo).toBe('resposta_invalida');
    }
  });
});

describe('procedência do cenário (ponte Jogo ↔ WmsOffice)', () => {
  it('um cenário importado do corporativo carrega com procedencia "Corporativo"; os do jogo não têm o campo', async () => {
    const importado = structuredClone(doBanco.A);
    importado.cenario.codigo = 'CORP-teste';
    (importado.cenario as { procedencia?: string }).procedencia = 'Corporativo';
    const servidor = new ServidorFalso({ pacotes: [doBanco.A, importado] });
    const cliente = new NpdevClient({ fetch: servidor.fetch });
    await cliente.login('jogador', 'senha-certa');
    expect((await listarCenarios(cliente)).map(c => [c.codigo, c.procedencia])).toEqual([['CORP-teste', 'Corporativo'], ['WH-A-PEQUENO', undefined]]);
    const pacote = await carregarPacote(cliente, 'CORP-teste');
    expect(pacote.cenario.procedencia).toBe('Corporativo');
    expect(validarPacote(JSON.parse(JSON.stringify(pacote))).cenario.procedencia).toBe('Corporativo'); // sobrevive ao cache
    expect(Object.keys((await carregarPacote(cliente, 'WH-A-PEQUENO')).cenario)).not.toContain('procedencia');
  });
});
