// Fonte de cenários embutida: os pacotes gerados dos seeds do backend
// (backend/npdev/tools/gerar_pacotes_front.py) viajam no bundle, cada um em seu próprio chunk (import dinâmico).
// É o modo offline do jogo e o último recurso da F5 quando não há rede nem cache.

import type { PacoteCenario } from '../sim/model';
import { resumirCenario, type FonteCenarios, type PacoteCarregado, type ResumoCenario } from './fonteCenarios';

type Importador = () => Promise<{ default: unknown }>;

/** `importadores` é injetável para teste; o padrão são os dois cenários do repositório. */
export class FonteEmbutida implements FonteCenarios {
  private readonly cache = new Map<string, PacoteCenario>();

  constructor(private readonly importadores: Readonly<Record<string, Importador>> = {
    'WH-A-PEQUENO': () => import('../data/cenarios/WH-A-PEQUENO.json'),
    'WH-B-MEGA': () => import('../data/cenarios/WH-B-MEGA.json'),
  }) {}

  async listar(): Promise<ResumoCenario[]> {
    // O resumo vem do pacote (nº de ordens etc.), então os dois chunks são baixados já na pré-partida: ~200 KB.
    const pacotes = await Promise.all(Object.keys(this.importadores).map(c => this.pacote(c)));
    return pacotes.map(p => resumirCenario(p, 'embutido'));
  }

  async carregar(codigo: string): Promise<PacoteCarregado> {
    return { pacote: await this.pacote(codigo), origem: 'embutido' };
  }

  private async pacote(codigo: string): Promise<PacoteCenario> {
    const guardado = this.cache.get(codigo);
    if (guardado) return guardado;
    const importar = this.importadores[codigo];
    if (!importar) throw new Error(`Cenário desconhecido: ${codigo}`);
    const pacote = (await importar()).default as PacoteCenario;
    this.cache.set(codigo, pacote);
    return pacote;
  }
}
