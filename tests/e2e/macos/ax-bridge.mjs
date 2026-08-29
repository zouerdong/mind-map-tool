// macOS AX/系统事件桥（MM-090 E2E，osascript 路线）。
// 背景：tauri-driver v2.0.6 不支持 macOS（官方仅 Linux/Windows，
// 报 "not supported on this platform"）——改用 macOS 自带的
// System Events：真实键盘（keystroke 走系统输入链）、真实鼠标点击
// （click at AX 坐标）、AX 树断言（WKWebView 在 app 域偏好
// WebKitAccessibilityEnabled=true 后暴露 DOM AX 树，aria-label →
// AX description）。零第三方依赖；交互保真度记入 evidence。
//
// 前置（一次性，均 fail-closed 由 run-e2e-macos.sh 检查/指引）：
// - defaults write com.mindmap.desktop WebKitAccessibilityEnabled -bool YES
// - 运行宿主（终端）具有辅助功能权限（TCC）

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const PROCESS_NAME = "mindmap-desktop"; // 可执行文件名（AX process 名），非显示名

const scriptDir = mkdtempSync(path.join(tmpdir(), "mindmap-e2e-jxa-"));

/** 执行 AppleScript（临时文件；keystroke/剪贴板等 System Events 语法）。 */
export async function as(script) {
  const file = path.join(scriptDir, `a${Date.now()}-${Math.random().toString(36).slice(2)}.applescript`);
  writeFileSync(file, script);
  try {
    const { stdout } = await execFileP("osascript", [file], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.trimEnd();
  } finally {
    rmSync(file, { force: true });
  }
}

/** 执行 JXA 脚本（临时文件传入——osascript 从 stdin 读会因 EOF 语义挂死）。 */
export async function jxa(script) {
  const file = path.join(scriptDir, `s${Date.now()}-${Math.random().toString(36).slice(2)}.jxa`);
  writeFileSync(file, script);
  try {
    const { stdout } = await execFileP("osascript", ["-l", "JavaScript", file], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (e) {
    const head = script.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ");
    throw new Error(`jxa 失败（${head.slice(0, 120)}）: ${String(e.message).slice(0, 300)}`);
  } finally {
    rmSync(file, { force: true });
  }
}

const seHeader = 'const se = Application("System Events");';

/**
 * AX 树查找（断言查询）：按谓词匹配元素，返回其 role/description/value/
 * position/size。谓词为 JS 表达式（对 d=description, v=value, r=role 求值）。
 * 匹配多个时返回第一个；找不到返回 null。
 */
/** 瞬态 AX 会话失败自愈：-1708/-1728 时短退避重试（System Events
 * 与 app 的 AX 连接在 app 刚启动/切换期偶发失败，重试即恢复）。 */
async function withAxRetry(fn, { retries = 3, backoffMs = 600 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = /\(-1708\)|\(-1728\)/.test(String(e.message));
      if (!transient || i >= retries) throw e;
      await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
}

async function axFindOnce(predicate, { maxDepth = 10 } = {}) {
  const script = `
${seHeader}
const proc = se.processes.byName(${JSON.stringify(PROCESS_NAME)});
function find(el, depth) {
  if (depth > ${maxDepth}) return null;
  let kids = [];
  try { kids = el.uiElements(); } catch (e) { return null; }
  for (const k of kids) {
    try {
      const d = String(k.description());
      const r = String(k.role());
      let v = '';
      try { v = String(k.value()); } catch (e) {}
      if (${predicate}) {
        let pos = null, size = null;
        try {
          // JXA position()/size() 返回类数组 {0:x,1:y}（AS 点列表映射），
          // 按（不可见的）x/y 属性取值会得 undefined → 点击坐标 NaN。
          const p = k.position(), s = k.size();
          pos = { x: p[0], y: p[1] };
          size = { w: s[0], h: s[1] };
        } catch (e) {}
        return JSON.stringify({ role: r, desc: d, value: v.slice(0, 200), pos, size });
      }
    } catch (e) {}
    const hit = find(k, depth + 1);
    if (hit) return hit;
  }
  return null;
}
find(proc.windows()[0], 0);`;
  const out = await jxa(script);
  return out === "" || out === "null" || out === "undefined" ? null : JSON.parse(out);
}

/** 查找全部匹配元素（计数/遍历断言用）。 */
export async function axFind(predicate, opts) {
  return withAxRetry(() => axFindOnce(predicate, opts));
}

export async function axFindAll(predicate, opts) {
  return withAxRetry(() => axFindAllOnce(predicate, opts));
}

async function axFindAllOnce(predicate, { maxDepth = 10 } = {}) {
  const script = `
${seHeader}
const proc = se.processes.byName(${JSON.stringify(PROCESS_NAME)});
const hits = [];
function find(el, depth) {
  if (depth > ${maxDepth}) return;
  let kids = [];
  try { kids = el.uiElements(); } catch (e) { return; }
  for (const k of kids) {
    try {
      const d = String(k.description());
      const r = String(k.role());
      let v = '';
      try { v = String(k.value()); } catch (e) {}
      if (${predicate}) {
        let pos = null;
        try { const pp = k.position(); pos = { x: pp[0], y: pp[1] }; } catch (e) {}
        hits.push({ role: r, desc: d, value: v.slice(0, 120), pos });
      }
    } catch (e) {}
    find(k, depth + 1);
  }
}
find(proc.windows()[0], 0);
JSON.stringify(hits);`;
  const out = await jxa(script);
  return JSON.parse(out);
}

/** AX 元素动作：press（按钮/链接）。按 description 精确匹配。 */
export async function axPress(descMatch) {
  const script = `
${seHeader}
const proc = se.processes.byName(${JSON.stringify(PROCESS_NAME)});
function find(el, depth) {
  if (depth > 10) return null;
  let kids = [];
  try { kids = el.uiElements(); } catch (e) { return null; }
  for (const k of kids) {
    try {
      if (String(k.description()) === ${JSON.stringify(descMatch)}) return k;
    } catch (e) {}
    const hit = find(k, depth + 1);
    if (hit) return hit;
  }
  return null;
}
const el = find(proc.windows()[0], 0);
if (!el) { "NOT_FOUND"; } else { el.actions.press(); "OK"; }`;
  const r = await jxa(script);
  if (r === "NOT_FOUND") throw new Error(`axPress: 元素不存在 ${descMatch}`);
  return r;
}

/** 真实键盘：keystroke（System Events，走系统输入链；app 须前台）。 */
export async function keystroke(text, { cmd = false, option = false, shift = false, ctrl = false } = {}) {
  const mods = [
    ...(cmd ? ["command down"] : []),
    ...(option ? ["option down"] : []),
    ...(shift ? ["shift down"] : []),
    ...(ctrl ? ["control down"] : []),
  ].join(", ");
  const using = mods ? ` using ${mods}` : "";
  await as(`tell application "System Events" to keystroke ${JSON.stringify(text)}${using}`);
}

/** 键码（key code）输入：方向键/Delete/Return/Escape 等。 */
export async function keyCode(code, { cmd = false, option = false, shift = false, ctrl = false } = {}) {
  const mods = [
    ...(cmd ? ["command down"] : []),
    ...(option ? ["option down"] : []),
    ...(shift ? ["shift down"] : []),
    ...(ctrl ? ["control down"] : []),
  ].join(", ");
  const using = mods ? ` using ${mods}` : "";
  await as(`tell application "System Events" to key code ${code}${using}`);
}

/** 前台化 app。 */
export async function activate() {
  await jxa(`Application("Mind Map").activate();`);
}

/**
 * 真实鼠标：指定坐标双击（CGEvent——System Events 无坐标点击命令，
 * JXA clickAt 报 -1708；CGEventPost(kCGHIDEventTap) 为真实 HID 级事件）。
 * CGEvent 与 AX position 同为全局屏幕坐标（主屏左上原点）。
 */
export async function clickAt(x, y, { clickState = 1 } = {}) {
  await jxa(`
ObjC.import("CoreGraphics");
const pt = $.CGPointMake(${x}, ${y});
const d = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, pt, $.kCGMouseButtonLeft);
const u = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, pt, $.kCGMouseButtonLeft);
$.CGEventSetIntegerValueField(d, $.kCGMouseEventClickState, ${clickState});
$.CGEventSetIntegerValueField(u, $.kCGMouseEventClickState, ${clickState});
$.CGEventPost($.kCGSessionEventTap, d);
$.CGEventPost($.kCGSessionEventTap, u);
"OK";`);
  await new Promise((r) => setTimeout(r, 120));
}

export async function doubleClickAt(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`doubleClickAt: 坐标非法（${x},${y}）——AX position 解析失败`);
  }
  // 双击必须在单脚本内完成：跨 osascript 进程的两击间隔（200-400ms 开销）
  // 实测超出系统双击时窗 → dblclick 不派发。脚本内忙等 ~120ms 控制间隔。
  const script = `
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
function clickAt(state) {
  const pt = $.CGPointMake(${x}, ${y});
  const d = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, pt, $.kCGMouseButtonLeft);
  const u = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, pt, $.kCGMouseButtonLeft);
  $.CGEventSetIntegerValueField(d, $.kCGMouseEventClickState, state);
  $.CGEventSetIntegerValueField(u, $.kCGMouseEventClickState, state);
  $.CGEventPost($.kCGSessionEventTap, d);
  $.CGEventPost($.kCGSessionEventTap, u);
}
function wait(sec) {
  // JXA 无参方法一律属性访问：NSDate.date / timeIntervalSince1970
  const end = $.NSDate.date.timeIntervalSince1970 + sec;
  while ($.NSDate.date.timeIntervalSince1970 < end) {}
}
clickAt(1);
wait(0.12);
clickAt(2);
"OK";`;
  await jxa(script);
}

/** 真实鼠标：在 AX 元素中心双击（descMatch 精确匹配 description）。 */
export async function axDoubleClick(descMatch) {
  const el = await axFind(`d === ${JSON.stringify(descMatch)}`);
  if (!el || el.pos === null || el.size === null) throw new Error(`axDoubleClick: 元素/坐标缺失 ${descMatch}`);
  const cx = Math.round(el.pos.x + el.size.w / 2);
  const cy = Math.round(el.pos.y + el.size.h / 2);
  await activate();
  await new Promise((r) => setTimeout(r, 200));
  await doubleClickAt(cx, cy);
}

/** 窗口区域截图（screencapture -R，窗口 frame——画布 AX size 实测高仅 10px 不可用）。 */
export async function captureWindow(file) {
  const f = await windowFrame();
  const { execFile: ef } = await import("node:child_process");
  await promisify(ef)("screencapture", [
    "-R",
    `${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.w)},${Math.round(f.h)}`,
    file,
  ]);
}

/** 主窗口 frame（原生坐标可靠；web 容器的 AX size 不准，实测高 10px）。 */
export async function windowFrame() {
  const out = await withAxRetry(() =>
    jxa(`const se = Application("System Events");
const w = se.processes.byName(${JSON.stringify(PROCESS_NAME)}).windows()[0];
const p = w.position(), s = w.size();
JSON.stringify({ x: p[0], y: p[1], w: s[0], h: s[1] });`),
  );
  return JSON.parse(out);
}

/** 剪贴板写入（配合 ⌘V 实现真实粘贴输入——keystroke 不支持非 ASCII）。 */
export async function setClipboard(text) {
  await as(`set the clipboard to ${JSON.stringify(text)}`);
}

/** 轮询等待谓词匹配（超时抛错）。 */
export async function axWaitFor(predicate, { timeoutMs = 6000, intervalMs = 300, label = "axWaitFor" } = {}) {
  const start = Date.now();
  for (;;) {
    const hit = await axFind(predicate);
    if (hit) return hit;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${label} 超时（${timeoutMs}ms）：${predicate}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
