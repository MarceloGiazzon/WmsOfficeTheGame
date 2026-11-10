import { describe, expect, it } from 'vitest';
import fixtures from '../../backend/npdev/tests/fixtures/alocacao-casos.json';
import { sugerirDestino, sugerirOrigem } from './wmsReal';

// Mesmos casos que o flow SugerirDestinoJogo roda contra o Java (tests/f3_paridade_alocacao.py) — paridade TS × Java (D3).
describe('sugerirDestino — casos compartilhados com AllocationCapability', () => {
  for (const c of fixtures.destino) {
    it(c.nome, () => {
      expect(sugerirDestino((c as { crossDockings?: never[] }).crossDockings ?? null, c.entrada as never)).toEqual(c.esperado);
    });
  }
});

describe('sugerirOrigem — casos compartilhados com AllocationCapability', () => {
  for (const c of fixtures.origem) {
    it(c.nome, () => {
      expect(sugerirOrigem((c as { crossDockings?: never[] }).crossDockings ?? null, c.entrada as never)).toEqual(c.esperado);
    });
  }
});
