// MM-090 macOS E2E 运行器：连接 tauri-driver（:4444）→ 驱动真实 debug
// bundle → 逐用例执行 → 截图与 evidence JSON 落盘。
// 由 scripts/quality/run-e2e-macos.sh 调用（该脚本负责 tauri-driver
// 进程生命周期与 bundle 构建）；本文件不装依赖、不碰全局状态。
// 用法：node tests/e2e/macos/run.mjs [--case all|E2E-02|…] [--bundle <path>]
//       [--driver-url http://127.0.0.1:4444] [--evidence <out.json>]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WebDriverClient } from "./webdriver-client.mjs";
import { cases } from "./cases.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const caseFilter = opt("case", "all");
const driverUrl = opt("driver-url", "http://127.0.0.1:4444");
const bundle =
  opt("bundle") ??
  path.resolve("apps/desktop/src-tauri/target/debug/bundle/macos/Mind Map.app");
const evidencePath = opt("evidence", "docs/quality/evidence/mm-090-macos-e2e.json");
const artifactsDir = opt("artifacts", ".tmp/e2e-macos");

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(path.dirname(evidencePath), { recursive: true });

function gitInfo() {
  const rev = (s) => execFileSync("git", ["rev-parse", s], { encoding: "utf8" }).trim();
  let commit = "unknown";
  let dirty = true;
  try {
    commit = rev("HEAD");
    dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  } catch {
    /* git 不可用时保留 unknown（fail-open 只影响记录，不影响断言） */
  }
  return { commit, dirty };
}

const selected = caseFilter === "all" ? cases : cases.filter((c) => c.id === caseFilter);
if (selected.length === 0) {
  console.error(`未知用例: ${caseFilter}（可用: ${cases.map((c) => c.id).join(", ")}）`);
  process.exit(2);
}

const d = new WebDriverClient(driverUrl);
const results = [];
let exitCode = 0;

try {
  console.log(`[e2e] session 建立（bundle: ${bundle}）…`);
  await d.newSession({
    "tauri:options": { binary: bundle },
  });

  // 等 app 就绪（WebView 加载 frontendDist → 画布 pane 出现）
  console.log("[e2e] 等待应用就绪…");
  await d.waitFor(".react-flow__pane", { timeoutMs: 20000 });
  console.log("[e2e] 应用就绪");

  for (const c of selected) {
    const started = Date.now();
    const shot = async (name) => {
      try {
        const b64 = await d.screenshot();
        const file = path.join(artifactsDir, `${name}.png`);
        writeFileSync(file, Buffer.from(b64, "base64"));
        return file;
      } catch (e) {
        return `screenshot-failed: ${e.message}`; // Safari 截图兼容性：不阻断断言
      }
    };
    d.channelLog.length = 0;
    try {
      await c.run(d, shot);
      results.push({
        id: c.id,
        name: c.name,
        result: "PASS",
        durationMs: Date.now() - started,
        channels: [...d.channelLog],
      });
      console.log(`[e2e] PASS ${c.id} ${c.name} (${Date.now() - started}ms)`);
    } catch (e) {
      exitCode = 1;
      await shot(`${c.id.toLowerCase()}-fail`).catch(() => {});
      results.push({
        id: c.id,
        name: c.name,
        result: "FAIL",
        durationMs: Date.now() - started,
        error: String(e.message ?? e),
        channels: [...d.channelLog],
      });
      console.error(`[e2e] FAIL ${c.id} ${c.name}: ${e.message}`);
    }
  }
} catch (e) {
  exitCode = 1;
  results.push({
    id: "harness",
    name: "session/就绪",
    result: "FAIL",
    error: String(e.message ?? e),
    hint: "若为 safaridriver 未启用：需用户执行 `sudo safaridriver --enable`（一次性，管理员密码）",
  });
  console.error(`[e2e] HARNESS FAIL: ${e.message}`);
} finally {
  await d.deleteSession().catch(() => {});
}

const doc = {
  task: "MM-090",
  platform: "macOS",
  suite: "e2e-macos",
  overall: exitCode === 0 ? "PASS" : "FAIL",
  generatedAt: new Date().toISOString(),
  driver: { url: driverUrl, kind: "tauri-driver (W3C WebDriver)" },
  app: { bundle, ...gitInfo(), buildType: "debug-bundle" },
  interactionFidelity: {
    text: "W3C element/value（真实 onChange 链）",
    keys: "合成 KeyboardEvent（actions API 优先，safaridriver 限制回落 execute/sync）；不产生浏览器默认行为，默认行为断言由 jsdom 单测覆盖",
    pointer: "合成 PointerEvent/MouseEvent 序列（双击/拖动）",
    boundaries: "系统级（Dock activation、保存/导出系统对话框、真实 IME、文件关联）进人工矩阵，不以 mock 冒充",
  },
  cases: results,
};
writeFileSync(evidencePath, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`[e2e] evidence -> ${evidencePath} (overall: ${doc.overall})`);
process.exit(exitCode);
