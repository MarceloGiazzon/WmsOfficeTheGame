#!/usr/bin/env sh
# Valida, regenera, compila e sobe o backend do jogo (WmsOfficeTheGame, porta 8200) no Linux.
# Preserva as chaves JWT (a geração recria App/ e apaga wmsoffice-keys/). O banco em App/data/ sobrevive.
#
# Uso: backend/npdev/rebuild.sh            # tudo
#      backend/npdev/rebuild.sh --no-start  # não sobe o app no final
# Variáveis: NPDEV_ROOT (default ~/repos/NPDev)
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
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

if [ -d "$APP" ]; then
  echo "== stop"
  (cd "$APP" && sh _ops/stop-app.sh) || true
  [ -d "$APP/wmsoffice-keys" ] && cp -r "$APP/wmsoffice-keys" "$KEYS_BAK/"
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

[ "${1:-}" = "--no-start" ] && { echo "OK (não iniciado)"; exit 0; }

echo "== start"
(cd "$APP" && sh _ops/start-app.sh)
i=0
until curl -sf http://localhost:8200/actuator/health >/dev/null; do
  i=$((i + 1)); [ $i -gt 90 ] && { echo "app não subiu em 180 s"; exit 1; }
  sleep 2
done
echo "OK: http://localhost:8200"
