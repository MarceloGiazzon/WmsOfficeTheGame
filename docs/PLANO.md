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
  sim (F2) gera a ocupação inicial a partir do seed do cenário (decisão para a F2).
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

### F1. Separação sim / render / ui

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

### F2. Núcleo da simulação (com mock local)

- [ ] Layout a partir de `Rua.qtdPosicoes × qtdAndares`; docas a partir das `Area` de recebimento/expedição.
- [ ] Ordens liberadas por `liberacaoSeg`; fila por doca.
- [ ] Inbound: política escolhe o local → tarefa de putaway → equipamento livre mais próximo.
- [ ] Outbound: `sugerirOrigem` (FIFO por validade) → tarefa de picking → doca de saída.
- [ ] Equipamentos percorrem o grafo de corredores; tempo de descarga/carga.
- [ ] Conflito: dois equipamentos no mesmo segmento de corredor estreito → espera + evento.
- [ ] SLA: ordem concluída após `liberacaoSeg + slaSeg` → atrasada.
- [ ] `distanciaTeorica`: soma das distâncias mínimas doca↔local de cada ordem com a alocação ótima por giro (definição fechada aqui e documentada).
- [ ] Testes: mesmo seed + mesma política → métricas idênticas (golden tests).

### F3. Políticas

| Política | Base |
| --- | --- |
| `FifoPrimeiraLivre` | primeiro `LocalArmazenagem` `Disponivel` na ordem de varredura |
| `AbcProximidade` | classe por frequência de saída; A nas posições de menor distância até a expedição |
| `Consolidacao` | prefere local com o mesmo produto/lote (porta de `sugerirDestino`) |
| `CrossDocking` | se existe outbound pendente do produto → doca a doca (porta de `candidatosCrossDocking`) |
| `WmsReal` | online: flow `SugerirDestinoJogo`; offline: porta TS de `sugerirDestino` + `RankingRua` |

- [ ] **Testes de paridade TS × Java** com fixtures JSON compartilhadas (executadas contra o flow quando o backend estiver de pé).

### F4. HUD e gameplay

- [ ] Tela de seleção de cenário e política (pré-partida).
- [ ] Relógio 08:00–18:00, pausa/1x/2x/5x (já existe, religar à sim).
- [ ] KPIs ao vivo: ordens concluídas/atrasadas, distância, ocupação, conflitos.
- [ ] Inspector com dados reais (Rua-Posição-Andar, produto, lote, quantidade, acessos).
- [ ] Heatmap de acessos real (contado pela sim, não aleatório).
- [ ] Troca de política durante a partida (registrada na partida; afeta só alocações futuras).
- [ ] Tela de resultado: breakdown das penalidades, score e comparação com o ranking.

### F5. Integração com o NPDev

- [ ] `NPDevClient` reescrito: base `/api` (proxy/mesma origem), JWT, erros explícitos (sem sucesso falso).
- [ ] Login (reaproveitar `/api/auth/login`); modo convidado = offline.
- [ ] Carregar o pacote do cenário (N4) → cache em IndexedDB para offline.
- [ ] Fim de partida: `ConcluirPartida` → mostrar `validadoServidor` e a posição no ranking.
- [ ] Fila de envio offline: partidas jogadas offline enviadas quando a rede voltar.

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
