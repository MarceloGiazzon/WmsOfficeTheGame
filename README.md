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

O projeto adota uma arquitetura desacoplada, utilizando o ecossistema NPDev para sustentação de regras e persistência, e um cliente web leve focado em performance gráfica e futura portabilidade móvel.

```text
┌──────────────────────────────────────────────────────────┐
│                   CAMADA DE APRESENTAÇÃO                 │
│        Frontend Web / Mobile-First (Vite + TypeScript)   │
│  - Engine 2D em HTML5 Canvas (Racks, Heatmap, Frotas)    │
│  - HUD Tático (Telemetria, Controle de Tempo, Drawer)    │
└───────────────────────────┬──────────────────────────────┘
                            │ REST / JSON API
┌───────────────────────────┴──────────────────────────────┐
│                    MOTOR DO JOGO / BACKEND               │
│                  NPDev Engine (Spring Boot)              │
│  - Capabilities: AllocationCapability (Roteamento / ABC) │
│  - Concepts: Armazem, LocalArmazenagem, Movimento        │
│  - Simulação: OrdemFicticia, CenarioSimulacao, Score     │
└──────────────────────────────────────────────────────────┘
```

| Camada | Tecnologia | Papel no projeto |
| --- | --- | --- |
| Backend / regras | NPDev (Java / Spring Boot) | Execução desacoplada de capacidades logísticas (AllocationCapability), evolução de schema orientada a modelos JSON e persistência transacional de ordens fictícias e scores. |
| Frontend core | HTML5 Canvas 2D + TypeScript | Renderização vetorial direta sem sobrecarga de frameworks visuais pesados; alta taxa de quadros (60 FPS) em dispositivos móveis e desktops. |
| Ferramenta de build | Vite | Empacotamento de baixo overhead, Hot Module Replacement (HMR) e compilação rápida para assets estáticos. |
| Interface e estilo | CSS3 moderno (variáveis + Flex/Grid) | HUD escuro de temática industrial com controles táticos, painel deslizante (drawer) de estratégias e adaptação responsiva para toque. |
| Portabilidade futura | Capacitor 6 (Android) | Encapsulamento da aplicação web compilada dentro de um contêiner nativo para geração de `.apk` sem reescrita de interface. |

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

O backend estende os conceitos transacionais já existentes no WmsOffice (`Armazem.json`, `Rua.json`, `LocalArmazenagem.json`, `Produto.json`, `Movimento.json`), incorporando novas entidades específicas de simulação.

### 5.1. Conceito: `CenarioSimulacao.json`

Define os parâmetros de infraestrutura e restrições físicas de cada fase.

```json
{
  "name": "CenarioSimulacao",
  "tableName": "cenario_simulacao",
  "properties": {
    "codigo": { "type": "string", "required": true },
    "nome": { "type": "string", "required": true },
    "dificuldade": { "type": "string", "enum": ["FACIL", "MEDIO", "DIFICIL", "EXTREMO"] },
    "capacidadeTotalPaletes": { "type": "integer", "required": true },
    "quantidadeDocasInbound": { "type": "integer", "defaultValue": 2 },
    "quantidadeDocasOutbound": { "type": "integer", "defaultValue": 2 },
    "quantidadeEquipamentos": { "type": "integer", "defaultValue": 3 },
    "velocidadePadraoVeiculo": { "type": "decimal", "defaultValue": 2.2 },
    "tempoPadraoDescargaMinutos": { "type": "integer", "defaultValue": 5 }
  }
}
```

### 5.2. Conceito: `OrdemFicticia.json`

Modela a carga de trabalho dinâmica e a janela de atendimento.

```json
{
  "name": "OrdemFicticia",
  "tableName": "ordem_ficticia",
  "properties": {
    "numero": { "type": "string", "required": true },
    "cenarioId": { "type": "reference", "target": "CenarioSimulacao", "required": true },
    "tipo": { "type": "string", "enum": ["INBOUND_RECEBIMENTO", "OUTBOUND_EXPEDICAO"] },
    "tickLiberacao": { "type": "integer", "description": "Minuto simulado em que a ordem é disparada" },
    "slaLimiteMinutos": { "type": "integer", "description": "Prazo máximo para conclusão do ciclo" },
    "produtoId": { "type": "reference", "target": "Produto", "required": true },
    "quantidadePaletes": { "type": "integer", "required": true },
    "localOrigemId": { "type": "reference", "target": "LocalArmazenagem" },
    "localDestinoId": { "type": "reference", "target": "LocalArmazenagem" },
    "status": { "type": "string", "enum": ["PENDENTE", "EM_TRANSITO", "CONCLUIDO", "VIOLADO"] }
  }
}
```

### 5.3. Conceito: `ScoreSimulacao.json`

Registra a avaliação consolidada para histórico e placar de líderes.

```json
{
  "name": "ScoreSimulacao",
  "tableName": "score_simulacao",
  "properties": {
    "cenarioId": { "type": "reference", "target": "CenarioSimulacao", "required": true },
    "estrategiaAplicada": { "type": "string", "required": true },
    "distanciaPercorridaMetros": { "type": "decimal", "required": true },
    "distanciaTeoricaMinima": { "type": "decimal", "required": true },
    "totalOrdensProcessadas": { "type": "integer", "required": true },
    "totalOrdensAtrasadas": { "type": "integer", "required": true },
    "conflitosCorredor": { "type": "integer", "defaultValue": 0 },
    "taxaOcupacaoFinal": { "type": "decimal", "required": true },
    "scoreFinal": { "type": "decimal", "required": true }
  }
}
```

## 6. Formulação matemática do score de eficiência

A pontuação operacional ($E$) é avaliada em uma escala de $0$ a $100$ pontos percentuais, penalizando ineficiências de deslocamento, violações de prazo e gargalos mecânicos:

$$
E = \max\left(0,\; 100 - (P_{dist} + P_{atraso} + P_{conflito})\right) + B_{ocup}
$$

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
| Score final ($E$) | $50{,}4\%$ (Operação Crítica) | $98{,}4\%$ (Classe Mundial) |

## 7. Roadmap de entrega

1. **Etapa 1 — Frontend Web Funcional:** validação visual do galpão em Canvas 2D, manipulação de câmera tátil, inspeção de nichos e simulação autônoma com mock de dados.
2. **Etapa 2 — Acoplamento com NPDev:** criação dos conceitos de simulação (`CenarioSimulacao`, `OrdemFicticia`, `ScoreSimulacao`) e integração dos endpoints REST via `NPDevClient`.
3. **Etapa 3 — Expansão das Regras Logísticas:** migração das regras contidas em `AllocationCapability.java` para comportamentos dinâmicos orientados a turnos com persistência de rotas.
4. **Etapa 4 — Portabilidade Mobile:** adição dos plugins de tela cheia do Capacitor para geração do instalador `.apk` Android com suporte a toque e modo offline.