import { LocalArmazenagem, Empilhadeira } from '../models/types';

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

    // Docas Inbound e Outbound
    ctx.fillStyle = '#064e3b'; ctx.fillRect(20, 90, 60, 160);
    ctx.fillStyle = '#6ee7b7'; ctx.font = '10px sans-serif'; ctx.fillText('DOCA IN', 26, 175);
    ctx.fillStyle = '#1e3a8a'; ctx.fillRect(20, 290, 60, 160);
    ctx.fillStyle = '#93c5fd'; ctx.fillText('DOCA OUT', 24, 375);

    // Posições dos Racks
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
