#!/usr/bin/env bash
# MM-010 macOS leg — run all four tracks and assemble evidence.
# Usage: scripts/runtime-spike/run-macos.sh [--release] [--all]
# Outputs land in .tmp/runtime-spike/** ; reports are then written by MM-010
# into docs/quality/** (decision JSON + sidecar are frozen manually).

set -euo pipefail
cd "$(dirname "$0")"

echo "=== [0/5] toolchain check ==="
node --version
command -v cargo >/dev/null 2>&1 && cargo --version || echo "cargo not found (tauri leg will be skipped)"

echo "=== [1/5] fixtures ==="
node fixtures/generate-fixtures.mjs

echo "=== [2/5] font track ==="
node fonts/evaluate-fonts.mjs

echo "=== [3/5] export track ==="
node export/measure-export.mjs

echo "=== [4/5] canvas track ==="
node canvas/measure-canvas.mjs

echo "=== [5/5] host track ==="
node hosts/electron-spike/measure.mjs
if command -v cargo >/dev/null 2>&1; then
  (cd hosts/tauri-spike/src-tauri && cargo build --release)
  node hosts/tauri-spike/measure.mjs
else
  echo "SKIP: tauri leg (cargo missing)"
fi

echo "=== macOS leg complete. Assemble decision JSON next (MM-010 aggregate step). ==="
