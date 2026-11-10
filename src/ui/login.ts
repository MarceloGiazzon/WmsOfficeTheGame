// Modal de login. O jogo nunca depende dele: "Jogar como convidado" (ou Esc) é sempre um clique e não faz nenhuma
// chamada de rede. A tela não sabe falar com o servidor: recebe `entrar(usuario, senha)` e mostra o erro que ela lançar
// (`NpdevError` → texto legível de `mensagemDeErro`).

import { mensagemDeErro } from '../app/mensagensRede';
import { h, preencher } from './dom';
import { Modal } from './modal';
import './rede.css';

export type DesfechoLogin = 'entrou' | 'convidado' | 'cancelou';

export interface OpcoesLogin {
  /** Primeira abertura do jogo: o botão secundário é "Jogar como convidado". Depois dela é "Cancelar" (já se está jogando). */
  primeiraVez: boolean;
  /** Campo de usuário preenchido (o último que entrou neste aparelho). */
  usuario?: string | null;
  /** Frase acima do formulário (ex.: "Sua sessão expirou"). */
  aviso?: string | null;
}

export class TelaLogin {
  private readonly raiz = h('div', { id: 'modal-login', class: 'modal-fundo', hidden: true });
  private readonly modal: Modal;
  private readonly sub = h('p', { class: 'modal-sub' });
  private readonly campoUsuario = h('input', { id: 'login-usuario', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
  private readonly campoSenha = h('input', { id: 'login-senha', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  private readonly erro = h('p', { class: 'login-erro', role: 'alert', hidden: true });
  private readonly botaoEntrar = h('button', { class: 'btn-primary', type: 'submit' }, 'Entrar');
  private readonly botaoSecundario = h('button', { class: 'btn-fantasma', type: 'button' }, 'Jogar como convidado');
  private opcoes: OpcoesLogin = { primeiraVez: true };
  private enviando = false;
  private pendente: { promessa: Promise<DesfechoLogin>; resolver: (d: DesfechoLogin) => void } | null = null;

  constructor(private readonly entrar: (usuario: string, senha: string) => Promise<void>) {
    const formulario = h('form', { class: 'login-form', novalidate: true },
      h('div', { class: 'modal-corpo' },
        h('label', { class: 'campo', for: 'login-usuario' }, 'Usuário', this.campoUsuario),
        h('label', { class: 'campo', for: 'login-senha' }, 'Senha', this.campoSenha),
        this.erro),
      h('footer', { class: 'modal-rodape' }, this.botaoSecundario, this.botaoEntrar));
    formulario.addEventListener('submit', e => { e.preventDefault(); void this.enviar(); });
    this.botaoSecundario.addEventListener('click', () => this.encerrar(this.opcoes.primeiraVez ? 'convidado' : 'cancelou'));

    this.raiz.append(h('div', { class: 'modal modal-login', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'login-titulo', tabindex: -1 },
      h('header', { class: 'modal-cabecalho' },
        h('p', { class: 'modal-eyebrow' }, 'WmsOffice: The Game'),
        h('h2', { id: 'login-titulo' }, 'Entrar'),
        this.sub),
      formulario));
    document.body.append(this.raiz);
    // Esc / clique no fundo: na abertura vale "convidado" (o jogo não fica preso); depois, só fecha
    this.modal = new Modal(this.raiz, () => { if (!this.enviando) this.encerrar(this.opcoes.primeiraVez ? 'convidado' : 'cancelou'); });
  }

  get aberto(): boolean {
    return this.modal.aberto;
  }

  /** Abre o login e resolve quando ele fecha: `entrou` (login feito), `convidado` ou `cancelou`. Já aberto = a mesma promessa. */
  abrir(opcoes: OpcoesLogin): Promise<DesfechoLogin> {
    if (this.pendente) return this.pendente.promessa;
    this.opcoes = opcoes;
    this.sub.textContent = [
      opcoes.aviso,
      opcoes.primeiraVez
        ? 'Entre para jogar valendo ranking e guardar seus resultados. Sem conta? Jogue como convidado: tudo funciona offline, só não entra no ranking.'
        : 'Entre para enviar suas partidas ao ranking.',
    ].filter(Boolean).join(' ');
    this.botaoSecundario.textContent = opcoes.primeiraVez ? 'Jogar como convidado' : 'Cancelar';
    this.campoUsuario.value = opcoes.usuario ?? '';
    this.campoSenha.value = '';
    this.mostrarErro(null);
    this.definirEnviando(false);

    let resolver!: (d: DesfechoLogin) => void;
    const promessa = new Promise<DesfechoLogin>(r => { resolver = r; });
    this.pendente = { promessa, resolver };
    this.modal.abrir(opcoes.usuario ? this.campoSenha : this.campoUsuario);
    return promessa;
  }

  private async enviar(): Promise<void> {
    if (this.enviando) return;
    this.mostrarErro(null);
    this.definirEnviando(true);
    try {
      await this.entrar(this.campoUsuario.value, this.campoSenha.value);
    } catch (e) {
      this.definirEnviando(false);
      this.mostrarErro(mensagemDeErro(e, 'login'));
      // senha errada: limpa e volta para ela; rede/servidor: deixa como está para tentar de novo
      const errouASenha = (e as { tipo?: string })?.tipo === 'nao_autenticado';
      if (errouASenha) this.campoSenha.value = '';
      (errouASenha || this.campoUsuario.value.trim() !== '' ? this.campoSenha : this.campoUsuario).focus();
      return;
    }
    this.encerrar('entrou');
  }

  private encerrar(desfecho: DesfechoLogin): void {
    this.campoSenha.value = ''; // a senha não fica no DOM depois de usada
    this.modal.fechar();
    const p = this.pendente;
    this.pendente = null;
    p?.resolver(desfecho);
  }

  private definirEnviando(sim: boolean): void {
    this.enviando = sim;
    this.botaoEntrar.disabled = sim;
    this.botaoSecundario.disabled = sim;
    this.botaoEntrar.textContent = sim ? 'Entrando…' : 'Entrar';
  }

  private mostrarErro(texto: string | null): void {
    this.erro.hidden = texto === null;
    preencher(this.erro, texto);
  }
}
