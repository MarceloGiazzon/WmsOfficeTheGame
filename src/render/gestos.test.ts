import { describe, expect, it } from 'vitest';
import type { Ponto } from '../sim/layout';
import { Camera } from './camera';
import { fatorDaRoda, Gestos, INTERVALO_DUPLO_MS, LIMIAR_CLIQUE_PX, LIMIAR_CLIQUE_TOQUE_PX } from './gestos';

/** Câmera enquadrada num armazém 5000×2000 em uma tela 1000×600, com os callbacks gravados. */
function montar() {
  const cam = new Camera();
  cam.enquadrar(5000, 2000, 1000, 600, 20);
  const cliques: Ponto[] = [];
  const duplos: Ponto[] = [];
  let inicios = 0;
  const g = new Gestos(cam, () => ({ largura: 1000, altura: 600 }), {
    aoClicar: p => cliques.push(p),
    aoDuploClique: p => duplos.push(p),
    aoIniciar: () => { inicios++; },
  });
  return { cam, g, cliques, duplos, inicios: () => inicios };
}

describe('Gestos: clique e arrasto', () => {
  it('pressionar e soltar no mesmo lugar é clique (ponto do mundo sob o dedo)', () => {
    const { cam, g, cliques } = montar();
    const p = { x: 400, y: 250 };
    g.baixar(1, p);
    g.soltar(1, p, 0);
    expect(cliques).toHaveLength(1);
    expect(cliques[0].x).toBeCloseTo(cam.paraMundo(p).x);
    expect(cliques[0].y).toBeCloseTo(cam.paraMundo(p).y);
  });

  it('arrastar move a câmera e não é clique', () => {
    const { cam, g, cliques } = montar();
    const x0 = cam.offsetX;
    g.baixar(1, { x: 400, y: 250 });
    g.mover(1, { x: 430, y: 270 });
    g.soltar(1, { x: 430, y: 270 }, 0);
    expect(cam.offsetX).toBeCloseTo(x0 + 30);
    expect(cliques).toHaveLength(0);
  });

  it('tremida pequena do mouse ainda é clique; com o dedo o limiar é maior', () => {
    const a = montar();
    a.g.baixar(1, { x: 400, y: 250 });
    a.g.mover(1, { x: 400 + LIMIAR_CLIQUE_PX, y: 250 });
    a.g.soltar(1, { x: 400 + LIMIAR_CLIQUE_PX, y: 250 }, 0);
    expect(a.cliques).toHaveLength(1);

    const mouse = montar();
    mouse.g.baixar(1, { x: 400, y: 250 });
    mouse.g.mover(1, { x: 400 + LIMIAR_CLIQUE_PX + 3, y: 250 });
    mouse.g.soltar(1, { x: 400 + LIMIAR_CLIQUE_PX + 3, y: 250 }, 0);
    expect(mouse.cliques).toHaveLength(0);

    const dedo = montar();
    dedo.g.baixar(1, { x: 400, y: 250 }, true);
    dedo.g.mover(1, { x: 400 + LIMIAR_CLIQUE_PX + 3, y: 250 });
    dedo.g.soltar(1, { x: 400 + LIMIAR_CLIQUE_PX + 3, y: 250 }, 0);
    expect(dedo.cliques).toHaveLength(1);
    expect(LIMIAR_CLIQUE_TOQUE_PX).toBeGreaterThan(LIMIAR_CLIQUE_PX + 3);
  });

  it('pan não deixa o armazém sair da tela', () => {
    const { cam, g } = montar();
    g.baixar(1, { x: 500, y: 300 });
    g.mover(1, { x: -90000, y: 300 });
    g.soltar(1, { x: -90000, y: 300 }, 0);
    expect(cam.paraTela({ x: 5000, y: 0 }).x).toBeGreaterThanOrEqual(1000 * Camera.FRACAO_VISIVEL_MIN - 1e-9);
  });
});

describe('Gestos: duplo clique', () => {
  it('segundo clique rápido e próximo vira duplo clique, no lugar do clique simples', () => {
    const { g, cliques, duplos } = montar();
    const p = { x: 400, y: 250 };
    g.baixar(1, p); g.soltar(1, p, 1000);
    g.baixar(2, { x: 405, y: 252 }); g.soltar(2, { x: 405, y: 252 }, 1000 + INTERVALO_DUPLO_MS - 50);
    expect(cliques).toHaveLength(1);
    expect(duplos).toHaveLength(1);
  });

  it('devagar demais ou longe demais são dois cliques simples', () => {
    const lento = montar();
    const p = { x: 400, y: 250 };
    lento.g.baixar(1, p); lento.g.soltar(1, p, 1000);
    lento.g.baixar(2, p); lento.g.soltar(2, p, 1000 + INTERVALO_DUPLO_MS + 50);
    expect(lento.cliques).toHaveLength(2);
    expect(lento.duplos).toHaveLength(0);

    const longe = montar();
    longe.g.baixar(1, p); longe.g.soltar(1, p, 1000);
    longe.g.baixar(2, { x: 600, y: 250 }); longe.g.soltar(2, { x: 600, y: 250 }, 1100);
    expect(longe.cliques).toHaveLength(2);
    expect(longe.duplos).toHaveLength(0);
  });

  it('três toques seguidos: duplo, depois um clique novo (não encadeia duplos)', () => {
    const { g, cliques, duplos } = montar();
    const p = { x: 400, y: 250 };
    for (const [id, t] of [[1, 1000], [2, 1100], [3, 1200]] as const) { g.baixar(id, p); g.soltar(id, p, t); }
    expect(duplos).toHaveLength(1);
    expect(cliques).toHaveLength(2);
  });
});

describe('Gestos: pinça', () => {
  it('dois dedos se afastando dão zoom ancorado no meio e não geram clique', () => {
    const { cam, g, cliques } = montar();
    const sob = cam.paraMundo({ x: 500, y: 300 });
    const e0 = cam.escala;
    g.baixar(1, { x: 450, y: 300 }, true);
    g.baixar(2, { x: 550, y: 300 }, true);
    g.mover(1, { x: 400, y: 300 });
    g.mover(2, { x: 600, y: 300 });
    expect(cam.escala).toBeGreaterThan(e0 * 1.5);
    const tela = cam.paraTela(sob);
    expect(tela.x).toBeCloseTo(500, 0);
    expect(tela.y).toBeCloseTo(300, 0);
    g.soltar(1, { x: 400, y: 300 }, 100);
    g.soltar(2, { x: 600, y: 300 }, 100);
    expect(cliques).toHaveLength(0);
  });

  it('pinça com os dedos andando juntos faz pan e zoom ao mesmo tempo', () => {
    const { cam, g } = montar();
    const sob = cam.paraMundo({ x: 500, y: 300 });
    g.baixar(1, { x: 450, y: 300 }, true);
    g.baixar(2, { x: 550, y: 300 }, true);
    // os dois dedos andam 100 px para a direita e se afastam
    g.mover(1, { x: 500, y: 300 });
    g.mover(2, { x: 700, y: 300 });
    const tela = cam.paraTela(sob);
    expect(tela.x).toBeCloseTo(600, 0); // o ponto acompanhou o meio dos dedos (500 → 600)
  });

  it('levantar um dedo e continuar com o outro é pan sem salto e sem clique', () => {
    const { cam, g, cliques } = montar();
    g.baixar(1, { x: 450, y: 300 }, true);
    g.baixar(2, { x: 550, y: 300 }, true);
    g.soltar(1, { x: 450, y: 300 }, 50);
    const x0 = cam.offsetX;
    g.mover(2, { x: 560, y: 300 }); // o dedo que ficou andou 10 px
    expect(cam.offsetX).toBeCloseTo(x0 + 10);
    g.soltar(2, { x: 560, y: 300 }, 100);
    expect(cliques).toHaveLength(0);
  });

  it('um toque depois da pinça volta a ser clique normal', () => {
    const { g, cliques } = montar();
    g.baixar(1, { x: 450, y: 300 }, true);
    g.baixar(2, { x: 550, y: 300 }, true);
    g.soltar(1, { x: 450, y: 300 }, 50);
    g.soltar(2, { x: 550, y: 300 }, 60);
    g.baixar(3, { x: 300, y: 200 }, true);
    g.soltar(3, { x: 300, y: 200 }, 2000);
    expect(cliques).toHaveLength(1);
  });

  it('cancelar (ex.: o navegador tomou o toque) não vira clique', () => {
    const { g, cliques } = montar();
    g.baixar(1, { x: 450, y: 300 }, true);
    g.cancelar(1);
    g.soltar(1, { x: 450, y: 300 }, 10);
    expect(cliques).toHaveLength(0);
    expect(g.ativo).toBe(false);
  });
});

describe('Gestos: roda', () => {
  it('fatorDaRoda: para cima aproxima, para baixo afasta, proporcional e limitado', () => {
    expect(fatorDaRoda(-100)).toBeGreaterThan(1);
    expect(fatorDaRoda(100)).toBeLessThan(1);
    expect(fatorDaRoda(100) * fatorDaRoda(-100)).toBeCloseTo(1);
    expect(fatorDaRoda(-100)).toBeCloseTo(1.16, 1); // ≈ o passo fixo antigo (×1,15)
    expect(fatorDaRoda(-10)).toBeLessThan(fatorDaRoda(-100)); // trackpad com delta pequeno: passo pequeno
    expect(fatorDaRoda(-1e6)).toBeLessThanOrEqual(1.5);
    expect(fatorDaRoda(1e6)).toBeGreaterThanOrEqual(1 / 1.5);
    expect(fatorDaRoda(-3, 1)).toBeCloseTo(fatorDaRoda(-48, 0)); // deltaMode = linhas
    expect(fatorDaRoda(-5, 0, true)).toBeGreaterThan(fatorDaRoda(-5, 0, false)); // pinça do trackpad tem mais ganho
  });

  it('a roda faz zoom com o ponto sob o cursor parado e avisa o início do gesto', () => {
    const { cam, g, inicios } = montar();
    const cursor = { x: 700, y: 200 };
    const sob = cam.paraMundo(cursor);
    const e0 = cam.escala;
    g.roda(-100, 0, false, cursor);
    expect(cam.escala).toBeGreaterThan(e0);
    const tela = cam.paraTela(sob);
    expect(tela.x).toBeCloseTo(cursor.x);
    expect(tela.y).toBeCloseTo(cursor.y);
    expect(inicios()).toBe(1);
  });
});
