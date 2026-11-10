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
