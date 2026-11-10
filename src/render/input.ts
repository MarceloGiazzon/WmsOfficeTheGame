// Entrada no canvas: liga os eventos do navegador (pointer events + roda) ao reconhecedor de gestos. Não conhece a
// simulação: devolve pontos do mundo para quem chamou decidir o que fazer.
//
//   mouse / 1 dedo: arrastar = pan · clique = seleção · duplo clique/toque = centraliza (e aproxima) no ponto
//   2 dedos: pinça (zoom ancorado no meio dos dedos) com pan junto · roda / pinça do trackpad: zoom no cursor

import type { Ponto } from '../sim/layout';
import { Camera } from './camera';
import { Gestos } from './gestos';

/** Duplo clique aproxima, no mínimo, até aqui (px por cm): um vão fica com ~70 px e os rótulos aparecem. */
const ESCALA_DETALHE = 0.6;
const DURACAO_VOO_MS = 260;

export interface OpcoesEntrada {
  /** Clique simples em um ponto do mundo (cm). */
  aoClicar: (mundo: Ponto) => void;
  /** Para onde o duplo clique leva a câmera, dado o ponto clicado (ex.: o centro do vão). Padrão: o próprio ponto. */
  alvoDuploClique?: (mundo: Ponto) => Ponto;
}

export function ligarEntrada(canvas: HTMLCanvasElement, cam: Camera, op: OpcoesEntrada): () => void {
  let voo = 0; // id do requestAnimationFrame da animação de câmera em curso (0 = nenhuma)
  const pararVoo = () => {
    if (voo) cancelAnimationFrame(voo);
    voo = 0;
  };

  const tela = () => ({ largura: canvas.width, altura: canvas.height });

  /** Anima a câmera até centralizar `alvo`. Qualquer gesto novo interrompe (`aoIniciar`). */
  const voarPara = (alvo: Ponto) => {
    pararVoo();
    const de = cam.estado();
    const destino = cam.clonar(); // o clone leva os limites aprendidos no enquadrar
    destino.centralizarEm(alvo, canvas.width, canvas.height, ESCALA_DETALHE);
    const para = destino.estado();
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / DURACAO_VOO_MS);
      const suave = 1 - Math.pow(1 - t, 3); // easeOutCubic
      cam.aplicar(Camera.entre(de, para, suave, canvas.width, canvas.height));
      voo = t < 1 ? requestAnimationFrame(passo) : 0;
    };
    voo = requestAnimationFrame(passo);
  };

  const gestos = new Gestos(cam, tela, {
    aoClicar: op.aoClicar,
    aoDuploClique: mundo => voarPara(op.alvoDuploClique?.(mundo) ?? mundo),
    aoIniciar: pararVoo,
  });

  const pontoNoCanvas = (e: PointerEvent | WheelEvent): Ponto => {
    const r = canvas.getBoundingClientRect();
    // o canvas tem width/height em px de CSS (1:1); se o CSS o escalar, converte para px do canvas
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // botão do meio/direito não arrasta nem seleciona
    canvas.setPointerCapture(e.pointerId);
    gestos.baixar(e.pointerId, pontoNoCanvas(e), e.pointerType !== 'mouse');
  };
  const move = (e: PointerEvent) => gestos.mover(e.pointerId, pontoNoCanvas(e));
  const up = (e: PointerEvent) => gestos.soltar(e.pointerId, pontoNoCanvas(e), e.timeStamp);
  const cancel = (e: PointerEvent) => gestos.cancelar(e.pointerId);
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    // Ctrl + roda é como o Chrome entrega a pinça do trackpad
    gestos.roda(e.deltaY, e.deltaMode, e.ctrlKey, pontoNoCanvas(e));
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('wheel', wheel, { passive: false });
  // sem isto o navegador toma o arrasto/pinça do toque para rolar e dar zoom na página
  canvas.style.touchAction = 'none';

  return () => {
    pararVoo();
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('wheel', wheel);
  };
}
