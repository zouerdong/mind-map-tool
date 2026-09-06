// Graph JSON 第四导出格式（[from-user 2026-09-06]；PRD §5 导出行）契约测试：
// 自描述结构、确定性 bytes、语义等价、缺省不输出、v1/v2 输入、中英文 label。

import { describe, expect, it } from "vitest";
import { encodeGraphJson, toGraphJson } from "../src/graph-json.js";
import { decodeDocument, emptyDocument, type MindMapDocumentV1 } from "@mindmap/core";

function sampleDoc(): MindMapDocumentV1 {
  const doc = emptyDocument();
  doc.document.nodes.push(
    {
      id: "n1", text: "需求与设计\nRequirements & design",
      position: { x: -30.1234, y: 0 }, size: { width: 230, height: 84 },
      kicker: "灵感 IDEA", emphasis: true,
      runs: [{ start: 0, end: 5, bold: true }],
    },
    { id: "n2", text: "闭环收尾 Closing the loop", position: { x: 400, y: 100 }, size: { width: 188, height: 68 } },
  );
  doc.document.edges.push({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2", lineStyle: "dashed" });
  return doc;
}

describe("Graph JSON 导出", () => {
  it("自描述结构：format/version/meta/graph；source/target 指向节点 id", () => {
    const g = toGraphJson(sampleDoc());
    expect(g.format).toBe("mindmap-graph-json");
    expect(g.version).toBe(1);
    expect(g.meta.nodeCount).toBe(2);
    expect(g.meta.edgeCount).toBe(1);
    expect(g.graph.nodes[0]!.id).toBe("n1");
    expect(g.graph.edges[0]!.source).toBe("n1");
    expect(g.graph.edges[0]!.target).toBe("n2");
  });

  it("label = text 首行（≤60 字符），全文保留在 text", () => {
    const g = toGraphJson(sampleDoc());
    expect(g.graph.nodes[0]!.label).toBe("需求与设计");
    expect(g.graph.nodes[0]!.text).toBe("需求与设计\nRequirements & design");
    // 超长首行截断带省略号
    const doc = emptyDocument();
    doc.document.nodes.push({ id: "x", text: "长".repeat(100), position: { x: 0, y: 0 }, size: { width: 10, height: 10 } });
    const label = toGraphJson(doc).graph.nodes[0]!.label;
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith("…")).toBe(true);
  });

  it("语义等价：位置/尺寸/样式字段完整；数值 3 位小数归一", () => {
    const g = toGraphJson(sampleDoc());
    const n1 = g.graph.nodes[0]!;
    expect(n1.position.x).toBe(-30.123); // -30.1234 → 3 位小数
    expect(n1.kicker).toBe("灵感 IDEA");
    expect(n1.emphasis).toBe(true);
    expect(n1.runs).toEqual([{ start: 0, end: 5, bold: true }]);
    expect(g.graph.edges[0]!.lineStyle).toBe("dashed");
  });

  it("缺省不输出：无眉题/普通角色/实线/无 runs 的节点与边不带对应键", () => {
    const g = toGraphJson(sampleDoc());
    const n2 = g.graph.nodes[1]!;
    expect("kicker" in n2).toBe(false);
    expect("emphasis" in n2).toBe(false);
    expect("runs" in n2).toBe(false);
  });

  it("确定性：同文档两次 encode bytes 相同（可 hash/diff）", () => {
    const doc = sampleDoc();
    const a = encodeGraphJson(doc);
    const b = encodeGraphJson(sampleDoc());
    expect(a.length).toBe(b.length);
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b));
    const text = new TextDecoder().decode(a);
    expect(text.endsWith("\n")).toBe(true); // 末尾换行
    expect(text).toContain('"format": "mindmap-graph-json"'); // 两空格缩进
  });

  it("v1 与 v2 文档输入均可导出（读取兼容由 core 负责）", () => {
    const doc = sampleDoc();
    doc.schemaVersion = 1; // 模拟 v1 来源
    const g = toGraphJson(doc);
    expect(g.graph.nodes.length).toBe(2);
    // 通过 decode 的 v1 bytes（真实路径）
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        document: {
          theme: "light", font: "noto-sans-sc", shape: "card", framesVisible: true,
          nodes: [{ id: "a", text: "旧", position: { x: 1, y: 2 }, size: { width: 10, height: 10 } }],
          edges: [],
        },
      }),
    );
    const r = decodeDocument(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const g1 = toGraphJson(r.doc);
      expect(g1.graph.nodes[0]!.label).toBe("旧");
      expect(g1.meta.version ?? g1.version).toBe(1);
    }
  });
});
