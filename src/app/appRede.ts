// Cola da F5: monta a camada de rede (`src/net`), os controladores puros desta pasta e a UI de rede, e entrega ao
// `main.ts` o mínimo — a fonte de cenários, "nova partida" e "abrir". É o único módulo `app/` que toca o DOM (via `ui/`).
//
//   login/sessão ─► ControladorSessao ─► (entrou/restaurada) ─► Sincronizador.sincronizar()
//   rede volta (evento `online`) ──────────────────────────► Sincronizador.sincronizar()
//   cenários ─► FonteRede (servidor → cache → embutido)
//   cada turno ─► PartidaOnline (criar no início, concluir/abandonar) ─► fila de envio ─► ranking

import { criarRede } from '../net/rede';
import { Avisos } from '../ui/avisos';
import { TelaFila } from '../ui/filaPendentes';
import { IndicadorRede } from '../ui/indicadorRede';
import { TelaLogin } from '../ui/login';
import { Abandonos } from './abandonos';
import { BASE_API } from './configRede';
import type { FonteCenarios, PacoteCarregado } from './fonteCenarios';
import { FonteEmbutida } from './fonteEmbutida';
import { FonteRede } from './fonteRede';
import { PartidaOnline } from './partidaOnline';
import { ControladorSessao } from './sessao';
import { Sincronizador } from './sincronizador';
import type { Politica } from '../sim/model';

export interface OpcoesAppRede {
  /** A partida que está rodando agora (para "Sair" no meio do turno soltá-la do usuário). */
  partidaAtual: () => PartidaOnline | null;
}

export interface AppRede {
  fonte: FonteCenarios;
  /** Chame uma vez antes da primeira pré-partida: restaura a sessão da aba ou oferece login/convidado (sem bloquear). */
  abrir(): Promise<void>;
  /** Uma partida para o turno que vai começar (cria a SimPartida no servidor em segundo plano, se logado). */
  novaPartida(carregado: PacoteCarregado, politica: Politica): PartidaOnline;
  /** Abre o login; resolve `true` se o jogador entrou. */
  pedirLogin(): Promise<boolean>;
}

/** "Sair" não espera o servidor mais que isto: abandonar a partida é bom, mas não vale travar o botão. */
const ESPERA_MAXIMA_AO_SAIR_MS = 2500;

export function ligarRede(opcoes: OpcoesAppRede): AppRede {
  let sessao!: ControladorSessao;
  const rede = criarRede({ base: BASE_API, aoSessaoExpirar: () => sessao.aoExpirar() });
  sessao = new ControladorSessao(rede.cliente);

  const avisos = new Avisos();
  const abandonos = new Abandonos(rede.armazenamento, rede.cliente);
  const sincronizador = new Sincronizador(rede.fila, rede.cliente, {
    abandonos,
    aoRodada: (r, mensagem) => avisos.mostrar(mensagem, r.rejeitados.length > 0 ? 'alerta' : 'ok'),
  });
  const fonte = new FonteRede({ http: rede.cliente, cache: rede.cache, embutida: new FonteEmbutida() });

  // ---- UI ---------------------------------------------------------------------------------------------------------
  const login = new TelaLogin(async (usuario, senha) => { await sessao.entrar(usuario, senha); });
  const telaFila = new TelaFila({
    listar: () => rede.fila.listar(),
    reenviar: id => rede.fila.reenviar(id),
    descartar: id => rede.fila.descartar(id),
    enviarAgora: () => sincronizador.sincronizar(),
    entrar: () => { void pedirLogin(); },
  });
  const indicador = new IndicadorRede({
    aoEntrar: () => { void pedirLogin(); },
    aoSair: () => { void sair(); },
    aoAbrirFila: () => { void telaFila.abrir(sessao.estado.modo === 'logado', sessao.estado.usuario, sincronizador.estado); },
    aoEnviarAgora: () => {
      if (sessao.estado.modo === 'logado') void sincronizador.sincronizar();
      else void pedirLogin();
    },
  });

  const pedirLogin = async (aviso?: string): Promise<boolean> =>
    (await login.abrir({ primeiraVez: false, usuario: sessao.ultimoUsuario, aviso })) === 'entrou';

  async function sair(): Promise<void> {
    // a partida em curso era do usuário: abandona no servidor ENQUANTO ainda há token, e o turno segue como local
    const partida = opcoes.partidaAtual();
    if (partida) await Promise.race([partida.soltar(), new Promise<void>(r => setTimeout(r, ESPERA_MAXIMA_AO_SAIR_MS))]);
    sessao.sair();
  }

  // ---- reações ----------------------------------------------------------------------------------------------------
  const redesenhar = (): void => {
    const logado = sessao.estado.modo === 'logado';
    indicador.desenharSessao(sessao.estado);
    indicador.desenharFila(logado, sincronizador.estado);
    telaFila.atualizar(logado, sessao.estado.usuario, sincronizador.estado);
  };
  sincronizador.observar(redesenhar);
  sessao.observar((estado, evento) => {
    redesenhar();
    void sincronizador.atualizar(); // a fila conta por jogador: quem sou eu mudou
    if (evento === 'entrou' || evento === 'restaurada') void sincronizador.sincronizar();
    if (evento === 'expirou') {
      avisos.mostrar('Sua sessão expirou: você voltou ao modo convidado. A partida em andamento continua; se ela terminar sem login, o resultado fica guardado e é enviado quando você entrar de novo.', 'alerta');
    } else if (evento === 'saiu') {
      avisos.mostrar('Você saiu. Jogando como convidado: nada é enviado ao servidor.', 'info');
    } else if (evento === 'entrou') {
      avisos.mostrar(`Conectado como ${estado.usuario}.`, 'ok');
    }
  });

  // A rede voltou (ou a aba voltou ao primeiro plano, depois de os temporizadores terem sido adiados): confere a sessão e envia.
  window.addEventListener('online', () => { sessao.verificar(); void sincronizador.sincronizar(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sessao.verificar(); });

  return {
    fonte,

    async abrir(): Promise<void> {
      await sincronizador.iniciar();
      redesenhar();
      if (sessao.restaurar()) {
        void sessao.validarNoServidor(); // token que o servidor já não aceita: avisa agora, não no meio do primeiro turno
        return; // o observador já disparou o envio da fila
      }
      if (!sessao.estado.escolheu) {
        const desfecho = await login.abrir({ primeiraVez: true, usuario: sessao.ultimoUsuario });
        if (desfecho !== 'entrou') sessao.escolherConvidado();
      }
    },

    novaPartida(carregado, politica): PartidaOnline {
      sessao.verificar(); // token vencido sem ninguém ter percebido: vira convidado (e avisa) antes de a partida decidir o dono
      if (carregado.aviso) avisos.mostrar(carregado.aviso, 'alerta');
      const { cenario } = carregado.pacote;
      return new PartidaOnline(
        { http: rede.cliente, fila: rede.fila, abandonos, pedirLogin: () => pedirLogin(), aoTerminar: () => { void sincronizador.sincronizar(); } },
        { cenarioCodigo: cenario.codigo, cenarioId: cenario.id, politica, origem: carregado.origem },
      );
    },

    pedirLogin: () => pedirLogin(),
  };
}
