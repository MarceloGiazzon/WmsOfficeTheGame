import { describe, expect, it } from 'vitest';
import whB from '../data/cenarios/WH-B-MEGA.json';
import { construirLayout } from '../sim/layout';
import type { PacoteCenario } from '../sim/model';
import { Camera } from './camera';
import { agruparVaos } from './renderer';

describe('Camera', () => {
  it('paraTela e paraMundo são inversas', () => {
    const c = new Camera();
    c.escala = 0.37;
    c.offsetX = 12;
    c.offsetY = -40;
    const p = { x: 1234, y: 567 };
    const volta = c.paraMundo(c.paraTela(p));
    expect(volta.x).toBeCloseTo(p.x);
    expect(volta.y).toBeCloseTo(p.y);
  });

  it('zoom mantém o ponto âncora parado', () => {
    const c = new Camera();
    const ancora = { x: 300, y: 200 };
    const antes = c.paraMundo(ancora);
    c.zoom(1.5, ancora);
    const depois = c.paraMundo(ancora);
    expect(depois.x).toBeCloseTo(antes.x);
    expect(depois.y).toBeCloseTo(antes.y);
  });

  it('enquadrar cabe o armazém na tela', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, 1000, 600, 20);
    const fim = c.paraTela({ x: 5000, y: 2000 });
    const ini = c.paraTela({ x: 0, y: 0 });
    expect(ini.x).toBeGreaterThanOrEqual(0);
    expect(ini.y).toBeGreaterThanOrEqual(0);
    expect(fim.x).toBeLessThanOrEqual(1000);
    expect(fim.y).toBeLessThanOrEqual(600);
  });
  it('zoom respeita o teto e, depois de enquadrar, o piso relativo ao enquadramento', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, 1000, 600, 20);
    const enquadrada = c.escala;
    c.zoom(1000, { x: 500, y: 300 });
    expect(c.escala).toBe(Camera.ESCALA_MAX);
    c.zoom(1e-6, { x: 500, y: 300 });
    expect(c.escala).toBeCloseTo(enquadrada * Camera.AFASTAR_MAX);
    expect(c.escalaMinima()).toBeCloseTo(enquadrada * Camera.AFASTAR_MAX);
  });

  it('zoom no teto não desloca o ponto sob o cursor', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, 1000, 600, 20);
    const ancora = { x: 700, y: 150 };
    const antes = c.paraMundo(ancora);
    c.zoom(1000, ancora);
    const depois = c.paraMundo(ancora);
    expect(depois.x).toBeCloseTo(antes.x);
    expect(depois.y).toBeCloseTo(antes.y);
  });
});

describe('Camera: pinça', () => {
  it('dedos se afastando ×2 dobram a escala e o ponto do meio fica sob o meio dos dedos', () => {
    const c = new Camera();
    c.escala = 0.4;
    c.offsetX = 30;
    c.offsetY = 20;
    const a0 = { x: 300, y: 300 };
    const b0 = { x: 400, y: 300 };
    const sob = c.paraMundo({ x: 350, y: 300 });
    c.pinca(a0, b0, { x: 250, y: 300 }, { x: 450, y: 300 });
    expect(c.escala).toBeCloseTo(0.8);
    const tela = c.paraTela(sob);
    expect(tela.x).toBeCloseTo(350);
    expect(tela.y).toBeCloseTo(300);
  });

  it('pan com dois dedos (mesma distância) só desloca', () => {
    const c = new Camera();
    c.escala = 0.5;
    const sob = c.paraMundo({ x: 200, y: 200 });
    c.pinca({ x: 150, y: 200 }, { x: 250, y: 200 }, { x: 180, y: 230 }, { x: 280, y: 230 });
    expect(c.escala).toBeCloseTo(0.5);
    const tela = c.paraTela(sob);
    expect(tela.x).toBeCloseTo(230);
    expect(tela.y).toBeCloseTo(230);
  });

  it('pinça acima do teto trava a escala e ainda acompanha o meio dos dedos', () => {
    const c = new Camera();
    c.escala = 1.9;
    const sob = c.paraMundo({ x: 350, y: 300 });
    c.pinca({ x: 300, y: 300 }, { x: 400, y: 300 }, { x: 100, y: 300 }, { x: 600, y: 300 });
    expect(c.escala).toBe(Camera.ESCALA_MAX);
    const tela = c.paraTela(sob);
    expect(tela.x).toBeCloseTo(350);
  });
});

describe('Camera: centralizar e limites', () => {
  it('centralizarEm põe o ponto no centro da tela', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, 1000, 600, 20);
    c.centralizarEm({ x: 1200, y: 800 }, 1000, 600);
    const t = c.paraTela({ x: 1200, y: 800 });
    expect(t.x).toBeCloseTo(500);
    expect(t.y).toBeCloseTo(300);
  });

  it('centralizarEm com escala mínima aproxima, mas nunca afasta', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, 1000, 600, 20);
    c.centralizarEm({ x: 2500, y: 1000 }, 1000, 600, 0.8);
    expect(c.escala).toBeCloseTo(0.8);
    c.centralizarEm({ x: 2500, y: 1000 }, 1000, 600, 0.3);
    expect(c.escala).toBeCloseTo(0.8);
  });

  it('limitar não deixa o armazém sair da tela (pan)', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, 1000, 600, 20);
    c.mover(-1e6, 1e6);
    c.limitar(1000, 600);
    // sobra pelo menos 20% da tela coberta pelo armazém, em cada eixo
    // arrastado para a esquerda: a borda direita do armazém ainda cobre 20% da largura
    expect(c.paraTela({ x: 5000, y: 0 }).x).toBeGreaterThanOrEqual(1000 * Camera.FRACAO_VISIVEL_MIN - 1e-9);
    // arrastado para baixo: a borda de cima do armazém ainda deixa 20% da altura coberta
    expect(c.paraTela({ x: 0, y: 0 }).y).toBeLessThanOrEqual(600 - 600 * Camera.FRACAO_VISIVEL_MIN + 1e-9);
  });

  it('limitar não mexe em quem já está dentro dos limites e não age antes de enquadrar', () => {
    const c = new Camera();
    c.mover(-1e6, 0);
    c.limitar(1000, 600);
    expect(c.offsetX).toBe(-1e6);
    c.enquadrar(5000, 2000, 1000, 600, 20);
    const antes = c.estado();
    c.limitar(1000, 600);
    expect(c.estado()).toEqual(antes);
  });

  it('mundoVisivel é a inversa da tela', () => {
    const c = new Camera();
    c.escala = 0.5;
    c.offsetX = 100;
    c.offsetY = -50;
    const v = c.mundoVisivel(800, 400);
    expect(c.paraTela({ x: v.x, y: v.y })).toEqual({ x: 0, y: 0 });
    expect(c.paraTela({ x: v.x + v.largura, y: v.y + v.altura }).x).toBeCloseTo(800);
    expect(c.paraTela({ x: v.x + v.largura, y: v.y + v.altura }).y).toBeCloseTo(400);
  });

  it('entre: extremos exatos e o meio fica entre os centros', () => {
    const de = { escala: 0.2, offsetX: 0, offsetY: 0 };
    const para = { escala: 0.8, offsetX: -300, offsetY: -100 };
    expect(Camera.entre(de, para, 0, 1000, 600).escala).toBeCloseTo(de.escala);
    const fim = Camera.entre(de, para, 1, 1000, 600);
    expect(fim.escala).toBeCloseTo(para.escala);
    expect(fim.offsetX).toBeCloseTo(para.offsetX);
    expect(fim.offsetY).toBeCloseTo(para.offsetY);
    expect(Camera.entre(de, para, 0.5, 1000, 600).escala).toBeCloseTo(0.4); // média geométrica
  });

  it('clonar copia os limites aprendidos no enquadrar', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, 1000, 600, 20);
    const k = c.clonar();
    k.mover(-1e6, 0);
    k.limitar(1000, 600);
    expect(k.offsetX).toBeGreaterThan(-1e6);
    expect(k.escalaMinima()).toBeCloseTo(c.escalaMinima());
  });
});

describe('Camera: girar a tela (aoRedimensionar)', () => {
  const RETRATO = { largura: 390, altura: 844 };
  const PAISAGEM = { largura: 844, altura: 390 };
  const larguraEmTela = (c: Camera) => 5000 * c.escala;

  it('vista intocada: reenquadra o armazém inteiro na tela nova (o zoom acompanha o tamanho)', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, RETRATO.largura, RETRATO.altura);
    const escalaRetrato = c.escala;
    c.aoRedimensionar(RETRATO, PAISAGEM);
    const igual = new Camera();
    igual.enquadrar(5000, 2000, PAISAGEM.largura, PAISAGEM.altura);
    expect(c.estado()).toEqual(igual.estado());
    expect(c.escala).toBeGreaterThan(escalaRetrato); // 390 px → 844 px de largura: aproxima
    expect(larguraEmTela(c)).toBeLessThanOrEqual(PAISAGEM.largura);
    expect(c.escalaMinima()).toBeCloseTo(c.escala * Camera.AFASTAR_MAX); // limites de zoom seguem o novo enquadramento
  });

  it('reenquadrar não tira a câmera do estado "intocada": girar de novo reenquadra de novo', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, RETRATO.largura, RETRATO.altura);
    c.aoRedimensionar(RETRATO, PAISAGEM);
    c.aoRedimensionar(PAISAGEM, RETRATO);
    const igual = new Camera();
    igual.enquadrar(5000, 2000, RETRATO.largura, RETRATO.altura);
    expect(c.estado()).toEqual(igual.estado());
  });

  it.each([
    ['zoom', (c: Camera) => c.zoom(1.5, { x: 100, y: 100 })],
    ['pan', (c: Camera) => c.mover(30, -20)],
    ['pinça', (c: Camera) => c.pinca({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 90, y: 100 }, { x: 230, y: 100 })],
    ['centralizar', (c: Camera) => c.centralizarEm({ x: 1000, y: 500 }, RETRATO.largura, RETRATO.altura, 0.2)],
    ['animação (aplicar)', (c: Camera) => c.aplicar({ escala: 0.1, offsetX: 5, offsetY: 5 })],
  ])('depois de %s a vista é do jogador: só o centro acompanha a tela, a escala fica', (_nome, mexer) => {
    const c = new Camera();
    c.enquadrar(5000, 2000, RETRATO.largura, RETRATO.altura);
    mexer(c);
    const antes = c.estado();
    const centroAntes = c.paraMundo({ x: RETRATO.largura / 2, y: RETRATO.altura / 2 });
    c.aoRedimensionar(RETRATO, PAISAGEM);
    expect(c.escala).toBe(antes.escala);
    const centroDepois = c.paraMundo({ x: PAISAGEM.largura / 2, y: PAISAGEM.altura / 2 });
    expect(centroDepois.x).toBeCloseTo(centroAntes.x);
    expect(centroDepois.y).toBeCloseTo(centroAntes.y);
  });

  it('"Centralizar/enquadrar" de novo devolve a câmera ao modo que reenquadra', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, RETRATO.largura, RETRATO.altura);
    c.zoom(2, { x: 0, y: 0 });
    c.enquadrar(5000, 2000, RETRATO.largura, RETRATO.altura); // botão de reenquadrar
    c.aoRedimensionar(RETRATO, PAISAGEM);
    const igual = new Camera();
    igual.enquadrar(5000, 2000, PAISAGEM.largura, PAISAGEM.altura);
    expect(c.estado()).toEqual(igual.estado());
  });

  it('antes de enquadrar (sem armazém conhecido) só preserva o centro, e a primeira medição (antes = 0) não mexe', () => {
    const c = new Camera();
    c.offsetX = 10;
    c.aoRedimensionar({ largura: 0, altura: 0 }, PAISAGEM);
    expect(c.offsetX).toBe(10);
    c.aoRedimensionar(RETRATO, PAISAGEM);
    expect(c.offsetX).toBe(10 + (PAISAGEM.largura - RETRATO.largura) / 2);
  });

  it('clonar leva o estado "intocada": o clone de uma vista intocada também reenquadra', () => {
    const c = new Camera();
    c.enquadrar(5000, 2000, RETRATO.largura, RETRATO.altura);
    const k = c.clonar();
    k.aoRedimensionar(RETRATO, PAISAGEM);
    expect(k.escala).not.toBe(c.escala);
  });
});

describe('agruparVaos', () => {
  it('WH-B: 4 andares viram um vão por posição', () => {
    const layout = construirLayout(whB as unknown as PacoteCenario);
    const vaos = agruparVaos(layout);
    expect(vaos).toHaveLength(12 * 30);
    expect(vaos.every(v => v.andares.length === 4)).toBe(true);
  });

  it('o rótulo do vão é "rua-posição" com 2 dígitos', () => {
    const layout = construirLayout(whB as unknown as PacoteCenario);
    const v = agruparVaos(layout)[0];
    expect(v.rotulo).toBe(`${v.ruaCodigo}-${String(v.posicao).padStart(2, '0')}`);
  });
});
