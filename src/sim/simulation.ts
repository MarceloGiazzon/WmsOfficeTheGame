// Estado da simulação. Puro e determinístico: sem DOM, sem relógio de parede, sem Math.random.
// Avança em passos de 1 segundo simulado (tick). O render lê `snapshot()` e nunca altera o estado.
//
// F1: relógio do turno, liberação das ordens no horário, equipamentos parados nas docas, política atual.
// F2 acrescenta tarefas (putaway/picking), deslocamento pelos corredores, conflitos, SLA e métricas.

import { construirLayout, type Layout, type Ponto } from './layout';
import type { Ordem, PacoteCenario, Politica, SituacaoLocal } from './model';

export type EstadoEquipamento = 'Ocioso';

export interface Equipamento {
  id: string;
  nome: string;
  posicao: Ponto;
  estado: EstadoEquipamento;
}

export interface EstadoLocal {
  situacao: SituacaoLocal;
  produtoId: string | null;
  /** Quantas vezes um equipamento acessou a posição (heatmap). */
  acessos: number;
}

export interface Evento {
  seg: number;
  texto: string;
}

/**
 * Visão SOMENTE LEITURA do estado atual (não é cópia: os tipos readonly impedem o render de alterar).
 * Vale até o próximo tick — quem precisar guardar valores entre frames copia o que usar.
 */
export interface Snapshot {
  readonly cenarioCodigo: string;
  readonly relogioSeg: number;
  readonly inicioTurnoSeg: number;
  readonly fimTurnoSeg: number;
  readonly terminado: boolean;
  readonly politica: Politica;
  readonly layout: Readonly<Layout>;
  readonly locais: ReadonlyMap<string, Readonly<EstadoLocal>>;
  readonly equipamentos: readonly Readonly<Equipamento>[];
  readonly ordensLiberadas: number;
  readonly ordensTotal: number;
  readonly ocupacaoCentesimos: number;
  /** Mais recentes primeiro. */
  readonly eventos: readonly Readonly<Evento>[];
}

const MAX_EVENTOS = 200;

export class Simulacao {
  readonly pacote: PacoteCenario;
  readonly layout: Layout;
  private relogioSeg: number;
  private politica: Politica;
  private readonly locais = new Map<string, EstadoLocal>();
  private readonly equipamentos: Equipamento[];
  private readonly ordens: Ordem[];
  private proximaOrdem = 0;
  private eventos: Evento[] = [];

  constructor(pacote: PacoteCenario, politica: Politica) {
    this.pacote = pacote;
    this.politica = politica;
    this.layout = construirLayout(pacote);
    this.relogioSeg = pacote.cenario.inicioTurnoSeg;
    const situacaoInicial = new Map(pacote.locais.map(l => [l.id, l.situacao]));
    for (const l of this.layout.locais) {
      this.locais.set(l.localId, { situacao: situacaoInicial.get(l.localId) ?? 'Disponivel', produtoId: null, acessos: 0 });
    }
    this.ordens = [...pacote.ordens].sort((a, b) => a.liberacaoSeg - b.liberacaoSeg || a.numero.localeCompare(b.numero));
    this.equipamentos = this.posicionarEquipamentos();
    this.registrar(`Turno iniciado — cenário ${pacote.cenario.codigo}, política ${politica}.`);
  }

  get terminado(): boolean {
    return this.relogioSeg >= this.pacote.cenario.fimTurnoSeg;
  }

  /** Avança 1 segundo simulado. Não faz nada depois do fim do turno. */
  tick(): void {
    if (this.terminado) return;
    this.relogioSeg += 1;
    while (this.proximaOrdem < this.ordens.length && this.ordens[this.proximaOrdem].liberacaoSeg <= this.relogioSeg) {
      const o = this.ordens[this.proximaOrdem++];
      this.registrar(`Ordem ${o.numero} liberada (${o.tipo === 'Inbound' ? 'entrada' : 'saída'}, ` +
        `${o.quantidadePaletes} palete(s), SLA ${Math.round(o.slaSeg / 60)} min).`);
    }
    if (this.terminado) this.registrar('Fim do turno.');
  }

  setPolitica(p: Politica): void {
    if (p === this.politica) return;
    this.politica = p;
    this.registrar(`Política alterada para ${p} (vale para as próximas alocações).`);
  }

  snapshot(): Snapshot {
    let ocupados = 0;
    for (const l of this.locais.values()) if (l.situacao === 'Ocupado') ocupados++;
    return {
      cenarioCodigo: this.pacote.cenario.codigo,
      relogioSeg: this.relogioSeg,
      inicioTurnoSeg: this.pacote.cenario.inicioTurnoSeg,
      fimTurnoSeg: this.pacote.cenario.fimTurnoSeg,
      terminado: this.terminado,
      politica: this.politica,
      layout: this.layout,
      locais: this.locais,
      equipamentos: this.equipamentos,
      ordensLiberadas: this.proximaOrdem,
      ordensTotal: this.ordens.length,
      ocupacaoCentesimos: this.locais.size === 0 ? 0 : Math.round((ocupados * 10_000) / this.locais.size),
      eventos: this.eventos,
    };
  }

  private posicionarEquipamentos(): Equipamento[] {
    // Começam no corredor principal, distribuídos em frente às docas.
    const docas = this.layout.docas;
    const n = this.pacote.cenario.qtdEquipamentos;
    return Array.from({ length: n }, (_, i) => {
      const d = docas.length ? docas[i % docas.length] : null;
      return {
        id: `EQ-${String(i + 1).padStart(2, '0')}`,
        nome: `Empilhadeira ${String(i + 1).padStart(2, '0')}`,
        posicao: d ? { ...d.acesso } : { x: this.layout.corredorPrincipalX, y: 0 },
        estado: 'Ocioso' as const,
      };
    });
  }

  private registrar(texto: string): void {
    this.eventos = [{ seg: this.relogioSeg, texto }, ...this.eventos].slice(0, MAX_EVENTOS);
  }
}

export function formatarHora(seg: number): string {
  const h = String(Math.floor(seg / 3600) % 24).padStart(2, '0');
  const m = String(Math.floor((seg % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(seg % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
