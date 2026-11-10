// Cartão de inspeção de um vão (rua + posição, todos os andares).

import type { Vao } from '../render/renderer';
import type { PacoteCenario } from '../sim/model';
import type { Snapshot } from '../sim/simulation';

export class Inspector {
  private readonly card = document.getElementById('inspector-card')!;
  private readonly titulo = document.getElementById('inspector-title')!;
  private readonly corpo = document.getElementById('inspector-body')!;

  constructor(aoFechar: () => void) {
    document.getElementById('inspector-close')!.addEventListener('click', () => {
      this.esconder();
      aoFechar();
    });
  }

  esconder(): void {
    this.card.classList.add('hidden');
  }

  mostrar(v: Vao, s: Snapshot, pacote: PacoteCenario): void {
    const produto = new Map(pacote.produtos.map(p => [p.id, p]));
    this.titulo.textContent = `Posição ${v.ruaCodigo}-${String(v.posicao).padStart(2, '0')}`;
    const linhas: [string, string][] = [['Rua', v.ruaCodigo], ['Posição', String(v.posicao)]];
    let acessos = 0;
    for (const a of [...v.andares].sort((x, y) => y.andar - x.andar)) {
      const e = s.locais.get(a.localId);
      acessos += e?.acessos ?? 0;
      const conteudo = e?.produtoId ? (produto.get(e.produtoId)?.codigo ?? e.produtoId) : (e?.situacao ?? '—');
      linhas.push([`Andar ${a.andar}`, conteudo]);
    }
    linhas.push(['Acessos', String(acessos)]);
    this.corpo.replaceChildren(...linhas.map(([k, val]) => {
      const row = document.createElement('div');
      row.className = 'prop-row';
      const span = document.createElement('span');
      span.textContent = `${k}:`;
      const b = document.createElement('b');
      b.textContent = val;
      row.append(span, b);
      return row;
    }));
    this.card.classList.remove('hidden');
  }
}
