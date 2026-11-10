// `Simulacao.tickSuspenso`: o destino do WmsReal vem de um decisor externo (o servidor) que pode demorar.
// O que importa: com as mesmas respostas o turno dá o MESMO resultado, não importa quanto o decisor demore, e o motor
// nunca fica preso nem quebra um invariante por causa de uma resposta ruim.

import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import type { PacoteCenario } from './model';
import { Simulacao, type ConsultaDestino, type DecisorDestino } from './simulation';
import { sugerirDestino } from './wmsReal';

const pacoteA = whA as unknown as PacoteCenario;
const pacoteB = whB as unknown as PacoteCenario;
const duracao = (p: PacoteCenario) => p.cenario.fimTurnoSeg - p.cenario.inicioTurnoSeg;

/** A regra do jogo como decisor: o que o servidor responde quando concorda com a porta TS. */
const regra = (c: ConsultaDestino): string | null => {
  const r = sugerirDestino(null, { loteId: c.loteId, candidatos: [...c.candidatos] });
  return r.sucesso ? r.localArmazenagemId : null;
};

const atrasar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Roda o turno todo pelo caminho assíncrono, esperando cada tick que suspende. */
async function turnoSuspenso(p: PacoteCenario, decisor: DecisorDestino): Promise<{ sim: Simulacao; esperas: number }> {
  const sim = new Simulacao(p, 'WmsReal');
  let esperas = 0;
  for (let i = 0; i < duracao(p); i++) {
    const espera = sim.tickSuspenso(decisor);
    if (espera) { esperas++; await espera; }
  }
  return { sim, esperas };
}

function turnoSincrono(p: PacoteCenario): Simulacao {
  const sim = new Simulacao(p, 'WmsReal');
  for (let i = 0; i < duracao(p); i++) sim.tick();
  return sim;
}

/** Tudo o que um turno produz e que não pode mudar: métricas, contadores, score e o log inteiro (com os horários). */
const impressao = (s: Simulacao) => {
  const snap = s.snapshot();
  return { metricas: s.metricas(), auditoria: s.auditoria(), score: snap.score, eventos: snap.eventos.map(e => `${e.seg} ${e.texto}`) };
};

describe('tickSuspenso: mesmo resultado do tick síncrono', () => {
  it.each([['WH-A', pacoteA], ['WH-B', pacoteB]] as const)('%s: decisor síncrono com a regra do jogo = tick()', async (_n, p) => {
    const { sim, esperas } = await turnoSuspenso(p, regra);
    expect(esperas).toBe(0); // resposta imediata: nunca suspende
    expect(impressao(sim)).toEqual(impressao(turnoSincrono(p)));
  });

  it.each([['WH-A', pacoteA], ['WH-B', pacoteB]] as const)('%s: decisor assíncrono (servidor) com a mesma regra = tick(), seja qual for a demora', async (_n, p) => {
    let n = 0;
    const lento: DecisorDestino = async c => { await atrasar(n++ % 3); return regra(c); };
    const { sim, esperas } = await turnoSuspenso(p, lento);
    expect(esperas).toBeGreaterThan(0);
    expect(impressao(sim)).toEqual(impressao(turnoSincrono(p)));
  }, 60_000);

  it('outras políticas ignoram o decisor (e não suspendem)', () => {
    const sim = new Simulacao(pacoteA, 'AbcProximidade');
    let chamado = 0;
    for (let i = 0; i < duracao(pacoteA); i++) {
      expect(sim.tickSuspenso(() => { chamado++; return null; })).toBeNull();
    }
    expect(chamado).toBe(0);
    const ref = new Simulacao(pacoteA, 'AbcProximidade');
    for (let i = 0; i < duracao(pacoteA); i++) ref.tick();
    expect(impressao(sim)).toEqual(impressao(ref));
  });

  it('a consulta traz o lote e os locais livres com a prioridade da rua', async () => {
    const vistas: ConsultaDestino[] = [];
    await turnoSuspenso(pacoteA, c => { vistas.push(c); return regra(c); });
    expect(vistas.length).toBeGreaterThan(0);
    const ordensDeEntrada = new Set(pacoteA.ordens.filter(o => o.tipo === 'Inbound').map(o => o.id));
    for (const c of vistas) {
      expect(ordensDeEntrada.has(c.loteId)).toBe(true);
      expect(c.candidatos.length).toBeGreaterThan(0);
      for (const k of c.candidatos) expect(k.loteOcupanteId ?? null).toBeNull(); // um palete por local: ninguém é do mesmo lote
    }
  });
});

describe('tickSuspenso: o tick fica parado no meio até a resposta', () => {
  /** Avança até o primeiro tick que pergunta e devolve a promessa pendente com a função que a responde. */
  function ateAPrimeiraPergunta(sim: Simulacao) {
    let responder!: (v: string | null) => void;
    let consulta!: ConsultaDestino;
    const decisor: DecisorDestino = c => { consulta = c; return new Promise<string | null>(r => { responder = r; }); };
    for (let i = 0; i < 20_000; i++) {
      const espera = sim.tickSuspenso(decisor);
      if (espera) return { espera, responder, consulta };
    }
    throw new Error('o turno inteiro passou sem uma pergunta de destino');
  }

  it('enquanto espera, nada anda; ao responder, o tick termina e o turno segue', async () => {
    const sim = new Simulacao(pacoteA, 'WmsReal');
    const { espera, responder, consulta } = ateAPrimeiraPergunta(sim);
    const relogio = sim.snapshot().relogioSeg;
    const guardados = sim.auditoria().paletesGuardados;

    sim.tick(); // chamar de novo com o tick pendente não anda
    expect(sim.tickSuspenso(() => null)).toBe(espera); // e devolve a mesma promessa
    expect(sim.snapshot().relogioSeg).toBe(relogio);

    let terminou = false;
    void espera.then(() => { terminou = true; });
    await atrasar(5);
    expect(terminou).toBe(false);

    responder(regra(consulta));
    await espera;
    expect(terminou).toBe(true);
    expect(sim.snapshot().relogioSeg).toBe(relogio); // o tick que estava parado é o mesmo: ainda não começou outro
    expect(sim.tickSuspenso(regra)).toBeNull();
    expect(sim.snapshot().relogioSeg).toBe(relogio + 1);
    expect(sim.auditoria().paletesGuardados).toBeGreaterThanOrEqual(guardados);
  });
});

describe('tickSuspenso: o último tick do turno suspenso', () => {
  it('o turno só "termina" quando o último tick termina: sem resultado pela metade', async () => {
    // acha o relógio do 1º tick que pergunta e faz dele o ÚLTIMO tick do turno
    const sonda = new Simulacao(pacoteA, 'WmsReal');
    let relogioDaPergunta = 0;
    for (let i = 0; i < 20_000 && relogioDaPergunta === 0; i++) {
      sonda.tickSuspenso(() => { relogioDaPergunta = sonda.snapshot().relogioSeg; return null; });
    }
    expect(relogioDaPergunta).toBeGreaterThan(0);
    const curto: PacoteCenario = { ...pacoteA, cenario: { ...pacoteA.cenario, fimTurnoSeg: relogioDaPergunta } };

    const sim = new Simulacao(curto, 'WmsReal');
    let responder!: (v: string | null) => void;
    let consulta!: ConsultaDestino;
    let espera: Promise<void> | null = null;
    while (!espera) espera = sim.tickSuspenso(c => { consulta = c; return new Promise<string | null>(r => { responder = r; }); });

    expect(sim.snapshot().relogioSeg).toBe(relogioDaPergunta); // o tempo esgotou…
    expect(sim.terminado).toBe(false);                          // …mas o tick ainda não terminou
    expect(sim.snapshot().terminado).toBe(false);
    expect(sim.snapshot().eventos.some(e => e.texto === 'Fim do turno.')).toBe(false);
    sim.setPolitica('AbcProximidade');                          // no último segundo nada mais é alocado: não vira troca
    expect(sim.trocasPolitica()).toHaveLength(1);

    responder(regra(consulta));
    await espera;
    expect(sim.terminado).toBe(true);
    expect(sim.snapshot().eventos[1].texto).toBe('Fim do turno.');
    expect(sim.tickSuspenso(regra)).toBeNull(); // depois do fim, nada anda
    expect(sim.snapshot().relogioSeg).toBe(relogioDaPergunta);
  });
});

describe('tickSuspenso: respostas ruins não travam nem quebram o motor', () => {
  const comoOffline = (p: PacoteCenario) => impressao(turnoSincrono(p));

  it('decisor que rejeita, que lança ou que devolve lixo: cai na porta TS e o resultado é o do jogo', async () => {
    const falhas: DecisorDestino[] = [
      () => Promise.reject(new Error('caiu')),
      () => { throw new Error('lançou'); },
      () => 'nao-existe',
      () => Promise.resolve('tambem-nao-existe'),
    ];
    for (const f of falhas) {
      const { sim } = await turnoSuspenso(pacoteA, f);
      expect(impressao(sim)).toEqual(comoOffline(pacoteA));
    }
  });

  it('um local que não está livre (já ocupado) também cai na porta TS', async () => {
    // o 1º local do layout começa ocupado no WH-A (estoque inicial) ou livre; pega um que sabidamente não está livre
    const probe = new Simulacao(pacoteA, 'WmsReal');
    const ocupado = [...probe.snapshot().locais].find(([, e]) => e.situacao === 'Ocupado')![0];
    const { sim } = await turnoSuspenso(pacoteA, () => ocupado);
    expect(impressao(sim)).toEqual(comoOffline(pacoteA));
  });

  it('sem destino (null): o palete espera, como quando não há local livre — e o motor segue', async () => {
    const sim = new Simulacao(pacoteA, 'WmsReal');
    let perguntas = 0;
    for (let i = 0; i < 6_000; i++) await sim.tickSuspenso(() => { perguntas++; return null; });
    expect(perguntas).toBeGreaterThan(0);
    expect(sim.snapshot().tarefasPendentes).toBeGreaterThan(0); // os paletes ficam esperando…
    expect(sim.auditoria().paletesGuardados).toBe(0); // …e nada foi guardado
  });
});

describe('tickSuspenso: o decisor manda', () => {
  it('um decisor que escolhe outro local livre muda o turno, e os invariantes de paletes continuam valendo', async () => {
    // a última opção em vez da melhor: válido para o motor, diferente do que a regra faria
    const ultimo: DecisorDestino = c => c.candidatos[c.candidatos.length - 1].localArmazenagemId;
    const { sim } = await turnoSuspenso(pacoteA, ultimo);
    const a = sim.auditoria();
    const s = sim.snapshot();
    let ocupados = 0;
    for (const e of s.locais.values()) if (e.situacao === 'Ocupado') ocupados++;
    // conservação de paletes: ocupados = inicial + guardados − retirados (como nos invariantes da F2)
    expect(ocupados).toBe(a.estoqueInicial + a.paletesGuardados - a.paletesRetirados);
    expect(a.paletesGuardados).toBeGreaterThan(0);
    expect(impressao(sim).eventos).not.toEqual(impressao(turnoSincrono(pacoteA)).eventos);
  });
});
