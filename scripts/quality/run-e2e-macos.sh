#!/usr/bin/env bash
# macOS E2E 入口（MM-090）：tauri-driver + 真实 debug bundle 驱动
# E2E-02/03/04/05/08/09（画布交互自动化子集）；系统级 case
# （launch-router/file-open/file-safety）路由到 platform 套件（真实
# Rust/platform 测试）；Dock activation、系统对话框、真实 IME、文件
# 关联进人工矩阵（docs/quality/mm-090-manual-matrix.md）——不以 mock 冒充。
# fail-closed：缺 tauri-driver / bundle / safaridriver 启用时明确失败并
# 给出指引，不静默降级。
# 用法：run-e2e-macos.sh [--case all|E2E-02|…|launch-router|file-open|file-safety]
#                       [--skip-build] [--release]
set -euo pipefail
cd "$(dirname "$0")/../.."

CASE="all"; SKIP_BUILD=0; BUILD_PROFILE="debug"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --case) CASE="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --release) BUILD_PROFILE="release"; shift ;;
    *) echo "unknown arg $1"; exit 2 ;;
  esac
done

# ---- 系统级 case 路由（真实 platform 套件，非 mock） ----
case "$CASE" in
  launch-router|file-open|file-safety)
    echo "[e2e] $CASE 属系统级链路（launch/文件安全），路由 platform 套件（真实测试）+ 人工矩阵"
    exec scripts/quality/run-platform-macos.sh --suite file-lifecycle \
      --output "docs/quality/evidence/mm-090-macos-${CASE}.json"
    ;;
esac

# ---- fail-closed 前置检查 ----
if ! command -v tauri-driver >/dev/null 2>&1; then
  cat <<'MSG'
FAIL — tauri-driver 未安装。安装（用户授权动作，全局 cargo 二进制）：
  cargo install --locked tauri-driver
详见 Tauri 官方 E2E 文档；本项目不擅自安装全局依赖。
MSG
  exit 1
fi

BUNDLE="apps/desktop/src-tauri/target/${BUILD_PROFILE}/bundle/macos/Mind Map.app"
if [[ "$SKIP_BUILD" -eq 0 || ! -d "$BUNDLE" ]]; then
  echo "[e2e] 构建 ${BUILD_PROFILE} bundle（tauri build --${BUILD_PROFILE}）…"
  pnpm --filter @mindmap/desktop tauri build -- --${BUILD_PROFILE}
fi
if [[ ! -d "$BUNDLE" ]]; then
  echo "FAIL — bundle 不存在：$BUNDLE"
  exit 1
fi

# ---- tauri-driver 生命周期 ----
DRIVER_LOG=".tmp/tauri-driver.log"
mkdir -p .tmp
tauri-driver >"$DRIVER_LOG" 2>&1 &
DRIVER_PID=$!
trap 'kill "$DRIVER_PID" 2>/dev/null || true' EXIT

# 等 driver 就绪（4444 端口应答）
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:4444/status"; then break; fi
  sleep 0.2
done
if ! curl -s -o /dev/null "http://127.0.0.1:4444/status"; then
  echo "FAIL — tauri-driver 未就绪（日志：$DRIVER_LOG）"
  exit 1
fi

echo "[e2e] tauri-driver 就绪（pid $DRIVER_PID）；运行 case: $CASE"
node tests/e2e/macos/run.mjs \
  --case "$CASE" \
  --bundle "$BUNDLE" \
  --evidence "docs/quality/evidence/mm-090-macos-e2e.json"
