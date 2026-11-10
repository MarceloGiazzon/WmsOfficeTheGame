# WmsOffice: The Game — Plano de implementação

> Data: 2026-11-09 · Status: proposta
> Escopo: alterações no app WmsOffice (NPDev) + construção do cliente do jogo (Vite/TS/Canvas).

---

## 0. Ponto de partida (levantamento)

### 0.1 O que já existe no NPDev (`~/repos/NPDev`)

| Item | Local | Estado |
| --- | --- | --- |
| Definição do app WmsOffice | `AppGen/apps/_official/WmsOffice/definition/` | 26 concepts, 11 flows, 12 queries, 28 procedures, 11 panels, 3 capabilities Java |
| App gerado (Spring Boot) | `Build/generated-finalapps/wmsoffice/App` | Build de 2026-09-29 (`passed`), porta **8100**, H2 |
| Capability de alocação | `definition/capabilities/alocacao/.../AllocationCapability.java` (1086 linhas) | `sugerirDestino`, `sugerirOrigem`, `alocarRecebimento`, `ruasElegiveis`, `enderecarRecebimento`, `candidatosCrossDocking`, … |
| Mapa do armazém (web) | `web/mapa-armazem.html` | Grid por rua (posição × andar) colorido por `situacao` |
| Auth | Identity pack + JWT (`/api/auth/login`, `/api/auth/bootstrap-admin`) | Roles ADMIN/USER funcionando |

Concepts relevantes para o jogo: `Armazem`, `Area`, `Rua` (`qtdPosicoes`, `qtdAndares`, bloqueios), `LocalArmazenagem`
(`posicao`, `andar`, `situacao`), `Produto`, `Lote`, `LocalArmazenagemLote` (ocupação), `PerfilAlocacao`,
`RankingRua` (prioridade de rua por perfil), `Movimento`, `Recebimento`, `Expedicao`, `CrossDocking`.

REST gerado: `/api/<concept_snake>s` (ex.: `/api/local_armazenagems`), flows em `/api/flows/<Nome>/execute`,
header `Authorization: Bearer <jwt>`.

### 0.2 Restrições do NPDev que afetam o desenho

1. **Sem tipo decimal** — apenas `integer`/`long`. Distâncias, velocidades e score usam inteiros escalados.
2. **Procedures não filtram** (`listConcepts`/`runQuery` ignoram `where`) e **capabilities não recebem `ConceptRecord`**.
   Padrão comprovado: o chamador envia os dados no corpo → flow → `capabilityCall` → Java puro.
   *(Verificar se isso mudou — o modelo já tem 28 procedures e o kernel evoluiu desde a Phase 5.)*
3. **Todo flow precisa declarar um `concept`**, mesmo que só envolva uma capability.
4. **Invariants sem parênteses** — escrever em DNF.
5. **Unique composto** não é suportado no generator (workaround via flow + `verificarUnicidade`).
6. **Integridade referencial só em engine física** (H2Server/Postgres), não InMemory.

### 0.3 O que existe no jogo (este repo)

- Protótipo visual em Canvas (layout aleatório, empilhadeiras em rota fixa, heatmap, inspeção).
- **Sem simulação real**: não há ordens, putaway, SLA nem score.
- `NPDevClient` aponta para `:8080` (errado) e devolve sucesso falso quando offline.
- `node_modules/` commitado, sem `.gitignore`; `setup.sh`/`setup_frontend.py` duplicam `src/`.
- README §5 propõe "criar" `Armazem`/`Rua`/… — **já existem**; usa campos `decimal` (não suportados);
  §6.2 tem erro aritmético (Estratégia B dá 102,45, não 98,4) e o score pode passar de 100.

---

## 1. Decisões de arquitetura

### D1. O motor da simulação roda no cliente (TypeScript, determinístico)

- Loop de ticks, filas, rotas, conflitos e cálculo de métricas em `src/sim/`, sem DOM, com PRNG por seed.
- Motivos: 60 FPS sem rede, velocidade 5x, **modo offline** exigido pela Etapa 4 (APK).
- REST por tick é descartado.

### D2. O NPDev é a fonte de dados, regras canônicas e placar

- Fornece cenários (topologia + ordens), recebe o resultado da partida, valida e persiste score/ranking.
- Política **"WmsOffice Real"**: o cliente pede ao backend o destino via `AllocationCapability` (por lote de
  recebimento, não por tick). Online-only; offline cai para o port TS.

### D3. As regras de alocação são portadas para TS, com o Java como referência

- `sugerirDestino` / `sugerirOrigem` / `ruasElegiveis` viram funções TS puras.
- **Testes de paridade**: o mesmo JSON de entrada roda contra o Java (via flow) e contra o TS; saída deve ser igual.

### D4. O backend do jogo é um app NPDev próprio: WmsOfficeTheGame

- **O WmsOffice é um produto real e independente — o jogo não o altera.** (Decidido em 2026-11-10.)
- A definição NPDev do jogo vive **neste repositório**, em [`backend/npdev/`](../backend/npdev/) (versionada junto
  com o front). Ela nasceu como cópia do WmsOffice (snapshot 2026-11-10) — ver [`backend/npdev/README.md`](../backend/npdev/README.md).
- Novos concepts com prefixo `Sim*` e role própria (`JOGADOR`).
- Topologia do cenário **reaproveita** `Armazem/Area/Rua/LocalArmazenagem` (um `Armazem` por cenário),
  para que o mapa e as capabilities copiadas funcionem sem adaptação.
- Mudanças futuras do WmsOffice **não** chegam automaticamente ao jogo; trazer algo do produto é uma decisão explícita.

### D5. Mesma origem em produção

- O generator monta `web/` como estáticos do app. O build do Vite vai para `web/jogo/` → servido em
  `http://localhost:8200/jogo/`, sem CORS. Em dev, proxy do Vite `/api → :8200`.
- Porta **8200** para o jogo (o WmsOffice usa 8100; os dois podem rodar lado a lado).

### D6. Inteiros escalados (convenção única)

| Grandeza | Unidade armazenada |
| --- | --- |
| Distância | centímetros (`long`) |
| Velocidade | cm/s (`integer`) |
| Tempo simulado | segundos desde 00:00 (`integer`) |
| Percentuais / score | centésimos (`integer`, 0–10000) |

---

## 2. Correções no documento do jogo (README)

- §5: trocar "criar `Armazem.json`…" por "reaproveita os concepts do WmsOffice"; renomear novos concepts para `Sim*`;
  trocar `decimal` por inteiros escalados (D6).
- ~~§6~~ ✅ (2026-11-10): score final = `min(100, max(0, 100 − (P_dist + P_atraso + P_conflito)) + B_ocup)`;
  tabela 6.2 com Estratégia B → 100,0 (números de exemplo mantidos).
- §2: app NPDev próprio na porta 8200 (D4/D5), JWT, motor no cliente (D1/D2).
- §7: substituir o roadmap pelo deste plano.

---

## 3. Fases — Backend (NPDev / WmsOffice)

### N0. Ambiente Linux + baseline (pré-requisito) ✅ (2026-11-10)

Runbook completo e armadilhas: [NPDEV_LINUX.md](NPDEV_LINUX.md).

- [x] Paths: não foi preciso editar o `config.json` — `Build-NpdevApp.ps1` (REG-144) já reescreve os caminhos no staging; basta `-BuildRoot`.
- [x] Jars e runtime do generator recompilados do código atual (`npdev setup --build-local` + `prepare-npdev-generator-runtime.ps1`, corrigido para Linux).
- [x] Manifesto de extensões migrado para `untrusted-extension-manifest.json` (exigido pelo generator atual).
- [x] Chaves JWT geradas para Linux.
- [x] Geração → `build-final-app.sh` → `start-app.sh` (os `.ps1` de `_ops` não funcionam no Linux).
- [x] `bootstrap-admin`, login, REST, `mapa-armazem.html` e flow `SugerirDestino` verificados.
- [x] Smoke test equivalente com Bearer (o `smoke-test.sh` gerado só suporta API key).
- [x] D4 decidido: app próprio `WmsOfficeTheGame` em `backend/npdev/` (porta 8200), WmsOffice intocado.

Resolvido: a definição do jogo fica neste repo (versionada), então N1+ têm histórico normal.

### N1. Concepts de simulação ✅ (2026-11-10)

Arquivos novos em `definition/concepts/`, referenciados no `model.json`. Verificação ao vivo:
[`backend/npdev/tests/n1_sim_concepts.py`](../backend/npdev/tests/n1_sim_concepts.py) (31 checks).

Decisões tomadas na implementação (não estavam na tabela abaixo):
- `SimCenario.codigo` e `SimScore.partidaId` são `unique` (o 1:1 partida↔score é garantido pelo banco).
- `SimPartida.cenarioId` é `restrict` (não se apaga cenário com partidas jogadas); `jogadorId` é `cascade`.
- `SimPartida`: invariant `situacao != 'Concluida' || concluidaEm != null`; `Concluida` e `Abandonada` são terminais.
- Faixas: `inicioTurnoSeg` em [0, 86400), `fimTurnoSeg` em (`inicioTurnoSeg`, 86400], `liberacaoSeg` em [0, 86400).

**`SimCenario`**
| Campo | Tipo | Nota |
| --- | --- | --- |
| `codigo` | string, required | ex. `WH-A-PEQUENO` |
| `nome` | string, required | |
| `dificuldade` | enum `Facil/Medio/Dificil/Extremo` | |
| `armazemId` | reference → `Armazem` (restrict) | topologia do cenário |
| `seed` | long, required | gera ordens/ocupação inicial |
| `qtdDocasInbound` / `qtdDocasOutbound` | integer | default 2 |
| `qtdEquipamentos` | integer | default 3 |
| `velocidadeEquipamentoCmS` | integer | ex. 220 |
| `tempoDescargaSeg` | integer | ex. 300 |
| `inicioTurnoSeg` / `fimTurnoSeg` | integer | 28800 / 64800 |
| `ativo` | boolean | |

**`SimOrdem`** (ordens canônicas do cenário — mesmas para todos os jogadores)
| Campo | Tipo |
| --- | --- |
| `cenarioId` | reference → `SimCenario` (cascade) |
| `numero` | string |
| `tipo` | enum `Inbound/Outbound` |
| `liberacaoSeg` | integer |
| `slaSeg` | integer |
| `produtoId` | reference → `Produto` (restrict) |
| `quantidadePaletes` | integer |

**`SimPartida`** (uma jogada)
| Campo | Tipo |
| --- | --- |
| `cenarioId` | reference → `SimCenario` |
| `jogadorId` | reference → `identity::User` |
| `politica` | enum `AbcProximidade/FifoPrimeiraLivre/Consolidacao/CrossDocking/WmsReal` |
| `versaoMotor` | string (versão do `src/sim`) |
| `situacao` | **lifecycle** `EmAndamento → Concluida / Abandonada` |
| `iniciadaEm` / `concluidaEm` | datetime |

**`SimScore`** (1:1 com partida concluída)
| Campo | Tipo |
| --- | --- |
| `partidaId` | reference → `SimPartida` (cascade) |
| `distanciaRealCm` / `distanciaTeoricaCm` | long |
| `ordensTotal` / `ordensAtrasadas` | integer |
| `eventosConflito` | integer |
| `ocupacaoFinalCentesimos` | integer |
| `scoreCentesimos` | integer (0–10000) |
| `validadoServidor` | boolean |

Invariants: faixas (0–10000, `> 0`), `ordensAtrasadas <= ordensTotal`, `fimTurnoSeg > inicioTurnoSeg`.

**Pronto quando:** CRUD REST dos 4 concepts funciona com os bonds e o lifecycle validados ao vivo. ✅

### N2. Capability `simulacao` (Java puro) ✅ (2026-11-10)

Nova pasta `definition/capabilities/simulacao/`, mesmo padrão de `alocacao`. Testes:
[`n2_simulacao_capability.py`](../backend/npdev/tests/n2_simulacao_capability.py) (offline: javac + fixtures + PRNG × JS +
gate de bytecode do NPDev) e [`n2_simulacao_flows.py`](../backend/npdev/tests/n2_simulacao_flows.py) (ao vivo).

| Operação | Entrada → Saída |
| --- | --- |
| `calcularScore` | métricas → `{ penalidades, scoreCentesimos }` (fórmula oficial, inteiros) |
| `validarScore` | métricas + score do cliente → `{ valido, scoreRecalculado }` |
| `gerarOrdens` | `{ seed, params, produtos[] }` → lista de `SimOrdem` (para o seeding dos cenários) |

Flows (cada um declarando `concept`):
- `CalcularScoreSimulacao` — chamado pelo cliente ao fim da partida.
- `ConcluirPartida` — `callProcedure ConcluirPartidaProcedure` (ver abaixo).
- `GerarOrdensSimulacao` — expõe `gerarOrdens` (prévia, sem gravar; o seeding usa na N3).
- `SugerirDestinoJogo` — reaproveita `AllocationCapability.sugerirDestino` (política `WmsReal`).

**Pronto quando:** os testes unitários da capability batem com os exemplos do README (após a correção do §2). ✅

Como ficou (decisões e limitações descobertas):
- **Score**: teto de 100 (decidido em 2026-11-10); cada termo em centésimos com arredondamento meio para cima;
  `D_teorico = 0` → `P_dist` 0 se `D_real = 0`, senão 35. Vale sempre o score **recalculado** no servidor;
  `validadoServidor` = o score do cliente bateu com o recalculado.
- **Fixtures compartilhadas** em `backend/npdev/tests/fixtures/score-cases.json` — o `src/sim/score.ts` (F2) deve
  passar nos mesmos casos.
- **`gerarOrdens`** usa mulberry32 (testado bit a bit contra JS) — o mesmo PRNG de `src/sim/rng.ts`.
  Os pesos de frequência por produto vêm na entrada (`produtos: [{produtoId, peso}]`); `Produto` não tem esse campo.
- **`ConcluirPartidaProcedure` sem estado parcial**: procedures do NPDev **não são transacionais** (verificado ao vivo).
  Ordem: valida métricas → lê a partida e exige `EmAndamento` → grava o `SimScore` → conclui a partida.
  Erros de negócio voltam como `{sucesso:false, motivo}` (HTTP 200); sucesso devolve o envelope do `SimScore`.
- **Pendente para a N3**: o procedure não confere se a partida é do usuário logado (entra com a role `JOGADOR`).

### N3. Queries, seeds e role ✅ (2026-11-10)

Teste ao vivo: [`n3_jogador.py`](../backend/npdev/tests/n3_jogador.py) (46 checks, dois jogadores de teste).

- Queries (`GET /api/queries/<nome>`): `CenariosAtivos`; `OrdensPorCenario?cenarioId=` (parâmetro obrigatório —
  sem ele, 400; ordenada por liberação, até 5000 linhas numa chamada); `RankingPorCenario?cenarioId=` (top 50, só
  `validadoServidor`, desempate pela menor distância).
- Role **`Jogador`** (o nome da role no NPDev; usuários criados pelo admin via `POST /api/auth/create-user` com
  `roleNames: ["Jogador"]`): lê topologia, cenários e ordens; cria `SimPartida`; lê `SimScore`. Todo o resto do WMS → 403.
- Seeds: `definition/seeds/cenario-wh-a-pequeno.json` (4×12×1 + 2+2 docas = 52 locais, 12 produtos, 60 ordens) e
  `cenario-wh-b-mega.json` (12×30×4 + 4+4 docas = 1448 locais, 30 produtos, 400 ordens). Gerados por
  [`tools/gerar_seeds_cenarios.py`](../backend/npdev/tools/gerar_seeds_cenarios.py) — as ordens vêm de
  `SimulacaoCapability.gerarOrdens` com o seed do cenário; produtos com pesos em curva ABC; `RankingRua` R01 = mais
  próxima da expedição. Aplicar com [`tools/semear_cenarios.py`](../backend/npdev/tools/semear_cenarios.py) (pula o que
  já existe) ou `rebuild.sh --reset-db`.
- Panel de administração: **adiado** — o admin usa as telas CRUD geradas e as queries; um panel próprio entra se fizer falta.

**Pronto quando:** um usuário `JOGADOR` lista os cenários e as ordens e grava uma partida com score, e recebe 403 fora do seu escopo. ✅

Como ficou a segurança (o NPDev tem três camadas, e cada uma cobre caminhos diferentes — ver
[NPDEV_LINUX.md](NPDEV_LINUX.md#limitações-do-npdev-encontradas-ao-escrever-capabilitiesprocedures-n2)):
- **Dono = username.** `$user.id` é o `sub` do JWT (o username), não o UUID do usuário. Por isso `SimPartida.jogador` e
  `SimScore.jogador` são texto (username), não referência a `identity::User`. Regra por linha em ambos:
  `jogador == $user.id || ADMIN` (partida: leitura e escrita; score: escrita — o ranking é público entre jogadores).
- **`SimScore` só pelo `ConcluirPartida`.** O jogador não tem `create` em `SimScore` nem `update` em `SimPartida` no
  REST (antes dava para forjar um score 100 validado e para trocar o dono da partida). O procedure grava pelo gateway,
  que só aplica a regra por linha.
- **Sem `capability.invoke` para o jogador.** Flows com `createConcept`/`updateConcept` ignoram as regras por linha;
  sem essa permissão o jogador não roda nenhum deles. Os flows do jogo usam só `callProcedure`
  (procedures chamam capabilities sem esse gate). Não há flow de create para `SimPartida` de propósito.
- **`access.write` em todos os concepts do WMS** (`ADMIN || WarehouseManager`) e em `SimCenario`/`SimOrdem` (`ADMIN`):
  cobre aggregates e procedures. Seeds ignoram regras por linha.
- `WarehouseManager` passou a listar todos os concepts do WMS (sem isso, listar um concept só para o `Jogador`
  fecharia o concept para os demais).

Pendências que aparecem depois:
- **Estoque inicial**: os cenários começam com todos os locais `Disponivel`; ordens outbound precisam de estoque — a
  sim gera a ocupação inicial a partir do seed do cenário (resolvido na F2).
- Remover usuários de teste: o NPDev não expõe delete de usuário; `teste-jogador-1/2` ficam no banco de dev.

### N4. Endpoint de "pacote do cenário" — opção A ✅ (2026-11-10)

O cliente precisa trazer tudo para jogar offline:

```
GET cenário → { cenario, armazem, areas[], ruas[], locais[], produtos[], ordens[], rankingRuas[] }
```

- **Opção A (feita)**: várias chamadas REST montadas no cliente, sem mudar o NPDev — [`src/net/pacote.ts`](../src/net/pacote.ts)
  (`carregarPacote(http, codigo)`). Só chamadas que a role `Jogador` faz.
- Opção B: procedure/flow `PacoteCenario`. **Adiada**: o WH-B inteiro (1448 locais) carrega em ~1,5 s com 36 chamadas
  (WH-A: 20 chamadas, ~1,4 s, medido ao vivo); só vale se a latência em celular incomodar (F7).

Como ficou (o que o NPDev realmente oferece — descoberto ao vivo, não estava no plano):
- **A lista REST `GET /api/<concept>` não serve**: ignora qualquer filtro/`offset` e corta em **1000 linhas** (cabeçalho
  `X-List-Truncated: true`). Os cenários semeados têm 1500 locais — a lista perderia locais em silêncio.
- Serve: **`GET /api/concepts/<Concept>/page`** (filtro de igualdade por qualquer campo, `sort`, `offset`, `limit` até 1000;
  `{items, total, hasMore}`) e as queries nomeadas (`/api/queries/<Nome>`, também com `offset`/`limit`, cortados em 1000
  mesmo que o model.json diga `limit: 5000`). O pacote usa `/page` por rua/área (os `LocalArmazenagem` só apontam para a
  rua) e as queries `CenariosAtivos` e `OrdensPorCenario`. **Pegadinha:** `/page` num concept que a role não lê devolve
  200 com lista **vazia** (não 403) — por isso `validarPacote` recusa pacote sem locais/ordens em vez de entregar um
  armazém vazio.
- **Produtos não são do cenário**: vêm os do `PerfilAlocacao` das ruas (via `RankingRua`) mais os das ordens. O WH-A tem 4
  produtos sem nenhuma ordem; só o perfil os traz.
- **Equivalência com o embutido** ([`live.test.ts`](../src/net/live.test.ts), `NPDEV_LIVE=1`): WH-A-PEQUENO e WH-B-MEGA lidos
  como `teste-jogador-1` batem campo a campo com `src/data/cenarios/*.json` depois de trocar os ids por chaves naturais
  (código da rua, rua/posição/andar, código do produto, número da ordem): mesmas quantidades, topologia, ordens, campos e
  tipos. Só os campos do modelo entram (`version`, `tenantId`, `ativo`… ficam de fora). Os ids são **UUIDs do banco**.
- **Ordem canônica**: o banco devolve por id (aleatório); o pacote sai ordenado por rua/posição/andar, código e
  liberação — independente do servidor.
- **Aliases × UUIDs na sim** ([`uuid.test.ts`](../src/net/uuid.test.ts)): a sim roda as 5 políticas nos dois cenários com
  todos os ids trocados por UUIDs (e por ids hostis com `:`, `/` e acentos) cumprindo os invariantes — nada interpreta o
  formato do id. **Mas o resultado muda**: (1) `WmsReal` desempata por id em texto (`String.compareTo`, como o Java), então
  deixa de coincidir com o `FifoPrimeiraLivre` (aliases: ordem de varredura; UUIDs: ordem aleatória) — esperado e testado;
  (2) as outras quatro também mudam (WH-A: Fifo 83,79 → 86,09 com uma semente), por um desempate que **não** é do WmsReal:
  `calcularCurvaAbc` (`src/sim/estoque.ts`) ordena produtos de mesmo giro por `id.localeCompare`, o que muda a curva, o
  produto sorteado para cada palete do estoque inicial e o turno todo. Online (UUIDs) e offline (aliases embutidos) jogam,
  na prática, estoques iniciais diferentes. **Correção de 2 linhas, ainda NÃO aplicada** (fora do escopo desta fase):
  desempatar por `produto.codigo`; verificado que os goldens atuais continuam passando e que as 4 políticas passam a dar
  métricas idênticas com UUIDs (hoje o teste `it.fails` de `uuid.test.ts` documenta isso e vai quebrar quando for
  corrigido, para virar `it`).

### N5. Mount do jogo e CORS

- Script `npm run deploy:npdev` → `vite build` → copia `dist/` para `backend/npdev/web/jogo/`.
- Validar `http://localhost:8200/jogo/` com login via `/api/auth/login`.

---

## 4. Fases — Frontend (este repo)

### F0. Higiene do repositório ✅ (2026-11-10)

- [x] `.gitignore` (`node_modules/`, `dist/`, `.vite/`) e `git rm -r --cached node_modules`.
- [x] Remover `setup.sh` e `setup_frontend.py`.
- [x] Vitest como dev dependency; scripts `test`, `typecheck`.
- [x] Commits com mensagem descritiva daqui em diante.

### F1. Separação sim / render / ui ✅ (2026-11-10)

Como ficou (`npm test`: 51 testes; verificado no navegador — WH-A, inspector, WH-B, heatmap, zoom):

```
src/
  sim/      model.ts (tipos = concepts + pacote N4) · rng.ts (mulberry32, = Java) · score.ts (= Java, fixtures
            compartilhadas) · layout.ts (geometria em cm, pontos de acesso) · simulation.ts (estado + tick + snapshot)
  render/   camera.ts (cm ↔ px, zoom ancorado) · renderer.ts (desenha o snapshot) · input.ts (arrastar/roda/clique)
  ui/       hud.ts · inspector.ts · drawer.ts
  app/      relogio.ts (tempo real → ticks; 1x = 30 s simulados por segundo real, turno de 10 h em 20 min)
  data/     cenarios/WH-A-PEQUENO.json, WH-B-MEGA.json — pacotes gerados dos seeds do backend
            (backend/npdev/tools/gerar_pacotes_front.py); WH-B carregado sob demanda
  main.ts   liga tudo: rAF → Relogio → n × tick() → render + UI
```

- Sim pura: sem DOM, sem `Math.random`, sem relógio de parede; passo fixo de 1 s simulado (a velocidade só muda
  quantos ticks rodam por frame). O render e a UI recebem um `Snapshot` com tipos `readonly`.
- Geometria (`GEOMETRIA` em `layout.ts`): posição 120 cm, rack 110 cm, corredor 300 cm, corredor principal 400 cm,
  doca 400 × 350 cm. Docas de saída no alto (perto de R01, prioridade 1 do `RankingRua`), de entrada embaixo.
  Andares ocupam o mesmo x,y (o render agrupa em "vãos").
- Sai o protótipo: layout/ocupação/rotas aleatórios, `NPDevClient` com sucesso falso (o cliente real entra na F5) e o
  botão "Injetar NF". KPIs mostram só o que existe (relógio, ordens liberadas, ocupação; score "—" até a F2).
- A sim da F1 já libera as ordens no horário e registra no log; equipamentos ficam parados nas docas (F2).

Plano original:

```
src/
  sim/            # puro, determinístico, testável (sem DOM)
    rng.ts        # PRNG com seed (mulberry32)
    model.ts      # tipos do domínio (espelham os concepts NPDev)
    layout.ts     # Rua/LocalArmazenagem → grafo de corredores + coordenadas
    pathing.ts    # menor caminho no grafo (Manhattan/A*)
    policies/     # abc.ts, fifo.ts, consolidacao.ts, crossdock.ts, wmsReal.ts
    engine.ts     # tick(dt): ordens → tarefas → equipamentos → métricas
    score.ts      # fórmula oficial (inteiros escalados, D6)
  render/         # Canvas: armazém, equipamentos, heatmap, câmera
  ui/             # HUD, drawer, inspector, tela de resultado
  services/       # npdevClient, auth, cache offline
```

- O `WarehouseEngine` atual é dividido em `render/` (draw, câmera, input) e `sim/` (estado).
- A renderização lê um *snapshot* do estado da sim; nunca o modifica.

### F2. Núcleo da simulação (com mock local) ✅ (2026-11-10)

Como ficou (`npm test`: 89 testes; verificado no navegador — WH-A e WH-B jogando, heatmap real, sem erros no console):

```
src/sim/  pathing.ts (malha de corredores: caminho e distância) · estoque.ts (curva ABC + estoque inicial)
          politicas.ts (destino/origem) · teorica.ts (distância teórica) · simulation.ts (motor: ordens → tarefas →
          equipamentos → métricas → score)
```

- [x] Layout a partir de `Rua.qtdPosicoes × qtdAndares`; docas a partir das `Area` de recebimento/expedição (F1).
- [x] **Estoque inicial**: 60% dos locais livres, sorteados pelo seed do cenário; o produto de cada palete é sorteado
  pelo peso da curva ABC; paletes entram até 30 dias antes do turno (base do FIFO). *Proposta aprovada em 2026-11-10.*
  - **Peso = giro de saída** (paletes das ordens `Outbound` do cenário), não entrada + saída: a classe ABC é por
    frequência de saída (F3) e é o que as saídas das 08:00 precisam. Com entrada + saída, o WH-A (fácil) terminava
    com 9–14 ordens atrasadas por falta de estoque; com giro de saída, 2. Não depende do nome do produto.
  - Os locais ficam em posição aleatória (sem organização prévia). Testado com metade do estoque já na faixa certa:
    muda pouco e piora o WH-A — não vale a complexidade.
- [x] Ordens liberadas por `liberacaoSeg`.
  - **Inbound**: fila única → doca de entrada livre → descarga de `tempoDescargaSeg` → 1 tarefa de putaway por palete.
  - **Outbound**: espera estoque do produto (só entra com TODOS os paletes disponíveis) + doca de saída livre; reserva os
    paletes mais antigos (**FIFO por data de entrada** — `Produto` não tem validade no pacote, então não é FEFO ainda).
    Ordem maior que o estoque espera e vira atraso; o motor nunca inventa palete.
- [x] Despacho: tarefas por prazo (liberação + SLA, a mais urgente primeiro); cada uma vai para a empilhadeira
  ociosa **mais próxima** do ponto de partida. Putaway sem local livre espera uma saída liberar.
- [x] Equipamentos percorrem a malha (corredor principal + corredor de cada rua), a `velocidadeEquipamentoCmS` por
  tick. Tempos de operação são constantes do motor (iguais para todas as políticas): 10 s na doca, 15 s no local +
  5 s por andar acima do primeiro. Uma fase por tick (a que termina uma operação só se mexe no tick seguinte).
- [x] **Conflito**: cada corredor de rua admite uma empilhadeira por vez (trava FIFO). Quem chega e encontra a rua
  ocupada espera na junção com o corredor principal e gera **1 evento por espera** (não por tick). Sem deadlock: uma
  empilhadeira só pede um corredor estando sem nenhum.
- [x] SLA: ordem concluída depois de `liberacaoSeg + slaSeg` é atrasada; ordens ainda abertas e vencidas contam como
  atrasadas já (e as não concluídas no fim do turno ficam atrasadas).
- [x] **`distanciaTeorica`** (definição fechada em [`teorica.ts`](../src/sim/teorica.ts)): cada palete movimentado custa,
  no melhor caso, `2 × distância(doca, local)`; o custo de um local é a média das distâncias à doca de entrada e à de
  saída mais próximas (o palete entra por uma e sai pela outra — nenhum local é bom para as duas); os movimentos, do
  produto de maior giro ao de menor, ocupam os locais do menor custo ao maior. É um piso razoável, não um limite:
  terminar abaixo dele não dá bônus. *(A primeira versão tratava entrada e saída em separado, o que contava duas
  vezes os melhores locais: no WH-B a penalidade de distância saturava em 35 e as políticas empatavam.)*
- [x] Golden tests: mesmo seed + mesma política → métricas idênticas, e números fixos por cenário/política. Invariantes
  verificados o turno todo: paletes conservados, no máximo uma empilhadeira por corredor, distância das métricas =
  soma dos deslocamentos. (Mutação conferida: sem a trava, 6 testes falham.)
- [x] Políticas que a F2 já usa: `FifoPrimeiraLivre` e `AbcProximidade` (A = 20% dos locais mais próximos da expedição,
  B = próximos 30%, C = o resto; faixa lotada transborda para a vizinha). As outras três caem em `FifoPrimeiraLivre`
  com aviso no log até a F3.
- HUD: concluídas/atrasadas, distância, conflitos, ocupação e score (parcial durante o turno, oficial no fim).
  Empilhadeira vermelha = esperando corredor; quadrado branco = carregando palete; doca com borda amarela = atendendo.

Resultado de referência (score oficial): WH-A — ABC 85,52 · FIFO 83,79; WH-B — ABC 70,38 · FIFO 65,60.

**Para balancear (não alterado — a fórmula é a oficial do Java):** a penalidade de conflito satura com 10 conflitos
(15 pontos). No WH-B há 230–380 conflitos, então o termo não diferencia nada ali; e no WH-A fica perto do teto.
Se o jogo precisar de mais gradação, é decisão de regra (mudar `P_POR_CONFLITO`/teto no Java e no `score.ts`,
com fixtures novas), não de motor.

### F3. Políticas ✅ (2026-11-10)

Como ficou (`npm test`: 146 testes; os 5 modos rodam nos dois cenários com os mesmos invariantes da F2):

| Política | O que faz no jogo |
| --- | --- |
| `FifoPrimeiraLivre` | primeiro local livre na ordem de varredura |
| `AbcProximidade` | classe A nos 20% de locais mais próximos da expedição, B nos 30% seguintes, C no resto |
| `Consolidacao` | o local livre da rua que já guarda mais paletes do produto (os a caminho contam); empate: melhor rua do `RankingRua`, posição mais perto da doca, andar mais baixo. É a porta da regra "mesmo lote primeiro" de `sugerirDestino` adaptada a um palete por local |
| `WmsReal` | `AllocationCapability.sugerirDestino` (porta TS em [`wmsReal.ts`](../src/sim/wmsReal.ts)) sobre os locais livres, com a prioridade da rua no `RankingRua`. Offline; o flow online é da F5 |
| `CrossDocking` | palete descarregado vai direto da doca de entrada para a de saída se há saída pendente do mesmo produto; o resto é guardado como em `AbcProximidade` |

- [x] **Cross-docking no motor**: com a política ativa, a saída pendente conta como estoque os paletes do produto que
  acabaram de ser descarregados e ainda esperam putaway (uma tarefa `CrossDock`: doca IN → doca OUT, sem passar pelo
  estoque; conta como palete concluído das DUAS ordens). O despacho **segura** esses paletes até
  `ESPERA_CROSSDOCK_SEG` (600 s) quando há saída pendente do produto — sem isso o putaway sai no mesmo tick da
  descarga e o desvio nunca teria chance. Passou do prazo, vai para o estoque. Distância teórica não muda.
- [x] **Estado**: um local `Reservado` já traz o `produtoId` (Consolidacao conta os paletes a caminho). Invariante nova:
  local `Disponivel`/`Bloqueado` não tem produto; os outros têm.
- [x] **Testes de paridade TS × Java**: [`alocacao-casos.json`](../backend/npdev/tests/fixtures/alocacao-casos.json)
  (`sugerirDestino` e `sugerirOrigem`: lote igual, prioridade, empate por id em ordem de texto, prioridade/validade
  ausentes ou ilegíveis, FEFO, estoque insuficiente, 30 de fevereiro, cross-docking). O vitest
  ([`wmsReal.test.ts`](../src/sim/wmsReal.test.ts)) roda contra a porta TS; `tests/f3_paridade_alocacao.py` roda o mesmo
  arquivo contra os flows `SugerirDestinoJogo`/`SugerirOrigem` (Java, app de pé na 8200). Os casos com `somenteDireto`
  dependem de `CrossDocking` no banco e só rodam no TS. Os dois lados passam. (Achado no caminho: a porta TS comparava
  `LocalDate.MAX` como texto e ordenava a data ausente *antes* das reais; o caso "mesma validade" pegou.)
- [x] Testes de política sem motor ([`politicas.test.ts`](../src/sim/politicas.test.ts)), goldens das 5 políticas × 2
  cenários e 3 testes de cross-docking (desvio, mesma carga sem a política, tempo máximo de espera; mutação conferida).

Resultado de referência (score oficial):

| Cenário | Abc | Fifo | Consolidação | CrossDocking | WmsReal |
| --- | --- | --- | --- | --- | --- |
| WH-A | 85,52 | 83,79 | 84,47 | 85,52 | 83,79 |
| WH-B | 70,38 | 65,60 | **71,46** | 70,55 | 65,60 |

**Dois resultados que pedem decisão de design (não de motor):**

- **`WmsReal` = `FifoPrimeiraLivre`** nos dois cenários. O `RankingRua` dos seeds é a própria ordem das ruas, e cada
  local guarda um palete (nunca há "completar pallet"), então a regra do WMS Office degenera para "primeira posição
  livre". É fiel ao Java, mas não dá personalidade ao modo. Para ter, os seeds precisam de ranking de verdade (por
  perfil/produto — `PerfilAlocacao`) ou os locais precisam de capacidade em caixas.
- **`CrossDocking` quase não age** (WH-B: 2 paletes; WH-A: 0). O gerador de ordens não cria saída pendente do mesmo
  produto que está chegando: as saídas saem do estoque inicial. Para o modo valer, o gerador (ou um cenário dedicado)
  tem de produzir saídas que dependam de entradas.

### F4. HUD e gameplay

- [ ] Tela de seleção de cenário e política (pré-partida).
- [x] Relógio 08:00–18:00, pausa/1x/2x/5x (F1).
- [x] KPIs ao vivo: ordens concluídas/atrasadas, distância, ocupação, conflitos (F2).
- [x] Inspector com dados reais (Rua-Posição-Andar, produto, acessos) — F2. Falta lote/quantidade (o pacote não tem).
- [x] Heatmap de acessos real (contado pela sim, não aleatório) — F2.
- [ ] Troca de política durante a partida (registrada na partida; afeta só alocações futuras).
- [ ] Tela de resultado: breakdown das penalidades, score e comparação com o ranking.

### F5. Integração com o NPDev — camada de rede ✅, UI pendente (2026-11-10)

A camada de rede está pronta e testada em `src/net/` (módulos puros: sem DOM, `fetch`/relógio/armazenamento injetados).
**Nada disso está ligado à UI ainda** — `main.ts`, `src/ui/*` e `index.html` não foram tocados. `npm test`: 295 passam
(+12 ao vivo, pulados sem `NPDEV_LIVE=1`); verificado ao vivo contra a 8200.

```
src/net/  erros.ts (NpdevError + classificação) · npdevClient.ts (login, JWT em memória, get/post) · leitura.ts (paginação)
          pacote.ts (N4) · cache.ts (IndexedDB/memória + obterPacote) · partidas.ts (iniciar/concluir/abandonar/ranking)
          filaEnvio.ts (outbox) · rede.ts (criarRede: monta tudo) · index.ts (API pública; o topo do arquivo traz o esboço de uso)
          servidorFalso.ts · idsUuid.ts · pacoteEquivalencia.ts (só testes) · live.test.ts (NPDEV_LIVE=1)
```

- [x] **`NpdevClient`** reescrito ([`npdevClient.ts`](../src/net/npdevClient.ts)): base `/api` (proxy do Vite em dev, mesma origem em
  produção), `login()` guarda o JWT **só em memória** (`sessao()`/`restaurarSessao()`/`limparSessao()` deixam a UI decidir
  se persiste — o token vale 8 h). O `username` canônico vem do `sub` do JWT (a regra por linha compara com ele, não com o
  que foi digitado). Timeout de 20 s por chamada.
- [x] **Erros explícitos** ([`erros.ts`](../src/net/erros.ts)): todo erro é `NpdevError` com `tipo` (`offline`, `rede`, `timeout`,
  `nao_autenticado`, `proibido`, `nao_encontrado`, `requisicao_invalida`, `servidor`, `resposta_invalida`, `recusado`,
  `indisponivel`), `status`, `codigo` e `recuperavel` (vale tentar de novo). 401 com sessão derruba a sessão e chama
  `aoSessaoExpirar`; resposta 2xx que não é JSON ou não tem o formato esperado é `resposta_invalida` — cada campo é
  validado. Nunca há "sucesso falso". Descoberto ao vivo: o 1º flow depois de o app subir pode estourar o timeout de 5 s do
  plugin (`422 PLUGIN_EXECUTION_TIMEOUT`); o cliente o classifica como `servidor` (recuperável), não como recusa.
- [x] **Modo convidado = offline**: sem `login()`, toda chamada falha na hora com `offline`, sem tocar na rede.
- [x] **Pacote do cenário** (N4) → **cache** ([`cache.ts`](../src/net/cache.ts)): `obterPacote(codigo, {http, cache, embutido})`
  tenta a rede (se logado) e atualiza o cache; se a rede falhar (qualquer `NpdevError`), usa o cache; sem cache, o
  embutido (recebido por parâmetro, pode ser assíncrono). Devolve a **origem** (`'rede'|'cache'|'embutido'`), a data do
  cache e, se a rede falhou, o motivo (`falhaRede`). O cache guarda formato, data, assinatura do conteúdo e o pacote;
  cache corrompido/de formato antigo vira "sem cache". `ArmazenamentoIndexedDb` (verificado também contra `fake-indexeddb`
  real, fora do repo) e `ArmazenamentoMemoria`.
- [x] **Partidas** ([`partidas.ts`](../src/net/partidas.ts)): `iniciarPartida` (`POST /api/sim_partidas`; dono = username da sessão),
  `concluirPartida` (flow `ConcluirPartida`), `abandonarPartida` (flow `AbandonarPartida`), `ranking(cenarioId, {partidaId})`
  (query `RankingPorCenario`, com a posição do jogador e da partida; `truncado` quando há mais gente que o limite).
  **Score adulterado não é "recusado" pelo servidor**: ele grava o score RECALCULADO com `validadoServidor=false` (fora do
  ranking) e responde 200 — `concluirPartida` devolve `validadoServidor:false` + o score do servidor (a UI mostra a
  divergência). Recusa de verdade (`recusado`): métricas inválidas (`codigo: 'metricas_invalidas'`) e partida que já não
  está em andamento (`'partida_encerrada'`).
- [x] **Fila de envio offline** ([`filaEnvio.ts`](../src/net/filaEnvio.ts)): padrão *outbox* — `registrar()` guarda o resultado
  `{cenarioCodigo, politica, metricas, scoreCentesimos, iniciadaEm, concluidaEm, versaoMotor}` ANTES de tentar enviar;
  `sincronizar()` cria a `SimPartida` e conclui, um item por vez, na ordem em que foram jogados, parando no primeiro erro
  recuperável. Só sai da fila o que o servidor aceitou **e validou**. Idempotência: o `partidaId` é gravado no item antes de
  concluir; se a criação chegou mas a resposta se perdeu, acha a partida `EmAndamento` com o mesmo `iniciadaEm`; se a
  conclusão chegou e a resposta se perdeu, o servidor diz "não está EmAndamento" e a fila consulta o `SimScore` da partida
  e trata como aceito. Rejeição definitiva (métrica inválida, cenário que não existe mais, 403, score que o servidor não
  validou, 5 respostas ilegíveis) marca o item `rejeitado` com o motivo e **não reenvia sozinho** (`reenviar(id)` /
  `descartar(id)`). Rede, servidor, plugin e login vencido só adiam. Um item é enviado só pelo jogador que o jogou.
  Convidado não guarda nada.
- [x] Testes: 28 do cliente (401/403/404/422/5xx, rede caída, timeout, corpo malformado, expiração), 22 do pacote
  (equivalência, paginação, falhas), 22 do cache (rede → cache → embutido), 21 das partidas, 26 da fila (offline → online,
  queda no meio, rejeição definitiva, concorrência), 19 de ids/UUID, 11 do comparador; tudo com `ServidorFalso`, um
  `fetch` que reproduz os formatos reais do NPDev e injeta falhas. 12 ao vivo (`NPDEV_LIVE=1 npx vitest run
  src/net/live.test.ts`): login, 403, pacotes WH-A/WH-B × embutido, cache com rede caída, partida → ranking, fila com
  resposta perdida; cria um cenário `F5-LIVE-<hora>` e o admin apaga tudo no fim.

**Depende da UI / ainda não feito:**
- [ ] Tela de login (`criarRede()` → `cliente.login`) e persistência opcional da sessão; chamar `fila.sincronizar()` logo após
  o login e no evento `online`. Passar `aoSessaoExpirar` para voltar ao login/offline.
- [ ] Seleção de cenário: `listarCenarios` quando logado; mostrar a origem do pacote (`obterPacote().origem`/`salvoEm`).
- [ ] Início da partida: `iniciarPartida` é opcional (a fila cria a partida depois se faltar); se a UI chamar, passar o
  mesmo `partidaId` **e** o mesmo `iniciadaEm` no `registrar`, e chamar `abandonarPartida` ao desistir (partida em
  andamento esquecida fica `EmAndamento` para sempre — o Jogador não pode apagar).
- [ ] Fim da partida / tela de resultado (F4): `fila.registrar(...)` → `estado` (`enviado`/`pendente`/`rejeitado`/`convidado`)
  e `ranking(cenarioId, {partidaId})` para a posição; mostrar `validadoServidor` e a divergência, se houver.
- [ ] Indicador "N partidas pendentes de envio": `fila.observar()` / `fila.resumo()`; tela para ver/descartar/reenviar rejeitadas.
- [ ] `VERSAO_MOTOR` (`partidas.ts`) é manual: subir quando uma regra do motor mudar.
- [ ] Política **WmsReal online** (flow `SugerirDestinoJogo`, D2) continua só com a porta TS offline.
- [ ] Decisão em aberto (ver N4): desempate da curva ABC por `codigo` em vez de `id` (2 linhas em `src/sim/estoque.ts`).

### F6. Escala e polimento

- [ ] Medir FPS no `WH-B-MEGA` (~1400 locais, 8 equipamentos); se não houver folga, offscreen canvas
  para o layout estático e avaliar PixiJS.
- [ ] Zoom por pinça/roda, centralizar em seleção.
- [ ] Tutorial curto do primeiro cenário.

### F7. Mobile (Capacitor)

- [ ] Capacitor 6 + Android; tela cheia; layout de toque do HUD/drawer.
- [ ] Teste offline completo (cenário em cache → jogar → sincronizar depois).
- [ ] Geração de `.apk` debug.

---

## 5. Sequência e dependências

```text
F0 ─► F1 ─► F2 ─► F3 ─► F4 ───────────────┐
                    ▲                      ▼
N0 ─► N1 ─► N2 ─► N3 ─► N4 ─► N5 ──────► F5 ─► F6 ─► F7
          (paridade Java×TS conecta N2/F3)
```

- **Trilha front (F0–F4)** é independente do backend: anda com o mock local desde já.
- **Trilha NPDev (N0–N5)** pode correr em paralelo; o maior risco está em N0.
- **F5** é o ponto de encontro.

Marcos:
1. **M1 — Jogável offline**: F0–F4 com o cenário `WH-A-PEQUENO` mockado.
2. **M2 — Backend pronto**: N0–N3 de pé no Linux, cenários semeados, score validado no servidor.
3. **M3 — Integrado**: F5 + N4/N5, servido em `:8200/jogo/`, ranking funcionando.
4. **M4 — Mobile**: F6–F7, APK offline.

---

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Build do NPDev não roda no Linux (paths `D:\`, file locks, pwsh) | Bloqueia M2 | N0 primeiro; trilha front segue com mock |
| Divergência TS × Java nas regras de alocação | Score "WmsReal" inconsistente | Fixtures compartilhadas + testes de paridade |
| Limites de procedures (sem filtro) | Pacote do cenário lento | Opção A (várias chamadas) + cache |
| Score falsificável no cliente | Ranking não confiável | `validarScore` recalcula a partir das métricas; replay completo (seed + log de decisões) fica para depois |
| Fork diverge do WmsOffice | Correções do produto não chegam ao jogo | Snapshot documentado em `backend/npdev/README.md`; sincronizar só quando necessário |
| Performance no cenário mega em celulares | UX ruim | Medir na F6; canvas em camadas / PixiJS |

---

## 7. Questões em aberto

1. ~~**D4**~~: decidido — app NPDev próprio (`backend/npdev/`), WmsOffice intocado.
2. O NPDev será mantido nas duas máquinas (Windows e Linux)? Se sim, `config.json` por máquina vai para fora do git.
3. O ranking é global ou por usuário/tenant?
4. ~~Correção no manifesto do produto WmsOffice (N0)~~: decidido em 2026-11-10 — **mantida** (o produto passa a gerar
   no NPDev atual; backup do estado anterior em `AppGen/apps/_backups/WmsOffice-2026-11-10-pre-n0.tar.gz`).
5. Haverá validação por replay (o servidor reexecuta a partida)? Isso exige o motor em Java também — fora de escopo por ora.
