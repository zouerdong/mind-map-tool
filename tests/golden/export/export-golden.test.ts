// 导出 golden 三层断言（MM-040 ⑤）：
// 1) 语义 golden：canonical SVG sha256（跨平台一致层）
// 2) 视觉 golden：固定 renderer/font 的 2x PNG sha256 + 尺寸精确
// 3) PDF golden：pdf-lib bytes sha256（单页适合内容）
// 确定性：全部双构建比对（同进程重建 hash 必须一致）。
// 更新 golden：REGEN=1 npx vitest run tests/golden/export（变更报告中必须列明原因）。

import { beforeAll, describe, expect, it } from "vitest";
import {
  findCollinearOverlaps,
  LIGHT_PALETTE,
  planEdgeGeometry,
} from "@mindmap/export";
import {
  renderAll,
  loadManifest,
  manifestExists,
  writeFixturesAndManifest,
} from "./export-fixtures.js";

const LIGHT_CANVAS = LIGHT_PALETTE.canvas;
const NORMAL_FILL = LIGHT_PALETTE.cardNormalFill;
const ACCENT_FILL = LIGHT_PALETTE.cardAccentFill;

interface Box {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 轴对齐线段是否穿越矩形内部（接触边界不算，1e-6 容差）。 */
function segEntersBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bx: Box,
): boolean {
  const eps = 1e-6;
  const horizontal = Math.abs(a.y - b.y) < eps;
  const vertical = Math.abs(a.x - b.x) < eps;
  if (!horizontal && !vertical) return false; // 正交形态只有横/纵段
  if (horizontal) {
    const y = a.y;
    if (y <= bx.y0 + eps || y >= bx.y1 - eps) return false;
    const from = Math.min(a.x, b.x);
    const to = Math.max(a.x, b.x);
    return Math.min(to, bx.x1) - Math.max(from, bx.x0) > eps;
  }
  const x = a.x;
  if (x <= bx.x0 + eps || x >= bx.x1 - eps) return false;
  const from = Math.min(a.y, b.y);
  const to = Math.max(a.y, b.y);
  return Math.min(to, bx.y1) - Math.max(from, bx.y0) > eps;
}

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
    "visual-style-v2",
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

  it("多行文本：每个 tspan 携带各自 x/y（两行 Alpha\\nBaseline 分行可见）", async () => {
    const { renderer, fixtures } = await renderAllCached();
    const scene = renderer.buildScene(fixtures["chinese-multiline"]!);
    if (!scene.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(renderer.renderSvg(scene.scene));
    const tspans = [...text.matchAll(/<tspan ([^>]*)>/g)].map((m) => m[1]!);
    expect(tspans.length).toBeGreaterThan(0);
    for (const attrs of tspans) {
      expect(attrs.includes("x="), attrs).toBe(true);
      expect(/ y="-?\d+(\.\d+)?"/.test(attrs), attrs).toBe(true);
    }
    const ys = new Set(tspans.map((a) => a.match(/ y="([^"]+)"/)?.[1]));
    expect(ys.size).toBeGreaterThan(1); // 多行不再共用首行 baseline
    // 行几何来自 scene：多行节点的行距 = 16 × 1.4（§1.3），逐行 baseline 递增
    const textItems = scene.scene.items.filter((i) => i.kind === "text");
    let sawMultiLine = false;
    for (const item of textItems) {
      if (item.kind !== "text") continue;
      const lines = [...new Set(item.segments.map((s) => s.baselineY))].sort((a, b) => a - b);
      if (lines.length < 2) continue;
      sawMultiLine = true;
      // 行距 = 16×1.4 = 22.4；混排粗体行的 ascent 差异允许 <1px 浮动
      const delta = lines[1]! - lines[0]!;
      expect(delta).toBeGreaterThanOrEqual(22);
      expect(delta).toBeLessThanOrEqual(23);
    }
    expect(sawMultiLine).toBe(true);
  });

  it("visual-style-v2：暖白底、实心卡、双层文案、正交边与独立箭头", async () => {
    const { renderer, fixtures } = await renderAllCached();
    const scene = renderer.buildScene(fixtures["visual-style-v2"]!);
    if (!scene.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(renderer.renderSvg(scene.scene));
    // 暖白画布（tokens §1.1 canvas.light）
    expect(text.includes(`fill="${LIGHT_CANVAS}"`)).toBe(true);
    // 普通卡 = 实心深卡（无描边），强调卡 = 橙卡
    expect(text.includes(`fill="${NORMAL_FILL}" stroke="none"`)).toBe(true);
    expect(text.includes(`fill="${ACCENT_FILL}" stroke="none"`)).toBe(true);
    expect(text.includes(`rx="12"`)).toBe(true);
    // 双层文案：眉题 11px + letter-spacing，正文 16px
    expect(text.includes('letter-spacing="0.66"')).toBe(true);
    expect(text.includes('font-size="11"')).toBe(true);
    expect(text.includes("知识库长期沉淀")).toBe(true); // 长中文眉题逐字可见
    // 边：正交 fillet 折线（无 C 指令）+ 独立实心箭头 path
    expect(text.includes('stroke-dasharray="5 4"')).toBe(true);
    expect(text.includes('stroke-dasharray="0.1 5"')).toBe(true);
    expect(text.includes('stroke-linecap="round"')).toBe(true);
    const edgePaths = [...text.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => m[1]!);
    expect(edgePaths.length).toBeGreaterThan(0);
    for (const d of edgePaths) expect(d.includes(" C "), d).toBe(false);
    const arrows = [...text.matchAll(/<path d="([^"]+)" fill="#4A4640" stroke="none"\/>/g)].map(
      (m) => m[1]!,
    );
    expect(arrows.length).toBeGreaterThan(0);
    for (const d of arrows) expect(d.endsWith(" Z"), d).toBe(true);
    // scene 内每个边项都有独立箭头 path
    const edges = scene.scene.items.filter((i) => i.kind === "edge");
    expect(edges.every((i) => i.kind === "edge" && i.arrowD.endsWith(" Z"))).toBe(true);
  });

  it("visual-style-v2：整理后零共线重叠（tokens §1.4 布线硬规则，程序化检测）", async () => {
    const { fixtures } = await renderAllCached();
    const doc = fixtures["visual-style-v2"]!;
    const byId = new Map(doc.document.nodes.map((n) => [n.id, n]));
    const inputs = doc.document.edges
      .map((e) => {
        const a = byId.get(e.sourceNodeId);
        const b = byId.get(e.targetNodeId);
        if (!a || !b) return null;
        return {
          id: e.id,
          sourceId: a.id,
          targetId: b.id,
          source: { x: a.position.x, y: a.position.y, width: a.size.width, height: a.size.height },
          target: { x: b.position.x, y: b.position.y, width: b.size.width, height: b.size.height },
        };
      })
      .filter((v) => v !== null);
    const obstacles = doc.document.nodes.map((n) => ({
      x: n.position.x,
      y: n.position.y,
      width: n.size.width,
      height: n.size.height,
    }));
    const geoms = planEdgeGeometry(inputs, "horizontal", 1, { obstacles });
    expect(findCollinearOverlaps(geoms.values())).toEqual([]);
    // 零穿卡：折线段不得穿过无关卡片内部（源/目标卡自身除外，边界接触不算）
    const crossings: string[] = [];
    for (const input of inputs) {
      const g = geoms.get(input.id)!;
      const skip = new Set([input.sourceId, input.targetId]);
      const boxes = doc.document.nodes
        .filter((n) => !skip.has(n.id))
        .map((n) => ({
          id: n.id,
          x0: n.position.x,
          y0: n.position.y,
          x1: n.position.x + n.size.width,
          y1: n.position.y + n.size.height,
        }));
      for (let i = 1; i < g.chain.length; i++) {
        const a = g.chain[i - 1]!;
        const b = g.chain[i]!;
        for (const bx of boxes) {
          if (segEntersBox(a, b, bx)) crossings.push(`${input.id}×${bx.id}`);
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it("visual-style-v2：bounds 全包含（卡片 + 边极值 + 描边留白；负坐标不裁切）", async () => {
    const { renderer, fixtures } = await renderAllCached();
    for (const name of ["visual-style-v2", "negative-coordinates", "large-bounds"]) {
      const doc = fixtures[name]!;
      const scene = renderer.buildScene(doc);
      if (!scene.ok) throw new Error("unreachable");
      const byId = new Map(doc.document.nodes.map((n) => [n.id, n]));
      const inputs = doc.document.edges
        .map((e) => {
          const a = byId.get(e.sourceNodeId);
          const b = byId.get(e.targetNodeId);
          if (!a || !b) return null;
          return {
            id: e.id,
            sourceId: a.id,
            targetId: b.id,
            source: {
              x: a.position.x,
              y: a.position.y,
              width: a.size.width,
              height: a.size.height,
            },
            target: {
              x: b.position.x,
              y: b.position.y,
              width: b.size.width,
              height: b.size.height,
            },
          };
        })
        .filter((v) => v !== null);
      const geoms = planEdgeGeometry(inputs, "horizontal", 1);
      const extremes = [...geoms.values()].flatMap((g) => g.extremes);
      const nodeBoxes = doc.document.nodes.map((n) => [n.position, {
        x: n.position.x + n.size.width,
        y: n.position.y + n.size.height,
      } as { x: number; y: number }]);
      const all = [...extremes, ...nodeBoxes.flat()];
      const minX = Math.min(...all.map((p) => p.x));
      const maxX = Math.max(...all.map((p) => p.x));
      const minY = Math.min(...all.map((p) => p.y));
      const maxY = Math.max(...all.map((p) => p.y));
      // scene 尺寸须覆盖全部极值（含内容边距），且 SVG 内不出现越界负坐标
      expect(scene.scene.width, `${name} width`).toBeGreaterThanOrEqual(maxX - minX);
      expect(scene.scene.height, `${name} height`).toBeGreaterThanOrEqual(maxY - minY);
      const svg = new TextDecoder().decode(renderer.renderSvg(scene.scene));
      const xs = [...svg.matchAll(/ x="(-?\d+(?:\.\d+)?|-0)"/g)].map((m) => Number(m[1]));
      for (const x of xs) expect(x, `${name} svg x`).toBeGreaterThanOrEqual(0);
    }
  });

  it("frames-hidden：不产 frame 元素，文字落到画布墨色", async () => {
    const { renderer, fixtures } = await renderAllCached();
    const scene = renderer.buildScene(fixtures["frames-hidden"]!);
    if (!scene.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(renderer.renderSvg(scene.scene));
    // 背景 rect（x=0）存在，但不得有节点框（rx 圆角 / ellipse）
    expect(text.includes('rx="12"')).toBe(false);
    expect(text.includes("<ellipse")).toBe(false);
    // 纯文字态：墨色 = light 卡底色（§1.1 墨纸互换）
    expect(text.includes(`fill="${NORMAL_FILL}"`)).toBe(true);
  });

  it("dark 主题：黑板底 #16140F、粉笔白亮卡（tokens §1.2）", async () => {
    const { renderer, fixtures } = await renderAllCached();
    const scene = renderer.buildScene(fixtures["dark-theme"]!);
    if (!scene.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(renderer.renderSvg(scene.scene));
    expect(text.includes('fill="#16140F"')).toBe(true);
    expect(text.includes('fill="#EFEAE0" stroke="none"')).toBe(true);
    expect(text.includes('fill="#141412"')).toBe(true); // 亮卡上的深字
  });
});
