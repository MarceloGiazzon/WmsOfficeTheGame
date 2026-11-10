// Mede o custo do jogo no Chrome headless: sim (ticks), snapshot, render do canvas e atualização de DOM.
// Pré-requisitos e variáveis de ambiente: veja o topo de comum.mjs.
//
//   node tools/perf/medir.mjs                       # micro + e2e no WH-B-MEGA, renderização por software
//   node tools/perf/medir.mjs --modo micro          # só o microbenchmark (sem o laço do app)
//   node tools/perf/medir.mjs --modo e2e --seg 10   # só o app de verdade (rAF), 10 s por cenário
//   node tools/perf/medir.mjs --gpu                 # tenta GL por hardware (o padrão é software)
//   node tools/perf/medir.mjs --sem-limite          # tira o limite de 60 quadros/s (mostra a folga)
//   node tools/perf/medir.mjs --dpr 2               # e2e com devicePixelRatio 2 (canvas com bitmap = CSS × dpr)
//   node tools/perf/medir.mjs --vel 5x              # só estas velocidades no e2e (padrão: 1x,2x,5x,pausa)
//   node tools/perf/medir.mjs --sem-ticks           # pula a medição dos 36 000 ticks do turno (mais rápido)
//   node tools/perf/medir.mjs --json saida.json     # grava também o resultado bruto
//
// Dois modos, de propósito:
//  - micro: carrega a página SEM o main.ts (o laço do app não compete) e importa os módulos do dev server
//    (`/src/...`) para cronometrar cada peça isolada: ticks, snapshot, Renderer.desenhar em várias câmeras
//    (com e sem descarga do raster, pois o canvas 2D adia o desenho) e a atualização de DOM do HUD/log.
//  - e2e: o app inteiro com o rAF real; envolve (monkey-patch) os métodos públicos dos módulos para repartir o
//    tempo de cada quadro entre tick / snapshot / desenhar / HUD / log, e mede quadros por segundo e a ocupação
//    da thread principal (CDP Performance.getMetrics). Não precisa de nenhum código de medição dentro do app, então
//    serve para comparar versões antigas e novas do código.
//
// Atenção: sem --gpu o headless desenha por software (CPU). Os números absolutos são pessimistas para um
// navegador com GPU; compare versões entre si (relativo), na mesma máquina e no mesmo modo.

import { writeFileSync } from 'node:fs';
import { abrirNavegador, descreverGpu, estatisticas, fmt, iniciarPartida, lerArgs, URL_APP } from './comum.mjs';

const args = lerArgs();
const modo = args.modo ?? 'tudo';
const cenario = args.cenario ?? 'WH-B-MEGA';
const segundos = Number(args.seg ?? 8);
const [largura, altura] = String(args.tamanho ?? '1280x640').split('x').map(Number);
const dpr = Number(args.dpr ?? 1); // e2e: devicePixelRatio da página (o jogo limita o dpr efetivo, ver render/tela.ts)
const resultado = { cenario, modo, gpu: !!args.gpu, tamanho: [largura, altura], dpr };

const navegador = await abrirNavegador({ gpu: !!args.gpu, semLimite: !!args['sem-limite'] });

// ---------------------------------------------------------------------------------------------- micro

async function micro() {
  const page = await navegador.newPage();
  await page.setViewport({ width: largura, height: altura + 200 });
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().endsWith('/src/main.ts') ? r.abort() : r.continue()));
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(URL_APP, { waitUntil: 'load' });
  resultado.renderizador = await descreverGpu(page);

  const bruto = await page.evaluate(async (cfg) => {
    const { Simulacao } = await import('/src/sim/simulation.ts');
    const { Renderer } = await import('/src/render/renderer.ts');
    const { Camera } = await import('/src/render/camera.ts');
    const { Hud } = await import('/src/ui/hud.ts');
    const { Drawer } = await import('/src/ui/drawer.ts');
    const pacote = await (await fetch(`/src/data/cenarios/${cfg.cenario}.json`)).json();
    const agora = () => performance.now();
    const out = {};

    // --- sim: construção e ticks do turno inteiro ----------------------------------------------------------
    let t = agora();
    const sim = new Simulacao(pacote, 'AbcProximidade');
    out.simConstrucaoMs = agora() - t;
    out.locais = sim.layout.locais.length;
    out.equipamentos = sim.snapshot().equipamentos.length;
    const porTick = [];
    const porHora = [];
    let acumHora = 0;
    let n = 0;
    while (cfg.medirTicks && !sim.terminado) {
      t = agora();
      sim.tick();
      const d = agora() - t;
      porTick.push(d);
      acumHora += d;
      if (++n % 3600 === 0) { porHora.push(acumHora); acumHora = 0; }
    }
    out.ticksTotal = n;
    out.porTick = porTick;
    out.porHoraMs = porHora;

    // --- estado de meio de turno para o render/DOM ---------------------------------------------------------
    const sim2 = new Simulacao(pacote, 'AbcProximidade');
    for (let i = 0; i < cfg.ticksAteMeio; i++) sim2.tick();

    t = agora();
    for (let i = 0; i < 2000; i++) sim2.snapshot();
    out.snapshotMs = (agora() - t) / 2000;

    // --- render -----------------------------------------------------------------------------------------------
    const canvas = document.createElement('canvas');
    canvas.width = cfg.largura;
    canvas.height = cfg.altura;
    canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const renderer = new Renderer(ctx);
    let s = sim2.snapshot();
    const vaos = renderer.vaosDe(s.layout);
    const vaoSel = vaos[Math.floor(vaos.length / 2)].chave;
    const flush = () => ctx.getImageData(0, 0, 1, 1);

    // `ticks`: quantos ticks da sim rodam entre um quadro e outro (2 ≈ 5x a 60 fps: o estado muda a cada quadro);
    // 0 = jogo pausado (nada mudou desde o quadro anterior). Os ticks e o snapshot ficam FORA da medição.
    const cenas = {
      'pausado (nada mudou)': { zoom: 'enq', heatmap: false, sel: null, ticks: 0 },
      enquadrado: { zoom: 'enq', heatmap: false, sel: null },
      'enquadrado + heatmap': { zoom: 'enq', heatmap: true, sel: null },
      'enquadrado + seleção': { zoom: 'enq', heatmap: false, sel: vaoSel },
      'zoom 0,3 (rótulos)': { zoom: 0.3, heatmap: false, sel: null },
      'zoom 0,3 + heatmap': { zoom: 0.3, heatmap: true, sel: null },
      'zoom 1,0 (detalhe)': { zoom: 1, heatmap: false, sel: null },
      'pan contínuo (enquadrado)': { zoom: 'enq', heatmap: false, sel: null, pan: true },
      'zoom animado (roda)': { zoom: 'enq', heatmap: false, sel: null, rodaZoom: true },
    };
    out.render = {};
    for (const [nome, c] of Object.entries(cenas)) {
      const cam = new Camera();
      cam.enquadrar(s.layout.largura, s.layout.altura, cfg.largura, cfg.altura);
      if (c.zoom !== 'enq') {
        cam.escala = c.zoom;
        // centra no meio do armazém
        cam.offsetX = cfg.largura / 2 - (s.layout.largura / 2) * cam.escala;
        cam.offsetY = cfg.altura / 2 - (s.layout.altura / 2) * cam.escala;
      }
      const op = { heatmap: c.heatmap, vaoSelecionado: c.sel };
      const ticksPorQuadro = c.ticks ?? 2;
      const js = [];
      const total = [];
      for (let i = 0; i < cfg.quadros + 30; i++) {
        for (let k = 0; k < ticksPorQuadro; k++) sim2.tick();
        if (ticksPorQuadro > 0) s = sim2.snapshot();
        if (c.pan) cam.mover(i % 2 === 0 ? 3 : -3, 0);
        if (c.rodaZoom) cam.zoom(i % 2 === 0 ? 1.02 : 1 / 1.02, { x: cfg.largura / 2, y: cfg.altura / 2 });
        const a = agora();
        renderer.desenhar(s, cam, op);
        const b = agora();
        flush();
        const f = agora();
        if (i >= 30) { js.push(b - a); total.push(f - a); }
      }
      out.render[nome] = { js, total };
    }

    // --- DOM: HUD e log ----------------------------------------------------------------------------------------
    const hud = new Hud(() => {});
    const drawer = new Drawer([cfg.cenario], () => {}, () => {});
    const medirDom = (fn) => {
      const v = [];
      for (let i = 0; i < 300; i++) {
        const a = agora();
        fn(i);
        void document.body.offsetHeight; // força estilo + layout, que é onde o DOM custa de verdade
        v.push(agora() - a);
      }
      return v;
    };
    out.dom = {
      'Hud.atualizar (valores mudando)': medirDom(i => hud.atualizar({ ...s, relogioSeg: s.relogioSeg + i })),
      'Drawer.atualizarLog (sem evento novo)': medirDom(() => drawer.atualizarLog(s.eventos)),
      'Drawer.atualizarLog (evento novo: 50 li)': medirDom(i => drawer.atualizarLog([{ seg: i, texto: `evento ${i}` }, ...s.eventos])),
    };
    return out;
  }, { cenario, largura, altura, quadros: 300, ticksAteMeio: 14400, medirTicks: !args['sem-ticks'] });

  const porTick = estatisticas(bruto.porTick);
  const somaTicks = bruto.porTick.reduce((a, b) => a + b, 0);
  const mediaTick = bruto.ticksTotal ? somaTicks / bruto.ticksTotal : 0;
  resultado.micro = {
    locais: bruto.locais, equipamentos: bruto.equipamentos,
    simConstrucaoMs: bruto.simConstrucaoMs,
    tick: bruto.ticksTotal ? { ...porTick, mediaMs: mediaTick, turnoInteiroMs: somaTicks, porHoraMs: bruto.porHoraMs } : null,
    // custo por segundo REAL de cada velocidade (1x = 30 ticks/s, 2x = 60, 5x = 150), em ms
    tickPorSegReal: { '1x': mediaTick * 30, '2x': mediaTick * 60, '5x': mediaTick * 150 },
    snapshotMs: bruto.snapshotMs,
    render: Object.fromEntries(Object.entries(bruto.render).map(([k, v]) => [k, { js: estatisticas(v.js), total: estatisticas(v.total) }])),
    dom: Object.fromEntries(Object.entries(bruto.dom).map(([k, v]) => [k, estatisticas(v)])),
  };
  await page.close();
}

// ---------------------------------------------------------------------------------------------- e2e

const INJETAR_RAF = () => {
  const quadros = [];
  window.__quadros = quadros;
  window.__atual = null;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => {
    const rec = { t, tick: 0, snap: 0, draw: 0, hud: 0, log: 0, nticks: 0, nhud: 0, nlog: 0, ndraw: 0, total: 0 };
    window.__atual = rec;
    const a = performance.now();
    cb(t);
    rec.total = performance.now() - a;
    window.__atual = null;
    if (window.__gravando) quadros.push(rec);
  });
};

const PATCH_MODULOS = async () => {
  const soma = (proto, nome, campo, contador) => {
    const orig = proto[nome];
    proto[nome] = function (...a) {
      const rec = window.__atual;
      if (!rec) return orig.apply(this, a);
      const t = performance.now();
      const r = orig.apply(this, a);
      rec[campo] += performance.now() - t;
      rec[contador]++;
      return r;
    };
  };
  // O Vite acrescenta `?t=<hora>` à URL de módulos editados depois da primeira carga (HMR). O app usa essa URL; se
  // a importássemos sem o `?t=` seria OUTRA instância do módulo e o patch não pegaria. Acha a URL que o app carregou.
  const urlDe = caminho => {
    const e = performance.getEntriesByType('resource').map(r => r.name).reverse().find(n => new URL(n).pathname === caminho);
    return e ?? caminho;
  };
  const { Simulacao } = await import(urlDe('/src/sim/simulation.ts'));
  const { Renderer } = await import(urlDe('/src/render/renderer.ts'));
  const { Hud } = await import(urlDe('/src/ui/hud.ts'));
  const { Drawer } = await import(urlDe('/src/ui/drawer.ts'));
  // (o tempo de `desenhar` inclui as chamadas que ele pula por "nada mudou": `ndraw` conta todas, `draw` o custo)
  soma(Simulacao.prototype, 'tick', 'tick', 'nticks');
  soma(Simulacao.prototype, 'snapshot', 'snap', 'nsnap');
  soma(Renderer.prototype, 'desenhar', 'draw', 'ndraw');
  soma(Hud.prototype, 'atualizar', 'hud', 'nhud');
  soma(Drawer.prototype, 'atualizarLog', 'log', 'nlog');
};

async function metricasCdp(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map(m => [m.name, m.value]));
}

async function e2e() {
  const page = await navegador.newPage();
  await page.setViewport({ width: largura, height: altura + 200, deviceScaleFactor: dpr });
  await page.evaluateOnNewDocument(INJETAR_RAF);
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  await page.goto(URL_APP, { waitUntil: 'load' });
  await page.waitForSelector('#kpi-clock');
  resultado.renderizador = resultado.renderizador ?? await descreverGpu(page);
  await page.evaluate(PATCH_MODULOS);

  // login (convidado) → pré-partida → "Iniciar turno" no cenário pedido: o mesmo caminho do jogador
  await iniciarPartida(page, cenario);
  await new Promise(r => setTimeout(r, 1000));
  const box = await (await page.$('#warehouse-canvas')).boundingBox();
  resultado.canvasCss = [Math.round(box.width), Math.round(box.height)];
  resultado.canvasBitmap = await page.evaluate(() => { const c = document.getElementById('warehouse-canvas'); return [c.width, c.height]; });
  const centro = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const preparar = {
    enquadrado: async () => { await page.click('#btn-reset-cam'); },
    'zoom (roda x6)': async () => {
      await page.click('#btn-reset-cam');
      await page.mouse.move(centro.x, centro.y);
      for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: -100 });
    },
  };
  resultado.e2e = {};
  for (const vel of String(args.vel ?? '1x,2x,5x,pausa').split(',')) {
    for (const [nomeCena, prep] of Object.entries(preparar)) {
      for (const heat of [false, true]) {
        const nome = `${vel} · ${nomeCena}${heat ? ' + heatmap' : ''}`;
        if (heat && nomeCena !== 'enquadrado') continue;
        await prep();
        await page.click(vel === 'pausa' ? '#btn-pause' : `#btn-play-${vel}`);
        // liga/desliga o heatmap conforme o cenário (estado do botão no app)
        const estadoHeat = await page.evaluate(() => window.__heat ?? false);
        if (estadoHeat !== heat) { await page.click('#btn-toggle-heatmap'); await page.evaluate(h => { window.__heat = h; }, heat); }
        await new Promise(r => setTimeout(r, 600));
        await page.evaluate(() => { window.__quadros.length = 0; window.__gravando = true; });
        const m0 = await metricasCdp(cdp);
        await new Promise(r => setTimeout(r, segundos * 1000));
        const m1 = await metricasCdp(cdp);
        const quadros = await page.evaluate(() => { window.__gravando = false; return window.__quadros.slice(); });
        const dur = (m1.Timestamp - m0.Timestamp);
        const col = k => quadros.map(q => q[k]);
        const intervalos = quadros.slice(1).map((q, i) => q.t - quadros[i].t);
        resultado.e2e[nome] = {
          quadros: quadros.length, fps: quadros.length / dur,
          intervalo: estatisticas(intervalos),
          total: estatisticas(col('total')), tick: estatisticas(col('tick')), snap: estatisticas(col('snap')),
          draw: estatisticas(col('draw')), hud: estatisticas(col('hud')), log: estatisticas(col('log')),
          ticksPorQuadro: quadros.reduce((a, q) => a + q.nticks, 0) / Math.max(1, quadros.length),
          // quantas vezes por segundo cada peça foi chamada (HUD e log eram 60/s; agora ~10/s, e o HUD só se o relógio andou)
          chamadasPorSeg: {
            hud: quadros.reduce((a, q) => a + q.nhud, 0) / dur, log: quadros.reduce((a, q) => a + q.nlog, 0) / dur,
            desenhar: quadros.reduce((a, q) => a + q.ndraw, 0) / dur,
          },
          threadOcupada: (m1.TaskDuration - m0.TaskDuration) / dur,
          scriptS: (m1.ScriptDuration - m0.ScriptDuration) / dur,
          layoutEstiloS: ((m1.LayoutDuration - m0.LayoutDuration) + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) / dur,
        };
      }
    }
    await page.click('#btn-pause');
  }
  await page.close();
}

// ---------------------------------------------------------------------------------------------- relatório

function relatorio() {
  const linhas = [];
  const p = (...x) => linhas.push(x.join(' '));
  p(`## ${cenario} — ${resultado.renderizador} — canvas ${largura}x${altura}${args.gpu ? ' (GPU)' : ' (software)'}, dpr ${dpr}`
    + (resultado.canvasBitmap ? ` (bitmap do canvas ${resultado.canvasBitmap.join('x')} para ${resultado.canvasCss.join('x')} de CSS)` : ''));
  const m = resultado.micro;
  if (m) {
    p(`\nSim (${m.locais} locais, ${m.equipamentos} empilhadeiras): construção ${fmt(m.simConstrucaoMs, 0)} ms`);
    if (m.tick) {
      p(`Tick médio ${fmt(m.tick.mediaMs, 3)} ms (p95 ${fmt(m.tick.p95, 2)}, p99 ${fmt(m.tick.p99, 2)}, máx ${fmt(m.tick.max, 1)}) — turno inteiro ${fmt(m.tick.turnoInteiroMs / 1000, 2)} s`);
      p(`Custo dos ticks por segundo real: 1x ${fmt(m.tickPorSegReal['1x'])} ms · 2x ${fmt(m.tickPorSegReal['2x'])} ms · 5x ${fmt(m.tickPorSegReal['5x'])} ms`
        + ` (≈ ${fmt(m.tickPorSegReal['5x'] / 60)} ms por quadro a 60 fps em 5x)`);
    }
    p(`Snapshot: ${fmt(m.snapshotMs * 1000, 1)} µs por chamada`);
    p('\nRender (ms/quadro: só o JS | com descarga do raster)  mediana · média · p95');
    for (const [k, v] of Object.entries(m.render)) {
      p(`  ${k.padEnd(28)} ${fmt(v.js.p50)} · ${fmt(v.js.media)} · ${fmt(v.js.p95)}  |  ${fmt(v.total.p50)} · ${fmt(v.total.media)} · ${fmt(v.total.p95)}`);
    }
    p('\nDOM (ms/chamada, com layout forçado)  mediana · média · p95');
    for (const [k, v] of Object.entries(m.dom)) p(`  ${k.padEnd(42)} ${fmt(v.p50, 3)} · ${fmt(v.media, 3)} · ${fmt(v.p95, 3)}`);
  }
  if (resultado.e2e) {
    p('\nApp inteiro (rAF real): fps · ms/quadro total (p95) · tick | snapshot | desenhar | hud | log (médias, ms) · ticks/quadro · thread ocupada');
    for (const [k, v] of Object.entries(resultado.e2e)) {
      p(`  ${k.padEnd(36)} ${fmt(v.fps, 1)} fps · ${fmt(v.total.media)} (${fmt(v.total.p95)}) · ${fmt(v.tick.media)} | ${fmt(v.snap.media)} | ${fmt(v.draw.media)} | ${fmt(v.hud.media)} | ${fmt(v.log.media)}`
        + ` · ${fmt(v.ticksPorQuadro, 1)} · ${fmt(v.threadOcupada * 100, 0)}%`
        + ` · layout+estilo ${fmt(v.layoutEstiloS * 100, 0)}% · hud ${fmt(v.chamadasPorSeg.hud, 0)}/s log ${fmt(v.chamadasPorSeg.log, 0)}/s`);
    }
  }
  console.log(linhas.join('\n'));
}

try {
  if (modo === 'micro' || modo === 'tudo') await micro();
  if (modo === 'e2e' || modo === 'tudo') await e2e();
  relatorio();
  if (typeof args.json === 'string') writeFileSync(args.json, JSON.stringify(resultado, null, 1));
} finally {
  await navegador.close();
}
