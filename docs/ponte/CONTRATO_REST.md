# Contrato REST usado pela ponte — verificado ao vivo

> Verificado em **2026-11-10** contra a :8200 (WmsOfficeTheGame). A :8100 (WmsOffice) é um fork com as mesmas rotas e
> concepts; a única diferença conhecida é o `access.write` dos concepts WMS na :8200 (ADMIN ou WarehouseManager) — a
> ponte usa `admin` nos dois, então não muda nada. Reconferir na :8100 é a tarefa T1.9.
>
> **Prova executável:** [`backend/ponte/referencia/ciclo_rest_verificado.py`](../../backend/ponte/referencia/ciclo_rest_verificado.py).
> Os códigos `[R..]`, `[E..]`, `[H..]`, `[A..]`, `[T..]` abaixo são os do script. Rode-o antes de começar e sempre que
> desconfiar do servidor: `python3 backend/ponte/referencia/ciclo_rest_verificado.py` → `OK: 0 falha(s)`.

## 1. Autenticação

| | |
| --- | --- |
| Login | `POST /api/auth/login` `{"username","password"}` → `200 {"token": "..."}` |
| Uso | cabeçalho `Authorization: Bearer <token>`; `Content-Type: application/json` |
| Usuário atual | `GET /api/auth/me` → `{"username", ...}` |
| Dev (:8200) | `admin` / `Teste123!` (docs/NPDEV_LINUX.md). Jogador de teste: `teste-jogador-2` / `Jogo!Teste2026` |
| App sem admin | `POST /api/auth/bootstrap-admin` `{"username","displayName","password"}` (só funciona uma vez) |

## 2. CRUD de um concept

Caminho = nome do concept em *snake_case* + `s` (sem regra de plural do português): `Expedicao` → `expedicaos`,
`LocalArmazenagemLote` → `local_armazenagem_lotes`, `MovimentoItemPosicao` → `movimento_item_posicaos`. A tabela
completa está em [`backend/ponte/mapa.json`](../../backend/ponte/mapa.json) → `conceitos`.

| Operação | Chamada | Resposta |
| --- | --- | --- |
| Criar | `POST /api/<ep>` corpo com os campos (sem `id`) | `200` + registro completo com `id`, `version`, `tenantId` **[T1]** |
| Ler | `GET /api/<ep>/<id>` | `200` registro · `404` se não existe |
| Atualizar | `PUT /api/<ep>/<id>` corpo **parcial** — só os campos que mudam; o resto é mantido **[R06]** | `200` registro |
| Apagar | `DELETE /api/<ep>/<id>` | `204` · `404` se já não existe |
| PATCH | não existe | `405` **[T2]** |
| Erro de regra | invariant, transição de ciclo, referência | `422 {"code":"invariant_failed","invariant":"<nome>","message":...}` |
| Duplicar unique | ex.: par `(localArmazenagemId, loteId)` de `LocalArmazenagemLote` | `409 {"code":"unique_integrity_failed"}` |

## 3. Listar e filtrar — use SEMPRE `/page`

- `GET /api/<ep>` **ignora qualquer filtro** e corta em 1000 linhas sem avisar no corpo **[A2]**. Não use para buscar.
- `GET /api/concepts/<Concept>/page?<campo>=<valor>&...&offset=0&limit=1000`
  - `<Concept>` é o nome em PascalCase (`HistoricoMovimentacao`), não o endpoint.
  - Filtro de **igualdade**, um ou mais campos (verificado com dois: `localArmazenagemId` + `loteId`).
  - Resposta: `{"items": [...], "total": N, "hasMore": bool, "offset": n, "limit": n}`. `limit` máximo 1000; para mais,
    repita com `offset += len(items)` enquanto `hasMore`, **sempre com `sort=id&direction=asc`**: sem ordem estável as
    páginas por offset repetem ou pulam linhas (é o que o front faz em `src/net/leitura.ts` → `listarConceito`).
  - **Codifique a query** com `urllib.parse.urlencode` — um valor com espaço (`nome=WmsOffice: The Game`) faz o
    `urllib` lançar `InvalidURL`.
  - `datetime` vem no fuso do servidor (`2026-11-10T08:10:20-03:00`), enquanto o `GET` por id devolve em UTC
    (`2026-11-10T11:10:20Z`). **Compare instantes, nunca o texto.**
  - Para uma role que não lê o concept, responde `200` com lista **vazia** (não 403).

## 4. Flows

`POST /api/flows/<Nome>/execute` com o corpo de entrada → `200` sempre que o flow rodou; o resultado está no envelope:

```json
{ "status": "OK", "output": { ...registro ou resultado... }, "error": null, "errorCode": null, "flowName": "...", ... }
```

`status` pode ser `"FAILED"` (com `error`) — trate como erro mesmo com HTTP 200.

Os três flows de confirmação recebem o **registro inteiro com o novo estado**. Faça `GET` antes e mande
`{**registro, campo: novoEstado}` (é o que as telas do WmsOffice fazem; um corpo parcial também funcionou, mas não conte
com isso — o README do produto avisa que flows não aplicam defaults):

| Flow | Corpo | Efeito verificado |
| --- | --- | --- |
| `ConfirmarMovimentacao` | `{...movimento, "situacao": "Concluido"}` | Movimento → `Concluido` + 1 linha `Concluido` no histórico **[R11][E10]** |
| `ConfirmarRecebimento` | `{...recebimento, "estagio": "Armazenado"}` | exige `movimentoId`; → `Armazenado` + linha `Armazenado` **[R12]** |
| `ConfirmarSaidaExpedicao` | `{...expedicao, "estagio": "SaidaConfirmada"}` | exige `movimentoId`; → `SaidaConfirmada` + linha **[E11]** |

**Armadilha [A1]:** chamar um `Confirmar*` num registro que já está no estado terminal devolve `status: "OK"` e
**cria outra linha no histórico**. Sempre faça `GET` e só chame o flow se o estado atual for o anterior.

## 5. Ciclos de vida (só se anda um passo por vez)

| Concept | Campo | Caminho | Como se dá cada passo |
| --- | --- | --- | --- |
| `Recebimento` | `estagio` | `PreRecebimento → Enderecado → Conferido → Armazenado` | POST · PUT **[R06]** · PUT **[R07]** · flow **[R12]** |
| `Expedicao` | `estagio` | `PreExpedicao → DemandaGerada → MovimentacaoConcluida → SaidaConfirmada` | POST · PUT **[E04]** · PUT **[E07]** · flow **[E11]** |
| `Movimento` | `situacao` | `Pendente → Concluido` | POST · flow **[R11]** |

- Pular um estado → `422 status_transition_not_allowed` **[R06x]**. Voltar de um terminal → `422`.
- PUT para o **mesmo** estado é aceito (não conta como transição) — mais um motivo para conferir o estado antes.

## 6. Histórico (`HistoricoMovimentacao`)

- Ninguém grava o histórico na mão: ele nasce das transições. Linhas por **documento completo** (verificado):
  - Recebimento: `Enderecado`, `Conferido`, `Armazenado` (do Recebimento) + `Concluido` (do Movimento) = **4** **[H1]**
  - Expedição: `DemandaGerada`, `MovimentacaoConcluida`, `SaidaConfirmada` + `Concluido` = **4** **[H4]**
  - Movimento `MovtoLivre` confirmado: **1** (`Concluido`)
  - Todas com o `movimentoId` do Movimento do documento. (O INTEGRACAO §9 estimava 4 linhas no total do P0; o certo é 4
    **por documento**.)
- `ocorridoEm` e `descricao` vêm **nulos** **[H2]** e aceitam `PUT` **[H3]**. O `PUT` aceita `...Z` ou `...-03:00`
  (o servidor guarda o instante). É assim que a ponte devolve a hora do jogo ao corporativo.
- Buscar as linhas: `/api/concepts/HistoricoMovimentacao/page?movimentoId=<id>`.
- Apagar o Movimento apaga o histórico dele (`onDelete: cascade`).
- **Todo `PUT` num Recebimento ou numa Expedição grava mais uma linha de histórico** (no estágio atual: um `Armazenado`
  a mais por `PUT` de `crossDockingAtivo`; verificado em 2026-11-10 na :8100). Se o histórico tem de ficar como o dos
  `Confirmar*`, apague a linha que o seu `PUT` criou (é o que `executor._escrever_sem_historico` faz). O flow
  `AtivarCrossDocking`, que mexe nas mesmas flags por dentro, **não** grava linha.

## 6b. `CrossDocking` (verificado em 2026-11-10 na :8100)

- **Só se cria pelo flow** `POST /api/flows/AtivarCrossDocking/execute` com `{recebimentoId, expedicaoId, produtoId,
  quantidade, dataAtivacao}` (devolve `output.id`); `POST /api/cross_dockings` direto dá **500**. Funciona mesmo com o
  Recebimento/Expedição já em estado final.
- O flow, por dentro: cria a linha (`situacao: Ativo`), liga `crossDockingAtivo` nos dois documentos e **provisiona uma
  baia nova**: acha (ou cria) a Area `Cross-Docking` (`funcao: CrossDocking`) e a Rua `CD` **do primeiro armazém da
  Entidade** (`AllocationCapability.localizarBaiaCrossDocking`, não o do documento!) e cria nela um `LocalArmazenagem`
  (`posicao 1, andar 1, situacao Ocupado`) gravado em `baiaLocalArmazenagemId`. Com vários armazéns na mesma Entidade a
  baia cai no errado; a ponte a move (`PUT {ruaId, posicao}` no local) e apaga a Rua/Area que sobraram vazias.
- **Não há flow de concluir/cancelar** (só as procedures `ConcluirCrossDockingProcedure`/`Cancelar…`, sem rota): `PUT
  /api/cross_dockings/{id} {situacao: Concluido}` funciona, mas **não** desliga as flags; a ponte faz isso por `PUT` nos
  dois documentos (e apaga a linha de histórico que o `PUT` deles cria, §6).
- Apagar: a linha de `CrossDocking` antes da baia, do Recebimento e da Expedição (`onDelete: restrict`).

## 7. Ocupação e situação dos locais — nada é automático por REST

- Gravar `MovimentoItemPosicao` por REST **não** muda `LocalArmazenagemLote` nem `LocalArmazenagem.situacao`.
  (A recomputação `RecomputarOcupacaoOnCommitProcedure` só roda no *commit de agregado* das telas, que a ponte não usa.)
- `LocalArmazenagemLote` tem unique `(localArmazenagemId, loteId)`: procure o par com `/page` (dois filtros) e faça
  `PUT {quantidade}`; se não existir, `POST`. Quantidade 0 é válida (a linha fica) **[E08]**; negativa → 422.
- O **Mapa do Armazém** (`web/mapa-armazem.html`) pinta cada posição pelo campo `LocalArmazenagem.situacao`
  (`Disponivel`/`Ocupado`/`Reservado`/`Bloqueado`), não pela tabela de ocupação **[R10][E09]**. A ponte precisa gravar
  os dois.

## 8. Ordem de criação e de remoção (integridade referencial)

Criar: `Entidade → Armazem → Area → Rua → LocalArmazenagem`, `PerfilAlocacao → RankingRua`, `Produto`,
`Lote → Movimento → MovimentoItem → Recebimento/Expedicao → RecebimentoLote/ExpedicaoItem → MovimentoItemPosicao`,
`LocalArmazenagemLote` por último.

Apagar = **ordem inversa da criação** (o diário da ponte guarda exatamente essa ordem). Pontos que travam (`restrict`):
`Recebimento/Expedicao.movimentoId` (apague o documento antes do Movimento), `Lote` (antes, apague
`LocalArmazenagemLote`, `MovimentoItem`, `MovimentoItemPosicao`), `Produto`, `Entidade`, `LocalArmazenagem` (usado por
posições). `cascade`: `MovimentoItem`/`MovimentoItemPosicao`/`HistoricoMovimentacao` saem com o Movimento;
`RecebimentoLote` com o Recebimento; `ExpedicaoItem` com a Expedição; `LocalArmazenagemLote` com o Local.

## 9. Do lado do jogo (:8200)

| | |
| --- | --- |
| Cenários | `GET /api/queries/CenariosAtivos` · `GET /api/sim_cenarios/<id>` |
| Ordens | `GET /api/queries/OrdensPorCenario?cenarioId=<id>` ou `/api/concepts/SimOrdem/page?cenarioId=<id>` |
| Partida | `GET /api/sim_partidas/<id>` (`politica` = política INICIAL, `jogador`, `situacao`) |
| Score | `/api/concepts/SimScore/page?partidaId=<id>` → `scoreCentesimos`, `validadoServidor` |
| Topologia | `/page` de `Area?armazemId=`, `Rua?areaId=`, `LocalArmazenagem?ruaId=`, `RankingRua?ruaId=` (como `src/net/pacote.ts`) |
| Gerar ordens | flow `GerarOrdensSimulacao` `{seed, inicioTurnoSeg, fimTurnoSeg, qtdOrdens, produtos:[{produtoId, peso}], slaMinSeg, slaMaxSeg, paletesMin, paletesMax}` → `output = {sucesso, ordens:[{numero, tipo, liberacaoSeg, slaSeg, produtoId, quantidadePaletes}]}` — **não grava** nada |
| Seeds | `POST /api/admin/seeds/<id>/run` (não idempotente: use `backend/npdev/tools/semear_cenarios.py`) |

## 9b. `SimEvento.tSeg` — o nome do campo muda entre escrita e leitura (verificado em 2026-11-10)

`POST`/`PUT`/`GET por id` usam **`tseg`** (o Jackson baixa a 1ª maiúscula de `getTSeg`; mandar `tSeg` dá `422 required field
tSeg is missing`), mas `/api/concepts/SimEvento/page` devolve **`tSeg`**. Escreva `tseg`, leia `tSeg ?? tseg`
(`src/net/rastro.ts`, `backend/ponte/fonte.py → _tseg`). Renomear o campo no `model.json` foi tentado e a migração recusa
(`DROP COLUMN`). Mesma esquisitice pode valer para qualquer campo futuro que comece com uma letra minúscula solta + maiúscula.

## 10. Limites do NPDev que afetam a ponte (de docs/NPDEV_LINUX.md)

- Capabilities Java **não podem** abrir conexão de rede (`java.net` barrado pelo gate de bytecode). O servidor do jogo
  não consegue chamar o corporativo, por isso a ponte é um processo Python à parte (decisões D5 e D8 do PLANO).
- Procedures não são transacionais e seeds não são idempotentes. A ponte se protege com o diário (PLANO §6.3).
- Um campo novo `required` do tipo `reference` numa tabela que já existe faz o boot recusar (mesmo vazia).
