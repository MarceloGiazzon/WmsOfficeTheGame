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
});

describe('agruparVaos', () => {
  it('WH-B: 4 andares viram um vão por posição', () => {
    const layout = construirLayout(whB as unknown as PacoteCenario);
    const vaos = agruparVaos(layout);
    expect(vaos).toHaveLength(12 * 30);
    expect(vaos.every(v => v.andares.length === 4)).toBe(true);
  });
});
