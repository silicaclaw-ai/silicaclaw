#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: npm run logo -- /absolute/path/to/logo.png"
  exit 1
fi

SRC="$1"
if [ ! -f "$SRC" ]; then
  echo "Logo file not found: $SRC"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=(
  "$ROOT_DIR/apps/local-console/public/assets/silicaclaw-logo.png"
  "$ROOT_DIR/apps/public-explorer/public/assets/silicaclaw-logo.png"
  "$ROOT_DIR/docs/assets/silicaclaw-logo.png"
)
OG_TARGET="$ROOT_DIR/docs/assets/silicaclaw-og.png"

mkdir -p \
  "$ROOT_DIR/apps/local-console/public/assets" \
  "$ROOT_DIR/apps/public-explorer/public/assets" \
  "$ROOT_DIR/docs/assets"

for t in "${TARGETS[@]}"; do
  if [ "$SRC" -ef "$t" ] 2>/dev/null; then
    echo "Skipped (same file) -> $t"
    continue
  fi
  if [ -f "$t" ] && cmp -s "$SRC" "$t"; then
    echo "Skipped (identical content) -> $t"
    continue
  fi
  cp "$SRC" "$t"
  echo "Copied logo -> $t"
done

if command -v sips >/dev/null 2>&1; then
  if sips -z 630 1200 "$SRC" --out "$OG_TARGET" >/dev/null 2>&1; then
    echo "Generated OG image -> $OG_TARGET (1200x630)"
  else
    cp "$SRC" "$OG_TARGET"
    echo "OG resize failed, copied source -> $OG_TARGET"
  fi
else
  cp "$SRC" "$OG_TARGET"
  echo "sips not found, copied source as OG -> $OG_TARGET"
fi

echo "Done. Refresh local-console/public-explorer pages to see the new logo + favicon."
