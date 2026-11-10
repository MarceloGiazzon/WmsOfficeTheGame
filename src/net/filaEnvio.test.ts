import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import type { Metricas, PacoteCenario } from '../sim/model';
import { ArmazenamentoMemoria, ErroArmazenamento, type ArmazenamentoJson } from './cache';
import { FilaEnvio, type RegistroPartida, type ResumoFila } from './filaEnvio';
import { remapearIds } from './idsUuid';
import { NpdevClient } from './npdevClient';
import { VERSAO_MOTOR } from './partidas';
import { ServidorFalso, type Chamada } from './servidorFalso';

const banco = remapearIds(whA as unknown as PacoteCenario, 5).pacote;
const METRICAS: Metricas = {
  distanciaRealCm: 557950, distanciaTeoricaCm: 307050, ordensTotal: 60, ordensAtrasadas: 9, eventosConflito: 10, ocupacaoFinalCentesimos: 6200,
}; // WH-A-PEQUENO (60 ordens, teórica 307050 cm); score oficial 50,40

const reg = (extra: Partial<RegistroPartida> = {}): RegistroPartida => ({
  cenarioCodigo: 'WH-A-PEQUENO', politica: 'AbcProximidade', metricas: METRICAS, scoreCentesimos: 5040,
  iniciadaEm: '2026-11-10T08:00:00.000Z', concluidaEm: '2026-11-10T08:20:00.000Z', ...extra,
});

const ehCriar = (c: Chamada) => c.caminho === '/sim_partidas' && c.metodo === 'POST';
const ehConcluir = (c: Chamada) => c.caminho === '/flows/ConcluirPartida/execute';

async function montar(opcoes: { armazenamento?: ArmazenamentoJson; semLogin?: boolean; pacotes?: PacoteCenario[] } = {}) {
  const servidor = new ServidorFalso({
    pacotes: opcoes.pacotes ?? [banco], usuarios: { ana: { senha: 's' }, bia: { senha: 's' } },
  });
  const cliente = new NpdevClient({ fetch: servidor.fetch });
  if (!opcoes.semLogin) await cliente.login('ana', 's');
  const armazenamento = opcoes.armazenamento ?? new ArmazenamentoMemoria();
  let n = 0;
  let relogio = Date.parse('2026-11-10T09:00:00Z');
  const fila = new FilaEnvio({
    armazenamento, http: cliente, gerarId: () => `item-${++n}`, agora: () => new Date((relogio += 1000)),
  });
  return { servidor, cliente, fila, armazenamento };
}

describe('registrar: guardar e enviar', () => {
  it('convidado (sem sessão): não guarda nem envia nada', async () => {
    const { servidor, fila } = await montar({ semLogin: true });
    expect(await fila.registrar(reg())).toEqual({ estado: 'convidado' });
    expect(await fila.listar()).toEqual([]);
    expect(servidor.chamadas).toHaveLength(0);
  });

  it('online: cria a partida, conclui, o servidor valida e a fila fica vazia', async () => {
    const { servidor, fila } = await montar();
    const r = await fila.registrar(reg());
    expect(r).toMatchObject({ estado: 'enviado', resultado: { validadoServidor: true, scoreServidorCentesimos: 5040 } });
    expect(await fila.listar()).toEqual([]);
    expect(await fila.resumo()).toEqual({ pendentes: 0, rejeitados: 0, jogador: 'ana' });
    expect([...servidor.partidas.values()]).toMatchObject([{ situacao: 'Concluida', jogador: 'ana', politica: 'AbcProximidade', versaoMotor: VERSAO_MOTOR, iniciadaEm: '2026-11-10T08:00:00.000Z' }]);
    expect(servidor.scores.size).toBe(1);
  });

  it('offline: o item é persistido com todos os campos e a partida não se perde', async () => {
    const { servidor, fila, armazenamento } = await montar();
    servidor.rede = false;
    const r = await fila.registrar(reg());
    expect(r).toMatchObject({ estado: 'pendente', erro: { tipo: 'rede' } });
    const [item] = await fila.listar();
    expect(item).toMatchObject({
      jogador: 'ana', cenarioCodigo: 'WH-A-PEQUENO', politica: 'AbcProximidade', metricas: METRICAS, scoreCentesimos: 5040,
      iniciadaEm: '2026-11-10T08:00:00.000Z', concluidaEm: '2026-11-10T08:20:00.000Z', versaoMotor: VERSAO_MOTOR,
      situacao: 'pendente', tentativas: 1, ultimoErro: { tipo: 'rede' },
    });
    expect(await fila.resumo()).toEqual({ pendentes: 1, rejeitados: 0, jogador: 'ana' });
    expect(await armazenamento.chaves('fila:')).toEqual([`fila:${item.id}`]);
  });

  it('o item sobrevive a um "recarregar a página": outra instância da fila lê o mesmo armazenamento e envia', async () => {
    const { servidor, fila, armazenamento, cliente } = await montar();
    servidor.rede = false;
    await fila.registrar(reg());
    servidor.rede = true;
    const novaFila = new FilaEnvio({ armazenamento, http: cliente });
    const r = await novaFila.sincronizar();
    expect(r).toMatchObject({ pendentes: 0, erro: null, enviados: [{ validadoServidor: true }] });
    expect(servidor.partidas.size).toBe(1);
  });
});

describe('sincronizar: offline → online', () => {
  it('envia na ordem em que foram jogados, um por vez, e retira só o que o servidor aceitou', async () => {
    const { servidor, fila } = await montar();
    servidor.rede = false;
    await fila.registrar(reg({ politica: 'FifoPrimeiraLivre', iniciadaEm: '2026-11-10T08:00:00.000Z' }));
    await fila.registrar(reg({ politica: 'Consolidacao', iniciadaEm: '2026-11-10T09:00:00.000Z' }));
    await fila.registrar(reg({ politica: 'WmsReal', iniciadaEm: '2026-11-10T10:00:00.000Z' }));
    expect((await fila.resumo()).pendentes).toBe(3);

    servidor.rede = true;
    const r = await fila.sincronizar();
    expect(r).toMatchObject({ pendentes: 0, erro: null, rejeitados: [] });
    expect(r.enviados).toHaveLength(3);
    expect([...servidor.partidas.values()].map(p => p.politica)).toEqual(['FifoPrimeiraLivre', 'Consolidacao', 'WmsReal']);
    expect(await fila.listar()).toEqual([]);
  });

  it('a rede cai no meio: o que já foi aceito sai, o resto espera — e a próxima rodada completa sem duplicar', async () => {
    const { servidor, fila } = await montar();
    servidor.rede = false;
    await fila.registrar(reg({ politica: 'FifoPrimeiraLivre', iniciadaEm: '2026-11-10T08:00:00.000Z' }));
    await fila.registrar(reg({ politica: 'Consolidacao', iniciadaEm: '2026-11-10T09:00:00.000Z' }));
    await fila.registrar(reg({ politica: 'WmsReal', iniciadaEm: '2026-11-10T10:00:00.000Z' }));
    servidor.rede = true;
    // a conclusão do 2º item não chega ao servidor (a conexão cai antes)
    servidor.falharProximas(1, { status: 503 }, c => ehConcluir(c) && servidor.contar(ehConcluir) === 2); // a 2ª conclusão desta rodada
    const r1 = await fila.sincronizar();
    expect(r1.enviados).toHaveLength(1);
    expect(r1).toMatchObject({ pendentes: 2, erro: { tipo: 'servidor' } });
    expect(servidor.partidas.size).toBe(2); // o 2º já foi criado e ficou EmAndamento...

    const r2 = await fila.sincronizar();
    expect(r2).toMatchObject({ pendentes: 0, erro: null });
    expect(r2.enviados).toHaveLength(2);
    expect(servidor.partidas.size).toBe(3); // ...e foi REAPROVEITADO (partidaId guardado no item): 3 itens = 3 partidas
    expect(servidor.scores.size).toBe(3);
    expect([...servidor.partidas.values()].every(p => p.situacao === 'Concluida')).toBe(true);
  });

  it('queda DEPOIS de o servidor concluir (resposta perdida): a rodada seguinte reconhece o score gravado e não duplica', async () => {
    const { servidor, fila } = await montar();
    servidor.perderRespostaDasProximas(1, ehConcluir);
    const r = await fila.registrar(reg());
    expect(r).toMatchObject({ estado: 'pendente', erro: { tipo: 'rede' } });
    expect(servidor.scores.size).toBe(1); // o servidor concluiu; só a resposta se perdeu
    expect((await fila.listar())[0].partidaId).toBeDefined();

    const s = await fila.sincronizar();
    expect(s).toMatchObject({ pendentes: 0, erro: null, rejeitados: [] });
    expect(s.enviados).toEqual([expect.objectContaining({ validadoServidor: true, scoreServidorCentesimos: 5040 })]);
    expect(servidor.partidas.size).toBe(1);
    expect(servidor.scores.size).toBe(1);
    expect(await fila.listar()).toEqual([]);
  });

  it('queda DEPOIS de o servidor criar a partida (resposta perdida): reaproveita a EmAndamento em vez de criar outra', async () => {
    const { servidor, fila } = await montar();
    servidor.perderRespostaDasProximas(1, ehCriar);
    const r = await fila.registrar(reg());
    expect(r).toMatchObject({ estado: 'pendente', erro: { tipo: 'rede' } });
    expect((await fila.listar())[0].partidaId).toBeUndefined(); // o cliente não sabe o id...
    expect(servidor.partidas.size).toBe(1); // ...mas ela existe

    const s = await fila.sincronizar();
    expect(s.enviados).toHaveLength(1);
    expect(servidor.partidas.size).toBe(1);
    expect(servidor.scores.size).toBe(1);
  });

  it('a partida criada ao INICIAR o jogo (partidaId no registro) é concluída sem criar outra', async () => {
    const { servidor, fila, cliente } = await montar();
    const { iniciarPartida } = await import('./partidas');
    const p = await iniciarPartida(cliente, { cenarioId: banco.cenario.id, politica: 'AbcProximidade', iniciadaEm: '2026-11-10T08:00:00.000Z' });
    servidor.rede = false; // caiu no fim do jogo
    await fila.registrar(reg({ partidaId: p.id }));
    servidor.rede = true;
    await fila.sincronizar();
    expect(servidor.contar(ehCriar)).toBe(1); // só a do início
    expect(servidor.partidas.get(p.id)?.situacao).toBe('Concluida');
  });

  it('a partida guardada no item sumiu do servidor (nao_encontrado): cria outra e conclui, uma vez', async () => {
    const { servidor, fila } = await montar();
    servidor.rede = false;
    await fila.registrar(reg({ partidaId: '00000000-0000-4000-8000-0000deadbeef' }));
    servidor.rede = true;
    const s = await fila.sincronizar();
    expect(s.enviados).toHaveLength(1);
    expect(servidor.contar(ehCriar)).toBe(1);
    expect(servidor.scores.size).toBe(1);
  });

  it('chamadas simultâneas de sincronizar() dividem a mesma rodada (duplo clique não duplica nada)', async () => {
    const { servidor, fila } = await montar();
    servidor.rede = false;
    await fila.registrar(reg());
    servidor.rede = true;
    const [a, b] = [fila.sincronizar(), fila.sincronizar()];
    expect(a).toBe(b);
    await a;
    expect(servidor.partidas.size).toBe(1);
    expect(servidor.scores.size).toBe(1);
  });

  it('registrar() durante uma sincronização em curso não envia o mesmo item duas vezes', async () => {
    const { servidor, fila } = await montar();
    servidor.rede = false;
    await fila.registrar(reg({ iniciadaEm: '2026-11-10T08:00:00.000Z' }));
    servidor.rede = true;
    const [sync, novo] = await Promise.all([fila.sincronizar(), fila.registrar(reg({ iniciadaEm: '2026-11-10T09:00:00.000Z', politica: 'WmsReal' }))]);
    expect(novo.estado).toBe('enviado');
    expect(sync.enviados).toHaveLength(1);
    expect(servidor.partidas.size).toBe(2);
    expect(servidor.scores.size).toBe(2);
    expect(await fila.listar()).toEqual([]);
  });
});

describe('rejeição definitiva × adiamento', () => {
  it('score adulterado: o servidor grava como não validado → item rejeitado com o motivo, e nunca reenviado em loop', async () => {
    const { servidor, fila } = await montar();
    const r = await fila.registrar(reg({ scoreCentesimos: 9999 }));
    expect(r).toMatchObject({ estado: 'rejeitado', item: { situacao: 'rejeitado', rejeicao: { codigo: 'score_divergente' }, resultado: { validadoServidor: false, scoreServidorCentesimos: 5040, scoreClienteCentesimos: 9999 } } });
    if (r.estado === 'rejeitado') expect(r.item.rejeicao!.motivo).toContain('50.40');
    expect(await fila.resumo()).toEqual({ pendentes: 0, rejeitados: 1, jogador: 'ana' });

    const antes = servidor.chamadas.length;
    const s = await fila.sincronizar();
    expect(s).toMatchObject({ enviados: [], rejeitados: [], pendentes: 0, erro: null });
    expect(servidor.chamadas.length).toBe(antes); // nenhuma chamada: rejeitado não é reenviado
    expect(servidor.scores.size).toBe(1);
  });

  it('métricas inválidas: rejeitado/metricas_invalidas com a mensagem do servidor', async () => {
    const { fila } = await montar();
    const r = await fila.registrar(reg({ metricas: { ...METRICAS, ordensAtrasadas: 101 } }));
    expect(r).toMatchObject({ estado: 'rejeitado', item: { rejeicao: { codigo: 'metricas_invalidas', motivo: 'ordensAtrasadas > ordensTotal' } } });
  });

  it('cenário que o servidor não tem (mais): rejeitado/cenario_inexistente; os outros itens seguem', async () => {
    const { fila, servidor } = await montar();
    servidor.rede = false;
    await fila.registrar(reg({ cenarioCodigo: 'WH-APAGADO' }));
    await fila.registrar(reg());
    servidor.rede = true;
    const s = await fila.sincronizar();
    expect(s.rejeitados).toMatchObject([{ rejeicao: { codigo: 'cenario_inexistente' } }]);
    expect(s.enviados).toHaveLength(1);
    expect(s.pendentes).toBe(0);
  });

  it('403 → rejeitado/negado; depois que o problema se resolve, reenviar() devolve para pendente e a rodada envia', async () => {
    const { servidor, fila } = await montar();
    servidor.falharProximas(1, { status: 403, corpo: { code: 'ROW_SCOPE_DENIED', message: 'negado' } }, ehCriar);
    const r = await fila.registrar(reg());
    expect(r).toMatchObject({ estado: 'rejeitado', item: { rejeicao: { codigo: 'negado' } } });
    const id = (await fila.listar())[0].id;

    await fila.reenviar(id);
    expect(await fila.resumo()).toMatchObject({ pendentes: 1, rejeitados: 0 });
    expect((await fila.listar())[0]).toMatchObject({ situacao: 'pendente', tentativas: 0 });
    expect((await fila.listar())[0].rejeicao).toBeUndefined();
    const s = await fila.sincronizar();
    expect(s.enviados).toHaveLength(1);
    expect(await fila.listar()).toEqual([]);
  });

  it('partida abandonada no servidor não pode mais concluir: rejeitado/partida_abandonada', async () => {
    const { servidor, fila, cliente } = await montar();
    const { iniciarPartida, abandonarPartida } = await import('./partidas');
    const p = await iniciarPartida(cliente, { cenarioId: banco.cenario.id, politica: 'AbcProximidade' });
    await abandonarPartida(cliente, p.id);
    const r = await fila.registrar(reg({ partidaId: p.id }));
    expect(r).toMatchObject({ estado: 'rejeitado', item: { rejeicao: { codigo: 'partida_abandonada' } } });
    expect(servidor.scores.size).toBe(0);
  });

  it('erros de rede/servidor/login NÃO rejeitam: o item fica pendente com o último erro e a contagem de tentativas', async () => {
    const { servidor, fila } = await montar();
    servidor.falharProximas(1, { status: 500 }, ehCriar);
    const r1 = await fila.registrar(reg());
    expect(r1).toMatchObject({ estado: 'pendente', erro: { tipo: 'servidor' } });

    servidor.falharProximas(1, { status: 422, corpo: { status: 'FAILED', errorCode: 'system_exception', error: 'PLUGIN_EXECUTION_TIMEOUT: Sandboxed plugin execution timed out after 5000 ms' } }, ehConcluir);
    const r2 = await fila.sincronizar();
    expect(r2).toMatchObject({ pendentes: 1, erro: { tipo: 'servidor', codigo: 'PLUGIN_EXECUTION_TIMEOUT' } });
    expect((await fila.listar())[0]).toMatchObject({ situacao: 'pendente', tentativas: 2, ultimoErro: { tipo: 'servidor' } });

    servidor.revogarTokens(); // 401: o cliente derruba a sessão
    const r3 = await fila.sincronizar();
    expect(r3).toMatchObject({ pendentes: 1, erro: { tipo: 'nao_autenticado' } });
    expect((await fila.listar())[0]).toMatchObject({ situacao: 'pendente', tentativas: 3 });
  });

  it('resposta ilegível do servidor: adia, e só depois de 5 tentativas desiste (rejeitado/resposta_invalida)', async () => {
    const { servidor, fila } = await montar();
    servidor.falharProximas(99, { status: 200, textoBruto: '<html>portal cativo</html>' }, c => c.caminho === '/queries/CenariosAtivos');
    expect(await fila.registrar(reg())).toMatchObject({ estado: 'pendente', erro: { tipo: 'resposta_invalida' } });
    for (let i = 0; i < 3; i++) expect((await fila.sincronizar()).pendentes).toBe(1);
    const ultima = await fila.sincronizar();
    expect(ultima.rejeitados).toMatchObject([{ rejeicao: { codigo: 'resposta_invalida' } }]);
    expect(ultima.pendentes).toBe(0);
  });

  it('descartar() tira o item (rejeitado ou pendente)', async () => {
    const { servidor, fila } = await montar();
    servidor.rede = false;
    await fila.registrar(reg());
    await fila.descartar((await fila.listar())[0].id);
    expect(await fila.listar()).toEqual([]);
  });
});

describe('sessão e donos', () => {
  it('sem login, sincronizar() devolve erro offline e não mexe nos itens', async () => {
    const { servidor, fila, cliente } = await montar();
    servidor.rede = false;
    await fila.registrar(reg());
    cliente.limparSessao();
    servidor.rede = true;
    const antes = servidor.chamadas.length;
    const s = await fila.sincronizar();
    expect(s).toMatchObject({ enviados: [], pendentes: 1, erro: { tipo: 'offline' } });
    expect(servidor.chamadas.length).toBe(antes);
  });

  it('partida jogada com a sessão já caída (jogador informado) fica pendente e é enviada quando o MESMO jogador entra', async () => {
    const { servidor, fila, cliente } = await montar({ semLogin: true });
    const r = await fila.registrar(reg({ jogador: 'ana' }));
    expect(r).toMatchObject({ estado: 'pendente', erro: { tipo: 'offline' } });
    expect(servidor.chamadas).toHaveLength(0);

    await cliente.login('bia', 's');
    expect(await fila.sincronizar()).toMatchObject({ enviados: [], pendentes: 0 }); // é da ana: bia não a envia
    expect(await fila.listar()).toHaveLength(1);
    expect(servidor.partidas.size).toBe(0);

    await cliente.login('ana', 's');
    expect((await fila.sincronizar()).enviados).toHaveLength(1);
    expect([...servidor.partidas.values()][0].jogador).toBe('ana');
  });

  it('resumo() é do jogador logado; sem sessão, de todos', async () => {
    const { fila, cliente } = await montar({ semLogin: true });
    await fila.registrar(reg({ jogador: 'ana' }));
    await fila.registrar(reg({ jogador: 'bia' }));
    expect(await fila.resumo()).toEqual({ pendentes: 2, rejeitados: 0, jogador: null });
    await cliente.login('bia', 's');
    expect(await fila.resumo()).toEqual({ pendentes: 1, rejeitados: 0, jogador: 'bia' });
  });
});

describe('armazenamento e indicador', () => {
  it('observar(): avisa a cada mudança com o novo resumo; cancelar para de avisar', async () => {
    const { servidor, fila } = await montar();
    const vistos: ResumoFila[] = [];
    const parar = fila.observar(r => vistos.push(r));
    servidor.rede = false;
    await fila.registrar(reg());
    servidor.rede = true;
    await fila.sincronizar();
    await new Promise(r => setTimeout(r, 5));
    expect(vistos.map(v => v.pendentes)).toContain(1);
    expect(vistos[vistos.length - 1]).toMatchObject({ pendentes: 0, rejeitados: 0 });
    parar();
    const n = vistos.length;
    servidor.rede = false;
    await fila.registrar(reg());
    await new Promise(r => setTimeout(r, 5));
    expect(vistos).toHaveLength(n);
  });

  it('sem onde guardar: online ainda envia; offline avisa EXPLICITAMENTE que a partida não pôde ser guardada', async () => {
    const quebrado: ArmazenamentoJson = {
      ler: async () => undefined, remover: async () => undefined, chaves: async () => [],
      gravar: async () => { throw new ErroArmazenamento('cota cheia'); },
    };
    const { servidor, fila } = await montar({ armazenamento: quebrado });
    const ok = await fila.registrar(reg());
    expect(ok).toMatchObject({ estado: 'enviado', resultado: { validadoServidor: true } });

    servidor.rede = false;
    const erro = await fila.registrar(reg({ iniciadaEm: '2026-11-10T11:00:00.000Z' })).catch(e => e);
    expect(erro).toBeInstanceOf(ErroArmazenamento);
    expect(erro.message).toContain('cota cheia');
  });

  it('itens corrompidos no armazenamento são ignorados em vez de derrubar a fila', async () => {
    const arm = new ArmazenamentoMemoria();
    await arm.gravar('fila:lixo', { qualquer: 'coisa' });
    await arm.gravar('fila:nulo', null);
    const { fila } = await montar({ armazenamento: arm });
    expect(await fila.listar()).toEqual([]);
    expect(await fila.resumo()).toMatchObject({ pendentes: 0 });
  });
});
