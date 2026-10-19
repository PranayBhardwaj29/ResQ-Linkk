#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT/web-source"
ASSET_DIR="$ROOT/app/src/main/assets/web"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required to build the ResQLink website bundle." >&2
  exit 1
fi

cd "$WEB_DIR"
if [[ ! -x "$WEB_DIR/node_modules/.bin/vite" ]]; then
  npm ci --no-audit --no-fund
fi
npm run build

rm -rf "$ASSET_DIR"
mkdir -p "$ASSET_DIR"
cp -a "$WEB_DIR/dist/." "$ASSET_DIR/"

test -f "$ASSET_DIR/index.html"
echo "Web UI bundled into: $ASSET_DIR"
echo "Now open this folder in Android Studio and build the app."
