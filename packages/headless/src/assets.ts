// assets.ts — Node 宿主的字体/WASM 字节注入（ADR 0014 §1：宿主注入，
// 与 tests/golden/export/export-fixtures.ts 同款加载路径，保证渲染同源）。

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FontBundle } from "@mindmap/export";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

/** 三款字体字节（woff2 与 GUI/golden 同源文件）。fontsDir 缺省 assets/fonts。 */
export function loadFontBundle(fontsDir: string = resolve(REPO_ROOT, "assets/fonts")): FontBundle {
  const read = (name: string) => new Uint8Array(readFileSync(resolve(fontsDir, name)));
  return {
    "noto-sans-sc-regular": read("noto-sans-sc-regular.woff2"),
    "noto-sans-sc-bold": read("noto-sans-sc-bold.woff2"),
    "lxgw-wenkai-regular": read("lxgw-wenkai-regular.woff2"),
  };
}

/** resvg WASM 二进制；从 @mindmap/export 的依赖上下文解析（pnpm 布局）。 */
export function loadResvgWasm(): Uint8Array {
  const req = createRequire(resolve(REPO_ROOT, "packages/export/package.json"));
  const pkgRoot = dirname(req.resolve("@resvg/resvg-wasm"));
  return new Uint8Array(readFileSync(resolve(pkgRoot, "index_bg.wasm")));
}
