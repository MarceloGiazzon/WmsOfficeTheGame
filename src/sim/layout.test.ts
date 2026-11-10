import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import { construirLayout, GEOMETRIA, manhattan } from './layout';
import type { PacoteCenario } from './model';

const cenarios = { 'WH-A-PEQUENO': whA, 'WH-B-MEGA': whB } as unknown as Record<string, PacoteCenario>;

describe.each(Object.entries(cenarios))('layout %s', (_, pacote) => {
  const layout = construirLayout(pacote);
  const c = pacote.cenario;
  const ruasArmazenagem = pacote.ruas.filter(r => r.codigo.startsWith('R'));

  it('uma posição de layout por local de armazenagem', () => {
    const esperado = ruasArmazenagem.reduce((n, r) => n + r.qtdPosicoes * r.qtdAndares, 0);
    expect(layout.locais).toHaveLength(esperado);
    expect(new Set(layout.locais.map(l => l.localId)).size).toBe(esperado);
  });

  it('docas batem com o cenário', () => {
    expect(layout.docas.filter(d => d.tipo === 'Inbound')).toHaveLength(c.qtdDocasInbound);
    expect(layout.docas.filter(d => d.tipo === 'Outbound')).toHaveLength(c.qtdDocasOutbound);
  });

  it('andares de uma posição compartilham x,y; posições distintas não se sobrepõem', () => {
    const porXY = new Map<string, Set<string>>();
    for (const l of layout.locais) {
      const k = `${l.rect.x},${l.rect.y}`;
      if (!porXY.has(k)) porXY.set(k, new Set());
      porXY.get(k)!.add(`${l.ruaId}/${l.posicao}`);
    }
    for (const chaves of porXY.values()) expect(chaves.size).toBe(1);
    expect(porXY.size).toBe(ruasArmazenagem.reduce((n, r) => n + r.qtdPosicoes, 0));
  });

  it('tudo cabe no armazém', () => {
    for (const r of [...layout.locais.map(l => l.rect), ...layout.docas.map(d => d.rect)]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.largura).toBeLessThanOrEqual(layout.largura);
      expect(r.y + r.altura).toBeLessThanOrEqual(layout.altura);
    }
  });

  it('acesso de cada posição fica no corredor da sua rua, em frente à posição', () => {
    const ruaPorId = new Map(layout.ruas.map(r => [r.ruaId, r]));
    for (const l of layout.locais) {
      expect(l.acesso.y).toBe(ruaPorId.get(l.ruaId)!.corredorY);
      expect(l.acesso.x).toBe(l.rect.x + GEOMETRIA.larguraPosicaoCm / 2);
    }
  });

  it('R01 P01 é a posição mais próxima da expedição (prioridade 1 do RankingRua)', () => {
    const saida = layout.docas.find(d => d.tipo === 'Outbound' && d.numero === 1)!;
    const dist = (l: (typeof layout.locais)[number]) => manhattan(saida.acesso, l.acesso);
    const maisProxima = [...layout.locais].sort((a, b) => dist(a) - dist(b))[0];
    expect([maisProxima.ruaCodigo, maisProxima.posicao]).toEqual(['R01', 1]);
    const r1 = pacote.rankingRuas.find(r => r.prioridade === 1)!;
    expect(layout.ruas.find(r => r.ruaId === r1.ruaId)!.codigo).toBe('R01');
  });
});
