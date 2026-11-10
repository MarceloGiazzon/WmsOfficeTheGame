// Fonte de cenários com rede (F5): servidor → cache (IndexedDB) → embutido. Implementa a mesma `FonteCenarios` da
// pré-partida, que continua sem saber de onde o pacote veio — só mostra o selo `origem`.
//
//   listar():   logado → `listarCenarios` (1 chamada) mesclada com o que há neste aparelho (cache + embutidos);
//               convidado (ou servidor inalcançável) → só o que há neste aparelho, sem chamada de rede quando convidado.
//   carregar(): `obterPacote` — logado baixa do servidor e atualiza o cache; se a rede falhar usa o cache; sem cache,
//               o embutido. A origem devolvida é a REAL do pacote que vai para a sim, e `aviso` diz por que não foi o servidor.
//
// A origem de um cartão na LISTA é a esperada ('rede' se o servidor tem o cenário; senão cache ou embutido); a real só
// se sabe ao carregar — por isso `carregar` devolve a sua e a tela de resultado mostra essa.
//
// Os números do cartão (ordens, locais…) vêm do último pacote que o aparelho conhece (cache, senão embutido): a lista
// do servidor só traz o cenário, e baixar o pacote inteiro para cada cartão custaria ~1,5 s por cenário a cada abertura.
// Cenário que só existe no servidor e nunca foi baixado é baixado uma vez para montar o cartão (e fica no cache).

import { ehNpdevError } from '../net/erros';
import type { CachePacotes, ResultadoPacote } from '../net/cache';
import { obterPacote } from '../net/cache';
import { emParalelo } from '../net/leitura';
import type { Http } from '../net/npdevClient';
import { listarCenarios } from '../net/pacote';
import type { Cenario, Dificuldade, PacoteCenario } from '../sim/model';
import { formatarDataHora } from './formato';
import {
  resumirCenario, type AvisoFonte, type FonteCenarios, type OrigemCenario, type PacoteCarregado, type ResumoCenario,
} from './fonteCenarios';
import { causaEmPoucasPalavras, mensagemDeErro } from './mensagensRede';

/** O que a fonte precisa da fonte embutida (a `FonteEmbutida` real serve; os testes passam uma menor). */
export interface FonteLocal {
  codigos(): string[];
  pacoteOuNada(codigo: string): Promise<PacoteCenario | undefined>;
}

export interface DependenciasFonteRede {
  http: Http;
  cache: CachePacotes | null;
  embutida: FonteLocal;
}

const ORDEM_DIFICULDADE: Readonly<Record<Dificuldade, number>> = { Facil: 0, Medio: 1, Dificil: 2, Extremo: 3 };

export class FonteRede implements FonteCenarios {
  private aviso: AvisoFonte | null = null;

  constructor(private readonly dep: DependenciasFonteRede) {}

  avisoDaLista(): AvisoFonte | null {
    return this.aviso;
  }

  async listar(): Promise<ResumoCenario[]> {
    const { http, cache, embutida } = this.dep;
    const alertas: string[] = [];
    this.aviso = null;

    let doServidor: Cenario[] | null = null;
    let falha: unknown = null;
    if (http.logado) {
      try {
        doServidor = await listarCenarios(http);
      } catch (e) {
        if (!ehNpdevError(e)) throw e; // erro de programação: não disfarçar de "sem rede"
        falha = e;
      }
    }
    const noServidor = new Set((doServidor ?? []).map(c => c.codigo));
    const codigos = [...new Set([...noServidor, ...embutida.codigos(), ...(cache ? await cache.codigos() : [])])];

    const resumos = await emParalelo(codigos, 4, async (codigo): Promise<ResumoCenario | null> => {
      try {
        return await this.resumoDe(codigo, noServidor.has(codigo));
      } catch (e) {
        if (!ehNpdevError(e)) throw e;
        alertas.push(`${codigo}: ${mensagemDeErro(e)}`);
        return null;
      }
    });
    const lista = resumos.filter((r): r is ResumoCenario => r !== null)
      .sort((a, b) => ORDEM_DIFICULDADE[a.dificuldade] - ORDEM_DIFICULDADE[b.dificuldade] || (a.codigo < b.codigo ? -1 : 1));

    if (falha !== null) {
      alertas.unshift(`Sem conexão com o servidor (${causaEmPoucasPalavras(falha)}): só aparecem os cenários guardados neste aparelho.`);
    }
    if (alertas.length > 0) this.aviso = { tipo: 'alerta', texto: alertas.join(' ') };
    else if (!http.logado) {
      this.aviso = { tipo: 'info', texto: 'Modo convidado: cenários guardados neste aparelho; a partida não vai para o ranking. Entre para jogar valendo ranking.' };
    }

    if (lista.length === 0) throw new Error(this.aviso?.texto ?? 'nenhum cenário disponível');
    return lista;
  }

  async carregar(codigo: string): Promise<PacoteCarregado> {
    const r = await obterPacote(codigo, {
      http: this.dep.http, cache: this.dep.cache, embutido: c => this.dep.embutida.pacoteOuNada(c),
    });
    const aviso = avisoDoPacote(r);
    return { pacote: r.pacote, origem: r.origem, salvoEm: r.salvoEm, ...(aviso ? { aviso } : {}) };
  }

  /** Cartão de um cenário. `null` só se nenhuma fonte tem o pacote (sem cache nem embutido nem servidor que o entregue). */
  private async resumoDe(codigo: string, noServidor: boolean): Promise<ResumoCenario | null> {
    const { http, cache, embutida } = this.dep;
    const guardado = cache ? await cache.ler(codigo) : null;
    const local = guardado?.pacote ?? await embutida.pacoteOuNada(codigo);
    if (noServidor) {
      if (local) return resumirCenario(local, 'rede');
      // só existe no servidor e este aparelho nunca o baixou: baixa agora (obterPacote também grava no cache)
      const r = await obterPacote(codigo, { http, cache });
      return resumirCenario(r.pacote, r.origem);
    }
    if (!local) return null;
    const origem: OrigemCenario = guardado ? 'cache' : 'embutido';
    return resumirCenario(local, origem);
  }
}

/** Frase para o jogador quando o pacote não veio do servidor ESTANDO logado (ou o cache não pôde ser atualizado). */
export function avisoDoPacote(r: ResultadoPacote): string | undefined {
  const partes: string[] = [];
  if (r.falhaRede) {
    const fonte = r.origem === 'cache'
      ? `o cenário guardado neste aparelho${r.salvoEm ? ` em ${formatarDataHora(r.salvoEm)}` : ''}`
      : 'o cenário embutido no app';
    partes.push(`Sem conexão com o servidor (${causaEmPoucasPalavras(r.falhaRede)}): usando ${fonte}.`);
  }
  partes.push(...r.avisos);
  return partes.length > 0 ? partes.join(' ') : undefined;
}
