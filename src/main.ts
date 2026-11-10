// Bootstrap: liga sim (estado) → render (canvas) → ui (DOM). Cada camada só conhece a de baixo.
//
//   requestAnimationFrame ─► Relogio.avancar(dt) ─► n × Simulacao.tick()
//                         └► Renderer.desenhar(snapshot)  +  Hud/Drawer.atualizar(snapshot)
//
// Fluxo da partida:  pré-partida (escolhe cenário + política, relógio parado) ─► "Iniciar turno" ─► jogando
//                    ─► fim do turno: resultado (sim parada no estado final) ─► jogar de novo / trocar cenário.

import { acaoDoAtalho } from './app/atalhos';
import { ligarRede } from './app/appRede';
import type { FonteCenarios, OrigemCenario } from './app/fonteCenarios';
import type { PartidaOnline } from './app/partidaOnline';
import { Relogio, VELOCIDADES, type Velocidade } from './app/relogio';
import { resultadoDaPartida, type ExtrasResultado, type ResultadoPartida } from './app/resultado';
import { Camera } from './render/camera';
import { Cadencia, INTERVALO_UI_MS } from './render/cadencia';
import { ligarEntrada } from './render/input';
import { Perfil } from './render/perf';
import { Renderer } from './render/renderer';
import { aplicarTela, medirTela, mesmaTela, observarTela, type Tela } from './render/tela';
import { POLITICAS, type PacoteCenario, type Politica } from './sim/model';
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
  /** Área do canvas em px de CSS e dpr (o bitmap tem `CSS × dpr`; câmera e gestos usam px de CSS — ver render/tela.ts). */
  private tela: Tela = { largura: 0, altura: 0, dpr: 1 };
  private readonly relogio = new Relogio();

  /** F5: login/convidado, fila de envio e indicadores (src/app/appRede.ts). A partida em curso é consultada ao "Sair". */
  private readonly rede = ligarRede({ partidaAtual: () => this.partidaOnline });
  /** De onde vêm os cenários: servidor → cache → embutido (convidado: só cache/embutido). */
  private readonly fonte: FonteCenarios = this.rede.fonte;
  /** A partida do turno atual no servidor (criar ao iniciar, concluir ao fim, abandonar ao desistir). */
  private partidaOnline: PartidaOnline | null = null;
  /** Aviso de quando o cenário NÃO veio do servidor (rede caiu e o jogo usou cache/embutido): vai para a tela de resultado. */
  private avisoCenario: string | undefined;
  /**
   * Gancho da F5: recebe o resultado do turno (métricas + política + trocas) e devolve o que o servidor respondeu
   * (validação, posição, ranking). A tela de resultado abre na hora e se atualiza quando a promessa resolve. Sem
   * partida online (convidado) devolve só a mensagem de partida local.
   */
  publicarResultado: ((r: ResultadoPartida) => Promise<ExtrasResultado | undefined>) | null =
    r => this.partidaOnline?.concluir(r) ?? Promise.resolve(undefined);

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
  // DOM (HUD, log) a ~10 Hz e só quando o relógio andou; o canvas continua a cada quadro (F6)
  private readonly cadenciaHud = new Cadencia(INTERVALO_UI_MS);
  private readonly cadenciaLog = new Cadencia(INTERVALO_UI_MS);
  private readonly perf = Perfil.daUrl(); // só com ?perf=1

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
    // o canvas acompanha o contêiner (janela, drawer, fonte que chega) e a densidade de pixels (zoom do navegador, outro monitor)
    observarTela(this.canvas.parentElement!, () => this.redimensionar());
    ligarEntrada(this.canvas, this.camera, {
      aoClicar: p => this.clicar(p.x, p.y),
      alvoDuploClique: p => this.centroDoVao(p),
    });
    const centro = () => ({ x: this.tela.largura / 2, y: this.tela.altura / 2 });
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
    await this.rede.abrir(); // restaura a sessão da aba ou oferece login/convidado (sem bloquear o jogo)
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
      this.preJogo.abrir({
        cenarios, cenario, politica: this.politicaEscolhida, podeCancelar, avisoDescarte: this.fase === 'jogando',
        aviso: this.fonte.avisoDaLista?.() ?? null,
      });
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
    // F5: trocar de cenário/reiniciar no meio do turno abandona a partida do servidor; a nova nasce para este turno
    void this.partidaOnline?.desistir();
    this.partidaOnline = this.rede.novaPartida(carregado, politica);
    this.avisoCenario = carregado.aviso;
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
    const perf = this.perf;
    perf?.inicio(agora);
    let ticks = 0;
    if (sim) {
      ticks = this.relogio.avancar(dt); // 0 com a sim pausada (pré-partida, resultado e pausa)
      for (let i = 0; i < ticks && !sim.terminado; i++) sim.tick();
      perf?.fase('sim');
      const s = sim.snapshot();
      this.renderer.desenhar(s, this.camera, { heatmap: this.heatmap, vaoSelecionado: this.vaoSelecionado });
      perf?.fase('desenho');
      // O HUD/gaveta só refazem o DOM a ~10 Hz e quando algo mudou; política, fase e velocidade entram na versão
      // porque mudam com o relógio parado (a faixa "Pausado"/"Em andamento · 5x" é escrita pelo `hud.atualizar`).
      const versaoHud = s.relogioSeg * 128 + POLITICAS.indexOf(s.politica) * 16 + (this.fase === 'jogando' ? 8 : 0)
        + VELOCIDADES.indexOf(this.relogio.velocidade);
      if (this.cadenciaHud.pronto(agora, s.layout, versaoHud)) {
        this.hud.atualizar(s);
        this.drawer.atualizar(s, this.fase === 'jogando');
      }
      if (this.cadenciaLog.pronto(agora)) this.drawer.atualizarLog(s.eventos); // ela mesma só refaz o DOM se há evento novo
      if (s.terminado && this.fase === 'jogando') this.encerrarPartida(s);
      perf?.fase('ui');
    }
    perf?.fim(ticks);
    requestAnimationFrame(this.frame);
  };

  /** Fim do turno: a sim já parou sozinha; pausa o relógio e abre o resultado com o estado final do mapa atrás. */
  private encerrarPartida(s: Snapshot): void {
    this.fase = 'encerrada';
    this.definirVelocidade(0);
    const resultado = this.pacote ? resultadoDaPartida(s, this.pacote.cenario) : null;
    if (!resultado) return; // sem ordens no cenário não há score: o log e o HUD já mostram "—"
    this.ultimoResultado = resultado;
    this.ultimosExtras = this.extrasCom({ ...this.partidaOnline?.extrasIniciais() });
    this.resultadoUi.mostrarResultado(resultado, this.ultimosExtras);
    // extras que chegam depois por outro caminho (convidado que entrou e enviou a partida)
    if (this.partidaOnline) this.partidaOnline.aoNovosExtras = e => this.atualizarExtras(resultado, e);
    this.publicarResultado?.(resultado).then(
      extras => this.atualizarExtras(resultado, extras),
      e => this.atualizarExtras(resultado, { mensagem: `Não foi possível enviar a partida: ${textoDoErro(e)}` }),
    );
  }

  private atualizarExtras(resultado: ResultadoPartida, extras: ExtrasResultado | undefined): void {
    if (this.ultimoResultado !== resultado || !extras) return; // o jogador já começou outra partida
    this.ultimosExtras = this.extrasCom(extras);
    if (this.resultadoUi.aberto) this.resultadoUi.mostrarResultado(resultado, this.ultimosExtras);
  }

  /** Extras do servidor + origem real do cenário + o aviso de queda de rede do carregamento (se houve). */
  private extrasCom(extras: ExtrasResultado): ExtrasResultado {
    const mensagem = [this.avisoCenario, extras.mensagem].filter(Boolean).join(' ');
    return { ...extras, origem: this.origem, ...(mensagem ? { mensagem } : {}) };
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

  /** Alvo do duplo clique: o centro do vão sob o ponto (ou o próprio ponto, no chão). */
  private centroDoVao(p: { x: number; y: number }): { x: number; y: number } {
    const vao = this.sim ? this.renderer.vaoEm(this.sim.layout, p.x, p.y) : null;
    return vao ? { x: vao.rect.x + vao.rect.largura / 2, y: vao.rect.y + vao.rect.altura / 2 } : p;
  }

  /**
   * Ajusta o canvas ao contêiner (senão o mapa estica) e à densidade de pixels: bitmap = CSS × dpr, e o centro da vista
   * continua no centro. Câmera e gestos ficam em px de CSS.
   */
  private redimensionar(): void {
    const t = medirTela(this.canvas.parentElement!, window.devicePixelRatio);
    const antes = this.tela;
    if (mesmaTela(t, antes)) return;
    this.camera.aoRedimensionar(antes, t); // reenquadra se ninguém mexeu na vista; senão mantém o centro
    this.tela = t;
    aplicarTela(this.canvas, t); // só mexe em width/height se mudou (mexer limpa o canvas)
    this.renderer.dpr = t.dpr;
  }

  private enquadrar(sim: Simulacao | null): void {
    if (!sim) return;
    this.camera.enquadrar(sim.layout.largura, sim.layout.altura, this.tela.largura, this.tela.altura);
  }
}

void new Jogo().iniciar();
