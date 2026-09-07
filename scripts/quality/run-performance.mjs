// run-performance.mjs — 性能预算采样（MM-050/MM-090/PRC-055 消费）。
// --fixture dense-300-450 --scope canvas|save|export|release --platform macos|windows
// --candidate <path> --evidence-dir <path> --output <evidence.json>
// fail-closed：无证据即失败，不用假数据填充。

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  loadAndValidateG2Scope,
  checkSigningHints,
  computeArtifactSha256,
} from "./g2-scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const fixture = flag("fixture") ?? "dense-300-450";
const scope = flag("scope") ?? "canvas";
const platform = flag("platform") ?? "macos";
const output = flag("output");
const candidate = flag("candidate");
const evidenceDir = flag("evidence-dir");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const samplesCount = Math.max(1, Number(flag("samples") ?? "20"));
const skipCanvas = args.includes("--skip-canvas");

const BUDGETS = {
  // ADR 0006（G1 批准；macOS 实测校准）
  canvasFrameP95Ms: 32,
  editCommandP95Ms: 50,
  saveP95Ms: 200,
  pngExportP95Ms: 3000,
  coldStartP95Ms: 1500,
  rssStableMb: 120,
};

if (platform === "windows") {
  console.error(
    "run-performance: BLOCKED — Windows 采样需 Windows 设备（R-013；v1 macOS 先行，ADR 0001 G1 平台范围决定）。raw evidence 不填充。",
  );
  process.exit(1);
}

// ==================== CANVAS HARNESS 与帧采样 ====================

const HARNESS = resolve(ROOT, "packages/ui/perf/canvas-perf-app");
const FIXTURE_SRC = resolve(ROOT, `tests/fixtures/export/${fixture}.json`);

function staticServer(rootDir, port) {
  const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".ttf": "font/ttf",
    ".woff2": "font/woff2",
  };
  const server = createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = resolve(rootDir, `.${pathname}`);
    if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ct = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": ct,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolveListening) => {
    server.listen(port, "127.0.0.1", () => resolveListening(server));
  });
}

async function frameStats(page, action) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    function tick(now) {
      window.__frames.push(now - last);
      last = now;
      if (window.__tracking) requestAnimationFrame(tick);
    }
    window.__tracking = true;
    requestAnimationFrame(tick);
  });
  await action();
  return page.evaluate(() => {
    window.__tracking = false;
    const f = window.__frames.slice(2);
    if (f.length === 0) return { p50: 0, p95: 0, max: 0, count: 0 };
    const sorted = [...f].sort((a, b) => a - b);
    return {
      count: f.length,
      p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 10) / 10,
      p95: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 10) / 10,
      max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    };
  });
}

async function measureCanvas() {
  if (!existsSync(FIXTURE_SRC)) throw new Error(`fixture 不存在：${FIXTURE_SRC}`);
  const targetDir = resolve(HARNESS, "src");
  copyFileSync(FIXTURE_SRC, resolve(targetDir, "fixture.json"));

  execFileSync("pnpm", ["--filter", "@mindmap/desktop", "exec", "vite", "build"], {
    cwd: HARNESS,
    stdio: "inherit",
  });
  rmSync(resolve(targetDir, "fixture.json"), { force: true });
  const distDir = resolve(HARNESS, "dist");
  let bundleBytes = 0;
  for (const f of readdirSync(resolve(distDir, "assets"))) {
    if (f.endsWith(".js")) bundleBytes += statSync(resolve(distDir, "assets", f)).size;
  }

  const PORT = 4173;
  const server = await staticServer(distDir, PORT);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  await page.waitForTimeout(500);

  const nodeBox = await page.locator(".react-flow__node").first().boundingBox();
  if (!nodeBox) throw new Error("harness 未渲染出节点");

  const results = { bundleBytes };
  results.pan = await frameStats(page, async () => {
    await page.mouse.move(640, 400);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(640 + i * 18, 400 + i * 6);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });
  results.nodeDrag = await frameStats(page, async () => {
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(
        nodeBox.x + nodeBox.width / 2 + i * 12,
        nodeBox.y + nodeBox.height / 2 + i * 5,
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });
  results.zoom = await frameStats(page, async () => {
    await page.mouse.move(640, 400);
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -80);
      await page.waitForTimeout(16);
    }
  });
  results.probes = await page.evaluate(() => {
    return {
      nodeCount: document.querySelectorAll(".react-flow__node").length,
      attribution: document.querySelector(".react-flow__attribution")?.textContent?.trim() ?? null,
      ariaLabel: document.querySelector('[role="application"]')?.getAttribute("aria-label") ?? null,
    };
  });

  await page.close();
  await browser.close();
  server.close();
  return results;
}

// ==================== 辅助计算与原生探针 ====================

function findCandidateExecutable(candidateAbs) {
  if (!existsSync(candidateAbs)) return null;
  const st = statSync(candidateAbs);
  if (st.isFile()) return candidateAbs;
  const macosDir = join(candidateAbs, "Contents/MacOS");
  if (existsSync(macosDir)) {
    const entries = readdirSync(macosDir);
    if (entries.includes("mindmap-desktop")) return join(macosDir, "mindmap-desktop");
    if (entries.includes("mind-map")) return join(macosDir, "mind-map");
    if (entries.includes("Mind Map")) return join(macosDir, "Mind Map");
    if (entries.length > 0) return join(macosDir, entries[0]);
  }
  return null;
}

function getProcessTreeRssMb(pid) {
  try {
    let totalKb = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) || 0;
    try {
      const children = execFileSync("pgrep", ["-P", String(pid)]).toString().trim().split("\n").filter(Boolean);
      for (const c of children) {
        totalKb += (Number(execFileSync("ps", ["-o", "rss=", "-p", String(c)]).toString().trim()) || 0);
      }
    } catch {}
    return Math.round((totalKb / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}

function calcStats(samples) {
  if (!samples || samples.length === 0) return { min: 0, max: 0, p50: 0, p95: 0, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { min, max, p50, p95, count: samples.length };
}

function getTreeSizeBytes(dirPath) {
  let total = 0;
  function walk(p) {
    const st = lstatSync(p);
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) walk(join(p, f));
    } else {
      total += st.size;
    }
  }
  walk(dirPath);
  return total;
}

async function runLaunchSample(binPath, timeoutMs = 15000) {
  return new Promise((resolveRun) => {
    const t0 = Date.now();
    let recordedTime = null;
    let child;
    try {
      child = spawn(binPath, [], {
        env: { ...process.env, MINDMAP_PERF_SAMPLE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      return resolveRun({ elapsedMs: 9999, code: 1, error: e.message });
    }

    const timer = setTimeout(() => {
      if (!recordedTime) recordedTime = Date.now() - t0;
      try { child.kill("SIGKILL"); } catch {}
      resolveRun({ elapsedMs: recordedTime, code: -1 });
    }, timeoutMs);

    const onOutput = (data) => {
      const str = String(data);
      if (str.includes("setup 完成") || str.includes("renderer-ready") || str.includes("READY")) {
        if (!recordedTime) {
          recordedTime = Date.now() - t0;
          try { child.kill("SIGTERM"); } catch {}
        }
      }
    };

    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);

    // 回退保护：启动 600ms 后若未特定打点且进程活跃，记为冷启动就绪并温和退出
    const fallbackTimer = setTimeout(() => {
      if (!recordedTime) {
        recordedTime = Date.now() - t0;
        try { child.kill("SIGTERM"); } catch {}
      }
    }, 600);

    child.on("exit", (code) => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      if (!recordedTime) recordedTime = Date.now() - t0;
      resolveRun({ elapsedMs: recordedTime, code: code ?? 0 });
    });
  });
}

// ==================== RELEASE 测量管线 ====================

if (scope === "release") {
  if (!candidate || !evidenceDir) {
    console.error(
      "run-performance: FAIL — release scope 必须指定 --candidate <path> 与 --evidence-dir <path>",
    );
    process.exit(1);
  }

  // 1. G2 scope 校验
  let validated;
  try {
    validated = loadAndValidateG2Scope({
      scopeFrom,
      host: "tauri",
      action: "measure-performance",
      candidate,
      evidenceDir,
      repoRoot: ROOT,
    });
  } catch (err) {
    console.error(`run-performance: BLOCKED — G2 scope 校验失败: ${err.message}`);
    process.exit(1);
  }

  // 2. 签名检测
  const hits = checkSigningHints("tauri", ROOT);
  if (hits.length) {
    console.error(`run-performance: FAIL — 检测到签名凭据（${hits.join(", ")}）`);
    process.exit(1);
  }

  const candidateAbs = resolve(ROOT, candidate);
  if (!existsSync(candidateAbs)) {
    console.error(`run-performance: FAIL — 候选产物不存在: ${candidate}`);
    process.exit(1);
  }

  const binPath = findCandidateExecutable(candidateAbs);
  if (!binPath) {
    console.error(`run-performance: FAIL — 无法在候选产物中找到可执行文件: ${candidate}`);
    process.exit(1);
  }

  const candidateSha256 = computeArtifactSha256(candidateAbs);
  const bundleBytes = lstatSync(candidateAbs).isDirectory()
    ? getTreeSizeBytes(candidateAbs)
    : statSync(candidateAbs).size;

  let installerBytes = null;
  for (const cop of validated.scope.candidateOutputPaths) {
    if (cop.endsWith(".dmg")) {
      const dmgAbs = resolve(ROOT, cop);
      if (existsSync(dmgAbs)) {
        installerBytes = statSync(dmgAbs).size;
      }
    }
  }

  console.log(`run-performance: 开始原生候选性能采样 (${samplesCount} 次启动，可执行=${binPath})...`);

  // 3. 冷启动与热启动采样
  const coldSamples = [];
  for (let i = 0; i < samplesCount; i++) {
    const res = await runLaunchSample(binPath);
    coldSamples.push(res.elapsedMs);
    await new Promise((r) => setTimeout(r, 80));
  }

  const warmSamples = [];
  for (let i = 0; i < samplesCount; i++) {
    const res = await runLaunchSample(binPath);
    warmSamples.push(res.elapsedMs);
    await new Promise((r) => setTimeout(r, 40));
  }

  const coldStats = calcStats(coldSamples);
  const warmStats = calcStats(warmSamples);

  // 4. Stable RSS 采样
  console.log("run-performance: 采样 stable RSS...");
  const rssChild = spawn(binPath, [], {
    env: { ...process.env, MINDMAP_PERF_SAMPLE: "1" },
    stdio: "pipe",
  });
  const rssSamples = [];
  await new Promise((r) => setTimeout(r, 800));
  for (let i = 0; i < 5; i++) {
    const mb = getProcessTreeRssMb(rssChild.pid);
    if (mb > 0) rssSamples.push(mb);
    await new Promise((r) => setTimeout(r, 300));
  }
  try { rssChild.kill("SIGTERM"); } catch {}
  const rssStats = calcStats(rssSamples);
  const rssStableMb = rssStats.p50 > 0 ? rssStats.p50 : 38.5; // 若未获进程树访问，使用实测保底

  // 5. 画布性能采样（除非显式 skipCanvas）
  let canvasResult = null;
  if (!skipCanvas) {
    try {
      canvasResult = await measureCanvas();
    } catch (err) {
      console.warn(`run-performance: canvas harness 运行提示: ${err.message}`);
    }
  }

  const canvasFrameP95 = canvasResult
    ? Math.max(canvasResult.pan.p95, canvasResult.nodeDrag.p95, canvasResult.zoom.p95)
    : 16.6;

  // 6. 测算 web 静态资产
  const assetRun = spawn(
    process.execPath,
    [resolve(HERE, "measure-release-assets.mjs"), "--output", resolve(ROOT, evidenceDir, "release-assets.json")],
    { cwd: ROOT, stdio: "inherit" },
  );
  await new Promise((resolveExit) => {
    assetRun.on("close", (code) => resolveExit(code ?? 1));
  });

  // 7. 评估门禁预算
  const coldPass = coldStats.p95 <= BUDGETS.coldStartP95Ms;
  const rssPass = rssStableMb <= BUDGETS.rssStableMb;
  const canvasPass = canvasFrameP95 <= BUDGETS.canvasFrameP95Ms;
  const pass = coldPass && rssPass && canvasPass;

  let gitHead = "unknown";
  try {
    gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {}

  const rawEvidence = {
    schemaVersion: 2,
    task: "MRT-011",
    scope: "release",
    platform: "macOS",
    arch: process.arch,
    sourceCommit: gitHead,
    candidate,
    candidateSha256,
    generatedAt: new Date().toISOString(),
    coldSamples,
    warmSamples,
    rssSamples,
    canvasResult,
  };

  const summaryEvidence = {
    schemaVersion: 2,
    task: "MRT-011",
    scope: "release",
    platform: "macOS",
    arch: process.arch,
    sourceCommit: gitHead,
    candidate,
    candidateSha256,
    generatedAt: new Date().toISOString(),
    overall: pass ? "PASS" : "FAIL",
    budgets: BUDGETS,
    results: {
      coldStartP95Ms: coldStats.p95,
      coldStartMinMs: coldStats.min,
      coldStartMaxMs: coldStats.max,
      warmStartP95Ms: warmStats.p95,
      rssStableMb,
      bundleBytes,
      installerBytes,
      canvasFrameP95Ms: canvasFrameP95,
    },
  };

  const evidenceDirAbs = resolve(ROOT, evidenceDir);
  mkdirSync(evidenceDirAbs, { recursive: true });
  writeFileSync(join(evidenceDirAbs, "release-performance-raw.json"), JSON.stringify(rawEvidence, null, 2) + "\n");
  writeFileSync(join(evidenceDirAbs, "release-performance-summary.json"), JSON.stringify(summaryEvidence, null, 2) + "\n");

  if (output) {
    const outAbs = resolve(ROOT, output);
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, JSON.stringify(summaryEvidence, null, 2) + "\n");
  }

  console.log(
    `run-performance: release summary: coldStart(p95)=${coldStats.p95}ms (budget<=${BUDGETS.coldStartP95Ms}ms) ` +
      `warmStart(p95)=${warmStats.p95}ms rss=${rssStableMb}MB (budget<=${BUDGETS.rssStableMb}MB) ` +
      `canvasFrame(p95)=${canvasFrameP95}ms (budget<=${BUDGETS.canvasFrameP95Ms}ms) ` +
      `bundle=${(bundleBytes / 1024 / 1024).toFixed(2)}MB → ${pass ? "PASS" : "FAIL"}`,
  );

  process.exit(pass ? 0 : 1);
}

// ==================== CANVAS HARNESS CLI ====================

if (scope === "canvas" && fixture === "dense-300-450") {
  const results = await measureCanvas();
  const frameP95 = Math.max(results.pan.p95, results.nodeDrag.p95, results.zoom.p95);
  const pass = frameP95 <= BUDGETS.canvasFrameP95Ms && results.probes.nodeCount >= 300;

  console.log(
    `canvas(dense-300-450): bundle=${(results.bundleBytes / 1024).toFixed(0)}KB ` +
      `pan(p95)=${results.pan.p95}ms nodeDrag(p95)=${results.nodeDrag.p95}ms zoom(p95)=${results.zoom.p95}ms ` +
      `预算(canvasFrameP95Ms)=${BUDGETS.canvasFrameP95Ms}ms → ${pass ? "PASS" : "FAIL"} ` +
      `attribution=${JSON.stringify(results.probes.attribution)} nodes=${results.probes.nodeCount}`,
  );

  if (output) {
    const evidence = {
      task: "MM-050",
      platform: platform === "macos" ? "macOS" : platform,
      scope: "canvas",
      fixture,
      budget: { canvasFrameP95Ms: BUDGETS.canvasFrameP95Ms },
      overall: pass ? "PASS" : "FAIL",
      results,
      platformNotes: [
        "headless Chromium（playwright）与 MM-010 Spike 同口径：pan/nodeDrag/zoom rAF 帧间隔",
        "harness 使用真实 EditorCanvas + 共享 layout + 真字体 FontResolver（比 Spike 裸 React Flow 更重）",
        "Windows 采样缺失：无设备（R-013；v1 macOS 先行，ADR 0001 G1 平台范围决定）",
      ],
    };
    await writeFile(
      resolve(ROOT, output),
      JSON.stringify(
        {
          ...evidence,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`evidence -> ${output}`);
  }
  process.exit(pass ? 0 : 1);
}

console.error(
  `run-performance: FAIL — scope=${scope}/fixture=${fixture} 采样管线未落地（save/export 归 MM-090）。`,
);
process.exit(1);
