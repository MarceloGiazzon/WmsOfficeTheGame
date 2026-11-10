import { describe, expect, it } from 'vitest';
import { expandir, posicionarBalao, uniao, type Retangulo, type Tamanho } from './balao';

const tela: Tamanho = { largura: 400, altura: 800 };
const balao: Tamanho = { largura: 300, altura: 150 };

const cabeNaTela = (x: number, y: number, b: Tamanho, t: Tamanho, margem: number) =>
  x >= margem - 1e-9 && y >= margem - 1e-9 && x + b.largura <= t.largura - margem + 1e-9 && y + b.altura <= t.altura - margem + 1e-9;

const cruza = (a: Retangulo, b: Retangulo) =>
  a.x < b.x + b.largura && a.x + a.largura > b.x && a.y < b.y + b.altura && a.y + a.altura > b.y;

describe('uniao / expandir', () => {
  it('une os retângulos no menor que os contém', () => {
    expect(uniao([{ x: 10, y: 20, largura: 30, altura: 10 }, { x: 100, y: 5, largura: 10, altura: 10 }]))
      .toEqual({ x: 10, y: 5, largura: 100, altura: 25 });
  });

  it('sem retângulos não há união', () => {
    expect(uniao([])).toBeNull();
  });

  it('expandir aumenta igualmente nos quatro lados', () => {
    expect(expandir({ x: 10, y: 10, largura: 20, altura: 30 }, 4)).toEqual({ x: 6, y: 6, largura: 28, altura: 38 });
  });
});

describe('posicionarBalao', () => {
  it('coloca abaixo do alvo quando cabe, centrado nele e sem cobri-lo', () => {
    const alvo = { x: 100, y: 20, largura: 200, altura: 50 };
    const p = posicionarBalao(alvo, balao, tela);
    expect(p.lado).toBe('abaixo');
    expect(p.y).toBe(82); // 20 + 50 + folga 12
    expect(p.x).toBe(50); // centrado: 100 + 100 - 150
    expect(cruza({ x: p.x, y: p.y, ...balao }, alvo)).toBe(false);
  });

  it('sem espaço abaixo, tenta acima', () => {
    const alvo = { x: 100, y: 700, largura: 200, altura: 50 };
    const p = posicionarBalao(alvo, balao, tela);
    expect(p.lado).toBe('acima');
    expect(p.y).toBe(700 - 12 - 150);
  });

  it('sem espaço em cima nem embaixo, usa o lado (direita antes da esquerda)', () => {
    const t = { largura: 800, altura: 300 };
    const alvo = { x: 20, y: 20, largura: 100, altura: 260 };
    expect(posicionarBalao(alvo, balao, t).lado).toBe('direita');
    const aDireita = { x: 680, y: 20, largura: 100, altura: 260 };
    expect(posicionarBalao(aDireita, balao, t).lado).toBe('esquerda');
  });

  it('alvo do tamanho do mapa: o balão vai para dentro, colado embaixo', () => {
    const mapa = { x: 0, y: 100, largura: 400, altura: 700 };
    const p = posicionarBalao(mapa, balao, tela);
    expect(p.lado).toBe('dentro');
    expect(p.y).toBe(800 - 12 - 150); // clamp na margem de baixo
    expect(p.x).toBe(50);
  });

  it('sem alvo, centraliza', () => {
    const p = posicionarBalao(null, balao, tela);
    expect(p).toEqual({ x: 50, y: 325, lado: 'centro' });
  });

  it('a posição nunca sai da tela, nem com alvo na borda', () => {
    const naBorda = { x: 380, y: 0, largura: 20, altura: 30 };
    const p = posicionarBalao(naBorda, balao, tela);
    expect(cabeNaTela(p.x, p.y, balao, tela, 12)).toBe(true);
  });

  it('balão maior que a tela fica no canto, sem coordenadas negativas', () => {
    const p = posicionarBalao({ x: 10, y: 10, largura: 50, altura: 50 }, { largura: 500, altura: 900 }, tela);
    expect(p.x).toBe(12);
    expect(p.y).toBe(12);
  });

  it('propriedade: qualquer alvo e tela razoáveis dão um balão inteiro dentro da tela', () => {
    let semente = 12345;
    const aleatorio = () => { semente = (semente * 1664525 + 1013904223) % 4294967296; return semente / 4294967296; };
    const telas: Tamanho[] = [{ largura: 1280, altura: 800 }, { largura: 390, altura: 844 }, { largura: 844, altura: 390 }, { largura: 800, altura: 360 }];
    for (let i = 0; i < 2000; i++) {
      const t = telas[i % telas.length];
      const b = { largura: 120 + aleatorio() * 240, altura: 60 + aleatorio() * (t.altura - 24 - 60) * 0.9 };
      const largura = 10 + aleatorio() * t.largura;
      const altura = 10 + aleatorio() * t.altura;
      const alvo = { x: aleatorio() * (t.largura - largura), y: aleatorio() * (t.altura - altura), largura, altura };
      const p = posicionarBalao(alvo, b, t);
      expect(cabeNaTela(p.x, p.y, b, t, 12), `${JSON.stringify({ t, b, alvo, p })}`).toBe(true);
      // fora do fallback "dentro", o balão não cobre o alvo
      if (p.lado !== 'dentro') expect(cruza({ x: p.x, y: p.y, ...b }, alvo), `${JSON.stringify({ t, b, alvo, p })}`).toBe(false);
    }
  });

  it('respeita margem e folga informadas', () => {
    const alvo = { x: 100, y: 20, largura: 200, altura: 50 };
    const p = posicionarBalao(alvo, balao, tela, { margem: 20, folga: 30 });
    expect(p.y).toBe(100);
  });
});
