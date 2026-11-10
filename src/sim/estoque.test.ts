import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import { calcularCurvaAbc, gerarEstoqueInicial, OCUPACAO_INICIAL_CENTESIMOS } from './estoque';
import { construirLayout } from './layout';
import type { PacoteCenario } from './model';

const cenarios = { 'WH-A': whA, 'WH-B': whB } as unknown as Record<string, PacoteCenario>;

describe.each(Object.entries(cenarios))('curva ABC e estoque inicial %s', (_, pacote) => {
  const curva = calcularCurvaAbc(pacote);
  const livres = construirLayout(pacote).locais.map(l => l.localId);

  it('peso = paletes de saída por produto; ordem decrescente', () => {
    const saidas = pacote.ordens.filter(o => o.tipo === 'Outbound');
    for (const [id, peso] of curva.peso) {
      expect(peso).toBe(saidas.filter(o => o.produtoId === id).reduce((n, o) => n + o.quantidadePaletes, 0));
    }
    const pesos = curva.ordem.map(id => curva.peso.get(id)!);
    expect(pesos).toEqual([...pesos].sort((a, b) => b - a));
  });

  it('classes A, B e C cobrem 80% / 15% / 5% do giro (o produto que cruza o limite fica na classe de cima)', () => {
    const total = pesoTotal();
    const ate = (c: string) => curva.ordem.filter(id => curva.classe.get(id) === c).reduce((n, id) => n + curva.peso.get(id)!, 0);
    expect(ate('A') / total).toBeGreaterThanOrEqual(0.8);
    expect((ate('A') + ate('B')) / total).toBeGreaterThanOrEqual(0.95);
    expect(curva.classe.get(curva.ordem[0])).toBe('A');
    function pesoTotal() { return curva.ordem.reduce((n, id) => n + curva.peso.get(id)!, 0); }
  });

  it('ocupa ~60% dos locais livres, sem repetir local', () => {
    const e = gerarEstoqueInicial(pacote, livres, curva);
    expect(e.length).toBe(Math.round((livres.length * OCUPACAO_INICIAL_CENTESIMOS) / 10_000));
    expect(new Set(e.map(p => p.localId)).size).toBe(e.length);
    expect(e.every(p => livres.includes(p.localId))).toBe(true);
  });

  it('é determinístico e só usa produtos com giro de saída', () => {
    const a = gerarEstoqueInicial(pacote, livres, curva);
    expect(gerarEstoqueInicial(pacote, livres, curva)).toEqual(a);
    expect(a.every(p => curva.peso.has(p.produtoId))).toBe(true);
  });

  it('paletes entram antes do turno (FIFO tem o que ordenar) e o estoque segue o peso', () => {
    const e = gerarEstoqueInicial(pacote, livres, curva);
    expect(e.every(p => p.entradaSeg < pacote.cenario.inicioTurnoSeg)).toBe(true);
    const maior = curva.ordem[0], menor = curva.ordem[curva.ordem.length - 1];
    const n = (id: string) => e.filter(p => p.produtoId === id).length;
    expect(n(maior)).toBeGreaterThan(n(menor));
  });

  it('sem locais livres ou sem giro, não há estoque', () => {
    expect(gerarEstoqueInicial(pacote, [], curva)).toEqual([]);
    expect(gerarEstoqueInicial({ ...pacote, ordens: [] }, livres, calcularCurvaAbc({ ...pacote, ordens: [] }))).toEqual([]);
  });
});
