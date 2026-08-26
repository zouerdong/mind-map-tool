#!/usr/bin/env bash
# macOS E2E 入口（MM-090 消费）。发布或接近发布构建；E2E-01～E2E-14。
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "FAIL — E2E 套件在 MM-080/MM-090 落地；此前 fail-closed，不得以 mock 冒充。"
exit 1
