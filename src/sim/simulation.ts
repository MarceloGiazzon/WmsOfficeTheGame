// Estado e motor da simulação. Puro e determinístico: sem DOM, sem relógio de parede, sem Math.random.
// Avança em passos de 1 segundo simulado (tick). O render lê `snapshot()` e nunca altera o estado.
//
// Fluxo de uma ordem:
//   Inbound : liberada → fila de doca de entrada → descarga (tempoDescargaSeg) → 1 tarefa de putaway por palete
//             (a política escolhe o local no momento do despacho) → concluída quando o último palete é guardado.
//   Outbound: liberada → espera estoque do produto + doca de saída livre → reserva os paletes mais antigos (FIFO)
//             → 1 tarefa de picking por palete → concluída quando o último chega na doca.
//   Cross-docking (política CrossDocking): um palete descarregado que ainda espera putaway pode ser desviado para uma
//             saída pendente do mesmo produto — vai da doca de entrada direto para a de saída, sem passar pelo estoque.
// Despacho: tarefas por prazo (liberação + SLA, o mais urgente primeiro); cada uma vai para a empilhadeira ociosa
// mais próxima do ponto de partida. Cada corredor de rua admite uma empilhadeira por vez (conflito = espera + evento).
// Um tick por fase: a empilhadeira que termina uma operação só se mexe no tick seguinte.

import { construirLayout, type Layout, type LayoutDoca, type Ponto } from './layout';
import { calcularCurvaAbc, gerarEstoqueInicial, OCUPACAO_INICIAL_CENTESIMOS, type CurvaAbc } from './estoque';
import type { EstadoLocal, Metricas, Ordem, PacoteCenario, Politica } from './model';
import { Malha, type Trecho } from './pathing';
import { escolherDestino, escolherOrigens, type ContextoPolitica } from './politicas';
import { calcularScore, type ResultadoScore } from './score';
import { calcularDistanciaTeorica } from './teorica';

export type { EstadoLocal } from './model';

/** Tempos de operação (s). Não vêm do cenário: são constantes do motor, iguais para todas as políticas. */
export const TEMPO_DOCA_SEG = 10;           // pegar/largar palete na doca
export const TEMPO_LOCAL_BASE_SEG = 15;     // guardar/retirar no andar 1
export const TEMPO_POR_ANDAR_SEG = 5;       // a mais por andar acima do primeiro
/** CrossDocking: quanto um palete descarregado espera, no máximo, por uma saída do mesmo produto antes de ir para o estoque. */
export const ESPERA_CROSSDOCK_SEG = 600;

export type EstadoEquipamento = 'Ocioso' | 'Deslocando' | 'Operando' | 'Aguardando';

export interface Equipamento {
  id: string;
  nome: string;
  posicao: Ponto;
  estado: EstadoEquipamento;
  /** Produto do palete que a empilhadeira carrega, ou null. */
  carga: string | null;
  /** Rua em cujo corredor a empilhadeira está (ou espera para entrar), ou null. */
  ruaId: string | null;
}

export interface EstadoDoca {
  localId: string;
  tipo: 'Inbound' | 'Outbound';
  numero: number;
  ocupada: boolean;
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
  readonly docas: readonly Readonly<EstadoDoca>[];
  readonly ordensLiberadas: number;
  readonly ordensConcluidas: number;
  readonly ordensTotal: number;
  readonly tarefasPendentes: number;
  readonly ocupacaoCentesimos: number;
  /** Métricas até agora (as do score oficial). Atrasadas = concluídas fora do prazo + abertas já vencidas. */
  readonly metricas: Readonly<Metricas>;
  /** Score com as métricas de agora. Vale como oficial quando `terminado`. */
  readonly score: ResultadoScore;
  /** Mais recentes primeiro. */
  readonly eventos: readonly Readonly<Evento>[];
}

const MAX_EVENTOS = 200;

type Passo =
  | { t: 'mover'; trecho: Trecho }
  | { t: 'operar'; seg: number; aoFim: () => void };

interface EquipamentoInterno extends Equipamento {
  passos: Passo[];
  /** Ticks que faltam na operação em curso (0 = ainda não começou o passo atual). */
  restanteSeg: number;
  trava: string | null;
}

interface OrdemEstado {
  ordem: Ordem;
  prazoSeg: number;
  /** Paletes que ainda não terminaram o trajeto (guardados / entregues na doca). */
  restantes: number;
  concluidaSeg: number | null;
}

type Tarefa = { seq: number; criadaSeg: number } & (
  | { tipo: 'Putaway'; ordem: OrdemEstado; doca: LayoutDoca }
  | { tipo: 'Picking'; ordem: OrdemEstado; origemId: string; doca: LayoutDoca }
  /** Doca de entrada → doca de saída. `ordem` é a entrada (de onde o palete vem), `saida` a ordem que o recebe. */
  | { tipo: 'CrossDock'; ordem: OrdemEstado; saida: OrdemEstado; doca: LayoutDoca; docaSaida: LayoutDoca });

/** Prazo que ordena o despacho: o da ordem a que a tarefa serve (no cross-docking, o mais apertado das duas). */
const prazoDaTarefa = (t: Tarefa): number => (t.tipo === 'CrossDock' ? Math.min(t.ordem.prazoSeg, t.saida.prazoSeg) : t.ordem.prazoSeg);

interface DocaInterna {
  doca: LayoutDoca;
  ocupadaPor: OrdemEstado | null;
  /** Só doca de entrada: ticks que faltam para terminar a descarga. */
  restanteSeg: number;
}

export class Simulacao {
  readonly pacote: PacoteCenario;
  readonly layout: Layout;
  readonly curva: CurvaAbc;
  readonly distanciaTeoricaCm: number;

  private readonly malha: Malha;
  private relogioSeg: number;
  private politica: Politica;
  private readonly locais = new Map<string, EstadoLocal>();
  private readonly localLayout = new Map<string, Layout['locais'][number]>();
  private readonly ctxPolitica: ContextoPolitica;
  private readonly equipamentos: EquipamentoInterno[];
  private readonly ordens: OrdemEstado[];
  private proximaOrdem = 0;
  private eventos: Evento[] = [];

  private readonly docasEntrada: DocaInterna[];
  private readonly docasSaida: DocaInterna[];
  private readonly filaEntrada: OrdemEstado[] = [];
  private readonly pendentesSaida: OrdemEstado[] = [];
  private tarefas: Tarefa[] = [];
  private tarefasDesordenadas = false;
  private seqTarefa = 0;

  private readonly travas = new Map<string, string>();
  private readonly filasTrava = new Map<string, string[]>();
  private readonly estoqueLivre = new Map<string, number>(); // paletes disponíveis para NOVAS ordens de saída
  private locaisDisponiveis = 0;

  private estoqueInicial = 0;
  private paletesGuardados = 0;
  private paletesRetirados = 0;
  private paletesCruzados = 0;
  private distanciaRealCm = 0;
  private eventosConflito = 0;
  private ordensConcluidas = 0;
  private atrasadasConcluidas = 0;
  private readonly abertas = new Set<OrdemEstado>();

  constructor(pacote: PacoteCenario, politica: Politica) {
    this.pacote = pacote;
    this.politica = politica;
    this.layout = construirLayout(pacote);
    this.malha = new Malha(this.layout);
    this.curva = calcularCurvaAbc(pacote);
    this.relogioSeg = pacote.cenario.inicioTurnoSeg;

    const situacaoInicial = new Map(pacote.locais.map(l => [l.id, l.situacao]));
    for (const l of this.layout.locais) {
      this.localLayout.set(l.localId, l);
      this.locais.set(l.localId, {
        situacao: situacaoInicial.get(l.localId) ?? 'Disponivel', produtoId: null, entradaSeg: 0,
        reservadoSaida: false, acessos: 0,
      });
    }
    this.ctxPolitica = this.montarContextoPolitica();
    this.distanciaTeoricaCm = calcularDistanciaTeorica(pacote, this.layout, this.malha, this.curva);

    const livres = this.layout.locais.filter(l => this.locais.get(l.localId)!.situacao === 'Disponivel').map(l => l.localId);
    const estoque = gerarEstoqueInicial(pacote, livres, this.curva);
    for (const p of estoque) {
      Object.assign(this.locais.get(p.localId)!, { situacao: 'Ocupado', produtoId: p.produtoId, entradaSeg: p.entradaSeg });
      this.estoqueLivre.set(p.produtoId, (this.estoqueLivre.get(p.produtoId) ?? 0) + 1);
    }
    this.locaisDisponiveis = livres.length - estoque.length;
    this.estoqueInicial = estoque.length;

    this.ordens = [...pacote.ordens]
      .sort((a, b) => a.liberacaoSeg - b.liberacaoSeg || a.numero.localeCompare(b.numero))
      .map(o => ({ ordem: o, prazoSeg: o.liberacaoSeg + o.slaSeg, restantes: o.quantidadePaletes, concluidaSeg: null }));
    const docaInterna = (tipo: 'Inbound' | 'Outbound') =>
      this.layout.docas.filter(d => d.tipo === tipo).map(doca => ({ doca, ocupadaPor: null, restanteSeg: 0 }));
    this.docasEntrada = docaInterna('Inbound');
    this.docasSaida = docaInterna('Outbound');
    this.equipamentos = this.posicionarEquipamentos();

    this.registrar(`Turno iniciado — cenário ${pacote.cenario.codigo}, política ${politica}.`);
    this.registrar(`Estoque inicial: ${estoque.length} paletes em ${livres.length} locais ` +
      `(${(OCUPACAO_INICIAL_CENTESIMOS / 100).toFixed(0)}% de ocupação, pesos da curva ABC).`);
  }

  get terminado(): boolean {
    return this.relogioSeg >= this.pacote.cenario.fimTurnoSeg;
  }

  /** Avança 1 segundo simulado. Não faz nada depois do fim do turno. */
  tick(): void {
    if (this.terminado) return;
    this.relogioSeg += 1;
    this.liberarOrdens();
    this.avancarDocasEntrada();
    this.iniciarSaidas();
    this.despachar();
    for (const e of this.equipamentos) this.avancarEquipamento(e);
    if (this.terminado) this.encerrarTurno();
  }

  setPolitica(p: Politica): void {
    if (p === this.politica) return;
    this.politica = p;
    this.registrar(`Política alterada para ${p} (vale para as próximas alocações).`);
  }

  /** Métricas de agora, no formato do score. */
  metricas(): Metricas {
    let atrasadas = this.atrasadasConcluidas;
    for (const o of this.abertas) if (this.relogioSeg > o.prazoSeg) atrasadas++;
    return {
      distanciaRealCm: this.distanciaRealCm,
      distanciaTeoricaCm: this.distanciaTeoricaCm,
      ordensTotal: this.ordens.length,
      ordensAtrasadas: atrasadas,
      eventosConflito: this.eventosConflito,
      ocupacaoFinalCentesimos: this.ocupacaoCentesimos(),
    };
  }

  /** Contadores para auditar a conservação de paletes: ocupados = inicial + guardados − retirados, sempre. */
  auditoria(): { estoqueInicial: number; paletesGuardados: number; paletesRetirados: number; paletesCruzados: number } {
    return {
      estoqueInicial: this.estoqueInicial, paletesGuardados: this.paletesGuardados,
      paletesRetirados: this.paletesRetirados, paletesCruzados: this.paletesCruzados,
    };
  }

  snapshot(): Snapshot {
    const metricas = this.metricas();
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
      docas: [...this.docasEntrada, ...this.docasSaida].map(d => ({
        localId: d.doca.localId, tipo: d.doca.tipo, numero: d.doca.numero, ocupada: d.ocupadaPor !== null,
      })),
      ordensLiberadas: this.proximaOrdem,
      ordensConcluidas: this.ordensConcluidas,
      ordensTotal: this.ordens.length,
      tarefasPendentes: this.tarefas.length,
      ocupacaoCentesimos: metricas.ocupacaoFinalCentesimos,
      metricas,
      score: calcularScore(metricas),
      eventos: this.eventos,
    };
  }

  // ---------------------------------------------------------------- ordens e docas

  private liberarOrdens(): void {
    while (this.proximaOrdem < this.ordens.length && this.ordens[this.proximaOrdem].ordem.liberacaoSeg <= this.relogioSeg) {
      const o = this.ordens[this.proximaOrdem++];
      this.abertas.add(o);
      const { ordem } = o;
      this.registrar(`Ordem ${ordem.numero} liberada (${ordem.tipo === 'Inbound' ? 'entrada' : 'saída'}, ` +
        `${ordem.quantidadePaletes} palete(s), SLA ${Math.round(ordem.slaSeg / 60)} min).`);
      (ordem.tipo === 'Inbound' ? this.filaEntrada : this.pendentesSaida).push(o);
    }
  }

  private avancarDocasEntrada(): void {
    for (const d of this.docasEntrada) {
      if (d.ocupadaPor && --d.restanteSeg <= 0) {
        const o = d.ocupadaPor;
        d.ocupadaPor = null;
        for (let i = 0; i < o.ordem.quantidadePaletes; i++) this.criarTarefa({ tipo: 'Putaway', ordem: o, doca: d.doca });
        this.registrar(`Ordem ${o.ordem.numero} descarregada na doca IN ${d.doca.numero}: ` +
          `${o.ordem.quantidadePaletes} palete(s) para guardar.`);
      }
      if (!d.ocupadaPor && this.filaEntrada.length > 0) {
        d.ocupadaPor = this.filaEntrada.shift()!;
        d.restanteSeg = this.pacote.cenario.tempoDescargaSeg;
      }
    }
  }

  /**
   * Saída: a primeira ordem da fila (por liberação) cujo estoque já existe ocupa a doca livre.
   * Com a política CrossDocking, os paletes do produto que acabaram de ser descarregados e ainda esperam putaway
   * contam como estoque: vão direto para a doca de saída e o resto vem do armazém (FIFO).
   */
  private iniciarSaidas(): void {
    if (this.pendentesSaida.length === 0) return;
    for (const d of this.docasSaida) {
      if (d.ocupadaPor) continue;
      const cruzaveis = this.paletesCruzaveis();
      const i = this.pendentesSaida.findIndex(o => {
        const { produtoId, quantidadePaletes: qtd } = o.ordem;
        return (this.estoqueLivre.get(produtoId) ?? 0) + Math.min(cruzaveis.get(produtoId) ?? 0, qtd) >= qtd;
      });
      if (i < 0) return;
      const [o] = this.pendentesSaida.splice(i, 1);
      d.ocupadaPor = o;
      const { produtoId, quantidadePaletes: qtd } = o.ordem;
      const cruzar = Math.min(cruzaveis.get(produtoId) ?? 0, qtd);
      if (cruzar > 0) this.desviarParaSaida(o, d.doca, cruzar);
      const origens = escolherOrigens(this.ctxPolitica, produtoId, qtd - cruzar);
      for (const origemId of origens) {
        this.locais.get(origemId)!.reservadoSaida = true;
        this.criarTarefa({ tipo: 'Picking', ordem: o, origemId, doca: d.doca });
      }
      this.estoqueLivre.set(produtoId, this.estoqueLivre.get(produtoId)! - origens.length);
      this.registrar(`Ordem ${o.ordem.numero}: ${origens.length} palete(s) separados para a doca OUT ${d.doca.numero}` +
        (cruzar > 0 ? ` e ${cruzar} direto da entrada (cross-docking).` : '.'));
    }
  }

  /** Paletes descarregados por produto que ainda esperam putaway (só na política CrossDocking). */
  private paletesCruzaveis(): Map<string, number> {
    const porProduto = new Map<string, number>();
    if (this.politica !== 'CrossDocking') return porProduto;
    for (const t of this.tarefas) {
      if (t.tipo === 'Putaway') porProduto.set(t.ordem.ordem.produtoId, (porProduto.get(t.ordem.ordem.produtoId) ?? 0) + 1);
    }
    return porProduto;
  }

  /**
   * CrossDocking: paletes do produto que o despacho segura na doca de entrada em vez de guardar, por produto —
   * tantos quantos as saídas pendentes (ainda sem doca) do produto pedem. Cada palete espera no máximo
   * ESPERA_CROSSDOCK_SEG; depois disso vai para o estoque como qualquer outro.
   */
  private retencaoCrossDock(): Map<string, number> {
    const porProduto = new Map<string, number>();
    if (this.politica !== 'CrossDocking') return porProduto;
    for (const o of this.pendentesSaida) {
      porProduto.set(o.ordem.produtoId, (porProduto.get(o.ordem.produtoId) ?? 0) + o.ordem.quantidadePaletes);
    }
    return porProduto;
  }

  /** Troca `qtd` tarefas de putaway do produto da ordem de saída por transferências doca → doca. */
  private desviarParaSaida(saida: OrdemEstado, docaSaida: LayoutDoca, qtd: number): void {
    let restante = qtd;
    this.tarefas = this.tarefas.map(t => {
      if (restante === 0 || t.tipo !== 'Putaway' || t.ordem.ordem.produtoId !== saida.ordem.produtoId) return t;
      restante--;
      return { tipo: 'CrossDock', seq: t.seq, criadaSeg: t.criadaSeg, ordem: t.ordem, saida, doca: t.doca, docaSaida };
    });
    this.tarefasDesordenadas = true;
  }

  private concluirOrdem(o: OrdemEstado): void {
    o.concluidaSeg = this.relogioSeg;
    this.abertas.delete(o);
    this.ordensConcluidas++;
    const atrasada = this.relogioSeg > o.prazoSeg;
    if (atrasada) this.atrasadasConcluidas++;
    if (o.ordem.tipo === 'Outbound') {
      const d = this.docasSaida.find(x => x.ocupadaPor === o);
      if (d) d.ocupadaPor = null;
    }
    this.registrar(`Ordem ${o.ordem.numero} concluída${atrasada ? ` com ${Math.ceil((this.relogioSeg - o.prazoSeg) / 60)} min de atraso` : ' no prazo'}.`);
  }

  // ---------------------------------------------------------------- tarefas e despacho

  private criarTarefa(t: DistributiveOmit<Tarefa, 'seq' | 'criadaSeg'>): void {
    this.tarefas.push({ ...t, seq: this.seqTarefa++, criadaSeg: this.relogioSeg } as Tarefa);
    this.tarefasDesordenadas = true;
  }

  private despachar(): void {
    if (this.tarefas.length === 0) return;
    let ociosos = this.equipamentos.filter(e => e.passos.length === 0);
    if (ociosos.length === 0) return;
    if (this.tarefasDesordenadas) {
      this.tarefas.sort((a, b) => prazoDaTarefa(a) - prazoDaTarefa(b) || a.seq - b.seq);
      this.tarefasDesordenadas = false;
    }
    const retencao = this.retencaoCrossDock();
    const restantes: Tarefa[] = [];
    for (const t of this.tarefas) {
      if (ociosos.length === 0) { restantes.push(t); continue; }
      let destinoId: string | null = null;
      if (t.tipo === 'Putaway') {
        const produtoId = t.ordem.ordem.produtoId;
        if ((retencao.get(produtoId) ?? 0) > 0 && this.relogioSeg - t.criadaSeg < ESPERA_CROSSDOCK_SEG) {
          retencao.set(produtoId, retencao.get(produtoId)! - 1); // espera uma doca de saída para ir direto
          restantes.push(t);
          continue;
        }
        destinoId = this.locaisDisponiveis > 0
          ? escolherDestino(this.politica, this.ctxPolitica, t.ordem.ordem.produtoId, t.ordem.ordem.id) : null;
        if (destinoId === null) { restantes.push(t); continue; } // sem local livre: espera uma saída liberar
      }
      const partida = t.tipo === 'Picking' ? this.localLayout.get(t.origemId)!.acesso : t.doca.acesso;
      let melhor = ociosos[0];
      let melhorDist = this.malha.distancia(melhor.posicao, partida);
      for (const e of ociosos.slice(1)) {
        const d = this.malha.distancia(e.posicao, partida);
        if (d < melhorDist) { melhor = e; melhorDist = d; }
      }
      ociosos = ociosos.filter(e => e !== melhor);
      if (t.tipo === 'Putaway') this.atribuirPutaway(melhor, t, destinoId!);
      else if (t.tipo === 'Picking') this.atribuirPicking(melhor, t);
      else this.atribuirCrossDock(melhor, t);
    }
    this.tarefas = restantes;
  }

  private tempoLocal(localId: string): number {
    return TEMPO_LOCAL_BASE_SEG + TEMPO_POR_ANDAR_SEG * (this.localLayout.get(localId)!.andar - 1);
  }

  private mover(a: Ponto, b: Ponto): Passo[] {
    return this.malha.caminho(a, b).map(trecho => ({ t: 'mover' as const, trecho }));
  }

  private atribuirPutaway(e: EquipamentoInterno, t: Extract<Tarefa, { tipo: 'Putaway' }>, destinoId: string): void {
    const destino = this.localLayout.get(destinoId)!;
    const estado = this.locais.get(destinoId)!;
    const produtoId = t.ordem.ordem.produtoId;
    // O produto já fica marcado na reserva: a política Consolidacao conta os paletes a caminho.
    Object.assign(estado, { situacao: 'Reservado', produtoId });
    this.locaisDisponiveis--;
    e.passos = [
      ...this.mover(e.posicao, t.doca.acesso),
      { t: 'operar', seg: TEMPO_DOCA_SEG, aoFim: () => { e.carga = produtoId; } },
      ...this.mover(t.doca.acesso, destino.acesso),
      { t: 'operar', seg: this.tempoLocal(destinoId), aoFim: () => {
        e.carga = null;
        Object.assign(estado, { situacao: 'Ocupado', produtoId, entradaSeg: this.relogioSeg });
        estado.acessos++;
        this.paletesGuardados++;
        this.estoqueLivre.set(produtoId, (this.estoqueLivre.get(produtoId) ?? 0) + 1);
        this.terminarPalete(t.ordem);
      } },
      ...this.mover(destino.acesso, this.malha.juncao(destino.acesso)),
    ];
    e.estado = 'Deslocando';
  }

  private atribuirPicking(e: EquipamentoInterno, t: Extract<Tarefa, { tipo: 'Picking' }>): void {
    const origem = this.localLayout.get(t.origemId)!;
    const estado = this.locais.get(t.origemId)!;
    const produtoId = t.ordem.ordem.produtoId;
    e.passos = [
      ...this.mover(e.posicao, origem.acesso),
      { t: 'operar', seg: this.tempoLocal(t.origemId), aoFim: () => {
        e.carga = produtoId;
        Object.assign(estado, { situacao: 'Disponivel', produtoId: null, reservadoSaida: false });
        estado.acessos++;
        this.paletesRetirados++;
        this.locaisDisponiveis++;
      } },
      ...this.mover(origem.acesso, t.doca.acesso),
      { t: 'operar', seg: TEMPO_DOCA_SEG, aoFim: () => {
        e.carga = null;
        this.terminarPalete(t.ordem);
      } },
    ];
    e.estado = 'Deslocando';
  }

  private atribuirCrossDock(e: EquipamentoInterno, t: Extract<Tarefa, { tipo: 'CrossDock' }>): void {
    const produtoId = t.ordem.ordem.produtoId;
    e.passos = [
      ...this.mover(e.posicao, t.doca.acesso),
      { t: 'operar', seg: TEMPO_DOCA_SEG, aoFim: () => { e.carga = produtoId; } },
      ...this.mover(t.doca.acesso, t.docaSaida.acesso),
      { t: 'operar', seg: TEMPO_DOCA_SEG, aoFim: () => {
        e.carga = null;
        this.paletesCruzados++;
        this.terminarPalete(t.ordem);
        this.terminarPalete(t.saida);
      } },
    ];
    e.estado = 'Deslocando';
  }

  private terminarPalete(o: OrdemEstado): void {
    if (--o.restantes === 0) this.concluirOrdem(o);
  }

  // ---------------------------------------------------------------- equipamentos

  private avancarEquipamento(e: EquipamentoInterno): void {
    let orcamento = this.pacote.cenario.velocidadeEquipamentoCmS; // cm que cabem neste tick
    for (;;) {
      const passo = e.passos[0];
      if (!passo) { e.estado = 'Ocioso'; return; }

      if (passo.t === 'operar') {
        e.estado = 'Operando';
        if (e.restanteSeg === 0) e.restanteSeg = passo.seg;
        if (--e.restanteSeg === 0) {
          e.passos.shift();
          passo.aoFim();
          if (e.passos.length === 0) e.estado = 'Ocioso';
        }
        return;
      }

      const { para, ruaId, libera } = passo.trecho;
      if (ruaId !== null && e.trava !== ruaId) {
        if (!this.tentarTrava(e, ruaId)) { e.estado = 'Aguardando'; e.ruaId = ruaId; return; }
        e.trava = ruaId;
      }
      e.ruaId = ruaId ?? e.ruaId;
      e.estado = 'Deslocando';
      const falta = Math.abs(para.x - e.posicao.x) + Math.abs(para.y - e.posicao.y); // trecho ortogonal: um dos termos é 0
      const andou = Math.min(falta, orcamento);
      e.posicao = {
        x: e.posicao.x + Math.sign(para.x - e.posicao.x) * Math.min(andou, Math.abs(para.x - e.posicao.x)),
        y: e.posicao.y + Math.sign(para.y - e.posicao.y) * Math.min(andou, Math.abs(para.y - e.posicao.y)),
      };
      this.distanciaRealCm += andou;
      orcamento -= andou;
      if (andou < falta) return; // acabou o orçamento do tick no meio do trecho
      e.passos.shift();
      if (libera) this.soltarTrava(e);
      if (orcamento === 0) return;
    }
  }

  /** Trava FIFO do corredor: quem chega e encontra a rua ocupada (ou fila na frente) espera e gera 1 conflito. */
  private tentarTrava(e: EquipamentoInterno, ruaId: string): boolean {
    const fila = this.filasTrava.get(ruaId) ?? [];
    this.filasTrava.set(ruaId, fila);
    const dono = this.travas.get(ruaId);
    if (dono === undefined && (fila.length === 0 || fila[0] === e.id)) {
      if (fila[0] === e.id) fila.shift();
      this.travas.set(ruaId, e.id);
      return true;
    }
    if (!fila.includes(e.id)) {
      fila.push(e.id);
      this.eventosConflito++;
      const rua = this.layout.ruas.find(r => r.ruaId === ruaId)?.codigo ?? ruaId;
      this.registrar(`Conflito no corredor da rua ${rua}: ${e.id} aguarda ${dono ?? fila[0]}.`);
    }
    return false;
  }

  private soltarTrava(e: EquipamentoInterno): void {
    if (e.trava !== null) this.travas.delete(e.trava);
    e.trava = null;
    e.ruaId = null;
  }

  // ---------------------------------------------------------------- montagem e utilidades

  private ocupacaoCentesimos(): number {
    if (this.locais.size === 0) return 0;
    let ocupados = 0;
    for (const l of this.locais.values()) if (l.situacao === 'Ocupado') ocupados++;
    return Math.round((ocupados * 10_000) / this.locais.size);
  }

  private montarContextoPolitica(): ContextoPolitica {
    const saidas = this.layout.docas.filter(d => d.tipo === 'Outbound');
    const distExpedicao = new Map<string, number>();
    for (const l of this.layout.locais) {
      distExpedicao.set(l.localId, saidas.length ? Math.min(...saidas.map(d => this.malha.distancia(d.acesso, l.acesso))) : 0);
    }
    const ordemVarredura = new Map(this.layout.locais.map((l, i) => [l.localId, i]));
    const porProximidade = [...this.layout.locais].sort((a, b) =>
      distExpedicao.get(a.localId)! - distExpedicao.get(b.localId)! || ordemVarredura.get(a.localId)! - ordemVarredura.get(b.localId)!);
    const ranking = new Map(this.pacote.rankingRuas.map(r => [r.ruaId, r.prioridade]));
    return { layout: this.layout, locais: this.locais, curva: this.curva, porProximidade, distExpedicao, ranking };
  }

  private encerrarTurno(): void {
    this.registrar('Fim do turno.');
    const m = this.metricas();
    const s = calcularScore(m);
    if (s.sucesso) {
      this.registrar(`Score final ${(s.scoreCentesimos / 100).toFixed(2)} — ` +
        `${this.ordensConcluidas}/${m.ordensTotal} ordens concluídas, ${m.ordensAtrasadas} atrasadas, ` +
        `${(m.distanciaRealCm / 100_000).toFixed(2)} km (teórica ${(m.distanciaTeoricaCm / 100_000).toFixed(2)} km), ` +
        `${m.eventosConflito} conflitos.`);
    }
  }

  private posicionarEquipamentos(): EquipamentoInterno[] {
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
        carga: null,
        ruaId: null,
        passos: [],
        restanteSeg: 0,
        trava: null,
      };
    });
  }

  private registrar(texto: string): void {
    this.eventos = [{ seg: this.relogioSeg, texto }, ...this.eventos].slice(0, MAX_EVENTOS);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function formatarHora(seg: number): string {
  const h = String(Math.floor(seg / 3600) % 24).padStart(2, '0');
  const m = String(Math.floor((seg % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(seg % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
