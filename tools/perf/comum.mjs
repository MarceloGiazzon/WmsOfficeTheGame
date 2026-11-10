// Utilidades compartilhadas pelos scripts de tools/perf (medir.mjs e capturas.mjs).
//
// Os scripts dirigem o Chrome por puppeteer-core, que NÃO é dependência do repositório (de propósito: não entra no
// package.json). Instale fora do repo e aponte para ele:
//
//   mkdir -p /tmp/perf && cd /tmp/perf && npm init -y && npm i puppeteer-core@22   # 22.x é CommonJS e roda no Node 18
//   export PERF_PUPPETEER_DIR=/tmp/perf          # pasta que contém node_modules/puppeteer-core
//   export PERF_CHROME=/usr/bin/google-chrome    # opcional (padrão: google-chrome, depois chromium do snap)
//
// e rode o app em outro terminal:  npx vite --port 3200 --no-open   (URL padrão: http://localhost:3200)

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export const URL_APP = process.env.PERF_URL ?? 'http://localhost:3200';

const CHROMES = ['/usr/bin/google-chrome', '/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

export function carregarPuppeteer() {
  const base = process.env.PERF_PUPPETEER_DIR ? `${process.env.PERF_PUPPETEER_DIR.replace(/\/$/, '')}/` : import.meta.url;
  try {
    return createRequire(base)('puppeteer-core');
  } catch {
    throw new Error('puppeteer-core não encontrado: instale fora do repo e exporte PERF_PUPPETEER_DIR (veja o topo de comum.mjs)');
  }
}

export function caminhoChrome() {
  const c = process.env.PERF_CHROME ?? CHROMES.find(existsSync);
  if (!c) throw new Error('Chrome/Chromium não encontrado: exporte PERF_CHROME');
  return c;
}

/**
 * Abre o Chrome headless. `gpu: true` tenta aceleração por hardware (GL/ANGLE); sem isso o headless usa
 * renderização por software (SwiftShader/Skia na CPU), o pior caso, útil para comparar ANTES × DEPOIS.
 * `semLimite: true` tira o limite de 60 quadros/s e o vsync, para enxergar a folga em vez de só "60".
 */
export async function abrirNavegador({ gpu = false, semLimite = false } = {}) {
  const puppeteer = carregarPuppeteer();
  const args = ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'];
  // GPU no headless: com GL/EGL o Chrome cai em software; ANGLE sobre Vulkan (Mesa/anv) é o que funcionou na Intel HD 5500.
  if (gpu) args.push('--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas');
  else args.push('--disable-gpu');
  if (semLimite) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  return puppeteer.launch({ executablePath: caminhoChrome(), headless: 'new', args });
}

/** Informação do renderizador (software × GPU), para registrar junto dos números. */
export async function descreverGpu(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'sem WebGL (software)';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'WebGL (renderizador oculto)';
  });
}

export function estatisticas(valores) {
  const v = [...valores].sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, media: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return {
    n: v.length, media: v.reduce((a, b) => a + b, 0) / v.length,
    p50: q(0.5), p95: q(0.95), p99: q(0.99), max: v[v.length - 1],
  };
}

export const fmt = (x, d = 2) => Number(x).toFixed(d).replace('.', ',');

/** Argumentos `--chave valor` / `--flag` da linha de comando. */
export function lerArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const prox = argv[i + 1];
    if (prox === undefined || prox.startsWith('--')) out[k] = true;
    else { out[k] = prox; i++; }
  }
  return out;
}

/** Pausa e confere (aria-pressed): o jogo ignora o botão enquanto um modal está fechando; tenta de novo se preciso. */
export async function pausar(page) {
  for (let i = 0; i < 5; i++) {
    await page.click('#btn-pause');
    await new Promise(r => setTimeout(r, 250));
    if (await page.$eval('#btn-pause', b => b.getAttribute('aria-pressed') === 'true')) return;
  }
}

/**
 * Leva o app do zero até um turno do `cenario` pronto para jogar: fecha o login ("Jogar como convidado"), marca o cenário
 * no modal de pré-partida e clica em "Iniciar turno". O relógio fica no que o jogo definir (use #btn-play-Nx depois).
 */
export async function iniciarPartida(page, cenario = 'WH-B-MEGA') {
  await page.waitForSelector('#modal-login:not([hidden]), #modal-prejogo:not([hidden])', { timeout: 15000 });
  if (await page.$('#modal-login:not([hidden])')) {
    await page.evaluate(() => [...document.querySelectorAll('#modal-login button')].find(b => /convidado/i.test(b.textContent))?.click());
  }
  await page.waitForSelector('#modal-prejogo:not([hidden]) input[name="cenario"]', { timeout: 15000 });
  await page.evaluate(c => document.querySelector(`#modal-prejogo input[name="cenario"][value="${c}"]`).click(), cenario);
  await page.evaluate(() => document.querySelector('#prejogo-rodape .btn-primary').click());
  await page.waitForSelector('#modal-prejogo', { hidden: true, timeout: 15000 });
  await new Promise(r => setTimeout(r, 400)); // a sim nasce e o primeiro quadro é desenhado
}
