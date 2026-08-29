// MM-090 macOS E2E 运行器（osascript/System Events 路线）。
// 由 run-e2e-macos.sh 调用：负责 app 生命周期（open/kill）、就绪探测、
// 逐用例执行、截图（screencapture 画布区域）与 evidence JSON 落盘。
// 前置由 shell fail-closed 检查：bundle 存在、WebKitAccessibilityEnabled
// 已启用、宿主具备辅助功能权限。
// 用法：node tests/e2e/macos/run.mjs [--case all|E2E-02|…] [--bundle <path>]
//       [--evidence <out.json>] [--artifacts <dir>]

import { execFileSync, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import * as b from "./ax-bridge.mjs";
import { cases } from "./cases.mjs";

const execFileP = promisify(execFile);

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const caseFilter = opt("case", "all");
const bundle =
  opt("bundle") ?? path.resolve("apps/desktop/src-tauri/target/debug/bundle/macos/Mind Map.app");
const evidencePath = opt("evidence", "docs/quality/evidence/mm-090-macos-e2e.json");
const artifactsDir = opt("artifacts", ".tmp/e2e-macos");

const selected = caseFilter === "all" ? cases : cases.filter((c) => c.id === caseFilter);
if (selected.length === 0) {
  console.error(`未知用例: ${caseFilter}（可用: ${cases.map((c) => c.id).join(", ")}）`);
  process.exit(2);
}

function gitInfo() {
  let commit = "unknown";
  let dirty = true;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  } catch {
    /* git 不可用时保留 unknown */
  }
  return { commit, dirty };
}

// ---- fail-closed 前置 ----
if (!existsSync(bundle)) {
  console.error(`FAIL - bundle 不存在: ${bundle}`);
  process.exit(1);
}
const axPref = (() => {
  try {
    return execFileSync("defaults", ["read", "com.mindmap.desktop", "WebKitAccessibilityEnabled"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
})();
if (axPref !== "1") {
  console.error("FAIL - WebKitAccessibilityEnabled 未启用（defaults write com.mindmap.desktop WebKitAccessibilityEnabled -bool YES 后重启 app）");
  process.exit(1);
}

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(path.dirname(evidencePath), { recursive: true });

// ---- app 生命周期 ----
const quitApp = async () => {
  try {
    execFileSync("pkill", ["-x", "mindmap-desktop"]);
  } catch {
    /* 已退出 */
  }
  // 等待进程真正消失（SIGTERM 处理 + AX/LaunchServices 注销需要时间；
  // 过早 open 会让新实例把 activation 转给垂死旧实例后自行退出——
  // single-instance 插件语义，实测即"就绪后 app 消失"的根因）。
  for (let i = 0; i < 20; i++) {
    try {
      execFileSync("pgrep", ["-x", "mindmap-desktop"], { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      break; // pgrep 无匹配 → 已退出
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
};
// ---- 用例执行（每 case 重启 app：状态隔离——编辑态/引导态等 session 残留
// 会干扰后续用例，如 quick-create 在编辑态被设计性忽略） ----
const results = [];
let exitCode = 0;

const startAppFresh = async () => {
  await quitApp();
  execFileSync("open", [bundle]);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await b.axFind(`d === "脑图画布"`)) {
      // AX 会话"冷却即死"（实测静默 >2s 后首查必败 -1708）：就绪后用
      // 轻量查询保活代替静默等待（3 次 × 800ms）。
      for (let k = 0; k < 3; k++) {
        await new Promise((r) => setTimeout(r, 800));
        await b.axFind(`d === "脑图画布"`).catch(() => {});
      }
      return true;
    }
  }
  return false;
};

for (const c of selected) {
  const started = Date.now();
  if (!(await startAppFresh())) {
    exitCode = 1;
    results.push({ id: c.id, name: c.name, result: "FAIL", error: "case 前置：画布就绪超时" });
    console.error(`[e2e] FAIL ${c.id}: case 前置画布就绪超时`);
    continue;
  }
  const shot = async (name) => {
    try {
      await b.captureWindow(path.join(artifactsDir, `${name}.png`));
      return path.join(artifactsDir, `${name}.png`);
    } catch (e) {
      return `screenshot-failed: ${e.message}`;
    }
  };
  try {
    await c.run(b, shot);
    results.push({ id: c.id, name: c.name, result: "PASS", durationMs: Date.now() - started });
    console.log(`[e2e] PASS ${c.id} ${c.name} (${Date.now() - started}ms)`);
  } catch (e) {
    exitCode = 1;
    await shot(`${c.id.toLowerCase()}-fail`).catch(() => {});
    // 失败现场复查：等待 3s 后再查询（区分"app 永久挂"与"忙窗内 -1708"）
    await new Promise((r) => setTimeout(r, 3000));
    const recheck = await b
      .axFind(`d === "脑图画布"`)
      .then(() => "RECOVERED")
      .catch((e2) => `STILL-FAIL ${String(e2.message).match(/\(-\d+\)/)?.[0] ?? ""}`);
    const nodesAfterFail = await b
      .axFindAll(`d.startsWith("节点：")`)
      .then((h) => h.length)
      .catch(() => -1);
    results.push({
      id: c.id,
      name: c.name,
      result: "FAIL",
      durationMs: Date.now() - started,
      error: String(e.message ?? e),
      recheckAfter3s: recheck,
      nodesAfterFail,
    });
    console.error(`[e2e] FAIL ${c.id} ${c.name}: ${String(e.message).slice(0, 200)}`);
    console.error(`[e2e] 复查: ${recheck}, 节点数=${nodesAfterFail}`);
  }
}
await quitApp();

const doc = {
  task: "MM-090",
  platform: "macOS",
  suite: "e2e-macos",
  overall: exitCode === 0 ? "PASS" : "FAIL",
  generatedAt: new Date().toISOString(),
  driver: {
    kind: "osascript + System Events（macOS 自带；tauri-driver v2.0.6 不支持 macOS，见 mm-090-report.md）",
    system: (() => {
      try {
        return execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
      } catch {
        return "unknown";
      }
    })(),
  },
  app: { bundle, buildType: "debug-bundle", ...gitInfo() },
  interactionFidelity: {
    keyboard: "System Events keystroke/key code（真实系统输入链）",
    chinese: "剪贴板 + ⌘V（真实粘贴事件→onChange）",
    pointer: "clickAt AX 坐标（真实鼠标双击）",
    assertions: "AX 树语义断言（aria-label→AXDescription；WebKitAccessibilityEnabled）",
    limitations: "SVG edge 无 AX 暴露→undo 历史序列间接断言；工具条文本按钮无名→真实快捷键驱动；系统对话框/Dock/真机 IME→人工矩阵",
  },
  cases: results,
};
writeFileSync(evidencePath, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`[e2e] evidence -> ${evidencePath} (overall: ${doc.overall})`);
process.exit(exitCode);
