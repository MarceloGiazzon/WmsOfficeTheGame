import { PoliticaAlocacao } from '../models/types';

export class NPDevClient {
  private baseUrl: string;

  // Mesma origem: em dev o Vite repassa /api para o NPDev (:8200); em produção o jogo é servido pelo próprio app.
  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  public async atualizarPolitica(politica: PoliticaAlocacao): Promise<{ success: boolean }> {
    try {
      const resp = await fetch(`${this.baseUrl}/simulacao/politica`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ politica })
      });
      return await resp.json();
    } catch {
      return { success: true }; // Fallback offline
    }
  }

  public async injetarLoteNotasFiscais(cenarioId: string): Promise<any> {
    try {
      const resp = await fetch(`${this.baseUrl}/simulacao/injetar-lote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cenarioId })
      });
      return await resp.json();
    } catch {
      return { status: 'MOCK_INJECTED', totalNovosPaletes: 16 };
    }
  }
}
