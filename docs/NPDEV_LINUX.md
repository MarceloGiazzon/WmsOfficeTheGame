# Backend NPDev no Linux — runbook

Validado em 2026-11-10 (N0). Pré-requisitos já presentes nesta máquina: Java 17, Python 3, `pwsh`.

Há dois apps NPDev envolvidos:

| App | Definição | Porta | Papel |
| --- | --- | --- | --- |
| **WmsOfficeTheGame** | este repo, [`backend/npdev/`](../backend/npdev/) | **8200** | backend do jogo |
| WmsOffice (produto) | `~/repos/NPDev/AppGen/apps/_official/WmsOffice` | 8100 | produto real, independente — só referência |

## Caminhos (jogo)

| O quê | Onde |
| --- | --- |
| Build root Linux | `~/repos/NPDev/Build/generated-finalapps-linux/wmsofficethegame` |
| App gerado | `…/wmsofficethegame/App` |
| Chaves JWT (geradas localmente) | `…/App/wmsoffice-keys/jwt-{private-pkcs8,public}.pem` |
| Banco | H2 em arquivo: `…/App/data/npdev_wmsofficethegame` |

## Uma vez por clone / após atualizar o NPDev

```sh
cd ~/repos/NPDev/NPDev_General
./npdev doctor
./npdev setup --build-local          # jars do kernel/runtimehost

cd ~/repos/NPDev
pwsh -NoProfile -File AppGen/generator-runtime/prepare-npdev-generator-runtime.ps1 \
  -ProductRepo "$HOME/repos/NPDev/NPDev_General" \
  -RuntimeRoot "$HOME/repos/NPDev/AppGen/generator-runtime" \
  -GradleUserHome "$HOME/repos/NPDev/Build/gradle-user-home" -Force
```

## Gerar → compilar → subir (jogo)

Atalho para tudo abaixo (valida, para o app, salva/restaura as chaves JWT, gera, compila e sobe):
`backend/npdev/rebuild.sh` (a partir da raiz deste repo). Passo a passo:

```sh
cd ~/repos/NPDev/NPDev_General
./npdev validate model ~/repos/WmsOfficeTheGame/backend/npdev/definition/model.json   # 0 erros esperados

cd ~/repos/NPDev
pwsh -NoProfile -File NPDev_General/scripts/appgen/Build-NpdevApp.ps1 \
  -AppFolder "$HOME/repos/WmsOfficeTheGame/backend/npdev" \
  -BuildRoot "$HOME/repos/NPDev/Build/generated-finalapps-linux"

cd ~/repos/NPDev/Build/generated-finalapps-linux/wmsofficethegame/App   # IMPORTANTE: rodar daqui (caminhos relativos)
sh _ops/build-final-app.sh
sh _ops/start-app.sh        # http://localhost:8200
sh _ops/stop-app.sh
```

> A geração **sempre** recria `App/` e apaga `wmsoffice-keys/`: copie a pasta para fora antes e de volta depois
> (ou gere novas — abaixo). O banco em `App/data/` sobrevive à regeneração.

Testes do jogo, em `backend/npdev/tests/`: `n2_simulacao_capability.py` (offline) e, com o app de pé,
`n1_sim_concepts.py`, `n2_simulacao_flows.py` e `n3_jogador.py`.

Banco novo (apaga o atual, com backup): `backend/npdev/rebuild.sh --reset-db` — recria o admin (`admin`/`Teste123!`)
e semeia os cenários `WH-A-PEQUENO` e `WH-B-MEGA`. Usuário jogador: `POST /api/auth/create-user` (como admin) com
`{"username","displayName","password","roleNames":["Jogador"]}`.

Chaves JWT novas (dentro de `App/`):

```sh
mkdir -p wmsoffice-keys && cd wmsoffice-keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private-pkcs8.pem
openssl pkey -in jwt-private-pkcs8.pem -pubout -out jwt-public.pem
```

## Primeiro acesso

```sh
curl -X POST http://localhost:8200/api/auth/bootstrap-admin -H 'Content-Type: application/json' \
  -d '{"username":"admin","displayName":"Administrador","password":"Teste123!"}'
curl -X POST http://localhost:8200/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Teste123!"}'      # → { "token": ... }
```

Chamadas: `Authorization: Bearer <token>`. Tenant: `dev`.

## Armadilhas encontradas

1. **Use os scripts `.sh` de `_ops/`**, não os `.ps1`: `Build-App.ps1` no Linux não compila (termina em 0,0 s e
   tenta abrir um `.cmd` no editor do sistema).
2. **`_ops/smoke-test.sh` falha**: ele só sabe usar `X-Api-Key`, e o app roda em `auth.mode=jwt`.
   Verificação equivalente feita manualmente com Bearer.
3. **`prepare-npdev-generator-runtime.ps1`** (em `AppGen/`, fora do git) chamava `cmd.exe`; foi corrigido para
   usar `gradlew` fora do Windows. Os defaults dos parâmetros ainda apontam para `D:\` — passe-os explicitamente.
4. **Manifesto de extensões**: o generator atual exige `untrusted-extension-manifest.json` com todas as entradas
   referenciadas pelo modelo. (O produto WmsOffice tinha um manifesto parcial e não gerava — ver abaixo.)

## Limitações do NPDev encontradas ao escrever capabilities/procedures (N2) e permissões (N3)

Todas verificadas ao vivo em 2026-11-10; as soluções adotadas estão nos comentários do `model.json` e da capability.

| Limitação | Sintoma | Como contornar |
| --- | --- | --- |
| Gate de bytecode nas capabilities Java | App não sobe: `B30:plugin_bytecode_violation ... LambdaMetafactory` | Sem lambdas/method references (classes anônimas); sem `java.io`, `java.net`, reflection, threads. O teste offline roda o inspector real do kernel |
| Procedures **não são transacionais** | Um passo que falha não desfaz os anteriores | Validar tudo antes e ordenar as escritas para que a que pode falhar venha primeiro |
| Estado do procedure é serializado para o processo do plugin a cada `capabilityCall` | `PLUGIN_EXECUTION_FAILED: Java 8 date/time type OffsetDateTime not supported` se houver no estado um registro com `datetime` | Fazer `capabilityCall` antes de `readConcept`/`patchConcept` de concepts com `datetime` |
| `return` só resolve referência de primeiro nível | `{"a": "$x"}` volta com a string literal `"$x"` | Devolver um único `$ref` (ou um objeto todo literal) |
| Referência a registro lido | Validador recusa `$registro.data.campo` | Usar `$registro.campo` |
| Patch para o mesmo estado do lifecycle | `Concluida → Concluida` é aceito (não conta como transição) | Conferir o estado antes de escrever |
| Saída de procedure que devolve registro | Vem como envelope `{conceptName, id, tenantId, data}` | O cliente lê `output.data` |
| **`createConcept`/`updateConcept` em flow ignoram `access.*`** (N3) | Um jogador criou um `LocalArmazenagem` pelo flow `CriarLocalArmazenagemVerificado`, apesar do `access.write` | Não dar `capability.invoke` a roles não confiáveis; escritas de usuário comum só por REST ou procedure (`patchConcept` passa pelo gateway) |
| `capability.invoke` é global e só é concedido via "flow wrapper" de CRUD | Flow com `capabilityCall` dá `Permission 'capability.invoke' denied` para a role | Para roles restritas, flows só com `callProcedure` (procedures não checam esse gate) |
| CRUD por role (`roles[].concepts`) só vale no REST | Procedures/flows escrevem mesmo sem o `create` da role | Usar isso a favor: tirar o CRUD do REST e deixar a escrita só pelo procedure |
| `$user.id` é o username (`sub` do JWT) | `jogadorId == $user.id` nunca casa com o UUID de `identity::User` | Guardar o dono como texto (username) |
| Listar um concept em `roles[].concepts` fecha o concept para quem não está listado | Outras roles perdem acesso | Listar todas as roles que precisam |
| Campo novo `required` de referência numa tabela existente | Boot recusado ("tables with existing data"), **mesmo com a tabela vazia** | Em dev: `rebuild.sh --reset-db` |
| Seeds não são transacionais nem idempotentes | Rodar de novo duplica a topologia e falha no primeiro `unique` | `tools/semear_cenarios.py` (pula cenário existente) |

## Nota sobre o produto WmsOffice

Durante a N0 (antes da decisão de separar os apps), o WmsOffice foi gerado e testado nesta máquina em
`Build/generated-finalapps-linux/wmsoffice` (porta 8100, hoje parado). Para isso, **um arquivo do produto foi
alterado**: o `untrusted-extension-manifest.json` foi completado com as entradas do antigo
`trusted-source-manifest.json`, que foi removido — sem isso o produto não gera com o NPDev atual.
Backup do estado anterior: `~/repos/NPDev/AppGen/apps/_backups/WmsOffice-2026-11-10-pre-n0.tar.gz`.
**Decisão (2026-11-10): a correção fica no produto.**

## Verificação (2026-11-10)

| Check | WmsOffice (8100) | WmsOfficeTheGame (8200) |
| --- | --- | --- |
| `npdev validate model` | 0 erros | 0 erros |
| Geração + `bootJar` | OK | OK |
| `/actuator/health` | 200 | 200 |
| bootstrap-admin + login (JWT RS256) | OK | OK |
| REST com token / sem token | 200 / 401 | 200 |
| `mapa-armazem.html` | 200 | 200 |
| Flow `SugerirDestino` (AllocationCapability) | OK | OK |
| Create/list/delete + invariant | 200 / 422 / 204 | — |
