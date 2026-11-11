import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import whB from '../data/cenarios/WH-B-MEGA.json';
import type { PacoteCenario } from '../sim/model';
import { Simulacao } from '../sim/simulation';
import { resumirCenario } from './fonteCenarios';
import { FonteEmbutida } from './fonteEmbutida';

const pacoteA = whA as unknown as PacoteCenario;
const pacoteB = whB as unknown as PacoteCenario;

describe('resumirCenario', () => {
  it('procedência: só o cenário do corporativo leva o selo', () => {
    expect(resumirCenario(pacoteA, 'embutido')).not.toHaveProperty('procedencia');
    const importado = structuredClone(pacoteA);
    importado.cenario.procedencia = 'Corporativo';
    expect(resumirCenario(importado, 'rede').procedencia).toBe('Corporativo');
  });

  it('WH-A: números do cartão vêm do pacote', () => {
    const r = resumirCenario(pacoteA, 'embutido');
    expect(r).toMatchObject({
      codigo: 'WH-A-PEQUENO', nome: 'WH-A Pequeno', dificuldade: 'Facil', origem: 'embutido',
      ordensTotal: 60, locais: 48, ruas: 4, empilhadeiras: 3, docasEntrada: 2, docasSaida: 2,
      inicioTurnoSeg: 28800, fimTurnoSeg: 64800,
    });
    expect(r.ordensEntrada + r.ordensSaida).toBe(r.ordensTotal);
    expect(r.ordensEntrada).toBe(pacoteA.ordens.filter(o => o.tipo === 'Inbound').length);
  });

  it('WH-B: 12 ruas × 30 posições × 4 andares', () => {
    const r = resumirCenario(pacoteB, 'rede');
    expect(r).toMatchObject({ ordensTotal: 400, locais: 1440, ruas: 12, empilhadeiras: 8, docasEntrada: 4, docasSaida: 4, origem: 'rede' });
  });

  it('locais e docas batem com o layout da simulação (e com o que o cenário declara)', () => {
    for (const p of [pacoteA, pacoteB]) {
      const r = resumirCenario(p, 'embutido');
      const s = new Simulacao(p, 'AbcProximidade').snapshot();
      expect(r.locais).toBe(s.locais.size);
      expect(r.docasEntrada).toBe(s.docas.filter(d => d.tipo === 'Inbound').length);
      expect(r.docasSaida).toBe(s.docas.filter(d => d.tipo === 'Outbound').length);
      expect(r.docasEntrada).toBe(p.cenario.qtdDocasInbound);
      expect(r.docasSaida).toBe(p.cenario.qtdDocasOutbound);
    }
  });
});

describe('FonteEmbutida', () => {
  it('lista os dois cenários do repositório, com origem "embutido"', async () => {
    const lista = await new FonteEmbutida().listar();
    expect(lista.map(c => c.codigo)).toEqual(['WH-A-PEQUENO', 'WH-B-MEGA']);
    expect(lista.every(c => c.origem === 'embutido')).toBe(true);
  });

  it('carrega o pacote e reaproveita o mesmo objeto nas chamadas seguintes', async () => {
    const fonte = new FonteEmbutida();
    const a = await fonte.carregar('WH-A-PEQUENO');
    expect(a.origem).toBe('embutido');
    expect(a.pacote.cenario.codigo).toBe('WH-A-PEQUENO');
    expect((await fonte.carregar('WH-A-PEQUENO')).pacote).toBe(a.pacote);
  });

  it('código desconhecido rejeita com mensagem legível', async () => {
    await expect(new FonteEmbutida().carregar('NAO-EXISTE')).rejects.toThrow('Cenário desconhecido: NAO-EXISTE');
  });
});
