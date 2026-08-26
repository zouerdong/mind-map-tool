// Canvas track measurement (MM-010): React Flow vs custom SVG view.
// Same fixture (dense-300-450), same browser (Playwright Chromium headless),
// same scripted interactions: canvas pan / node drag / wheel zoom.
// Outputs frame-time P50/P95/max per scenario + bundle size + a11y/attribution probes.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = resolve(HERE, "..");
const ROOT = resolve(SPIKE, "../..");
const TMP = resolve(ROOT, ".tmp/runtime-spike");
const OUT_DIR = resolve(TMP, "canvas");

const APPS = [
  { id: "react-flow", dir: resolve(HERE, "react-flow-app"), port: 5191 },
  { id: "custom-react-view", dir: resolve(HERE, "custom-view-app"), port: 5192 },
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

function staticServer(rootDir, port) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = resolve(rootDir, "." + urlPath);
      if (extname(filePath) === "") filePath = resolve(rootDir, "index.html");
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
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
    const loop = (t) => { window.__frames.push(t); if (!window.__stopFrames) requestAnimationFrame(loop); };
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

async function measureApp(app, browser) {
  // build + bundle size
  execFileSync("npx", ["vite", "build"], { cwd: app.dir, stdio: "pipe" });
  const distAssets = resolve(app.dir, "dist/assets");
  const jsFiles = readdirSync(distAssets).filter((f) => f.endsWith(".js"));
  const bundleBytes = (await Promise.all(jsFiles.map((f) => readFile(resolve(distAssets, f))))).reduce((a, b) => a + b.length, 0);

  const server = await staticServer(resolve(app.dir, "dist"), app.port);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${app.port}/`);
  await page.waitForFunction(() => window.__READY === true, { timeout: 15000 });
  await page.waitForTimeout(300);

  // locate a node to drag (middle of the viewport-ish): query both DOM shapes
  const nodeSelector = app.id === "react-flow" ? ".react-flow__node" : "g[role='button']";
  const nodeBox = await page.locator(nodeSelector).first().boundingBox();
  if (!nodeBox) throw new Error("no node found for " + app.id);

  const results = { app: app.id, bundleBytes };

  // 1. canvas pan
  results.pan = await frameStats(page, async () => {
    await page.mouse.move(640, 400);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(640 + i * 18, 400 + i * 6);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });

  // 2. node drag
  results.nodeDrag = await frameStats(page, async () => {
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(nodeBox.x + nodeBox.width / 2 + i * 12, nodeBox.y + nodeBox.height / 2 + i * 5);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });

  // 3. wheel zoom
  results.zoom = await frameStats(page, async () => {
    await page.mouse.move(640, 400);
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -80);
      await page.waitForTimeout(16);
    }
  });

  // probes: a11y surface + (react-flow) attribution
  results.probes = await page.evaluate((sel) => {
    const focusable = document.querySelectorAll("[tabindex],button,input,select,a[href]").length;
    const roles = document.querySelectorAll("[role]").length;
    const attribution = document.querySelector(".react-flow__attribution")?.textContent?.trim() ?? null;
    const nodeCount = document.querySelectorAll(sel).length;
    return { focusable, roles, attribution, nodeCount };
  }, nodeSelector);

  await page.close();
  server.close();
  return results;
}

mkdirSync(OUT_DIR, { recursive: true });
// stage fixture into each app's public/
for (const app of APPS) {
  mkdirSync(resolve(app.dir, "public"), { recursive: true });
  copyFileSync(resolve(TMP, "fixtures/dense-300-450.json"), resolve(app.dir, "public/dense-300-450.json"));
}

const browser = await chromium.launch();
const all = [];
for (const app of APPS) {
  const r = await measureApp(app, browser);
  all.push(r);
  console.log(
    `${r.app}: bundle=${(r.bundleBytes / 1024).toFixed(0)}KB ` +
    `pan(p95)=${r.pan.p95}ms nodeDrag(p95)=${r.nodeDrag.p95}ms zoom(p95)=${r.zoom.p95}ms ` +
    `attribution=${JSON.stringify(r.probes.attribution)}`
  );
}
await browser.close();

const report = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  environment: "playwright chromium headless, viewport 1280x800, production vite build",
  gaps: ["IME 组合输入与真实 WebView（WKWebView/WebView2）帧行为需 host 轨/人工矩阵补测"],
  results: all,
};
await writeFile(resolve(OUT_DIR, "canvas-metrics.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`report -> ${resolve(OUT_DIR, "canvas-metrics.json")}`);
