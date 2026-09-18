// build-mcp-standalone.mjs — 把 MCP bridge 打包成单文件 ESM（ADR 0018）。
// 字体（woff2）与 resvg WASM 经 binary loader 内嵌，产物零 fs/node_modules
// 依赖，可由随安装包分发的 Node 独立运行时直接执行。
// 用法：node scripts/build-mcp-standalone.mjs
// 产物：apps/mcp-bridge/dist/mindmap-mcp.mjs

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(REPO_ROOT, "apps/mcp-bridge/dist");
mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: [resolve(REPO_ROOT, "apps/mcp-bridge/src/server-standalone.ts")],
  outfile: resolve(OUT_DIR, "mindmap-mcp.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  minify: false,
  loader: {
    ".woff2": "binary",
    ".wasm": "binary",
  },
  logLevel: "info",
});

if (result.errors.length > 0) {
  console.error("build-mcp-standalone: FAIL");
  process.exit(1);
}
console.log("build-mcp-standalone: OK → apps/mcp-bridge/dist/mindmap-mcp.mjs");
