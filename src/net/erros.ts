// Erros da camada de rede. Toda falha de comunicação com o NPDev vira um NpdevError: o chamador decide o que
// fazer (mostrar, tentar de novo, cair para o offline), mas nunca recebe "sucesso falso" nem uma falha engolida.

export type TipoErro =
  /** Sem sessão (modo convidado ou token expirado): nenhuma chamada de rede foi feita. */
  | 'offline'
  /** `fetch` falhou: sem conexão, servidor fora do ar, DNS. */
  | 'rede'
  /** O servidor não respondeu dentro do prazo. */
  | 'timeout'
  /** 401: credenciais erradas ou token ausente/expirado/inválido. */
  | 'nao_autenticado'
  /** 403: a role do jogador não cobre a operação (ou a regra por linha negou). */
  | 'proibido'
  /** 404 ou `CONCEPT_NOT_FOUND`: o registro/cenário não existe (mais). */
  | 'nao_encontrado'
  /** 400/409/422: o servidor entendeu e rejeitou a requisição (validação, invariant, lifecycle). */
  | 'requisicao_invalida'
  /** 5xx, 408/429 ou timeout de plugin do flow: falha do servidor, vale tentar depois. */
  | 'servidor'
  /** A resposta veio (2xx) mas não é JSON ou não tem o formato esperado. */
  | 'resposta_invalida'
  /** Regra de negócio: o procedure respondeu `{sucesso:false, motivo}` (métricas inválidas, partida já encerrada). */
  | 'recusado'
  /** Nenhuma fonte tem o dado: sem rede, sem cache e sem pacote embutido. */
  | 'indisponivel';

/** Tipos em que o mesmo pedido pode dar certo mais tarde, sem o jogador mudar nada (rede volta, login refeito). */
const RECUPERAVEIS: ReadonlySet<TipoErro> = new Set(['offline', 'rede', 'timeout', 'nao_autenticado', 'servidor']);

export interface DetalhesErro {
  /** Status HTTP, quando houve resposta. */
  status?: number | null;
  /** Código do servidor (`CONCEPT_NOT_FOUND`, `invalid_credentials`…) ou da classificação (`partida_encerrada`…). */
  codigo?: string | null;
  /** Corpo da resposta, já decodificado (para log/diagnóstico; não para decidir fluxo). */
  corpo?: unknown;
  causa?: unknown;
}

export class NpdevError extends Error {
  readonly tipo: TipoErro;
  readonly status: number | null;
  readonly codigo: string | null;
  readonly corpo: unknown;

  constructor(tipo: TipoErro, mensagem: string, detalhes: DetalhesErro = {}) {
    super(mensagem, detalhes.causa === undefined ? undefined : { cause: detalhes.causa });
    this.name = 'NpdevError';
    this.tipo = tipo;
    this.status = detalhes.status ?? null;
    this.codigo = detalhes.codigo ?? null;
    this.corpo = detalhes.corpo;
  }

  /** Vale tentar de novo depois (a fila de envio mantém o item). O contrário é uma recusa definitiva. */
  get recuperavel(): boolean {
    return RECUPERAVEIS.has(this.tipo);
  }
}

export function ehNpdevError(e: unknown): e is NpdevError {
  return e instanceof NpdevError;
}

/** Texto curto para mostrar ao jogador ou gravar no item da fila. */
export function descreverErro(e: unknown): string {
  if (e instanceof NpdevError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** "CODIGO: mensagem" → `{codigo, mensagem}`. Os erros dos flows do NPDev vêm nesse formato. */
function separarCodigo(s: string): { codigo: string | null; mensagem: string } {
  const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(s);
  return m ? { codigo: m[1], mensagem: m[2] || s } : { codigo: null, mensagem: s };
}

/**
 * Classifica uma resposta HTTP de erro (status >= 400). Formatos que o NPDev usa (verificados ao vivo):
 *  - auth:        401 `{error: "invalid_credentials" | "missing_bearer_token" | "invalid_jwt_header"}`;
 *  - Spring:      `{timestamp, status, error: "Bad Request", path}` (sem detalhe);
 *  - invariants:  422 `{code, concept, invariant, path, message, violations[]}`;
 *  - flows:       422 `{status: "FAILED", errorCode, error: "CODIGO: mensagem", failureInfo}` — inclusive para erro
 *                 de negócio do procedure (CONCEPT_NOT_FOUND, transição de lifecycle) e para o timeout de 5 s do
 *                 plugin sandbox (`PLUGIN_EXECUTION_TIMEOUT`, que acontece na primeira chamada após subir o app).
 */
export function erroDeResposta(status: number, corpo: unknown): NpdevError {
  const o = corpo !== null && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
  const bruto = texto(o.message) ?? texto(o.error) ?? (typeof corpo === 'string' ? texto(corpo) : null);
  const { codigo: codigoDoTexto, mensagem } = bruto ? separarCodigo(bruto) : { codigo: null, mensagem: `HTTP ${status}` };
  const codigo = texto(o.code) ?? codigoDoTexto ?? texto(o.errorCode);
  const detalhes: DetalhesErro = { status, codigo, corpo };
  const flowFalhou = o.status === 'FAILED';
  const nome = `${codigo ?? ''} ${bruto ?? ''}`;

  if (status === 401) { // `error` é um código curto em minúsculas (invalid_credentials, missing_bearer_token…)
    const msg = bruto === 'invalid_credentials' ? 'Usuário ou senha inválidos.' : 'Sessão ausente, inválida ou expirada.';
    return new NpdevError('nao_autenticado', msg, { ...detalhes, codigo: codigo ?? bruto });
  }
  if (status === 403) return new NpdevError('proibido', mensagem, detalhes);
  if (status === 404) return new NpdevError('nao_encontrado', bruto ? mensagem : 'Não encontrado.', detalhes);
  if (status === 408 || status === 429 || status >= 500) return new NpdevError('servidor', mensagem, detalhes);

  if (flowFalhou || status === 422) {
    if (/TIMEOUT|UNAVAILABLE/.test(nome)) return new NpdevError('servidor', mensagem, detalhes);
    if (/NOT_FOUND/.test(nome)) return new NpdevError('nao_encontrado', mensagem, detalhes);
    if (/ROW_SCOPE_DENIED|FORBIDDEN|ACCESS_DENIED|capability\.invoke/.test(nome)) return new NpdevError('proibido', mensagem, detalhes);
  }
  return new NpdevError('requisicao_invalida', mensagem, detalhes);
}
