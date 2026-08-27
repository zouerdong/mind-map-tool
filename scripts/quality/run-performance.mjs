// run-performance.mjs — 性能预算采样（MM-050/MM-090 消费）。
// --fixture dense-300-450 --scope canvas|save|export --platform macos|windows
// --output <evidence.json>；预算见 ADR 0006（批准后不得放宽）。
// fail-closed：无证据即失败，不用假数据填充。
//
// MM-050 canvas：真实 EditorCanvas harness（packages/ui/perf/canvas-perf-app）
// + dense-300-450 fixture + 真字体 FontResolver，headless Chromium 采样
// pan / nodeDrag / zoom 三场景 rAF 帧间隔 p50/p95/max（与 MM-010 Spike 同口径），
// 附 attribution probe（ADR 0002 G1：保留显示）。
// v1 平台范围：macOS（ADR 0001 G1 决定）；windows 参数 fail-closed。

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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

const HARNESS = resolve(ROOT, "packages/ui/perf/canvas-perf-app");
const FIXTURE_SRC = resolve(ROOT, `tests/fixtures/export/${fixture}.json`);

function staticServer(rootDir, port) {
  const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".otf": "font/otf",
    ".ttf": "font/ttf",
    ".svg": "image/svg+xml",
  };
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = resolve(rootDir, "." + urlPath);
      if (extname(filePath) === "") filePath = resolve(rootDir, "index.html");
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((done) => server.listen(port, () => done(server)));
}

function p(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

async function frameStats(page, run) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__stopFrames = false;
    const loop = (t) => {
      window.__frames.push(t);
      if (!window.__stopFrames) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await run();
  const frames = await page.evaluate(() => {
    window.__stopFrames = true;
    const f = window.__frames;
    window.__frames = [];
    return f;
  });
  const deltas = [];
  for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1]);
  if (deltas.length === 0) return { samples: 0 };
  return {
    samples: deltas.length,
    p50: +p(deltas, 0.5).toFixed(1),
    p95: +p(deltas, 0.95).toFixed(1),
    max: +Math.max(...deltas).toFixed(1),
    mean: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1),
  };
}

async function measureCanvas() {
  if (!existsSync(FIXTURE_SRC)) throw new Error(`fixture 不存在：${FIXTURE_SRC}`);
  // 1. 填充 harness public/（fixture + 字体）
  const pub = resolve(HARNESS, "public");
  mkdirSync(resolve(pub, "fonts"), { recursive: true });
  copyFileSync(FIXTURE_SRC, resolve(pub, `${fixture}.json`));
  for (const f of [
    ["noto-sans-sc-regular.otf"],
    ["noto-sans-sc-bold.otf"],
    ["lxgw-wenkai-regular.ttf"],
  ]) {
    copyFileSync(resolve(ROOT, `assets/fonts/${f[0]}`), resolve(pub, "fonts", f[0]));
  }

  // 2. build（vite bin 借 apps/desktop devDeps；harness config 零依赖可直接加载）
  execFileSync(
    "pnpm",
    ["--dir", resolve(ROOT, "apps/desktop"), "exec", "vite", "build", HARNESS],
    { cwd: ROOT, stdio: "pipe" },
  );
  const distAssets = resolve(HARNESS, "dist/assets");
  const jsFiles = readdirSync(distAssets).filter((f) => f.endsWith(".js"));
  const bundleBytes = (
    await Promise.all(jsFiles.map((f) => readFile(resolve(distAssets, f))))
  ).reduce((a, b) => a + b.length, 0);

  // 3. 静态服务 + headless Chromium 采样
  const PORT = 5295;
  const server = await staticServer(resolve(HARNESS, "dist"), PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
  await page.waitForTimeout(500); // 字体解析后的首帧稳定

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
        "Windows 采样缺失：无设备（R-013）；v1 macOS 先行（ADR 0001 G1 平台范围决定）",
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
