#!/usr/bin/env sh
# Valida, compila o jogo, regenera, compila e sobe o backend (WmsOfficeTheGame, porta 8200) no Linux.
# Preserva as chaves JWT (a geração recria App/ e apaga wmsoffice-keys/). O banco em App/data/ sobrevive.
#
# O front do jogo (Vite) é compilado para web/jogo/ por `npm run deploy:npdev` — a geração copia web/ para os
# estáticos do app e apaga tudo o que não vem de lá, então o jogo precisa estar em web/jogo/ ANTES de gerar. Por isso
# este script roda o deploy sempre (≈5 s) e o jogo fica em http://localhost:8200/jogo/index.html (N5; "/jogo/" sozinho dá 404).
#
# Uso: backend/npdev/rebuild.sh              # tudo (inclui o deploy do jogo)
#      backend/npdev/rebuild.sh --no-start    # não sobe o app no final
#      backend/npdev/rebuild.sh --sem-jogo    # não recompila o front (usa o web/jogo/ que já existir; sem ele o app sobe sem o jogo)
#      backend/npdev/rebuild.sh --reset-db    # apaga o banco (backup em Build/generated-finalapps-linux/wmsofficethegame-data-backups/),
#                                             # recria o admin e semeia os cenários (tools/semear_cenarios.py).
#        Necessário quando a migração recusa a mudança de schema (ex.: novo campo `required` de referência
#        numa tabela que já existe — o NPDev recusa mesmo com a tabela vazia).
# Variáveis: NPDEV_ROOT (default ~/repos/NPDev)
set -eu

START=1
RESET_DB=0
SEM_JOGO=0
for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    --sem-jogo) SEM_JOGO=1 ;;
    --reset-db) RESET_DB=1 ;;
    *) echo "opção desconhecida: $arg"; exit 2 ;;
  esac
done
ADMIN_USER=${ADMIN_USER:-admin}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-Teste123!}

HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
NPDEV_ROOT=${NPDEV_ROOT:-$HOME/repos/NPDev}
BUILD_ROOT="$NPDEV_ROOT/Build/generated-finalapps-linux"
APP="$BUILD_ROOT/wmsofficethegame/App"
KEYS_BAK=$(mktemp -d)
trap 'rm -rf "$KEYS_BAK"' EXIT

echo "== validate"
(cd "$NPDEV_ROOT/NPDev_General" && ./npdev validate model "$HERE/definition/model.json") > "$KEYS_BAK/validate.json" 2>&1 || true
if ! grep -q '"errors": 0' "$KEYS_BAK/validate.json"; then
  grep -A3 '"severity": "error"' "$KEYS_BAK/validate.json" | head -40
  echo "validate: há erros — abortado"; exit 1
fi

# Antes do stop: se o front não compilar, o app que está rodando não é derrubado à toa.
if [ "$SEM_JOGO" = 1 ]; then
  [ -f "$HERE/web/jogo/index.html" ] || echo "AVISO: --sem-jogo e não há web/jogo/ — o app sobe sem o jogo (rode 'npm run deploy:npdev')."
else
  echo "== jogo (npm run deploy:npdev)"
  [ -d "$REPO_ROOT/node_modules" ] || { echo "node_modules ausente em $REPO_ROOT — rode 'npm install' (ou use --sem-jogo)"; exit 1; }
  (cd "$REPO_ROOT" && npm run deploy:npdev) > "$KEYS_BAK/jogo.log" 2>&1 \
    || { tail -30 "$KEYS_BAK/jogo.log"; echo "deploy do jogo falhou (use --sem-jogo para subir só o backend)"; exit 1; }
  [ -f "$HERE/web/jogo/index.html" ] || { echo "deploy do jogo não gerou web/jogo/index.html"; exit 1; }
fi

if [ -d "$APP" ]; then
  echo "== stop"
  (cd "$APP" && sh _ops/stop-app.sh) || true
  [ -d "$APP/wmsoffice-keys" ] && cp -r "$APP/wmsoffice-keys" "$KEYS_BAK/"
fi

if [ "$RESET_DB" = 1 ] && [ -d "$APP/data" ]; then
  BK="$NPDEV_ROOT/Build/generated-finalapps-linux/wmsofficethegame-data-backups/$(date +%Y%m%dT%H%M%S)"
  echo "== reset-db (backup em $BK)"
  mkdir -p "$BK" && cp -r "$APP/data/." "$BK/" && rm -rf "$APP/data"
fi

echo "== generate"
(cd "$NPDEV_ROOT" && pwsh -NoProfile -File NPDev_General/scripts/appgen/Build-NpdevApp.ps1 \
  -AppFolder "$HERE" -BuildRoot "$BUILD_ROOT") > "$KEYS_BAK/generate.log" 2>&1 \
  || { tail -30 "$KEYS_BAK/generate.log"; echo "geração falhou"; exit 1; }

if [ -d "$KEYS_BAK/wmsoffice-keys" ]; then
  cp -r "$KEYS_BAK/wmsoffice-keys" "$APP/"
else
  echo "== gerando chaves JWT novas"
  mkdir -p "$APP/wmsoffice-keys"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$APP/wmsoffice-keys/jwt-private-pkcs8.pem" 2>/dev/null
  openssl pkey -in "$APP/wmsoffice-keys/jwt-private-pkcs8.pem" -pubout -out "$APP/wmsoffice-keys/jwt-public.pem"
fi

echo "== build"
(cd "$APP" && sh _ops/build-final-app.sh) > "$KEYS_BAK/build.log" 2>&1 \
  || { tail -40 "$KEYS_BAK/build.log"; echo "build falhou"; exit 1; }

[ "$START" = 0 ] && { echo "OK (não iniciado)"; exit 0; }

echo "== start"
(cd "$APP" && sh _ops/start-app.sh)
i=0
until curl -sf http://localhost:8200/actuator/health >/dev/null; do
  i=$((i + 1)); [ $i -gt 90 ] && { echo "app não subiu em 180 s"; exit 1; }
  sleep 2
done
if [ "$RESET_DB" = 1 ]; then
  echo "== bootstrap-admin ($ADMIN_USER)"
  curl -sf -X POST http://localhost:8200/api/auth/bootstrap-admin -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"displayName\":\"Administrador\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null \
    || { echo "bootstrap-admin falhou"; exit 1; }
  echo "== cenários do jogo"
  python3 "$HERE/tools/semear_cenarios.py" --user "$ADMIN_USER" --password "$ADMIN_PASSWORD"
fi
if [ -f "$HERE/web/jogo/index.html" ]; then
  JOGO_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8200/jogo/index.html || true)
  [ "$JOGO_STATUS" = 200 ] || { echo "o jogo não está sendo servido: /jogo/index.html → HTTP $JOGO_STATUS"; exit 1; }
  echo "OK: http://localhost:8200 — jogo em http://localhost:8200/jogo/index.html"
else
  echo "OK: http://localhost:8200 (sem o jogo)"
fi
