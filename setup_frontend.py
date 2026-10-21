import os
import json

BASE = "wmsoffice-the-game-frontend"

FILES = {
    # 1. package.json
    f"{BASE}/package.json": json.dumps({
        "name": "wmsoffice-the-game",
        "private": True,
        "version": "1.0.0",
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "tsc && vite build",
            "preview": "vite preview",
            "cap:sync": "vite build && npx cap sync",
            "cap:android": "vite build && npx cap sync android && npx cap open android"
        },
        "dependencies": {
            "@capacitor/core": "^6.0.0",
            "@capacitor/android": "^6.0.0",
            "lucide": "^0.395.0"
        },
        "devDependencies": {
            "@capacitor/cli": "^6.0.0",
            "typescript": "^5.4.5",
            "vite": "^5.2.11"
        }
    }, indent=2),

    # 2. tsconfig.json
    f"{BASE}/tsconfig.json": json.dumps({
        "compilerOptions": {
            "target": "ES2022",
            "useDefineForClassFields": True,
            "module": "ESNext",
            "lib": ["ES2022", "DOM", "DOM.Iterable"],
            "skipLibCheck": True,
            "moduleResolution": "bundler",
            "allowImportingTsExtensions": True,
            "resolveJsonModule": True,
            "isolatedModules": True,
            "noEmit": True,
            "strict": True
        },
        "include": ["src"]
    }, indent=2),

    # 3. vite.config.ts
    f"{BASE}/vite.config.ts": """import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  },
  server: {
    port: 3000,
    open: true
  }
});
""",

    # 4. capacitor.config.json
    f"{BASE}/capacitor.config.json": json.dumps({
        "appId": "com.npdev.wmsofficegame",
        "appName": "WmsOffice: The Game",
        "webDir": "dist",
        "bundledWebRuntime": False,
        "server": {
            "androidScheme": "https"
        }
    }, indent=2),

    # 5. index.html
    f"{BASE}/index.html": """<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>WmsOffice: The Game</title>
  <link rel="stylesheet" href="/src/style.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <div id="app">
    <header class="hud-header">
      <div class="hud-branding">
        <span class="logo-tag">NPDev Engine</span>
        <h1>WmsOffice <span>The Game</span></h1>
      </div>
      <div class="hud-telemetry">
        <div class="kpi-card">
          <span class="kpi-label">TEMPO SIMULADO</span>
          <span id="kpi-clock" class="kpi-value font-mono">08:00:00</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">SCORE EFICIÊNCIA</span>
          <span id="kpi-score" class="kpi-value font-mono highlight">92.4%</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">DISTÂNCIA TOTAL</span>
          <span id="kpi-distance" class="kpi-value font-mono">1.240 m</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">OCUPAÇÃO</span>
          <span id="kpi-occupancy" class="kpi-value font-mono">68%</span>
        </div>
      </div>
      <div class="hud-controls">
        <button id="btn-pause" class="btn-ctrl" title="Pausar">⏸</button>
        <button id="btn-play-1x" class="btn-ctrl active" title="Velocidade 1x">1x</button>
        <button id="btn-play-2x" class="btn-ctrl" title="Velocidade 2x">2x</button>
        <button id="btn-play-5x" class="btn-ctrl" title="Velocidade 5x">5x</button>
      </div>
    </header>

    <main class="viewport-container">
      <canvas id="warehouse-canvas"></canvas>
      <div class="viewport-floating-actions">
        <button id="btn-zoom-in" class="btn-floating" title="Zoom In">+</button>
        <button id="btn-zoom-out" class="btn-floating" title="Zoom Out">-</button>
        <button id="btn-reset-cam" class="btn-floating" title="Centralizar">🎯</button>
        <button id="btn-toggle-heatmap" class="btn-floating" title="Heatmap Tráfego">🔥</button>
      </div>
      <div id="inspector-card" class="inspector-card hidden">
        <div class="inspector-header">
          <h3 id="inspector-title">Posição A-01-02</h3>
          <button id="inspector-close" class="btn-icon">✕</button>
        </div>
        <div class="inspector-body">
          <div class="prop-row"><span>Rua / Bloco:</span><b id="inspector-rua">Rua 01</b></div>
          <div class="prop-row"><span>Produto:</span><b id="inspector-produto">SKU-9921</b></div>
          <div class="prop-row"><span>Rotatividade (ABC):</span><b id="inspector-abc" class="badge-abc">Classe A</b></div>
          <div class="prop-row"><span>Acessos / Picking:</span><b id="inspector-pickings">48 ciclos</b></div>
        </div>
      </div>
    </main>

    <section class="strategy-drawer" id="strategy-drawer">
      <div class="drawer-handle" id="drawer-toggle">
        <span class="handle-bar"></span>
        <span class="drawer-title">Painel de Regras & Políticas de Alocação</span>
      </div>
      <div class="drawer-content">
        <div class="strategy-columns">
          <div class="config-panel">
            <h3>Política de Putaway</h3>
            <p class="config-hint">Regra de endereçamento para paletes recebidos.</p>
            <div class="form-group">
              <label for="select-policy">Estratégia Ativa:</label>
              <select id="select-policy" class="form-select">
                <option value="ABC_PROXIMITY">Curva ABC por Proximidade de Doca</option>
                <option value="FIFO_FIRST_AVAILABLE">FIFO + Primeira Posição Disponível</option>
                <option value="VOLUME_CONSOLIDATION">Consolidação de Lote</option>
                <option value="RANDOM_STRESS">Aleatório (Cenário Caos)</option>
              </select>
            </div>
          </div>
          <div class="config-panel">
            <h3>Cenário de Demanda</h3>
            <div class="form-group">
              <label for="select-scenario">Cenário NPDev:</label>
              <select id="select-scenario" class="form-select">
                <option value="warehouse-a-small">Warehouse A - Pequeno Porte (200 SKUs)</option>
                <option value="warehouse-b-large">Warehouse B - Megacentro (1.500 SKUs)</option>
              </select>
            </div>
            <div class="panel-actions">
              <button id="btn-inject-batch" class="btn-primary">Injetar Novo Lote de NF</button>
            </div>
          </div>
          <div class="config-panel">
            <h3>Log de Eventos</h3>
            <ul id="sim-events-log" class="events-log font-mono">
              <li>[08:00:00] Simulação iniciada com perfil ABC_PROXIMITY.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
""",

    # 6. src/style.css
    f"{BASE}/src/style.css": """:root {
  --bg-dark: #0f141c;
  --bg-card: #161e2b;
  --bg-card-hover: #1e293b;
  --border-color: #2b394f;
  --accent-cyan: #00d2ff;
  --accent-green: #10b981;
  --accent-amber: #f59e0b;
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
body, html { width: 100%; height: 100%; overflow: hidden; background: var(--bg-dark); color: var(--text-main); font-family: var(--font-sans); }
#app { display: flex; flex-direction: column; width: 100vw; height: 100vh; }
.hud-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; background: rgba(15,20,28,0.95); border-bottom: 1px solid var(--border-color); z-index: 10; gap: 12px; }
.logo-tag { font-size: 0.65rem; color: var(--accent-cyan); font-weight: 800; letter-spacing: 1px; }
.hud-branding h1 { font-size: 1.15rem; font-weight: 800; }
.hud-branding h1 span { color: var(--accent-cyan); }
.hud-telemetry { display: flex; gap: 12px; align-items: center; }
.kpi-card { background: var(--bg-card); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 8px; display: flex; flex-direction: column; min-width: 100px; }
.kpi-label { font-size: 0.65rem; color: var(--text-muted); font-weight: 700; }
.kpi-value { font-size: 0.95rem; font-weight: 700; }
.kpi-value.highlight { color: var(--accent-green); }
.font-mono { font-family: var(--font-mono); }
.hud-controls { display: flex; gap: 6px; background: var(--bg-card); padding: 4px; border-radius: 8px; border: 1px solid var(--border-color); }
.btn-ctrl { background: transparent; border: none; color: var(--text-muted); font-weight: 700; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.btn-ctrl.active { background: var(--accent-cyan); color: #000; }
.viewport-container { flex: 1; position: relative; overflow: hidden; background: #0b0f14; }
#warehouse-canvas { width: 100%; height: 100%; display: block; }
.viewport-floating-actions { position: absolute; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 5; }
.btn-floating { width: 40px; height: 40px; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; cursor: pointer; font-size: 1.1rem; }
.inspector-card { position: absolute; top: 16px; left: 16px; background: var(--bg-card); border: 1px solid var(--border-color); padding: 14px; border-radius: 12px; width: 260px; z-index: 5; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.inspector-card.hidden { display: none; }
.inspector-header { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; margin-bottom: 8px; }
.inspector-header h3 { font-size: 0.95rem; color: var(--accent-cyan); }
.btn-icon { background: none; border: none; color: var(--text-muted); cursor: pointer; }
.prop-row { display: flex; flex-direction: column; margin-bottom: 8px; font-size: 0.8rem; }
.prop-row span { color: var(--text-muted); font-size: 0.7rem; }
.badge-abc { color: var(--accent-amber); }
.strategy-drawer { background: var(--bg-card); border-top: 1px solid var(--border-color); display: flex; flex-direction: column; z-index: 10; max-height: 250px; }
.drawer-handle { display: flex; flex-direction: column; align-items: center; padding: 6px; cursor: pointer; background: rgba(22,30,43,0.8); }
.handle-bar { width: 36px; height: 4px; background: var(--border-color); border-radius: 2px; margin-bottom: 4px; }
.drawer-title { font-size: 0.75rem; font-weight: 700; color: var(--accent-cyan); text-transform: uppercase; }
.drawer-content { padding: 12px 18px; overflow-y: auto; }
.strategy-columns { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 16px; }
.config-panel { background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; }
.config-panel h3 { font-size: 0.85rem; margin-bottom: 4px; }
.config-hint { font-size: 0.7rem; color: var(--text-muted); margin-bottom: 8px; }
.form-group { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; font-size: 0.75rem; }
.form-select { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); padding: 6px; border-radius: 6px; font-size: 0.8rem; }
.btn-primary { background: var(--accent-cyan); color: #000; font-weight: 700; border: none; padding: 8px; border-radius: 6px; cursor: pointer; width: 100%; font-size: 0.8rem; }
.events-log { list-style: none; font-size: 0.7rem; color: var(--text-muted); max-height: 90px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 900px) {
  .hud-header { flex-wrap: wrap; }
  .hud-telemetry { order: 3; width: 100%; overflow-x: auto; }
  .strategy-columns { grid-template-columns: 1fr; }
}
""",

    # 7. src/models/types.ts
    f"{BASE}/src/models/types.ts": """export interface LocalArmazenagem {
  id: string;
  codigo: string;
  ruaId: string;
  ruaNome: string;
  predio: number;
  nivel: number;
  status: 'VAZIO' | 'OCUPADO';
  produtoNome?: string;
  classeABC?: 'A' | 'B' | 'C';
  acessosPicking: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface Empilhadeira {
  id: string;
  nome: string;
  x: number;
  y: number;
  velocidade: number;
  rota: Array<{ x: number; y: number }>;
}

export type PoliticaAlocacao = 
  | 'ABC_PROXIMITY'
  | 'FIFO_FIRST_AVAILABLE'
  | 'VOLUME_CONSOLIDATION'
  | 'RANDOM_STRESS';
""",

    # 8. src/game/WarehouseEngine.ts
    f"{BASE}/src/game/WarehouseEngine.ts": """import { LocalArmazenagem, Empilhadeira } from '../models/types';

export class WarehouseEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private locais: LocalArmazenagem[] = [];
  private empilhadeiras: Empilhadeira[] = [];
  private scale: number = 1.0;
  private offsetX: number = 40;
  private offsetY: number = 40;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private showHeatmap: boolean = false;
  private onSelectLocal?: (local: LocalArmazenagem) => void;

  constructor(canvas: HTMLCanvasElement, onSelect?: (local: LocalArmazenagem) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onSelectLocal = onSelect;
    this.setupEvents();
    this.resize();
    this.initLayout();
    this.loop();
  }

  public resize() {
    this.canvas.width = this.canvas.parentElement?.clientWidth || window.innerWidth;
    this.canvas.height = this.canvas.parentElement?.clientHeight || window.innerHeight;
  }

  private initLayout() {
    this.locais = [];
    const ruas = ['Rua 01 (Secos)', 'Rua 02 (Alimentos)', 'Rua 03 (Higiene)', 'Rua 04 (Bebidas)'];
    ruas.forEach((rua, rIdx) => {
      const y = 100 + rIdx * 110;
      for (let p = 0; p < 12; p++) {
        const x = 130 + p * 52;
        const occ = Math.random() > 0.35;
        const abc: 'A' | 'B' | 'C' = p < 3 ? 'A' : (p < 7 ? 'B' : 'C');
        this.locais.push({
          id: `loc-${rIdx}-${p}`,
          codigo: `R${rIdx + 1}-A-${p + 1}`,
          ruaId: `rua-${rIdx + 1}`,
          ruaNome: rua,
          predio: p + 1,
          nivel: 1,
          status: occ ? 'OCUPADO' : 'VAZIO',
          produtoNome: occ ? `Item ${abc}-${p + 1}` : undefined,
          classeABC: abc,
          acessosPicking: Math.floor(Math.random() * 80),
          x, y, largura: 44, altura: 32
        });
      }
    });

    this.empilhadeiras = [
      { id: 'emp-1', nome: 'Empilhadeira 01', x: 50, y: 130, velocidade: 2.2, rota: [{ x: 320, y: 130 }, { x: 320, y: 220 }, { x: 50, y: 130 }] },
      { id: 'emp-2', nome: 'Transpaleteira 02', x: 400, y: 340, velocidade: 1.8, rota: [{ x: 550, y: 340 }, { x: 50, y: 440 }, { x: 400, y: 340 }] }
    ];
  }

  private setupEvents() {
    const startDrag = (x: number, y: number) => { this.isDragging = true; this.dragStartX = x - this.offsetX; this.dragStartY = y - this.offsetY; };
    const moveDrag = (x: number, y: number) => { if (this.isDragging) { this.offsetX = x - this.dragStartX; this.offsetY = y - this.dragStartY; } };
    const stopDrag = () => { this.isDragging = false; };

    this.canvas.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', stopDrag);

    this.canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY); });
    window.addEventListener('touchmove', (e) => { if (e.touches.length === 1) moveDrag(e.touches[0].clientX, e.touches[0].clientY); });
    window.addEventListener('touchend', stopDrag);

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left - this.offsetX) / this.scale;
      const cy = (e.clientY - rect.top - this.offsetY) / this.scale;
      const found = this.locais.find(l => cx >= l.x && cx <= l.x + l.largura && cy >= l.y && cy <= l.y + l.altura);
      if (found && this.onSelectLocal) this.onSelectLocal(found);
    });

    window.addEventListener('resize', () => this.resize());
  }

  public zoom(delta: number) { this.scale = Math.min(Math.max(0.4, this.scale + delta), 2.5); }
  public resetCamera() { this.scale = 1.0; this.offsetX = 40; this.offsetY = 40; }
  public toggleHeatmap() { this.showHeatmap = !this.showHeatmap; }

  public update(speed: number) {
    if (speed === 0) return;
    this.empilhadeiras.forEach(emp => {
      const target = emp.rota[0];
      const dx = target.x - emp.x;
      const dy = target.y - emp.y;
      const dist = Math.hypot(dx, dy);
      const step = emp.velocidade * speed;
      if (dist <= step) {
        emp.x = target.x; emp.y = target.y;
        emp.rota.shift(); emp.rota.push(target);
      } else {
        emp.x += (dx / dist) * step;
        emp.y += (dy / dist) * step;
      }
    });
  }

  private loop = () => {
    this.draw();
    requestAnimationFrame(this.loop);
  };

  private draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // Docas
    ctx.fillStyle = '#064e3b'; ctx.fillRect(20, 90, 60, 160);
    ctx.fillStyle = '#6ee7b7'; ctx.font = '10px sans-serif'; ctx.fillText('DOCA IN', 26, 175);
    ctx.fillStyle = '#1e3a8a'; ctx.fillRect(20, 290, 60, 160);
    ctx.fillStyle = '#93c5fd'; ctx.fillText('DOCA OUT', 24, 375);

    // Posições
    this.locais.forEach(loc => {
      if (this.showHeatmap) {
        const i = Math.min(loc.acessosPicking / 80, 1);
        ctx.fillStyle = `rgba(239, 68, 68, ${0.2 + i * 0.75})`;
      } else {
        ctx.fillStyle = loc.status === 'OCUPADO' ? (loc.classeABC === 'A' ? '#3b82f6' : loc.classeABC === 'B' ? '#10b981' : '#64748b') : '#1e293b';
      }
      ctx.fillRect(loc.x, loc.y, loc.largura, loc.altura);
      ctx.strokeStyle = '#334155'; ctx.strokeRect(loc.x, loc.y, loc.largura, loc.altura);
      ctx.fillStyle = '#ffffff'; ctx.font = '8px monospace'; ctx.fillText(loc.codigo, loc.x + 4, loc.y + 18);
    });

    // Empilhadeiras
    this.empilhadeiras.forEach(emp => {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.arc(emp.x, emp.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '9px sans-serif'; ctx.fillText(emp.nome.split(' ')[0], emp.x - 12, emp.y - 12);
    });

    ctx.restore();
  }
}
""",

    # 9. src/services/npdevClient.ts
    f"{BASE}/src/services/npdevClient.ts": """import { PoliticaAlocacao } from '../models/types';

export class NPDevClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8080/api') {
    this.baseUrl = baseUrl;
  }

  public async atualizarPolitica(politica: PoliticaAlocacao): Promise<{ success: boolean }> {
    try {
      const resp = await fetch(`${this.baseUrl}/simulacao/politica`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ politica })
      });
      return await resp.json();
    } catch {
      return { success: true }; // Fallback offline
    }
  }

  public async injetarLoteNotasFiscais(cenarioId: string): Promise<any> {
    try {
      const resp = await fetch(`${this.baseUrl}/simulacao/injetar-lote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cenarioId })
      });
      return await resp.json();
    } catch {
      return { status: 'MOCK_INJECTED', totalNovosPaletes: 16 };
    }
  }
}
""",

    # 10. src/main.ts
    f"{BASE}/src/main.ts": """import { WarehouseEngine } from './game/WarehouseEngine';
import { NPDevClient } from './services/npdevClient';
import { LocalArmazenagem, PoliticaAlocacao } from './models/types';

class GameController {
  private engine!: WarehouseEngine;
  private client: NPDevClient = new NPDevClient();
  private speed: number = 1.0;
  private simulatedSeconds: number = 8 * 3600;

  constructor() {
    window.addEventListener('DOMContentLoaded', () => this.init());
  }

  private init() {
    const canvas = document.getElementById('warehouse-canvas') as HTMLCanvasElement;
    this.engine = new WarehouseEngine(canvas, (l) => this.showInspector(l));

    const speeds = [
      { id: 'btn-pause', v: 0 }, { id: 'btn-play-1x', v: 1 },
      { id: 'btn-play-2x', v: 2 }, { id: 'btn-play-5x', v: 5 }
    ];
    speeds.forEach(s => {
      document.getElementById(s.id)?.addEventListener('click', () => {
        speeds.forEach(b => document.getElementById(b.id)?.classList.remove('active'));
        document.getElementById(s.id)?.classList.add('active');
        this.speed = s.v;
      });
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.engine.zoom(0.2));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.engine.zoom(-0.2));
    document.getElementById('btn-reset-cam')?.addEventListener('click', () => this.engine.resetCamera());
    document.getElementById('btn-toggle-heatmap')?.addEventListener('click', () => this.engine.toggleHeatmap());
    document.getElementById('inspector-close')?.addEventListener('click', () => {
      document.getElementById('inspector-card')?.classList.add('hidden');
    });

    document.getElementById('btn-inject-batch')?.addEventListener('click', async () => {
      this.log('Novo lote de NF-e injetado na Doca 01.');
      await this.client.injetarLoteNotasFiscais('warehouse-a-small');
    });

    document.getElementById('select-policy')?.addEventListener('change', async (e) => {
      const val = (e.target as HTMLSelectElement).value as PoliticaAlocacao;
      this.log(`Política alterada: ${val}`);
      await this.client.atualizarPolitica(val);
    });

    setInterval(() => {
      if (this.speed > 0) {
        this.simulatedSeconds += this.speed;
        this.engine.update(this.speed);
        const clock = document.getElementById('kpi-clock');
        if (clock) clock.innerText = this.formatTime(this.simulatedSeconds);
      }
    }, 1000 / 30);
  }

  private showInspector(local: LocalArmazenagem) {
    const card = document.getElementById('inspector-card');
    card?.classList.remove('hidden');
    (document.getElementById('inspector-title') as HTMLElement).innerText = `Posição: ${local.codigo}`;
    (document.getElementById('inspector-rua') as HTMLElement).innerText = local.ruaNome;
    (document.getElementById('inspector-produto') as HTMLElement).innerText = local.produtoNome || 'Livre';
    (document.getElementById('inspector-abc') as HTMLElement).innerText = `Classe ${local.classeABC || 'N/A'}`;
    (document.getElementById('inspector-pickings') as HTMLElement).innerText = `${local.acessosPicking} ciclos`;
  }

  private log(msg: string) {
    const ul = document.getElementById('sim-events-log');
    if (!ul) return;
    const li = document.createElement('li');
    li.innerText = `[${this.formatTime(this.simulatedSeconds)}] ${msg}`;
    ul.prepend(li);
  }

  private formatTime(s: number) {
    const h = String(Math.floor(s / 3600) % 24).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }
}

new GameController();
""",

    # 11. README.md
    f"{BASE}/README.md": """# WmsOffice: The Game

Frontend mobile-first para o jogo de simulação WMS integrado com NPDev.

## Como Executar
```bash
npm install
npm run dev