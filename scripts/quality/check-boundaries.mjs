// check-boundaries.mjs — 架构边界 fail-closed 断言（MM-020 步骤⑦）。
// 读取 decision-register.json 的获选值，锁定依赖方向与禁项。
// 用法：node scripts/quality/check-boundaries.mjs --scope selected-canvas

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const scope = args.includes("--scope") ? args[args.indexOf("--scope") + 1] : "all";

const errors = [];
const fail = (m) => errors.push(m);

const register = JSON.parse(
  await readFile(resolve(ROOT, "docs/decisions/decision-register.json"), "utf8"),
);
const canvasChoice = register.tracks.canvasView?.recommended;
const hostChoice = register.tracks.desktopHost?.recommended;
const rendererChoice = register.tracks.exportRenderer?.recommended;

if (!["react-flow", "custom-react-view"].includes(canvasChoice))
  fail(`canvas recommendation 非法: ${canvasChoice}`);
if (hostChoice !== "tauri" && hostChoice !== "electron")
  fail(`host recommendation 非法: ${hostChoice}`);
if (rendererChoice !== "web-ts-wasm" && rendererChoice !== "native-host")
  fail(`renderer recommendation 非法: ${rendererChoice}`);

async function readPkg(rel) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}

const FORBIDDEN_IN_CORE = [
  "react",
  "react-dom",
  "@xyflow/react",
  "@tauri-apps/api",
  "vite",
  "electron",
];
const FORBIDDEN_IN_EXPORT = ["react", "react-dom", "@xyflow/react", "@tauri-apps/api"];
const FORBIDDEN_IN_PLATFORM = ["react", "react-dom", "@xyflow/react"];
const FORBIDDEN_IN_UI = ["@tauri-apps/api", "electron", "tauri"];
// ADR 0014：无头包与 MCP bridge 同为宿主适配层，禁 UI/桌面框架依赖
const FORBIDDEN_IN_HEADLESS = ["react", "react-dom", "@xyflow/react", "@tauri-apps/api"];
const FORBIDDEN_IN_MCP_BRIDGE = ["react", "react-dom", "@xyflow/react", "@tauri-apps/api"];

async function assertDeps(pkgRel, forbidden, label) {
  const pkg = await readPkg(pkgRel);
  if (!pkg) return fail(`${label}: package.json 缺失`);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const f of forbidden) {
    if (deps[f]) fail(`${label} 依赖了被禁包：${f}`);
  }
}

await assertDeps("packages/core/package.json", FORBIDDEN_IN_CORE, "packages/core");
await assertDeps("packages/export/package.json", FORBIDDEN_IN_EXPORT, "packages/export");
await assertDeps("packages/platform/package.json", FORBIDDEN_IN_PLATFORM, "packages/platform");
await assertDeps("packages/ui/package.json", FORBIDDEN_IN_UI, "packages/ui");
await assertDeps("packages/headless/package.json", FORBIDDEN_IN_HEADLESS, "packages/headless");
await assertDeps("apps/mcp-bridge/package.json", FORBIDDEN_IN_MCP_BRIDGE, "apps/mcp-bridge");

// source-level scan: banned imports in core/export/platform
const BANNED_IMPORT_PATTERNS = {
  "packages/core/src": [
    /from ["']react/,
    /from ["']@xyflow/,
    /from ["']@tauri-apps/,
    // 裸全局引用（前面不是 . 或标识符字符）——避免误伤 doc.document.xxx 领域字段
    /(?<![.\w])window\./,
    /(?<![.\w])document\./,
  ],
  "packages/export/src": [/from ["']react/, /from ["']@xyflow/, /from ["']@tauri-apps/],
  "packages/platform/src": [/from ["']react/, /from ["']@xyflow/],
};

async function scanSources() {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const walk = (dir) => {
    const out = [];
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
    }
    return out;
  };
  for (const [dir, patterns] of Object.entries(BANNED_IMPORT_PATTERNS)) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const text = readFileSync(file, "utf8");
      for (const re of patterns) {
        if (re.test(text)) fail(`${file} 含被禁模式 ${re}（${dir} 边界）`);
      }
    }
  }
}
await scanSources();

// scope: selected-canvas — 按 decision fail-closed 选择画布断言
if (scope === "selected-canvas") {
  if (canvasChoice === "react-flow") {
    // 允许并最终要求 @xyflow/react 只进入 ui/app 层（MM-050 落地时依赖出现）
    const uiPkg = await readPkg("packages/ui/package.json");
    const appPkg = await readPkg("apps/desktop/package.json");
    const hasFlow =
      uiPkg?.dependencies?.["@xyflow/react"] ?? appPkg?.dependencies?.["@xyflow/react"];
    // Bootstrap 阶段尚未引入（MM-050 引入）；此刻只断言它不在禁止层
    const corePkg = await readPkg("packages/core/package.json");
    if (corePkg?.dependencies?.["@xyflow/react"]) fail("core 不得依赖 @xyflow/react");
    void hasFlow;
  } else if (canvasChoice === "custom-react-view") {
    const all = [
      await readPkg("packages/ui/package.json"),
      await readPkg("apps/desktop/package.json"),
    ];
    for (const pkg of all) {
      if (pkg?.dependencies?.["@xyflow/react"] || pkg?.devDependencies?.["@xyflow/react"]) {
        fail("decision=custom-react-view 但依赖图中存在 @xyflow/react");
      }
    }
  }
  console.log(`selected-canvas=${canvasChoice} 断言完成`);
}

if (errors.length) {
  console.error(`check-boundaries [${scope}]: FAIL`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `check-boundaries [${scope}]: PASS (host=${hostChoice} canvas=${canvasChoice} renderer=${rendererChoice})`,
);
