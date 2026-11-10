import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import { NpdevClient } from '../net/npdevClient';
import { ServidorFalso, type Chamada } from '../net/servidorFalso';
import type { PacoteCenario } from '../sim/model';
import { Simulacao, type ConsultaDestino } from '../sim/simulation';
import { sugerirDestino } from '../sim/wmsReal';
import { DecisorWmsReal, resumoDecisoes, type EstatisticaDecisoes } from './decisorWmsReal';

const pacoteA = whA as unknown as PacoteCenario;
const ehFlow = (c: Chamada) => c.caminho === '/flows/SugerirDestinoJogo/execute';

async function montar(opcoes: { logar?: boolean } = {}) {
  const servidor = new ServidorFalso({ pacotes: [pacoteA] });
  const cliente = new NpdevClient({ fetch: servidor.fetch });
  if (opcoes.logar !== false) await cliente.login('jogador', 'senha-certa');
  return { servidor, cliente };
}

const consulta = (candidatos: [string, number | null][], loteId = 'ORD-1'): ConsultaDestino => ({
  loteId, candidatos: candidatos.map(([localArmazenagemId, prioridade]) => ({ localArmazenagemId, loteOcupanteId: null, prioridade })),
});
const regra = (c: ConsultaDestino) => sugerirDestino(null, { loteId: c.loteId, candidatos: [...c.candidatos] }).localArmazenagemId;

/** O corpo do que o jogo mandou ao servidor na n-ésima pergunta. */
const enviado = (s: ServidorFalso, n = 0) => s.chamadas.filter(ehFlow)[n].corpo as { loteId: string; candidatos: { localArmazenagemId: string; prioridade: number | null }[] };

describe('DecisorWmsReal: com o servidor', () => {
  it('pergunta ao servidor, segue a resposta e só manda a faixa de melhor prioridade', async () => {
    const { servidor, cliente } = await montar();
    const d = new DecisorWmsReal(cliente);
    const c = consulta([['r2/01', 2], ['r1/02', 1], ['r1/01', 1], ['r3/01', 3], ['r1/10', 1]]);
    const resposta = await d.decidir(c);
    expect(resposta).toBe('r1/01'); // menor prioridade; empate pelo id em ordem de texto: 'r1/01' < 'r1/02' < 'r1/10'
    expect(servidor.contar(ehFlow)).toBe(1);
    expect(enviado(servidor).candidatos.map(k => k.localArmazenagemId).sort()).toEqual(['r1/01', 'r1/02', 'r1/10']);
    expect(enviado(servidor).loteId).toBe('ORD-1');
    expect(d.estatistica).toEqual({ servidor: 1, local: 0, divergencias: 0, falha: null });
  });

  it('quando o servidor escolhe diferente da regra do jogo, o jogo segue o servidor e conta a divergência', async () => {
    const { servidor, cliente } = await montar();
    servidor.escolhaDoDestino = e => e.candidatos![e.candidatos!.length - 1].localArmazenagemId;
    const d = new DecisorWmsReal(cliente);
    const c = consulta([['a', 1], ['b', 1], ['c', 1]]);
    expect(regra(c)).toBe('a');
    expect(await d.decidir(c)).toBe('c');
    expect(d.estatistica).toMatchObject({ servidor: 1, divergencias: 1, falha: null });
  });

  it('avisa quando começa e quando termina cada espera', async () => {
    const { cliente } = await montar();
    const eventos: boolean[] = [];
    const d = new DecisorWmsReal(cliente, { aoAguardar: a => eventos.push(a) });
    await d.decidir(consulta([['a', 1]]));
    await d.decidir(consulta([['a', 1]]));
    expect(eventos).toEqual([true, false, true, false]);
  });
});

describe('DecisorWmsReal: o servidor falha → a porta TS decide, sem insistir', () => {
  const c = consulta([['b', 1], ['a', 1]]);

  async function umaFalha(preparar: (s: ServidorFalso) => void, prazoMs?: number) {
    const { servidor, cliente } = await montar();
    preparar(servidor);
    const causas: string[] = [];
    const d = new DecisorWmsReal(cliente, { prazoMs, aoFalhar: x => causas.push(x) });
    const resposta = await d.decidir(c);
    return { servidor, cliente, d, causas, resposta };
  }

  it('rede caída: responde pela regra local, avisa uma vez e não pergunta mais neste turno', async () => {
    const { servidor, d, causas, resposta } = await umaFalha(s => { s.rede = false; });
    expect(resposta).toBe('a');
    expect(d.estatistica).toEqual({ servidor: 0, local: 1, divergencias: 0, falha: 'sem internet ou servidor fora do ar' });
    expect(causas).toEqual(['sem internet ou servidor fora do ar']);
    servidor.rede = true; // a rede volta, mas o turno já desistiu do servidor
    for (let i = 0; i < 5; i++) expect(d.decidir(c)).toBe('a'); // síncrono: nem espera
    expect(servidor.contar(ehFlow)).toBe(1);
    expect(d.estatistica).toMatchObject({ local: 6, falha: 'sem internet ou servidor fora do ar' });
    expect(causas).toHaveLength(1);
  });

  it('servidor que não responde no prazo', async () => {
    const { d, resposta } = await umaFalha(s => s.travarProximas(1, ehFlow), 25);
    expect(resposta).toBe('a');
    expect(d.estatistica.falha).toBe('o servidor não respondeu a tempo');
  });

  it('erro 500', async () => {
    const { d, resposta } = await umaFalha(s => s.falharProximas(1, { status: 500, corpo: { error: 'boom' } }, ehFlow));
    expect(resposta).toBe('a');
    expect(d.estatistica.falha).toBe('o servidor falhou');
  });

  it('flow que falha (422 system_exception, como na 1ª chamada depois de um rebuild)', async () => {
    const { d, resposta } = await umaFalha(s => s.falharProximas(1, { status: 422, corpo: { status: 'FAILED', errorCode: 'system_exception', error: 'plugin' } }, ehFlow));
    expect(resposta).toBe('a');
    expect(d.estatistica.falha).not.toBeNull();
  });

  it('sessão vencida (401): vira convidado, e a falha diz isso', async () => {
    const { d, resposta, cliente } = await umaFalha(s => s.falharProximas(1, { status: 401, corpo: { error: 'invalid_jwt' } }, ehFlow));
    expect(resposta).toBe('a');
    expect(d.estatistica.falha).toBe('sessão expirada');
    expect(cliente.logado).toBe(false);
  });

  it('servidor com defeito: devolve um local que não estava entre os candidatos', async () => {
    const { d, resposta } = await umaFalha(s => { s.escolhaDoDestino = () => 'inventado'; });
    expect(resposta).toBe('a');
    expect(d.estatistica.falha).toBe('resposta inesperada do servidor');
    expect(d.estatistica.divergencias).toBe(0); // resposta inválida não é "escolha diferente"
  });

  it('servidor que responde "sem sucesso" para candidatos que existem', async () => {
    const { d, resposta } = await umaFalha(s => s.falharProximas(1, { status: 200, corpo: { status: 'OK', output: { sucesso: false, localArmazenagemId: null, motivo: 'x' } } }, ehFlow));
    expect(resposta).toBe('a');
    expect(d.estatistica.falha).toBe('resposta inesperada do servidor');
  });
});

describe('DecisorWmsReal: sem servidor', () => {
  it('convidado: nenhuma chamada de rede; tudo pela regra do jogo', async () => {
    const { servidor, cliente } = await montar({ logar: false });
    const d = new DecisorWmsReal(cliente);
    d.aquecer();
    expect(d.decidir(consulta([['b', 1], ['a', 1]]))).toBe('a'); // síncrono
    expect(servidor.chamadas).toHaveLength(0);
    expect(d.estatistica).toEqual({ servidor: 0, local: 1, divergencias: 0, falha: null });
  });

  it('parar(): o turno acabou — nada mais é perguntado', async () => {
    const { servidor, cliente } = await montar();
    const d = new DecisorWmsReal(cliente);
    d.parar();
    expect(d.decidir(consulta([['a', 1]]))).toBe('a');
    d.aquecer();
    expect(servidor.contar(ehFlow)).toBe(0);
  });

  it('parar() com uma pergunta em voo: a espera termina na hora, a resposta que chega depois é descartada (vale a regra local) e a UI não é avisada de novo', async () => {
    const { cliente } = await montar();
    const eventos: boolean[] = [];
    const d = new DecisorWmsReal(cliente, { aoAguardar: a => eventos.push(a) });
    const c = consulta([['b', 1], ['a', 1]]);
    const voo = d.decidir(c) as Promise<string | null>;
    expect(eventos).toEqual([true]);
    d.parar();
    expect(eventos).toEqual([true, false]);
    expect(await voo).toBe('a');
    expect(d.estatistica).toMatchObject({ servidor: 0, local: 1 });
    expect(eventos).toEqual([true, false]);
  });
});

describe('DecisorWmsReal.aquecer', () => {
  it('faz uma pergunta à toa e ignora a resposta', async () => {
    const { servidor, cliente } = await montar();
    new DecisorWmsReal(cliente).aquecer();
    await new Promise(r => setTimeout(r, 10));
    expect(servidor.contar(ehFlow)).toBe(1);
    expect(enviado(servidor).loteId).toBe('aquecimento');
  });

  it('só uma vez por turno, mesmo chamado de dois lugares (início do turno e troca de política)', async () => {
    const { servidor, cliente } = await montar();
    const d = new DecisorWmsReal(cliente);
    d.aquecer();
    d.aquecer();
    await new Promise(r => setTimeout(r, 10));
    expect(servidor.contar(ehFlow)).toBe(1);
  });

  it('tenta de novo se a primeira falhar (a 1ª chamada depois de o servidor subir pode falhar) e não conta como falha do turno', async () => {
    const { servidor, cliente } = await montar();
    servidor.falharProximas(1, { status: 422, corpo: { status: 'FAILED', errorCode: 'system_exception', error: 'plugin' } }, ehFlow);
    const d = new DecisorWmsReal(cliente);
    d.aquecer();
    await new Promise(r => setTimeout(r, 20));
    expect(servidor.contar(ehFlow)).toBe(2);
    expect(d.estatistica.falha).toBeNull();
  });
});

describe('DecisorWmsReal dentro de um turno inteiro (WH-A) contra o servidor falso', () => {
  const turno = async (d: DecisorWmsReal) => {
    const sim = new Simulacao(pacoteA, 'WmsReal');
    for (let i = 0; i < pacoteA.cenario.fimTurnoSeg - pacoteA.cenario.inicioTurnoSeg; i++) {
      const espera = sim.tickSuspenso(d.decidir);
      if (espera) await espera;
    }
    return sim;
  };
  const offline = () => {
    const sim = new Simulacao(pacoteA, 'WmsReal');
    for (let i = 0; i < pacoteA.cenario.fimTurnoSeg - pacoteA.cenario.inicioTurnoSeg; i++) sim.tick();
    return sim;
  };
  const resultado = (s: Simulacao) => ({ m: s.metricas(), a: s.auditoria(), e: s.snapshot().eventos.map(x => `${x.seg} ${x.texto}`) });

  it('o servidor decide todos os paletes e o resultado é o mesmo do jogo offline (mesma regra)', async () => {
    const { servidor, cliente } = await montar();
    const d = new DecisorWmsReal(cliente);
    const sim = await turno(d);
    const ref = offline();
    expect(resultado(sim)).toEqual(resultado(ref));
    expect(d.estatistica.servidor).toBe(ref.auditoria().paletesGuardados); // uma pergunta por palete guardado
    expect(d.estatistica).toMatchObject({ local: 0, divergencias: 0, falha: null });
    expect(servidor.contar(ehFlow)).toBe(d.estatistica.servidor);
  }, 60_000);

  it('a rede cai no meio do turno: o resto vai pela regra local e o resultado continua o mesmo', async () => {
    const { servidor, cliente } = await montar();
    const d = new DecisorWmsReal(cliente);
    const sim = new Simulacao(pacoteA, 'WmsReal');
    for (let i = 0; i < pacoteA.cenario.fimTurnoSeg - pacoteA.cenario.inicioTurnoSeg; i++) {
      if (d.estatistica.servidor === 10) servidor.rede = false;
      const espera = sim.tickSuspenso(d.decidir);
      if (espera) await espera;
    }
    expect(resultado(sim)).toEqual(resultado(offline()));
    expect(d.estatistica.servidor).toBe(10);
    expect(d.estatistica.local).toBeGreaterThan(0);
    expect(d.estatistica.falha).toBe('sem internet ou servidor fora do ar');
  }, 60_000);

  it('o servidor discorda da regra do jogo em todas as respostas: o jogo segue o servidor e conta', async () => {
    const { servidor, cliente } = await montar();
    servidor.escolhaDoDestino = e => e.candidatos![e.candidatos!.length - 1].localArmazenagemId;
    const d = new DecisorWmsReal(cliente);
    const sim = await turno(d);
    const e = d.estatistica;
    expect(e.servidor).toBeGreaterThan(0);
    expect(e.divergencias).toBeGreaterThan(0);
    expect(e.divergencias).toBeLessThanOrEqual(e.servidor);
    expect(resultado(sim)).not.toEqual(resultado(offline()));
  }, 60_000);
});

describe('resumoDecisoes', () => {
  const est = (p: Partial<EstatisticaDecisoes>): EstatisticaDecisoes => ({ servidor: 0, local: 0, divergencias: 0, falha: null, ...p });

  it('sem nenhum palete decidido pelo WmsReal: nada a dizer', () => {
    expect(resumoDecisoes(est({}))).toBeNull();
  });
  it('tudo pelo servidor e igual à regra do jogo', () => {
    expect(resumoDecisoes(est({ servidor: 56 }))).toBe('WMS Office Real: o servidor escolheu o destino de todos os 56 paletes. Todas iguais à regra do jogo.');
    expect(resumoDecisoes(est({ servidor: 1 }))).toBe('WMS Office Real: o servidor escolheu o destino do único palete. Igual à regra do jogo.');
  });
  it('divergência aparece', () => {
    expect(resumoDecisoes(est({ servidor: 10, divergencias: 3 }))).toBe(
      'WMS Office Real: o servidor escolheu o destino de todos os 10 paletes. Em 3 delas a escolha do servidor foi diferente da regra do jogo; o jogo seguiu o servidor.');
  });
  it('convidado: diz que foi sem o servidor', () => {
    expect(resumoDecisoes(est({ local: 56 }))).toContain('WMS Office Real jogada sem o servidor: 56 paletes');
  });
  it('queda do servidor: diz a causa e quantos foram de cada lado', () => {
    const t = resumoDecisoes(est({ servidor: 10, local: 46, falha: 'o servidor não respondeu a tempo' }))!;
    expect(t).toContain('o servidor respondeu por 10 paletes e depois parou (o servidor não respondeu a tempo)');
    expect(t).toContain('os outros 46 foram guardados pela regra do jogo, que é a mesma do servidor');
    expect(resumoDecisoes(est({ local: 5, falha: 'sem internet ou servidor fora do ar' }))).toContain('o servidor não respondeu (sem internet ou servidor fora do ar); 5 paletes foram guardados');
  });
  it('login no meio do turno: parte local, parte do servidor', () => {
    expect(resumoDecisoes(est({ servidor: 8, local: 2 }))).toBe(
      'WMS Office Real: o servidor escolheu o destino de 8 paletes; os outros 2 vieram da regra do jogo. As do servidor foram iguais à regra do jogo.');
  });
});
