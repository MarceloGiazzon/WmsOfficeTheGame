// Pedido de exportação de uma partida ao WmsOffice (ponte Jogo ↔ WmsOffice, backend/ponte).
//
// O jogo NÃO fala com o WmsOffice: o botão só cria uma `SimExportacao` "Solicitada" no servidor do jogo; o processo
// `python3 backend/ponte/ponte.py vigiar` (rodando à parte, com a senha de admin) a executa e vai atualizando `situacao`,
// `passo` e `progressoCentesimos`. O jogador só lê e cria (não edita): quem muda a situação é a ponte.

import { listarConceito } from './leitura';
import type { Http } from './npdevClient';
import { enumerado, objeto, texto, type Obj } from './validacao';

export const SITUACOES_EXPORTACAO = ['Solicitada', 'EmAndamento', 'Concluida', 'Falhou'] as const;
export type SituacaoExportacao = (typeof SITUACOES_EXPORTACAO)[number];

export interface ExportacaoServidor {
  id: string;
  partidaId: string;
  alvoUrl: string;
  situacao: SituacaoExportacao;
  /** Onde a ponte está (ex.: "garantir pos:12"), ou null. */
  passo: string | null;
  /** 0–10000, ou null. */
  progressoCentesimos: number | null;
  /** Id do armazém espelho criado no WmsOffice (só com `Concluida`). */
  armazemAlvoId: string | null;
  mensagem: string | null;
  solicitadaEm: string;
}

const opcional = (o: Obj, campo: string): string | null => (typeof o[campo] === 'string' && o[campo] !== '' ? (o[campo] as string) : null);

function paraExportacao(r: Obj, onde = 'exportacao'): ExportacaoServidor {
  return {
    id: texto(r, 'id', onde), partidaId: texto(r, 'partidaId', onde), alvoUrl: texto(r, 'alvoUrl', onde),
    situacao: enumerado(r, 'situacao', SITUACOES_EXPORTACAO, onde),
    passo: opcional(r, 'passo'),
    progressoCentesimos: typeof r.progressoCentesimos === 'number' ? r.progressoCentesimos : null,
    armazemAlvoId: opcional(r, 'armazemAlvoId'), mensagem: opcional(r, 'mensagem'),
    solicitadaEm: texto(r, 'solicitadaEm', onde),
  };
}

export interface DadosPedidoExportacao {
  partidaId: string;
  alvoUrl: string;
  /** username de quem pede (a regra por linha do servidor exige que seja o próprio). */
  solicitadaPor: string;
  solicitadaEm?: Date | string;
}

/** Cria o pedido (`Solicitada`). Quem o executa é o `ponte.py vigiar`. */
export async function solicitarExportacao(http: Http, d: DadosPedidoExportacao): Promise<ExportacaoServidor> {
  const quando = d.solicitadaEm instanceof Date ? d.solicitadaEm.toISOString() : d.solicitadaEm ?? new Date().toISOString();
  const r = await http.post('/sim_exportacaos', {
    partidaId: d.partidaId, alvoUrl: d.alvoUrl, situacao: 'Solicitada', solicitadaPor: d.solicitadaPor, solicitadaEm: quando,
  });
  return paraExportacao(objeto(r, 'SimExportacao'));
}

/**
 * O pedido MAIS RECENTE desta partida para este alvo, ou null se nunca pediu. Pode haver mais de um (o jogador não edita:
 * depois de um `Falhou`, tentar de novo é um pedido novo), por isso vale o último.
 */
export async function situacaoExportacao(http: Http, partidaId: string, alvoUrl: string): Promise<ExportacaoServidor | null> {
  const linhas = (await listarConceito(http, 'SimExportacao', { partidaId, alvoUrl })).map((r, i) => paraExportacao(r, `SimExportacao[${i}]`));
  if (linhas.length === 0) return null;
  return linhas.reduce((a, b) => (Date.parse(b.solicitadaEm) > Date.parse(a.solicitadaEm) ? b : a));
}
