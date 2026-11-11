# backend/ponte — ponte Jogo ↔ WmsOffice corporativo

Ferramenta Python (só biblioteca padrão) que traduz **uma partida do jogo em documentos do WmsOffice** (Recebimento,
Expedição, Movimento, Lote, ocupação, histórico com a hora do jogo) e **um armazém do WmsOffice em cenário jogável**.
O mapeamento está em [mapa.json](mapa.json), legível, e é o próprio código que o lê.

**Status:** implementada (P0–P3 e os extras da T3.4: cross-docking, `propor-ranking`, `ao-vivo`). Plano: [docs/ponte/PLANO.md](../../docs/ponte/PLANO.md); o que foi feito e medido:
[docs/ponte/CHECKLIST.md](../../docs/ponte/CHECKLIST.md); roteiro de apresentação: [docs/ponte/DEMO.md](../../docs/ponte/DEMO.md).

```
                     JOGO (:8200)                                   CORPORATIVO (:8100)
 navegador ────────► SimPartida / SimScore
 (src/sim grava      SimEvento      (o rastro) ──┐                ┌─► Armazém ESPELHO · Áreas · Ruas · Locais
  o rastro)          SimExportacao  (pedido) ◄─┐ │                │   Lote · Movimento · Recebimento · Expedição
                                               │ ▼                │   ocupação · situação dos locais · histórico (hora do jogo)
                                    ┌──────────────────────┐      │
                                    │ ponte.py (Python)    │ ─────┘
                                    │ fonte → planejador   │ ◄──── importar: Armazém → SimCenario (procedencia "Corporativo")
                                    │ (puro) → executor    │
                                    └──────────────────────┘
```

## Requisitos

- Jogo de pé em `http://localhost:8200` (`backend/npdev/rebuild.sh`); corporativo em `http://localhost:8100`
  (`cd ~/repos/NPDev/Build/generated-finalapps-linux/wmsoffice/App && sh _ops/start-app.sh`).
- Python 3.9+ (testado no 3.12) e, só para `importar`/`ciclo`/`jogar_*.ts`, o Node do projeto (`npx vite-node`).
- Credenciais por variável de ambiente (padrão de dev `admin` / `Teste123!`): `PONTE_ALVO_*`, `PONTE_JOGO_*`,
  `PONTE_ORIGEM_*`; o jogador de teste é `PONTE_JOGADOR_*` (`teste-jogador-2` / `Jogo!Teste2026`).

## Comandos

```sh
# partida real do servidor do jogo -> corporativo (registra o andamento em SimExportacao; a 2ª vez não faz nada, --forcar refaz)
# pares de paletes cross-dock viram uma linha de CrossDocking (--sem-crossdocking desliga)
python3 backend/ponte/ponte.py exportar --partida <uuid> [--alvo http://localhost:8100] [--jogo URL] [--ordens IN-0001,OUT-0003]

# a mesma partida reproduzindo o turno no tempo do jogo (--velocidade 300: um turno de 10 h dura 2 min). É reprodução, não
# streaming: o servidor do jogo só conhece a partida quando ela termina. Partida já exportada: `limpar` e depois --forcar
python3 backend/ponte/ponte.py ao-vivo --partida <uuid> --alvo http://localhost:8100 [--velocidade 300] [--forcar]

# o mesmo a partir de arquivos (pacote do cenário + rastro) — o que os testes usam
python3 backend/ponte/ponte.py exportar --pacote src/data/cenarios/WH-A-PEQUENO.json \
        --rastro backend/ponte/exemplos/wh-a/rastro-abc.json --data 2026-11-10

# desfaz uma exportação ou importação (ordem inversa do diário; Entidade de escopo e Produtos compartilhados ficam)
python3 backend/ponte/ponte.py limpar --diario backend/ponte/estado/<id>.jsonl

# lista os armazéns do corporativo (o id que o importar pede)
python3 backend/ponte/ponte.py armazens [--origem http://localhost:8100]

# corporativo -> jogo: o armazém vira um cenário jogável (--simular só mostra o que faria)
python3 backend/ponte/ponte.py importar --origem http://localhost:8100 --armazem <uuid> [--simular]

# jogo -> corporativo: propõe a ordem de ruas da melhor partida de um cenário importado, como um PerfilAlocacao NOVO e INATIVO
# (nada existente muda; --simular só mostra a ordem antes × depois)
python3 backend/ponte/ponte.py propor-ranking --cenario CORP-<8 do id> [--simular] [--partida <uuid>] [--alvo URL --armazem <uuid>]

# processa os pedidos do botão "Enviar ao WmsOffice" do jogo (deixe rodando durante a demonstração)
python3 backend/ponte/ponte.py vigiar [--intervalo 5] [--uma-vez]

# o ciclo inteiro, sem intervenção: importa -> joga (sem navegador) -> exporta -> imprime os links
python3 backend/ponte/ciclo.py
```

Saída: progresso no stderr; a **última linha do stdout** é um JSON de resumo. Códigos: 0 ok · 1 erro · 2 uso errado ·
3 interrompido por `--parar-apos` (teste de retomada: rodar de novo continua de onde parou).

Rastro de uma partida **sem navegador** (testes, demonstração):

```sh
npx vite-node backend/ponte/jogar_headless.ts <pacote.json> AbcProximidade --saida rastro.json   # só o motor, offline
npx vite-node backend/ponte/jogar_online.ts <codigo-do-cenario> AbcProximidade                    # como jogador: cria a partida, conclui, envia o rastro
```

## Como é feito

| Arquivo | Papel |
| --- | --- |
| `ponte.py` | linha de comando |
| `npdev.py` | cliente REST (login, `pagina` com `sort=id`, `flow`, contador de chamadas) |
| `mapa.json` / `mapa.py` | o dicionário e `preencher()` |
| `fonte.py` | pacote + rastro, de arquivos ou do servidor do jogo; `validar_rastro` |
| `planejador.py` | **puro** (sem rede, sem relógio): `planejar(fonte, mapa, opcoes) → Plano` |
| `executor.py` / `diario.py` | executa o plano de forma idempotente; o diário JSONL (`estado/`, fora do git) guarda cada id criado; `crossdocking` (flow + baia no armazém certo) e o `ritmo` do modo ao vivo |
| `aovivo.py` | `Ritmo`: faz o executor esperar `(tSeg − início do turno) / velocidade` antes de cada operação |
| `propor.py` | `propor-ranking`: melhor partida → ordem de ruas → perfil de alocação proposto (partes puras testadas offline) |
| `exportar_partida.py` | a rotina de `exportar --partida` + registro em `SimExportacao` |
| `importador.py` | corporativo → jogo (P2) |
| `vigia.py` | `vigiar` (P3): executa os pedidos `Solicitada`, só para alvos permitidos (`PONTE_ALVOS_PERMITIDOS`) |
| `ciclo.py` | importar → jogar → exportar |
| `jogar_headless.ts`, `jogar_online.ts` | turno sem navegador (motor puro / como jogador) |
| `referencia/`, `exemplos/`, `modelos/`, `tests/` | referência REST verificada, fixtures, concepts do jogo, testes |

## Testes

```sh
python3 -m unittest discover -s backend/ponte/tests -p 'test_*.py'          # 98 testes, offline
python3 backend/ponte/tests/aceite_p0.py [--completo] [--interromper N]       # ao vivo (:8200): exporta, confere o alvo, limpa
python3 backend/ponte/tests/aceite_p2.py [--limpar]                           # ao vivo: importa, joga e o servidor valida
python3 backend/ponte/referencia/ciclo_rest_verificado.py [--base URL]        # o contrato REST, chamada a chamada
```

## Limites conhecidos

- **Só o rastro de partidas enviadas na hora** vai ao servidor: se a partida ficou na fila (rede caída), o rastro existia só
  na memória da aba e se perdeu; essa partida não pode ir ao WmsOffice. Cenário **embutido** (sem login) também não envia
  rastro (os ids dos locais/ordens são aliases do seed, não existem no banco).
- O campo `SimEvento.tSeg` é `tseg` na escrita e `tSeg` no `/page` (ver `modelos/ALTERACOES_BACKEND.md`).
- `limpar` não mexe no `SimExportacao`: depois de limpar, exporte de novo com `--forcar`.
- O `importar` copia os produtos **ativos** da origem (do perfil do ranking, se houver); numa origem que já recebeu
  exportações da ponte isso inclui os produtos `WHA-*` criados por elas.
- Tamanho: WH-A ≈ 1,6 mil chamadas (≈ 30 s); WH-B ≈ 16 mil (≈ 4 min).
