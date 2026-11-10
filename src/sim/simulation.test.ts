import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import { POLITICAS, type Metricas, type PacoteCenario, type Politica } from './model';
import { calcularScore } from './score';
import { ESPERA_CROSSDOCK_SEG, formatarHora, Simulacao } from './simulation';

const pacoteA = whA as unknown as PacoteCenario;
const pacoteB = whB as unknown as PacoteCenario;
const duracao = (p: PacoteCenario) => p.cenario.fimTurnoSeg - p.cenario.inicioTurnoSeg;

function rodar(sim: Simulacao, ticks: number) {
  for (let i = 0; i < ticks; i++) sim.tick();
}

function turnoCompleto(p: PacoteCenario, politica: Politica): Simulacao {
  const sim = new Simulacao(p, politica);
  rodar(sim, duracao(p));
  return sim;
}

describe('Simulacao: relógio, ordens e log', () => {
  it('começa no início do turno, com todos os locais, equipamentos e estoque inicial', () => {
    const s = new Simulacao(pacoteA, 'AbcProximidade').snapshot();
    expect(s.relogioSeg).toBe(pacoteA.cenario.inicioTurnoSeg);
    expect(s.locais.size).toBe(48);
    expect(s.equipamentos).toHaveLength(pacoteA.cenario.qtdEquipamentos);
    expect(s.ordensLiberadas).toBe(0);
    expect(s.terminado).toBe(false);
    expect(s.ocupacaoCentesimos).toBe(Math.round((29 * 10_000) / 48)); // 60% de 48 = 29 paletes
  });

  it('libera as ordens no horário de liberação', () => {
    const sim = new Simulacao(pacoteA, 'AbcProximidade');
    const ate = 32400; // 09:00
    rodar(sim, ate - pacoteA.cenario.inicioTurnoSeg);
    const esperado = pacoteA.ordens.filter(o => o.liberacaoSeg <= ate).length;
    expect(esperado).toBeGreaterThan(0);
    expect(sim.snapshot().ordensLiberadas).toBe(esperado);
    expect(sim.snapshot().eventos[0].seg).toBeLessThanOrEqual(ate);
  });

  it('para no fim do turno, com todas as ordens liberadas e o score final no log', () => {
    const sim = new Simulacao(pacoteA, 'FifoPrimeiraLivre');
    rodar(sim, duracao(pacoteA) + 500);
    const s = sim.snapshot();
    expect(s.terminado).toBe(true);
    expect(s.relogioSeg).toBe(pacoteA.cenario.fimTurnoSeg);
    expect(s.ordensLiberadas).toBe(pacoteA.ordens.length);
    expect(s.eventos[0].texto).toMatch(/^Score final \d+\.\d\d — /);
    expect(s.eventos[1].texto).toBe('Fim do turno.');
  });

  it('troca de política é registrada', () => {
    const sim = new Simulacao(pacoteA, 'AbcProximidade');
    sim.setPolitica('FifoPrimeiraLivre');
    expect(sim.snapshot().politica).toBe('FifoPrimeiraLivre');
    expect(sim.snapshot().eventos[0].texto).toContain('FifoPrimeiraLivre');
  });

  it('as cinco políticas existem e nenhuma avisa de fallback', () => {
    for (const politica of POLITICAS) {
      const sim = new Simulacao(pacoteA, politica);
      rodar(sim, 3600);
      expect(sim.snapshot().eventos.some(e => /chega na F3|fallback/i.test(e.texto)), politica).toBe(false);
    }
  });

  it('formatarHora', () => {
    expect(formatarHora(28800)).toBe('08:00:00');
    expect(formatarHora(64799)).toBe('17:59:59');
  });
});

describe('Simulacao: determinismo e golden tests', () => {
  it('mesmo cenário + mesma política → log e métricas idênticos', () => {
    const a = turnoCompleto(pacoteA, 'AbcProximidade');
    const b = turnoCompleto(pacoteA, 'AbcProximidade');
    expect(a.snapshot().eventos).toEqual(b.snapshot().eventos);
    expect(a.metricas()).toEqual(b.metricas());
  });

  // Estes números mudam se QUALQUER regra do motor mudar (tempos, despacho, estoque inicial, distância teórica…).
  // Mudança intencional: confira o efeito no jogo e atualize aqui junto com o docs/PLANO.md.
  const dourado: [string, PacoteCenario, Politica, Metricas, number][] = [
    ['WH-A Abc', pacoteA, 'AbcProximidade',
      { distanciaRealCm: 334700, distanciaTeoricaCm: 307050, ordensTotal: 60, ordensAtrasadas: 2, eventosConflito: 12, ocupacaoFinalCentesimos: 7708 }, 8552],
    ['WH-A Fifo', pacoteA, 'FifoPrimeiraLivre',
      { distanciaRealCm: 349860, distanciaTeoricaCm: 307050, ordensTotal: 60, ordensAtrasadas: 2, eventosConflito: 26, ocupacaoFinalCentesimos: 7708 }, 8379],
    ['WH-B Abc', pacoteB, 'AbcProximidade',
      { distanciaRealCm: 8262925, distanciaTeoricaCm: 5840060, ordensTotal: 400, ordensAtrasadas: 1, eventosConflito: 234, ocupacaoFinalCentesimos: 5972 }, 7038],
    ['WH-B Fifo', pacoteB, 'FifoPrimeiraLivre',
      { distanciaRealCm: 9060245, distanciaTeoricaCm: 5840060, ordensTotal: 400, ordensAtrasadas: 1, eventosConflito: 378, ocupacaoFinalCentesimos: 5972 }, 6560],
    ['WH-A Consolidacao', pacoteA, 'Consolidacao',
      { distanciaRealCm: 343930, distanciaTeoricaCm: 307050, ordensTotal: 60, ordensAtrasadas: 2, eventosConflito: 26, ocupacaoFinalCentesimos: 7708 }, 8447],
    ['WH-B Consolidacao', pacoteB, 'Consolidacao',
      { distanciaRealCm: 8082060, distanciaTeoricaCm: 5840060, ordensTotal: 400, ordensAtrasadas: 1, eventosConflito: 389, ocupacaoFinalCentesimos: 5972 }, 7146],
    ['WH-A CrossDocking', pacoteA, 'CrossDocking',
      { distanciaRealCm: 334700, distanciaTeoricaCm: 307050, ordensTotal: 60, ordensAtrasadas: 2, eventosConflito: 12, ocupacaoFinalCentesimos: 7708 }, 8552],
    ['WH-B CrossDocking', pacoteB, 'CrossDocking',
      { distanciaRealCm: 8234875, distanciaTeoricaCm: 5840060, ordensTotal: 400, ordensAtrasadas: 1, eventosConflito: 231, ocupacaoFinalCentesimos: 5972 }, 7055],
    // WmsReal = FIFO aqui: o RankingRua dos cenários é a própria ordem das ruas e cada local guarda um palete (sem
    // "completar pallet"), então a regra do WMS Office degenera para a primeira posição livre. Se os seeds ganharem
    // ranking de verdade, estes números mudam e está certo.
    ['WH-A WmsReal', pacoteA, 'WmsReal',
      { distanciaRealCm: 349860, distanciaTeoricaCm: 307050, ordensTotal: 60, ordensAtrasadas: 2, eventosConflito: 26, ocupacaoFinalCentesimos: 7708 }, 8379],
    ['WH-B WmsReal', pacoteB, 'WmsReal',
      { distanciaRealCm: 9060245, distanciaTeoricaCm: 5840060, ordensTotal: 400, ordensAtrasadas: 1, eventosConflito: 378, ocupacaoFinalCentesimos: 5972 }, 6560],
  ];
  it.each(dourado)('%s', (_, pacote, politica, metricas, score) => {
    const sim = turnoCompleto(pacote, politica);
    expect(sim.metricas()).toEqual(metricas);
    const r = sim.snapshot().score;
    expect(r.sucesso && r.scoreCentesimos).toBe(score);
  });

  it('a política importa: ABC por proximidade anda menos e pontua mais que FIFO nos dois cenários', () => {
    for (const p of [pacoteA, pacoteB]) {
      const abc = turnoCompleto(p, 'AbcProximidade').snapshot();
      const fifo = turnoCompleto(p, 'FifoPrimeiraLivre').snapshot();
      expect(abc.metricas.distanciaRealCm).toBeLessThan(fifo.metricas.distanciaRealCm);
      expect(abc.score.sucesso && fifo.score.sucesso && abc.score.scoreCentesimos > fifo.score.scoreCentesimos).toBe(true);
    }
  });
});

const casosPoliticas = [pacoteA, pacoteB].flatMap((p, i) => POLITICAS.map(pol => [`${i === 0 ? 'WH-A' : 'WH-B'} ${pol}`, p, pol] as const));

describe.each(casosPoliticas)('Simulacao: invariantes %s', (_, pacote, politica) => {
  it('durante o turno todo: conserva paletes, um equipamento por corredor, distância = deslocamento', () => {
    const sim = new Simulacao(pacote, politica);
    let andado = 0;
    const violacoes: string[] = [];
    let anterior = sim.snapshot().equipamentos.map(e => ({ ...e.posicao }));
    let esperaramPorCorredor = false;

    for (let t = 0; t < duracao(pacote); t++) {
      sim.tick();
      const s = sim.snapshot();
      s.equipamentos.forEach((e, i) => {
        andado += Math.abs(e.posicao.x - anterior[i].x) + Math.abs(e.posicao.y - anterior[i].y);
        anterior[i] = { ...e.posicao };
        if (e.posicao.x < 0 || e.posicao.x > s.layout.largura || e.posicao.y < 0 || e.posicao.y > s.layout.altura) {
          violacoes.push(`${e.id} fora do armazém em t=${t}`);
        }
        if (e.estado === 'Aguardando') esperaramPorCorredor = true;
      });
      const dentro = new Map<string, number>();
      for (const e of s.equipamentos) {
        if (e.ruaId !== null && e.estado !== 'Aguardando') dentro.set(e.ruaId, (dentro.get(e.ruaId) ?? 0) + 1);
      }
      for (const [rua, n] of dentro) if (n > 1) violacoes.push(`${n} equipamentos no corredor ${rua} em t=${t}`);

      if (t % 60 === 0) { // conservação: nenhum palete some nem aparece
        const a = sim.auditoria();
        if (ocupados(sim) !== a.estoqueInicial + a.paletesGuardados - a.paletesRetirados) violacoes.push(`paletes não conservados em t=${t}`);
        for (const e of s.locais.values()) { // produto num local livre (ou local ocupado/reservado sem produto) = estado incoerente
          if ((e.situacao === 'Disponivel' || e.situacao === 'Bloqueado') !== (e.produtoId === null)) { violacoes.push(`estado de local incoerente em t=${t}`); break; }
        }
      }
    }
    expect(violacoes).toEqual([]);
    expect(andado).toBe(sim.metricas().distanciaRealCm);
    expect(esperaramPorCorredor).toBe(sim.metricas().eventosConflito > 0);
  });

  it('no fim: ordens concluídas + abertas = total; atrasadas incluem as abertas vencidas; score = fórmula oficial', () => {
    const sim = turnoCompleto(pacote, politica);
    const s = sim.snapshot();
    expect(s.terminado).toBe(true);
    expect(s.ordensConcluidas).toBeLessThanOrEqual(s.ordensTotal);
    expect(s.metricas.ordensAtrasadas).toBeGreaterThanOrEqual(s.ordensTotal - s.ordensConcluidas);
    expect(s.metricas.ordensAtrasadas).toBeLessThanOrEqual(s.ordensTotal);
    expect(s.score).toEqual(calcularScore(s.metricas));
    expect(s.metricas.distanciaTeoricaCm).toBeGreaterThan(0);
    expect(s.metricas.distanciaRealCm).toBeGreaterThan(0);
  });

  it('heatmap real: as operações incrementam os acessos das posições', () => {
    const sim = turnoCompleto(pacote, politica);
    const acessos = [...sim.snapshot().locais.values()].reduce((n, l) => n + l.acessos, 0);
    expect(acessos).toBeGreaterThan(0);
  });
});

describe('Simulacao: situações limite', () => {
  it('saída maior que o estoque espera (não inventa palete) e vira atraso', () => {
    const p = structuredClone(pacoteA);
    p.ordens = [{ id: 'x', numero: 'OUT-X', tipo: 'Outbound', liberacaoSeg: p.cenario.inicioTurnoSeg + 10,
      slaSeg: 600, produtoId: 'WHAprod01', quantidadePaletes: 100 }]; // o armazém inteiro tem 48 locais
    const sim = turnoCompleto(p, 'AbcProximidade');
    const s = sim.snapshot();
    expect(s.ordensConcluidas).toBe(0);
    expect(s.metricas.ordensAtrasadas).toBe(1);
  });

  it('armazém cheio: o putaway espera um local livre e retoma quando uma saída libera', () => {
    const p = structuredClone(pacoteA);
    const armazenagem = new Set(p.areas.filter(a => a.funcao === 'Armazenagem').map(a => a.id));
    const ruasArm = new Set(p.ruas.filter(r => armazenagem.has(r.areaId)).map(r => r.id));
    // só 2 locais utilizáveis: 60% de 2 = 1 palete de estoque inicial, sobra 1 livre
    const usaveis = p.locais.filter(l => ruasArm.has(l.ruaId)).slice(0, 2).map(l => l.id);
    p.locais = p.locais.map(l => ruasArm.has(l.ruaId) && !usaveis.includes(l.id) ? { ...l, situacao: 'Bloqueado' as const } : l);
    const produto = 'WHAprod01';
    const t0 = p.cenario.inicioTurnoSeg;
    p.ordens = [
      { id: 'i', numero: 'IN-X', tipo: 'Inbound', liberacaoSeg: t0 + 1, slaSeg: 7200, produtoId: produto, quantidadePaletes: 2 },
      { id: 'o', numero: 'OUT-X', tipo: 'Outbound', liberacaoSeg: t0 + 1500, slaSeg: 7200, produtoId: produto, quantidadePaletes: 1 },
    ];
    const sim = new Simulacao(p, 'AbcProximidade');
    expect(sim.auditoria().estoqueInicial).toBe(1);
    rodar(sim, 1400); // descarga (300 s) + 1º putaway; o 2º palete não tem local e a saída ainda não foi liberada
    expect(sim.snapshot().ordensConcluidas).toBe(0);
    expect(sim.snapshot().tarefasPendentes).toBe(1);
    rodar(sim, duracao(p) - 1400); // a saída libera um local e o 2º palete é guardado
    const s = sim.snapshot();
    expect(s.ordensConcluidas).toBe(2);
    expect(s.tarefasPendentes).toBe(0);
    const a = sim.auditoria();
    expect([a.paletesGuardados, a.paletesRetirados]).toEqual([2, 1]);
    expect(ocupados(sim)).toBe(2);
  });
});

describe('Simulacao: cross-docking', () => {
  const produto = 'WHAprod01';
  const t0 = pacoteA.cenario.inicioTurnoSeg;

  /** Só o produto tem giro de saída, então todo o estoque inicial é dele (29 paletes no WH-A). */
  function cenario(qtdSaida: number) {
    const p = structuredClone(pacoteA);
    p.ordens = [
      { id: 'i', numero: 'IN-X', tipo: 'Inbound', liberacaoSeg: t0 + 1, slaSeg: 7200, produtoId: produto, quantidadePaletes: 2 },
      { id: 'o', numero: 'OUT-X', tipo: 'Outbound', liberacaoSeg: t0 + 10, slaSeg: 7200, produtoId: produto, quantidadePaletes: qtdSaida },
    ];
    return p;
  }

  it('saída que só fecha com os paletes recém-descarregados: eles vão direto da doca de entrada para a de saída', () => {
    const p = cenario(31); // estoque 29 + 2 que chegam
    const sim = new Simulacao(p, 'CrossDocking');
    expect(sim.auditoria().estoqueInicial).toBe(29);
    rodar(sim, duracao(p));
    const s = sim.snapshot();
    const a = sim.auditoria();
    expect(s.ordensConcluidas).toBe(2);
    expect(s.metricas.ordensAtrasadas).toBe(0);
    expect(a.paletesCruzados).toBe(2);
    expect([a.paletesGuardados, a.paletesRetirados]).toEqual([0, 29]); // os 2 cruzados nunca entram no estoque
    expect(ocupados(sim)).toBe(0);
    expect(s.eventos.some(e => e.texto.includes('2 direto da entrada (cross-docking)'))).toBe(true);
  });

  it('sem a política, os mesmos paletes são guardados e depois retirados', () => {
    const p = cenario(31);
    const sim = new Simulacao(p, 'AbcProximidade');
    rodar(sim, duracao(p));
    const a = sim.auditoria();
    expect(sim.snapshot().ordensConcluidas).toBe(2);
    expect([a.paletesCruzados, a.paletesGuardados, a.paletesRetirados]).toEqual([0, 2, 31]);
  });

  it('o palete segurado espera no máximo ESPERA_CROSSDOCK_SEG; depois vai para o estoque', () => {
    const p = cenario(40); // 29 + 2 < 40: a saída nunca fecha, então o desvio nunca acontece
    const sim = new Simulacao(p, 'CrossDocking');
    rodar(sim, 301 + 300); // descarga pronta há ~300 s
    expect(sim.snapshot().tarefasPendentes).toBe(2);
    expect(sim.auditoria().paletesGuardados).toBe(0);
    rodar(sim, 301 + ESPERA_CROSSDOCK_SEG + 300 - 601);
    expect(sim.auditoria().paletesGuardados).toBe(2);
    expect(sim.auditoria().paletesCruzados).toBe(0);
  });
});

function ocupados(sim: Simulacao): number {
  let n = 0;
  for (const l of sim.snapshot().locais.values()) if (l.situacao === 'Ocupado') n++;
  return n;
}
