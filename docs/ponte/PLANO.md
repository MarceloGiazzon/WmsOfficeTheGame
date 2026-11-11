# Ponte Jogo ↔ WmsOffice corporativo — plano de implementação

> Data: 2026-11-10 · Status: **implementado (P0–P3)** — o que foi feito, medido e desviado está no [CHECKLIST.md](CHECKLIST.md); roteiro de apresentação em [DEMO.md](DEMO.md). O texto abaixo é o plano original, mantido como registro (desvios anotados onde se aplicam).
> Origem: [docs/INTEGRACAO_CORPORATIVO.md](../INTEGRACAO_CORPORATIVO.md) (proposta, decisões em aberto, fases P0–P3).
> Para quem: um agente de IA que vai **implementar** a ponte, tarefa por tarefa, sem ter participado da análise.
> Tudo o que é dito como fato aqui foi **verificado no código ou ao vivo**; o que é escolha de projeto está em §2.

---

## 0. Como usar este plano

### 0.1 Ordem de leitura

1. Este arquivo, §0 a §6, **inteiro**, uma vez.
2. [CONTRATO_REST.md](CONTRATO_REST.md): como os dois servidores respondem (verificado ao vivo).
3. [backend/ponte/mapa.json](../../backend/ponte/mapa.json): o dicionário Jogo → Corporativo que o código lê.
4. Depois, **só a tarefa da vez** (§7–§10) e o [CHECKLIST.md](CHECKLIST.md). [PROMPTS.md](PROMPTS.md) tem o texto pronto
   para entregar cada tarefa a um agente.

### 0.2 Artefatos que já existem (não recrie)

| Artefato | Para quê |
| --- | --- |
| [backend/ponte/referencia/ciclo_rest_verificado.py](../../backend/ponte/referencia/ciclo_rest_verificado.py) | Recebimento + expedição completos por REST, chamada a chamada, **verificado** (20 checagens). É o modelo do executor |
| [backend/ponte/mapa.json](../../backend/ponte/mapa.json) | Regras de tradução (chaves, campos, ciclos, ocupação, histórico, importação) |
| [backend/ponte/rastro.schema.json](../../backend/ponte/rastro.schema.json) | Formato do rastro da partida (`rastro-v1`) e as regras que o validador tem de aplicar |
| [backend/ponte/exemplos/mini/](../../backend/ponte/exemplos/mini/) | Cenário mínimo (8 locais, 2 produtos, 5 ordens) + rastro + **resultado esperado** (`esperado.json`) |
| [backend/ponte/tests/test_planejador.py](../../backend/ponte/tests/test_planejador.py) | 29 testes **offline** escritos antes do código: definem `mapa.py`, `fonte.py`, `planejador.py` |
| [backend/ponte/tests/aceite_p0.py](../../backend/ponte/tests/aceite_p0.py) | Aceite **ao vivo** da P0 (e, com `--completo`, da P1): exporta, confere o alvo, reexporta, limpa |
| [backend/ponte/modelos/](../../backend/ponte/modelos/) | `SimEvento.json`, `SimExportacao.json` prontos + [ALTERACOES_BACKEND.md](../../backend/ponte/modelos/ALTERACOES_BACKEND.md) (o que mudar no `model.json`) |

Os testes e o `esperado.json` foram conferidos com um protótipo descartável antes de serem entregues: os 29 testes
offline e o aceite ao vivo (P0 e completo, contra a :8200) passaram com ele. Eles são implementáveis como estão.

### 0.3 Regras de ouro

1. **Uma tarefa por vez, na ordem.** Cada uma termina com o "Pronto quando" verificado de verdade (rodar o comando e ler
   a saída). Marque no [CHECKLIST.md](CHECKLIST.md). Não comece a próxima com a anterior vermelha.
2. **Não altere a definição do produto WmsOffice** (`~/repos/NPDev/AppGen/apps/_official/WmsOffice`). Gravar *dados*
   nele por REST é o objetivo; mudar concept, painel, menu ou `model.json` dele é proibido (decisão D1).
3. **Testes escritos antes do código não mudam para passar.** `test_planejador.py`, `aceite_p0.py`, `esperado.json`:
   se você acha que estão errados, **pare e pergunte** (§11). Acrescentar casos ou opções é permitido; afrouxar uma
   asserção, não.
4. **Python só com a biblioteca padrão** (`urllib`, `json`, `argparse`, `hashlib`, `dataclasses`, `datetime`,
   `zoneinfo`, `unittest`). Nada de `pip install`. TypeScript: só o que já está no `package.json`.
5. **Nunca escreva na topologia de um cenário do jogo.** Na :8200, mudar a `situacao` de um local do WH-A muda o
   próximo turno de todo mundo. A ponte sempre cria um **armazém espelho** (D6).
6. **Não deixe lixo no banco.** Todo teste ao vivo apaga o que criou. Antes de rodar algo que grava, saiba como
   desfazer (`ponte.py limpar`, ou a ordem de remoção do CONTRATO §8).
7. **O motor do jogo não muda de comportamento.** Na P1 você só *anota* eventos: `npm test` verde, os goldens de
   `src/sim/simulation.test.ts` **inalterados**, `VERSAO_MOTOR` igual (`0.3.0`).
8. **Credenciais por variável de ambiente**, nunca no `mapa.json` nem no código (padrão de dev: `admin` /
   `Teste123!`).
9. **Não faça commit nem push** a menos que o dono do projeto peça. Se pedir: um commit por tarefa, mensagem em
   português no estilo do `git log` (`feat(ponte): ...`).
10. **Escreva em português**, como o resto do repositório (código, comentários, mensagens, docs).

### 0.4 Ambiente

| | |
| --- | --- |
| Jogo (backend + front) | `http://localhost:8200` · front em `/jogo/index.html` · runbook [docs/NPDEV_LINUX.md](../NPDEV_LINUX.md) |
| Subir/regerar o jogo | `backend/npdev/rebuild.sh` (a partir da raiz do repo) |
| Corporativo | `http://localhost:8100` · build em `~/repos/NPDev/Build/generated-finalapps-linux/wmsoffice/App` (parado; tem chaves JWT) |
| Subir o corporativo | `cd ~/repos/NPDev/Build/generated-finalapps-linux/wmsoffice/App && sh _ops/start-app.sh` (rodar **de dentro** de `App/`) |
| Saúde | `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8200/actuator/health` → `200` |
| Testes do front | `npm test` · `npx tsc --noEmit` |
| Rodar TS fora do navegador | `npx vite-node <arquivo.ts> <args>` (precedente: `backend/npdev/tools/teorica_cenarios.ts`) |

---

## 1. Objetivo (resumo do INTEGRACAO §4)

1. **Jogo → Corporativo:** depois de uma partida, o WmsOffice mostra o que o jogo fez: recebimentos armazenados,
   expedições confirmadas, movimentos concluídos, histórico com a hora do jogo, Mapa do Armazém com a ocupação final.
2. **Corporativo → Jogo:** um armazém do WmsOffice vira cenário jogável, marcado com a procedência.
3. **Ciclo completo:** criar no corporativo → jogar → o resultado volta como operação.
4. **A ponte é visível:** o mapeamento está em `mapa.json`, legível, e é o próprio código que o usa.

O corporativo é uma instância **fictícia** de portfólio: gravar documentos lá é o objetivo, não um risco. Não proponha
salvaguardas de dado real (LGPD, anonimização, "não falsificar auditoria").

---

## 2. Decisões tomadas

As cinco decisões em aberto do INTEGRACAO §11 foram fechadas com a recomendação do próprio documento; D6–D10 são
novas, saíram da verificação. Se o dono do projeto decidir diferente, a seção afetada está indicada.

| # | Decisão | Por quê | Afeta |
| --- | --- | --- | --- |
| D1 | A definição do produto WmsOffice **não muda** na P0–P2 | Regra anterior do projeto; a ponte funciona só com REST e os concepts existentes | tudo |
| D2 | Alvo inicial **:8200**, depois **:8100** (T1.9) | A :8200 está de pé e tem as mesmas telas; o contrato REST é idêntico | P0, P1 |
| D3 | Exportação **em lote, no fim da partida** | Mais simples; "ao vivo" seria um extra de P3 | P0, P1 |
| D4 | Rastro como **linhas de `SimEvento`** (uma por evento) | Consultável nas telas do NPDev; reenvio idempotente por `seq` | P1 |
| D5 | Ponte = **ferramenta Python** em `backend/ponte/` | Visível, testável, independente; o NPDev não faz HTTP de saída (D8) | tudo |
| D6 | **Armazém espelho** por exportação; `Entidade` de escopo "WmsOffice: The Game" e `Produto` (por código) são **compartilhados** | Nunca tocar a topologia do cenário (regra 5); cada exportação é autocontida e o Mapa do Armazém filtra por armazém | P0 |
| D7 | Retomada por **diário local** (`backend/ponte/estado/<id>.jsonl`, fora do git) + **`SimExportacao`** no jogo como registro | Procedures não são transacionais; o diário guarda cada id criado, na ordem — serve para retomar e para limpar | P0, P1 |
| D8 | Na P3, o botão do jogo **cria uma `SimExportacao` "Solicitada"** e o `ponte.py vigiar` (processo à parte) a executa | Capabilities não podem usar `java.net`; o navegador não fala com a :8100 (outra origem). O próprio registro vira a fila | P3 |
| D9 | **Ocupação e situação dos locais são calculadas no fim** (replay do rastro) e gravadas com **valor absoluto** | Idempotente e retomável; a ordem dos documentos deixa de importar | P0 |
| D10 | Campo de procedência do `SimCenario` se chama **`procedencia`** (não `origem`) | O front já tem `OrigemCenario` (embutido/cache/rede) com outro sentido | P2 |

---

## 3. O que a verificação mudou em relação ao INTEGRACAO

| INTEGRACAO dizia | Verificado (CONTRATO_REST) | Consequência |
| --- | --- | --- |
| Transições intermediárias "presume-se update REST" (§10.2) | `PUT` **parcial** `{estagio}` funciona; pular estado → 422 | Ciclos em `mapa.json → ciclos` |
| `ocorridoEm` "provavelmente carimbado pelo servidor" (§5.2, §10.3) | Fica **nulo**; `descricao` também. Os dois aceitam `PUT` | A ponte grava a **hora do jogo** no histórico (efeito novo) |
| P0 com "4 linhas de histórico" no total (§9) | **4 por documento completo** + 1 por `MovtoLivre`. Mini P0 = 9; mini completo = 19 | `esperado.json` |
| Ocupação não atualizada sozinha (§10.1, não confirmado) | Confirmado. E o Mapa do Armazém pinta por `LocalArmazenagem.situacao` | Gravar ocupação **e** situação (D9) |
| — | Repetir um `Confirmar*` em estado terminal devolve OK e **duplica** histórico | Executor confere o estado antes |
| — | `GET /api/<ep>?campo=` ignora o filtro | Sempre `/api/concepts/<C>/page` |
| — | `/page` devolve datetime em `-03:00`; `GET` por id, em `Z` | Comparar instantes |
| — | Query com espaço quebra o `urllib` | `urlencode` sempre |
| Capability com HTTP de saída "não verificado" (§10.6) | Proibido pelo gate de bytecode (`java.net`) — docs/NPDEV_LINUX.md | D5, D8 |
| WH-B "milhares de chamadas" (§9) | Mini completo = **161 chamadas** (53 na reexportação). Estimativa: WH-A ≈ 700–1000, WH-B ≈ 6000+ | Medir na T1.10 |

Essas correções são levadas ao INTEGRACAO na T3.5.

---

## 4. Arquitetura

```
                      JOGO (:8200)                                   CORPORATIVO (:8100, ou a própria :8200 na P0)
  navegador ──────►  SimPartida / SimScore                         
  (src/sim grava     SimEvento  (rastro, P1)  ───┐                ┌──► Entidade "WmsOffice: The Game" (compartilhada)
   o rastro)         SimExportacao (P1/P3)  ◄──┐ │                │    Armazem ESPELHO ─ Area ─ Rua ─ LocalArmazenagem
                     SimCenario (+procedencia) │ │                │    Produto (por código, compartilhado)
                                               │ ▼                │    Lote · Movimento · MovimentoItem · Posicao
                                    ┌──────────────────────┐      │    Recebimento(+Lote) · Expedicao(+Item)
                                    │ backend/ponte (Python)│ ─────┘    LocalArmazenagemLote · situacao do local
                                    │  fonte → planejador   │           HistoricoMovimentacao (nasce das transições;
                                    │  (puro, lê mapa.json) │            a ponte preenche ocorridoEm/descricao)
                                    │  → executor (REST)    │ ◄──── P2: lê Armazem/Area/Rua/Local/Produto/Ranking
                                    │  diário .jsonl        │
                                    └──────────────────────┘
```

### 4.1 Módulos (`backend/ponte/`)

| Arquivo | Responsabilidade | Fala com servidor? |
| --- | --- | --- |
| `ponte.py` | Linha de comando (`argparse`): `exportar`, `limpar`, `importar`, `vigiar` | via os outros |
| `npdev.py` | Cliente REST: login, `chamar`, `pagina` (paginando), `flow`, contador de chamadas, `ErroPonte` | sim |
| `mapa.py` | `carregar()`, `endpoint()`, `preencher()` | não |
| `fonte.py` | `Fonte(pacote, rastro)`; ler de arquivos (P0) ou do jogo (P1); `validar_rastro` | P1 sim |
| `planejador.py` | **Puro**: `planejar(fonte, mapa, opcoes) → Plano` (lista de `Operacao`) + `Plano.resumo()` | **não** |
| `diario.py` | Diário JSONL: cabeçalho, `tem`, `id`, `anotar`, iterar na ordem | não (arquivo) |
| `executor.py` | Executa um `Plano` contra o alvo usando o diário; idempotente; `parar_apos` | sim |
| `importador.py` | P2: armazém do corporativo → cenário do jogo | sim |
| `vigia.py` | P3: processa `SimExportacao` "Solicitada" | sim |
| `jogar_headless.ts` | Roda um turno inteiro sem navegador e imprime métricas, score e rastro (P1) | não |

A separação **planejador puro × executor** é o coração do desenho: toda regra de negócio fica no planejador e é testada
offline contra `esperado.json`; o executor só sabe "criar/achar, avançar ciclo, upsert, PUT" e é genérico.

---

## 5. Regras de tradução Jogo → Corporativo (normativo)

A fonte da verdade é `mapa.json → jogoParaCorporativo`; aqui está o que o JSON não consegue dizer sozinho.

### 5.1 O que entra numa exportação

- **Eventos** do rastro: todos os `EstoqueInicial`; os demais só se a ordem foi selecionada (`--ordens`, padrão =
  todas). `CrossDock` só entra se **as duas** ordens (`ordemId` e `ordemSaidaId`) estão selecionadas.
- **Ordens:** uma Inbound é exportada se tem ≥ 1 `Putaway` ou `CrossDock` (como `ordemId`); uma Outbound, se tem ≥ 1
  `Picking` ou `CrossDock` (como `ordemSaidaId`). Ordem sem nenhum evento **não é exportada**.
- **Ordem de processamento:** ordens por `(liberacaoSeg, numero)`; dentro do plano, a ordem das seções do mapa:
  compartilhados → topologia → carga inicial → ordens → ocupação → situação → histórico.
  **Exceção (verificada no WH-B):** uma saída que espera estoque pode ser liberada *antes* da entrada que lhe dá os paletes;
  nesse caso a entrada cujo lote a saída retira é emitida primeiro (`planejador.py → emitir_ordem`; `test_planejador_ordem.py`).
- **Produtos compartilhados:** os que aparecem no estoque inicial ou em ordens exportadas, ordenados por `codigo`.

### 5.2 Chaves do diário

Cada registro criado tem uma chave estável, feita **só com ids da fonte** (jogo), nunca do alvo. Modelos em
`mapa.json` (`"chave"`). Os que não são óbvios:

| Chave | Registro |
| --- | --- |
| `lote:inicial:<produtoId>` / `item:inicial:<produtoId>` | um lote e um item por produto do estoque inicial |
| `pos:<seq>` | a posição do evento `seq` (EstoqueInicial, Putaway, Picking) |
| `pos:<seq>:destino` / `pos:<seq>:origem` | as duas posições de um `CrossDock` (lado do recebimento / da expedição) |
| `item:<ordemId>:<loteChave>` | item de expedição por lote (ex.: `item:MINIord-OUT-0001:lote:inicial:MINIprod02`) |
| `ocup:<localId>:<loteChave>` | linha de `LocalArmazenagemLote` |

### 5.3 `preencher(modelo, contexto)` (em `mapa.py`)

- `dict` → `dict` com cada valor preenchido; **chave cujo valor final é `None` é omitida**.
- `{"$ref": "modelo"}` (dict com só essa chave) → `{"$ref": <modelo preenchido como texto>}`.
- `list` → lista preenchida.
- `str` que é **inteira** um marcador `"{a.b}"` → o valor do contexto **com o tipo original** (int, bool, None…).
- `str` com marcadores no meio → `str.format`-like: cada `{a.b}` vira `str(valor)`.
- Marcador = `{` + `[a-zA-Z_][a-zA-Z0-9_.]*` + `}`; caminho com pontos navega dicts.
- Marcador ausente → `KeyError`. Por isso o planejador monta os contextos com **todas** as chaves usadas pelos modelos
  (ex.: `produto.diasValidadePadrao = None` quando o pacote não traz).
- Qualquer outro valor (número, bool, None) → igual.

### 5.4 Contexto comum

`partida.id`, `partida.curto` (8 primeiros caracteres do id), `partida.politica` (`politicaInicial` do rastro),
`cenario.*` (o `cenario` do pacote), `data` (`--data`, `AAAA-MM-DD`; P1: a data de `SimPartida.iniciadaEm` no fuso
`America/Sao_Paulo`), `score.texto` (`" · score 82,86"` a partir de `scoreCentesimos`, ou `""`), `rotulo`.

### 5.5 Quantidades, datas e lotes

- 1 palete = `produto.qtdCaixasPorPallet` unidades (`caixas`).
- Lote de carga inicial: um por produto, `quantidade = nº de paletes iniciais × caixas`.
- Lote de entrada: um por ordem Inbound, `quantidade = nº de eventos (Putaway + CrossDock) × caixas` — o que de fato
  chegou, não o planejado.
- `dataValidade = data + (produto.diasValidadePadrao ou 365) dias`.
- `ExpedicaoItem.quantidade = ordem.quantidadePaletes × caixas` (a demanda inteira); os `MovimentoItem` da saída
  somam só o que saiu, **um por lote** de origem, na ordem da primeira aparição.

### 5.6 Replay (lote de cada palete)

Percorra os eventos exportados em ordem de `seq`, mantendo `local → loteChave`:

- `EstoqueInicial` → o local passa a ter `lote:inicial:<produtoId>`; ocupação `+caixas` no par.
- `Putaway` → o local passa a ter `lote:<ordemId>`; `+caixas`.
- `Picking` → o lote do palete é o que está no local; o local esvazia; `-caixas` naquele par.
- `CrossDock` → o lote é `lote:<ordemId>` (a entrada); **não mexe** na ocupação (o palete vai de doca a doca).

### 5.7 Documentos e ciclos

| Caso | Recebimento / Expedição | Movimento |
| --- | --- | --- |
| Entrada concluída (`OrdemConcluida`) | até `Armazenado` | `Concluido` |
| Entrada com paletes mas não concluída | até `Conferido` | `Pendente` |
| Saída concluída | até `SaidaConfirmada` | `Concluido` |
| Saída com todos os paletes fora do local, não concluída | até `MovimentacaoConcluida` | `Pendente` |
| Saída com parte dos paletes fora | até `DemandaGerada` | `Pendente` |

Ordem dentro de uma entrada: lote → movimento → item → recebimento → recebimentoLote → avançar até `Conferido` →
posições → (se concluída) movimento `Concluido` → recebimento `Armazenado`. Na saída: movimento → expedição →
expedicaoItem → avançar até `DemandaGerada` → itens por lote → posições → (todos saíram) `MovimentacaoConcluida` →
(concluída) movimento `Concluido` → expedição `SaidaConfirmada`. O `test_planejador.py` confere essas ordens.

Cross-dock: a posição do lado do recebimento é `Destino` **na doca de saída** (`localDestinoId`); a do lado da expedição
é `Origem` na mesma doca. `RecebimentoLote.crossDocking = true` se a ordem teve algum cross-dock. Não se cria linha de
`CrossDocking` na P0–P2 (opcional na P3).

### 5.8 Fim do plano

1. **Ocupação** (`tipo "ocupacao"`): um registro por par `(local, lote)` tocado no replay, com o valor final
   (inclusive 0), na ordem do primeiro toque.
2. **Situação** (`tipo "situacao"`): para cada local de rua de área `Armazenagem` que não é `Bloqueado` na fonte:
   `Ocupado` se a soma final do local > 0, senão `Disponivel`. Docas não entram.
3. **Histórico** (`tipo "historico"`): uma operação por movimento exportado, com `dados = {"tempos": {evento: iso},
   "descricoes": {evento: texto}}`. Tempos (`mapa.json → historico.tempos`):

   | Documento | Evento → segundo do jogo usado |
   | --- | --- |
   | Recebimento | `Enderecado` → `liberacaoSeg` · `Conferido` → 1º palete · `Armazenado`, `Concluido` → `OrdemConcluida` |
   | Expedição | `DemandaGerada` → `liberacaoSeg` · `MovimentacaoConcluida` → último palete · `SaidaConfirmada`, `Concluido` → `OrdemConcluida` |
   | Carga inicial | `Concluido` → `inicioTurnoSeg - 1` |

   Só entram os eventos que o documento de fato atingiu. `iso` = `data` + segundos, no fuso `America/Sao_Paulo`,
   convertido para UTC: `AAAA-MM-DDTHH:MM:SSZ`. `descricao` = `"WmsOffice: The Game · <ordem.numero ou 'carga inicial'> ·
   <evento> · <HH:MM:SS do jogo>"`.

### 5.9 Interface do planejador (exigida pelos testes)

```python
@dataclass
class Opcoes:
    data: str                    # "2026-11-10"
    ordens: set | None = None    # números das ordens ("IN-0001"); None = todas
    rotulo: str | None = None

@dataclass
class Operacao:
    tipo: str                    # "garantir" | "avancar" | "ocupacao" | "situacao" | "historico"
    chave: str
    conceito: str                # para "avancar": o nome do ciclo (= conceito)
    dados: dict = field(default_factory=dict)   # corpo, já preenchido; pode conter {"$ref": chave}
    compartilhado: bool = False
    buscarPor: dict | None = None               # só em compartilhados
    ciclo: str | None = None                    # só em "avancar"
    ate: str | None = None                      # só em "avancar": estado-alvo
    def como_dict(self) -> dict: ...            # dataclasses.asdict

class Plano:
    operacoes: list[Operacao]
    def resumo(self) -> dict: ...  # chaves: criados, compartilhados, estados, quantidades, ocupacao, locaisOcupados, historico

def planejar(fonte: Fonte, mapa: dict, opcoes: Opcoes) -> Plano: ...
```

`resumo()`:
- `criados` / `compartilhados`: contagem por conceito das operações `garantir` (separando `compartilhado`) **mais** as
  `ocupacao` (que contam como `LocalArmazenagemLote` criado).
- `estados`: para cada `garantir` de `Movimento` (`situacao`), `Recebimento`/`Expedicao` (`estagio`), o estado do
  corpo; depois cada `avancar` sobrescreve com `ate`.
- `quantidades`: `dados["quantidade"]` de cada `garantir` de `Lote` e `MovimentoItem`.
- `ocupacao`: `[{"local": <id fonte do local>, "lote": <loteChave>, "quantidade"}]` das operações `ocupacao`.
- `locaisOcupados`: ids da fonte das operações `situacao` com `Ocupado`.
- `historico`: `{chaveDoMovimento: [[evento, iso], ...]}`.

---

## 6. Interfaces externas

### 6.1 Linha de comando

```text
python3 backend/ponte/ponte.py exportar --pacote <pacote.json> --rastro <rastro.json> --data AAAA-MM-DD
                                       [--ordens IN-0001,OUT-0001] [--alvo URL] [--parar-apos N]
python3 backend/ponte/ponte.py exportar --partida <uuid> [--jogo URL] [--alvo URL] [--forcar] [--parar-apos N]   (P1)
python3 backend/ponte/ponte.py limpar   --diario <arquivo.jsonl> [--alvo URL]
python3 backend/ponte/ponte.py importar --origem URL --armazem <uuid> [--codigo COD] [--max-docas 2]
                                       [--max-produtos 30] [--qtd-ordens N] [--seed N] [--simular]               (P2)
python3 backend/ponte/ponte.py vigiar   [--intervalo 5] [--uma-vez]                                              (P3)
```

- **Saída:** mensagens de progresso no **stderr**; a **última linha do stdout** é um JSON de resumo. `exportar`:
  `{"diario", "armazemAlvoId", "criados", "reusados", "chamadas"}` (+ `"parado": true` se `--parar-apos` interrompeu).
  `limpar`: `{"apagados", "naoEncontrados"}`. `importar`: `{"cenarioId", "codigo", "ordens", "distanciaTeoricaCm",
  "diario"}`.
- **Códigos de saída:** 0 ok · 1 erro (mensagem no stderr, com o corpo da resposta do servidor) · 2 uso errado ·
  3 interrompido por `--parar-apos`.
- `exportar` aceita **ou** `--pacote/--rastro` **ou** `--partida`, nunca os dois.

### 6.2 Variáveis de ambiente

| Variável | Padrão |
| --- | --- |
| `PONTE_ALVO_URL`, `PONTE_ALVO_USUARIO`, `PONTE_ALVO_SENHA` | `http://localhost:8200`, `admin`, `Teste123!` |
| `PONTE_JOGO_URL`, `PONTE_JOGO_USUARIO`, `PONTE_JOGO_SENHA` | `http://localhost:8200`, `admin`, `Teste123!` |
| `PONTE_ORIGEM_USUARIO`, `PONTE_ORIGEM_SENHA` (P2) | `admin`, `Teste123!` |

`--alvo`/`--jogo`/`--origem` na linha de comando têm precedência sobre a variável.

### 6.3 Diário

- Arquivo: `backend/ponte/estado/<id>.jsonl`, `<id> = sha1(f"{alvoUrl}|{partidaId}")[:12]` (`alvoUrl` sem `/` final).
  A pasta `estado/` entra no `.gitignore`.
- 1ª linha: `{"tipo": "cabecalho", "alvo": ..., "partidaId": ..., "criadoEm": ..., "versaoMapa": 1}`.
- Demais: `{"chave", "conceito", "id", "compartilhado"}`, uma por registro, **gravada (e `flush`) logo depois** do
  `POST` que deu certo (ou de achar o compartilhado/o par de ocupação). Nunca reescreva o arquivo; só acrescente.
- `limpar` percorre o diário **de trás para a frente**, pula `compartilhado`, faz `DELETE` (204 ou 404 = ok) e, no fim,
  renomeia o arquivo para `<id>.jsonl.limpo` (para uma nova exportação começar do zero).
- Janela aceita: se o processo morrer entre um `POST` e a anotação, fica um registro órfão no alvo. É raro e não
  quebra nada (portfólio); não tente resolver.

### 6.4 Executor — o que cada tipo de operação faz

| Tipo | Ação | Idempotência |
| --- | --- | --- |
| `garantir` (compartilhado) | se a chave está no diário → nada; senão `/page` com `buscarPor` → achou: anota; não achou: `POST` e anota | diário + busca |
| `garantir` | se a chave está no diário → nada; senão resolve `$ref`, `POST`, anota | diário |
| `avancar` | `GET`; enquanto o estado atual estiver antes de `ate`: dá o próximo passo do ciclo (`put` → `PUT {campo: estado}`; flow → `POST flows/<via>/execute` com `{**GET, campo: estado}` e exige `status == "OK"`); `GET` de novo a cada passo | olha o estado antes |
| `ocupacao` | id pelo diário ou `/page?localArmazenagemId=&loteId=` → `GET`; se a quantidade difere, `PUT {quantidade}`; se não existe, `POST` e anota | valor absoluto |
| `situacao` | `GET` do local; se difere, `PUT {situacao}` | compara antes |
| `historico` | `/page` de `HistoricoMovimentacao?movimentoId=`; para cada linha cujo `evento` está em `tempos`: se o **instante** de `ocorridoEm` ou a `descricao` diferem, `PUT {ocorridoEm, descricao}` | compara antes |

Erros: qualquer resposta inesperada vira `ErroPonte(mensagem, status, corpo)` com o **corpo do servidor** na mensagem e
para a execução (o diário já guardou o que foi feito; rodar de novo continua dali).

---

## 7. P0 — Fundação e prova do ciclo (alvo :8200, fonte em arquivo)

Meta: `aceite_p0.py` verde (e `--completo` também). Sem mudar o jogo nem o backend.

### T0.1 Esqueleto e cliente REST

- **Arquivos:** `backend/ponte/ponte.py`, `backend/ponte/npdev.py`, `backend/ponte/README.md` (substituir o atual),
  `.gitignore` (acrescentar `backend/ponte/estado/`).
- **Passos:**
  1. `npdev.py`: classe `Cliente(base, usuario, senha)`. Faz login no construtor (`POST auth/login`), guarda o token.
     `chamar(metodo, caminho, corpo=None) -> (status, json|None)` (copie a lógica de `backend/npdev/tests/npdev_api.py`
     → `call`, incluindo ler o corpo de `HTTPError`) e incremente `self.chamadas`. Timeout de 30 s por chamada.
  2. `pagina(conceito, **filtros) -> list[dict]`: `GET concepts/<conceito>/page?` +
     `urlencode({**filtros, "sort": "id", "direction": "asc", "offset": n, "limit": 1000})`, repetindo com
     `n += len(items)` enquanto `hasMore`. O `sort=id` é obrigatório: sem ordem estável, páginas por offset repetem ou
     pulam linhas (é o que `src/net/leitura.ts` → `listarConceito` faz). Pare com erro se vier página vazia com
     `hasMore: true`.
  3. `flow(nome, corpo) -> dict`: `POST flows/<nome>/execute`; se HTTP ≠ 200 ou `status != "OK"`, `ErroPonte`; devolve
     `output`.
  4. `criar(endpoint, corpo) -> dict`, `ler(endpoint, id) -> dict | None` (404 → None), `atualizar(endpoint, id, corpo)`,
     `apagar(endpoint, id) -> bool` (204 → True, 404 → False, outro → `ErroPonte`).
  5. `ErroPonte(Exception)` com `status` e `corpo`; `str()` mostra método, caminho, status e os primeiros 500 caracteres
     do corpo.
  6. `ponte.py`: `argparse` com os subcomandos de §6.1 (só `exportar` e `limpar` agora; os outros respondem "ainda não
     implementado" com saída 2). Função `main()` que captura `ErroPonte`, imprime no stderr e sai com 1.
- **Pronto quando:**
  - `python3 backend/ponte/ponte.py --help` lista os subcomandos;
  - este trecho imprime `1 True` (o produto WHA-P01 do cenário WH-A existe e o contador de chamadas anda):
    `cd backend/ponte && python3 -c "import npdev; c=npdev.Cliente('http://localhost:8200','admin','Teste123!'); print(len(c.pagina('Produto', codigo='WHA-P01')), c.chamadas >= 2)"`;
  - `python3 backend/ponte/referencia/ciclo_rest_verificado.py` continua `OK`.
- **Armadilhas:** query sem `urlencode` (CONTRATO §3); `GET /api/<ep>` em vez de `/page`.

### T0.2 `mapa.py`

- **Arquivo:** `backend/ponte/mapa.py`.
- **Passos:** `carregar(caminho=None)` (padrão: `mapa.json` ao lado do arquivo, `encoding="utf-8"`, feche o arquivo com
  `with`); `endpoint(mapa, conceito)`; `preencher(modelo, contexto)` exatamente como §5.3.
- **Pronto quando:** `python3 -m unittest discover -s backend/ponte/tests -p 'test_planejador.py' -k TestPreencher -v`
  verde (o arquivo importa `fonte` e `planejador`: crie os dois **vazios** antes, só para o import funcionar).

### T0.3 `fonte.py` e a validação do rastro

- **Arquivo:** `backend/ponte/fonte.py`.
- **Passos:**
  1. `@dataclass Fonte(pacote: dict, rastro: dict)`.
  2. `carregar_arquivos(caminho_pacote, caminho_rastro) -> Fonte`: lê os dois JSON, chama `validar_pacote` e
     `validar_rastro`.
  3. `validar_pacote(p)`: tem `cenario, armazem, areas, ruas, locais, produtos, ordens, rankingRuas`; ids únicos; toda
     rua aponta para área existente, todo local para rua existente, toda ordem para produto existente. `ValueError` com
     mensagem clara.
  4. `validar_rastro(r, pacote)`: todas as `x-regras` de `rastro.schema.json` (formato; os 8 campos exatos; `seq`
     0..n-1; `EstoqueInicial` primeiro; `tSeg` não decresce fora deles; campos nulos/preenchidos por tipo; ids existem
     no pacote; Putaway/EstoqueInicial em local vazio e Picking em local com o mesmo produto, num replay; `OrdemConcluida`
     no máximo uma por ordem e nenhum palete da ordem depois dela). Também: `Putaway.ordemId` é Inbound, `Picking.ordemId`
     é Outbound, `CrossDock.ordemId` Inbound e `ordemSaidaId` Outbound. Erro = `ValueError("evento <seq>: <motivo>")`.
- **Pronto quando:** `... -k TestValidarRastro -v` verde.

### T0.4 Planejador — tipos, compartilhados e topologia

- **Arquivo:** `backend/ponte/planejador.py`.
- **Passos:** os tipos de §5.9; `planejar` montando o contexto comum (§5.4), o replay (§5.6) e as operações das
  seções `compartilhados` e `topologia` do mapa (cada `garantir` = `preencher(passo["chave"])`, `preencher(passo["campos"])`,
  e `buscarPor` preenchido nos compartilhados). `situacaoInicial` do local: `Bloqueado` se a fonte é `Bloqueado`, senão
  `Disponivel`. Implemente `resumo()` inteiro já agora (§5.9) — ele só conta o que existir.
- **Pronto quando:** `... -k test_compartilhados -v` verde.

### T0.5 Planejador — carga inicial

- **Passos:** seção `cargaInicial` (lotes e itens por produto na ordem da primeira aparição; uma posição por evento;
  `avancar mov:inicial até Concluido`).
- **Pronto quando:** este trecho (da raiz do repo) imprime `20 20 Concluido 3`:

  ```sh
  cd backend/ponte && python3 -c "
  import fonte, mapa, planejador as p
  f = fonte.carregar_arquivos('exemplos/mini/pacote.json', 'exemplos/mini/rastro.json')
  pl = p.planejar(f, mapa.carregar(), p.Opcoes(data='2026-11-10', ordens=set()))
  r = pl.resumo(); q = r['quantidades']
  print(q['lote:inicial:MINIprod01'], q['lote:inicial:MINIprod02'], r['estados']['mov:inicial'],
        sum(1 for o in pl.operacoes if o.chave.startswith('pos:')))"
  ```

  (`ordens=set()` = nenhuma ordem: só a carga inicial entra.)

### T0.6 Planejador — entradas e saídas

- **Passos:** seções `entrada` e `saida` (§5.1, §5.5, §5.7), com o lote de cada palete vindo do replay.
- **Pronto quando:** `... -k TestOperacoes -v` verde **exceto** `test_finais_vem_no_fim` (depende da T0.7).

### T0.7 Planejador — ocupação, situação, histórico

- **Passos:** §5.8. Fuso via `zoneinfo.ZoneInfo(mapa["fusoHorario"])`.
- **Pronto quando:** `python3 -m unittest discover -s backend/ponte/tests -p 'test_*.py' -v` → **29 testes OK**.

### T0.8 Diário e executor

- **Arquivos:** `backend/ponte/diario.py`, `backend/ponte/executor.py`, `backend/ponte/tests/test_diario.py` (novo,
  offline).
- **Passos:**
  1. `Diario(caminho)`: cria a pasta e o cabeçalho se não existir; carrega se existir; `tem(chave)`, `id(chave)`,
     `anotar(chave, conceito, id, compartilhado)` (acrescenta + `flush`), `registros()` na ordem do arquivo,
     `resolver(dados)` (troca `{"$ref": k}` por `id(k)`, recursivo; `KeyError` se faltar).
  2. `test_diario.py`: (a) anotar 3, reabrir, `registros()` na mesma ordem; (b) `resolver` com ref aninhada;
     (c) `resolver` com ref desconhecida → `KeyError`; (d) cabeçalho só uma vez ao reabrir.
  3. `Executor(cliente, mapa, diario)`: `executar(plano, parar_apos=None) -> dict` com um método por tipo (§6.4).
     Conte `criados` (POSTs) e `reusados` (chave já no diário ou compartilhado achado). Com `parar_apos=N`, pare depois
     da N-ésima operação e devolva `"parado": True`.
- **Pronto quando:** `test_diario.py` verde; os 29 de `test_planejador.py` continuam verdes.

### T0.9 Linha de comando `exportar` / `limpar` e o aceite

- **Passos:** ligar `ponte.py exportar --pacote/--rastro` (fonte → planejador → executor → resumo na última linha) e
  `ponte.py limpar` (§6.3). Progresso no stderr a cada 25 operações (`[  50/161] garantir pos:4`).
- **Pronto quando** (app :8200 de pé):
  - `python3 backend/ponte/tests/aceite_p0.py` → `OK: 0 falha(s)`;
  - `python3 backend/ponte/tests/aceite_p0.py --completo` → `OK: 0 falha(s)`;
  - nada sobrou: `curl` com token em `/api/concepts/Movimento/page?limit=1` → `total` igual ao de antes.

### T0.10 Ver o efeito (manual, curto)

- Exporte o mini **sem** limpar, abra `http://localhost:8200/mapa-armazem.html` (faça login pela própria página ou
  cole o token), filtre pelo armazém "Mini (fixture da ponte) · partida 00000000 · 2026-11-10": 5 posições cinza
  (ocupadas). Depois `ponte.py limpar`. Registre o que viu (uma linha) no CHECKLIST.

---

## 8. P1 — Partida real a partir do rastro

### T1.1 Gravador de rastro no motor

- **Arquivos:** `src/sim/rastro.ts` (novo: tipos), `src/sim/simulation.ts` (anotações), `src/sim/rastro.test.ts` (novo).
- **Passos:**
  1. `rastro.ts`: `export type TipoEventoRastro = 'EstoqueInicial' | 'Putaway' | 'Picking' | 'CrossDock' | 'OrdemConcluida'`
     e `export interface EventoRastro { seq; tipo; tSeg; ordemId: string|null; ordemSaidaId: string|null; produtoId:
     string|null; localId: string|null; localDestinoId: string|null }` (os 8 campos do schema, sempre presentes).
  2. Em `Simulacao`: `private readonly eventosRastro: EventoRastro[] = []`, `private anotar(e: Omit<EventoRastro,'seq'>)`
     (atribui `seq = length`) e `rastro(): readonly Readonly<EventoRastro>[]`.
  3. Pontos de anotação (todos já existem em `simulation.ts`):
     - construtor, logo depois do laço que aplica `gerarEstoqueInicial`: um `EstoqueInicial` por palete, na ordem do
       array, `tSeg = p.entradaSeg`;
     - `atribuirPutaway`, no `aoFim` da operação **no local** (a 2ª `operar`), **antes** de `terminarPalete`: `Putaway`
       com `localId = destinoId`;
     - `atribuirPicking`, no `aoFim` da operação **no local** (a 1ª `operar`): `Picking` com `localId = t.origemId`;
     - `atribuirCrossDock`, no `aoFim` da 2ª `operar`, **antes** dos dois `terminarPalete`: `CrossDock` com
       `ordemId = t.ordem.ordem.id`, `ordemSaidaId = t.saida.ordem.id`, `localId = t.doca.localId`,
       `localDestinoId = t.docaSaida.localId`;
     - `concluirOrdem`: `OrdemConcluida` com `ordemId = o.ordem.id`, `tSeg = this.relogioSeg`.
  4. **Só anotar**: nenhuma outra linha do motor muda.
  5. `rastro.test.ts`: rode o WH-A (`src/data/cenarios/WH-A-PEQUENO.json`) até `terminado` com `AbcProximidade` e com
     `CrossDocking` e confira: `seq` 0..n-1; nº de `EstoqueInicial` = locais ocupados no início; cada `OrdemConcluida`
     única e o total = `snapshot().ordensConcluidas`; para cada entrada concluída, Putaway + CrossDock = `quantidadePaletes`;
     para cada saída concluída, Picking + CrossDock(ordemSaidaId) = `quantidadePaletes`; o replay (local→produto) termina
     com exatamente os locais cuja `situacao` final é `Ocupado`; e (o mais importante) **o mesmo rastro passa na
     validação Python**: grave-o num arquivo temporário e rode `fonte.validar_rastro` — ou faça isso na T1.2.
- **Pronto quando:** `npm test` verde **sem mudar nenhum golden**; `npx tsc --noEmit` limpo; `git diff src/sim/simulation.test.ts` vazio.

### T1.2 `jogar_headless.ts` e o rastro do WH-A

- **Arquivo:** `backend/ponte/jogar_headless.ts`; fixture gerada `backend/ponte/exemplos/wh-a/rastro-abc.json`.
- **Passos:** `npx vite-node backend/ponte/jogar_headless.ts <pacote.json> <politica> [--partida <uuid>] [--saida <rastro.json>]`.
  Carrega o pacote, roda `new Simulacao(pacote, politica)` com `tick()` até `terminado`, monta o rastro `rastro-v1`
  (`partidaId` = `--partida` ou `00000000-0000-4000-8000-000000000000`; `cenarioId`, `cenarioCodigo`, `versaoMotor`
  de `src/net/partidas.ts`, `politicaInicial`, `scoreCentesimos` do snapshot) e imprime no stdout **uma linha**
  `{"metricas": ..., "scoreCentesimos": ..., "rastro": <caminho ou objeto>}`. WmsReal não serve aqui (precisa do
  servidor): recuse com mensagem.
- **Pronto quando:**
  - o rastro do WH-A passa em `fonte.carregar_arquivos('src/data/cenarios/WH-A-PEQUENO.json', 'backend/ponte/exemplos/wh-a/rastro-abc.json')`;
  - rodar duas vezes gera arquivos idênticos (`cmp`);
  - `ponte.py exportar --pacote src/data/cenarios/WH-A-PEQUENO.json --rastro backend/ponte/exemplos/wh-a/rastro-abc.json --data 2026-11-10`
    termina com 0; anote `chamadas` e o tempo (`time`) no CHECKLIST; confira no alvo que o nº de `Recebimento`
    = nº de ordens Inbound com evento e o nº de linhas de histórico = soma esperada (4 por documento completo, 2 por
    entrada parcial, 1–3 por saída parcial, 1 da carga inicial); depois `limpar`.

### T1.3 Concept `SimEvento`

- **Passos:** [ALTERACOES_BACKEND.md](../../backend/ponte/modelos/ALTERACOES_BACKEND.md) → T1.3; `npdev validate model`
  (0 erros); `backend/npdev/rebuild.sh`; novo teste ao vivo `backend/npdev/tests/p1_sim_evento.py` (no estilo de
  `n3_jogador.py`, usando `npdev_api.Api`): o jogador cria eventos da própria partida e os lê pelo `/page`; outro
  jogador **não** os vê; o jogador não consegue apagar; admin apaga (limpeza).
- **Pronto quando:** o teste novo e os antigos (`n1_sim_concepts.py`, `n2_simulacao_flows.py`, `n3_jogador.py`) verdes.

### T1.4 Envio do rastro pelo cliente

- **Arquivos:** `src/net/rastro.ts` (novo), `src/app/resultado.ts`, `src/main.ts`, `src/app/partidaOnline.ts`,
  testes `src/net/rastro.test.ts`.
- **Passos:**
  1. `enviarRastro(http, partidaId, jogador, eventos): Promise<{enviados, jaExistiam}>`: lê os `seq` já gravados
     com `listarConceito(http, 'SimEvento', { partidaId })` (de `src/net/leitura.ts`; ele já pagina com `sort=id`) e
     faz `POST /sim_eventos` só dos que faltam, com `emParalelo(faltam, PARALELISMO, ...)` (mesmo arquivo).
     Corpo = o evento + `partidaId` + `jogador`.
  2. `ResultadoPartida` ganha `rastro: EventoRastro[]` (cópia). `resultadoDaPartida(s, cenario, rastro)` recebe o
     rastro; em `main.ts` (perto da linha que chama `resultadoDaPartida`) passe `this.sim.rastro()` — leia o código para
     achar a referência certa à simulação.
  3. `PartidaOnline.concluir`: depois que a fila devolve `estado: 'enviado'` com a partida do servidor, chame
     `enviarRastro` (aguarde). Falha **não** derruba o resultado: acrescente à mensagem dos extras
     "O rastro não foi enviado; esta partida não poderá ir ao WmsOffice." Partida que ficou `pendente` na fila
     **não** envia rastro (limitação aceita; anote no README).
  4. Testes com o servidor falso (`src/net/servidorFalso.ts`): envia tudo; reenvio só manda o que falta; erro de rede
     num POST rejeita e um novo `enviarRastro` completa.
- **Pronto quando:** `npm test` e `npx tsc --noEmit` verdes; jogando de verdade em `/jogo/index.html` (logado, WH-A,
  ≥ 1 min acelerado) a partida termina e `/api/concepts/SimEvento/page?partidaId=<id>` tem `total` = tamanho do rastro.
  Apague depois a partida e os eventos de teste (memória do projeto: listar antes, apagar só os novos).

### T1.5 Fonte = servidor do jogo (`--partida`)

- **Arquivo:** `fonte.py` → `carregar_do_jogo(cliente, partida_id) -> Fonte`.
- **Passos:** ler `SimPartida` (exige `situacao == "Concluida"`), `SimCenario`, `Armazem`, `Area?armazemId`,
  `Rua?areaId` (por área), `LocalArmazenagem?ruaId` (por rua), `RankingRua?ruaId`, `SimOrdem?cenarioId`, os `Produto`
  das ordens e do perfil das ruas, `SimScore?partidaId`, `SimEvento?partidaId` (ordenar por `seq` no Python). Montar o
  pacote no **mesmo formato** do arquivo (só os campos do modelo, como `src/net/pacote.ts` → `para*`) e o rastro
  `rastro-v1` (`politicaInicial = SimPartida.politica`; ignore eventos cujo `jogador` ≠ `SimPartida.jogador`).
  `data` = data local (America/Sao_Paulo) de `iniciadaEm`. Validar como no arquivo.
- **Pronto quando:** com uma partida real da T1.4, `ponte.py exportar --partida <id>` termina com 0 e o alvo tem os
  documentos (mesma verificação da T1.2); `limpar` limpa.

### T1.6 `SimExportacao` (registro)

- **Passos:** [ALTERACOES_BACKEND.md](../../backend/ponte/modelos/ALTERACOES_BACKEND.md) → T1.6 + rebuild. Em
  `exportar --partida`: procurar `SimExportacao` por `partidaId` + `alvoUrl`; `Concluida` → imprimir o resumo salvo e
  sair 0 sem fazer nada (a não ser com `--forcar`); senão criar/atualizar para `EmAndamento` (`iniciadaEm`), atualizar
  `passo`/`progressoCentesimos` a cada 25 operações, e no fim `Concluida` com `armazemAlvoId`, `totalChamadas`,
  `concluidaEm`; erro → `Falhou` + `mensagem` (primeiros 500 caracteres) e saída 1.
- **Pronto quando:** exportar a mesma partida duas vezes → a 2ª não faz chamadas ao alvo; um erro forçado (alvo
  desligado: `--alvo http://localhost:9`) deixa `Falhou` com mensagem.

### T1.7 Ordens incompletas e cross-dock com partida real

- A regra já está no planejador (T0.6/T0.7 cobrem o `--completo`). Aqui: gere um rastro do WH-A com a política
  `CrossDocking` (T1.2), confira que ele tem eventos `CrossDock`, exporte, veja `RecebimentoLote.crossDocking = true`
  no alvo, limpe.
- **Pronto quando:** `aceite_p0.py --completo` verde e a exportação do WH-A/CrossDocking termina com 0.

### T1.8 Retomada

- **Passos:** acrescentar ao `aceite_p0.py` a opção `--interromper N` (permitido: é uma opção nova, nenhuma asserção
  muda): antes da exportação normal, roda uma vez com `--parar-apos N` (espera saída 3) e só então segue o roteiro.
- **Pronto quando:** `aceite_p0.py --completo --interromper 20` e `--interromper 70` verdes (o diário retomou e o
  resultado é idêntico).

### T1.9 Alvo :8100 (o corporativo de verdade)

- **Passos:**
  1. Subir a :8100 (§0.4). Se não houver admin: `bootstrap-admin` (CONTRATO §1) com `admin`/`Teste123!`.
  2. `python3 backend/ponte/referencia/ciclo_rest_verificado.py --base http://localhost:8100` → `OK`. Se algo diferir
     da :8200, **pare e registre** a diferença no CONTRATO antes de seguir.
  3. `aceite_p0.py --alvo http://localhost:8100 --completo` → `OK`.
  4. Exportar uma partida real (T1.5) para a :8100 e conferir no `http://localhost:8100/mapa-armazem.html`.
- **Pronto quando:** os três verdes; 1 linha no CHECKLIST com o que se viu na tela.

### T1.10 Medir o WH-B

- Gerar o rastro do WH-B (T1.2), exportar para a :8200 com `time`, anotar chamadas e duração, limpar.
- **Se passar de 10 minutos, pare e pergunte** antes de otimizar (opções: paralelizar POSTs independentes; cache de
  GETs do `avancar`). Registre os números no INTEGRACAO §9 (T3.5).

---

## 9. P2 — Corporativo → Jogo ("jogar este armazém")

Pré-requisito: :8100 de pé com pelo menos um armazém. As seeds do produto (`warehouse-a-small`, `warehouse-b-large`,
`warehouse-c-wizard`) não são semeadas automaticamente: se `/api/armazems` da :8100 estiver vazio, rode
`POST /api/admin/seeds/warehouse-a-small/run` **uma vez** (não é idempotente).

### T2.1 Procedência no `SimCenario`

- [ALTERACOES_BACKEND.md](../../backend/ponte/modelos/ALTERACOES_BACKEND.md) → T2.1; validate; rebuild **sem**
  `--reset-db`. **Pronto quando:** app sobe; `n1_sim_concepts.py` e `n3_jogador.py` verdes; o jogo ainda carrega WH-A.

### T2.2 Leitura e validação de jogabilidade (`importar --simular`)

- **Arquivo:** `backend/ponte/importador.py`.
- **Passos:** ler da origem o `Armazem`, suas `Area` (só `Armazenagem`, `Recebimento`, `Expedicao` —
  `mapa.json → corporativoParaJogo.areasCopiadas`), `Rua`, `LocalArmazenagem`, `RankingRua`, `Produto` ativos. Exigir:
  ≥ 1 rua de armazenagem com local, ≥ 1 doca de entrada e ≥ 1 de saída (locais de andar 1 em ruas de
  Recebimento/Expedicao), ≥ 1 produto ativo. Escolher docas (`--max-docas`), produtos (`--max-produtos`), ranking,
  dificuldade, equipamentos, seed, `qtdOrdens` pelas regras do mapa. Com `--simular`, só imprimir o resumo do que seria
  criado (contagens por conceito, docas escolhidas, produtos com o novo código) e sair 0.
- **Pronto quando:** `importar --origem http://localhost:8100 --armazem <id do warehouse-a-small> --simular` imprime
  algo coerente (13 ruas na origem → as de armazenagem + as das docas escolhidas; 15 produtos ativos).

### T2.3 Gravação da topologia no jogo

- **Passos:** gerar uma lista de `Operacao` `garantir` (mesmo tipo do planejador, chaves com prefixo `imp:` sobre ids
  da origem) e executá-la **no jogo** (:8200) com o mesmo `Executor` e um diário próprio
  (`sha1(f"{jogoUrl}|importar|{origemUrl}|{armazemId}")`). Entidade nova "Corporativo · <nome>", armazém
  "<nome> (do corporativo)", produtos `CORP-<codigo>` com `perfilAlocacaoId` do perfil copiado.
- **Pronto quando:** rodar de novo não cria nada; `limpar` com esse diário apaga tudo.

### T2.4 Cenário, ordens e referências

- **Passos:** `garantir` do `SimCenario` (mapa → `corporativoParaJogo.cenario`); flow `GerarOrdensSimulacao` com os
  ids **do jogo**; `POST sim_ordems` de cada ordem (`garantir` com chave `imp:ordem:<numero>`); montar o pacote
  (`PacoteCenario`, ids do jogo) num arquivo temporário; `npx vite-node backend/npdev/tools/teorica_cenarios.ts <pacote>`
  → `distanciaTeoricaCm`; `PUT sim_cenarios/<id>` com `qtdOrdens` e `distanciaTeoricaCm`.
- **Pronto quando:** o cenário aparece em `GET /api/queries/CenariosAtivos` **logado como jogador**; o pacote montado
  pelo front (abra o jogo e escolha o cenário) carrega sem erro.

### T2.5 O servidor aceita uma partida do cenário importado

- **Passos:** teste ao vivo `backend/ponte/tests/aceite_p2.py`: importa (ou reaproveita), monta o pacote do jogo como a
  T1.5 faz, roda `jogar_headless.ts` com `AbcProximidade`, cria `SimPartida` como **jogador de teste**, chama
  `ConcluirPartida` com as métricas e o score → `validadoServidor == true`. Limpa partida, score e (com `--limpar`) a
  importação.
- **Pronto quando:** `aceite_p2.py` verde.

### T2.6 Ciclo completo

- **Arquivo:** `backend/ponte/ciclo.py` (ou `demo_ciclo.sh`): importar da :8100 → jogar headless → registrar partida,
  score e `SimEvento` na :8200 (como jogador de teste) → `exportar --partida` para a :8100 → imprimir os links
  (`/mapa-armazem.html` da :8100, o armazém espelho criado).
- **Pronto quando:** roda de ponta a ponta sem intervenção e o Mapa do Armazém da :8100 mostra o armazém espelho
  ocupado. 1 linha no CHECKLIST.

---

## 10. P3 — Apresentação

### T3.1 `ponte.py vigiar`

- **Arquivo:** `backend/ponte/vigia.py`. Laço: `/page` de `SimExportacao?situacao=Solicitada` (no jogo, como admin);
  para cada uma, a mesma rotina do `exportar --partida` para `alvoUrl`; dorme `--intervalo`; `--uma-vez` processa o que
  houver e sai; Ctrl+C sai limpo. Só aceite `alvoUrl` de uma lista permitida (`PONTE_ALVOS_PERMITIDOS`, padrão
  `http://localhost:8100,http://localhost:8200`) — senão marca `Falhou` "alvo não permitido".
- **Pronto quando:** criar uma `SimExportacao` "Solicitada" à mão (POST como jogador) e `vigiar --uma-vez` a deixa
  `Concluida`.

### T3.2 Botão "Enviar ao WmsOffice" na tela de resultado

- **Arquivos:** `src/net/exportacao.ts` (novo: `solicitarExportacao`, `situacaoExportacao`), `src/ui/resultado.ts`,
  `src/app/partidaOnline.ts`.
- **Comportamento:** só aparece com partida no servidor e rastro enviado. Clique → `POST /sim_exportacaos`
  `{partidaId, alvoUrl, situacao: "Solicitada", solicitadaPor, solicitadaEm}`; depois consulta a cada 3 s (até
  10 min) e mostra `passo`/`progresso`; em `Concluida`, mostra "Ver no WmsOffice" com o endereço
  `<alvo>/mapa-armazem.html` **como texto copiável e link** (o armazém se chama "<cenário> · partida <8 chars> · <data>");
  em `Falhou`, a `mensagem`. Sem vigia rodando, depois de 30 s em `Solicitada`, explicar: "a ponte não está rodando
  (`python3 backend/ponte/ponte.py vigiar`)". Alvo: `import.meta.env.VITE_PONTE_ALVO_URL`, padrão
  `http://localhost:8100`.
- **Pronto quando:** testes com servidor falso (solicitar, progresso, concluída, falhou, sem vigia) e um teste manual
  de ponta a ponta com o vigia ligado.

### T3.3 Selo de procedência

- `src/net/pacote.ts` → `paraCenario` lê `procedencia` (opcional); `ResumoCenario` ganha `procedencia?`;
  `src/ui/preJogo.ts` mostra "do WmsOffice corporativo" no cartão. Pacotes embutidos não têm o campo.
- **Pronto quando:** `npm test`; o cenário importado mostra o selo, WH-A não.

### T3.4 (opcional) Extras de efeito — **feitos em 2026-11-10 a pedido do dono do projeto**

> Verificação, desvios e o que cada um faz de verdade: [CHECKLIST.md](CHECKLIST.md) (T3.4) e INTEGRACAO §13. Em resumo: o
> `CrossDocking` só se cria pelo flow e este põe a baia no armazém errado (a ponte a move); a proposta de ranking é um
> perfil novo e inativo; o "ao vivo" é uma **reprodução** do turno concluído (`SimPartida` só existe no fim da partida).

- Linha de `CrossDocking` (flow `AtivarCrossDocking` + concluir) para cada par cross-dock.
- O jogo propor `RankingRua` (a ordem de ruas da melhor partida) ao corporativo.
- Modo "ao vivo" (D3): exportar evento a evento durante o turno.
  Cada um só com pedido explícito do dono do projeto.

### T3.5 Documentação e demonstração

- `backend/ponte/README.md` (como rodar tudo), `docs/ponte/DEMO.md` (roteiro de 5 minutos com os comandos e o que
  mostrar em cada tela), diagrama no README do jogo, e o INTEGRACAO atualizado: status por fase, correções de §3 deste
  plano, números da T1.10. `docs/PLANO.md` §7, questão 5: o rastro existe e habilita o replay no servidor.
- **Pronto quando:** alguém consegue seguir o DEMO.md do zero.

---

## 11. Quando parar e perguntar

Pare, descreva o que viu (comando, saída, arquivo:linha) e pergunte ao dono do projeto quando:

1. um teste escrito antes do código (ou o `esperado.json`) parece errado;
2. o servidor responde diferente do CONTRATO_REST (rode a referência para confirmar);
3. a única saída parece ser mudar a definição do produto WmsOffice, a topologia de um cenário do jogo, um golden do
   motor ou a `VERSAO_MOTOR`;
4. precisa de `rebuild.sh --reset-db` (apaga o banco do jogo);
5. a exportação do WH-B passa de 10 minutos (T1.10);
6. vai apagar algo que não foi o seu código que criou.

## 12. Fora de escopo

SSO entre os apps; replicação contínua; validação do ranking por replay no servidor (o rastro a habilita, mas é outra
tarefa); mudar a definição do produto WmsOffice; proteções de dado real; estoque inicial vindo do corporativo na P2
(exigiria mudar o motor e a `VERSAO_MOTOR`).
