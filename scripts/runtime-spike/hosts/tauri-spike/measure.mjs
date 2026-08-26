// Tauri host track measurement (MM-010, macOS leg): mirrors the Electron
// spike protocol — cold start x5, RSS tree sampling, binary size,
// native export leg (resvg SVG->2x PNG with explicit font).

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = resolve(HERE, "../.."); // scripts/runtime-spike
const TMP = resolve(SPIKE, "../..", ".tmp/runtime-spike");
const OUT_DIR = resolve(TMP, "hosts");
const BIN = resolve(HERE, "src-tauri/target/release/tauri-spike");
const FONT = resolve(TMP, "fonts/noto-sans-sc-regular.otf");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function run({ env = {}, timeoutMs = 60000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const lines = [];
    const t0 = Date.now();
    const child = spawn(BIN, [], { env: { ...process.env, ...env } });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("timeout")); }, timeoutMs);
    child.stdout.on("data", (d) => {
      for (const line of String(d).split("\n")) {
        if (line.trim()) {
          lines.push({ t: Date.now() - t0, line: line.trim() });
          console.log(`  [+${lines.at(-1).t}ms] ${line.trim()}`);
        }
      }
    });
    child.on("exit", (code) => { clearTimeout(timer); resolvePromise({ code, lines, pid: child.pid }); });
  });
}

function rssOfTree(pid) {
  try {
    let total = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) || 0;
    let children = [];
    try {
      children = execFileSync("pgrep", ["-P", String(pid)]).toString().trim().split("\n").filter(Boolean);
    } catch {
      // pgrep exits 1 when the process has no children (Tauri main has none:
      // WKWebView WebContent is a system XPC service outside this tree)
    }
    for (const c of children) total += rssOfTree(Number(c));
    return total * 1024;
  } catch {
    return 0;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const results = { app: "tauri", platform: `${process.platform}/${process.arch}` };

// --- 1. cold start x5 ---
const coldStarts = [];
for (let i = 0; i < 5; i++) {
  const { lines } = await run({ env: { SPIKE_QUIT_AFTER_READY: "1" }, timeoutMs: 30000 });
  const ready = lines.find((l) => l.line.includes("renderer-ready"));
  if (ready) coldStarts.push(ready.t);
  await sleep(500);
}
const sorted = [...coldStarts].sort((a, b) => a - b);
results.coldStartMs = { runs: coldStarts, p50: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };

// --- 2. RSS tree sampling ---
{
  const t0 = Date.now();
  const child = spawn(BIN, [], { env: { ...process.env, SPIKE_HOLD: "12" } });
  const samples = [];
  child.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => console.log(`  [+${Date.now() - t0}ms] ${l.trim()}`)));
  await sleep(4000);
  for (let i = 0; i < 8; i++) {
    samples.push(rssOfTree(child.pid));
    await sleep(1000);
  }
  await new Promise((r) => child.on("exit", r));
  const stable = samples.slice(2).sort((a, b) => a - b);
  results.rssTreeBytes = { samples, stableP50: stable[Math.floor(stable.length / 2)] || null, note: "main+WebContent process tree via ps" };
}

// --- 3. binary size ---
results.binaryBytes = statSync(BIN).size;

// --- 4. native export leg (resvg, explicit font) ---
{
  const svgPath = resolve(TMP, "export/chinese-multiline.svg");
  const outPath = resolve(OUT_DIR, "tauri-native-chinese-multiline-2x.png");
  const { lines, code } = await run({
    env: { SPIKE_EXPORT_PNG: [svgPath, outPath, FONT, "2"].join("|") },
    timeoutMs: 45000,
  });
  const exportLine = lines.find((l) => l.line.includes("[export-png]"));
  results.nativePngExport = { ok: !!exportLine, exitCode: code, log: exportLine?.line ?? null };
  if (exportLine) {
    const [, ms, bytes] = exportLine.line.match(/\[export-png\] ([\d.]+)ms (\d+)B/);
    results.nativePngExport.ms = Number(ms);
    results.nativePngExport.bytes = Number(bytes);
    results.nativePngExport.sha256 = sha256(await readFile(outPath));
  }
}

results.gaps = [
  "20 次启动协议与 P95 统计未执行（MM-090）；本测量为 5 次中位数",
  ".app bundle（图标/Info.plist/DMG）体积在 MM-100 打包时实测；本数据为 release 二进制",
  "Finder 文件关联/UTI、IME、系统 DPI 矩阵需打包应用与人工矩阵",
];
results.generatedAt = new Date().toISOString();
const outPath2 = resolve(OUT_DIR, "tauri-metrics.json");
await writeFile(outPath2, JSON.stringify(results, null, 2) + "\n");
console.log(`report -> ${outPath2}`);
