// 导出 golden 三层断言（MM-040 ⑤）：
// 1) 语义 golden：canonical SVG sha256（跨平台一致层）
// 2) 视觉 golden：固定 renderer/font 的 2x PNG sha256 + 尺寸精确
// 3) PDF golden：pdf-lib bytes sha256（单页适合内容）
// 确定性：全部双构建比对（同进程重建 hash 必须一致）。
// 更新 golden：REGEN=1 npx vitest run tests/golden/export（变更报告中必须列明原因）。

import { beforeAll, describe, expect, it } from "vitest";
import {
  renderAll,
  loadManifest,
  manifestExists,
  writeFixturesAndManifest,
} from "./export-fixtures.js";

const renderAllCached = (() => {
  let p: ReturnType<typeof renderAll> | null = null;
  return () => (p ??= renderAll());
})();

let results: Record<string, Record<string, unknown>>;
let results2: Record<string, Record<string, unknown>>;

beforeAll(async () => {
  const first = await renderAll();
  const second = await renderAll(); // 确定性对照
  results = first.results;
  results2 = second.results;
  // REGEN=1：重写夹具与 golden 清单（变更报告中必须列明原因）；
  // 无清单时首次生成并提示重跑验证。
  const hadManifest = manifestExists();
  if (process.env.REGEN === "1" || !hadManifest) {
    writeFixturesAndManifest(first.fixtures, results);
    if (!hadManifest) throw new Error("golden 清单不存在——已首次生成，请重跑测试验证。");
  }
});

describe("导出 golden", () => {
  const CASES = [
    "empty-document",
    "two-linked-nodes",
    "negative-coordinates",
    "chinese-multiline",
    "dark-theme",
    "frames-hidden",
    "ellipse-shape",
    "lxgw-font",
    "missing-glyph",
    "dense-300-450",
    "large-bounds",
  ];

  it("夹具清单覆盖全部用例", () => {
    for (const c of CASES) expect(results[c], c).toBeDefined();
  });

  it("空文档：EXPORT_EMPTY_DOCUMENT，不产 SVG/PNG/PDF", () => {
    expect(results["empty-document"]!.error).toBe("EXPORT_EMPTY_DOCUMENT");
  });

  it("large-bounds：PNG 前置拒绝 EXPORT_SIZE_LIMIT；SVG/PDF 正常", () => {
    expect(results["large-bounds"]!.pngError).toBe("EXPORT_SIZE_LIMIT");
    expect(typeof results["large-bounds"]!.svgSha256).toBe("string");
  });

  it("missing-glyph：SVG/PNG/PDF 仍确定性产出（缺字形由 renderer .notdef 表现）", () => {
    expect(typeof results["missing-glyph"]!.svgSha256).toBe("string");
    expect(typeof results["missing-glyph"]!.pngSha256).toBe("string");
  });

  it("2x PNG 尺寸精确 = scene 宽高 × 2", () => {
    for (const c of CASES) {
      const r = results[c]!;
      if (typeof r.pngWidth === "number") {
        expect(r.pngWidth, c).toBe((r.width as number) * 2);
        expect(r.pngHeight, c).toBe((r.height as number) * 2);
      }
    }
  });

  it("同进程重建：SVG/PNG/PDF hash 全部一致（确定性）", () => {
    for (const c of CASES) {
      expect(results2[c]!.svgSha256, c).toBe(results[c]!.svgSha256);
      if (results[c]!.pngSha256) expect(results2[c]!.pngSha256, c).toBe(results[c]!.pngSha256);
      if (results[c]!.pdfSha256) expect(results2[c]!.pdfSha256, c).toBe(results[c]!.pdfSha256);
    }
  });

  it("golden 清单比对（变更必须走 REGEN 并说明原因）", () => {
    const manifest = loadManifest();
    for (const c of CASES) {
      const m = manifest[c];
      expect(m, c).toBeDefined();
      expect(results[c]!.svgSha256, `${c} svg`).toBe(m.svgSha256);
      if (m.pngSha256) expect(results[c]!.pngSha256, `${c} png`).toBe(m.pngSha256);
      if (m.pdfSha256) expect(results[c]!.pdfSha256, `${c} pdf`).toBe(m.pdfSha256);
      expect(results[c]!.width, `${c} w`).toBe(m.width);
      expect(results[c]!.height, `${c} h`).toBe(m.height);
    }
  });

  it("SVG 语义：无 foreignObject、无编辑控件词汇", async () => {
    const { renderer, fixtures } = await renderAllCached();
    const scene = renderer.buildScene(fixtures["chinese-multiline"]!);
    if (!scene.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(renderer.renderSvg(scene.scene));
    expect(text.includes("foreignObject")).toBe(false);
    for (const banned of ["selection", "handle", "onboarding", "attribution"]) {
      expect(text.includes(banned)).toBe(false);
    }
    // 富文本：tspan 带 font-size / font-weight
    expect(text.includes('font-size="22"')).toBe(true);
    expect(text.includes('font-weight="700"')).toBe(true);
    // 下划线为显式 line
    expect(/<line /.test(text)).toBe(true);
  });

  it("frames-hidden：不产 frame 元素", async () => {
    const { renderer, fixtures } = await renderAllCached();
    const scene = renderer.buildScene(fixtures["frames-hidden"]!);
    if (!scene.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(renderer.renderSvg(scene.scene));
    // 背景 rect（x=0）存在，但不得有节点框（rx 圆角 / ellipse）
    expect(text.includes('rx="6"')).toBe(false);
    expect(text.includes("<ellipse")).toBe(false);
  });

  it("dark 主题：背景 #000000", async () => {
    const { renderer, fixtures } = await renderAllCached();
    const scene = renderer.buildScene(fixtures["dark-theme"]!);
    if (!scene.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(renderer.renderSvg(scene.scene));
    expect(text.includes('fill="#000000"')).toBe(true);
  });
});
