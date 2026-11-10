// Texto para o jogador quando a rede falha. A camada `src/net` classifica o erro (`NpdevError.tipo`); aqui ele vira uma
// frase que diz O QUE aconteceu e O QUE fazer — nunca um "erro desconhecido" nem o texto cru do servidor quando ele
// não ajuda. Puro (sem DOM) e testado.

import { NpdevError, type TipoErro } from '../net/erros';

/** `login`: quem está digitando a senha; `geral`: qualquer outra chamada (cenários, envio da partida). */
export type ContextoErro = 'login' | 'geral';

const comStatus = (e: NpdevError): string => (e.status !== null && e.status >= 500 ? ` (HTTP ${e.status})` : '');

/** Frase completa para um aviso/erro visível. */
export function mensagemDeErro(e: unknown, contexto: ContextoErro = 'geral'): string {
  if (!(e instanceof NpdevError)) return e instanceof Error ? e.message : String(e);
  switch (e.tipo) {
    case 'nao_autenticado':
      return contexto === 'login'
        ? 'Usuário ou senha inválidos.'
        : 'Sua sessão expirou ou não é mais válida. Entre de novo.';
    case 'proibido':
      return contexto === 'login'
        ? 'Este usuário não tem permissão para jogar (falta a role Jogador). Fale com o administrador.'
        : 'Este usuário não tem permissão para esta operação.';
    case 'rede':
      return 'Não foi possível falar com o servidor: sem conexão, ou o servidor está fora do ar.' +
        (contexto === 'login' ? ' Confira a rede e tente de novo, ou jogue como convidado.' : '');
    case 'timeout':
      return 'O servidor demorou demais para responder. Tente de novo em instantes.';
    case 'servidor':
      return `O servidor está com problemas${comStatus(e)}. Tente de novo mais tarde.`;
    case 'resposta_invalida':
      return 'O servidor respondeu em um formato inesperado. Confira se o endereço do servidor está certo.';
    case 'offline':
      return 'Sem login: modo offline.';
    case 'indisponivel':
    case 'nao_encontrado':
    case 'recusado':
    case 'requisicao_invalida':
      return e.message;
  }
}

const CURTO: Readonly<Record<TipoErro, string>> = {
  offline: 'sem login',
  rede: 'sem internet ou servidor fora do ar',
  timeout: 'o servidor não respondeu a tempo',
  nao_autenticado: 'sessão expirada',
  proibido: 'sem permissão',
  nao_encontrado: 'não encontrado no servidor',
  requisicao_invalida: 'pedido recusado pelo servidor',
  servidor: 'o servidor falhou',
  resposta_invalida: 'resposta inesperada do servidor',
  recusado: 'recusado pelo servidor',
  indisponivel: 'indisponível',
};

/** Fragmento para encaixar em outra frase ("Sem conexão com o servidor (…)"): só a causa, em minúsculas. */
export function causaEmPoucasPalavras(e: unknown): string {
  if (e instanceof NpdevError) return CURTO[e.tipo];
  return e instanceof Error ? e.message : String(e);
}
