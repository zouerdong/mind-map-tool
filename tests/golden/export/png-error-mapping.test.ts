// PRR-066 红灯 5：PNG renderer WASM 初始化/渲染失败必须返回稳定结构化错误
// （EXPORT_WASM_UNAVAILABLE + 底层 message），不得以裸异常冒泡成 UNKNOWN。
// 真实链路：production CSP 拒绝 WebAssembly 编译时 initWasm 抛 CompileError；
// 本测试以非法 wasm 字节复现“init 失败”同一异常路径。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDocument } from "@mindmap/core";
import { createExportRenderer } from "@mindmap/export";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

async function loadFonts() {
  const { readFile } = await import("node:fs/promises");
  const dir = resolve(ROOT, "assets/fonts");
  return {
    "noto-sans-sc-regular": new Uint8Array(
      await readFile(resolve(dir, "noto-sans-sc-regular.woff2")),
    ),
    "noto-sans-sc-bold": new Uint8Array(await readFile(resolve(dir, "noto-sans-sc-bold.woff2"))),
    "lxgw-wenkai-regular": new Uint8Array(
      await readFile(resolve(dir, "lxgw-wenkai-regular.woff2")),
    ),
  };
}

const realWasm = (() => {
  const req = createRequire(resolve(ROOT, "packages/export/package.json"));
  const pkgRoot = dirname(req.resolve("@resvg/resvg-wasm"));
  return new Uint8Array(readFileSync(resolve(pkgRoot, "index_bg.wasm")));
})();

function docWithNode() {
  const doc = emptyDocument();
  doc.document.nodes.push({
    id: "n-1",
    text: "PNG 错误映射",
    position: { x: 0, y: 0 },
    size: { width: 120, height: 40 },
  });
  return doc;
}

describe("PRR-066: PNG WASM 错误映射（EXPORT_WASM_UNAVAILABLE）", () => {
  it("未注入 wasm 字节：结构化错误而非异常", async () => {
    const renderer = await createExportRenderer({ fonts: await loadFonts() });
    const scene = renderer.buildScene(docWithNode());
    if (!scene.ok) throw new Error(`buildScene 失败：${scene.error.message}`);
    const svg = renderer.renderSvg(scene.scene);
    const result = await renderer.renderPng(svg, scene.scene);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXPORT_WASM_UNAVAILABLE");
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it("wasm init 失败（非法字节）：code 稳定且 message 保留底层原因", async () => {
    const garbageWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0xff, 0xff, 0xff, 0xff]);
    const renderer = await createExportRenderer({
      fonts: await loadFonts(),
      resvgWasm: garbageWasm,
    });
    const scene = renderer.buildScene(docWithNode());
    if (!scene.ok) throw new Error(`buildScene 失败：${scene.error.message}`);
    const svg = renderer.renderSvg(scene.scene);

    const result = await renderer.renderPng(svg, scene.scene);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 稳定 code：调用方/perf probe 依赖它区分 WASM 可用性，而不是 UNKNOWN
    expect(result.error.code).toBe("EXPORT_WASM_UNAVAILABLE");
    // 可审计：message 必须携带底层失败描述（不再吞掉 CompileError）
    expect(result.error.message.length).toBeGreaterThan(10);
    expect(result.error.message).toMatch(/resvg WASM|WebAssembly|wasm/i);
  });

  it("合法 wasm：正常路径不受错误映射影响（确定性 PNG 仍可产出）", async () => {
    const renderer = await createExportRenderer({ fonts: await loadFonts(), resvgWasm: realWasm });
    const scene = renderer.buildScene(docWithNode());
    if (!scene.ok) throw new Error(`buildScene 失败：${scene.error.message}`);
    const svg = renderer.renderSvg(scene.scene);
    const result = await renderer.renderPng(svg, scene.scene);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes[0]).toBe(0x89); // PNG magic
    expect(result.width).toBeGreaterThan(0);
  });
});
