# Integração Jogo ↔ WmsOffice Corporativo — registro da sessão e proposta

> Data: 2026-11-10 · Status: **implementado** (P0–P3; ver [docs/ponte/PLANO.md](ponte/PLANO.md) e [CHECKLIST.md](ponte/CHECKLIST.md)). O texto abaixo é a proposta original, mantida como registro; as correções e os números verificados estão em *Atualização* no fim.
> Origem: sessão de análise sobre "o jogo usa as mesmas tabelas do WmsOffice?" e, a partir dela, como fazer o jogo e o
> WmsOffice "corporativo" trocarem dados nos dois sentidos.
> Convenção: o que foi **verificado no código** é dito como fato; o que é **inferência ou proposta** está marcado.

---

## 1. Resumo

1. O backend do jogo é uma **cópia** (fork) da definição do WmsOffice. Os 26 concepts do WMS existem nos dois apps com
   os mesmos campos, mas em **bancos e portas separados** (jogo: :8200; corporativo: :8100). Hoje o jogo só usa as
   tabelas de **topologia e cadastro**; recebimento, expedição e movimento não são usados.
2. Do WmsOffice o jogo reaproveita **uma regra**, não os dados: a `AllocationCapability.sugerirDestino` (Java).
3. **Premissa central** (corrigida durante a sessão): o WmsOffice corporativo é uma instância **fictícia, sem usuários
   reais**. O jogo é um **projeto de portfólio**. O objetivo da integração é o **efeito visível**: ver o que o jogo faz
   nas telas do corporativo e jogar um armazém cadastrado no corporativo — mostrar pontes e diálogo entre mundos distintos.
4. **Estratégia recomendada:** um **tradutor declarativo** (mapa de conceitos em arquivo) que fala REST com os dois apps,
   independente de alvo (o contrato REST é idêntico). Jogo → Corporativo grava `Recebimento`, `Expedicao`, `Movimento`,
   `Lote` e ocupação percorrendo o ciclo de vida, de modo que o **próprio WmsOffice gera o histórico**. Corporativo →
   Jogo transforma um armazém do corporativo em cenário jogável.
5. Peça nova obrigatória no jogo: o servidor hoje recebe só **6 métricas** por partida; para criar documentos o cliente
   precisa enviar o **rastro da partida** (putaways e pickings).

---

## 2. Ponto de partida

| | |
| --- | --- |
| Repositório | `~/repos/WmsOfficeTheGame`, branch `main` |
| Backend do jogo | app NPDev **WmsOfficeTheGame**, `backend/npdev/`, porta **8200**, banco H2 `npdev_wmsofficethegame`, namespace `wmsofficethegame.core` |
| Produto corporativo | app NPDev **WmsOffice**, `~/repos/NPDev/AppGen/apps/_official/WmsOffice`, porta **8100** (parado nesta máquina; `docs/NPDEV_LINUX.md` registra o build em `Build/generated-finalapps-linux/wmsoffice`) |
| Git | `main` com 1 commit local sem push (`cc5f5fa`, docs da URL `/jogo/index.html`) |
| Já concluído | WmsReal online (o servidor decide o destino dos paletes), ranking com anti-fraude por métricas de referência, front servido em `http://localhost:8200/jogo/index.html` |

Regra anterior do projeto: o WmsOffice é um produto independente e **a sua definição não deve ser alterada pelo jogo**
(a única exceção foi a correção do manifesto de extensões, N0 — ver `docs/NPDEV_LINUX.md`). Ver a decisão em aberto D1
(§9) sobre se essa regra continua valendo agora que o corporativo é fictício.

---

## 3. O que a sessão apurou: o jogo usa as tabelas do WmsOffice?

### 3.1 As definições são as mesmas; os dados não

`backend/npdev/` começou como cópia de `definition/` + `web/` do WmsOffice em 2026-11-10.

- Os 26 concepts do WMS (`Entidade`, `Armazem`, `Area`, `Rua`, `LocalArmazenagem`, `Produto`, `Lote`,
  `LocalArmazenagemLote`, `PerfilAlocacao`, `RankingRua`, `Movimento`, `MovimentoItem`, `MovimentoItemPosicao`,
  `Recebimento`, `RecebimentoLote`, `Expedicao`, `ExpedicaoItem`, `CrossDocking`, `DocumentoFiscal`(+Item),
  `Romaneio`(+Item), `InventarioArquivo`(+Linha), `HistoricoMovimentacao`, `Usuario`) existem com os mesmos campos.
- Diferença verificada (diff em `Recebimento`, `Movimento`, `Expedicao`, `Lote` e `Produto`): somente o bloco
  `access.write` (`ADMIN || WarehouseManager`). O README do backend diz que vale para todos os concepts do WMS; os
  demais não foram comparados um a um.
- Acrescentados pelo jogo: `SimCenario`, `SimOrdem`, `SimPartida`, `SimScore`, a capability `simulacao`, a role `Jogador`
  e as seeds de cenário.
- São **instâncias independentes**: nada do que acontece num app aparece no outro.

### 3.2 O que o jogo usa em tempo de execução

| Grupo | Tabelas | Uso |
| --- | --- | --- |
| Topologia e cadastro | `Entidade`, `Armazem`, `Area`, `Rua`, `LocalArmazenagem`, `PerfilAlocacao`, `RankingRua`, `Produto` | Semeadas por cenário e **lidas pelo front** para montar o cenário (`src/net/pacote.ts`) |
| Do jogo | `SimCenario`, `SimOrdem`, `SimPartida`, `SimScore` | Cenários, ordens, partidas e placar |
| **Não usadas** | `Recebimento`, `Expedicao`, `Movimento`, `MovimentoItem`, `MovimentoItemPosicao`, `Lote`, `LocalArmazenagemLote`, `HistoricoMovimentacao`, `DocumentoFiscal`, `Romaneio`, `Inventario*` | Sem linhas nas seeds; o jogo nunca escreve nelas |

- No lugar de recebimento e expedição o jogo tem `SimOrdem` (`tipo` Inbound/Outbound, `liberacaoSeg`, `slaSeg`,
  `produtoId`, `quantidadePaletes`).
- O **estoque** do turno é sorteado em memória no cliente (`src/sim/estoque.ts`): 60% dos locais livres começam com um
  palete, pela seed do cenário e pelo giro de saída dos produtos.
- Os **movimentos** (putaway, picking, cross-dock) acontecem no motor em TypeScript e não deixam registro no servidor.
- O perfil `Jogador` pode ler `Lote` e `LocalArmazenagemLote`, mas o front não lê essas tabelas.
- Tamanho dos cenários embutidos: **WH-A** 52 locais (48 + 4 docas), 12 produtos, 60 ordens; **WH-B** 1448 locais
  (1440 + 8 docas), 30 produtos, 400 ordens.

### 3.3 A regra do WmsOffice que o jogo reaproveita

Na política **WmsReal**: flow `SugerirDestinoJogo` → `SugerirDestinoProcedure` → `AllocationCapability.sugerirDestino`
(Java, a mesma do recebimento do WmsOffice). O cliente manda `loteId` e candidatos (com `prioridade`, vinda de
`RankingRua`, e `loteOcupanteId`). O servidor ordena: mesmo lote ocupante primeiro, depois menor prioridade, depois id.
Ele **não consulta** `Lote` nem `LocalArmazenagemLote`.

O procedure também lê `CrossDocking` (herdado do WmsOffice), mas só ativa o atalho de cross-docking se a chamada trouxer
`recebimentoId`, e o jogo não envia esse campo; as seeds não criam linhas nessa tabela.

### 3.4 O que o servidor recebe de uma partida hoje

Só as métricas do `ConcluirPartida`: `distanciaRealCm`, `distanciaTeoricaCm`, `ordensTotal`, `ordensAtrasadas`,
`eventosConflito`, `ocupacaoFinalCentesimos` e `scoreCentesimos`. Nenhum evento individual (quem guardou o quê, onde,
quando) chega ao backend. Isto é o que impede, hoje, gerar documentos no corporativo.

---

## 4. Cenário e objetivos

### 4.1 Premissa corrigida durante a sessão

A primeira análise tratou o corporativo como um sistema em produção e levantou riscos que **não se aplicam**:
"falsificaria estoque e trilha de auditoria", anonimização/LGPD, conta de serviço somente leitura, "não gravar
movimentos". O esclarecimento do dono do projeto:

- ninguém usa o WmsOffice e não há dados reais;
- mesmo que houvesse, a instância corporativa seria de dados fictícios;
- é um projeto de **portfólio**: o que importa é o efeito, a integração, a flexibilidade de unir mundos à parte, criar
  pontes e dialogar entre conceitos distintos.

Consequência: gravar `Recebimento`, `Expedicao`, `Movimento`, `Lote` e ocupação no corporativo **deixa de ser risco e
passa a ser o centro da demonstração**.

### 4.2 Objetivos

1. **Jogo → Corporativo.** Jogar uma partida e, depois, abrir o WmsOffice e ver o que o jogo fez: Recebimentos
   armazenados, Expedições confirmadas, Movimentos concluídos, histórico de movimentação, Mapa do Armazém com a
   ocupação final, Analytics contando tudo.
2. **Corporativo → Jogo.** Cadastrar (ou escolher) um armazém no WmsOffice e vê-lo aparecer no jogo como cenário
   jogável, marcado com a origem.
3. **Ciclo completo.** Criar no corporativo → jogar → o resultado volta ao corporativo como operação.
4. **Mostrar a ponte.** O mapeamento entre os dois vocabulários é um artefato legível e documentado, não código
   escondido.

### 4.3 Fora de escopo (por ora)

Login único (SSO) entre os dois apps; replicação contínua; validação do ranking por replay no servidor (relacionada,
mas separada — ver §6.4); qualquer proteção típica de dado real.

---

## 5. O que o corporativo oferece para a ponte (verificado em `model.json` e nos concepts)

### 5.1 Ciclos de vida

| Concept | Campo | Estados e transições |
| --- | --- | --- |
| `Recebimento` | `estagio` | `PreRecebimento → Enderecado → Conferido → Armazenado` (terminal) |
| `Expedicao` | `estagio` | `PreExpedicao → DemandaGerada → MovimentacaoConcluida → SaidaConfirmada` (terminal) |
| `Movimento` | `situacao` | `Pendente → Concluido`; `Pendente ↔ Suspenso`; `Pendente/Suspenso → Cancelado` |

O README do WmsOffice registra, verificado ao vivo, que pular estágio ou voltar do terminal é rejeitado: a ponte
**precisa percorrer cada estágio**.

### 5.2 Flows e orquestração

- Flows: `ConfirmarRecebimento` (valida invariantes, atualiza, emite `RecebimentoArmazenado`),
  `ConfirmarSaidaExpedicao` (emite `ExpedicaoSaidaConfirmada`), `ConfirmarMovimentacao` (emite `MovimentoConfirmado`),
  `AtivarCrossDocking`, `AlocarRecebimento`, `SugerirDestino`/`SugerirOrigem`.
- Regras de orquestração (as **três únicas** do model): cada evento acima cria uma linha em `HistoricoMovimentacao`
  (`movimentoId`, `evento`). Ou seja, **o corporativo reage sozinho** a cada confirmação.
- `HistoricoMovimentacao.descricao` e `ocorridoEm` não são preenchidos pela orquestração; `ocorridoEm` provavelmente é
  carimbado pelo servidor (**não verificado**), o que significa que o histórico mostrará a hora da gravação, não a hora
  do jogo.

### 5.3 Invariantes que a ponte tem de respeitar

- `Recebimento` em `Armazenado` exige `movimentoId`; `Expedicao` em `SaidaConfirmada` exige `movimentoId`.
- `Recebimento` com `nfePendente` ou `divergenciaItensXNotas` exige `observacao` preenchida.
- `MovimentoItemPosicao.quantidade > 0`; `Lote.quantidade >= 0`.

### 5.4 Telas existentes (herdadas também no `web/` do jogo)

Mapa do Armazém, Analytics (`MovementsByTipoAndSituacao`, `TotalOccupiedLocations`, `LocationsByRuaAndSituacao`),
Centro de Trabalho, Movimentação Livre, Cross-docking, Relatórios, Inventário, Conferência Fiscal, Recebimento/Expedição
(workbench). São o "palco" onde o efeito da ponte aparece.

---

## 6. Dicionário de conceitos (o coração da ponte)

### 6.1 Tabela de equivalências

| Mundo do jogo | Mundo corporativo |
| --- | --- |
| `SimCenario` | `Armazem` com `Area`, `Rua` e `LocalArmazenagem` (armazém "jogável") |
| `SimOrdem` Inbound | `Recebimento` + `Movimento` (tipo `Recebimento`) + `RecebimentoLote` + `Lote` |
| `SimOrdem` Outbound | `Expedicao` + `ExpedicaoItem` + `Movimento` (tipo `Expedicao`) |
| Palete guardado (putaway) | `MovimentoItemPosicao` papel `Destino` + `LocalArmazenagemLote` |
| Palete separado (picking) | `MovimentoItemPosicao` papel `Origem` + baixa em `LocalArmazenagemLote` |
| Estoque inicial do turno | `Lote` (`Recebido`) + `LocalArmazenagemLote`, via `Movimento` tipo `MovtoLivre` (carga inicial) — *proposta* |
| Tarefa CrossDock | `CrossDocking` (`recebimentoId`, `expedicaoId`, baia) — *proposta, opcional* |
| Política WmsReal | `AllocationCapability` (já é a mesma regra) |
| Ordem atrasada (SLA) | `divergenciaItensXNotas` + `observacao` no `Recebimento` — *proposta, opcional* |
| Tempo do jogo (segundos desde 00:00) | `dataRecebimento` / `dataExpedicao` (só data: a hora se perde) |
| `SimScore`, `SimPartida` | Sem equivalente. Provenância e score podem ir no texto de `Recebimento.observacao` |

### 6.2 Jogo → Corporativo ("Enviar partida ao WmsOffice") — *proposta*

Para uma partida concluída, o tradutor cria no alvo, nesta ordem:

1. **Escopo:** uma `Entidade` do tipo `Estabelecimento` ("WmsOffice: The Game") que contém tudo o que o jogo gravar, para
   o dado não se misturar com o resto do corporativo.
2. **Topologia e cadastro** (se ainda não existirem): `Armazem`, `Area`, `Rua`, `LocalArmazenagem`, `Produto`,
   `PerfilAlocacao`, `RankingRua`, guardando o **de-para de ids** (os ids do jogo e do corporativo são UUIDs diferentes).
3. **Estoque inicial do turno** como carga inicial (`Movimento` `MovtoLivre`): `Lote` (validade = data de entrada +
   `Produto.diasValidadePadrao`) e `LocalArmazenagemLote`. **Sem isso as saídas retiram estoque que não existe no
   corporativo.** Quantidade de um palete = `Produto.qtdCaixasPorPallet` (a unidade em caixas é suposição).
4. **Cada ordem Inbound:** `Movimento` (`Pendente`) → `MovimentoItem` → `Lote` → `RecebimentoLote` → `Recebimento`
   percorrendo `PreRecebimento → Enderecado → Conferido → Armazenado` (com `movimentoId`) → `MovimentoItemPosicao`
   `Destino` por palete → ocupação do local → `Movimento` `Concluido` via `ConfirmarMovimentacao`.
5. **Cada ordem Outbound:** o caminho espelhado: `Expedicao` percorrendo `PreExpedicao → DemandaGerada →
   MovimentacaoConcluida → SaidaConfirmada`, `MovimentoItemPosicao` `Origem`, baixa da ocupação.
6. **Efeito:** os eventos de confirmação disparam as regras de orquestração e o corporativo produz o
   `HistoricoMovimentacao` por conta própria.

Correlação sem alterar o produto: `Recebimento.observacao` carrega algo como
`WmsOffice: The Game · partida <id> · ordem IN-0007 · política WmsReal · score 82,86` (`Expedicao` não tem campo
equivalente; ali a correlação fica só no registro do lado do jogo).

### 6.3 Corporativo → Jogo ("Jogar este armazém") — *proposta*

- **Topologia e cadastro:** cópia direta (mesmas tabelas). O layout é derivado pelo jogo de
  `Rua.qtdPosicoes × qtdAndares` (`src/sim/layout.ts`); o jogo já representa **docas** como ruas de áreas
  `Recebimento`/`Expedicao` (ver seeds). A regra exata do importador deve ser confirmada lendo `construirLayout`.
- **Ordens:** se o corporativo tiver `Recebimento`/`Expedicao`, derivam-se `SimOrdem` (paletes = `quantidade ÷
  qtdCaixasPorPallet`); se não tiver (as seeds do WmsOffice só têm topologia e cadastro), o gerador canônico
  (`SimulacaoCapability.gerarOrdens`) cria as ordens a partir do mix de produtos.
- **Hora de liberação e SLA:** não existem no corporativo. Como os dados são fictícios, são **sintetizados
  deterministicamente pela seed**, sem ressalva de fidelidade.
- **Estoque inicial:** vem de `LocalArmazenagemLote` quando existir; senão, o sorteio atual.
- **Parâmetros do turno** (docas, equipamentos, velocidade, tempo de descarga, horário): configuração do jogo.
- **Marcação:** o cenário importado diz de onde veio. Campos novos do `SimCenario` (`origem`, referência do armazém de
  origem, data/versão do snapshot) **não podem ser `required` do tipo referência** numa tabela já existente: o boot do
  NPDev recusa ("tables with existing data"), mesmo com a tabela vazia (ver `docs/NPDEV_LINUX.md`); usar campos
  opcionais ou `rebuild.sh --reset-db`.
- **Anti-fraude do ranking:** o cenário importado passa pelo mesmo pipeline que calcula `qtdOrdens` e
  `distanciaTeoricaCm` (`gerar_seeds_cenarios.py` + `teorica_cenarios.ts`), então o `ConcluirPartida` continua
  conferindo as métricas sem mudança.

### 6.4 Peça nova no jogo: o rastro da partida

Para criar documentos o servidor precisa saber o que aconteceu. Proposta: ao fim da partida o cliente envia uma lista
compacta de eventos `{tipo: Putaway|Picking|CrossDock, ordem, produto, local, tSeg}`. Alternativas a decidir (D4):
linhas de um concept novo (`SimEvento`), um único campo JSON na partida, ou re-simular na ponte (descartada como
primeira escolha: exige o motor TS na ferramenta e as trocas de política feitas durante o turno complicam o replay).
O mesmo rastro é o ingrediente que falta para a validação por replay (questão 5 de `docs/PLANO.md` §7).

---

## 7. Estratégias consideradas

| # | Estratégia | Avaliação com o objetivo de portfólio |
| --- | --- | --- |
| A | **Conversor por arquivo** (exporta JSON, converte, importa) | Seguro e simples, mas o "efeito" depende de passos manuais. Serve como modo degenerado da B |
| B | **Conector online servidor-a-servidor** (tradutor lê/grava por REST nos dois apps) | **Recomendada.** Mostra dois sistemas conversando; o mapa fica explícito |
| C | **Fusão** (tabelas `Sim*` dentro do produto WmsOffice) | Banco e login únicos, mas elimina justamente a ponte que se quer mostrar e altera a definição do produto |
| D | **Banco compartilhado / replicação** | Descartada: acopla os dois apps e também apaga a ponte |

Por que a B funciona bem aqui: o backend do jogo é um fork do WmsOffice, então **os dois expõem o mesmo contrato REST**
(`/api/<concept>`, `/api/concepts/<C>/page`, `/api/flows/<Nome>/execute`, `/api/auth/login`). O mesmo tradutor grava na
:8200 (as telas do WMS já existem lá — atalho para desenvolver) ou na :8100 (a ponte entre sistemas de verdade). Isso é
em si uma demonstração de flexibilidade.

---

## 8. Arquitetura proposta (B)

```
   JOGO (:8200)                         PONTE                            CORPORATIVO (:8100)
 ┌───────────────────┐        ┌──────────────────────┐        ┌──────────────────────────────┐
 │ SimCenario        │        │ mapa.json            │        │ Entidade/Armazem/Area/Rua     │
 │ SimOrdem          │ ─────► │ (dicionário, nos     │ ─────► │ Recebimento · Expedicao       │
 │ SimPartida        │  Jogo→ │  dois sentidos)      │  REST  │ Movimento · Lote · ocupação   │
 │ rastro (novo)     │  Corp. │                      │        │  └─ flows Confirmar* ──► evento│
 │                   │        │ tradutor + ledger    │        │      └─ orquestração ──► Histórico
 │ SimExportacao(novo)│ ◄───── │ (correlação, retoma) │ ◄───── │ Armazem/Produto/(documentos)  │
 └───────────────────┘  Corp.→└──────────────────────┘  REST  └──────────────────────────────┘
                        Jogo
```

- **Mapa declarativo** (`ponte/mapa.json`): o dicionário da §6 em formato legível por máquina e por pessoas.
- **Tradutor:** primeiro uma **ferramenta de linha de comando** (Python, como as de `backend/npdev/tools/`), com o alvo
  por URL. Depois um botão no jogo chama o backend. Rodar HTTP de dentro de uma capability do NPDev **não foi
  verificado**.
- **Ledger no jogo** (`SimExportacao`: partida, alvo, estado, de-para de ids). Procedures do NPDev **não são
  transacionais** e seeds **não são idempotentes**; por isso a exportação anda em passos com ponto de retomada e nunca
  exporta a mesma partida duas vezes.
- **Credenciais** de cada app: as do `docs/NPDEV_LINUX.md`, passadas por variável de ambiente, nunca no mapa.

---

## 9. Plano em fases

| Fase | Entrega | Como se confere |
| --- | --- | --- |
| **P0** | Uma partida do **WH-A** (48 locais + 4 docas) vira topologia, carga inicial, 1 recebimento e 1 expedição completos no alvo (começando pela :8200) | Mapa do Armazém com a ocupação esperada; `Recebimento` em `Armazenado`; `Expedicao` em `SaidaConfirmada`; 2 `Movimento` `Concluido`; `HistoricoMovimentacao` com 4 linhas esperadas (2 movimentos + 1 recebimento + 1 expedição, pelas regras de orquestração) |
| **P1** | Partida completa a partir do rastro enviado pelo cliente; `SimExportacao` com retomada e sem duplicar | Reexecutar não duplica; matar no meio e retomar termina igual |
| **P2** | Corporativo → Jogo: importador de um armazém do corporativo para `SimCenario` marcado com a origem | O cenário aparece na lista do jogo; o `ConcluirPartida` aceita a partida; o ciclo completo (criar → jogar → voltar) fecha |
| **P3** | Efeito de apresentação: botão "Enviar ao WmsOffice" na tela de resultado, "Jogar este armazém", link para as telas do corporativo, GIF/roteiro de demonstração e diagrama no README | Demonstração de ponta a ponta sem tocar no terminal |

Extra (feito, §13): o jogo devolve a melhor ordem de ruas como proposta de `RankingRua`/`PerfilAlocacao` (a regra que o
corporativo já usa para alocar).

**Escala:** o WH-B tem 1448 locais e 400 ordens — a exportação completa dele é da ordem de **milhares de chamadas
REST**. Viável, mas **não medido**; por isso o P0 e o P1 usam o WH-A.

---

## 10. Limites e o que não foi verificado

1. **Ocupação não é atualizada sozinha.** O `model.json` só tem orquestração de log. A ocupação (`LocalArmazenagemLote`
   e a situação do local) parece ser escrita pelas telas (há capabilities "onCommit" como
   `alocarRecebimentoPorRua`). A ponte deve gravá-la explicitamente — **não confirmado ao vivo**.
2. **Transições intermediárias** (`Enderecado`, `Conferido`; `DemandaGerada`, `MovimentacaoConcluida`): só existem
   flows para o estado terminal; presume-se `update` REST do concept com o ciclo de vida validando — a confirmar.
3. **Hora do jogo se perde** no corporativo (campos de data; `ocorridoEm` provavelmente do servidor).
4. **Unidade de quantidade** (caixas × `qtdCaixasPorPallet`) é suposição.
5. **O corporativo (:8100) está parado** e as seeds dele não têm `Recebimento`/`Expedicao`/`Movimento`; não se viu o
   app rodando nesta sessão. Subir o build é parte do P0 se o alvo for a :8100.
6. **Capability com HTTP de saída** no NPDev: não verificado.
7. **Correção de número dito na sessão:** foi dito que o WH-B "tem 570 locais". O correto é **1448 locais** (1440 +
   8 docas); os ~570 eram os locais **livres** no início do turno (60% de ocupação inicial), conforme o comentário do
   `decisorWmsReal.ts`.

---

## 11. Decisões em aberto

| # | Pergunta | Recomendação |
| --- | --- | --- |
| D1 | A regra de **não alterar a definição do produto** continua valendo? A ponte funciona só por REST com os concepts existentes; um menu/painel "Jogo" dentro do corporativo, ou um campo de origem, seriam alteração de definição | Manter a regra no P0–P2; reavaliar no P3 |
| D2 | Alvo inicial: :8200 e depois :8100, ou direto :8100? | :8200 primeiro (as telas já existem e está de pé), depois :8100 |
| D3 | Granularidade: gravar a partida inteira ao final, ou "reproduzir" ao vivo, em ritmo de jogo? | Ao final (batch) primeiro; ao vivo seria um P4 de efeito |
| D4 | Armazenamento do rastro: `SimEvento` por linha, JSON único ou re-simulação | `SimEvento` por linha (consultável nas telas do NPDev); medir o tamanho no WH-B |
| D5 | Onde mora a ponte: ferramenta Python (`backend/ponte/`) ou capability Java | Ferramenta Python primeiro (visível, testável, independente) |

---

## 12. Referências no repositório

- Modelo e concepts: `backend/npdev/definition/model.json`, `backend/npdev/definition/concepts/`
- Regra de alocação: `backend/npdev/definition/capabilities/alocacao/.../AllocationCapability.java`
- Decisão online: `src/app/decisorWmsReal.ts`, `src/net/alocacao.ts`, `src/sim/wmsReal.ts`
- Leitura do cenário: `src/net/pacote.ts`, `src/net/leitura.ts`; layout: `src/sim/layout.ts`; estoque: `src/sim/estoque.ts`
- Seeds e geração: `backend/npdev/tools/gerar_seeds_cenarios.py`, `backend/npdev/tools/semear_cenarios.py`
- Limitações do NPDev e runbook: `docs/NPDEV_LINUX.md`; plano geral e questões abertas: `docs/PLANO.md` (§7)
- Produto (somente leitura): `~/repos/NPDev/AppGen/apps/_official/WmsOffice` (README com o histórico de fases e bugs)


---

## 13. Atualização — o que a implementação confirmou e corrigiu (2026-11-10)

A ponte (P0–P3) está em `backend/ponte/` e foi verificada ao vivo; o roteiro de apresentação é [ponte/DEMO.md](ponte/DEMO.md).

**Status por fase:** P0 fundação ✅ · P1 partida real (rastro no motor, `SimEvento`, `SimExportacao`, `exportar --partida`) ✅ ·
P2 corporativo → jogo (`importar`, `procedencia`) ✅ · P3 apresentação (`vigiar`, botão "Enviar ao WmsOffice", selo) ✅ ·
extras de P3.4 ✅ (pedidos pelo dono do projeto em 2026-11-10): linha de `CrossDocking`, `propor-ranking` e `ao-vivo`, descritos abaixo.

**Correções à proposta** (as dúvidas de §10 ficaram resolvidas):

| Proposta dizia | Verificado |
| --- | --- |
| transições intermediárias "presume-se update REST" (§10.2) | `PUT` parcial `{estagio}` funciona; pular estado → 422 |
| `ocorridoEm` "provavelmente carimbado pelo servidor" (§5.2, §10.3) | fica **nulo** (e `descricao` também); os dois aceitam `PUT` — a ponte grava a **hora do jogo** |
| histórico = "4 linhas" no P0 (§9) | 4 **por documento** completo + 1 por `MovtoLivre` |
| ocupação não atualizada sozinha (§10.1, "não confirmado") | confirmado; o Mapa do Armazém pinta por `LocalArmazenagem.situacao` — a ponte grava ocupação **e** situação |
| capability com HTTP de saída (§10.6, "não verificado") | proibido pelo gate de bytecode (`java.net`): por isso a ponte é um processo à parte e o botão só cria um pedido (`SimExportacao`) |
| "WH-B: milhares de chamadas" (§9) | **WH-A: 1594 chamadas, ≈ 27–43 s; WH-B: 16 042 chamadas, 4 min 10 s** (limpar: 6545 registros em 1 min 13 s) |
| — | repetir um `Confirmar*` em estado terminal devolve OK e **duplica** o histórico; `GET /api/<ep>?campo=` ignora o filtro; `/page` e `GET` por id devolvem datetime em fusos diferentes |
| — | `SimEvento.tSeg` é `tseg` na escrita e `tSeg` no `/page` (Jackson); renomear o campo falhou: a migração recusa o `DROP COLUMN` |
| — | uma saída pode ser liberada **antes** da entrada que lhe dá os paletes (visto no WH-B): a entrada é emitida primeiro |
| — | o WH-A com a política `CrossDocking` **não** cruza nenhum palete (métricas idênticas às da Abc) |

**Extras da P3.4** (verificados ao vivo na :8100; regras em `backend/ponte/mapa.json`, uso em [ponte/DEMO.md](ponte/DEMO.md) §7):

| Extra | O que faz | O que a verificação mostrou |
| --- | --- | --- |
| **Linha de `CrossDocking`** | para cada par (entrada, saída) de eventos `CrossDock`, ativa o cross-docking pelo flow `AtivarCrossDocking` e, se as duas ordens terminaram, o conclui | `POST /cross_dockings` direto dá **500**: só o flow cria. O flow **provisiona a baia** (Area `Cross-Docking`, Rua `CD`, um `LocalArmazenagem` novo) no **primeiro armazém da Entidade** (`AllocationCapability.localizarBaiaCrossDocking`), que com vários espelhos não é o da exportação: o executor move a baia para a Rua `CD` do espelho e apaga a Rua/Area que o flow criou fora do lugar. Não existe flow de concluir: `PUT {situacao: Concluido}` e as flags `crossDockingAtivo` desligadas por `PUT`. **Todo `PUT` em Recebimento/Expedição grava uma linha de histórico** no estágio atual (um `Armazenado` a mais): a ponte apaga a que ela mesma provocou |
| **`propor-ranking`** | a melhor partida validada de um cenário vindo do corporativo → um `PerfilAlocacao` **novo, inativo, sem produtos** com um `RankingRua` por rua de armazenagem (mais paletes guardados = prioridade 1), no armazém de origem | nada existente muda (4 perfis e 25 rankings idênticos antes e depois); repetir não duplica; `limpar` desfaz |
| **`ao-vivo`** | exporta uma partida **reproduzindo o turno** no tempo do jogo (`--velocidade N`): documentos nascem e avançam, ocupação e situação mudam a cada Putaway/Picking | resultado final **idêntico** ao do modo em lote (771 chaves comparadas, zero diferença). **É reprodução, não streaming do navegador:** `SimPartida` só nasce no `ConcluirPartida` e `SimEvento` exige `partidaId`; streaming real pediria um flow de início de partida no backend do jogo (e o anti-fraude correspondente) |

**Decisões** (§11): as cinco foram fechadas com a recomendação do documento e D6–D10 saíram da verificação — ver PLANO §2.
A questão de a definição do produto WmsOffice mudar continua **não** necessária: tudo funciona por REST com os concepts existentes.

**Rastro e replay no servidor:** o rastro (`rastro-v1`, uma linha de `SimEvento` por evento) existe e **habilita** o replay no
servidor (docs/PLANO.md §7, questão 5), mas esse replay continua sendo outra tarefa.
