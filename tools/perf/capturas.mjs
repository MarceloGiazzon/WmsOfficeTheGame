// Capturas para conferir que o render não mudou de aparência (antes × depois) e que a entrada funciona.
// Pré-requisitos e variáveis de ambiente: veja o topo de comum.mjs.
//
//   node tools/perf/capturas.mjs estado  --url http://localhost:3201 --saida /tmp/antes    # canvas, estado fixo da sim
//   node tools/perf/capturas.mjs estado  --url http://localhost:3200 --saida /tmp/depois
//   node tools/perf/capturas.mjs comparar /tmp/antes /tmp/depois                            # diferença pixel a pixel
//   node tools/perf/capturas.mjs telas   --url http://localhost:3200 --saida /tmp/telas     # página inteira: desktop e celular
//
// `estado` carrega a página SEM o main.ts, importa Simulacao/Renderer/Camera do dev server, avança a sim um número
// fixo de ticks (determinístico) e salva o canvas em PNG — por isso dá para comparar versões diferentes do código
// (servidas em portas diferentes) pixel a pixel. `telas` usa o app de verdade (clique, roda, toque, pinça por CDP).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { abrirNavegador, fmt, lerArgs, URL_APP } from './comum.mjs';

const [, , comando, ...resto] = process.argv;
const args = lerArgs(resto);

// ------------------------------------------------------------------------------------------------ estado

const CENAS = [
  { nome: 'wh-b-enquadrado', cenario: 'WH-B-MEGA', ticks: 14400, zoom: 'enq' },
  { nome: 'wh-b-heatmap', cenario: 'WH-B-MEGA', ticks: 14400, zoom: 'enq', heatmap: true },
  { nome: 'wh-b-selecao', cenario: 'WH-B-MEGA', ticks: 14400, zoom: 'enq', selecao: 200 },
  { nome: 'wh-b-zoom-0.3', cenario: 'WH-B-MEGA', ticks: 14400, zoom: 0.3, centro: [0.5, 0.45] },
  { nome: 'wh-b-zoom-0.3-heatmap', cenario: 'WH-B-MEGA', ticks: 14400, zoom: 0.3, centro: [0.5, 0.45], heatmap: true },
  { nome: 'wh-b-zoom-1.0-docas', cenario: 'WH-B-MEGA', ticks: 14400, zoom: 1, centro: [0.12, 0.1] },
  { nome: 'wh-b-zoom-1.0-selecao', cenario: 'WH-B-MEGA', ticks: 14400, zoom: 1, centro: [0.3, 0.3], selecao: 40 },
  { nome: 'wh-b-inicio', cenario: 'WH-B-MEGA', ticks: 1, zoom: 'enq' },
  { nome: 'wh-a-enquadrado', cenario: 'WH-A-PEQUENO', ticks: 9000, zoom: 'enq' },
  { nome: 'wh-a-heatmap', cenario: 'WH-A-PEQUENO', ticks: 9000, zoom: 'enq', heatmap: true },
  { nome: 'wh-a-zoom-0.6', cenario: 'WH-A-PEQUENO', ticks: 9000, zoom: 0.6, centro: [0.4, 0.4] },
];

async function capturarEstado() {
  const url = args.url ?? URL_APP;
  const saida = args.saida;
  if (!saida) throw new Error('--saida <pasta> é obrigatório');
  mkdirSync(saida, { recursive: true });
  const [largura, altura] = String(args.tamanho ?? '1280x640').split('x').map(Number);
  const nav = await abrirNavegador({});
  const page = await nav.newPage();
  await page.setViewport({ width: largura, height: altura + 200 });
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().endsWith('/src/main.ts') ? r.abort() : r.continue()));
  await page.goto(url, { waitUntil: 'load' });
  const png = await page.evaluate(async (cenas, w, h) => {
    const { Simulacao } = await import('/src/sim/simulation.ts');
    const { Renderer } = await import('/src/render/renderer.ts');
    const { Camera } = await import('/src/render/camera.ts');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const out = {};
    const pacotes = {};
    for (const c of cenas) {
      pacotes[c.cenario] ??= await (await fetch(`/src/data/cenarios/${c.cenario}.json`)).json();
      const sim = new Simulacao(pacotes[c.cenario], 'AbcProximidade');
      for (let i = 0; i < c.ticks - 1; i++) sim.tick();
      const renderer = new Renderer(ctx); // novo por cena: sem cache de um quadro anterior
      // Dois quadros com a câmera parada (um tick entre eles): o segundo é o que exercita o cache de camadas do
      // render novo; o código antigo, sem cache, desenha igual. A captura é do segundo.
      let s = sim.snapshot();
      const cam = new Camera();
      cam.enquadrar(s.layout.largura, s.layout.altura, w, h);
      if (c.zoom !== 'enq') {
        cam.escala = c.zoom;
        cam.offsetX = w / 2 - s.layout.largura * c.centro[0] * c.zoom;
        cam.offsetY = h / 2 - s.layout.altura * c.centro[1] * c.zoom;
      }
      const vaos = renderer.vaosDe(s.layout);
      const sel = c.selecao !== undefined ? vaos[c.selecao].chave : null;
      renderer.desenhar(s, cam, { heatmap: !!c.heatmap, vaoSelecionado: sel });
      sim.tick();
      s = sim.snapshot();
      renderer.desenhar(s, cam, { heatmap: !!c.heatmap, vaoSelecionado: sel });
      out[c.nome] = canvas.toDataURL('image/png');
    }
    return out;
  }, CENAS, largura, altura);
  for (const [nome, url64] of Object.entries(png)) {
    writeFileSync(`${saida}/${nome}.png`, Buffer.from(url64.split(',')[1], 'base64'));
  }
  console.log(`${Object.keys(png).length} capturas em ${saida}`);
  await nav.close();
}

// ------------------------------------------------------------------------------------------------ comparar

async function comparar(dirA, dirB) {
  const nav = await abrirNavegador({});
  const page = await nav.newPage();
  await page.goto('about:blank');
  const nomes = readdirSync(dirA).filter(n => n.endsWith('.png') && readdirSync(dirB).includes(n));
  const diffDir = args.diff;
  if (diffDir) mkdirSync(diffDir, { recursive: true });
  for (const nome of nomes) {
    const a = readFileSync(`${dirA}/${nome}`).toString('base64');
    const b = readFileSync(`${dirB}/${nome}`).toString('base64');
    const r = await page.evaluate(async (a64, b64) => {
      const carregar = src => new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = `data:image/png;base64,${src}`; });
      const [ia, ib] = await Promise.all([carregar(a64), carregar(b64)]);
      const dados = img => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, c.width, c.height);
      };
      const da = dados(ia), db = dados(ib);
      if (da.width !== db.width || da.height !== db.height) return { erro: 'tamanhos diferentes' };
      const out = new ImageData(da.width, da.height);
      let difer = 0, acima8 = 0, acima32 = 0, max = 0, somaAbs = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
        if (d > 0) difer++;
        if (d > 8) acima8++;
        if (d > 32) acima32++;
        if (d > max) max = d;
        somaAbs += d;
        const v = Math.min(255, d * 8);
        out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
      }
      const c = document.createElement('canvas');
      c.width = da.width; c.height = da.height;
      c.getContext('2d').putImageData(out, 0, 0);
      return { total: da.width * da.height, difer, acima8, acima32, max, media: somaAbs / (da.width * da.height), diffPng: c.toDataURL('image/png') };
    }, a, b);
    if (r.erro) { console.log(`${nome}: ${r.erro}`); continue; }
    if (diffDir) writeFileSync(`${diffDir}/${nome}`, Buffer.from(r.diffPng.split(',')[1], 'base64'));
    console.log(`${nome.padEnd(30)} diferentes ${fmt(100 * r.difer / r.total, 3)}% · >8: ${fmt(100 * r.acima8 / r.total, 3)}% · >32: ${fmt(100 * r.acima32 / r.total, 3)}% · máx ${r.max} · média ${fmt(r.media, 4)}`);
  }
  await nav.close();
}

// ------------------------------------------------------------------------------------------------ telas

const espera = ms => new Promise(r => setTimeout(r, ms));

async function telas() {
  const url = args.url ?? URL_APP;
  const saida = args.saida;
  if (!saida) throw new Error('--saida <pasta> é obrigatório');
  mkdirSync(saida, { recursive: true });
  const nav = await abrirNavegador({});
  const erros = [];

  const selecionarCenario = (page, c) => page.evaluate(nome => {
    const s = document.getElementById('select-scenario');
    s.value = nome;
    s.dispatchEvent(new Event('change'));
  }, c);
  const foto = async (page, nome) => { await espera(250); await page.screenshot({ path: `${saida}/${nome}.png` }); };

  // ---- desktop 1280x800
  {
    const page = await nav.newPage();
    page.on('pageerror', e => erros.push(`desktop: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) erros.push(`desktop console: ${m.text()}`); });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#kpi-clock');
    await page.click('#btn-pause');
    await espera(400);
    await foto(page, 'desktop-1-wha-pausado');
    await selecionarCenario(page, 'WH-B-MEGA');
    await espera(1200);
    await page.click('#btn-pause');
    await foto(page, 'desktop-2-whb-enquadrado');
    const caixa = await (await page.$('#warehouse-canvas')).boundingBox();
    // clique de seleção num vão da R04 (coordenadas do canvas no WH-B enquadrado a 1280x800)
    await page.mouse.click(caixa.x + 620, caixa.y + 177);
    await foto(page, 'desktop-3-inspector');
    await page.click('#btn-toggle-heatmap');
    await foto(page, 'desktop-4-heatmap');
    await page.click('#btn-toggle-heatmap');
    await page.mouse.move(caixa.x + caixa.width * 0.35, caixa.y + caixa.height * 0.45);
    for (let i = 0; i < 8; i++) await page.mouse.wheel({ deltaY: -100 });
    await foto(page, 'desktop-5-zoom-roda');
    // arrastar (pan)
    await page.mouse.move(caixa.x + 500, caixa.y + 300);
    await page.mouse.down();
    await page.mouse.move(caixa.x + 380, caixa.y + 260, { steps: 6 });
    await page.mouse.up();
    await foto(page, 'desktop-6-pan');
    // duplo clique: centraliza e aproxima
    await page.click('#btn-reset-cam');
    await page.mouse.click(caixa.x + 620, caixa.y + 177, { clickCount: 1 });
    await page.mouse.click(caixa.x + 620, caixa.y + 177, { clickCount: 2 });
    await espera(600);
    await foto(page, 'desktop-7-duplo-clique');
    await page.click('#btn-reset-cam');
    await foto(page, 'desktop-8-enquadrar');
    await page.close();
  }

  // ---- celular 390x844 com toque
  {
    const page = await nav.newPage();
    page.on('pageerror', e => erros.push(`celular: ${e.message}`));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#kpi-clock');
    await selecionarCenario(page, 'WH-B-MEGA');
    await espera(1200);
    await page.click('#btn-pause');
    await foto(page, 'celular-1-whb-enquadrado');
    const cdp = await page.createCDPSession();
    const toque = (tipo, pontos) => cdp.send('Input.dispatchTouchEvent', { type: tipo, touchPoints: pontos.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
    const caixa = await (await page.$('#warehouse-canvas')).boundingBox();
    const cx = caixa.x + caixa.width / 2;
    const cy = caixa.y + caixa.height / 2;
    // pinça: dois dedos se afastando, com o meio andando para a direita (zoom + pan)
    await toque('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
    for (let i = 1; i <= 10; i++) await toque('touchMove', [[cx - 40 - i * 8 + i * 3, cy], [cx + 40 + i * 8 + i * 3, cy]]);
    await toque('touchEnd', []);
    await foto(page, 'celular-2-pinca');
    // pan com um dedo
    await toque('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 8; i++) await toque('touchMove', [[cx - i * 6, cy + i * 5]]);
    await toque('touchEnd', []);
    await foto(page, 'celular-3-pan-um-dedo');
    // toque simples: seleciona o vão
    await page.click('#btn-reset-cam');
    // (a R03 do WH-B enquadrado a 390 px de largura fica ~110 px abaixo do topo do canvas; x = 305 fica fora do cartão do inspector, que cobre a esquerda)
    await page.touchscreen.tap(caixa.x + 305, caixa.y + 110);
    await foto(page, 'celular-4-toque-inspector');
    // duplo toque: centraliza e aproxima
    await page.touchscreen.tap(caixa.x + 305, caixa.y + 110);
    await page.touchscreen.tap(caixa.x + 305, caixa.y + 110);
    await espera(600);
    await foto(page, 'celular-5-duplo-toque');
    await page.close();
  }

  console.log(erros.length ? `ERROS:\n${erros.join('\n')}` : 'sem erros de página/console');
  console.log(`capturas em ${saida}`);
  await nav.close();
}

if (comando === 'estado') await capturarEstado();
else if (comando === 'comparar') await comparar(resto[0], resto[1]);
else if (comando === 'telas') await telas();
else console.log('uso: capturas.mjs estado|comparar|telas — veja o cabeçalho do arquivo');
