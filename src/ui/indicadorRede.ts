// O que o jogador vê da rede no tempo todo, sem atrapalhar o jogo:
//   - cabeçalho: "Convidado [Entrar]" ou "● usuario [Sair]";
//   - faixa de estado: "2 partidas pendentes [Enviar agora]" e "1 rejeitada" (somem quando não há nada na fila).
// Os elementos são criados aqui e encaixados no cabeçalho/faixa existentes (o `index.html` não muda); o que cada botão
// faz vem de fora (`AcoesIndicador`).

import { plural } from '../app/formato';
import type { EstadoSessao } from '../app/sessao';
import type { EstadoSincronizacao } from '../app/sincronizador';
import { h } from './dom';
import './rede.css';

export interface AcoesIndicador {
  aoEntrar: () => void;
  aoSair: () => void;
  aoAbrirFila: () => void;
  aoEnviarAgora: () => void;
}

/** "10 s" / "2 min": a espera da retentativa, para o título do chip. */
function tempoCurto(ms: number): string {
  const seg = Math.max(1, Math.round(ms / 1000));
  return seg < 90 ? `${seg} s` : `${Math.round(seg / 60)} min`;
}

export class IndicadorRede {
  private readonly usuario = h('div', { class: 'rede-usuario', id: 'rede-usuario', role: 'group', 'aria-label': 'Conta' });
  private readonly fila = h('div', { class: 'rede-fila', id: 'rede-fila', hidden: true, role: 'status' });
  private readonly chipPendentes = h('button', { class: 'chip-fila', id: 'btn-fila-pendentes', type: 'button' });
  private readonly chipRejeitadas = h('button', { class: 'chip-fila chip-fila-alerta', id: 'btn-fila-rejeitadas', type: 'button' });
  private readonly enviarAgora = h('button', { class: 'btn-fantasma btn-pequeno', id: 'btn-fila-enviar', type: 'button' }, 'Enviar agora');

  constructor(private readonly acoes: AcoesIndicador) {
    this.chipPendentes.addEventListener('click', acoes.aoAbrirFila);
    this.chipRejeitadas.addEventListener('click', acoes.aoAbrirFila);
    this.enviarAgora.addEventListener('click', acoes.aoEnviarAgora);
    this.fila.append(this.chipPendentes, this.enviarAgora, this.chipRejeitadas);
    // cabeçalho (conta) e faixa de estado (fila): se algum dia o layout mudar, só estes dois pontos de encaixe mudam
    document.querySelector('.hud-header')?.append(this.usuario);
    (document.getElementById('hud-status') ?? document.querySelector('.hud-header'))?.append(this.fila);
  }

  desenharSessao(s: EstadoSessao): void {
    this.usuario.dataset.modo = s.modo;
    if (s.modo === 'logado') {
      this.usuario.replaceChildren(
        h('span', { class: 'rede-nome', title: `Conectado como ${s.usuario}` }, s.usuario ?? ''),
        h('button', { class: 'btn-secundario btn-pequeno', id: 'btn-rede-sair', type: 'button', onclick: this.acoes.aoSair }, 'Sair'));
    } else {
      this.usuario.replaceChildren(
        h('span', { class: 'rede-nome', title: 'Modo convidado: nada é enviado ao servidor' }, 'Convidado'),
        h('button', { class: 'btn-secundario btn-pequeno', id: 'btn-rede-entrar', type: 'button', onclick: this.acoes.aoEntrar }, 'Entrar'));
    }
  }

  desenharFila(logado: boolean, e: EstadoSincronizacao): void {
    const algo = e.pendentes > 0 || e.rejeitados > 0;
    this.fila.hidden = !algo;
    this.chipPendentes.hidden = e.pendentes === 0;
    this.chipRejeitadas.hidden = e.rejeitados === 0;
    this.enviarAgora.hidden = e.pendentes === 0;
    const texto = e.sincronizando ? `Enviando ${plural(e.pendentes, 'partida', 'partidas')}…` : `${plural(e.pendentes, 'partida pendente', 'partidas pendentes')}`;
    this.chipPendentes.textContent = texto;
    const base = e.ultimaMensagem ?? 'Partidas jogadas que ainda não foram aceitas pelo servidor';
    this.chipPendentes.title = e.proximaTentativaEmMs === null ? base
      : `${base} Nova tentativa automática em cerca de ${tempoCurto(e.proximaTentativaEmMs)}.`;
    this.chipPendentes.dataset.falhou = e.ultimaFalhou ? 'sim' : 'nao';
    this.chipRejeitadas.textContent = `${plural(e.rejeitados, 'rejeitada', 'rejeitadas')} pelo servidor`;
    this.enviarAgora.textContent = logado ? 'Enviar agora' : 'Entrar para enviar';
    this.enviarAgora.disabled = e.sincronizando;
  }
}
