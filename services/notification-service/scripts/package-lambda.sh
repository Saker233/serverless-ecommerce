#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="$ROOT_DIR/.lambda-package"
ZIP_PATH="$ROOT_DIR/notification-service.zip"

cd "$ROOT_DIR"

npm run build

rm -rf "$STAGE_DIR" "$ZIP_PATH"
mkdir -p "$STAGE_DIR"

cp package.json package-lock.json "$STAGE_DIR/"
npm --prefix "$STAGE_DIR" ci --omit=dev

cp -R dist "$STAGE_DIR/dist"

(
  cd "$STAGE_DIR"
  zip -qr "$ZIP_PATH" .
)

echo "Created $ZIP_PATH"
ls -lh "$ZIP_PATH"
unzip -l "$ZIP_PATH" | head -20 || true
