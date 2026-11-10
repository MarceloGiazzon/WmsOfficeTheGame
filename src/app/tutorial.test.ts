import { describe, expect, it } from 'vitest';
import {
  CHAVE_TUTORIAL_VISTO, ESTADO_FECHADO, PASSOS_TUTORIAL, deveMostrarTutorial, marcarTutorialVisto, podeVoltar,
  rotuloProgresso, rotuloProximo, transicao, tutorialJaVisto, type ArmazenamentoMinimo, type EstadoTutorial,
} from './tutorial';

const total = PASSOS_TUTORIAL.length;

function armazemFalso(): ArmazenamentoMinimo & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return { dados, getItem: k => dados.get(k) ?? null, setItem: (k, v) => { dados.set(k, v); } };
}

const armazemQueLanca = (): ArmazenamentoMinimo => ({
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
});

describe('passos do tutorial', () => {
  it('são de 6 a 8, com id único, texto curto e pelo menos um alvo cada', () => {
    expect(total).toBeGreaterThanOrEqual(6);
    expect(total).toBeLessThanOrEqual(8);
    expect(new Set(PASSOS_TUTORIAL.map(p => p.id)).size).toBe(total);
    for (const p of PASSOS_TUTORIAL) {
      expect(p.titulo.length).toBeGreaterThan(0);
      expect(p.texto.length).toBeLessThanOrEqual(260); // cabe num celular em paisagem
      expect(p.alvos.length).toBeGreaterThan(0);
    }
  });

  it('cobrem o que o jogador precisa: mapa, relógio, ordens/SLA, score, política, inspector e log', () => {
    const ids = PASSOS_TUTORIAL.map(p => p.id);
    for (const id of ['mapa', 'relogio', 'ordens', 'score', 'politica', 'inspector', 'log']) expect(ids).toContain(id);
  });

  it('só o passo do log abre a gaveta', () => {
    expect(PASSOS_TUTORIAL.filter(p => p.abreGaveta).map(p => p.id)).toEqual(['log']);
  });
});

describe('transicao', () => {
  it('abrir começa no primeiro passo; abrir de novo não reinicia', () => {
    const aberto = transicao(ESTADO_FECHADO, 'abrir', total);
    expect(aberto).toEqual({ estado: { aberto: true, indice: 0 }, fim: null });
    const noMeio: EstadoTutorial = { aberto: true, indice: 3 };
    expect(transicao(noMeio, 'abrir', total).estado).toBe(noMeio);
  });

  it('próximo avança até o último passo e aí conclui', () => {
    let e: EstadoTutorial = transicao(ESTADO_FECHADO, 'abrir', total).estado;
    for (let i = 1; i < total; i++) {
      const t = transicao(e, 'proximo', total);
      expect(t.fim).toBeNull();
      expect(t.estado.indice).toBe(i);
      e = t.estado;
    }
    const fim = transicao(e, 'proximo', total);
    expect(fim.fim).toBe('concluido');
    expect(fim.estado).toEqual(ESTADO_FECHADO);
  });

  it('anterior volta um passo e para no primeiro', () => {
    expect(transicao({ aberto: true, indice: 2 }, 'anterior', total).estado.indice).toBe(1);
    expect(transicao({ aberto: true, indice: 0 }, 'anterior', total).estado.indice).toBe(0);
  });

  it('pular fecha de qualquer passo, marcando "pulado"', () => {
    for (const indice of [0, 3, total - 1]) {
      expect(transicao({ aberto: true, indice }, 'pular', total)).toEqual({ estado: ESTADO_FECHADO, fim: 'pulado' });
    }
  });

  it('com o tutorial fechado, navegar não faz nada', () => {
    for (const ev of ['proximo', 'anterior', 'pular'] as const) {
      expect(transicao(ESTADO_FECHADO, ev, total)).toEqual({ estado: ESTADO_FECHADO, fim: null });
    }
  });
});

describe('rótulos', () => {
  it('progresso e botão principal', () => {
    expect(rotuloProgresso(0, 8)).toBe('Passo 1 de 8');
    expect(rotuloProgresso(7, 8)).toBe('Passo 8 de 8');
    expect(rotuloProximo(0, 8)).toBe('Próximo');
    expect(rotuloProximo(7, 8)).toBe('Concluir');
  });

  it('só dá para voltar a partir do segundo passo', () => {
    expect(podeVoltar(0)).toBe(false);
    expect(podeVoltar(1)).toBe(true);
  });
});

describe('flag de "já viu"', () => {
  it('sem nada gravado, não foi visto; depois de marcar, foi', () => {
    const local = armazemFalso();
    expect(tutorialJaVisto([local])).toBe(false);
    expect(marcarTutorialVisto([local])).toBe(true);
    expect(local.dados.get(CHAVE_TUTORIAL_VISTO)).toBe('1');
    expect(tutorialJaVisto([local])).toBe(true);
  });

  it('grava só no primeiro armazenamento que funciona', () => {
    const local = armazemFalso();
    const sessao = armazemFalso();
    marcarTutorialVisto([local, sessao]);
    expect(local.dados.size).toBe(1);
    expect(sessao.dados.size).toBe(0);
  });

  it('localStorage lançando: cai no sessionStorage (e a leitura enxerga lá)', () => {
    const sessao = armazemFalso();
    expect(marcarTutorialVisto([armazemQueLanca(), sessao])).toBe(true);
    expect(sessao.dados.get(CHAVE_TUTORIAL_VISTO)).toBe('1');
    expect(tutorialJaVisto([armazemQueLanca(), sessao])).toBe(true);
  });

  it('nenhum armazenamento disponível: não lança e diz que não gravou', () => {
    expect(marcarTutorialVisto([armazemQueLanca(), armazemQueLanca()])).toBe(false);
    expect(marcarTutorialVisto([null, null])).toBe(false);
    expect(tutorialJaVisto([armazemQueLanca(), null])).toBe(false);
  });

  it('valor estranho gravado por outro código não conta como visto', () => {
    const local = armazemFalso();
    local.setItem(CHAVE_TUTORIAL_VISTO, 'talvez');
    expect(tutorialJaVisto([local])).toBe(false);
  });
});

describe('deveMostrarTutorial', () => {
  it('só abre sozinho para quem não viu e uma vez por carregamento da página', () => {
    expect(deveMostrarTutorial(false, false)).toBe(true);
    expect(deveMostrarTutorial(true, false)).toBe(false);
    expect(deveMostrarTutorial(false, true)).toBe(false); // nada funciona para gravar a flag: "Jogar de novo" não repete
    expect(deveMostrarTutorial(true, true)).toBe(false);
  });
});
