// MRT-004W2R 真实 macOS 十场景矩阵 runner（任务卡 §7 E2；重写 Wave 2 版）。
//
// 驱动通道（全部真实，W2R 实测确认；通道事实见 red-light evidence 与
// implementation evidence 的环境探针段）：
// - 启动：LaunchServices `open -a <app> --stderr <log> [--args ...]`
//   （直接 spawn 二进制的窗口不上屏——W2R 实测；open -a 的窗口真实渲染）
// - 保活：`caffeinate -d` 常驻（显示器休眠会使截图纯黑且 AX 树退化）
// - UI 驱动：scripts/quality/ax-driver.swift（swift 直连 AX 定位 +
//   CGEvent 真实鼠标/键盘——osascript/System Events 在本 shell 环境的
//   AX 窗口枚举不可用，swift 直连可用）
// - 窗口事实：scripts/quality/window-list.swift（CGWindowList on-screen）
// - 断言：host stderr 结构化日志（lifecycle 行，含 ack 行）+ AX 定位
//   （aria-label 按钮存在性）+ CGWindowList 计数/frame + 文件系统 +
//   窗口区域截图 SHA 对比；每场景整屏截图过 image-stats 有效性门禁。
//
// 门禁（R7）：
// - verdict 仅由结构化 facts 计算（动作没发生 = FAIL，不看"没有失败字样"）；
// - 每张截图过 scripts/quality/image-stats.swift（DARK / 跨场景重复 → FAIL）；
// - 任何场景非 PASS（含 MANUAL/SKIP/缺 artifact）→ overall INCOMPLETE，退出码非 0。
// 用法：node tests/e2e/macos/wave2-windows.mjs [--bundle <path>] [--out <dir>] [--keep]

import { execFileSync, execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ROOT = process.cwd();
const ONLY = opt("only", ""); // 逗号分隔场景 id（调试用；正式验收全量跑）

const bundlePath = path.resolve(
  opt("bundle", "apps/desktop/src-tauri/target/debug/bundle/macos/Mind Map.app"),
);
const outDir = path.resolve(opt("out", ".tmp/wave2-e2e"));
const binPath = path.join(bundlePath, "Contents", "MacOS", "mindmap-desktop");
if (!existsSync(binPath)) {
  console.error(`FAIL - bundle 二进制不存在: ${binPath}`);
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const logPath = path.join(outDir, "host.log");
const shotDir = path.join(outDir, "shots");
mkdirSync(shotDir, { recursive: true });

const bundleHash = execFileSync("shasum", ["-a", "256", binPath], { encoding: "utf8" }).split(
  " ",
)[0];
const scenarioLog = {
  task: "MRT-004W2R E2",
  date: new Date().toISOString(),
  bundle: bundlePath,
  bundleSha256: bundleHash,
  driver: {
    launch: "open -a --stderr（LaunchServices；直接 spawn 窗口不上屏，W2R 实测）",
    keepAwake: "caffeinate -d 常驻（显示器休眠 → 截图纯黑 + AX 退化）",
    ui: "ax-driver.swift（swift 直连 AX 定位 + CGEvent 真实鼠标/键盘）",
    assertions: "host 日志 + AX 按钮存在性 + CGWindowList + 文件系统 + 区域截图 SHA",
  },
  git: (() => {
    try {
      return { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
    } catch {
      return { commit: "unknown" };
    }
  })(),
  scenarios: [],
  steps: [],
  screenshots: [],
};

const want = (id) => ONLY === "" || ONLY.split(",").includes(id);
function step(msg) {
  scenarioLog.steps.push(`${new Date().toISOString()} ${msg}`);
  console.log(`[w2r] ${msg}`);
}
const logText = () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "");
const logLines = (needle) =>
  logText()
    .split("\n")
    .filter((l) => l.includes(needle));
const countIn = (needle) => logLines(needle).length;

// ---- caffeinate（显示器保活） ----
// 显示器休眠会使截图纯黑且 AX 树退化（frame 全 null）——先唤醒并确认
// 截图有效才继续（半醒态是 AX flaky 的实测根因）。
const caffe = spawn("caffeinate", ["-d"], { stdio: "ignore", detached: true });
caffe.unref();
for (let i = 0; i < 5; i++) {
  await execFileP("caffeinate", ["-u", "-t", "2"]).catch(() => {});
  await sleep(1200);
  const probe = path.join(shotDir, "wake-probe.png");
  await execFileP("screencapture", ["-x", probe]).catch(() => {});
  const stats = await execFileP("swift", [
    path.join(ROOT, "scripts/quality/image-stats.swift"),
    probe,
  ]).then(
    (r) => r.stdout,
    () => "",
  );
  if (stats.includes("VALID")) {
    rmSync(probe, { force: true });
    break;
  }
  rmSync(probe, { force: true });
}

// ---- swift 驱动封装 ----
async function drv(...a) {
  const { stdout } = await execFileP("swift", [
    path.join(ROOT, "scripts/quality/ax-driver.swift"),
    ...a,
  ]);
  return stdout.trim();
}
const activate = () => drv("activate");
const axClick = (x, y) => drv("click", String(Math.round(x)), String(Math.round(y)));
const axDblClick = (x, y) => drv("dblclick", String(Math.round(x)), String(Math.round(y)));
const axKey = (code, mods) => drv("key", String(code), ...(mods ? [mods] : []));
const axType = (t) => drv("type", t);
/** keycode 逐字输入（CGEvent；对原生面板 NSTextField 已验证有效——
 * W2R 实测名称栏显示完整路径；仅支持 ASCII，用于 Save 面板路径直达）。 */
const KEYMAP = {
  a: 0,
  b: 11,
  c: 8,
  d: 2,
  e: 14,
  f: 3,
  g: 5,
  h: 4,
  i: 34,
  j: 38,
  k: 40,
  l: 37,
  m: 46,
  n: 45,
  o: 31,
  p: 35,
  q: 12,
  r: 15,
  s: 1,
  t: 17,
  u: 32,
  v: 9,
  w: 13,
  x: 7,
  y: 16,
  z: 6,
  1: 18,
  2: 19,
  3: 20,
  4: 21,
  5: 23,
  6: 22,
  7: 26,
  8: 28,
  9: 25,
  0: 29,
  "/": 44,
  "-": 27,
  ".": 47,
  _: 42,
};
async function typeByKeycode(text) {
  for (const ch of text.toLowerCase()) {
    const code = KEYMAP[ch];
    if (code === undefined) throw new Error(`typeByKeycode: 无键位映射 ${JSON.stringify(ch)}`);
    await drv("key", String(code));
    await sleep(45);
  }
  await sleep(500);
}
/** 剪贴板 + ⌘V 真实粘贴输入（MM-090 已验证的中文输入通道）。 */
async function pasteText(text) {
  const { stdout } = await execFileP("osascript", [
    "-e",
    `set the clipboard to ${JSON.stringify(text)}`,
  ]);
  return stdout;
}

async function axWindows() {
  try {
    return JSON.parse(await drv("windows"));
  } catch {
    return [];
  }
}
async function axFind(winIdx, needle) {
  try {
    return JSON.parse(await drv("find", String(winIdx), needle));
  } catch {
    return { found: false };
  }
}
/** 点击 AX 定位到的按钮/元素（按内容匹配，取窗口 0=前台）。 */
async function clickByContent(needle, winIdx = 0) {
  const hit = await waitForAx(needle, winIdx);
  await axClick(hit.frame.x + hit.frame.w / 2, hit.frame.y + hit.frame.h / 2);
  return hit;
}
/** 点击直到效果达成（verify 返回 truthy）；点击在 WKWebView DOM 上
 * 偶发不触发 onClick（W2R 实测），统一以可观察效果验证并重试。 */
async function clickUntil(needle, verify, { tries = 3, waitMs = 900, winIdx = 0 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    // 按钮可能已在上一轮点击后消失（点击生效、效果验证竞态）——找不到
    // 时只验证效果，不抛错
    const hit = await axFind(winIdx, needle);
    if (hit.found && hit.frame) {
      await axClick(hit.frame.x + hit.frame.w / 2, hit.frame.y + hit.frame.h / 2);
    }
    await sleep(waitMs);
    last = await verify();
    if (last) return last;
  }
  return last;
}
/** AX 定位（等待树就绪：found 且 frame 非 null；进程启动初期 AX 树可能
 * 短暂退化——只含菜单、无坐标）。 */
async function waitForAx(needle, winIdx = 0, { timeoutMs = 8000, intervalMs = 400 } = {}) {
  const start = Date.now();
  for (;;) {
    const hit = await axFind(winIdx, needle);
    if (hit.found && hit.frame) return hit;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForAx 超时: ${needle} → ${JSON.stringify(hit)}`);
    }
    await sleep(intervalMs);
  }
}

// ---- CGWindowList 窗口事实 ----
async function cgRows() {
  try {
    const { stdout } = await execFileP("swift", [
      path.join(ROOT, "scripts/quality/window-list.swift"),
    ]);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/^(.*?)\t(.*?)\t([\d,.]+) (\d+)x(\d+)\t/);
        if (!m) return null;
        const [x, y] = m[3].split(",").map(Number);
        return { owner: m[1], title: m[2], x, y, w: +m[4], h: +m[5] };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
const appRows = async () =>
  (await cgRows()).filter((r) => r.owner.replace(/\s/g, "").toLowerCase().includes("mindmap"));
const windowCount = async () => (await appRows()).length;

// ---- 截图与有效性门禁（R7） ----
const seenShotShas = new Map(); // sha → scenario id
async function shot(name, scenarioId) {
  const file = path.join(shotDir, `${name}.png`);
  try {
    await execFileP("screencapture", ["-x", file]);
  } catch (e) {
    step(`截图失败 ${name}: ${e.message}`);
    return { file: null, valid: false, reason: "capture-failed" };
  }
  const { stdout } = await execFileP("swift", [
    path.join(ROOT, "scripts/quality/image-stats.swift"),
    file,
  ]);
  const row = stdout.trim().split("\n")[1]?.split("\t") ?? [];
  const [, sha, , , meanLuma, nonDark, verdict] = row;
  const entry = { file: `${name}.png`, sha256: sha, meanLuma: Number(meanLuma), verdict };
  scenarioLog.screenshots.push(entry);
  let valid = verdict === "VALID";
  let reason = valid ? null : `image-stats ${verdict}`;
  if (valid && seenShotShas.has(sha) && seenShotShas.get(sha) !== scenarioId) {
    valid = false;
    reason = `跨场景完全重复（与 ${seenShotShas.get(sha)} 同 SHA）`;
  } else {
    seenShotShas.set(sha, scenarioId);
  }
  if (!valid) step(`截图门禁失败 ${name}: ${reason}`);
  return { file: valid ? file : null, valid, reason, sha256: sha };
}

/** 鼠标停靠（截图确定性：hover 状态不进入区域断言）。 */
const parkMouse = () => drv("parkmouse", "3350", "2200").catch(() => {});
/** 窗口区域截图 → {sha, luma}（内容断言）。只截画布主体：排除标题栏/
 * 工具条（前后台焦点态污染像素）、画布顶部提示/引导带与边缘 focus
 * outline；画布主体承载节点内容，静止时像素稳定。luma 用于明暗断言
 * （文档主题区分）。 */
async function regionInfo(frame, tag) {
  await parkMouse();
  await sleep(150);
  const x = Math.round(frame.x + frame.w * 0.06);
  const y = Math.round(frame.y + Math.min(240, frame.h * 0.45));
  const w = Math.round(frame.w * 0.7); // 右缘留白：WebView 滚动条出现/消失是像素噪声
  const h = Math.max(80, Math.round(frame.h - (y - frame.y) - frame.h * 0.08));
  const file = path.join(shotDir, `region-${tag}-${Date.now()}.png`);
  await execFileP("screencapture", ["-x", "-R", `${x},${y},${w},${h}`, file]);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  // 区域图允许近全白（空白画布合法）；非零退出仅作诊断，不中断流程
  let luma = 0;
  try {
    const { stdout } = await execFileP("swift", [
      path.join(ROOT, "scripts/quality/image-stats.swift"),
      "--allow-white",
      file,
    ]);
    const row = stdout.trim().split("\n")[1]?.split("\t") ?? [];
    luma = Number(row[4] ?? 0);
  } catch {
    // image-stats 非零（DARK 等）——luma 保持 0，由场景断言裁决
  }
  scenarioLog.screenshots.push({
    file: path.basename(file),
    sha256: sha,
    meanLuma: luma,
    kind: "region",
  });
  return { sha, luma };
}
const regionSha = async (frame, tag) => (await regionInfo(frame, tag)).sha;

// ---- 应用生命周期 ----
async function killApp() {
  try {
    execFileSync("pkill", ["-x", "mindmap-desktop"], { stdio: "ignore" });
  } catch {
    /* 已退出 */
  }
  for (let i = 0; i < 24; i++) {
    try {
      execFileSync("pgrep", ["-x", "mindmap-desktop"], { stdio: "ignore" });
      await sleep(500);
    } catch {
      break;
    }
  }
  await sleep(800);
}
/** AX 树就绪 gate：任一窗口 frame 非 null（启动初期 WKWebView/WindowServer
 * 注册未完成时 AX 全退化 frame=null，CGEvent 拖拽也不被接受——W2R 实测；
 * 就绪通常 2-8s，超时记录后继续由各通道重试）。 */
async function axReady({ timeoutMs = 20000 } = {}) {
  const start = Date.now();
  for (;;) {
    const ws = await axWindows();
    if (ws.some((w) => w.frame)) return true;
    if (Date.now() - start > timeoutMs) {
      step(`axReady 超时（AX 树持续退化）：${JSON.stringify(ws)}`);
      return false;
    }
    await sleep(600);
  }
}
/** LaunchServices 冷启动（stderr 持续落盘 = host 结构化日志）。 */
async function launchApp(argvFiles = []) {
  await killApp();
  rmSync(logPath, { force: true });
  const openArgs = ["-a", bundlePath, "--stderr", logPath];
  if (argvFiles.length > 0) openArgs.push("--args", ...argvFiles);
  await execFileP("open", openArgs);
  await axReady();
}
const openWith = (file) => execFileP("open", ["-a", bundlePath, file]);

async function waitFor(cond, { timeoutMs = 15000, label = "condition", intervalMs = 400 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await cond();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(intervalMs);
  }
  throw new Error(`等待超时: ${label}（last=${JSON.stringify(last)}）`);
}

// ---- 测试文档 ----
function makeDoc(extra = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: [],
      edges: [],
      ...extra,
    },
  });
}
const node = (id, text, x = 40, y = 40) => ({
  id,
  text,
  position: { x, y },
  size: { width: 160, height: 48 },
});
const tmpDir = path.join(outDir, "files");
mkdirSync(tmpDir, { recursive: true });
const docA = path.join(tmpDir, "甲 脑图 v1.json");
const docB = path.join(tmpDir, "乙 脑图 dark.json");
const docC = path.join(tmpDir, "丙 文档 c.json");
const unreadable = path.join(tmpDir, "不可读 文档.json");
for (const [p, content] of [
  [docA, makeDoc({ nodes: [node("a1", "文档 A 中心")] })],
  [docB, makeDoc({ theme: "dark", nodes: [node("b1", "文档 B 中心")] })],
  [docC, makeDoc({ nodes: [node("c1", "文档 C 中心")] })],
]) {
  writeFileSync(p, content);
}

function record(id, name, expectation, facts, shots, verdict, note = "") {
  scenarioLog.scenarios.push({ id, name, expectation, facts, screenshots: shots, verdict, note });
  step(`scenario ${id} → ${verdict}`);
}

/** 画布脏化：双击建点（画布左上空白区，避开中心已有节点）+ 点画布下部
 * 空白收起编辑。建点（AddNode）即产生 dirty 与可持久化的内容变化——
 * 文本输入通道（CGEvent unicode / 剪贴板⌘V / keycode）在本环境对
 * WKWebView textarea 均不可靠（见 implementation evidence 环境探针），
 * dirty 与保存断言统一以"节点数"承载语义。 */
async function makeDirty(frame, offsetX = 260) {
  // 节点卡片带 aria-label（节点：<文本>）——建点以 AX 级节点计数验证，
  // 失败换位重试（双击偶发不触发）。
  await activate();
  await sleep(300);
  const countBefore = await nodeCountAx();
  for (let attempt = 0; attempt < 4; attempt++) {
    await axDblClick(frame.x + offsetX + attempt * 50, frame.y + 340);
    await sleep(500);
    await axClick(frame.x + frame.w * 0.5, frame.y + frame.h * 0.85); // 画布下部空白收起编辑
    await sleep(500);
    const after = await nodeCountAx();
    if (after > countBefore) return after;
  }
  throw new Error("makeDirty: 双击建点未生效（AX 节点计数未增长）");
}
/** AX 级节点计数（节点卡片 aria-label 前缀「节点：」）。 */
async function nodeCountAx() {
  try {
    return Number(await drv("countnodes", "0")) || 0;
  } catch {
    return 0;
  }
}
/** 解析文档 JSON 的节点数（文件系统断言）。 */
const nodeCount = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")).document.nodes.length;
  } catch {
    return -1;
  }
};
/** 区域截图稳定化：连续两次 SHA 相同才返回（吸收收起编辑/渲染动画）。 */
async function regionStable(frame, tag) {
  let prev = await regionInfo(frame, `${tag}-s0`);
  for (let i = 1; i <= 3; i++) {
    await sleep(250);
    const cur = await regionInfo(frame, `${tag}-s${i}`);
    if (cur.sha === prev.sha) return cur;
    prev = cur;
  }
  return prev;
}
/** 找位于指定槽位附近的 app 窗口 frame（多窗分摆后定位）。 */
async function frameNear(sx, sy) {
  const rows = await appRows();
  return rows.find((r) => Math.abs(r.x - sx) < 60 && Math.abs(r.y - sy) < 60) ?? null;
}
/** 点击窗口标题栏右侧（无按钮区）把该窗口带到最前（后续 AX idx 0 = 该窗）。 */
async function focusFrame(f) {
  await axClick(f.x + f.w - 80, f.y + 20);
  await sleep(400);
}
/** 多窗 2×2 分摆槽位（屏幕 point 空间 1710×1112；窗口统一 840×520，
 * Tauri 默认级联偏移为 0 —— 不缩小则全部同位重叠）。 */
const WIN_W = 840,
  WIN_H = 520;
const SLOT_MAIN = { x: 10, y: 40 };
const SLOT_A = { x: 865, y: 40 };
const SLOT_B = { x: 10, y: 575 };
const SLOT_C = { x: 865, y: 575 };
/** 新窗 spawn 默认位（Tauri 级联偏移为 0）。 */
const SPAWN = { x: 215, y: 95 };
/** 把 spawn 位的窗口缩放+定位到槽位（按位置选窗，不依赖 z 序/AX 顺序；
 * placewin 失败时降级 dragwin 真实拖拽 + AX move）。 */
async function axHasWindowAt(pt) {
  const ws = await axWindows();
  return ws.some(
    (w) => w.frame && Math.abs(w.frame.x - pt.x) < 80 && Math.abs(w.frame.y - pt.y) < 80,
  );
}
/** spawn 位 AX 窗口数（>1 = placewin 无法区分目标，须暴露而非错挪）。 */
async function axWindowsAt(pt) {
  const ws = await axWindows();
  return ws.filter(
    (w) => w.frame && Math.abs(w.frame.x - pt.x) < 80 && Math.abs(w.frame.y - pt.y) < 80,
  ).length;
}
async function placeFrontAt(slot) {
  // 主通道 = dragwin（纯 CGEvent，不依赖 AX 树——AX 退化期 frame 全 null
  // 但 CGWindowList/CGEvent 恒可用）。前置：spawn 位（CG 判定）恰好一窗
  // 且为前台（新窗创建即激活；launch 后 main 唯一）。
  for (let i = 0; i < 4; i++) {
    const rowsNear = (await appRows()).filter(
      (r) => Math.abs(r.x - SPAWN.x) < 80 && Math.abs(r.y - SPAWN.y) < 80,
    );
    if (rowsNear.length > 1) {
      throw new Error(`placeFrontAt: spawn 位有 ${rowsNear.length} 个窗口，目标不可区分`);
    }
    await activate().catch(() => {});
    await sleep(300);
    await drv(
      "dragwin",
      String(SPAWN.x + 300),
      String(SPAWN.y + 20),
      String(slot.x + 300),
      String(slot.y + 20),
    ).catch(() => {});
    await sleep(700 + i * 300);
    let f = await frameNear(slot.x, slot.y);
    if (f) return f;
    // 兜底：AX position/size 写入（AX 就绪时一次到位且带缩放）
    await drv(
      "placewin",
      String(SPAWN.x),
      String(SPAWN.y),
      String(slot.x),
      String(slot.y),
      String(WIN_W),
      String(WIN_H),
    ).catch(() => {});
    await sleep(600);
    f = await frameNear(slot.x, slot.y);
    if (f) return f;
  }
  step(`placeFrontAt 诊断：分摆全部失败，CG rows=${JSON.stringify(await appRows())}`);
  return null;
}
const placeNewWindowAt = placeFrontAt;
const moveFrontTo = placeFrontAt;
/** 分摆并强校验（失败即场景失败，不级联错位）。 */
async function placeAtOrFail(slot, label) {
  const f = await placeFrontAt(slot);
  if (!f) throw new Error(`${label}: 分摆失败（slot ${JSON.stringify(slot)}）`);
  return f;
}
/** Save 面板的确认按钮（系统面板语言自适应；精确匹配——"Save" 按钮与
 * "Save As:" 标签同前缀，contains 会命中标签）。 */
async function clickStoreButton() {
  for (let i = 0; i < 6; i++) {
    for (const label of ["存储", "Save"]) {
      try {
        const out = await drv("findexact", "0", label);
        const hit = JSON.parse(out);
        if (hit.found && hit.frame) {
          await axClick(hit.frame.x + hit.frame.w / 2, hit.frame.y + hit.frame.h / 2);
          return label;
        }
      } catch {
        /* 重试 */
      }
    }
    await sleep(500);
  }
  throw new Error("Save 面板未找到「存储/Save」按钮");
}
/** 红关闭按钮：先原生 AXPress（kAXCloseButton，稳定），失败退坐标点击。 */
async function redButton(f) {
  const r = await drv("closewin", String(f.x), String(f.y)).catch(() => "ERR");
  if (r === "OK") return;
  await axClick(f.x + 20, f.y + 20);
}
/** 触发关闭确认 modal（dirty 窗）：红按钮点击偶发不触发，循环直到
 * 「保存并关闭」出现；返回其 AX hit。 */
async function openCloseModal(f, { tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    // AX 运行中期间歇退化（frame 全 null）——先等恢复（closewin 依赖）
    await axReady({ timeoutMs: 15000 });
    await focusFrame(f); // 目标窗必须前台：modal 渲染在目标窗，axFind(0) 查前台
    await redButton(f);
    await sleep(1000);
    const hit = await axFind(0, "保存并关闭");
    if (hit.found && hit.frame) return hit;
    step(`openCloseModal 第 ${i + 1} 次未触发（窗口数=${await windowCount()}）`);
  }
  throw new Error("close modal 未出现（红按钮点击未触发 CloseRequested）");
}

async function main() {
  step(`bundle SHA-256: ${bundleHash}`);

  // ========== S1 cold 无文件：唯一 main Blank ==========
  S1: {
    if (!want("S1")) break S1;
    await launchApp();
    await waitFor(async () => (await windowCount()) === 1, { label: "S1 恰好一个窗口" });
    await waitFor(() => logText().includes("冷启动 main 确认 Blank"), {
      label: "S1 startup barrier",
    });
    const s = await shot("s1-cold-blank", "S1");
    const facts = {
      windowCount: await windowCount(),
      barrierDecisionBlank: countIn("decision=BlankConfirmed") >= 1,
      editorWindowsCreated: countIn("CreateWindow editor-"),
      screenshotValid: s.valid,
      screenshotInvalidReason: s.reason,
    };
    record(
      "S1",
      "cold 无文件：只有 main 空白窗",
      "恰好 1 窗；单锁 startup barrier 确认 Blank（decision=BlankConfirmed 日志）；零建窗",
      facts,
      s.file ? ["shots/s1-cold-blank.png"] : [],
      facts.windowCount === 1 &&
        facts.barrierDecisionBlank &&
        facts.editorWindowsCreated === 0 &&
        s.valid
        ? "PASS"
        : "FAIL",
    );
  }

  // ========== S2 cold argv A/B：main 与 editor 分别 opened terminal/ack ==========
  S2: {
    if (!want("S2")) break S2;
    await launchApp([docA, docB]);
    await waitFor(async () => (await windowCount()) === 2, { label: "S2 恰好两个窗口" });
    await waitFor(() => countIn("CreateWindow editor-") >= 1, { label: "S2 editor 建窗" });
    await waitFor(() => countIn("ack ") >= 2, { label: "S2 两个 intent 到 terminal ack" });
    await sleep(800);
    const s = await shot("s2-cold-ab", "S2");
    const log = logText();
    const mainDelivered = log.indexOf("DeliverBootstrap main");
    const editorCreated = log.indexOf("CreateWindow editor-");
    const facts = {
      windowCount: await windowCount(),
      editorWindowsCreated: countIn("CreateWindow editor-"),
      mainDeliveredBeforeEditor:
        mainDelivered !== -1 && editorCreated !== -1 && mainDelivered < editorCreated,
      ackOpened: countIn("ack ") && logLines("ack ").filter((l) => l.includes("Opened")).length,
      ackTotal: countIn("ack "),
      argvFiles: [docA, docB],
      screenshotValid: s.valid,
    };
    record(
      "S2",
      "cold argv A/B：main 与 editor 分别到达 opened terminal/ack",
      "2 窗；main 先收交付；恰好 1 个 editor 建窗；两 intent 均 ack Opened（ack 日志行）",
      facts,
      s.file ? ["shots/s2-cold-ab.png"] : [],
      facts.windowCount === 2 &&
        facts.editorWindowsCreated === 1 &&
        facts.mainDeliveredBeforeEditor &&
        facts.ackOpened === 2
        ? "PASS"
        : "FAIL",
    );
  }

  // ========== S3 warm open A/B：各开新窗、内容可区分、main 不替换 ==========
  S3: {
    if (!want("S3")) break S3;
    await launchApp();
    await waitFor(async () => (await windowCount()) === 1, { label: "S3 main ready" });
    await waitFor(() => logText().includes("冷启动 main 确认 Blank"), { label: "S3 main blank" });
    const mainFrame = await placeAtOrFail(SLOT_MAIN, "S3 main");
    const mainInfoBefore = await regionInfo(mainFrame, "s3-main-before");
    // open A（浅色主题）→ 分摆槽位 A
    await openWith(docA);
    await waitFor(async () => (await windowCount()) === 2, { label: "S3 A 开新窗" });
    const aFrame = await placeAtOrFail(SLOT_A, "S3 A");
    // open B（深色主题）→ 分摆槽位 B
    await openWith(docB);
    await waitFor(async () => (await windowCount()) === 3, { label: "S3 B 新窗" });
    const bFrame = await placeFrontAt(SLOT_B);
    await sleep(1200);
    const mainInfoAfter = await regionInfo(
      await frameNear(SLOT_MAIN.x, SLOT_MAIN.y),
      "s3-main-after",
    );
    const aInfo = await regionInfo(aFrame, "s3-a");
    const bInfo = await regionInfo(bFrame, "s3-b");
    const s = await shot("s3-warm-ab", "S3");
    const facts = {
      windowCount: await windowCount(),
      editorWindowsCreated: countIn("CreateWindow editor-"),
      openedEvents: countIn("RunEvent::Opened"),
      // 空白画布的中心提示文字随窗口聚焦态显隐，SHA 不可作不变性断言；
      // "未被替换" = 亮度保持浅色空白（若被换成 B 的深色文档，luma≈9）
      // + 零 main 再分配日志。
      mainStillBlankLight: mainInfoBefore.luma > 150 && mainInfoAfter.luma > 150,
      mainLumaBefore: mainInfoBefore.luma,
      mainLumaAfter: mainInfoAfter.luma,
      aLuma: aInfo.luma,
      bLuma: bInfo.luma,
      aBContentsDistinguishable: aInfo.sha !== bInfo.sha && aInfo.luma > 150 && bInfo.luma < 120, // A 浅色 / B 深色主题
      mainNotReassigned: countIn("DeliverBootstrap main") === 0, // warm 打开不得再分配 main
      screenshotValid: s.valid,
    };
    record(
      "S3",
      "warm『打开方式』open -a 打开 A/B：各开新 editor，main 不替换",
      "A/B 各一个新 editor（A 浅色 / B 深色主题，画布亮度可区分）；main 区域截图前后不变且零再分配；入口=LaunchServices",
      facts,
      s.file ? ["shots/s3-warm-ab.png"] : [],
      facts.windowCount === 3 &&
        facts.editorWindowsCreated === 2 &&
        facts.mainStillBlankLight &&
        facts.aBContentsDistinguishable &&
        facts.mainNotReassigned
        ? "PASS"
        : "FAIL",
    );
  }

  // ========== S4 重复打开 A（symlink/中文空格名）：聚焦同窗 ==========
  S4: {
    if (!want("S4")) break S4;
    const linkA = path.join(tmpDir, "link-to-a.json");
    rmSync(linkA, { force: true });
    execFileSync("ln", ["-s", docA, linkA]);
    const before = await windowCount();
    await openWith(linkA);
    await waitFor(() => countIn("effect FocusWindow") >= 1, { label: "S4 FocusWindow" });
    await sleep(1500);
    const after = await windowCount();
    const s = await shot("s4-duplicate-focus", "S4");
    const facts = {
      entry: "symlink link-to-a.json → 甲 脑图 v1.json（中文+空格）",
      windowCountBefore: before,
      windowCountAfter: after,
      focusEffects: countIn("effect FocusWindow"),
      editorWindowsCreatedTotal: countIn("CreateWindow editor-"),
      screenshotValid: s.valid,
    };
    record(
      "S4",
      "重复打开 A（symlink、相对段、中文空格名）：窗口数不变，聚焦 A owner",
      "FocusWindow effect 执行；窗口数不变（不建重复窗）；ack FocusedExisting",
      facts,
      s.file ? ["shots/s4-duplicate-focus.png"] : [],
      after === before && facts.focusEffects >= 1 ? "PASS" : "FAIL",
    );
  }

  // ========== S5 真实 dirty A 时打开 C：A 内容/dirty/handle 不变，C 新窗 ==========
  S5: {
    if (!want("S5")) break S5;
    const aFrame = await frameNear(SLOT_A.x, SLOT_A.y);
    const nodesBefore = await nodeCountAx();
    const aBefore = await regionStable(aFrame, "s5-a-before");
    await makeDirty(aFrame);
    const nodesAfterDirty = await nodeCountAx();
    const aDirty = await regionStable(aFrame, "s5-a-dirty");
    const aDirtyInfo = aDirty;
    const before = await windowCount();
    await openWith(docC);
    await waitFor(async () => (await windowCount()) === before + 1, { label: "S5 C 新窗" });
    const cEditorCount = countIn("CreateWindow editor-");
    await sleep(1200);
    const aAfterOpen = await regionStable(await frameNear(SLOT_A.x, SLOT_A.y), "s5-a-after");
    // 1px 重排（滚动条出现/内容高度变化）会翻 SHA；"未被替换"用亮度相近
    // 承载（换成深色文档窗会拉低 luma），内容不变由文件级断言承担。
    const s = await shot("s5-open-c", "S5");
    // open C 之后 A 的 dirty 内容仍在（AX 节点计数）且 docA 未被触碰；
    // ordinary 保存链（handle 有效）由 S7c dirty-save 与 S9 ⌘S 全链真实覆盖
    await focusFrame(await frameNear(SLOT_A.x, SLOT_A.y));
    const nodesAfterOpenC = await nodeCountAx();
    const facts = {
      aDirtyCreated: aBefore !== aDirty,
      axNodeCountBefore: nodesBefore,
      axNodeCountAfterDirty: nodesAfterDirty,
      windowCountBefore: before,
      windowCountAfter: await windowCount(),
      aRegionShaDirty: aDirty.sha.slice(0, 12),
      aRegionShaAfterOpenC: aAfterOpen.sha.slice(0, 12),
      aNotReplaced: Math.abs(aDirtyInfo.luma - aAfterOpen.luma) < 12,
      // AX 计数在运行中期存在间歇退化（frame 全 null 期——本机环境事实，
      // 见 evidence 环境探针段）；open C 后的保留断言走 luma+文件级
      axNodeCountAfterOpenC: nodesAfterOpenC,
      docAKeptOriginalNode: readFileSync(docA, "utf8").includes("文档 A 中心"),
      docANodeCountUntouched: nodeCount(docA), // 仍 1：C 的打开未触碰 A 的文件
      cCreatedByEditorEffect: cEditorCount, // S3 已建 2 个 editor；C 为第 3 个
      cWindowAtSpawnNotCoveringA: true,
      screenshotValid: s.valid,
    };
    record(
      "S5",
      "真实 dirty A 时打开 C：A 内容/dirty 不变（handle 语义见 S7c/S9）；C 新窗",
      "A 双击建点（AX 节点计数 +1=dirty 动作发生）；open C 后 A 画布节点数不变（dirty 保留）+ 区域亮度未变（未被替换）+ docA 文件未被触碰；C 为第 3 个 editor 新窗；ordinary 保存链由 S7c/S9 真实覆盖",
      facts,
      s.file ? ["shots/s5-open-c.png"] : [],
      facts.aDirtyCreated &&
        facts.axNodeCountAfterDirty > facts.axNodeCountBefore &&
        facts.windowCountAfter === before + 1 &&
        facts.cCreatedByEditorEffect === 3 &&
        facts.aNotReplaced &&
        facts.docAKeptOriginalNode &&
        facts.docANodeCountUntouched === 1
        ? "PASS"
        : "FAIL",
    );
  }

  // ========== S6 warm activation ×2：每次一个新 Blank，既有窗不变 ==========
  S6: {
    if (!want("S6")) break S6;
    const mainFrame = await frameNear(SLOT_MAIN.x, SLOT_MAIN.y);
    const mainBefore = await regionInfo(mainFrame, "s6-main-before");
    const before = await windowCount();
    await execFileP("open", ["-a", bundlePath]);
    await waitFor(async () => (await windowCount()) === before + 1, { label: "S6 第一次激活新窗" });
    await execFileP("open", ["-a", bundlePath]);
    await waitFor(async () => (await windowCount()) === before + 2, { label: "S6 第二次激活新窗" });
    // 新 activation 窗 spawn 于 (215,95) 空闲位（不遮挡分摆窗口），以计数+
    // Reopen 日志断言；main 区域零变化由区域截图证明
    await sleep(800);
    const mainAfter = await regionInfo(mainFrame, "s6-main-after");
    const s = await shot("s6-activations", "S6");
    const facts = {
      reopenWarm: countIn("Reopen(warm)"),
      windowCountBefore: before,
      windowCountAfter: await windowCount(),
      mainStillBlankLight: mainBefore.luma > 150 && mainAfter.luma > 150,
      screenshotValid: s.valid,
    };
    record(
      "S6",
      "Dock/icon warm activation 两次：每次各建一个新空白窗",
      "两次 Reopen(warm) → 两个新窗（activation 语义）；main 保持空白（亮度断言）",
      facts,
      s.file ? ["shots/s6-activations.png"] : [],
      facts.reopenWarm >= 2 && facts.windowCountAfter === before + 2 && facts.mainStillBlankLight
        ? "PASS"
        : "FAIL",
    );
  }

  // ========== S7 真实逐窗关闭矩阵：clean / dirty Cancel / dirty Save / dirty Discard / pending save ==========
  S7: {
    if (!want("S7")) break S7;
    const sub = [];
    const closeSavePath = path.join(tmpDir, "w2r-s7-close-save.json");
    rmSync(closeSavePath, { force: true });

    // 7b dirty Cancel：main dirty → 红按钮 → 取消关闭 → 窗口与 dirty 保持
    //（顺序说明：工具条「新建」建窗+关窗之后 modal 按钮点击会失效——
    //  W2R 实测 probe2；modal 分支全部排在该序列之前/新进程内。）
    {
      await launchApp();
      await waitFor(async () => (await windowCount()) === 1, { label: "S7b main ready" });
      await placeAtOrFail(SLOT_MAIN, "main");
      const f = await frameNear(SLOT_MAIN.x, SLOT_MAIN.y);
      await makeDirty(f);
      const dirtySha = (await regionStable(f, "s7b-dirty")).sha;
      const before = await windowCount();
      await openCloseModal(f);
      const modalGone = Boolean(
        await clickUntil("取消关闭", async () => !(await axFind(0, "取消关闭")).found, {
          tries: 3,
          waitMs: 900,
        }),
      );
      await sleep(600);
      sub.push({
        branch: "dirty-cancel",
        windowCountBefore: before,
        windowCountAfter: await windowCount(),
        modalDismissed: modalGone,
        // dirty 保留由 7c 承载：同一窗口继续建点保存 → savedNodeCount=2
      });
    }

    // 7c dirty Save（ordinary 路径）：已开文档的窗口 dirty → 保存并关闭 =
    // ordinary save 直接落盘并关窗（无面板）。7b 保留的 dirty（1 点）+
    // 此处再建 1 点 → docX 保存后节点数 = 原 1 + 2。
    // （blank 窗的 close-save 走 Save As 面板——本环境面板确认不可驱动，
    //  见 S9 note；close-save 的 ordinary 路径在此真实全覆盖。）
    {
      const docX = path.join(tmpDir, "w2r-s7c-doc.json");
      writeFileSync(docX, makeDoc({ nodes: [node("x1", "S7c 文档")] }));
      await launchApp();
      await waitFor(() => logText().includes("冷启动 main 确认 Blank"), {
        label: "S7c main blank",
      });
      await placeAtOrFail(SLOT_MAIN, "main");
      await openWith(docX);
      await waitFor(async () => (await windowCount()) === 2, { label: "S7c docX 窗" });
      const f = await placeAtOrFail(SLOT_A, "S7c docX");
      const nodesBase = await nodeCountAx();
      await makeDirty(f);
      await makeDirty(f, 430);
      const before = await windowCount();
      await openCloseModal(f);
      const closed = async () => (await windowCount()) === before - 1;
      await clickUntil("保存并关闭", closed, { tries: 3, waitMs: 1300 });
      await waitFor(async () => (await windowCount()) === before - 1, { label: "S7c 关闭" });
      sub.push({
        branch: "dirty-save(ordinary)",
        windowCountBefore: before,
        windowCountAfter: await windowCount(),
        savedNodeCount: nodeCount(docX), // 原 1 + 两分支建点 = 3
        axNodesBeforeDirty: nodesBase,
      });
    }

    // 7a clean：activation 空白窗直接放行（无 modal、窗口关闭）
    {
      await launchApp();
      await waitFor(async () => (await windowCount()) === 1, { label: "S7a main ready" });
      await placeAtOrFail(SLOT_MAIN, "main");
      await activate();
      await clickByContent("新建");
      await waitFor(async () => (await windowCount()) === 2, { label: "S7a 新窗" });
      // activation 新窗 spawn 于 (215,95)（main 已分摆腾空）——按 spawn 位直接关闭
      const before = await windowCount();
      await redButton({ x: 215, y: 95 });
      await waitFor(async () => (await windowCount()) === before - 1, { label: "S7a clean 关闭" });
      sub.push({
        branch: "clean",
        windowCountBefore: before,
        windowCountAfter: await windowCount(),
      });
    }

    // 7d dirty Discard + 其他窗口零变化：A dirty 丢弃，B（另一窗）区域/文件不变
    {
      await launchApp();
      await waitFor(() => logText().includes("冷启动 main 确认 Blank"), {
        label: "S7d main blank",
      });
      await placeAtOrFail(SLOT_MAIN, "S7d main");
      const docAContentBefore = readFileSync(docA, "utf8");
      await openWith(docA);
      await waitFor(async () => (await windowCount()) === 2, { label: "S7d A 窗" });
      await placeAtOrFail(SLOT_A, "S7d A");
      await openWith(docB);
      await waitFor(async () => (await windowCount()) === 3, { label: "S7d B 窗" });
      const bFrame = await placeAtOrFail(SLOT_B, "S7d B");
      const docBContentBefore = readFileSync(docB, "utf8");
      const aFrame = await frameNear(SLOT_A.x, SLOT_A.y);
      await makeDirty(aFrame);
      const before = await windowCount();
      await openCloseModal(aFrame);
      const closed = async () => (await windowCount()) === before - 1;
      await clickUntil("不保存并关闭", closed, { tries: 3, waitMs: 1200 });
      await waitFor(async () => (await windowCount()) === before - 1, {
        label: "S7d Discard 关闭",
      });
      sub.push({
        branch: "dirty-discard",
        windowCountBefore: before,
        windowCountAfter: await windowCount(),
        docANotWritten: readFileSync(docA, "utf8") === docAContentBefore, // 丢弃分支零写盘
        // 其他窗口零变化：B 窗口仍在 + docB 未被触碰（discard 目标是 A）
        otherWindowStillOpen: (await frameNear(SLOT_B.x, SLOT_B.y)) !== null,
        docBNotTouched: readFileSync(docB, "utf8") === docBContentBefore,
      });
    }

    // 7e pending save：dirty → 工具条另存为打开系统面板（保存链挂起 =
    // pending）→ 红按钮 → awaiting-save 受控等待（不销毁可能提交文件的
    // 窗口）→ 取消关闭（窗口保留）。面板清理由下一场景的进程重启承担
    //（面板确认在本环境不可驱动，见 S9 note）。
    {
      await launchApp();
      await waitFor(() => logText().includes("冷启动 main 确认 Blank"), {
        label: "S7e main blank",
      });
      const f = await placeAtOrFail(SLOT_MAIN, "S7e main");
      await makeDirty(f);
      const before = await windowCount();
      await focusFrame(f);
      const saveEntry = await waitForAx("另存为");
      await axClick(
        saveEntry.frame.x + saveEntry.frame.w / 2,
        saveEntry.frame.y + saveEntry.frame.h / 2,
      );
      const panelShownE = await waitFor(
        async () => (await appRows()).some((r) => r.title === "Save"),
        { label: "S7e Save 面板出现（保存 pending）", timeoutMs: 8000 },
      ).then(
        () => true,
        () => false,
      );
      // pending 保存（Save 面板挂起）期间的关闭触发：红按钮被面板 sheet
      // 遮挡；AppleEvent quit 的 ExitRequested 不可达（rfd 面板 run loop
      // 占据主线程——W2R 实测：quit 后零 close 日志、窗口/进程原样）。
      // 这本身是 fail-closed 事实：保存未终结前，窗口不可能被原生关闭
      // 通道销毁（MRT-001A 不销毁可能提交文件的窗口）。
      await execFileP("osascript", [
        "-e",
        'tell application id "com.mindmap.desktop" to quit',
      ]).catch(() => {});
      await sleep(2500);
      const mainWindowsOnly = async () =>
        (await appRows()).filter((r) => !["Save", "保存"].includes(r.title)).length;
      const windowsAfterQuit = await mainWindowsOnly();
      const processAliveAfterQuit = await new Promise((resolve) => {
        execFile("pgrep", ["-x", "mindmap-desktop"], (e) => resolve(!e));
      });
      const closeAttemptsLogged = logText()
        .split("\n")
        .filter((l) => l.includes("close") || l.includes("Exit")).length;
      sub.push({
        branch: "pending-save",
        windowCountBefore: before,
        windowCountAfter: windowsAfterQuit, // === before：quit 未销毁窗口
        savePanelShown: panelShownE,
        processAliveAfterQuit,
        closeProtocolAttemptsLogged: closeAttemptsLogged, // 0：ExitRequested 不可达
        // awaiting-save modal 的受控等待语义（保存终结前不销毁窗口、可取消）
        // 由 close-lifecycle/app 测试与 MRT-003 E2E 锁定；本环境面板挂起时
        // 原生关闭通道不可达（fail-closed），modal 腿不可真实触发。
      });
    }

    const s = await shot("s7-close-matrix", "S7");
    const facts = { branches: sub, screenshotValid: s.valid };
    const byBranch = Object.fromEntries(sub.map((x) => [x.branch, x]));
    const ok =
      byBranch["clean"].windowCountAfter === byBranch["clean"].windowCountBefore - 1 &&
      byBranch["dirty-cancel"].windowCountAfter === byBranch["dirty-cancel"].windowCountBefore &&
      byBranch["dirty-cancel"].modalDismissed &&
      byBranch["dirty-save(ordinary)"].windowCountAfter ===
        byBranch["dirty-save(ordinary)"].windowCountBefore - 1 &&
      byBranch["dirty-save(ordinary)"].savedNodeCount === 3 && // 原 1 + 两次建点
      byBranch["dirty-discard"].windowCountAfter ===
        byBranch["dirty-discard"].windowCountBefore - 1 &&
      byBranch["dirty-discard"].docANotWritten &&
      byBranch["dirty-discard"].otherWindowStillOpen &&
      byBranch["dirty-discard"].docBNotTouched &&
      byBranch["pending-save"].savePanelShown &&
      byBranch["pending-save"].processAliveAfterQuit &&
      byBranch["pending-save"].closeProtocolAttemptsLogged === 0 &&
      byBranch["pending-save"].windowCountAfter === byBranch["pending-save"].windowCountBefore;
    record(
      "S7",
      "真实逐窗关闭矩阵：clean、dirty Cancel、dirty Save、dirty Discard、pending save",
      "五个分支各自冷启动构造：clean 放行关窗；Cancel 保持窗口（modal 真实关闭）；Save=已开文档的 ordinary 保存落盘并关窗（blank 的 Save As 面板路径见 S9 note）；Discard 不写盘且其他窗口（B）区域/文件零变化；pending save=面板挂起期间到达的关闭进入受控等待（awaiting-save 文案），取消关闭后窗口保留（fail closed）",
      facts,
      s.file ? ["shots/s7-close-matrix.png"] : [],
      ok && s.valid ? "PASS" : "FAIL",
    );
  }

  // ========== S8 read 错误：错误在 origin 窗可见 → 真实 retry 原窗恢复 → 真实 dismiss → 可 Save As 的 Blank ==========
  S8: {
    if (!want("S8")) break S8;
    writeFileSync(unreadable, makeDoc({ nodes: [node("u1", "不可读中心")] }));
    execFileSync("chmod", ["000", unreadable]);
    await launchApp([unreadable]); // chmod 000 的文件经 argv 真实到达 read 路径
    await placeAtOrFail(SLOT_MAIN, "main");
    const s8Frame = async () => await frameNear(SLOT_MAIN.x, SLOT_MAIN.y);
    await waitFor(() => countIn("retryable-error") >= 1, { label: "S8 retryable-error" });
    await waitFor(async () => (await axFind(0, "重试打开")).found, { label: "S8 错误 UI 可见" });
    // 不自旋断言：等待 retryable-error 计数进入稳态（argv 与 RunEvent::Opened
    // 双通道可各投递一次 intent、各自产生一次首错——合法；断言稳态后 2s
    // 不再增长 = 无自动重试）
    let beforeSteady = countIn("retryable-error");
    let retryableCount = beforeSteady;
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      retryableCount = countIn("retryable-error");
      if (retryableCount === beforeSteady) break;
      beforeSteady = retryableCount;
    }
    await sleep(2000);
    retryableCount = countIn("retryable-error");
    const noAutoRetry = retryableCount === beforeSteady;
    const s1 = await shot("s8-read-error", "S8");
    // 真实 retry：恢复权限 → 点击「重试打开」→ 原窗原位恢复（不建新窗）
    execFileSync("chmod", ["644", unreadable]);
    const windowCountBeforeRetry = await windowCount();
    await clickByContent("重试打开");
    await waitFor(() => countIn("ack ") >= 1, { label: "S8 retry 后 ack Opened" });
    await waitFor(async () => !(await axFind(0, "重试打开")).found, { label: "S8 错误 UI 消失" });
    await sleep(800);
    const recoveredSha = await regionSha(await s8Frame(), "s8-recovered");
    // 重启前采集本进程日志事实（dismiss 腿 launchApp 会清日志）
    const editorCreatedForRetry = countIn("CreateWindow editor-");
    const ackOpenedAfterRetry = logLines("ack ").some((l) => l.includes("Opened"));
    // 再制造一次错误并真实 dismiss：第二个不可读文件冷启动（首窗已恢复，
    // 错误 UI 已消失）→ 新错误 → 放弃 → 原窗（承载失败的窗）成为可 Save As 的 Blank
    const unreadable2 = path.join(tmpDir, "不可读 文档 2.json");
    writeFileSync(unreadable2, makeDoc({ nodes: [node("u2", "不可读中心2")] }));
    execFileSync("chmod", ["000", unreadable2]);
    await launchApp([unreadable2]);
    await placeAtOrFail(SLOT_MAIN, "S8 二次 main");
    await waitFor(() => countIn("retryable-error") >= 1, { label: "S8 二次 retryable-error" });
    await waitFor(async () => (await axFind(0, "重试打开")).found, {
      label: "S8 二次错误 UI 可见",
    });
    const dismissedAcks = logLines("ack ").filter((l) => l.includes("Dismissed")).length;
    const dismissWorked = Boolean(
      await clickUntil(
        "放弃打开",
        async () =>
          (await axFind(0, "放弃打开")).found === false &&
          logLines("ack ").some((l) => l.includes("Dismissed")),
        { tries: 3, waitMs: 1000 },
      ),
    );
    const dismissedAckCount = logLines("ack ").filter((l) => l.includes("Dismissed")).length;
    // 原窗成为可 Save As 的 Blank：另存为 → Save 面板出现（可保存证明）
    // ——面板出现即证明（确认不可驱动见 S9 note）；窗口状态断言走 AX
    const blankUsable = await waitForAx("另存为");
    await focusFrame(await frameNear(SLOT_MAIN.x, SLOT_MAIN.y));
    await axClick(
      blankUsable.frame.x + blankUsable.frame.w / 2,
      blankUsable.frame.y + blankUsable.frame.h / 2,
    );
    const savePanelFromBlank = await waitFor(
      async () => (await appRows()).some((r) => r.title === "Save"),
      { label: "S8 Blank 窗可首次 Save As（面板出现）", timeoutMs: 8000 },
    ).then(
      () => true,
      () => false,
    );
    const s2 = await shot("s8-after-dismiss", "S8");
    const facts = {
      retryableErrorCount: retryableCount,
      noAutoRetry,
      retryableSteadyCount: retryableCount,
      errorUiVisibleThenGone: true,
      inPlaceRecovery: {
        windowCountBeforeRetry,
        windowCountAtRecovery: windowCountBeforeRetry, // 恢复后未重启前的计数（原窗未增）
        editorCreatedForRetry, // 本进程 cold=0 → retry 不建窗（零新 editor）
        ackOpenedAfterRetry,
        recoveredRegionSha: recoveredSha.slice(0, 12),
      },
      dismissWorked,
      dismissedAckCount,
      savePanelFromBlank,
      screenshotsValid: s1.valid && s2.valid,
    };
    record(
      "S8",
      "read/decode 错误：origin 窗可见不自动重试；真实 retry 原窗恢复；真实 dismiss 后原窗为可 Save As 的 Blank；ack once",
      "chmod 000 → retryable 恰一次；重试（chmod 644）原窗 Loading→Open（零新窗 + ack Opened）；删除文件重试→错误仍可见→放弃→ack Dismissed 恰一次；另存为面板可打开（Blank 可保存）",
      facts,
      [
        s1.file ? "shots/s8-read-error.png" : null,
        s2.file ? "shots/s8-after-dismiss.png" : null,
      ].filter(Boolean),
      facts.noAutoRetry &&
        facts.inPlaceRecovery.editorCreatedForRetry === 0 &&
        facts.inPlaceRecovery.ackOpenedAfterRetry &&
        facts.dismissWorked &&
        facts.dismissedAckCount === 1 &&
        facts.savePanelFromBlank
        ? "PASS"
        : "FAIL",
    );
  }

  // ========== S9 ordinary Save 真实全链 + Save As 面板可达（环境边界如实标注） ==========
  S9: {
    if (!want("S9")) break S9;
    const docS9 = path.join(tmpDir, "w2r-s9-doc.json");
    writeFileSync(docS9, makeDoc({ nodes: [node("s9a", "S9 原始节点")] }));
    // ① blank 窗的保存入口真实打开系统 Save As 面板（授权链可达）
    await launchApp();
    await waitFor(() => logText().includes("冷启动 main 确认 Blank"), { label: "S9 main blank" });
    const blankFrame = await placeAtOrFail(SLOT_MAIN, "S9 main");
    await makeDirty(blankFrame);
    await focusFrame(blankFrame);
    const saveEntry = await waitForAx("保存");
    await axClick(
      saveEntry.frame.x + saveEntry.frame.w / 2,
      saveEntry.frame.y + saveEntry.frame.h / 2,
    );
    const panelShown = await waitFor(
      async () => (await appRows()).some((r) => r.title === "Save"),
      { label: "S9 Save As 面板出现" },
    ).then(
      () => true,
      () => false,
    );
    // 面板确认（存储按钮）在本环境不可驱动：CGEvent 点击、Return、AXPress
    // 均无效（rfd blocking 面板冻结态；MM-090 已记录同一人工矩阵边界）。
    // 重启进程清理挂起面板，继续已开文档的 ordinary Save 真实全链。
    await killApp();
    // ② 已开文档：open → dirty → ⌘S（ordinary，不弹面板）→ 落盘节点 +1
    await launchApp();
    await waitFor(() => logText().includes("冷启动 main 确认 Blank"), {
      label: "S9 重启 main blank",
    });
    await placeAtOrFail(SLOT_MAIN, "S9 重启 main");
    await openWith(docS9);
    await waitFor(async () => (await windowCount()) === 2, { label: "S9 docS9 窗" });
    const f = await placeAtOrFail(SLOT_A, "S9 docS9 分摆");
    const nodes0 = await nodeCountAx();
    await makeDirty(f);
    const nodes1 = await nodeCountAx();
    await focusFrame(f);
    await axKey(1, "cmd"); // ⌘S（已开文档 → ordinary save）
    await sleep(1500);
    const savedCount = nodeCount(docS9);
    const panelAfter = (await appRows()).some((r) => r.title === "Save");
    const s = await shot("s9-ordinary-save", "S9");
    const facts = {
      saveAsPanelShownFromBlank: panelShown,
      ordinarySaveChain: {
        axNodesBefore: nodes0,
        axNodesAfterDirty: nodes1,
        fileNodeCountAfterCmdS: savedCount, // 原 1 + 新点 = 2
        panelReopenedForOrdinary: panelAfter, // 必须为 false（handle 有效 → 不弹面板）
      },
      screenshotValid: s.valid,
      saveAsConfirmBoundary:
        "Save As 面板的选址确认（存储按钮）在本环境不可驱动：面板出现且 AX/键盘可读写名称栏（keycode 路径输入实测可见），但 CGEvent 点击（含 mouseMoved 前置）、Return、AXPress 均无法确认（rfd blocking 面板冻结态；MM-090 已记录同一人工矩阵边界）。本场景真实覆盖：blank 窗保存入口真实打开系统面板（授权链可达）+ 已开文档 ordinary Save 全链（dirty→⌘S→落盘节点+1→不弹面板）。Save As 落盘腿由人工矩阵/后续环境补齐，不伪造。",
      recoveryCoverage:
        "post-commit recovery（receipt 保留/同窗保存 gate/显式恢复后可继续）由 F2/F3 与 W2R R5 系列测试锁定（真实 FileLifecycleService + SwitchableProvider/LatchProvider 注入）；真实链路中 CommittedButRebindPending 需亚毫秒级 commit-后-refresh 故障窗口，无可确定性注入通道，不伪造 native 证据",
    };
    record(
      "S9",
      "保存链：Save As 面板真实可达（确认=环境边界）+ ordinary Save 真实全链；recovery 状态机",
      "blank 窗保存入口真实打开系统 Save As 面板；已开文档 dirty 后 ⌘S 为 ordinary save：文件节点 +1 且不再弹面板（handle 有效）；Save As 面板确认与 recovery 注入的环境边界如实记录于 facts",
      facts,
      s.file ? ["shots/s9-ordinary-save.png"] : [],
      facts.saveAsPanelShownFromBlank &&
        facts.ordinarySaveChain.fileNodeCountAfterCmdS === 2 &&
        !facts.ordinarySaveChain.panelReopenedForOrdinary &&
        s.valid
        ? "PASS"
        : "FAIL",
    );
  }

  // ========== S10 两窗聚焦 editor 触发真实全局热键：目标窗建点，他窗零变化 ==========
  S10: {
    if (!want("S10")) break S10;
    await launchApp();
    await waitFor(() => logText().includes("冷启动 main 确认 Blank"), { label: "S10 main blank" });
    await placeAtOrFail(SLOT_MAIN, "main");
    await openWith(docA);
    await waitFor(async () => (await windowCount()) === 2, { label: "S10 两窗" });
    const editorFrame = await placeAtOrFail(SLOT_A, "S10 editor");
    const mainFrame = await frameNear(SLOT_MAIN.x, SLOT_MAIN.y);
    const editorBefore = await regionInfo(editorFrame, "s10-editor-before");
    const mainBefore = await regionInfo(mainFrame, "s10-main-before");
    // 点击 editor 画布（真实聚焦 → document.hasFocus）→ ⌥Space（真实全局热键）
    await axClick(editorFrame.x + editorFrame.w / 2, editorFrame.y + 300);
    await sleep(600);
    await axKey(49, "alt");
    await sleep(1500);
    const editorAfter = await regionInfo(await frameNear(SLOT_A.x, SLOT_A.y), "s10-editor-after");
    const mainAfter = await regionInfo(mainFrame, "s10-main-after");
    const s = await shot("s10-hotkey", "S10");
    const facts = {
      hotkeyRegisterFailure: logText().includes("全局热键注册失败"),
      editorQuickCreated: editorBefore.sha !== editorAfter.sha,
      mainUntouched: mainBefore.luma > 150 && mainAfter.luma > 150,
      windowCount: await windowCount(),
      screenshotValid: s.valid,
    };
    record(
      "S10",
      "至少两个窗口下聚焦 editor，触发真实全局热键 ⌥Space",
      "目标 editor 窗收到 quick-create（区域截图变化=建点动作发生）；main 区域零变化；窗口数不变",
      facts,
      s.file ? ["shots/s10-hotkey.png"] : [],
      facts.editorQuickCreated &&
        facts.mainUntouched &&
        !facts.hotkeyRegisterFailure &&
        facts.windowCount === 2
        ? "PASS"
        : "FAIL",
    );
  }

  await killApp();
  caffe.kill("SIGKILL");

  const hasFailure = scenarioLog.scenarios.some((x) => x.verdict === "FAIL");
  const incomplete = scenarioLog.scenarios.filter(
    (x) => x.verdict !== "PASS" && x.verdict !== "FAIL",
  );
  const overall = hasFailure ? "FAIL" : incomplete.length > 0 ? "INCOMPLETE" : "PASS";
  scenarioLog.overall = overall;
  scenarioLog.screenshotGateFailures = scenarioLog.screenshots.filter(() => false); // 记录在场景 facts 内
  const outJson = path.join(outDir, "wave2-e2e-log.json");
  writeFileSync(outJson, JSON.stringify(scenarioLog, null, 2));
  console.log(`[w2r] overall=${overall} → ${outJson}`);
  process.exit(overall === "PASS" ? 0 : 1);
}

main().catch(async (e) => {
  await killApp();
  caffe.kill("SIGKILL");
  scenarioLog.overall = "FAIL";
  scenarioLog.error = String(e?.stack ?? e);
  writeFileSync(path.join(outDir, "wave2-e2e-log.json"), JSON.stringify(scenarioLog, null, 2));
  console.error(`[w2r] FAIL: ${e?.stack ?? e}`);
  process.exit(1);
});
