import { describe, expect, it, vi } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import { ArmazenamentoMemoria, type ArmazenamentoJson } from '../net/cache';
import { FilaEnvio } from '../net/filaEnvio';
import { remapearIds } from '../net/idsUuid';
import { NpdevClient } from '../net/npdevClient';
import { concluirPartida, iniciarPartida } from '../net/partidas';
import { ServidorFalso, type Chamada } from '../net/servidorFalso';
import type { Metricas, PacoteCenario } from '../sim/model';
import { calcularScore } from '../sim/score';
import { Abandonos } from './abandonos';
import { PartidaOnline, type DadosPartida } from './partidaOnline';
import type { ExtrasResultado, ResultadoPartida } from './resultado';

const banco = remapearIds(whA as unknown as PacoteCenario, 21).pacote;
const CENARIO_ID = banco.cenario.id;

const METRICAS: Metricas = {
  distanciaRealCm: 824000, distanciaTeoricaCm: 400000, ordensTotal: 100, ordensAtrasadas: 14, eventosConflito: 6, ocupacaoFinalCentesimos: 6200,
}; // score oficial 50,40
const scoreDe = (m: Metricas): number => { const r = calcularScore(m); if (!r.sucesso) throw new Error(r.motivo); return r.scoreCentesimos; };

function resultado(extra: Partial<ResultadoPartida> = {}, metricas: Metricas = METRICAS): ResultadoPartida {
  const r = calcularScore(metricas);
  return {
    cenarioCodigo: 'WH-A-PEQUENO', cenarioNome: 'WH-A Pequeno', dificuldade: 'Facil', politicaInicial: 'AbcProximidade', politicaFinal: 'Consolidacao',
    trocasPolitica: [{ seg: 28800, politica: 'AbcProximidade' }, { seg: 40000, politica: 'Consolidacao' }], inicioTurnoSeg: 28800, fimTurnoSeg: 64800,
    metricas, ordensConcluidas: 80, scoreCentesimos: r.sucesso ? r.scoreCentesimos : 0,
    penalidades: r.sucesso ? r.penalidades : { distancia: 0, atraso: 0, conflito: 0, bonusOcupacao: 0 }, ...extra,
  };
}

const dados = (extra: Partial<DadosPartida> = {}): DadosPartida => ({
  cenarioCodigo: 'WH-A-PEQUENO', cenarioId: CENARIO_ID, politica: 'AbcProximidade', origem: 'rede', ...extra,
});

const ehCriar = (c: Chamada) => c.metodo === 'POST' && c.caminho === '/sim_partidas';
const ehConcluir = (c: Chamada) => c.caminho === '/flows/ConcluirPartida/execute';
const ehAbandonar = (c: Chamada) => c.caminho === '/flows/AbandonarPartida/execute';

async function montar(opcoes: { logado?: boolean; armazenamento?: ArmazenamentoJson } = {}) {
  const servidor = new ServidorFalso({ pacotes: [banco], usuarios: { ana: { senha: 's' }, bia: { senha: 's' } } });
  const cliente = new NpdevClient({ fetch: servidor.fetch });
  if (opcoes.logado !== false) await cliente.login('ana', 's');
  const armazenamento = opcoes.armazenamento ?? new ArmazenamentoMemoria();
  const fila = new FilaEnvio({ armazenamento, http: cliente });
  const abandonos = new Abandonos(armazenamento, cliente);
  const aoTerminar = vi.fn();
  const pedirLogin = vi.fn(async () => { await cliente.login('ana', 's'); return true; });
  const nova = (d: DadosPartida = dados()) => new PartidaOnline({ http: cliente, fila, abandonos, aoTerminar, pedirLogin }, d);
  return { servidor, cliente, fila, abandonos, aoTerminar, pedirLogin, nova, armazenamento };
}

/** Outro jogador joga e fecha `n` partidas com `metricas` melhores que as de ninguém: enche o ranking do cenário. */
async function encherRanking(servidor: ServidorFalso, n: number) {
  const bia = new NpdevClient({ fetch: servidor.fetch });
  await bia.login('bia', 's');
  for (let i = 0; i < n; i++) {
    const m: Metricas = { ...METRICAS, distanciaRealCm: 400000 + i * 1000, ordensAtrasadas: 0, eventosConflito: 0, ocupacaoFinalCentesimos: 8000 };
    const p = await iniciarPartida(bia, { cenarioId: CENARIO_ID, politica: 'FifoPrimeiraLivre' });
    await concluirPartida(bia, p.id, m, scoreDe(m));
  }
}

describe('turno online completo', () => {
  it('cria a partida ao iniciar, envia no fim, o servidor valida e o ranking mostra a posição', async () => {
    const { servidor, nova, fila, aoTerminar } = await montar();
    const p = nova();
    expect(p.jogador).toBe('ana');
    const extras = await p.concluir(resultado());
    expect(extras).toMatchObject({ validadoServidor: true, posicaoRanking: 1, rankingTotal: 1 });
    expect(extras.ranking).toEqual([expect.objectContaining({ posicao: 1, jogador: 'ana', scoreCentesimos: 5040, destaque: true, souEu: true })]);
    // UMA partida no servidor (a do início): a fila reaproveitou o partidaId, não criou outra
    expect(servidor.contar(ehCriar)).toBe(1);
    expect(servidor.partidas.size).toBe(1);
    const corpo = servidor.chamadas.find(ehCriar)!.corpo as Record<string, unknown>;
    expect(corpo).toMatchObject({ cenarioId: CENARIO_ID, jogador: 'ana', politica: 'AbcProximidade', iniciadaEm: p.iniciadaEm });
    expect([...servidor.partidas.values()][0]).toMatchObject({ situacao: 'Concluida', iniciadaEm: p.iniciadaEm });
    expect(await fila.listar()).toEqual([]);
    expect(aoTerminar).toHaveBeenCalledTimes(1);
  });

  it('manda as métricas e o score do cliente; a SimPartida leva a política INICIAL (com ou sem partida criada no início)', async () => {
    const { servidor, nova } = await montar();
    await nova().concluir(resultado({ politicaInicial: 'AbcProximidade', politicaFinal: 'WmsReal' }));
    expect(servidor.chamadas.find(ehConcluir)!.corpo).toMatchObject({ ...METRICAS, scoreCentesimos: 5040 });
    expect([...servidor.partidas.values()][0].politica).toBe('AbcProximidade');
    // pacote embutido: a partida só nasce no envio, e nasce com a mesma política
    const b = await montar();
    await b.nova(dados({ origem: 'embutido' })).concluir(resultado({ politicaInicial: 'Consolidacao', politicaFinal: 'WmsReal' }));
    expect([...b.servidor.partidas.values()][0].politica).toBe('Consolidacao');
  });

  it('ranking com muita gente: top 10 + a linha desta partida, com a posição certa', async () => {
    const { servidor, nova } = await montar();
    await encherRanking(servidor, 12);
    const extras = await nova().concluir(resultado());
    expect(extras.posicaoRanking).toBe(13);
    expect(extras.rankingTotal).toBe(13);
    expect(extras.ranking).toHaveLength(11);
    expect(extras.ranking!.slice(0, 10).every(l => l.jogador === 'bia')).toBe(true);
    expect(extras.ranking![10]).toMatchObject({ posicao: 13, jogador: 'ana', destaque: true });
  });

  it('o resultado local do cliente (política final, trocas) não vai no corpo além do que o servidor aceita', async () => {
    const { servidor, nova } = await montar();
    await nova().concluir(resultado());
    const corpo = servidor.chamadas.find(ehConcluir)!.corpo as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['distanciaRealCm', 'distanciaTeoricaCm', 'eventosConflito', 'ocupacaoFinalCentesimos', 'ordensAtrasadas', 'ordensTotal', 'partidaId', 'scoreCentesimos']);
  });
});

describe('score que o servidor não valida', () => {
  it('divergência não é escondida: validadoServidor=false com os dois números e fora do ranking', async () => {
    const { servidor, nova, fila } = await montar();
    const extras = await nova().concluir(resultado({ scoreCentesimos: 9999 })); // o cliente "calculou" outra coisa
    expect(extras.validadoServidor).toBe(false);
    expect(extras.posicaoRanking).toBeUndefined();
    expect(extras.ranking).toBeUndefined();
    expect(extras.mensagem).toMatch(/recalculou o score em 50,40/);
    expect(extras.mensagem).toMatch(/jogo calculou 99,99/);
    expect(extras.mensagem).toMatch(/fora do ranking/);
    // o servidor gravou a partida com o score DELE
    expect([...servidor.scores.values()][0]).toMatchObject({ scoreCentesimos: 5040, validadoServidor: false });
    expect([...servidor.partidas.values()][0].situacao).toBe('Concluida');
    // e a fila guarda o caso como rejeitado (visível para o jogador), sem reenviar sozinha
    const [item] = await fila.listar();
    expect(item).toMatchObject({ situacao: 'rejeitado', rejeicao: { codigo: 'score_divergente' } });
  });
});

describe('sem rede no fim do turno', () => {
  it('partida salva na fila com a mensagem certa; ao religar, sincronizar envia e não duplica a partida', async () => {
    const { servidor, nova, fila } = await montar();
    const p = nova();
    await new Promise(r => setTimeout(r, 0)); // a criação da partida roda em segundo plano
    servidor.rede = false;
    const extras = await p.concluir(resultado());
    expect(extras).toMatchObject({ envio: 'pendente' });
    expect(extras.validadoServidor).toBeUndefined();
    expect(extras.mensagem).toMatch(/Partida salva para envio quando a rede voltar/);
    expect(await fila.resumo()).toMatchObject({ pendentes: 1, rejeitados: 0 });
    servidor.rede = true;
    const r = await fila.sincronizar();
    expect(r).toMatchObject({ erro: null, pendentes: 0 });
    expect(r.enviados[0]).toMatchObject({ validadoServidor: true, scoreServidorCentesimos: 5040 });
    expect(servidor.partidas.size).toBe(1); // a criada no início, concluída agora — sem duplicar
  });

  it('servidor com 500 no envio: também fica pendente, dizendo que o servidor tem problemas', async () => {
    const { servidor, nova } = await montar();
    const p = nova();
    await new Promise(r => setTimeout(r, 0));
    servidor.falharProximas(3, { status: 503, corpo: { error: 'Service Unavailable' } }, ehConcluir);
    const extras = await p.concluir(resultado());
    expect(extras).toMatchObject({ envio: 'pendente' });
    expect(extras.mensagem).toMatch(/servidor está com problemas/i);
  });

  it('a rede estava fora já no início: o jogo segue, e no fim (rede de volta) a fila cria a partida e envia', async () => {
    const { servidor, nova } = await montar();
    servidor.rede = false;
    const p = nova(); // iniciarPartida falha, em silêncio
    await new Promise(r => setTimeout(r, 0));
    expect(p.erroInicio).toMatchObject({ tipo: 'rede' });
    servidor.rede = true;
    const extras = await p.concluir(resultado());
    expect(extras).toMatchObject({ validadoServidor: true, posicaoRanking: 1 });
    expect(servidor.partidas.size).toBe(1);
    expect([...servidor.partidas.values()][0].iniciadaEm).toBe(p.iniciadaEm);
  });
});

describe('origem do pacote', () => {
  it('pacote embutido (ids são alias): não chama iniciarPartida; a fila acha o cenário pelo código e o ranking sai igual', async () => {
    const { servidor, nova } = await montar();
    const p = nova(dados({ origem: 'embutido', cenarioId: 'WHAcenario' }));
    await new Promise(r => setTimeout(r, 0));
    expect(servidor.contar(ehCriar)).toBe(0);
    const extras = await p.concluir(resultado());
    expect(extras).toMatchObject({ validadoServidor: true, posicaoRanking: 1 });
    expect(servidor.contar(ehCriar)).toBe(1); // criada no envio
  });

  it('pacote do cache: idem (o id guardado pode estar velho)', async () => {
    const { servidor, nova } = await montar();
    nova(dados({ origem: 'cache' }));
    await new Promise(r => setTimeout(r, 0));
    expect(servidor.contar(ehCriar)).toBe(0);
  });
});

describe('convidado', () => {
  it('nenhuma chamada de rede; resultado local com a ação "Entrar e enviar esta partida"', async () => {
    const { servidor, nova, fila } = await montar({ logado: false });
    const p = nova();
    expect(p.jogador).toBeNull();
    expect(p.vaiEnviar).toBe(false);
    expect(p.extrasIniciais()).toEqual({});
    const extras = await p.concluir(resultado());
    expect(servidor.chamadas).toHaveLength(0);
    expect(extras.validadoServidor).toBeUndefined();
    expect(extras.mensagem).toMatch(/convidado/i);
    expect(extras.acao?.rotulo).toMatch(/Entrar e enviar/);
    expect(await fila.listar()).toEqual([]); // não guarda nada em disco
  });

  it('"Entrar e enviar": depois do login a partida do convidado vai como do usuário que entrou', async () => {
    const { servidor, nova, pedirLogin } = await montar({ logado: false });
    const p = nova();
    const recebidos: ExtrasResultado[] = [];
    p.aoNovosExtras = e => recebidos.push(e);
    const extras = await p.concluir(resultado());
    extras.acao!.aoClicar();
    await vi.waitFor(() => expect(recebidos).toHaveLength(2));
    expect(pedirLogin).toHaveBeenCalledTimes(1);
    expect(recebidos[0]).toEqual({ envio: 'enviando' });
    expect(recebidos[1]).toMatchObject({ validadoServidor: true, posicaoRanking: 1 });
    expect([...servidor.partidas.values()][0]).toMatchObject({ jogador: 'ana', situacao: 'Concluida' });
  });

  it('"Entrar e enviar" cancelado (fechou o login): nada acontece', async () => {
    const { servidor, nova, pedirLogin } = await montar({ logado: false });
    pedirLogin.mockResolvedValueOnce(false);
    const p = nova();
    const recebidos: ExtrasResultado[] = [];
    p.aoNovosExtras = e => recebidos.push(e);
    (await p.concluir(resultado())).acao!.aoClicar();
    await new Promise(r => setTimeout(r, 0));
    expect(recebidos).toEqual([]);
    expect(servidor.chamadas).toHaveLength(0);
  });

  it('entrou no MEIO do turno: o fim envia como do usuário logado (a fila cria a partida)', async () => {
    const { servidor, nova, cliente } = await montar({ logado: false });
    const p = nova();
    await cliente.login('ana', 's');
    expect(p.vaiEnviar).toBe(true);
    const extras = await p.concluir(resultado());
    expect(extras).toMatchObject({ validadoServidor: true, posicaoRanking: 1 });
    expect([...servidor.partidas.values()][0].jogador).toBe('ana');
  });
});

describe('sessão que cai no meio do turno', () => {
  it('a partida não se perde: fica na fila DO DONO e, quando ele entra de novo, é enviada com a partida do início', async () => {
    const { servidor, nova, cliente, fila } = await montar();
    const p = nova();
    await new Promise(r => setTimeout(r, 0));
    cliente.limparSessao(); // o que o controlador faz ao expirar
    const extras = await p.concluir(resultado());
    expect(extras).toMatchObject({ envio: 'pendente' });
    expect(extras.mensagem).toMatch(/quando ana entrar/);
    expect(await fila.listar()).toHaveLength(1);
    await cliente.login('ana', 's');
    const r = await fila.sincronizar();
    expect(r.enviados).toHaveLength(1);
    expect(servidor.partidas.size).toBe(1); // a mesma partida criada no início
  });

  it('outro usuário entra no lugar: a partida continua sendo da ana (não vira da bia)', async () => {
    const { servidor, nova, cliente, fila } = await montar();
    const p = nova();
    await new Promise(r => setTimeout(r, 0));
    cliente.limparSessao();
    await cliente.login('bia', 's');
    const extras = await p.concluir(resultado());
    expect(extras.mensagem).toMatch(/quando ana entrar/);
    expect((await fila.listar())[0].jogador).toBe('ana');
    expect(servidor.contar(ehConcluir)).toBe(0);
  });
});

describe('desistir e sair', () => {
  it('trocar de cenário no meio: abandona a partida do servidor', async () => {
    const { servidor, nova } = await montar();
    const p = nova();
    await p.desistir();
    expect([...servidor.partidas.values()][0].situacao).toBe('Abandonada');
    await p.desistir(); // de novo: nada
    expect(servidor.contar(ehAbandonar)).toBe(1);
  });

  it('desistir depois de concluir não abandona nada (já está encerrada)', async () => {
    const { servidor, nova } = await montar();
    const p = nova();
    await p.concluir(resultado());
    await p.desistir();
    expect(servidor.contar(ehAbandonar)).toBe(0);
    expect([...servidor.partidas.values()][0].situacao).toBe('Concluida');
  });

  it('convidado ou pacote sem partida criada: desistir não chama a rede', async () => {
    const a = await montar({ logado: false });
    await a.nova().desistir();
    expect(a.servidor.chamadas).toHaveLength(0);
    const b = await montar();
    await b.nova(dados({ origem: 'embutido' })).desistir();
    expect(b.servidor.contar(ehAbandonar)).toBe(0);
  });

  it('sem rede ao desistir: o pedido fica guardado e é refeito depois', async () => {
    const { servidor, nova, abandonos } = await montar();
    const p = nova();
    await new Promise(r => setTimeout(r, 0));
    servidor.rede = false;
    await p.desistir();
    expect([...servidor.partidas.values()][0].situacao).toBe('EmAndamento');
    expect(await abandonos.pendentes()).toBe(1);
    expect(await abandonos.tentar()).toBe(0); // rede ainda fora: continua guardado
    expect(await abandonos.pendentes()).toBe(1);
    servidor.rede = true;
    expect(await abandonos.tentar()).toBe(1);
    expect(await abandonos.pendentes()).toBe(0);
    expect([...servidor.partidas.values()][0].situacao).toBe('Abandonada');
  });

  it('sair no meio: abandona a partida dele e o turno segue como local (de convidado)', async () => {
    const { servidor, nova, cliente } = await montar();
    const p = nova();
    await p.soltar();
    expect([...servidor.partidas.values()][0].situacao).toBe('Abandonada');
    expect(p.jogador).toBeNull();
    cliente.limparSessao();
    const extras = await p.concluir(resultado());
    expect(extras.mensagem).toMatch(/convidado/i);
    expect(extras.acao).toBeDefined();
  });

  it('abandonos de outro usuário do aparelho esperam por ele', async () => {
    const { servidor, nova, abandonos, cliente } = await montar();
    const p = nova();
    await new Promise(r => setTimeout(r, 0));
    servidor.rede = false;
    await p.desistir();
    servidor.rede = true;
    cliente.limparSessao();
    await cliente.login('bia', 's');
    expect(await abandonos.tentar()).toBe(0);
    expect(await abandonos.pendentes()).toBe(1);
  });
});

describe('recusas e falhas', () => {
  it('métricas inválidas: o servidor recusa, o jogador vê o motivo e a partida fica na fila como rejeitada', async () => {
    const { nova, fila } = await montar();
    const ruins: Metricas = { ...METRICAS, ordensAtrasadas: 150 }; // mais atrasadas que ordens
    const extras = await nova().concluir(resultado({ scoreCentesimos: 1234 }, ruins));
    expect(extras).toMatchObject({ envio: 'recusada' });
    expect(extras.mensagem).toMatch(/rejeitada/);
    const [item] = await fila.listar();
    expect(item).toMatchObject({ situacao: 'rejeitado', rejeicao: { codigo: 'metricas_invalidas' } });
  });

  it('a partida foi validada mas o ranking falhou: continua validada e diz que o ranking não carregou', async () => {
    const { servidor, nova } = await montar();
    servidor.falharProximas(1, { status: 500, corpo: { error: 'Internal Server Error' } }, c => c.caminho.includes('RankingPorCenario'));
    const extras = await nova().concluir(resultado());
    expect(extras.validadoServidor).toBe(true);
    expect(extras.ranking).toBeUndefined();
    expect(extras.mensagem).toMatch(/não foi possível carregar o ranking/i);
  });

  it('sem onde guardar E sem rede: "falhou" — o jogador precisa saber que perdeu a partida', async () => {
    const quebrado: ArmazenamentoJson = {
      ler: async () => undefined, remover: async () => undefined, chaves: async () => [],
      gravar: async () => { throw new Error('QuotaExceededError'); },
    };
    const { servidor, nova } = await montar({ armazenamento: quebrado });
    const p = nova();
    await new Promise(r => setTimeout(r, 0));
    servidor.rede = false;
    const extras = await p.concluir(resultado());
    expect(extras.envio).toBe('falhou');
    expect(extras.mensagem).toMatch(/Não foi possível guardar a partida/);
  });

  it('extras iniciais: "enviando" quando vai enviar; nada para convidado', async () => {
    expect((await montar()).nova().extrasIniciais()).toEqual({ envio: 'enviando' });
    expect((await montar({ logado: false })).nova().extrasIniciais()).toEqual({});
  });
});
