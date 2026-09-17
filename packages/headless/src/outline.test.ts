// outline.test.ts — 大纲契约与命令层构建（ADR 0014 §3/产品规格 AC-3）。

import { describe, it, expect, beforeAll } from "vitest";
import { validateDocument } from "@mindmap/core";
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
