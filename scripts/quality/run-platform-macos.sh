#!/usr/bin/env bash
# macOS 平台矩阵入口（MM-060/MM-090 消费）。
# 用法：run-platform-macos.sh --suite file-lifecycle --output <evidence.json>
set -euo pipefail
cd "$(dirname "$0")/../.."

SUITE="all"; OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --suite) SUITE="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    *) echo "unknown arg $1"; exit 2 ;;
  esac
done

echo "macOS platform suite=${SUITE} output=${OUTPUT:-<none>}"
echo "FAIL — 平台套件在 MM-060（file-lifecycle）与 MM-090（全量）落地；此前 fail-closed。"
exit 1
