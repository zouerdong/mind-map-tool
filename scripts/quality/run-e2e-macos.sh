#!/usr/bin/env bash
# macOS E2E entry (MM-090): osascript + System Events driving the real
# debug bundle (tauri-driver v2.0.6 does not support macOS -- official
# support is Linux/Windows only; verified on this machine, see
# mm-090-report.md). Real keyboard/mouse events + AX-tree assertions.
# Covers E2E-02/03/04/05/08/09 (canvas interaction subset).
# System-level cases (launch-router/file-open/file-safety) are routed to
# the real platform suite; native dialogs, Dock activation, real IME and
# file association belong to the manual matrix -- never faked with mocks.
# Fail-closed: missing bundle / AX preference / accessibility permission
# fails with explicit guidance.
# Usage: run-e2e-macos.sh [--case all|E2E-02|...|launch-router|file-open|file-safety]
#                         [--skip-build] [--release]
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

# ---- route system-level cases to the real platform suite (no mocks) ----
case "$CASE" in
  launch-router|file-open|file-safety)
    echo "[e2e] $CASE is a system-level flow -> routing to platform suite + manual matrix"
    exec scripts/quality/run-platform-macos.sh --suite file-lifecycle \
      --output "docs/quality/evidence/mm-090-macos-${CASE}.json"
    ;;
esac

# ---- fail-closed preconditions ----
BUNDLE="apps/desktop/src-tauri/target/${BUILD_PROFILE}/bundle/macos/Mind Map.app"
if [[ "$SKIP_BUILD" -eq 0 || ! -d "$BUNDLE" ]]; then
  echo "[e2e] building ${BUILD_PROFILE} bundle (tauri build --${BUILD_PROFILE})..."
  pnpm --filter @mindmap/desktop exec tauri build --${BUILD_PROFILE}
fi
if [[ ! -d "$BUNDLE" ]]; then
  echo "FAIL - bundle not found: $BUNDLE"
  exit 1
fi

if [[ "$(defaults read com.mindmap.desktop WebKitAccessibilityEnabled 2>/dev/null || echo 0)" != "1" ]]; then
  cat <<'MSG'
FAIL - WebKitAccessibilityEnabled not enabled for the app (WKWebView AX tree
exposure). One-time setup:
  defaults write com.mindmap.desktop WebKitAccessibilityEnabled -bool YES
App-domain preference only (reversible: defaults delete com.mindmap.desktop
WebKitAccessibilityEnabled); does not touch system-wide settings.
MSG
  exit 1
fi

echo "[e2e] running case: $CASE (osascript route)"
node tests/e2e/macos/run.mjs \
  --case "$CASE" \
  --bundle "$BUNDLE" \
  --evidence "docs/quality/evidence/mm-090-macos-e2e.json"
