// measure-release-assets.mjs — MRT-011 web 产物预算测量。
// 只读取已经生成的 apps/desktop/dist，不触发 Tauri 打包或安装。
// 原生冷/热启动、RSS、安装包大小必须在获批的 unsigned candidate 上另测。

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DIST = resolve(ROOT, "apps/desktop/dist");
const args = process.argv.slice(2);
const outputIdx = args.indexOf("--output");
const output = outputIdx === -1 ? null : args[outputIdx + 1];

const BUDGETS = {
  initialEntryJsBytes: 500_000,
  initialHtmlScriptCount: 1,
};

function fail(message) {
  console.error(`measure-release-assets: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(DIST)) fail(`构建目录不存在：${relative(ROOT, DIST)}（先 pnpm build）`);

const html = await readFile(resolve(DIST, "index.html"), "utf8");
const entryScripts = [
  ...html.matchAll(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/g),
].map((m) => m[1]);
if (entryScripts.length !== BUDGETS.initialHtmlScriptCount) {
  fail(`index.html module script 数量 ${entryScripts.length} != ${BUDGETS.initialHtmlScriptCount}`);
}

const entryPath = resolve(DIST, entryScripts[0].replace(/^\//, ""));
if (!existsSync(entryPath)) fail(`entry script 不存在：${entryScripts[0]}`);

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(abs)));
    else files.push(abs);
  }
  return files;
}

const files = await filesUnder(DIST);
const assets = [];
for (const file of files) {
  const info = await stat(file);
  assets.push({ path: relative(ROOT, file), bytes: info.size });
}
assets.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

const js = assets.filter((asset) => asset.path.endsWith(".js"));
const wasm = assets.filter((asset) => asset.path.endsWith(".wasm"));
const fonts = assets.filter((asset) => /\.(otf|ttf|woff2?)$/i.test(asset.path));
const entry = assets.find((asset) => asset.path === relative(ROOT, entryPath));
const initialHtmlCss = assets.filter((asset) => asset.path.endsWith(".css"));

const result = {
  schemaVersion: 1,
  task: "MRT-011",
  generatedAt: new Date().toISOString(),
  buildType: "web-dist-only",
  dist: relative(ROOT, DIST),
  budgets: BUDGETS,
  entry: {
    path: entry.path,
    bytes: entry.bytes,
    pass: entry.bytes <= BUDGETS.initialEntryJsBytes,
    htmlModuleScripts: entryScripts,
    blockingCssBytes: initialHtmlCss.reduce((sum, asset) => sum + asset.bytes, 0),
  },
  assets: {
    javascript: js,
    wasm,
    fonts,
    totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    all: assets,
  },
  loadingContract: {
    fontsAndWasmReferencedAsViteUrls: true,
    rendererWarmupAfterFirstPaint: true,
    pngAndPdfImplementationsDynamicallyImported: true,
    nativeInstallerMeasured: false,
    nativeStartupAndRssMeasured: false,
  },
  unmeasured: [
    "Tauri unsigned .app/.dmg size",
    "cold start p95",
    "warm start p95",
    "stable RSS",
    "dense canvas native WebView sample",
  ],
  overall:
    entry.bytes <= BUDGETS.initialEntryJsBytes ? "PASS_WITH_NATIVE_MEASUREMENTS_PENDING" : "FAIL",
};

console.log(
  `entry=${entry.path} ${(entry.bytes / 1024).toFixed(1)}KB ` +
    `js=${js.length} wasm=${wasm.length} fonts=${fonts.length} ` +
    `→ ${result.overall}`,
);
console.log(
  "measure-release-assets: native installer/startup/RSS remain unmeasured until G2 scope is approved",
);

if (output) {
  const outputPath = resolve(ROOT, output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`asset evidence -> ${output}`);
}

if (result.overall === "FAIL") process.exit(1);
