// Calcula a distância teórica de cada pacote de cenário (src/data/cenarios/*.json ou um dir temporário com o mesmo
// formato) usando o PRÓPRIO motor do front — a conta depende da malha de corredores e da curva ABC, e não existe em
// Java. Chamado por gerar_seeds_cenarios.py, que grava o resultado em SimCenario.distanciaTeoricaCm (o ConcluirPartida
// usa esse valor no lugar do que o cliente envia).
//
// Uso (da raiz do repo): npx vite-node backend/npdev/tools/teorica_cenarios.ts <pacote.json>...
// Saída (stdout, uma linha): {"<codigo do cenario>": <cm>, ...}
import { readFileSync } from 'node:fs';
import type { PacoteCenario } from '../../../src/sim/model';
import { Simulacao } from '../../../src/sim/simulation';

const saida: Record<string, number> = {};
for (const arquivo of process.argv.slice(2)) {
  const pacote = JSON.parse(readFileSync(arquivo, 'utf8')) as PacoteCenario;
  // A teórica não depende da política (só de layout, malha e curva ABC); qualquer uma serve.
  saida[pacote.cenario.codigo] = new Simulacao(pacote, 'AbcProximidade').distanciaTeoricaCm;
}
process.stdout.write(JSON.stringify(saida) + '\n');
