// smoke-mcp-standalone.mjs — 独立 MCP 产物冒烟（ADR 0018）。
// 经 stdio 走真实 MCP 握手：initialize → tools/list → render_mindmap 落盘
// PNG + .mindmap，断言文件存在且非空。CI 与本地共用，防资产内嵌回归。
// 用法：node scripts/smoke-mcp-standalone.mjs --node <二进制路径> --bundle <mjs路径>

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const nodeBin = arg("node");
const bundle = arg("bundle");
if (!nodeBin || !bundle) {
  console.error("用法: node scripts/smoke-mcp-standalone.mjs --node <path> --bundle <path>");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "mcp-smoke-"));
const outPng = join(work, "smoke.png");
const outSource = join(work, "smoke.mindmap");

const child = spawn(nodeBin, [bundle], { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

const pending = new Map();
let buffer = "";
child.stdout.on("data", (d) => {
  buffer += d.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`超时等待 id=${id} (${method})`));
      }
    }, 60_000);
  });
}

function notify(method) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
}

function fail(message) {
  console.error(`smoke-mcp-standalone: FAIL — ${message}`);
  if (stderr.trim()) console.error(`stderr: ${stderr.trim().slice(0, 500)}`);
  child.kill("SIGKILL");
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

try {
  const init = await rpc(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-mcp-standalone", version: "0.1.0" },
  });
  if (init.error) fail(`initialize 被拒绝：${JSON.stringify(init.error)}`);
  notify("notifications/initialized");

  const tools = await rpc(2, "tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  if (!names.includes("render_mindmap"))
    fail(`tools/list 缺少 render_mindmap（实际：${names.join(", ")}）`);

  const call = await rpc(3, "tools/call", {
    name: "render_mindmap",
    arguments: {
      outline: {
        text: "冒烟验证",
        children: [{ text: "分支 A" }, { text: "分支 B", children: [{ text: "子项" }] }],
      },
      outPath: outPng,
    },
  });
  const text = call.result?.content?.[0]?.text ?? "";
  const parsed = JSON.parse(text);
  if (!parsed.ok) fail(`render_mindmap 返回错误：${text}`);
  if (!existsSync(outPng) || statSync(outPng).size < 1024) fail(`PNG 产物缺失或过小：${outPng}`);
  // .mindmap 为紧凑 JSON，小文档仅数百字节；断言存在且非空即可。
  if (!existsSync(outSource) || statSync(outSource).size === 0)
    fail(`.mindmap 源文件缺失或为空：${outSource}`);
  console.log(
    `smoke-mcp-standalone: PASS（${parsed.format} ${parsed.bytes}B, nodes=${parsed.nodes}, layout=${parsed.layout}, source 已落盘）`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  child.kill("SIGKILL");
  rmSync(work, { recursive: true, force: true });
}
