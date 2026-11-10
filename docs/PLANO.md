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

### N4. Endpoint de "pacote do cenário"

O cliente precisa de **uma chamada** que traga tudo para jogar offline:

```
GET cenário → { cenario, armazem, areas[], ruas[], locais[], produtos[], ordens[], rankingRuas[] }
```

- Opção A: várias chamadas REST montadas no cliente (funciona já, sem mudar o NPDev).
- Opção B: procedure/flow `PacoteCenario` (depende do limite 0.2-2).
- **Começar com A**; migrar para B se a latência incomodar.

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

### F5. Integração com o NPDev

- [ ] `NPDevClient` reescrito: base `/api` (proxy/mesma origem), JWT, erros explícitos (sem sucesso falso).
- [ ] Login (reaproveitar `/api/auth/login`); modo convidado = offline.
- [ ] Carregar o pacote do cenário (N4) → cache em IndexedDB para offline.
- [ ] Fim de partida: `ConcluirPartida` → mostrar `validadoServidor` e a posição no ranking.
- [ ] Fila de envio offline: partidas jogadas offline enviadas quando a rede voltar.

### F6. Escala e polimento ✅ (2026-11-10, exceto o tutorial — entra depois da F4)

Como ficou (`npm test`: 185 testes; verificado no Chrome headless em desktop 1280×800 e celular 390×844 com toque e pinça).

**Como medir (reaproveitável)** — [`tools/perf/`](../tools/perf/), com `puppeteer-core@22` instalado FORA do repo (instruções no
topo de [`comum.mjs`](../tools/perf/comum.mjs); não entra no `package.json`) e o app rodando com `npx vite --port 3200 --no-open`:

| Script | O que faz |
| --- | --- |
| `medir.mjs` | **micro**: `Simulacao.tick` do turno inteiro, `snapshot`, `Renderer.desenhar` em 9 cenas (JS puro e JS + descarga do raster) e DOM do HUD/log; **e2e**: o app com rAF real a 1x/2x/5x/pausa, repartindo o quadro (tick/snapshot/desenhar/HUD/log), quadros/s, ocupação da thread e layout+estilo (CDP). Sem instrumentação dentro do app: envolve os métodos públicos pelo lado de fora, então serve para versões antigas e novas |
| `ab.mjs` | A/B de dois renderers **intercalado quadro a quadro** na mesma página (versão antiga servida em outra porta). Existe porque a máquina estava carregada (load 2–17) e medir A e depois B mistura código com carga |
| `capturas.mjs` | `estado` (PNG do canvas com estado determinístico da sim), `comparar` (diferença pixel a pixel) e `telas` (página inteira, desktop e celular, com clique, roda, arrasto, pinça e duplo toque por CDP) |
| `?perf=1` | overlay no canto da tela com quadros/s e ms por fase (sim, desenho, UI); últimos números em `window.__perfil`. Para medir em celular/APK (F7), onde não há puppeteer |

Ambiente: Chrome 156 headless, Intel HD 5500, 4 núcleos, **máquina compartilhada com outros processos**. Dois modos: *software* (padrão do
headless: Skia na CPU, compositor em software) e *GPU* (`--gpu`: ANGLE/Vulkan; canvas 2D acelerado, mas o compositor do headless continua
em software). Os absolutos são pessimistas e ruidosos; vale a razão B/A. O `WH-B-MEGA` tem 1440 locais (360 vãos × 4 andares) e 8 empilhadeiras.

**O que a medição mostrou (antes)**

- **A sim não é o gargalo**: `tick` = 0,02 ms em média (turno inteiro de 36 000 ticks em 0,7 s). Por segundo real: 1x 0,6 ms, 2x 1,2 ms,
  5x 2,9 ms (≈ 0,05 ms por quadro a 60 fps). No máximo algumas dezenas de ticks em 36 000 passam de 2 ms (aquecimento do JIT). `snapshot` custa 35–65 µs.
  Nada a fazer no motor.
- **O desenho custava 1,5–3 ms de JS por quadro** (WH-B, 1280×640): ~360 `fillText` com `ctx.font` reatribuído a cada rótulo, `filter` +
  8 `Map.get`/vão, strings `rgba(...)` por vão no heatmap, `Set` novo por quadro — e redesenhava tudo mesmo parado.
- **O DOM era tocado a 60 Hz**: HUD (~0,3–1 ms por atualização com layout) e log (50 `li` refeitos, 5–8 ms por evento novo). Layout+estilo
  ocupava 6–8% da thread; **pausado**, o jogo seguia a 51–73% da thread só redesenhando o mesmo quadro.

**O que mudou**

- `renderer.ts`: (1) **quadro idêntico não é desenhado** (pausado, 1x entre dois ticks, fim do turno — chave: layout, mapa de locais,
  relógio, câmera, tamanho do canvas, heatmap, seleção; canvas limpo pelo navegador é detectado por um sentinela em `ctx.miterLimit`);
  (2) **culling pela viewport** e laços sem alocação (sem `filter`/closures/strings por vão; heatmap com cor fixa + `globalAlpha`; rótulo
  do vão montado uma vez; fonte definida uma vez por grupo de textos); (3) **bordas e rótulos dos vãos em um canvas auxiliar**, refeito só
  quando câmera/tamanho/layout/fontes mudam — só com zoom de rótulos (escala ≥ 0,25) e câmera parada; em movimento desenha direto;
  (4) refaz o cache quando a JetBrains Mono termina de carregar. API intacta (`desenhar`, `vaosDe`, `vaoEm`, `Vao` ganhou `rotulo`;
  `invalidar()` novo).
- `main.ts` (loop de quadro): HUD e log por `Cadencia` (~10 Hz, HUD só se o relógio ou a sim mudaram; log se auto-verifica por evento novo),
  chamadas `perf?.…` do `?perf=1`, e `redimensionar` por `ResizeObserver`.
- **Câmera/entrada** (`camera.ts` com os testes; `gestos.ts` reconhecedor puro e testado; `input.ts` só liga os eventos): roda proporcional ao
  delta (trackpad suave; Ctrl+roda = pinça do trackpad) ancorada no cursor; **pinça com pan simultâneo** (pointer events); pan com 1 dedo/mouse;
  **duplo clique/toque centraliza e aproxima** (≥ 0,6) com voo animado — o segundo toque não dispara a seleção, então o clique simples segue
  igual; limiar de clique maior para toque (14 px × 5); 2 dedos nunca viram clique e levantar um continua como pan sem salto; botão do meio/direito
  ignorado. **Limites**: zoom mínimo = metade do enquadramento (máx. 2); pan sempre deixa ≥ 20% da tela coberta pelo armazém. `touch-action: none`
  por JS (já havia).
- **Achado de passagem**: o bitmap do canvas só era redimensionado no `resize` da janela; quando o layout mudava sem `resize` (fonte web que
  chega, drawer) o bitmap ficava esticado em relação ao CSS (1280×517 num elemento de 1280×529 no desktop) e os cliques erravam. Agora
  `ResizeObserver` no container, e o `input` converte ponto de tela → canvas pela razão bitmap/CSS.

**Antes → depois** (ms por quadro; software, mediana de 3 rodadas alternadas antes/depois em máquina quase ociosa; "thread" = ocupação da
thread principal; os dois seguraram 60 fps com a máquina ociosa — o ganho é folga):

| Cenário (WH-B) | JS/quadro | Thread | Layout+estilo |
| --- | --- | --- | --- |
| **Pausado** | 2,2 → **0,2** | 51–73% → **3–4%** | 6–8% → 0% |
| 1x enquadrado | 2,4 → 0,9 | 55% → 22% | 6% → 1% |
| 2x enquadrado | 2,0 → 1,8 | 53% → 42% | 7% → 2% |
| **5x enquadrado** | 2,0 → 1,9 | 55% → 46% | 7% → 2% |
| 5x enquadrado + heatmap | 2,3 → 1,5 | 55% → 44% | 8% → 3% |
| 5x zoom (roda ×6, com rótulos) | 1,9 → 1,4 | 51% → 44% | 7% → 3% |
| 5x, GPU, sem limite de 60 Hz | 1,4–2,1 → 1,1–1,4 | 97–99% → 67–72% | 10–12% → 2–3% |

- Sob carga da máquina (load 7–17), uma rodada isolada (não intercalada) deu **5x: 35–43 fps antes × 58–60 depois**; ociosa, os dois dão 60.
  Em GPU sem limite os fps são ruidosos (108–172 antes, 119–130 depois): não tire conclusão deles, só da ocupação da thread.
- `Renderer.desenhar` A/B intercalado (JS puro | com descarga do raster; software; em GPU as razões foram parecidas): pausado 0,7 → 0,0 ms; enquadrado 0,6 →
  0,6 (paridade — o enquadrado já era barato: 720 retângulos); heatmap 1,0 → 0,6; **zoom 0,3 com rótulos 2,9 → 0,5** (raster 6,0 → 3,9, 0,65×);
  zoom 1,0 2,3 → 0,2; pan contínuo 2,8 → 1,5.
- DOM: HUD de 60/s → ≤ 10/s e **0/s pausado**; log de 60/s → 10/s (a chamada só reconstrói o DOM com evento novo).
- Meta "60 FPS no WH-B a 5x com folga": atendida nesta máquina (60 fps nos dois modos, JS ≈ 1,5–2 ms de 16,7 ms, thread ≈ 45%; 22% a 1x e ~3%
  pausado).

**Aparência**: sem regressão visível (capturas antes × depois, `capturas.mjs`: 11 cenas, estado fixo; ≤ 1,1% dos pixels diferem, no máximo 43/255,
sempre as bordas verticais de 1 px entre vãos). Causa: as bordas agora são pintadas depois de TODOS os preenchimentos (antes cada vão
pintava a sua e o próximo vão cobria metade dela), então a coluna à direita de cada divisória ficou um pouco mais escura. O resto é idêntico,
inclusive os rótulos pela camada.

**Decisão sobre PixiJS (no papel): não adotar agora.** O cenário é ~720 retângulos, 8 círculos e rótulos; o `desenhar` custa 0,2–1,5 ms de JS e a
thread passa de 45% a 5x. PixiJS acrescentaria dependência (~100+ KB gz), perda de contexto WebGL no WebView, texto por BitmapText/SDF e
hit-testing próprio, sem gargalo que o justifique. Reavaliar se (a) aparecer cenário com ≫ 10 000 locais, ou (b) a medição em celular real/APK
(`?perf=1`) mostrar JS ≥ 8 ms por quadro a 5x. Degraus antes dele: camada de ocupação como textura de baixa resolução e `devicePixelRatio` correto.

**Pendências**

- [ ] **Tutorial curto do primeiro cenário** (depois da F4).
- [ ] **`devicePixelRatio`**: o canvas é 1 px de bitmap por px de CSS; em celular (DPR 2–3) fica borrado. Pede `width = CSS × DPR` com a câmera
  e o `input` em px de CSS e o `Renderer` aplicando o DPR — mexe nos três, fica para o F7 (e aumenta o custo de raster 4–9×: medir de novo).
- [ ] Medir em aparelho real/APK com `?perf=1` (aqui só há headless: GPU Intel por ANGLE/Vulkan e compositor em software).
- [ ] `Drawer.atualizarLog` ainda refaz 50 `li` por evento novo (5–8 ms com layout); agora ≤ 10×/s, mas é incremental por natureza (`src/ui`, fora do escopo).
- [ ] Ao redimensionar, o enquadramento inicial pode ficar fora de escala (o centro é preservado, o zoom não): quem quiser reenquadrar ao girar o
  celular chama `enquadrar()` no `ResizeObserver` (decisão de UX da F4/F7).

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
