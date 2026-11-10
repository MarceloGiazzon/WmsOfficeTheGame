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
  na prática, estoques iniciais diferentes. **Corrigido em `297c8ef`** (desempate por `produto.codigo`, não por id): as 4
  políticas dão métricas idênticas com UUIDs e com aliases. Conferido na F5 no navegador: o mesmo turno do WH-A (Curva ABC)
  fecha em **85,52** jogando com o pacote do servidor, do cache e embutido.

### N5. Mount do jogo e CORS ✅ (2026-11-10)

Como ficou — **o jogo abre em `http://localhost:8200/jogo/index.html`** (mesma origem que `/api`, sem CORS):

- [x] **`npm run deploy:npdev`** = `tsc` + `vite build --base=/jogo/ --outDir backend/npdev/web/jogo --emptyOutDir`. O Vite escreve
  direto em `web/jogo/` (sem passar por `dist/`) e esvazia a pasta antes, então assets antigos com hash não se acumulam
  (conferido com um arquivo-isca). `npm run build` e `npm run dev` não mudaram (base `/`; dev com proxy `/api → :8200`);
  o `vite.config.ts` ficou intacto — o base vai só na linha de comando do deploy.
- [x] **Mount sem registro manual.** O generator copia `web/` **recursivamente** para os estáticos do app
  (`FinalAppAssembler.mountWebAssets`): subpastas e nomes com hash servem, sem manifesto, menu nem `pages.json`. Só são
  ignorados diretórios `build`/`libs`/`out`/`target`/`node_modules`/… e arquivos `.log`/`.tmp`/`.bak`/`.iml`, e a geração
  falha se algo colidir com nomes reservados da plataforma (`shell.js`, `info.html`, `npdev-ui/`…) — a saída do Vite não colide.
- [x] **Sem login para o estático**: `/jogo/**` responde 200 sem token, como as demais páginas. O login é feito pelo próprio
  jogo, em `fetch('/api/auth/login')` (F5).
- [x] **`web/jogo/` não é versionado** (`.gitignore`): é artefato gerado. Em contrapartida, a geração recria `App/` e apaga
  o que não vem de `web/`, então o jogo tem de estar em `web/jogo/` **antes** de gerar. O **`rebuild.sh` roda o
  `deploy:npdev` sozinho** — logo após validar o modelo e antes de parar o app, para um erro de TypeScript não derrubar o
  backend que está de pé —, confere que `web/jogo/index.html` saiu e, no fim, que `/jogo/index.html` responde 200.
  `rebuild.sh --sem-jogo` pula o front (usa o que já estiver em `web/jogo/`; sem ele, o app sobe sem o jogo).
- [x] Passo a passo em [NPDEV_LINUX.md](NPDEV_LINUX.md#jogo-em-8200jogo-n5) e em `backend/npdev/README.md`.

**Validação ao vivo** (rebuild sem `--reset-db`, app novo em `:8200`):
- `curl`: `/jogo/index.html` 200 `text/html`; `assets/*.js` 200 `text/javascript` (inclui os chunks dos cenários, carregados
  por `import()` dinâmico sob `/jogo/`); `assets/*.css` 200 `text/css`; asset inexistente 404.
- Chrome headless: console **sem nenhuma mensagem** e nenhuma requisição falha; o relógio simulado avança (08:00:52 → 08:02:23
  em 3 s), a 1ª ordem é liberada, o canvas desenha o armazém, a troca para `WH-B-MEGA` carrega (400 ordens).
- Da própria página, `fetch('/api/auth/login')`: **200** com `admin`/`Teste123!` (token JWT) e **401** `invalid_credentials` com senha errada.
- Páginas originais intactas: `/mapa-armazem.html`, `/login.html`, `/theme.css` → 200. `n2_simulacao_flows.py` e
  `n3_jogador.py` → 0 falhas.

**Limitação do NPDev:** `GET /jogo/` (e `/jogo`) devolve **404** — o Spring só serve `index.html` na raiz (e `/` é um
redirect do `UiRedirectController` gerado para `/npdev-ui/index.html`), não em subdiretórios, e o NPDev não tem como declarar
uma rota/redirect extra: o controller é um template fixo do generator, sem opção em `config.json`. Por isso a URL oficial leva
`index.html`. Descartado: um `jogo.html` solto na raiz só moveria o problema (`/jogo/` seguiria 404); *panels*/*widgets* de
extensão exigem login e papel; um proxy reverso só existiria fora do NPDev. (O marco M3 e a D5 dizem `:8200/jogo/` por
brevidade: leia `:8200/jogo/index.html`.)

Pendências:
- Se o jogo virar app Capacitor (F7), a origem passa a ser `capacitor://localhost` e aí o CORS do NPDev precisa ser conferido
  (as respostas já trazem `Vary: Origin`; não foi testado). Na web, mesma origem: não há CORS a configurar.
- Link para o jogo no menu do workspace do NPDev (`definition/menu.json`): opcional, não feito.

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

### F4. HUD e gameplay ✅ (2026-11-10, exceto o que depende do backend — fica para a F5)

Como ficou (`npm test`: 189 testes; verificado no Chrome headless em 1280×800 e 390×844: pré-partida, WH-A e WH-B jogando,
troca de política, resultado, teclado e foco, sem erros no console; os números do breakdown conferidos contra
`calcularScore` com uma réplica determinística rodada na própria página):

```
src/app/  fonteCenarios.ts (interface FonteCenarios + resumirCenario) · fonteEmbutida.ts (implementação atual)
          resultado.ts (ResultadoPartida, breakdown do score, linha do tempo, extras da F5) · politicasTexto.ts
          formato.ts · atalhos.ts          ← tudo puro, com teste
src/ui/   preJogo.ts · resultado.ts (TelaResultado) · modal.ts (foco, Esc, inert) · dom.ts · hud.ts · drawer.ts
src/sim/  simulation.ts: só `trocasPolitica()` e `Snapshot.trocasPolitica` (aditivo; métricas, score e goldens intocados)
```

- [x] **Pré-partida** (abre ao carregar, em "Trocar cenário / reiniciar…" no drawer e em "Trocar cenário / política"
  no resultado): cartões com nome,
  dificuldade, ordens (entradas/saídas), locais, empilhadeiras, docas e horário do turno — tudo derivado do
  `PacoteCenario` (`resumirCenario`) — e a política com a regra de cada uma das cinco (só a regra, sem prometer resultado).
  O relógio fica parado e a sim nem existe até "Iniciar turno". Aberta no meio do jogo, pausa a sim; Esc / "Voltar à
  partida" retoma de onde parou, e o rodapé avisa que iniciar outro turno descarta o atual.
- [x] **`FonteCenarios`** (`listar()` + `carregar(codigo)`, cada cenário com `origem`: `'embutido' | 'cache' | 'rede'`,
  mostrada como selo no cartão e no resultado). Só há a `FonteEmbutida`; a F5 pluga rede/cache implementando a mesma
  interface (e `resumirCenario` serve a qualquer fonte que tenha o pacote). `Jogo.fonte` é o único ponto a trocar.
- [x] **Troca de política no turno**: o seletor do drawer, o chip "Política ativa" no HUD (clicar abre o seletor), aviso
  ao lado do seletor ("vale para os próximos paletes guardados; os que já estão a caminho seguem como estavam"),
  destaque no log e animação no chip. A sim registra: `Simulacao.trocasPolitica(): {seg, politica}[]` (a inicial em
  `inicioTurnoSeg`), também em `Snapshot.trocasPolitica`. Decisões: trocas no mesmo segundo simulado valem pela última
  (nenhuma alocação aconteceu entre elas; voltar à política anterior apaga a troca) e `setPolitica` depois do fim do turno
  é ignorada — o histórico só guarda o que pôde ter efeito.
- [x] **Resultado** (modal ao fim do turno, sim parada no estado final do mapa): score grande; breakdown com uma linha em
  linguagem simples e a barra de cada termo (distância, atraso, conflito, bônus de ocupação) e a conta
  `100 − penalidades + bônus`; métricas (concluídas, atrasadas, km real × teórico, conflitos, ocupação); linha do tempo
  das políticas; "Jogar de novo" (com a política **inicial** do turno — o botão diz qual), "Trocar cenário / política" e
  "Ver o armazém" (Esc). O botão "Ver resultado" no HUD reabre. Os limites da fórmula (35/40/15/5 pts etc.) são
  repetidos em `LIMITES_SCORE` porque `score.ts` não os exporta; `resultado.test.ts` os confere contra `calcularScore`.
- [x] **Slot da F5**: `TelaResultado.mostrarResultado(resultado, extras?)` com
  `extras = { validadoServidor?, posicaoRanking?, ranking?, mensagem?, origem? }`. Pode ser chamado de novo com o modal
  aberto (a tela se atualiza sem mexer no foco). Sem `validadoServidor` = "partida local — não enviada ao ranking". No
  `Jogo`, `publicarResultado` (null por padrão) é o gancho: recebe o `ResultadoPartida` (métricas + política + trocas —
  o que o `ConcluirPartida` precisa) e devolve os extras quando o servidor responder.
- [x] **Pausa e teclado**: pré-partida e resultado pausam; espaço (pausa/retoma) e 1/2/5 (velocidade) só valem com o turno
  em andamento, sem modal aberto e sem foco em botão/seletor/campo (`atalhos.ts`). Clicar num botão com o mouse devolve o
  foco ao corpo, senão o espaço "clicaria de novo" nele. Modais: o app atrás fica `inert`, Tab dá a volta, Esc fecha onde
  faz sentido (não na pré-partida de abertura), foco volta para onde estava; o foco inicial vai no cenário marcado / no
  diálogo — nunca num botão de ação, que um espaço de quem pausava acionaria.
- [x] **HUD**: score parcial/final em destaque (primeiro da faixa no celular), ordens concluídas/total + liberadas,
  atrasadas em vermelho, distância com a teórica, faixa de estado com cenário, política ativa e situação do turno
  (pausado, em andamento, encerrado). O canvas agora acompanha o tamanho do contêiner (`ResizeObserver`): abrir/recolher o
  drawer não estica mais o mapa.
- [x] Relógio 08:00–18:00, pausa/1x/2x/5x (F1). KPIs ao vivo (F2). Inspector com dados reais — falta lote/quantidade (o
  pacote não tem). Heatmap de acessos real (F2).
- [x] **Comparação com o ranking** na tela de resultado, origens `'rede'`/`'cache'` na `FonteCenarios`, envio do resultado e
  `validadoServidor`: feitos na F5 (UI de rede) e verificados ao vivo contra o backend.

Pendências visíveis (fora do escopo da F4): o canvas não usa `devicePixelRatio` (o mapa fica borrado em telas de alta
densidade — F6); a pré-partida mostra só o cartão, sem pré-visualização do armazém (montar a `Simulacao` do WH-B leva
~0,2 s, e o modal cobre o mapa).

### F5. Integração com o NPDev ✅ (2026-11-10): camada de rede + UI

A camada de rede está pronta e testada em `src/net/` (módulos puros: sem DOM, `fetch`/relógio/armazenamento injetados) e
**ligada à UI** (login, fonte de cenários, partida online, fila de envio — seção "Como ficou a UI" abaixo).

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

**Como ficou a UI** (F5 completa; `npm test`: ver rodapé desta seção; verificado no Chrome headless contra a 8200):

```
src/app/  sessao.ts (convidado/logado, sessionStorage, expiração) · fonteRede.ts (servidor → cache → embutido)
          partidaOnline.ts (iniciar/concluir/desistir + extras do resultado) · sincronizador.ts (estado e gatilhos da fila)
          abandonos.ts · rankingTabela.ts · mensagensRede.ts · configRede.ts   ← puros, com teste (ServidorFalso)
          appRede.ts (cola: único módulo app/ que toca o DOM, via ui/)
src/ui/   login.ts · indicadorRede.ts · filaPendentes.ts · avisos.ts · rede.css   (estilos próprios; style.css/index.html intactos)
```

- [x] **Login e sessão.** Modal com usuário/senha; erro por `NpdevError.tipo` em `mensagemDeErro` (401 "Usuário ou senha
  inválidos", rede caída com a saída "jogue como convidado", timeout, 5xx com o HTTP, resposta que não é do NPDev, 403 "falta a
  role Jogador"). Cabeçalho: "● usuário [Sair]" ou "Convidado [Entrar]". **Primeira abertura** oferece login ou
  **"Jogar como convidado"** (botão ou Esc; zero chamadas de rede) — a escolha vale pela aba (sessionStorage), então um F5 não
  pergunta de novo. JWT só na memória do `NpdevClient`; copiado no `sessionStorage` (por aba, tudo em try/catch — janela privada
  faz o acesso lançar e o jogo segue sem restaurar). Expiração por 401 (`aoSessaoExpirar`) **ou** por temporizador (o token vale
  8 h): volta a convidado com aviso, **sem mexer na partida em andamento** — se ela terminar sem login o resultado fica na fila
  DO DONO e vai quando ele entrar de novo. URL base: `import.meta.env.VITE_NPDEV_URL` (`configRede.ts`; vazia = `/api`; o
  `/api` é acrescentado, e o sufixo duplicado é tolerado). Chamada absoluta no APK é cross-origin: falta o CORS (N5).
- [x] **Fonte de cenários** (`FonteRede`). `listar()`: logado → `listarCenarios` mesclado com cache e embutidos; convidado →
  só cache/embutido, **sem chamada**. Os números do cartão vêm do último pacote conhecido (cache, senão embutido); cenário que
  só o servidor tem é baixado uma vez. `carregar()` = `obterPacote` e devolve a origem REAL (`rede`/`cache`/`embutido`) + `aviso`:
  "Sem conexão com o servidor (…): usando o cenário guardado neste aparelho em 10/11 13:00". A lista também avisa (faixa acima
  dos cartões) quando o servidor não respondeu ou quando é modo convidado. O selo de origem do cartão é a origem ESPERADA; o
  resultado mostra a real.
- [x] **Partida online** (`PartidaOnline`, uma por turno). Logado e pacote da rede → `iniciarPartida` em segundo plano (falhar
  não atrapalha: o jogo segue e a fila cria a partida no envio); pacote embutido/cache não chama (o `cenario.id` do embutido é
  alias do seed). `iniciadaEm` é o mesmo no POST e na fila (chave de idempotência). Fim do turno → `fila.registrar` (guarda
  ANTES de enviar) → `ranking()`. **Tela de resultado** (`extras` da F4): "Enviando…", `validadoServidor`, posição, tabela com
  **top 10 + a linha desta partida** (posições reais e "⋮" no salto), total de partidas validadas, selo da origem; **score que o
  servidor recalculou diferente NÃO é escondido**: "O servidor recalculou o score em 81,52 (o jogo calculou 85,52). A partida foi
  registrada com o valor do servidor, mas fica fora do ranking" (e a partida fica na lista de rejeitadas); recusa (métricas
  inválidas…) mostra o motivo; sem rede → "Partida salva para envio quando a rede voltar"; sem onde guardar E sem rede → "não foi
  possível enviar nem guardar". A `SimPartida` leva a política **inicial** do turno (trocas ficam só no resultado local).
  **Desistir** (trocar de cenário/reiniciar no meio) → `abandonarPartida`; se falhar por rede/login o pedido fica guardado
  (`abandonos.ts`, prefixo `abandono:`) e é refeito a cada sincronização. **Sair** no meio do turno abandona a partida do
  usuário (espera no máx. 2,5 s) e o turno segue como local.
- [x] **Fila de envio** (`Sincronizador`). `sincronizar()` ao logar, ao restaurar a sessão na abertura, no evento `online` (que
  também confere a sessão), no fim de cada partida e no botão "Enviar agora". Indicador na faixa de estado: "N partidas
  pendentes [Enviar agora]" e "N rejeitada(s) pelo servidor" (somem com a fila vazia); abre a visão "Partidas para enviar" —
  cada item com cenário, política, score, data, situação e motivo; **Tentar de novo** (rejeitada) e **Descartar** (com
  confirmação, porque o item é a única cópia da partida). Aviso temporário a cada rodada que enviou/rejeitou algo.
- [x] **Decisão — convidado que joga sem rede NÃO guarda a partida.** Sem dono não há como provar de quem é, e uma fila anônima
  juntaria resultados que ninguém reivindica; o que há de honesto e simples é o botão **"Entrar e enviar esta partida"** no
  resultado do convidado: o resultado fica só na memória da aba, e depois do login vai para a fila do usuário que entrou (fechou
  a aba antes? perdeu — e o resultado já avisou "não foi enviada nem guardada").

**Evidência** — `npm test`: 427 passam (+12 ao vivo pulados; eram 338: +89 desta etapa, todos com `ServidorFalso`: sessão,
fonte, partida online, fila/sincronizador, ranking, mensagens, base da API); `typecheck` e `build` limpos. **Ao vivo** (Chrome
headless 1280×800 e 390×844, vite `:3300` → `:8200`, `teste-jogador-2`, relógio acelerado por script; 44 verificações, console
sem erros — as 7 mensagens "Failed to load resource" são das requisições que o próprio teste bloqueou/negou):
- 1ª abertura oferece login/convidado e não faz nenhuma chamada `/api`; senha errada → "Usuário ou senha inválidos."; rede
  cortada → mensagem de rede com a saída "convidado".
- Logado: pré-partida com origem **Servidor** nos dois cenários → WH-A até o fim: **score 85,52 validado pelo servidor, 1º no
  ranking**, tabela com a minha linha em destaque. Mesmo turno com a rede cortada: aviso "usando o cenário guardado neste
  aparelho", origem **Em cache**, 85,52 de novo, "Partida salva para envio quando a rede voltar", "1 partida pendente".
  Recarregar sem rede: sessão restaurada e fila intacta (IndexedDB), pré-partida avisa e mostra cache/embutido. Religar (evento
  `online`): sincroniza sozinha, "1 partida enviada ao servidor".
- Score que o servidor recalcula diferente (adulterei as métricas no `fetch`): "recalculou o score em 81,52 (o jogo calculou
  85,52) … fora do ranking", "1 rejeitada pelo servidor", visão com o motivo e descarte com confirmação.
- Telefone: convidado joga o turno inteiro com **zero** chamadas `/api`; "Entrar e enviar esta partida" → login → validado, 3º
  lugar, sem rolagem horizontal. Banco: 4 partidas `Concluida` e 4 scores (nenhuma duplicada nem `EmAndamento`), apagados pelo
  admin no fim. Achados e corrigidos ali: o aviso temporário cobria o rodapé dos modais no celular (agora no topo e sem capturar
  cliques) e a frase da queda de rede repetia a causa.

- [ ] `VERSAO_MOTOR` (`partidas.ts`) é manual: subir quando uma regra do motor mudar.
- [ ] Política **WmsReal online** (flow `SugerirDestinoJogo`, D2) continua só com a porta TS offline.
- [x] ~~Desempate da curva ABC por `codigo` em vez de `id`~~ — feito em `297c8ef` (online e offline jogam o mesmo estoque inicial: 85,52 nos dois, conferido no navegador).
- [ ] Pendências da UI: o aviso/retentativa não tem *backoff* (só `online` e o botão); a sessão não é validada no servidor ao restaurar (o 1º 401 derruba); item de outro usuário do mesmo aparelho fica invisível para quem está logado; o `index.html`/cabeçalho foram só encaixados por JS — se o layout mobile reorganizar o cabeçalho, ajustar os dois pontos de encaixe em `indicadorRede.ts`.

### F6. Escala e polimento ✅ (2026-11-10)

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

- [x] **Tutorial curto do primeiro cenário** (2026-11-10): guia de 8 passos com destaque nos elementos reais (véu escuro com
  "furos" em SVG + balão): o mapa (docas, racks, empilhadeiras), relógio e velocidade, ordens e SLA, score parcial, política
  (o que é e como trocar), inspector, log (abre a gaveta e a devolve como estava) e o botão "?". Abre sozinho **no primeiro
  turno de quem nunca o viu** (flag `wmsoffice.tutorial.visto` em `localStorage`, com `sessionStorage` de reserva se ele
  lançar — sem nenhum dos dois, só uma vez por carregamento da página, nunca em loop); **pausa a sim** enquanto aberto e
  a retoma ao fechar; pula a qualquer momento (botão "Pular" ou Esc); reabre pelo "?" do cabeçalho. Acessível: `role="dialog"`
  modal com título/texto associados, app `inert`, foco preso e devolvido (o mesmo `Modal` da pré-partida, que também desliga
  os atalhos do jogo), setas navegam, texto em região `aria-live`. O balão se reposiciona (abaixo/acima/lado/dentro do
  alvo) e nunca sai da tela, inclusive na área segura do celular. Lógica pura e testada em `src/app/tutorial.ts` (passos,
  máquina de estados, flag, quando mostrar) e `src/app/balao.ts` (geometria do balão); tela em `src/ui/tutorial.ts` +
  `tutorial.css`. Gancho no `main.ts`: `aoAbrir`/`aoFechar` (pausa/retoma) e `abrirSeNovato()` ao fim de `iniciarPartida`.

**Pendências**

- [ ] **`devicePixelRatio`**: o canvas é 1 px de bitmap por px de CSS; em celular (DPR 2–3) fica borrado. Pede `width = CSS × DPR` com a câmera
  e o `input` em px de CSS e o `Renderer` aplicando o DPR — mexe nos três, fica para o F7 (e aumenta o custo de raster 4–9×: medir de novo).
- [ ] Medir em aparelho real/APK com `?perf=1` (aqui só há headless: GPU Intel por ANGLE/Vulkan e compositor em software).
- [ ] `Drawer.atualizarLog` ainda refaz 50 `li` por evento novo (5–8 ms com layout); agora ≤ 10×/s, mas é incremental por natureza (`src/ui`, fora do escopo).
- [ ] Ao redimensionar, o enquadramento inicial pode ficar fora de escala (o centro é preservado, o zoom não): quem quiser reenquadrar ao girar o
  celular chama `enquadrar()` no `ResizeObserver` (decisão de UX da F4/F7).

### F7. Mobile (Capacitor)

Detalhes, comandos e decisões em [`MOBILE.md`](MOBILE.md). Estado em 2026-11-10: **empacotamento feito e verificado na
máquina de desenvolvimento; nada foi executado em aparelho ou emulador.**

- [x] **Capacitor 6.2.3 + Android** (`@capacitor/core|android|cli`, versão fixa — a 6.x mais recente; Node 18/JDK 17 desta
  máquina atendem ao 6, a 8.x `latest` exigiria Node 20+/JDK 21), `capacitor.config.ts` (`appId br.com.wmsoffice.thegame`,
  `appName "WmsOffice: The Game"`, `webDir dist`, `androidScheme https`, **sem** `server.url`) e projeto `android/`
  versionado sem builds. Scripts `cap:sync`, `cap:abrir`, `apk:debug`, `apk:instalar`.
- [x] **Ajustes de jogo**: tela cheia imersiva, tela sempre ligada, conteúdo sob o notch, orientação livre
  (`user` — paisagem é melhor, mas não há motivo para travar), ícone/splash do próprio favicon do jogo. `cleartext`
  só no build debug (NPDev em http na LAN); release continua bloqueando. Conferido nos manifestos mesclados.
- [x] **Geração do `.apk` debug**: SDK instalado sem sudo em `~/Android/Sdk` (cmdline-tools + platform 34 + build-tools
  34.0.0); `npm run apk:debug` → `BUILD SUCCESSFUL`, `android/app/build/outputs/apk/debug/app-debug.apk`, 3,4 MiB
  (não versionado). Inspecionado com `aapt`/`apksigner`: pacote, `minSdk 22`/`targetSdk 34`, só `INTERNET`, assets
  idênticos ao `dist/`.
- [x] **Pacote web offline** (o que vai dentro do APK), em Chrome headless servindo `assets/public` em `https://localhost`
  com toda a rede bloqueada: sem erro de JS, sem `/api`, sim anda (1x/5x), `WH-B-MEGA` carrega. A única requisição
  externa daquele teste (as fontes do Google) deixou de existir: as fontes agora são locais.
- [ ] **Teste em aparelho/emulador**: instalar o APK, modo avião, imersivo, rotação, toque, FPS no `WH-B-MEGA`,
  segundo plano (lista em `MOBILE.md`).
- [x] **Layout de toque do HUD/drawer** (2026-11-10): `viewport-fit=cover` + `env(safe-area-inset-*)`; HUD compacto (relógio,
  ordens, atrasadas e score sempre visíveis; distância/conflitos/ocupação num painel que o botão abre por cima do mapa);
  gaveta como bottom sheet sobreposto ao mapa, fechada por padrão no celular (pílula) e arrastável pela alça; inspector em
  faixa; alvos ≥ 44 px (também em tablet, por `pointer: coarse`); `tap-highlight`/`overscroll-behavior`/`touch-action:
  manipulation` nos controles. Mapa com 70–75% da altura em paisagem (800×360 e 844×390) e ~80% em retrato. Verificado em
  1280×800, 390×844, 844×390 e 800×360 (sem transbordo, sem erro de console, sem request externo). **Fontes locais:**
  Plus Jakarta Sans e JetBrains Mono (OFL) em `public/fonts/` + `src/ui/fontes.css`; o `<link>` do Google saiu. Detalhes
  em `MOBILE.md`. A **pinça** e o centralizar na seleção são da F6 (módulo de entrada do mapa) e estão feitos.
- [x] Fluxo offline completo (cenário em cache → jogar → fila → sincronizar ao religar) verificado **no navegador** (F5, rede cortada
  no Chrome headless). **Falta** o mesmo no APK, em aparelho/emulador.
- [ ] Base do `NPDevClient` no APK por URL absoluta (`VITE_NPDEV_URL`, com troca em tempo de execução) e CORS de
  `https://localhost` no NPDev (N5) — **documentado** em `MOBILE.md`, não implementado (F5/N5).
- [ ] Build **release** (assinatura/keystore, AAB, minificação) — fora do escopo desta fase.

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
