// outline.test.ts — 大纲契约与命令层构建（ADR 0014 §3/产品规格 AC-3）。

import { describe, it, expect, beforeAll } from "vitest";
import { validateDocument, type MindMapDocumentV1 } from "@mindmap/core";
import { createExportRenderer, type ExportRenderer } from "@mindmap/export";
import { loadFontBundle, loadResvgWasm } from "./assets.js";
import { buildDocumentFromOutline } from "./outline.js";

let renderer: ExportRenderer;
beforeAll(async () => {
  renderer = await createExportRenderer({
    fonts: loadFontBundle(),
    resvgWasm: loadResvgWasm(),
  });
});

const sample = {
  text: "出发点",
  children: [{ text: "分支 A", children: [{ text: "叶子 A1" }] }, { text: "分支 B" }],
};

describe("buildDocumentFromOutline", () => {
  it("树状大纲经命令层构建：节点/边/id/强调/布局全部落定，且通过 schema 校验", () => {
    const result = buildDocumentFromOutline(renderer, sample);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeCount).toBe(4);
    expect(result.edgeCount).toBe(3);
    const doc = result.document;
    expect(validateDocument(doc).ok).toBe(true);
    const ids = doc.document.nodes.map((n) => n.id);
    expect(ids).toEqual(["n-1", "n-2", "n-3", "n-4"]); // 先序确定性派生
    expect(doc.document.nodes[0]!.emphasis).toBe(true); // 根强调对齐 GUI 首节点行为
    expect(doc.document.nodes[1]!.emphasis).toBeUndefined();
    expect(doc.document.edges.map((e) => [e.sourceNodeId, e.targetNodeId])).toEqual([
      ["n-1", "n-2"],
      ["n-2", "n-3"],
      ["n-1", "n-4"],
    ]);
    // organize 已落定：不再停留在创建占位 (0,0)，且位置两两不同
    const positions = doc.document.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions.some((p) => p !== "0,0")).toBe(true);
    // size 非零（经 measureNodeVisual 权威度量）
    for (const node of doc.document.nodes) {
      expect(node.size.width).toBeGreaterThan(0);
      expect(node.size.height).toBeGreaterThan(0);
    }
  });

  it("默认字体沿用产品默认（文楷）；font 选项经 SetDocumentStyle 切换", () => {
    const def = buildDocumentFromOutline(renderer, { text: "根" });
    expect(def.ok && def.document.document.font).toBe("lxgw-wenkai");
    const noto = buildDocumentFromOutline(renderer, { text: "根" }, { font: "noto-sans-sc" });
    expect(noto.ok && noto.document.document.font).toBe("noto-sans-sc");
  });

  it("拒绝非法输入：非对象 / 空 text / children 非数组 / 超长文本", () => {
    for (const bad of [
      null,
      [],
      "x",
      { text: "" },
      { text: "  " },
      { text: 1 },
      { text: "根", children: {} },
      { text: "根", children: [{ text: "" }] },
    ]) {
      const result = buildDocumentFromOutline(renderer, bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("BAD_OUTLINE");
    }
    const long = buildDocumentFromOutline(renderer, { text: "x".repeat(10_001) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.code).toBe("LIMIT_EXCEEDED");
  });

  it("vertical 方向整理生效（与 horizontal 布局不同）", () => {
    const h = buildDocumentFromOutline(renderer, sample, { direction: "horizontal" });
    const v = buildDocumentFromOutline(renderer, sample, { direction: "vertical" });
    expect(h.ok && v.ok).toBe(true);
    if (!h.ok || !v.ok) return;
    const hp = h.document.document.nodes.map((n) => n.position);
    const vp = v.document.document.nodes.map((n) => n.position);
    expect(hp).not.toEqual(vp);
  });
});

describe("宽而浅自适应分栏布局（ADR 0014 v1.2.0）", () => {
  const wide = {
    text: "根",
    children: [1, 2, 3, 4, 5].map((i) => ({
      text: `分支 ${i}`,
      children: [1, 2, 3].map((j) => ({ text: `叶子 ${i}-${j}` })),
    })),
  };
  const extent = (doc: MindMapDocumentV1) => {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of doc.document.nodes) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + n.size.width);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y + n.size.height);
    }
    return { width: maxX - minX, height: maxY - minY };
  };

  it("默认落地 wide：小树选单栏，根在左、非根节点全部在右侧", () => {
    const r = buildDocumentFromOutline(renderer, sample);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layout).toBe("wide");
    expect(r.columns).toBe(1);
    const root = r.document.document.nodes[0]!;
    for (const n of r.document.document.nodes.slice(1))
      expect(n.position.x).toBeGreaterThan(root.position.x);
  });

  it("宽而浅树：自动分多栏，根在顶左，总高显著低于单栏层叠、总宽显著更大", () => {
    const w = buildDocumentFromOutline(renderer, wide);
    const l = buildDocumentFromOutline(renderer, wide, { wide: false });
    expect(w.ok && l.ok).toBe(true);
    if (!w.ok || !l.ok) return;
    expect(w.layout).toBe("wide");
    expect(w.columns).toBeGreaterThanOrEqual(2);
    expect(l.layout).toBe("layered");
    const we = extent(w.document);
    const le = extent(l.document);
    expect(we.height).toBeLessThan(le.height * 0.75);
    expect(we.width).toBeGreaterThan(le.width * 1.5);
    // 根在顶左：x/y 均为全图最小
    const root = w.document.document.nodes[0]!;
    for (const n of w.document.document.nodes.slice(1)) {
      expect(n.position.x).toBeGreaterThan(root.position.x);
      expect(n.position.y).toBeGreaterThan(root.position.y);
    }
  });

  it("回退守卫：单分支树不做分栏，layout=layered", () => {
    const r = buildDocumentFromOutline(renderer, {
      text: "根",
      children: [{ text: "独支", children: [{ text: "叶" }] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layout).toBe("layered");
    expect(r.columns).toBe(0);
  });

  it("vertical 方向不应用分栏变换", () => {
    const r = buildDocumentFromOutline(renderer, wide, { direction: "vertical" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layout).toBe("layered");
  });
});
