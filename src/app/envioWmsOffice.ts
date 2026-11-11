// "Enviar ao WmsOffice": o pedido de exportação de uma partida e o acompanhamento dele. Sem DOM; a rede e os relógios
// entram por parâmetro (testes com o ServidorFalso e tempo falso).
//
//   disponivel ─(solicitar)─► solicitando ─► solicitada ─► andamento ─► concluida
//                                                │   └ (30 s sem a ponte) ─► semPonte ─► andamento …
//                                                └─► falhou (a ponte registrou o erro, ou a consulta falhou, ou passou de 10 min)
//
// Quem executa o pedido é `python3 backend/ponte/ponte.py vigiar` (rodando à parte): o jogo só pede e consulta
// (`src/net/exportacao.ts`). Sem a ponte rodando o pedido fica `Solicitada` — daí o estado `semPonte`, que continua
// consultando: assim que a ponte ligar, a tela anda sozinha.

import { solicitarExportacao, situacaoExportacao, type ExportacaoServidor } from '../net/exportacao';
import type { Http } from '../net/npdevClient';
import { mensagemDeErro } from './mensagensRede';

export type EstadoWmsOffice =
  | { tipo: 'disponivel' }
  | { tipo: 'solicitando' }
  | { tipo: 'solicitada' }
  | { tipo: 'semPonte' }
  | { tipo: 'andamento'; passo: string | null; progressoCentesimos: number | null }
  | { tipo: 'concluida'; url: string }
  | { tipo: 'falhou'; mensagem: string };

export interface DepsEnvioWmsOffice {
  http: Http;
  partidaId: string;
  jogador: string;
  /** Endereço do WmsOffice de destino (ex.: `http://localhost:8100`). */
  alvoUrl: string;
  /** A tela quer saber de toda mudança de estado. */
  aoMudar: (estado: EstadoWmsOffice) => void;
  /** Padrão: `setTimeout`. */
  esperar?: (ms: number) => Promise<void>;
  /** Padrão: `Date.now`. */
  agora?: () => number;
}

export const INTERVALO_CONSULTA_MS = 3_000;
/** Sem a ponte rodando, o pedido fica `Solicitada` para sempre: depois disto, a tela explica. */
export const ESPERA_ATE_SEM_PONTE_MS = 30_000;
export const LIMITE_ACOMPANHAMENTO_MS = 10 * 60_000;
/** Consultas que falham em sequência (rede) antes de desistir de acompanhar. */
const FALHAS_SEGUIDAS_MAX = 3;

/** Onde ver o resultado no WmsOffice: o Mapa do Armazém (o armazém se chama "<cenário> · partida <8 do id> · <data>"). */
export function enderecoMapaWmsOffice(alvoUrl: string): string {
  return `${alvoUrl.replace(/\/+$/, '')}/mapa-armazem.html`;
}

/** Comando que liga a ponte (mostrado quando ela não está rodando). */
export const COMANDO_PONTE = 'python3 backend/ponte/ponte.py vigiar';

export class EnvioWmsOffice {
  private atual: EstadoWmsOffice = { tipo: 'disponivel' };
  private acompanhando = false;
  private parado = false;

  constructor(private readonly dep: DepsEnvioWmsOffice) {}

  get estado(): EstadoWmsOffice {
    return this.atual;
  }

  /** Para de consultar (ex.: o jogador começou outra partida). */
  parar(): void {
    this.parado = true;
  }

  private mudar(e: EstadoWmsOffice): void {
    this.atual = e;
    this.dep.aoMudar(e);
  }

  /**
   * Faz o pedido e acompanha até terminar. Não faz nada se já há um pedido em andamento. Se esta partida já foi
   * enviada a este alvo (ou há um pedido em curso), acompanha esse em vez de duplicar. Nunca lança.
   */
  async solicitar(): Promise<void> {
    if (this.acompanhando) return;
    this.acompanhando = true;
    this.parado = false;
    try {
      this.mudar({ tipo: 'solicitando' });
      let pedido: ExportacaoServidor | null = null;
      try {
        pedido = await situacaoExportacao(this.dep.http, this.dep.partidaId, this.dep.alvoUrl);
        if (pedido === null || pedido.situacao === 'Falhou') {
          pedido = await solicitarExportacao(this.dep.http, {
            partidaId: this.dep.partidaId, alvoUrl: this.dep.alvoUrl, solicitadaPor: this.dep.jogador,
          });
        }
      } catch (e) {
        this.mudar({ tipo: 'falhou', mensagem: `Não consegui pedir a exportação: ${mensagemDeErro(e)}` });
        return;
      }
      await this.acompanhar(pedido);
    } finally {
      this.acompanhando = false;
    }
  }

  private async acompanhar(inicial: ExportacaoServidor): Promise<void> {
    const esperar = this.dep.esperar ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
    const agora = this.dep.agora ?? Date.now;
    const inicio = agora();
    let falhasSeguidas = 0;
    let pedido = inicial;
    for (;;) {
      if (this.parado) return;
      const fim = this.aplicar(pedido, agora() - inicio);
      if (fim) return;
      if (agora() - inicio >= LIMITE_ACOMPANHAMENTO_MS) {
        this.mudar({ tipo: 'falhou', mensagem: 'A exportação está demorando mais de 10 minutos; parei de acompanhar. Ela pode ainda terminar: confira no WmsOffice.' });
        return;
      }
      await esperar(INTERVALO_CONSULTA_MS);
      if (this.parado) return;
      try {
        const lido = await situacaoExportacao(this.dep.http, this.dep.partidaId, this.dep.alvoUrl);
        if (lido) pedido = lido;
        falhasSeguidas = 0;
      } catch (e) {
        if (++falhasSeguidas >= FALHAS_SEGUIDAS_MAX) {
          this.mudar({ tipo: 'falhou', mensagem: `Perdi o contato com o servidor ao acompanhar a exportação: ${mensagemDeErro(e)}` });
          return;
        }
      }
    }
  }

  /** Reflete o pedido na tela. Devolve `true` se terminou (não há mais o que acompanhar). */
  private aplicar(p: ExportacaoServidor, decorridoMs: number): boolean {
    switch (p.situacao) {
      case 'Solicitada':
        this.mudar(decorridoMs >= ESPERA_ATE_SEM_PONTE_MS ? { tipo: 'semPonte' } : { tipo: 'solicitada' });
        return false;
      case 'EmAndamento':
        this.mudar({ tipo: 'andamento', passo: p.passo, progressoCentesimos: p.progressoCentesimos });
        return false;
      case 'Concluida':
        this.mudar({ tipo: 'concluida', url: enderecoMapaWmsOffice(this.dep.alvoUrl) });
        return true;
      case 'Falhou':
        this.mudar({ tipo: 'falhou', mensagem: p.mensagem ?? 'A exportação falhou (sem mensagem).' });
        return true;
    }
  }
}

/** O que a tela escreve para cada estado, e o que o botão (se houver) diz. Puro, testado. */
export interface TextoWmsOffice {
  texto: string;
  /** Rótulo do botão; `null` = sem botão neste estado. */
  botao: string | null;
  /** Progresso 0–100 para a barra, ou null. */
  percentual: number | null;
}

export function textoWmsOffice(e: EstadoWmsOffice): TextoWmsOffice {
  switch (e.tipo) {
    case 'disponivel':
      return { texto: 'Leva esta partida para o WmsOffice corporativo: recebimentos, expedições, movimentos e a ocupação final do armazém, com a hora do jogo.', botao: 'Enviar ao WmsOffice', percentual: null };
    case 'solicitando':
      return { texto: 'Fazendo o pedido…', botao: null, percentual: null };
    case 'solicitada':
      return { texto: 'Pedido feito. Esperando a ponte pegar…', botao: null, percentual: null };
    case 'semPonte':
      return { texto: `A ponte não está rodando: o pedido fica na fila e será feito assim que ela ligar. Para ligá-la, na pasta do projeto: ${COMANDO_PONTE}`, botao: null, percentual: null };
    case 'andamento': {
      const pct = e.progressoCentesimos === null ? null : Math.round(e.progressoCentesimos / 100);
      const onde = e.passo ? ` (${e.passo})` : '';
      return { texto: `Enviando ao WmsOffice${pct === null ? '' : `: ${pct}%`}${onde}…`, botao: null, percentual: pct };
    }
    case 'concluida':
      return { texto: 'Partida enviada. No Mapa do Armazém do WmsOffice, procure o armazém "<cenário> · partida <8 primeiros do id> · <data>".', botao: null, percentual: 100 };
    case 'falhou':
      return { texto: e.mensagem, botao: 'Tentar de novo', percentual: null };
  }
}
