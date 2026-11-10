import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import { construirLayout, manhattan } from './layout';
import type { PacoteCenario } from './model';
import { Malha } from './pathing';

describe.each([['WH-A', whA], ['WH-B', whB]] as const)('malha %s', (_, dados) => {
  const layout = construirLayout(dados as unknown as PacoteCenario);
  const malha = new Malha(layout);
  const porRua = (codigo: string) => layout.locais.filter(l => l.ruaCodigo === codigo);
  const [r1, r2] = [porRua('R01'), porRua('R02')];
  const doca = layout.docas.find(d => d.tipo === 'Outbound')!;

  it('mesma rua: anda só pelo corredor, sem sair dele', () => {
    const a = r1[0], b = r1[r1.length - 1];
    expect(malha.caminho(a.acesso, b.acesso)).toEqual([{ para: b.acesso, ruaId: a.ruaId, libera: false }]);
    expect(malha.distancia(a.acesso, b.acesso)).toBe(Math.abs(a.acesso.x - b.acesso.x));
  });

  it('da doca à rua: desce o corredor principal e entra no corredor da rua (sem liberar nada)', () => {
    const l = r2[3];
    const c = malha.caminho(doca.acesso, l.acesso);
    expect(c.at(-1)).toEqual({ para: l.acesso, ruaId: l.ruaId, libera: false });
    expect(c.slice(0, -1).every(t => t.ruaId === null)).toBe(true);
    expect(malha.distancia(doca.acesso, l.acesso)).toBe(manhattan(doca.acesso, l.acesso));
  });

  it('da rua à doca: primeiro sai do corredor da rua (libera), depois segue pelo principal', () => {
    const l = r2[3];
    const c = malha.caminho(l.acesso, doca.acesso);
    expect(c[0]).toEqual({ para: malha.juncao(l.acesso), ruaId: l.ruaId, libera: true });
    expect(c.slice(1).every(t => t.ruaId === null && !t.libera)).toBe(true);
    expect(malha.distancia(l.acesso, doca.acesso)).toBe(manhattan(doca.acesso, l.acesso));
  });

  it('entre ruas diferentes: sai, atravessa pelo principal, entra', () => {
    const a = r1[2], b = r2[5];
    const c = malha.caminho(a.acesso, b.acesso);
    expect(c.map(t => [t.ruaId, t.libera])).toEqual([[a.ruaId, true], [null, false], [b.ruaId, false]]);
    expect(malha.distancia(a.acesso, b.acesso)).toBe(manhattan(a.acesso, malha.juncao(a.acesso))
      + manhattan(malha.juncao(a.acesso), malha.juncao(b.acesso)) + manhattan(malha.juncao(b.acesso), b.acesso));
  });

  it('distância é simétrica e nula de um ponto para ele mesmo', () => {
    const a = r1[1], b = r2[4];
    expect(malha.distancia(a.acesso, b.acesso)).toBe(malha.distancia(b.acesso, a.acesso));
    expect(malha.distancia(a.acesso, a.acesso)).toBe(0);
    expect(malha.caminho(doca.acesso, doca.acesso)).toEqual([]);
  });

  it('ponto fora da malha é erro (não vira distância inventada)', () => {
    expect(() => malha.ruaDe({ x: layout.corredorPrincipalX + 5, y: 1 })).toThrow(/fora da malha/);
  });
});
