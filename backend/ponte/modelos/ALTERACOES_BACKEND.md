# Alterações no backend do JOGO (`backend/npdev/definition/`) pedidas pela ponte

> Só o app **WmsOfficeTheGame** (:8200). O produto WmsOffice (:8100) **não é alterado** (decisão D1).
> Depois de qualquer mudança: `~/repos/NPDev/NPDev_General/npdev validate model backend/npdev/definition/model.json`
> (0 erros) e `backend/npdev/rebuild.sh`. Nenhuma das mudanças abaixo exige `--reset-db` (tabelas novas, ou campos
> opcionais sem referência numa tabela existente).

## T1.3 — `SimEvento` (rastro da partida)

1. Copiar [SimEvento.json](SimEvento.json) para `backend/npdev/definition/concepts/SimEvento.json`.
2. Em `model.json`, na lista `concepts`, logo depois de `{ "$ref": "concepts/SimScore.json" }`, acrescentar:
   `{ "$ref": "concepts/SimEvento.json" }`
3. Em `model.json`, role `Jogador` → `concepts`, acrescentar: `"SimEvento": ["read", "create"]`
   (o jogador não apaga nem edita eventos; a regra por linha `jogador == $user.id` vale para leitura e escrita).
4. REST resultante: `/api/sim_eventos` e `/api/concepts/SimEvento/page?partidaId=...`.

**Armadilha verificada (2026-11-10): `tSeg` é `tseg` na escrita.** O campo `tSeg` do concept responde como `tseg` em
`POST`/`PUT`/`GET por id` (o Jackson baixa a primeira letra maiúscula de `getTSeg`; mandar `tSeg` dá `422 required field
tSeg is missing`), mas como `tSeg` em `/api/concepts/SimEvento/page`. O cliente escreve `tseg` e lê `tSeg ?? tseg`.
Renomear o campo (ex.: `tempoSeg`) **não** serve: a migração recusa o `DROP COLUMN t_seg` (boot falha, `verdict:
DESTRUCTIVE`; só `--reset-db` resolveria). Se um dia houver `--reset-db` por outro motivo, renomeie então.
Testes: `backend/npdev/tests/p1_sim_evento.py` e `p1_sim_exportacao.py`.

## T1.6 — `SimExportacao` (registro e fila das exportações)

1. Copiar [SimExportacao.json](SimExportacao.json) para `backend/npdev/definition/concepts/SimExportacao.json`.
2. `model.json` → `concepts`: acrescentar `{ "$ref": "concepts/SimExportacao.json" }` depois do `SimEvento`.
3. Role `Jogador` → `concepts`: `"SimExportacao": ["read", "create"]` (o botão da P3 cria a solicitação; quem muda a
   situação é o `ponte.py vigiar`, como admin).
4. REST: `/api/sim_exportacaos`.
5. Sem `lifecycle` de propósito: `Falhou → EmAndamento` (tentar de novo) precisa ser permitido, e quem controla as
   transições é a ponte. A unicidade `(partidaId, alvoUrl)` é conferida pela ponte (o generator não faz unique composto).

## T2.1 — procedência do `SimCenario` (P2)

Acrescentar ao fim de `fields` em `backend/npdev/definition/concepts/SimCenario.json` (todos **opcionais**, nenhum é
`reference` — um campo `required` de referência numa tabela existente faz o boot recusar, ver docs/NPDEV_LINUX.md):

```json
{ "name": "procedencia", "type": "enum", "values": ["Jogo", "Corporativo"], "ui": { "label": "Procedencia" } },
{ "name": "procedenciaUrl", "type": "string", "maxLength": 200, "ui": { "label": "URL de origem" } },
{ "name": "procedenciaArmazemId", "type": "string", "maxLength": 40, "ui": { "label": "Armazem de origem (id)" } },
{ "name": "procedenciaEm", "type": "datetime", "ui": { "label": "Importado em" } }
```

Por que `procedencia` e não `origem` (como no INTEGRACAO §6.3): o front já tem `OrigemCenario`
(`embutido` / `cache` / `rede`, em `src/app/fonteCenarios.ts`), que diz de onde o **pacote** foi carregado. São coisas
diferentes; o mesmo nome confundiria quem lê.

Os cenários semeados (WH-A, WH-B) ficam com `procedencia` nula = "do jogo". Não é preciso migrar nada.
