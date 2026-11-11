# Ponte Jogo ↔ WmsOffice — roteiro de 5 minutos

> Para mostrar o ciclo: **criar no corporativo → jogar → o resultado volta como operação**. Tudo local, dados fictícios.
> Comandos a partir da raiz do repositório. Detalhes de cada peça: [backend/ponte/README.md](../../backend/ponte/README.md).
> Os extras (cross-docking, proposta de ranking, ao vivo) estão no [§7](#7-extras-t34).

## 0. Antes (uma vez, ~2 min)

| O quê | Como |
| --- | --- |
| Jogo de pé (:8200) | `backend/npdev/rebuild.sh` — o jogo abre em <http://localhost:8200/jogo/index.html> |
| Corporativo de pé (:8100) | `cd ~/repos/NPDev/Build/generated-finalapps-linux/wmsoffice/App && sh _ops/start-app.sh` |
| Há um armazém no corporativo | `python3 backend/ponte/ponte.py armazens` lista `id  nome`; se vier vazio, rode o seed **uma vez** (não é idempotente), com o token do `admin`: `TOKEN=$(curl -s -X POST localhost:8100/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"Teste123!"}' \| python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')` e então `curl -s -X POST -H "Authorization: Bearer $TOKEN" localhost:8100/api/admin/seeds/warehouse-a-small/run` |
| Logins | corporativo e jogo: `admin` / `Teste123!`; jogador de teste: `teste-jogador-2` / `Jogo!Teste2026` |
| A ponte ligada (para o botão do jogo) | `python3 backend/ponte/ponte.py vigiar` num terminal à parte, e deixe rodando |

Conferir que os dois servidores respondem: `curl -s -o /dev/null -w '%{http_code}\n' localhost:8100/` (302 é normal) e
`curl -s -o /dev/null -w '%{http_code}\n' localhost:8200/jogo/index.html` (200). A URL do jogo termina em
`/jogo/index.html`: a `/jogo/` sozinha dá 404.

## 1. O armazém nasce no corporativo e vira um cenário do jogo (≈ 20 s)

```sh
python3 backend/ponte/ponte.py armazens        # copie o id do "Armazem Geral" (o que NÃO tem "partida" no nome)
python3 backend/ponte/ponte.py importar --origem http://localhost:8100 --armazem <id do "Armazem Geral"> --simular   # só mostra
python3 backend/ponte/ponte.py importar --origem http://localhost:8100 --armazem <id do "Armazem Geral">            # grava no jogo
```

Mostrar: o resumo do `--simular` (ruas, locais, docas escolhidas, produtos `CORP-…`) e, no jogo (entre como
`teste-jogador-2`), o cartão do cenário **CORP-…** com o selo **"do WmsOffice corporativo"**. Importar de novo não cria nada.

## 2. Jogar o armazém do corporativo (≈ 2 min)

No jogo: escolha o cenário **CORP-…**, política Curva ABC, *Iniciar turno*. (Dica: dispense o tutorial com *Pular* e use
a velocidade 5×.) No fim do turno: score validado pelo servidor, ranking e, no cartão do score, **WmsOffice corporativo →
Enviar ao WmsOffice**.

*Sem navegador, o mesmo turno:* `npx vite-node backend/ponte/jogar_online.ts CORP-<8 do id> AbcProximidade` (o último JSON
impresso traz o `partidaId`).

## 3. O resultado volta ao corporativo (≈ 1,5 min)

Clique em **Enviar ao WmsOffice**. A tela mostra "Pedido feito…" → "Enviando ao WmsOffice: NN%" → **"Partida enviada"** com o
endereço do Mapa do Armazém (copiável). Se a ponte não estiver rodando, depois de 30 s a tela diz como ligá-la
(`python3 backend/ponte/ponte.py vigiar`) e anda sozinha quando ela ligar.

*Sem navegador:* `python3 backend/ponte/ponte.py exportar --partida <partidaId> --alvo http://localhost:8100`.

## 4. O efeito no corporativo (≈ 1 min)

Abra <http://localhost:8100/mapa-armazem.html> e escolha o armazém **"<cenário> · partida <8 do id> · <data>"** (o espelho
desta partida): as posições ocupadas no fim do turno aparecem pintadas. Nas telas de **Recebimentos**, **Expedições** e
**Movimentos** estão os documentos da partida (recebimentos *Armazenado*, expedições *Saída confirmada*, movimentos
*Concluído*) e o **histórico** de cada movimento tem a **hora do jogo** (`08:10:20`, não a hora real).

## 5. Tudo de uma vez, sem cliques

```sh
python3 backend/ponte/ciclo.py          # importa → joga → exporta → imprime os links (≈ 2 min)
```

## 6. Desfazer

Cada comando imprime o caminho do diário (`backend/ponte/estado/<id>.jsonl`):

```sh
python3 backend/ponte/ponte.py limpar --diario backend/ponte/estado/<id>.jsonl      # a exportação (no corporativo) ou a importação (no jogo)
```

Depois de um `limpar`, exportar a mesma partida de novo pede `--forcar` (o pedido `SimExportacao` continua `Concluida`).

## 7. Extras (T3.4)

### 7.1 Cross-docking vira uma linha de `CrossDocking` (automático)

Quando a partida tem paletes que foram direto da doca de entrada à de saída (política *Cross-Docking*), a exportação cria,
para cada par entrada/saída, o registro **Cross-Docking** (Recebimento ↔ Expedição, quantidade, baia) e deixa as flags
`crossDockingAtivo` como o produto deixaria (desligadas se as duas ordens terminaram). Ver no menu do corporativo
*Demanda → Cross-Docking*. A baia é uma posição nova na rua **CD** da área **Cross-Docking** do armazém espelho; no Mapa do Armazém ela aparece no topo, como posição
*ocupada* (é assim que o produto a cria), e entra na contagem de posições e ocupadas. Para exportar sem isso:
`--sem-crossdocking`. O WH-A real **não** cruza nenhum palete; para ver, use o cenário de exemplo:

```sh
python3 backend/ponte/ponte.py exportar --pacote backend/ponte/exemplos/wh-a/pacote-crossdock.json \
        --rastro backend/ponte/exemplos/wh-a/rastro-crossdock.json --data 2026-11-10 --alvo http://localhost:8100
python3 backend/ponte/ponte.py limpar --diario <o diário que o comando imprimiu>
```

### 7.2 O jogo propõe uma ordem de ruas (≈ 10 s)

```sh
python3 backend/ponte/ponte.py propor-ranking --cenario CORP-<8 do id> --simular   # mostra a ordem antes × depois
python3 backend/ponte/ponte.py propor-ranking --cenario CORP-<8 do id>             # grava a proposta no armazém de origem
```

Pega a **melhor partida validada** do cenário e ordena as ruas de armazenagem pelos paletes que ela guardou em cada uma. No
corporativo aparece um **Perfil de Alocação** novo, **inativo**, "Proposta do jogo · CORP-… · partida …", com a prioridade 1..n
de cada rua. É só uma proposta: nenhum perfil existente muda e nenhum produto é ligado a ele; quem decide adotar liga os
produtos. Desfazer: `limpar --diario <o diário impresso>`.

### 7.3 Ao vivo: o turno se reproduz no corporativo (≈ 2 min)

```sh
python3 backend/ponte/ponte.py ao-vivo --partida <partidaId> --alvo http://localhost:8100 --velocidade 300 [--forcar]
```

Com <http://localhost:8100/mapa-armazem.html> aberto no armazém espelho (recarregue de vez em quando), as posições vão
ficando ocupadas e liberadas, e os documentos nascem e avançam **no relógio do jogo** (o terminal mostra `10:57:50 …`):
`--velocidade 300` faz um turno de 10 h durar 2 min; `1200`, 30 s de espera (o resto é o tempo das chamadas). O resultado
final é idêntico ao da exportação em lote (conferido: 771 chaves, zero diferença). **É uma reprodução, não streaming do
navegador:** o servidor do jogo só conhece a partida quando ela termina. Se a partida já foi exportada para esse
alvo, o comando diz qual diário apagar: `ponte.py limpar --diario <esse>` e depois repita com `--forcar`.

## Se algo não anda

- `exportar` diz "já exportada": o pedido já está `Concluida` no jogo — use `--forcar` (depois de um `limpar`).
- "alvo não permitido": o `vigiar` só executa `PONTE_ALVOS_PERMITIDOS` (padrão `http://localhost:8100,http://localhost:8200`).
- `importar` diz "--armazem tem de ser o id (uuid)": rode `python3 backend/ponte/ponte.py armazens` e copie o id.
- Rodar o contrato REST contra o servidor: `python3 backend/ponte/referencia/ciclo_rest_verificado.py --base http://localhost:8100`.
