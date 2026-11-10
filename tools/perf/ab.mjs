// Compara DOIS renderers (versões diferentes do código) quadro a quadro, intercalados na mesma página.
// Pré-requisitos e variáveis de ambiente: veja o topo de comum.mjs.
//
//   # 1) a versão antiga num diretório à parte (ex.: git archive de um commit), servida em outra porta:
//   #      cd /tmp/antes && npx vite --port 3201 --no-open
//   # 2) a versão nova no repo:  npx vite --port 3200 --no-open
//   node tools/perf/ab.mjs --a http://localhost:3201 --b http://localhost:3200 [--gpu] [--quadros 300]
//
// Por que existe: a máquina de desenvolvimento costuma estar carregada (outros processos), e medir A e depois B em
// momentos diferentes mistura a diferença do código com a da carga. Aqui cada quadro é desenhado pelos dois
// renderers em sequência (a ordem alterna), com a MESMA sim, câmera e snapshot, então a carga atinge os dois igual.
// A página é a do lado B; o módulo do lado A é importado da outra origem (o dev server do Vite libera CORS).
// Mede JS puro (`js`) e JS + descarga do raster (`total`, com getImageData 1×1; o canvas 2D adia o desenho).

import { abrirNavegador, estatisticas, fmt, lerArgs } from './comum.mjs';

const args = lerArgs();
const urlA = args.a ?? 'http://localhost:3201';
const urlB = args.b ?? 'http://localhost:3200';
const [largura, altura] = String(args.tamanho ?? '1280x640').split('x').map(Number);
const quadros = Number(args.quadros ?? 300);
const cenario = args.cenario ?? 'WH-B-MEGA';

const navegador = await abrirNavegador({ gpu: !!args.gpu });
const page = await navegador.newPage();
await page.setViewport({ width: largura, height: altura + 200 });
await page.setRequestInterception(true);
page.on('request', r => (r.url().endsWith('/src/main.ts') ? r.abort() : r.continue()));
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(urlB, { waitUntil: 'load' });

const resultado = await page.evaluate(async (urlA, w, h, N, cenario) => {
  const { Simulacao } = await import('/src/sim/simulation.ts');
  const { Camera } = await import('/src/render/camera.ts');
  const lados = [
    { nome: 'A', mod: await import(`${urlA}/src/render/renderer.ts`) },
    { nome: 'B', mod: await import('/src/render/renderer.ts') },
  ];
  const pacote = await (await fetch(`/src/data/cenarios/${cenario}.json`)).json();
  const sim = new Simulacao(pacote, 'AbcProximidade');
  for (let i = 0; i < 14400; i++) sim.tick();
  for (const l of lados) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.style.cssText = 'position:fixed;left:0;top:0;';
    document.body.appendChild(c);
    l.ctx = c.getContext('2d');
    l.renderer = new l.mod.Renderer(l.ctx);
  }
  const s0 = sim.snapshot();
  const cenas = {
    'pausado (nada mudou)': { zoom: 'enq', ticks: 0 },
    'enquadrado': { zoom: 'enq' },
    'enquadrado + heatmap': { zoom: 'enq', heatmap: true },
    'enquadrado + seleção': { zoom: 'enq', selecao: true },
    'zoom 0,3 (rótulos)': { zoom: 0.3 },
    'zoom 0,3 + heatmap': { zoom: 0.3, heatmap: true },
    'zoom 1,0 (detalhe)': { zoom: 1 },
    'pan contínuo': { zoom: 0.3, pan: true },
    'zoom animado (roda)': { zoom: 'enq', rodaZoom: true },
  };
  const out = {};
  for (const [nome, c] of Object.entries(cenas)) {
    const js = { A: [], B: [] };
    const total = { A: [], B: [] };
    const cam = new Camera();
    cam.enquadrar(s0.layout.largura, s0.layout.altura, w, h);
    if (c.zoom !== 'enq') {
      cam.escala = c.zoom;
      cam.offsetX = w / 2 - s0.layout.largura * 0.5 * c.zoom;
      cam.offsetY = h / 2 - s0.layout.altura * 0.45 * c.zoom;
    }
    const vaos = lados[1].renderer.vaosDe(s0.layout);
    const sel = c.selecao ? vaos[Math.floor(vaos.length / 2)].chave : null;
    let s = s0;
    for (let i = 0; i < N + 20; i++) {
      // 2 ticks por quadro ≈ 5x a 60 fps (o estado muda a cada quadro); `ticks: 0` = jogo pausado
      for (let k = 0; k < (c.ticks ?? 2); k++) sim.tick();
      if ((c.ticks ?? 2) > 0) s = sim.snapshot();
      if (c.pan) cam.mover(i % 2 === 0 ? 3 : -3, 0);
      if (c.rodaZoom) cam.zoom(i % 2 === 0 ? 1.02 : 1 / 1.02, { x: w / 2, y: h / 2 });
      for (let k = 0; k < 2; k++) {
        const l = lados[(k + i) % 2]; // alterna quem desenha primeiro
        const a = performance.now();
        l.renderer.desenhar(s, cam, { heatmap: !!c.heatmap, vaoSelecionado: sel });
        const b = performance.now();
        l.ctx.getImageData(0, 0, 1, 1);
        const f = performance.now();
        if (i >= 20) { js[l.nome].push(b - a); total[l.nome].push(f - a); }
      }
    }
    out[nome] = { js, total };
  }
  return out;
}, urlA, largura, altura, quadros, cenario);

console.log(`${cenario}, canvas ${largura}x${altura}, ${args.gpu ? 'GPU (ANGLE/Vulkan)' : 'software'}, ${quadros} quadros por cena; ms por quadro, mediana (média)`);
console.log('cena'.padEnd(24), 'JS  A'.padStart(14), 'JS  B'.padStart(14), '| JS+raster A'.padStart(16), 'JS+raster B'.padStart(14), '  B/A (JS+raster)');
for (const [nome, v] of Object.entries(resultado)) {
  const f = x => { const e = estatisticas(x); return `${fmt(e.p50)} (${fmt(e.media)})`; };
  const razao = estatisticas(v.total.B).p50 / Math.max(1e-9, estatisticas(v.total.A).p50);
  console.log(nome.padEnd(24), f(v.js.A).padStart(14), f(v.js.B).padStart(14), '|', f(v.total.A).padStart(13), f(v.total.B).padStart(14), `  ${fmt(razao, 2)}x`);
}
await navegador.close();
