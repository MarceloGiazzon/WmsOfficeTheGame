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

### D4. Os concepts de jogo ficam isolados dentro do WmsOffice

- Prefixo `Sim*` e role própria (`JOGADOR`), sem alterar o comportamento dos concepts de WMS.
- Topologia do cenário **reaproveita** `Armazem/Area/Rua/LocalArmazenagem` (um `Armazem` por cenário),
  para que o mapa existente e as capabilities funcionem sem adaptação.
- **Decidido (2026-11-10):** concepts `Sim*` dentro do `_official/WmsOffice` (alternativa descartada: fork em `_experiments/WmsOfficeGame`).

### D5. Mesma origem em produção

- O generator monta `web/` como estáticos do app. O build do Vite vai para `web/jogo/` → servido em
  `http://localhost:8100/jogo/`, sem CORS. Em dev, proxy do Vite `/api → :8100`.

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
- §6: score final = `min(100, max(0, 100 − (P_dist + P_atraso + P_conflito)) + B_ocup)`; recalcular a tabela 6.2
  (Estratégia B → 100,0 com o teto, ou ajustar os números de exemplo).
- §2: porta 8100, JWT, motor no cliente (D1/D2).
- §7: substituir o roadmap pelo deste plano.

---

## 3. Fases — Backend (NPDev / WmsOffice)

### N0. Ambiente Linux + baseline (pré-requisito)

Hoje os scripts são PowerShell com caminhos `D:\WorkSpace\...` fixos (`config.json`, `Build-NpdevApp.ps1`).
Nesta máquina já existem `pwsh`, Java 17 e Docker.

- [ ] Parametrizar `outputRoot`, `bootstrap.root`, `artifact.root`, `finalExec.root` (ou gerar `config.json` por máquina).
- [ ] Gerar as chaves JWT (`jwt-private-pkcs8.pem`/`jwt-public.pem`) para Linux.
- [ ] Rodar `Build-NpdevApp.ps1` → `Build-App.ps1` → `Start-App.ps1` → `Test-App.ps1` via `pwsh`.
- [ ] `bootstrap-admin`, login, `GET /api/ruas` e abrir `mapa-armazem.html`.
- [ ] Decidir D4 (`_official` vs fork).

**Pronto quando:** o WmsOffice atual sobe no Linux e o `Test-App.ps1` passa.

### N1. Concepts de simulação

Arquivos novos em `definition/concepts/`, referenciados no `model.json`:

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

**Pronto quando:** CRUD REST dos 4 concepts funciona com os bonds e o lifecycle validados ao vivo.

### N2. Capability `simulacao` (Java puro)

Nova pasta `definition/capabilities/simulacao/`, mesmo padrão de `alocacao`:

| Operação | Entrada → Saída |
| --- | --- |
| `calcularScore` | métricas → `{ penalidades, scoreCentesimos }` (fórmula oficial, inteiros) |
| `validarScore` | métricas + score do cliente → `{ valido, scoreRecalculado }` |
| `gerarOrdens` | `{ seed, params, produtos[] }` → lista de `SimOrdem` (para o seeding dos cenários) |

Flows (cada um declarando `concept`):
- `CalcularScoreSimulacao` — chamado pelo cliente ao fim da partida.
- `ConcluirPartida` — `capabilityCall validarScore` → `branch` → `createConcept SimScore` + `updateConcept SimPartida → Concluida`.
- `SugerirDestinoJogo` — reaproveita `AllocationCapability.sugerirDestino` (política `WmsReal`).

**Pronto quando:** os testes unitários da capability batem com os exemplos do README (após a correção do §2).

### N3. Queries, seeds e role

- Queries: `CenariosAtivos`, `OrdensPorCenario` (via dataSource de panel, que filtra), `RankingPorCenario` (top N por `scoreCentesimos`).
- Role `JOGADOR`: leitura de cenários/ordens/topologia, escrita só em `SimPartida`/`SimScore` próprios.
- Seeds (`definition/seeds/`): **2 cenários** iniciais
  - `WH-A-PEQUENO`: 4 ruas × 12 posições × 1 andar, 2+2 docas, 3 equipamentos, ~60 ordens.
  - `WH-B-MEGA`: 12 ruas × 30 posições × 4 andares, 4+4 docas, 8 equipamentos, ~400 ordens.
  - Produtos com frequência de saída definida (gera a curva ABC naturalmente).
- Panel de administração: `SimCenario` + `RankingPorCenario`.

**Pronto quando:** um usuário `JOGADOR` lista os cenários e as ordens e grava uma partida com score, e recebe 403 fora do seu escopo.

### N4. Endpoint de "pacote do cenário"

O cliente precisa de **uma chamada** que traga tudo para jogar offline:

```
GET cenário → { cenario, armazem, areas[], ruas[], locais[], produtos[], ordens[], rankingRuas[] }
```

- Opção A: várias chamadas REST montadas no cliente (funciona já, sem mudar o NPDev).
- Opção B: procedure/flow `PacoteCenario` (depende do limite 0.2-2).
- **Começar com A**; migrar para B se a latência incomodar.

### N5. Mount do jogo e CORS

- Script `npm run deploy:npdev` → `vite build` → copia `dist/` para `WmsOffice/web/jogo/`.
- Validar `http://localhost:8100/jogo/` com login via `/api/auth/login`.

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
3. **M3 — Integrado**: F5 + N4/N5, servido em `:8100/jogo/`, ranking funcionando.
4. **M4 — Mobile**: F6–F7, APK offline.

---

## 6. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Build do NPDev não roda no Linux (paths `D:\`, file locks, pwsh) | Bloqueia M2 | N0 primeiro; trilha front segue com mock |
| Divergência TS × Java nas regras de alocação | Score "WmsReal" inconsistente | Fixtures compartilhadas + testes de paridade |
| Limites de procedures (sem filtro) | Pacote do cenário lento | Opção A (várias chamadas) + cache |
| Score falsificável no cliente | Ranking não confiável | `validarScore` recalcula a partir das métricas; replay completo (seed + log de decisões) fica para depois |
| Mexer no `_official` quebra o WMS | Regressão | Concepts `Sim*` isolados + `Test-App.ps1` antes de cada merge; ou fork (D4) |
| Performance no cenário mega em celulares | UX ruim | Medir na F6; canvas em camadas / PixiJS |

---

## 7. Questões em aberto

1. ~~**D4**~~: decidido — `_official/WmsOffice` com prefixo `Sim*`.
2. O NPDev será mantido nas duas máquinas (Windows e Linux)? Se sim, `config.json` por máquina vai para fora do git.
3. O ranking é global ou por usuário/tenant?
4. Haverá validação por replay (o servidor reexecuta a partida)? Isso exige o motor em Java também — fora de escopo por ora.
