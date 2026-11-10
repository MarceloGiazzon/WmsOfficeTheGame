# WmsOffice (NPDev) no Linux — runbook

Validado em 2026-11-10 (N0). Pré-requisitos já presentes nesta máquina: Java 17, Python 3, `pwsh`.

## Caminhos

| O quê | Onde |
| --- | --- |
| Definição do app | `~/repos/NPDev/AppGen/apps/_official/WmsOffice/definition` |
| Build root Linux | `~/repos/NPDev/Build/generated-finalapps-linux/wmsoffice` |
| App gerado | `…/generated-finalapps-linux/wmsoffice/App` |
| Chaves JWT (geradas localmente) | `…/App/wmsoffice-keys/jwt-{private-pkcs8,public}.pem` |
| Banco | H2 em arquivo: `…/App/data/npdev_wmsoffice` |
| Backup antes da N0 | `~/repos/NPDev/AppGen/apps/_backups/WmsOffice-2026-11-10-pre-n0.tar.gz` |

O build antigo do Windows (`Build/generated-finalapps/wmsoffice`, com o H2 de dados) **não foi tocado**.

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

## Gerar → compilar → subir

```sh
cd ~/repos/NPDev/NPDev_General
./npdev validate model ../AppGen/apps/_official/WmsOffice/definition/model.json   # 0 erros esperados

cd ~/repos/NPDev
pwsh -NoProfile -File NPDev_General/scripts/appgen/Build-NpdevApp.ps1 \
  -AppFolder "$HOME/repos/NPDev/AppGen/apps/_official/WmsOffice" \
  -BuildRoot "$HOME/repos/NPDev/Build/generated-finalapps-linux"

cd ~/repos/NPDev/Build/generated-finalapps-linux/wmsoffice/App   # IMPORTANTE: rodar daqui (caminhos relativos)
sh _ops/build-final-app.sh
sh _ops/start-app.sh        # http://localhost:8100
sh _ops/stop-app.sh
```

> Se a geração recriar `App/`, copie de volta `wmsoffice-keys/` (ou gere novas — ver abaixo).

Chaves JWT novas:

```sh
mkdir -p wmsoffice-keys && cd wmsoffice-keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private-pkcs8.pem
openssl pkey -in jwt-private-pkcs8.pem -pubout -out jwt-public.pem
```

## Primeiro acesso

```sh
curl -X POST http://localhost:8100/api/auth/bootstrap-admin -H 'Content-Type: application/json' \
  -d '{"username":"admin","displayName":"Administrador","password":"Teste123!"}'
curl -X POST http://localhost:8100/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Teste123!"}'      # → { "token": ... }
```

Chamadas: `Authorization: Bearer <token>`. Tenant: `dev`.

## Armadilhas encontradas

1. **Use os scripts `.sh` de `_ops/`**, não os `.ps1`: `Build-App.ps1` no Linux não compila (termina em 0,0 s e
   tenta abrir um `.cmd` no editor do sistema).
2. **`_ops/smoke-test.sh` falha** neste app: ele só sabe usar `X-Api-Key`, e o WmsOffice roda em `auth.mode=jwt`.
   Verificação equivalente feita manualmente com Bearer (storage summary, create/list/delete, invariant 422).
3. **`prepare-npdev-generator-runtime.ps1`** (em `AppGen/`, fora do git) chamava `cmd.exe`; foi corrigido para
   usar `gradlew` fora do Windows. Os defaults dos parâmetros ainda apontam para `D:\` — passe-os explicitamente.
4. **Manifesto de extensões**: o generator atual exige `untrusted-extension-manifest.json` com todas as entradas.
   O WmsOffice tinha um parcial (só o widget) + o antigo `trusted-source-manifest.json`. Foi consolidado no novo
   (hashes conferidos) e o antigo removido.

## Verificação N0 (2026-11-10)

| Check | Resultado |
| --- | --- |
| `npdev validate model` | 0 erros, 64 avisos (labels) |
| Geração + `bootJar` | OK |
| `/actuator/health` | 200 |
| bootstrap-admin + login | OK (JWT RS256) |
| `GET /api/{armazems,ruas,local_armazenagems,produtos,perfil_alocacaos}` | 200 (401 sem token) |
| `mapa-armazem.html`, `login.html` | 200 |
| Flow `SugerirDestino` (AllocationCapability) | OK — prefere local com o mesmo lote |
| Create/list/delete `PerfilAlocacao` + invariant 0–100 | 200 / 422 / 204 |
