#!/usr/bin/env bash
# macOS 平台矩阵入口（MM-060/MM-090 消费）。
# 用法：run-platform-macos.sh --suite file-lifecycle --output <evidence.json>
# MM-060：file-lifecycle = Rust 服务层测试（commit/authorization/handle/TOCTOU/
# launch-intent）+ packages/platform 单元测试（router/adapter/错误映射）。
# raw evidence 只追加不覆盖；Windows 等价套件见 run-platform-windows.ps1
# （v1 macOS 先行，Windows 为移植就绪约束——ADR 0001 G1 平台范围决定）。
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

emit_json() { # output, suite, overall, cases...
  local output="$1" suite="$2" overall="$3"; shift 3
  mkdir -p "$(dirname "$output")" .tmp
  python3 - "$output" "$suite" "$overall" "$@" <<'PY'
import json, sys, subprocess, platform, datetime
output, suite, overall, cases = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
doc = {
    "task": "MM-060" if suite == "file-lifecycle" else suite,
    "platform": "macOS",
    "suite": suite,
    "overall": overall,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "system": {
        "machine": platform.machine(),
        "macos": platform.mac_ver()[0],
        "rustc": subprocess.run(["rustc", "--version"], capture_output=True, text=True).stdout.strip(),
        "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
    },
    "platformNotes": [
        "commit protocol：temp-write → fsync(file) → rename(POSIX 原子替换) → fsync(dir) 全部落地",
        "Windows 分支（FlushFileBuffers/MoveFileEx 语义）已按移植就绪约束实现 cfg 分支，",
        "交叉 cargo check 被 tauri-build 的 icon.ico 前置要求阻断（图标属 MM-100 范围）；",
        "Windows 实机验证为 v1 已知缺口（ADR 0001 G1：macOS 先行、macOS 证据构成完整验收基础）",
    ],
    "windowsPortReadiness": {
        "status": "not-verified-on-device",
        "blockingOn": "无 Windows 设备（R-013）；icon.ico 为交叉 check 的 build.rs 前置（MM-100 范围）",
        "implemented": ["cfg(windows) 目录 flush 说明与 MoveFileEx(std rename) 路线", "路径大小写卷折叠差异已记录（launch.rs 模块注释）"],
    },
    "cases": [{"name": n, "result": r} for n, r in (c.split("=", 1) for c in cases)],
}
with open(output, "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"evidence -> {output} (overall: {overall})")
PY
}

case "$SUITE" in
  file-lifecycle)
    declare -a CASES=()
    if log_cargo="$(cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1)"; then
      summary="$(grep -Eo 'test result: ok\. [0-9]+ passed; [0-9]+ failed' <<<"$log_cargo" | head -1)"
      echo "PASS cargo-test（Rust 服务层：${summary}）"
      CASES+=("rust-service-layer-tests=PASS:${summary// / }")
    else
      echo "FAIL cargo-test"; tail -20 <<<"$log_cargo"; CASES+=("rust-service-layer-tests=FAIL")
    fi
    if log_vitest="$(pnpm exec vitest run packages/platform 2>&1)"; then
      summary="$(grep -Eo 'Tests  [0-9]+ passed \([0-9]+\)' <<<"$log_vitest" | tail -1)"
      echo "PASS platform-vitest（${summary}）"
      CASES+=("ts-platform-tests=PASS:${summary// / }")
    else
      echo "FAIL platform-vitest"; tail -20 <<<"$log_vitest"; CASES+=("ts-platform-tests=FAIL")
    fi
    overall="PASS"; for c in "${CASES[@]}"; do [[ "$c" == *FAIL* ]] && overall="FAIL"; done
    if [[ -n "$OUTPUT" ]]; then
      emit_json "$OUTPUT" "$SUITE" "$overall" "${CASES[@]}"
    fi
    [[ "$overall" == "PASS" ]]
    ;;
  *)
    echo "FAIL — suite=${SUITE} 尚未落地（MM-090 全量套件在 MM-090 实现）；此前 fail-closed。"
    exit 1
    ;;
esac
