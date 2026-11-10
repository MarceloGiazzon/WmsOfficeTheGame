# WmsOfficeTheGame — app NPDev (backend do jogo)

Definição NPDev do backend de **WmsOffice: The Game**. Gerada/executada com o NPDev
(`~/repos/NPDev/NPDev_General`); como construir e rodar: [docs/NPDEV_LINUX.md](../../docs/NPDEV_LINUX.md).

| | |
| --- | --- |
| App id | `wmsofficethegame` |
| Porta | **8200** (o produto WmsOffice usa 8100) |
| Banco | H2 local `npdev_wmsofficethegame` |
| Namespace | `wmsofficethegame.core` |

## Origem: fork do WmsOffice

Este diretório começou como **cópia** de `~/repos/NPDev/AppGen/apps/_official/WmsOffice`
(`definition/` + `web/`) em **2026-11-10**. O WmsOffice é um produto real e independente: ele não é alterado
pelo jogo, e mudanças nele **não** chegam aqui automaticamente.

Alterações em relação à cópia original:

- `config.json`: `scenario.name` → `wmsofficethegame`, porta 8200, descrição, `$schema` relativo a este repo.
- `db.definition.json`: banco `npdev_wmsofficethegame`.
- `model.json`: `namespace` → `wmsofficethegame.core`, `logoText` → "WmsOffice: The Game", `$schema`.
- `untrusted-extension-manifest.json`: `scenarioId` → `wmsofficethegame`. O manifesto já vem consolidado no formato
  exigido pelo generator atual (o antigo `trusted-source-manifest.json` não existe aqui).

Mantidos como estavam (proveniência, sem efeito funcional): pacotes Java `com.wmsoffice.capabilities.*`,
o profile Spring `wmsoffice` (configura JWT; chaves em `./wmsoffice-keys`), `parity.json` e as descrições
que citam o ledger `WMS-*`.

O histórico de fases, decisões e limitações do NPDev descobertas ao construir o WmsOffice está no README do
produto: `~/repos/NPDev/AppGen/apps/_official/WmsOffice/README.md`.

## Específico do jogo

Concepts `Sim*`, capability `simulacao`, role `JOGADOR` e seeds de cenários — ver fases N1–N5 em
[docs/PLANO.md](../../docs/PLANO.md).

| Fase | O que entrou | Verificação |
| --- | --- | --- |
| N1 | `SimCenario`, `SimOrdem`, `SimPartida` (lifecycle), `SimScore` — REST em `/api/sim_cenarios`, `/api/sim_ordems`, `/api/sim_partidas`, `/api/sim_scores` | `python3 backend/npdev/tests/n1_sim_concepts.py` (app de pé na 8200) |
| N2 | Capability `simulacao` (`calcularScore`, `validarScore`, `gerarOrdens`); flows `CalcularScoreSimulacao`, `ConcluirPartida`, `GerarOrdensSimulacao`, `SugerirDestinoJogo` | `python3 backend/npdev/tests/n2_simulacao_capability.py` (offline) e `n2_simulacao_flows.py` (ao vivo) |
| N3 | Role `Jogador` + regras por linha (`access`) em `SimPartida`/`SimScore`/WMS; queries `CenariosAtivos`, `OrdensPorCenario`, `RankingPorCenario`; flow `AbandonarPartida`; seeds `cenario-wh-a-pequeno` e `cenario-wh-b-mega` (`tools/gerar_seeds_cenarios.py`, `tools/semear_cenarios.py`) | `n3_jogador.py` (ao vivo) |
| N5 | O front do jogo é servido pelo próprio app em `web/jogo/` (mesma origem que `/api`, sem CORS); `npm run deploy:npdev` compila para lá e o `rebuild.sh` leva o jogo junto | `curl -I http://localhost:8200/jogo/index.html` (200) |

Ao mudar os seeds dos cenários, o layout, as ordens ou `src/sim/teorica.ts`, na raiz do repo:

```sh
python3 backend/npdev/tools/gerar_seeds_cenarios.py   # seeds (grava SimCenario.qtdOrdens e distanciaTeoricaCm; precisa de node_modules)
python3 backend/npdev/tools/gerar_pacotes_front.py    # pacotes offline do front em src/data/cenarios/
python3 backend/npdev/tools/semear_cenarios.py        # app de pé: semeia o que falta e atualiza as referências dos cenários já semeados
npx vitest run src/sim/teoricaSeeds.test.ts           # seed × motor do front
```

**Anti-fraude do ranking.** `ConcluirPartida` não aceita do cliente as referências do cenário: confere `ordensTotal`
contra `SimCenario.qtdOrdens`, `distanciaTeoricaCm` contra `SimCenario.distanciaTeoricaCm` e exige distância real ≥ metade
da teórica; recusa (sem gravar nada) o que não bate, e cenário sem esses campos não aceita partidas. O ranking só junta
scores da mesma `versaoMotor` (`RankingPorCenario?cenarioId=&versaoMotor=`). Isso **não prova** distância real, atrasos,
conflitos nem ocupação — só um replay no servidor provaria; ver [docs/PLANO.md](../../docs/PLANO.md) (N2, anti-fraude).

Regenerar + compilar + subir (preserva as chaves JWT): `backend/npdev/rebuild.sh` (`--reset-db` para banco novo
com admin e cenários; `--sem-jogo` para não recompilar o front).

## O jogo em `web/jogo/` (N5)

`web/jogo/` **não é versionado** (`.gitignore`): é a saída do build do front, gerada por, a partir da raiz do repo:

```sh
npm run deploy:npdev          # tsc + vite build --base=/jogo/ → backend/npdev/web/jogo/ (esvaziada antes)
backend/npdev/rebuild.sh      # roda o deploy acima, gera, compila e sobe; confere /jogo/index.html → 200
# → http://localhost:8200/jogo/index.html
```

O NPDev copia `web/` (recursivamente) para os estáticos do app a cada geração e apaga o que não vem de lá — por isso o
deploy vem **antes** da geração, e é o `rebuild.sh` quem garante isso. Os estáticos não pedem login; o jogo autentica com
`fetch('/api/auth/login')` na mesma origem. Limitação: `/jogo/` (sem `index.html`) dá 404 — ver
[docs/NPDEV_LINUX.md](../../docs/NPDEV_LINUX.md#jogo-em-8200jogo-n5). O diretório `web/` também guarda as páginas
originais do WmsOffice (`mapa-armazem.html` etc.); o deploy só mexe em `web/jogo/`.

Diferenças de segurança em relação ao WmsOffice original: todos os concepts do WMS ganharam `access.write`
(`ADMIN || WarehouseManager`) e a role `WarehouseManager` passou a listar todos eles — ver N3 em
[docs/PLANO.md](../../docs/PLANO.md).
