# WmsOffice: The Game

Documento executivo de visão, arquitetura e gameplay.

## 1. Visão geral e proposta do projeto

O WmsOffice: The Game é um jogo de simulação e estratégia logística voltado à engenharia de operações de armazenagem. O projeto tem origem no sistema WmsOffice, desenvolvido entre 2011 e 2013 em GeneXus, e foi reconstruído sob o framework NPDev (Spec-Driven Development para Spring Boot).

A proposta central é converter regras reais e complexas de gestão de depósitos em mecânicas estratégicas de simulação. O jogador:

- Assume a gestão física e lógica de um Centro de Distribuição (CD).
- Configura regras de endereçamento, perfis de alocação de paletes (putaway), políticas de separação (picking) e fluxos de transferência direta (cross-docking).
- Avança o tempo por turnos ou em velocidade acelerada (1x, 2x, 5x), consumindo filas de ordens operacionais.
- Mede e compara a eficiência de suas decisões por meio de indicadores técnicos de desempenho (KPIs) e de uma pontuação consolidada contra cenários padronizados de estresse.

## 2. Tech stack e arquitetura

O projeto adota uma arquitetura desacoplada: o **motor da simulação roda no cliente** (TypeScript determinístico, por seed), o que dá 60 FPS sem rede, velocidade 5x e modo offline; o **NPDev é a fonte de dados, das regras canônicas e do placar**. O backend é um app NPDev próprio, `WmsOfficeTheGame` (porta 8200, definição em [`backend/npdev/`](backend/npdev/)), independente do produto WmsOffice e servindo o jogo na mesma origem da API (sem CORS).

```text
┌──────────────────────────────────────────────────────────┐
│                   CAMADA DE APRESENTAÇÃO                 │
│        Frontend Web / Mobile-First (Vite + TypeScript)   │
│  - Motor da simulação (src/sim): ticks, rotas, SLA, score│
│  - Engine 2D em HTML5 Canvas (Racks, Heatmap, Frotas)    │
│  - HUD Tático (Telemetria, Controle de Tempo, Drawer)    │
└───────────────────────────┬──────────────────────────────┘
                            │ REST / JSON API (JWT, mesma origem)
┌───────────────────────────┴──────────────────────────────┐
│              BACKEND WmsOfficeTheGame (NPDev, :8200)     │
│  - Cenários e ordens canônicas; partidas e placar        │
│  - Capability simulacao: calcularScore / validarScore /  │
│    gerarOrdens (Java; recalcula o score oficial)         │
│  - Capability alocacao: regras de alocação do WmsOffice  │
│  - Concepts Sim* + topologia Armazem/Area/Rua/Local      │
└──────────────────────────────────────────────────────────┘
```

| Camada | Tecnologia | Papel no projeto |
| --- | --- | --- |
| Backend / regras | NPDev (Java / Spring Boot) | Entrega os cenários, recalcula o score pela fórmula oficial, confere as métricas contra o cenário e mantém o ranking; evolução de schema orientada a modelos JSON. Regras de alocação ficam em Java (`AllocationCapability`) e têm porta em TS com testes de paridade. |
| Frontend core | HTML5 Canvas 2D + TypeScript | Renderização vetorial direta sem sobrecarga de frameworks visuais pesados; alta taxa de quadros (60 FPS) em dispositivos móveis e desktops. |
| Ferramenta de build | Vite | Empacotamento de baixo overhead, Hot Module Replacement (HMR) e compilação rápida para assets estáticos. |
| Interface e estilo | CSS3 moderno (variáveis + Flex/Grid) | HUD escuro de temática industrial com controles táticos, painel deslizante (drawer) de estratégias e adaptação responsiva para toque. |
| Portabilidade | Capacitor 6 (Android) | Encapsulamento da aplicação web compilada dentro de um contêiner nativo para geração de `.apk` sem reescrita de interface. |

Detalhes das decisões (D1–D6), das fases e do que ficou pendente: [docs/PLANO.md](docs/PLANO.md).

## 3. Dinâmica de jogabilidade (gameplay loop)

O fluxo central do jogo é estruturado em quatro etapas cíclicas:

```text
[1. SETUP DO ARMAZÉM] ──> [2. POLÍTICA DE ALOCAÇÃO] ──> [3. INJEÇÃO DE DEMANDA & TEMPO] ──> [4. APURAÇÃO DE SCORE]
         ▲                                                                                          │
         └───────────────────────── Otimizar Layout e Parâmetros ───────────────────────────────────┘
```

### 3.1. Fases da rodada

- **Setup estrutural:** o jogador seleciona o cenário de galpão (ex.: Warehouse A - Pequeno Porte, Warehouse B - Megacentro), configurando a disposição de docas de entrada (Inbound), docas de saída (Outbound) e capacidade de posições porta-paletes.
- **Definição de diretrizes:** escolha das regras ativas de armazenagem no painel de controle antes ou durante a operação.
- **Execução e avanço temporal:** o jogador inicia ou acelera o relógio do turno (08:00 às 18:00). Caminhões chegam às docas descarregando lotes de Notas Fiscais (NFs); empilhadeiras e transpaleteiras entram em movimento executando percursos de armazenagem e reabastecimento.
- **Análise de eficiência:** ao término do lote ou turno, o sistema emite o balanço de rota, congestionamentos e nível de serviço (SLA), gerando a classificação comparativa do jogador.

### 3.2. Modos de visualização da operação

- **Visão operacional padrão:** identifica posições ocupadas com codificação por cores baseada na classificação de rotatividade (azul: Classe A; verde: Classe B; cinza: Classe C).
- **Heatmap de tráfego / acessos:** destaca em tons de vermelho térmico os corredores e blocos com maior concentração de ciclos de picking, evidenciando gargalos e desbalanceamento de fluxo.
- **Inspeção pontual:** toque ou clique sobre qualquer nicho para consultar identificador físico (Rua-Prédio-Nível), SKU alocado, quantidade e histórico de acessos.

## 4. Políticas operacionais configuráveis

O jogador altera as decisões de gestão por meio de políticas que impactam diretamente o deslocamento dos equipamentos:

- **Curva ABC por proximidade de doca:** o algoritmo calcula o centro de massa entre as docas de expedição e posiciona produtos com maior índice de giro nas primeiras posições dos corredores baixos. Reduz tempo de viagem, mas pode gerar saturação nas primeiras baias.
- **FIFO + primeira posição disponível:** aloca o palete na vaga desocupada mais imediata encontrada no galpão, priorizando velocidade de descarregamento na entrada sem considerar a distância futura de expedição.
- **Consolidação de lote / densidade máxima:** agrupa paletes de um mesmo lote ou produto em vãos contíguos para maximizar a ocupação cúbica e facilitar conferências fiscais posteriores.
- **Cross-docking automatizado:** ao identificar que uma carga recebida já possui pedido de saída programado na doca de expedição, o sistema transfere o item diretamente entre docas sem enviá-lo às estantes.

## 5. Modelagem de dados no NPDev

O backend **reaproveita** os concepts de topologia do WmsOffice (`Armazem`, `Area`, `Rua`, `LocalArmazenagem`, `Produto`) — cada cenário tem o seu `Armazem` — e acrescenta quatro concepts de simulação com prefixo `Sim*`. Não há campos `decimal`: toda grandeza é um **inteiro escalado** (distância em centímetros, tempo em segundos desde 00:00, percentuais e score em centésimos, 0–10000). Definições completas: [`backend/npdev/definition/concepts/`](backend/npdev/definition/concepts/).

### 5.1. Conceito: `SimCenario`

Parâmetros de infraestrutura de cada fase, mais as referências que o servidor usa para conferir as métricas de uma partida.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `codigo` (único), `nome`, `dificuldade` | string, string, enum `Facil/Medio/Dificil/Extremo` | ex. `WH-A-PEQUENO` |
| `armazemId` | referência → `Armazem` | topologia do cenário |
| `seed` | long | gera as ordens e o estoque inicial |
| `qtdDocasInbound`, `qtdDocasOutbound`, `qtdEquipamentos` | integer | padrão 2 / 2 / 3 |
| `velocidadeEquipamentoCmS`, `tempoDescargaSeg` | integer | ex. 220 cm/s, 300 s |
| `inicioTurnoSeg`, `fimTurnoSeg` | integer | 28800 (08:00) / 64800 (18:00) |
| `qtdOrdens`, `distanciaTeoricaCm` | integer, long | referências do servidor (calculadas por `tools/gerar_seeds_cenarios.py`); sem elas o cenário não aceita partidas |
| `ativo` | boolean | |

### 5.2. Conceito: `SimOrdem`

Carga de trabalho canônica do cenário — as mesmas ordens para todos os jogadores.

| Campo | Tipo |
| --- | --- |
| `cenarioId` | referência → `SimCenario` |
| `numero` | string (`IN-0001`, `OUT-0001`…) |
| `tipo` | enum `Inbound/Outbound` |
| `liberacaoSeg`, `slaSeg` | integer |
| `produtoId` | referência → `Produto` |
| `quantidadePaletes` | integer |

### 5.3. Conceitos: `SimPartida` e `SimScore`

`SimPartida` é uma jogada: `cenarioId`, `jogador` (username), `politica` (`AbcProximidade`, `FifoPrimeiraLivre`, `Consolidacao`, `CrossDocking`, `WmsReal`), `versaoMotor`, `iniciadaEm`/`concluidaEm` e `situacao` (lifecycle `EmAndamento → Concluida | Abandonada`).

`SimScore` é o resultado, 1:1 com a partida concluída, **gravado só pelo servidor** (flow `ConcluirPartida`): `distanciaRealCm`, `distanciaTeoricaCm`, `ordensTotal`, `ordensAtrasadas`, `eventosConflito`, `ocupacaoFinalCentesimos`, `scoreCentesimos`, `validadoServidor` e `versaoMotor` (copiada da partida). O ranking (`RankingPorCenario`) lista só scores validados, **da mesma versão do motor**, do melhor para o pior.

### 5.4. Até onde vai a validação do servidor

O servidor recalcula o score pela fórmula oficial e **recusa** a partida cujas métricas de referência não batem com o cenário: `ordensTotal` diferente de `SimCenario.qtdOrdens`, `distanciaTeoricaCm` diferente da do cenário ou distância real abaixo de metade da teórica (piso de plausibilidade — a teórica é um piso razoável, não um limite). Isso barra métricas incoerentes e o atalho mais óbvio, **mas não prova que distância real, atrasos, conflitos e ocupação são verdadeiros**: quem enviar métricas "perfeitas" sob medida entra no ranking. Só um replay no servidor (reexecutar a partida a partir do seed e das decisões) fecharia isso; ele exigiria o motor em Java e está fora de escopo por ora.

## 6. Formulação matemática do score de eficiência

A pontuação operacional ($E$) é avaliada em uma escala de $0$ a $100$ pontos percentuais, penalizando ineficiências de deslocamento, violações de prazo e gargalos mecânicos. O bônus de ocupação nunca leva o score acima de $100$:

$$
E = \min\left(100,\; \max\left(0,\; 100 - (P_{dist} + P_{atraso} + P_{conflito})\right) + B_{ocup}\right)
$$

Implementação oficial: `SimulacaoCapability.calcularScore` (backend, inteiros em centésimos, arredondamento meio para cima em cada termo). Casos de referência: [`backend/npdev/tests/fixtures/score-cases.json`](backend/npdev/tests/fixtures/score-cases.json).

### 6.1. Componentes da fórmula

- **Penalidade de distância ($P_{dist}$):** avalia a quilometragem excedente percorrida pelas frotas em relação ao percurso ótimo euclidiano/manhattan ($D_{teorico}$):

  $$
  P_{dist} = \min\left(35,\; \max\left(0,\; \frac{D_{real} - D_{teorico}}{D_{teorico}}\right) \times 35\right)
  $$

- **Penalidade de violação de SLA ($P_{atraso}$):** aplica peso severo sobre ordens expedidas fora do limite estipulado:

  $$
  P_{atraso} = \left(\frac{\text{Ordens Fora do Prazo}}{\text{Total de Ordens}}\right) \times 40
  $$

- **Penalidade por conflito de tráfego ($P_{conflito}$):** pontos deduzidos por interferências de bloqueio mútuo quando múltiplos veículos tentam acessar a mesma rua estreita:

  $$
  P_{conflito} = \min(15,\; \text{Total de Eventos de Parada} \times 1.5)
  $$

- **Bônus de faixa ótima de ocupação ($B_{ocup}$):** concede $+5$ pontos se a taxa de ocupação estiver entre $75\%$ e $88\%$ (faixa de máxima densidade sem estrangulamento de manobra).

### 6.2. Comparativo de cenário

| Indicador | Estratégia A: FIFO ingênuo | Estratégia B: Curva ABC dinâmica |
| --- | --- | --- |
| Política | Aloca no primeiro vão livre | Itens A próximos à expedição |
| Distância percorrida | $8.240\text{ m}$ ($+106\%$ sobre o ideal) | $4.110\text{ m}$ ($+3\%$ sobre o ideal) |
| Ordens atrasadas | $14\%$ (espera em fila) | $0\%$ (fluxo contínuo) |
| Conflitos de tráfego | 6 eventos | 1 evento |
| Penalidades totais | $-35{,}0$ (dist), $-5{,}6$ (SLA), $-9{,}0$ (conflito) | $-1{,}05$ (dist), $-0{,}0$ (SLA), $-1{,}5$ (conflito) |
| Bônus de ocupação | $0$ (ocupação dispersa: $62\%$) | $+5{,}0$ (ocupação concentrada: $81\%$) |
| Score final ($E$) | $50{,}4\%$ (Operação Crítica) | $100{,}0\%$ (Classe Mundial; $97{,}45 + 5 = 102{,}45$, limitado a $100$) |

## 7. Roadmap de entrega

Estado em 2026-11-10; o acompanhamento detalhado (fases N0–N5 e F0–F7, decisões e pendências) está em [docs/PLANO.md](docs/PLANO.md).

1. **Etapa 1 — Frontend Web Funcional** ✅: galpão em Canvas 2D, câmera tátil (arraste e pinça), inspeção de nichos e simulação determinística por seed (`src/sim`), com cenários embutidos para jogar sem rede.
2. **Etapa 2 — Acoplamento com NPDev** ✅: concepts `Sim*`, capability `simulacao`, role `Jogador`, cenários semeados, ranking por cenário e versão do motor; o jogo é servido em `http://localhost:8200/jogo/` e joga offline com fila de envio ao religar.
3. **Etapa 3 — Expansão das Regras Logísticas** ✅: as cinco políticas do §4 estão no motor, com testes de paridade TS × Java para as regras de alocação. A **WmsOffice Real** é decidida pelo servidor quando há login (flow `SugerirDestinoJogo`; o jogo para o relógio enquanto espera cada resposta, ~50 ms) e cai para a porta TS, que é a mesma regra, sem login ou se o servidor falhar; a tela de resultado diz de onde vieram os destinos.
4. **Etapa 4 — Portabilidade Mobile** ◐: Capacitor 6 + projeto Android, `.apk` de debug, layout de toque e fontes locais. Faltam testar em aparelho ou emulador, apontar o APK para a URL do backend (com CORS) e o build de release.
5. **Integridade do ranking** ◻: validação por replay no servidor (§5.4).
