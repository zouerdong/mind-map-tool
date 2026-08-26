// Electron host track measurement (MM-010, macOS leg).
// Uses marker files (not stdout) for ready/export signals — robust against
// macOS GUI-process stdout routing.

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = resolve(HERE, "../.."); // scripts/runtime-spike
const TMP = resolve(SPIKE, "../..", ".tmp/runtime-spike");
const OUT_DIR = resolve(TMP, "hosts");
const BIN = resolve(SPIKE, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function waitFor(file, timeoutMs) {
  const t0 = Date.now();
  return new Promise((done, reject) => {
    const iv = setInterval(() => {
      if (existsSync(file)) { clearInterval(iv); done(Date.now() - t0); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error("marker timeout")); }
    }, 20);
  });
}

function rssOfTree(pid) {
  try {
    let total = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) || 0;
    let children = [];
    try {
      children = execFileSync("pgrep", ["-P", String(pid)]).toString().trim().split("\n").filter(Boolean);
    } catch {
      // pgrep exits 1 when there are no children
    }
    for (const c of children) total += rssOfTree(Number(c));
    return total * 1024;
  } catch {
    return 0;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const results = { app: "electron", platform: `${process.platform}/${process.arch}`, node: process.version };

// --- 1. cold start x5 via ready-marker file ---
const coldStarts = [];
for (let i = 0; i < 5; i++) {
  const marker = resolve(TMP, `debug/electron-ready-${i}.json`);
  rmSync(marker, { force: true });
  const t0 = Date.now();
  const child = spawn(BIN, [HERE], { env: { ...process.env, SPIKE_QUIT_AFTER_READY: "1", SPIKE_READY_FILE: marker }, stdio: "ignore" });
  try {
    await waitFor(marker, 25000);
    coldStarts.push(Date.now() - t0);
    console.log(`  run ${i + 1}: ${coldStarts.at(-1)}ms`);
  } catch {
    console.log(`  run ${i + 1}: TIMEOUT`);
  }
  await new Promise((r) => child.on("exit", r));
  await sleep(400);
}
const sorted = [...coldStarts].sort((a, b) => a - b);
results.coldStartMs = { runs: coldStarts, p50: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };

// --- 2. RSS tree sampling (hold 14s, sample 5..12s) ---
{
  const child = spawn(BIN, [HERE], { env: { ...process.env, SPIKE_HOLD: "14" }, stdio: "ignore" });
  const exitPromise = new Promise((r) => child.on("exit", r));
  const samples = [];
  await sleep(4500);
  for (let i = 0; i < 8; i++) {
    samples.push(rssOfTree(child.pid));
    await sleep(1000);
  }
  await exitPromise;
  const stable = samples.slice(2).sort((a, b) => a - b);
  results.rssTreeBytes = {
    samples,
    stableP50: stable[Math.floor(stable.length / 2)] || null,
    note: "main+GPU+utility process tree via ps; ~4.5s settle excluded",
  };
}

// --- 3. framework size on disk ---
try {
  const appBundle = resolve(SPIKE, "node_modules/electron/dist/Electron.app");
  results.frameworkDiskKb = Number(execFileSync("du", ["-sk", appBundle]).toString().trim().split("\t")[0]);
} catch { results.frameworkDiskKb = null; }

// --- 4. native PDF export leg (webContents.printToPDF on canonical SVG) ---
{
  const svgPath = resolve(TMP, "export/chinese-multiline.svg");
  const svg = await readFile(svgPath, "utf8");
  const w = Number(svg.match(/width="(\d+)"/)[1]);
  const h = Number(svg.match(/height="(\d+)"/)[1]);
  const outPath = resolve(OUT_DIR, "electron-native-chinese-multiline.pdf");
  const resultFile = resolve(TMP, "debug/electron-export-result.json");
  rmSync(resultFile, { force: true });
  const child = spawn(BIN, [HERE], {
    env: {
      ...process.env,
      SPIKE_EXPORT_PDF: JSON.stringify({ svgPath, outPath, width: w, height: h }),
      SPIKE_EXPORT_RESULT_FILE: resultFile,
    },
    stdio: "ignore",
  });
  await new Promise((r) => child.on("exit", r));
  let exportInfo = { ok: false };
  if (existsSync(resultFile)) exportInfo = JSON.parse(readFileSync(resultFile, "utf8"));
  results.nativePdfExport = { ...exportInfo };
  if (exportInfo.ok && existsSync(outPath)) {
    results.nativePdfExport.sha256 = sha256(await readFile(outPath));
  }
}

results.gaps = [
  "20 次启动协议与 P95 统计未执行（MM-090）；本测量为 5 次中位数",
  "Finder 文件关联/UTI、IME、系统 DPI 矩阵需打包应用与人工矩阵",
  "second-instance 路由代码已具备，自动验证待 Windows 腿",
];
results.generatedAt = new Date().toISOString();
const outPath2 = resolve(OUT_DIR, "electron-metrics.json");
await writeFile(outPath2, JSON.stringify(results, null, 2) + "\n");
console.log(`cold p50=${results.coldStartMs.p50}ms rss=${(results.rssTreeBytes.stableP50 / 1048576).toFixed(0)}MB framework=${(results.frameworkDiskKb / 1024).toFixed(0)}MB nativePdf=${results.nativePdfExport.ok ? results.nativePdfExport.ms + "ms" : "FAIL"}`);
console.log(`report -> ${outPath2}`);
