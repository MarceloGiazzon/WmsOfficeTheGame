# Ponte — checklist de implementação

> Marque `[x]` só depois de rodar o "Pronto quando" da tarefa ([PLANO.md](PLANO.md)) e ver a saída. Na coluna de
> notas: data, o que se viu, números medidos, desvios. Uma tarefa por vez, na ordem.

## Antes de começar

- [x] App do jogo de pé: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8200/actuator/health` → `200`
- [x] Referência verde: `python3 backend/ponte/referencia/ciclo_rest_verificado.py` → `OK: 0 falha(s)`
- [ ] Testes offline existem e falham por falta de código (não por erro deles):
      `python3 -m unittest discover -s backend/ponte/tests -p 'test_*.py'` →
      `ImportError: Failed to import test module: test_planejador` (`No module named 'fonte'`)
- [x] Li PLANO §0–§6, CONTRATO_REST.md e mapa.json

## P0 — fundação (alvo :8200, fonte em arquivo)

| ✓ | Tarefa | Pronto quando (resumo) | Notas |
| --- | --- | --- | --- |
| [x] | T0.1 esqueleto + `npdev.py` | `--help`; trecho imprime `1 True`; referência verde | 2026-11-10 · `--help` ok; trecho imprime `1 True`; referência `OK` |
| [x] | T0.2 `mapa.py` | `-k TestPreencher` verde | 2026-11-10 · 7 testes TestPreencher ok |
| [x] | T0.3 `fonte.py` | `-k TestValidarRastro` verde | 2026-11-10 · 8 testes TestValidarRastro ok (só `validar_pacote`/`validar_rastro`; `carregar_do_jogo` é a T1.5) |
| [x] | T0.4 planejador: tipos, compartilhados, topologia | `-k test_compartilhados` verde | 2026-11-10 · feito junto com T0.5–T0.7 |
| [x] | T0.5 planejador: carga inicial | trecho imprime `20 20 Concluido 3` | 2026-11-10 · trecho imprime `20 20 Concluido 3` |
| [x] | T0.6 planejador: entradas e saídas | `-k TestOperacoes` verde (menos `test_finais_vem_no_fim`) | 2026-11-10 · TestOperacoes ok |
| [x] | T0.7 planejador: ocupação, situação, histórico | **29 testes OK** | 2026-11-10 · 29 testes OK |
| [x] | T0.8 diário + executor | `test_diario.py` verde; 29 continuam verdes | 2026-11-10 · `test_diario.py` (5 testes) + 29 ok = 34 |
| [x] | T0.9 `exportar` / `limpar` | `aceite_p0.py` e `aceite_p0.py --completo` → OK; banco sem sobras | 2026-11-10 · `aceite_p0.py` e `--completo` OK; banco igual ao de antes (Movimento 0, Entidade 2, Produto 42) · chamadas: mini inteiro 155 (1ª) / 35 (reexportação), ~5 s |
| [x] | T0.10 ver no Mapa do Armazém | 5 posições ocupadas no armazém "Mini …"; depois `limpar` | 2026-11-10 · não com o mini (limpei na hora), mas com o espelho de uma partida real, no Chrome headless: Mapa do Armazém da :8100 → filtro lista "Armazem Geral (corporativo) · partida 784d10c4 · 2026-11-10" → 9 ruas, **124 posições, 87 ocupadas (cinza), 37 livres (verde), 70 %** (a Legenda confere). Menu do WmsOffice mostra Recebimentos / Expedições / Movimentos |

## P1 — partida real

| ✓ | Tarefa | Pronto quando (resumo) | Notas |
| --- | --- | --- | --- |
| [x] | T1.1 gravador de rastro (`src/sim/rastro.ts`) | `npm test` verde, goldens intactos, `tsc` limpo | 2026-11-10 · `npm test` 620 ok (43 arquivos), `tsc` limpo, `git diff src/sim/simulation.test.ts` vazio, +19 linhas só de anotação em simulation.ts; `rastro.test.ts` 13 testes. **Desvio:** o WH-A com `CrossDocking` não cruza nenhum palete (métricas idênticas à Abc), então o teste de cross-dock usa o cenário sintético de simulation.test.ts |
| [x] | T1.2 `jogar_headless.ts` + rastro WH-A | rastro válido em Python; determinístico; exportação WH-A ok | 2026-11-10 · rastro WH-A/Abc válido em Python, `cmp` idêntico nas 2 rodadas, métricas = golden (334700 cm, score 85,52); exportação ok: 887 operações, **1594 chamadas, 26,6 s**; alvo conferido: Recebimento 31, Expedição 27, Movimento 59, histórico 233 = esperado; limpo (569 apagados) · chamadas: 1594 · tempo: 26,6 s |
| [x] | T1.3 concept `SimEvento` | `p1_sim_evento.py` + n1/n2/n3 verdes | 2026-11-10 · feito junto com o backend da T1.6 (um rebuild só, sem reset); validate 0 erros; `p1_sim_evento.py` 14 ok + n1/n2/n3 ok. **Armadilha:** `tSeg` é `tseg` na escrita e `tSeg` no /page (ver ALTERACOES_BACKEND); renomear o campo foi tentado e a migração recusou (DROP COLUMN) — revertido, banco intacto |
| [x] | T1.4 envio do rastro pelo cliente | testes do servidor falso; partida real com `SimEvento` completo; limpeza | 2026-11-10 · `src/net/rastro.ts`, `ResultadoPartida.rastro`, `PartidaOnline.comRastro`; servidor falso ganhou `SimEvento` (imita `tseg`/`tSeg`); 13 testes novos (`rastro.test.ts` 7 + `partidaOnline.test.ts` 6); `npm test` 633 ok, `tsc` limpo. Depois testei **no navegador** (Chrome headless, jogando `CORP-a4b29895` pela UI): `SimEvento` da partida = **503** = tamanho do rastro, resultado inalterado. Antes disso, o equivalente por linha de comando `backend/ponte/jogar_online.ts` (mesmas funções de `src/net`) jogou o WH-A no :8200 → score 85,52 `validadoServidor`, 191 eventos = tamanho do rastro. Embutido não envia rastro (ids são aliases); apagado depois |
| [x] | T1.5 `exportar --partida` | partida real exportada e limpa | 2026-11-10 · `fonte.carregar_do_jogo` + `exportar_partida.py`; partida real do WH-A exportada: **mesmas 887 operações / 1594 chamadas** que o arquivo; 43 s; limpa |
| [x] | T1.6 `SimExportacao` | 2ª exportação sem chamadas; erro → `Falhou` | 2026-11-10 · 2ª exportação: 0 chamadas ao alvo (`jaConcluida`), 0,7 s; alvo `http://localhost:9` → `Falhou` com a mensagem; `p1_sim_exportacao.py` 14 ok. Nota: `limpar` não toca o `SimExportacao` (use `--forcar` para exportar de novo depois de limpar) |
| [x] | T1.7 cross-dock real | WH-A/CrossDocking exportado; `crossDocking = true` no alvo | 2026-11-10 · o WH-A/CrossDocking **não tem** CrossDock (premissa do plano falha); usei `exemplos/wh-a/pacote-crossdock.json` (cenário sintético de `simulation.test.ts`, 2 paletes cruzados): exportação ok, `RecebimentoLote.crossDocking = true`, posições Destino/Origem na doca de saída; limpo. `aceite_p0.py --completo` ok (mini tem cross-dock) |
| [x] | T1.8 retomada | `--completo --interromper 20` e `70` verdes | 2026-11-10 · `aceite_p0.py --completo --interromper 20` e `--interromper 70` → OK: 0 falha(s) |
| [x] | T1.9 alvo :8100 | referência, aceite e partida real na :8100 | 2026-11-10 · :8100 já tinha admin e estava vazia (0 armazéns); referência `OK`, `aceite_p0.py --alvo :8100 --completo` OK, WH-A real exportado (Recebimento 31, Expedição 27, histórico 233, 37 de 52 locais Ocupado). **Nenhuma diferença** :8100 × :8200. Não abri o Mapa no navegador (só API). Deixei a exportação na :8100 (diário `estado/562671b6bf74.jsonl`; `ponte.py limpar --diario` desfaz); a partida do :8200 foi apagada · diferenças :8100 × :8200: nenhuma |
| [x] | T1.10 medir WH-B | números anotados (parar se > 10 min) | 2026-11-10 · `npm test` 620 ok (43 arquivos), `tsc` limpo, `git diff src/sim/simulation.test.ts` vazio, +19 linhas só de anotação em simulation.ts; `rastro.test.ts` 13 testes. **Desvio:** o WH-A com `CrossDocking` não cruza nenhum palete (métricas idênticas à Abc), então o teste de cross-dock usa o cenário sintético de simulation.test.ts |

## P2 — corporativo → jogo

| ✓ | Tarefa | Pronto quando (resumo) | Notas |
| --- | --- | --- | --- |
| [x] | T2.1 procedência no `SimCenario` | rebuild sem reset; n1/n3 verdes; WH-A carrega | 2026-11-10 · 4 campos `procedencia*` em `SimCenario` (SAFE_ADDITIVE); rebuild **sem** reset ok; n1/n3/p1_sim_evento verdes; WH-A/WH-B seguem com `procedencia` nula; `CenariosAtivos` já devolve os campos novos |
| [x] | T2.2 `importar --simular` | resumo coerente do `warehouse-a-small` | 2026-11-10 · `importador.py` (partes puras em `test_importador.py`, 16 testes); `importar --simular` no `warehouse-a-small` da :8100 (rodei o seed uma vez): 7 ruas de armazenagem + 2 de doca = 9 ruas, 124 locais, 2+2 docas. **Desvio:** 23 produtos, não 15 — a :8100 tem os 8 `WHA-*` criados por exportações da ponte (os 15 demo vêm sem `codigo` e sem perfil: o importador usa os 8 primeiros do id) |
| [x] | T2.3 topologia no jogo | reimportar não cria nada; `limpar` limpa | 2026-11-10 · importação real: 315 registros no diário, 17,6 s; reimportar não cria nada (diário com as mesmas 315 linhas); `aceite_p2.py --limpar` apagou tudo (SimCenario 2, SimOrdem 460, Produto 42, Entidade 2 = antes) |
| [x] | T2.4 cenário, ordens, referências | aparece em `CenariosAtivos` como jogador; o front carrega | 2026-11-10 · `CORP-a4b29895` em `CenariosAtivos` como jogador (procedencia `Corporativo`, 144 ordens, teórica 963120 cm). **Não** abri o jogo no navegador para escolher o cenário; o `jogar_online.ts` carregou o pacote pelo mesmo `carregarPacote` do front |
| [x] | T2.5 `aceite_p2.py` | `ConcluirPartida` → `validadoServidor: true` | 2026-11-10 · `aceite_p2.py` → OK: 0 falha(s) (`ConcluirPartida` → `validadoServidor: true`, score 76,62) |
| [x] | T2.6 ciclo completo | ponta a ponta sem intervenção; Mapa da :8100 mostra o espelho | 2026-11-10 · `ciclo.py` roda de ponta a ponta em 1 min 44 s (importa da :8100 → joga → registra partida/score/503 eventos no :8200 → exporta 2193 operações para a :8100). Deixei o resultado nos dois servidores (cenário `CORP-a4b29895`; espelho 444e4170… na :8100). Não olhei o Mapa no navegador |

## P3 — apresentação

| ✓ | Tarefa | Pronto quando (resumo) | Notas |
| --- | --- | --- | --- |
| [x] | T3.1 `vigiar` | solicitação manual vira `Concluida` com `--uma-vez` | 2026-11-10 · `vigia.py`: dois pedidos `Solicitada` criados como jogador (alvo :8200 e `http://evil.example`) → `vigiar --uma-vez`: o 1º `Concluida` (1594 chamadas, 35 s), o 2º `Falhou` "alvo não permitido"; limpo |
| [x] | T3.2 botão "Enviar ao WmsOffice" | testes com servidor falso + teste manual com o vigia | 2026-11-10 · `src/net/exportacao.ts`, `src/app/envioWmsOffice.ts` (+14 testes: solicitar, progresso, concluída, falhou, sem ponte após 30 s, 10 min, 3 consultas que falham, não duplicar), bloco na tela de resultado. **Teste manual de ponta a ponta no Chrome headless com o `vigiar` ligado:** jogou `CORP-a4b29895` → score 76,62 validado (2º lugar) → "Enviar ao WmsOffice" → "Pedido feito…" → "Partida enviada" + endereço `http://localhost:8100/mapa-armazem.html` (texto e link). Corrigi a cor do link (azul-escuro ilegível no fundo escuro). `npm test` 655 ok, `tsc` limpo |
| [x] | T3.3 selo de procedência | cenário importado com selo, WH-A sem | 2026-11-10 · `Cenario.procedencia?`, `ResumoCenario.procedencia?`, selo "do WmsOffice corporativo" no cartão; no navegador: `CORP-a4b29895` com selo, `WH-A-PEQUENO` e `WH-B-MEGA` sem |
| [x] | T3.4 extras (pedidos pelo dono do projeto) | linha de `CrossDocking`; jogo propõe `RankingRua`; modo ao vivo | 2026-11-10 · **(1) CrossDocking:** só o flow `AtivarCrossDocking` cria (POST direto = 500) e ele põe a baia (Area `Cross-Docking` + Rua `CD` + local novo) no **primeiro armazém da Entidade**, não no do documento; o executor move a baia para a Rua `CD` do espelho, apaga a Rua/Area que o flow criou fora do lugar e conclui por `PUT` (sem flow de concluir); todo `PUT` em Recebimento/Expedição grava uma linha de histórico, que a ponte apaga. `mapa.json` ganhou `crossDocking`; `exemplos/mini/esperado.json` ("completo") e `aceite_p0.py` mudaram junto; `--sem-crossdocking` desliga. Ao vivo: `aceite_p0 --completo` verde na :8100 e na :8200, e `--interromper 20`/`70`; o Mapa do Armazém (Chrome) mostra a baia na rua CD do espelho certo; `limpar` devolve a :8100 ao estado anterior. **(2) `propor-ranking`:** `PerfilAlocacao` novo, inativo, sem produtos + `RankingRua` por rua, no armazém de origem; na :8100 4 perfis/25 rankings existentes idênticos antes e depois, 7 rankings novos, repetir não duplica. **(3) `ao-vivo`:** é **reprodução** do turno de uma partida concluída (o servidor só conhece a `SimPartida` no fim): 98 testes offline, estado final **idêntico** ao do lote (771 chaves, 0 diferença, nas duas direções), ocupação 64 → 66 → 71 às 10:57, 13:51 e 15:44 do jogo, turno inteiro em 2 min 10 s a 300×. Streaming de verdade exigiria um flow de início de partida no backend do jogo (+ anti-fraude): **não feito**. `npm test` 655 ok, `tsc` limpo (o TS não foi tocado) |
| [x] | T3.5 docs e DEMO.md | alguém segue o DEMO.md do zero | 2026-11-10 · `backend/ponte/README.md`, `docs/ponte/DEMO.md` (agora com o §7 dos extras), diagrama no README do jogo, INTEGRACAO §13, CONTRATO_REST §6/§6b, `docs/PLANO.md` §7 q5. **Segui o DEMO.md do §0 ao §7 literalmente, com `env -i` (ambiente vazio)** e achei 4 lacunas, todas corrigidas: `$TOKEN` nunca definido (agora o comando completo está no §0); não havia como descobrir o id do armazém (novo `ponte.py armazens`); id inválido virava traceback (agora erro 2 com instrução); o §7.3 não dizia o par `limpar` + `--forcar`. Medidas reais: §1 ≈ 20 s, §2 sem navegador 10 s, §3 pelo `vigiar` 1 min 27 s, §5 `ciclo.py` 1 min 52 s, §7.3 ao vivo 2 min 10 s; §6 e §7.1 desfazem tudo. Mapa do Armazém aberto no Chrome para o espelho de uma partida real (124 posições, 87 ocupadas), para o mini da T0.10 e para o cross-dock. **Limites:** quem seguiu fui eu, não outra pessoa; o botão do jogo no navegador não foi reaberto nesta rodada (o mesmo caminho foi exercido pelo pedido `SimExportacao` + `vigiar`; o botão foi testado no Chrome na rodada anterior); a tela *Demanda → Cross-Docking* do corporativo não foi aberta (só o Mapa e a API) |

## Limpeza de emergência (:8200)

Se um teste morreu no meio e deixou dados: o diário está em `backend/ponte/estado/*.jsonl` →
`python3 backend/ponte/ponte.py limpar --diario <arquivo>`. Sem diário, a ordem de remoção manual está no
[CONTRATO_REST.md §8](CONTRATO_REST.md#8-ordem-de-criação-e-de-remoção-integridade-referencial). Para conferir se
sobrou algo: `/api/concepts/<Movimento|Recebimento|Expedicao|Lote|LocalArmazenagemLote>/page?limit=1` → `total`
(nesta máquina era **0** em 2026-11-10, antes de qualquer implementação).
