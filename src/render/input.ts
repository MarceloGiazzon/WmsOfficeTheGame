// Entrada no canvas: arrastar (pan), roda (zoom) e clique (seleção). Não conhece a simulação:
// devolve pontos do mundo para quem chamou decidir o que fazer.

import type { Ponto } from '../sim/layout';
import type { Camera } from './camera';

/** Movimento máximo (px) para um "pressionar e soltar" ainda contar como clique e não como arrasto. */
const LIMIAR_CLIQUE_PX = 5;

export function ligarEntrada(canvas: HTMLCanvasElement, cam: Camera, aoClicar: (mundo: Ponto) => void): () => void {
  let arrastando = false;
  let moveu = 0;
  let ultimo: Ponto = { x: 0, y: 0 };

  const pontoNoCanvas = (e: PointerEvent | WheelEvent): Ponto => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent) => {
    arrastando = true;
    moveu = 0;
    ultimo = pontoNoCanvas(e);
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!arrastando) return;
    const p = pontoNoCanvas(e);
    moveu += Math.abs(p.x - ultimo.x) + Math.abs(p.y - ultimo.y);
    cam.mover(p.x - ultimo.x, p.y - ultimo.y);
    ultimo = p;
  };
  const up = (e: PointerEvent) => {
    if (!arrastando) return;
    arrastando = false;
    if (moveu <= LIMIAR_CLIQUE_PX) aoClicar(cam.paraMundo(pontoNoCanvas(e)));
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    cam.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, pontoNoCanvas(e));
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { arrastando = false; });
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.style.touchAction = 'none';

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
  };
}
