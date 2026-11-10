// Bootstrap: liga sim (estado) → render (canvas) → ui (DOM). Cada camada só conhece a de baixo.
//
//   requestAnimationFrame ─► Relogio.avancar(dt) ─► n × Simulacao.tick()
//                         └► Renderer.desenhar(snapshot)  +  Hud/Drawer.atualizar(snapshot)
//
// Fluxo da partida:  pré-partida (escolhe cenário + política, relógio parado) ─► "Iniciar turno" ─► jogando
//                    ─► fim do turno: resultado (sim parada no estado final) ─► jogar de novo / trocar cenário.

import { acaoDoAtalho } from './app/atalhos';
import type { FonteCenarios, OrigemCenario } from './app/fonteCenarios';
import { FonteEmbutida } from './app/fonteEmbutida';
import { Relogio, type Velocidade } from './app/relogio';
import { resultadoDaPartida, type ExtrasResultado, type ResultadoPartida } from './app/resultado';
import { Camera } from './render/camera';
import { ligarEntrada } from './render/input';
import { Renderer } from './render/renderer';
import type { PacoteCenario, Politica } from './sim/model';
import { Simulacao, type Snapshot } from './sim/simulation';
import './ui/fontes.css';
import './ui/mobile.css';
import { Drawer } from './ui/drawer';
import { Hud } from './ui/hud';
import { Inspector } from './ui/inspector';
import { algumModalAberto } from './ui/modal';
import { PreJogo } from './ui/preJogo';
import { TelaResultado } from './ui/resultado';
import { Tutorial } from './ui/tutorial';

type Fase = 'semPartida' | 'jogando' | 'encerrada';

const textoDoErro = (e: unknown): string => (e instanceof Error ? e.message : String(e));

class Jogo {
  private readonly canvas = document.getElementById('warehouse-canvas') as HTMLCanvasElement;
  private readonly renderer = new Renderer(this.canvas.getContext('2d')!);
  private readonly camera = new Camera();
  private readonly relogio = new Relogio();

  /**
   * De onde vêm os cenários. A F5 troca por uma fonte que tenta a rede, cai para o cache e por fim para o embutido
   * (ver `FonteCenarios`); o resto do jogo não muda.
   */
  private readonly fonte: FonteCenarios = new FonteEmbutida();
  /**
   * Gancho da F5: recebe o resultado do turno (métricas + política + trocas) e devolve o que o servidor respondeu
   * (validação, posição, ranking). A tela de resultado abre na hora e se atualiza quando a promessa resolve. Sem
   * gancho = partida local.
   */
  publicarResultado: ((r: ResultadoPartida) => Promise<ExtrasResultado | undefined>) | null = null;

  private fase: Fase = 'semPartida';
  private sim: Simulacao | null = null;
  private pacote: PacoteCenario | null = null;
  private origem: OrigemCenario = 'embutido';
  private politicaEscolhida: Politica = 'AbcProximidade';
  private ultimoResultado: ResultadoPartida | null = null;
  private ultimosExtras: ExtrasResultado | undefined;

  /** A pré-partida foi aberta com o relógio andando: "Voltar à partida" (ou Esc) retoma de onde parou. */
  private retomarAoCancelar = false;
  private abrindoPreJogo = false;

  private ultimaVelocidade: Velocidade = 1;
  private heatmap = false;
  private vaoSelecionado: string | null = null;
  private ultimoFrame = 0;

  private readonly hud = new Hud(
    v => this.escolherVelocidade(v),
    () => this.drawer.abrirPolitica(),
    () => { if (this.ultimoResultado) this.resultadoUi.mostrarResultado(this.ultimoResultado, this.ultimosExtras); },
  );
  private readonly inspector = new Inspector(() => { this.vaoSelecionado = null; });
  private readonly drawer = new Drawer(p => this.mudarPolitica(p), () => void this.abrirPreJogo());
  private readonly preJogo = new PreJogo({
    aoIniciar: (c, p) => void this.iniciarPartida(c, p),
    aoCancelar: () => this.cancelarPreJogo(),
  });
  /** O tutorial pausa a sim enquanto está aberto; ao fechar, só retoma se foi ele quem a pausou. */
  private retomarAoFecharTutorial = false;
  private readonly tutorial = new Tutorial({
    aoAbrir: () => {
      this.retomarAoFecharTutorial = this.fase === 'jogando' && this.relogio.velocidade !== 0;
      this.definirVelocidade(0);
    },
    aoFechar: () => {
      if (this.retomarAoFecharTutorial && this.fase === 'jogando') this.definirVelocidade(this.ultimaVelocidade);
      this.retomarAoFecharTutorial = false;
    },
    gaveta: this.drawer,
  });
  private readonly resultadoUi = new TelaResultado({
    aoJogarDeNovo: () => {
      const r = this.ultimoResultado;
      this.resultadoUi.fechar();
      if (r) void this.iniciarPartida(r.cenarioCodigo, r.politicaInicial);
    },
    aoTrocar: () => { this.resultadoUi.fechar(); void this.abrirPreJogo(); },
    aoFechar: () => this.resultadoUi.fechar(),
  });

  async iniciar(): Promise<void> {
    this.redimensionar();
    // Observa o contêiner (não a janela): recolher/abrir a gaveta também muda a altura do mapa.
    new ResizeObserver(() => this.redimensionar()).observe(this.canvas.parentElement!);
    ligarEntrada(this.canvas, this.camera, p => this.clicar(p.x, p.y));
    const centro = () => ({ x: this.canvas.width / 2, y: this.canvas.height / 2 });
    document.getElementById('btn-zoom-in')!.addEventListener('click', () => this.camera.zoom(1.25, centro()));
    document.getElementById('btn-zoom-out')!.addEventListener('click', () => this.camera.zoom(1 / 1.25, centro()));
    document.getElementById('btn-reset-cam')!.addEventListener('click', () => this.enquadrar(this.sim));
    document.getElementById('btn-toggle-heatmap')!.addEventListener('click', () => { this.heatmap = !this.heatmap; });
    window.addEventListener('keydown', e => this.atalho(e));
    // Depois de clicar num botão com o mouse o foco sai dele: senão o espaço (pausa) viraria "clicar de novo no botão".
    // Teclado (detail = 0) mantém o foco. Na fase de captura, para valer antes de um modal guardar "quem tinha o foco".
    document.addEventListener('click', e => {
      const botao = (e.target as Element).closest('button');
      if (botao && e.detail > 0 && !botao.closest('[role="dialog"]')) botao.blur();
    }, true);

    this.definirVelocidade(0); // relógio parado até "Iniciar turno"
    requestAnimationFrame(this.frame);
    await this.abrirPreJogo();
  }

  // ---------------------------------------------------------------- pré-partida

  /** Abre a pré-partida. Com partida em curso, pausa a sim (o mapa continua atrás, parado); Esc / "Voltar" retoma. */
  private async abrirPreJogo(): Promise<void> {
    if (this.preJogo.aberto || this.abrindoPreJogo) return; // clique duplo: o segundo veria o relógio já parado
    this.abrindoPreJogo = true;
    this.retomarAoCancelar = this.fase === 'jogando' && this.relogio.velocidade !== 0;
    this.definirVelocidade(0);
    try { await this.listarEAbrirPreJogo(); } finally { this.abrindoPreJogo = false; }
  }

  private async listarEAbrirPreJogo(): Promise<void> {
    const podeCancelar = this.sim !== null;
    try {
      const cenarios = await this.fonte.listar();
      if (cenarios.length === 0) throw new Error('nenhum cenário disponível');
      const marcado = this.pacote?.cenario.codigo;
      const cenario = cenarios.some(c => c.codigo === marcado) ? marcado! : cenarios[0].codigo;
      this.preJogo.abrir({ cenarios, cenario, politica: this.politicaEscolhida, podeCancelar, avisoDescarte: this.fase === 'jogando' });
    } catch (e) {
      this.preJogo.mostrarErro(textoDoErro(e), () => void this.listarEAbrirPreJogo(), podeCancelar);
    }
  }

  private cancelarPreJogo(): void {
    this.preJogo.fechar();
    if (this.retomarAoCancelar) this.definirVelocidade(this.ultimaVelocidade);
  }

  private async iniciarPartida(codigo: string, politica: Politica): Promise<void> {
    this.preJogo.ocupado(true);
    // deixa o navegador pintar "Carregando…" antes do construtor da sim (≈0,2 s no WH-B) travar a página
    await new Promise<void>(r => requestAnimationFrame(() => setTimeout(r)));
    let carregado;
    try {
      carregado = await this.fonte.carregar(codigo);
    } catch (e) {
      this.preJogo.mostrarErro(textoDoErro(e), () => void this.listarEAbrirPreJogo(), this.sim !== null);
      return;
    }
    const sim = new Simulacao(carregado.pacote, politica);
    this.sim = sim;
    this.pacote = carregado.pacote;
    this.origem = carregado.origem;
    this.politicaEscolhida = politica;
    this.fase = 'jogando';
    this.ultimoResultado = null;
    this.ultimosExtras = undefined;
    this.vaoSelecionado = null;
    this.inspector.esconder();
    this.resultadoUi.fechar();
    this.preJogo.fechar();
    this.hud.definirCenario(carregado.pacote.cenario);
    this.drawer.definirCenario(carregado.pacote.cenario);
    this.drawer.limparAviso();
    this.enquadrar(sim);
    this.ultimaVelocidade = 1;
    this.definirVelocidade(1);
    this.tutorial.abrirSeNovato(); // só no primeiro turno de quem nunca viu o guia; pausa a sim enquanto aberto
  }

  // ---------------------------------------------------------------- durante a partida

  private frame = (agora: number): void => {
    const dt = this.ultimoFrame ? agora - this.ultimoFrame : 0;
    this.ultimoFrame = agora;
    const sim = this.sim;
    if (sim) {
      const ticks = this.relogio.avancar(dt); // 0 com a sim pausada (pré-partida, resultado e pausa)
      for (let i = 0; i < ticks && !sim.terminado; i++) sim.tick();
      const s = sim.snapshot();
      this.renderer.desenhar(s, this.camera, { heatmap: this.heatmap, vaoSelecionado: this.vaoSelecionado });
      this.hud.atualizar(s);
      this.drawer.atualizar(s, this.fase === 'jogando');
      this.drawer.atualizarLog(s.eventos);
      if (s.terminado && this.fase === 'jogando') this.encerrarPartida(s);
    }
    requestAnimationFrame(this.frame);
  };

  /** Fim do turno: a sim já parou sozinha; pausa o relógio e abre o resultado com o estado final do mapa atrás. */
  private encerrarPartida(s: Snapshot): void {
    this.fase = 'encerrada';
    this.definirVelocidade(0);
    const resultado = this.pacote ? resultadoDaPartida(s, this.pacote.cenario) : null;
    if (!resultado) return; // sem ordens no cenário não há score: o log e o HUD já mostram "—"
    this.ultimoResultado = resultado;
    this.ultimosExtras = { origem: this.origem };
    this.resultadoUi.mostrarResultado(resultado, this.ultimosExtras);
    this.publicarResultado?.(resultado).then(
      extras => this.atualizarExtras(resultado, extras),
      e => this.atualizarExtras(resultado, { mensagem: `Não foi possível enviar a partida: ${textoDoErro(e)}` }),
    );
  }

  private atualizarExtras(resultado: ResultadoPartida, extras: ExtrasResultado | undefined): void {
    if (this.ultimoResultado !== resultado || !extras) return; // o jogador já começou outra partida
    this.ultimosExtras = { origem: this.origem, ...extras };
    if (this.resultadoUi.aberto) this.resultadoUi.mostrarResultado(resultado, this.ultimosExtras);
  }

  private mudarPolitica(p: Politica): void {
    const sim = this.sim;
    if (!sim || this.fase !== 'jogando' || sim.snapshot().politica === p) return;
    sim.setPolitica(p);
    this.drawer.avisarTroca(sim.snapshot().relogioSeg, p);
    this.hud.destacarPolitica();
  }

  // ---------------------------------------------------------------- velocidade e teclado

  private definirVelocidade(v: Velocidade): void {
    this.relogio.velocidade = v;
    this.hud.marcarVelocidade(v);
  }

  /** Botões do HUD: só valem com o turno em andamento (no fim, ou antes de começar, o botão não muda nada). */
  private escolherVelocidade(v: Velocidade): void {
    if (this.fase !== 'jogando' || algumModalAberto()) { this.hud.marcarVelocidade(this.relogio.velocidade); return; }
    if (v !== 0) this.ultimaVelocidade = v;
    this.definirVelocidade(v);
  }

  private atalho(e: KeyboardEvent): void {
    const alvo = e.target instanceof HTMLElement ? e.target : null;
    const acao = acaoDoAtalho(
      { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat, alvoTag: alvo?.tagName ?? null, alvoEditavel: alvo?.isContentEditable ?? false },
      this.fase === 'jogando' && !algumModalAberto(),
    );
    if (!acao) return;
    e.preventDefault();
    if (acao.tipo === 'velocidade') this.escolherVelocidade(acao.v);
    else this.escolherVelocidade(this.relogio.velocidade === 0 ? this.ultimaVelocidade : 0);
  }

  // ---------------------------------------------------------------- canvas

  private clicar(x: number, y: number): void {
    if (!this.sim) return;
    const s = this.sim.snapshot();
    const vao = this.renderer.vaoEm(s.layout, x, y);
    this.vaoSelecionado = vao?.chave ?? null;
    if (vao) this.inspector.mostrar(vao, s, this.sim.pacote);
    else this.inspector.esconder();
  }

  /** Ajusta o bitmap do canvas ao contêiner (senão o mapa estica) e mantém o que estava no centro da tela no centro. */
  private redimensionar(): void {
    const pai = this.canvas.parentElement!;
    const { width: antesL, height: antesA } = this.canvas;
    if (pai.clientWidth === antesL && pai.clientHeight === antesA) return;
    this.canvas.width = pai.clientWidth;
    this.canvas.height = pai.clientHeight;
    if (antesL > 0 && antesA > 0) this.camera.mover((pai.clientWidth - antesL) / 2, (pai.clientHeight - antesA) / 2);
  }

  private enquadrar(sim: Simulacao | null): void {
    if (!sim) return;
    this.camera.enquadrar(sim.layout.largura, sim.layout.altura, this.canvas.width, this.canvas.height);
  }
}

void new Jogo().iniciar();
