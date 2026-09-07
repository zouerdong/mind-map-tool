// VRA-020 / ADR 0010（G-SCHEMA 2026-09-06 批准）视觉样式 schema v2 契约测试：
// 读旧写新、缺省归一、fail-closed、三条样式命令 undo/原子性、结构化逆保留新字段。

import { describe, expect, it } from "vitest";
import { decodeDocument, encodeDocument } from "./canonical.js";
import {
  emptyDocument,
  validateDocument,
  type MindMapDocumentV1,
  type MindNode,
} from "./schema.js";
import { applyCommand, makeStateNode, type StateNode } from "./commands.js";

function node(id: string, text = id): MindNode {
  return { id, text, position: { x: 0, y: 0 }, size: { width: 100, height: 40 } };
}
function withNode(mutate?: (n: MindNode) => void): MindMapDocumentV1 {
  const doc = emptyDocument();
  const n = node("n1", "标题");
  mutate?.(n);
  doc.document.nodes.push(n);
  const e = { id: "e1", sourceNodeId: "a", targetNodeId: "n1" };
  doc.document.nodes.push(node("a"));
  doc.document.edges.push(e);
  return doc;
}

describe("ADR 0010：读旧写新", () => {
  it("v1 文件读取：内容不丢、新字段缺省呈现、坐标尺寸原样", () => {
    const v1Bytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        document: {
          theme: "light",
          font: "noto-sans-sc",
          shape: "card",
          framesVisible: true,
          nodes: [
            {
              id: "a",
              text: "旧文件节点",
              position: { x: 12.5, y: -30 },
              size: { width: 88, height: 44 },
            },
          ],
          edges: [],
        },
      }),
    );
    const r = decodeDocument(v1Bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.schemaVersion).toBe(1);
    const n = r.doc.document.nodes[0]!;
    expect(n.text).toBe("旧文件节点");
    expect(n.position).toEqual({ x: 12.5, y: -30 });
    expect(n.size).toEqual({ width: 88, height: 44 });
    expect(n.kicker).toBeUndefined();
    expect(n.emphasis).toBeUndefined();
  });

  it("v2 roundtrip：kicker/emphasis/lineStyle 保存重开一致", () => {
    const doc = withNode((n) => {
      n.kicker = "灵感 IDEA";
      n.emphasis = true;
    });
    doc.document.edges[0]!.lineStyle = "dashed";
    const bytes = encodeDocument(doc);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"schemaVersion": 2');
    expect(text).toContain('"kicker": "灵感 IDEA"');
    expect(text).toContain('"emphasis": true');
    expect(text).toContain('"lineStyle": "dashed"');
    const r = decodeDocument(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.doc.document.nodes.find((x) => x.id === "n1")!;
    expect(n.kicker).toBe("灵感 IDEA");
    expect(n.emphasis).toBe(true);
    expect(r.doc.document.edges[0]!.lineStyle).toBe("dashed");
    // decode(encode(doc)) ≡ doc（数值规范化外逐字段等价）
    const r2 = decodeDocument(encodeDocument(r.doc));
    expect(r2.ok && JSON.stringify(r2.doc) === JSON.stringify(r.doc)).toBe(true);
  });

  it("缺省归一：空 kicker / emphasis false / lineStyle solid 不落盘", () => {
    const doc = withNode((n) => {
      n.kicker = "";
      n.emphasis = false;
    });
    doc.document.edges[0]!.lineStyle = "solid";
    const text = new TextDecoder().decode(encodeDocument(doc));
    expect(text).not.toContain("kicker");
    expect(text).not.toContain("emphasis");
    expect(text).not.toContain("lineStyle");
    // schema 层同样归一（validate 输出无显式缺省）
    const v = validateDocument(JSON.parse(text));
    expect(v.ok && v.doc.document.nodes[0]!.kicker).toBeUndefined();
    expect(v.ok && v.doc.document.edges[0]!.lineStyle).toBeUndefined();
  });

  it("新文档 emptyDocument 为 v2", () => {
    expect(emptyDocument().schemaVersion).toBe(2);
  });
});

describe("ADR 0010：fail-closed 非法字段", () => {
  const badNode = (kicker?: unknown, emphasis?: unknown) =>
    JSON.stringify({
      schemaVersion: 2,
      document: {
        theme: "light",
        font: "noto-sans-sc",
        shape: "card",
        framesVisible: true,
        nodes: [
          {
            id: "a",
            text: "t",
            position: { x: 0, y: 0 },
            size: { width: 10, height: 10 },
            ...(kicker !== undefined ? { kicker } : {}),
            ...(emphasis !== undefined ? { emphasis } : {}),
          },
        ],
        edges: [],
      },
    });

  it("kicker：非 string / 换行 / 超长（41）拒绝", () => {
    expect(validateDocument(JSON.parse(badNode(123))).ok).toBe(false);
    expect(validateDocument(JSON.parse(badNode("a\nb"))).ok).toBe(false);
    expect(validateDocument(JSON.parse(badNode("x".repeat(41)))).ok).toBe(false);
    expect(validateDocument(JSON.parse(badNode("x".repeat(40)))).ok).toBe(true); // 恰 40 合法
  });

  it("emphasis 非 boolean 拒绝；lineStyle 非枚举拒绝", () => {
    expect(validateDocument(JSON.parse(badNode(undefined, "yes"))).ok).toBe(false);
    const badEdge = JSON.stringify({
      schemaVersion: 2,
      document: {
        theme: "light",
        font: "noto-sans-sc",
        shape: "card",
        framesVisible: true,
        nodes: [node("a"), node("b")],
        edges: [{ id: "e", sourceNodeId: "a", targetNodeId: "b", lineStyle: "wavy" }],
      },
    });
    const r = validateDocument(JSON.parse(badEdge));
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "EDGE_BAD_LINE_STYLE") expect(r.error.actual).toBe("wavy");
  });
});

describe("ADR 0010：三条样式命令", () => {
  const setup = (): StateNode => makeStateNode(withNode());

  it("SetNodeKicker + measured 尺寸原子提交；undo 一次恢复 kicker 与 size", () => {
    const s = setup();
    const r = applyCommand(s, {
      kind: "SetNodeKicker",
      id: "n1",
      kicker: "灵感",
      measured: { width: 120, height: 68 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.stateNode.document.document.nodes.find((x) => x.id === "n1")!;
    expect(n.kicker).toBe("灵感");
    expect(n.size).toEqual({ width: 120, height: 68 });
    const inv = applyCommand(r.stateNode, r.inverse!);
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const n2 = inv.stateNode.document.document.nodes.find((x) => x.id === "n1")!;
    expect(n2.kicker).toBeUndefined();
    expect(n2.size).toEqual({ width: 100, height: 40 }); // 尺寸一并恢复
  });

  it("SetNodeKicker 非法值（换行/超长/坏 measured）：拒绝且文档与历史不变", () => {
    const s = setup();
    const before = JSON.stringify(s.document);
    for (const cmd of [
      { kind: "SetNodeKicker" as const, id: "n1", kicker: "a\nb" },
      { kind: "SetNodeKicker" as const, id: "n1", kicker: "x".repeat(41) },
      {
        kind: "SetNodeKicker" as const,
        id: "n1",
        kicker: "ok",
        measured: { width: 0, height: 10 },
      },
      {
        kind: "SetNodeKicker" as const,
        id: "n1",
        kicker: "ok",
        measured: { width: NaN, height: 10 },
      },
      { kind: "SetNodeKicker" as const, id: "ghost", kicker: "ok" },
    ]) {
      const r = applyCommand(s, cmd);
      expect(r.ok).toBe(false);
    }
    expect(JSON.stringify(s.document)).toBe(before); // 状态未被改动
  });

  it("SetNodeEmphasis / SetEdgeLineStyle：提交、undo、缺省归一", () => {
    const s = setup();
    const r1 = applyCommand(s, { kind: "SetNodeEmphasis", id: "n1", emphasis: true });
    expect(r1.ok && r1.stateNode.document.document.nodes[0]!.emphasis).toBe(true);
    const r2 = applyCommand(r1.ok ? r1.stateNode : s, {
      kind: "SetEdgeLineStyle",
      id: "e1",
      lineStyle: "dotted",
    });
    expect(r2.ok && r2.stateNode.document.document.edges[0]!.lineStyle).toBe("dotted");
    // undo（逆序）：先撤 lineStyle，再撤 emphasis
    const u1 = applyCommand(
      r2.ok ? r2.stateNode : s,
      r2.ok ? r2.inverse! : { kind: "SetNodeEmphasis", id: "n1", emphasis: false },
    );
    expect(u1.ok && u1.stateNode.document.document.edges[0]!.lineStyle).toBeUndefined();
    const u2 = applyCommand(
      u1.ok ? u1.stateNode : s,
      r1.ok ? r1.inverse! : { kind: "SetNodeEmphasis", id: "n1", emphasis: false },
    );
    expect(u2.ok && u2.stateNode.document.document.nodes[0]!.emphasis).toBeUndefined();
    // solid = 缺省（不落盘语义在命令层同样归一）
    const r3 = applyCommand(u2.ok ? u2.stateNode : s, {
      kind: "SetEdgeLineStyle",
      id: "e1",
      lineStyle: "solid",
    });
    expect(r3.ok && r3.stateNode.document.document.edges[0]!.lineStyle).toBeUndefined();
  });

  it("删除恢复（RestoreSelection）保留 kicker/emphasis/lineStyle", () => {
    const s = makeStateNode(
      withNode((n) => {
        n.kicker = "K";
        n.emphasis = true;
      }),
    );
    const styled = applyCommand(s, { kind: "SetEdgeLineStyle", id: "e1", lineStyle: "dashed" });
    expect(styled.ok).toBe(true);
    const del = applyCommand(styled.ok ? styled.stateNode : s, {
      kind: "DeleteSelection",
      nodeIds: ["n1"],
      edgeIds: [],
    });
    expect(del.ok).toBe(true);
    const restore = applyCommand(
      del.ok ? del.stateNode : s,
      del.ok ? del.inverse! : { kind: "DeleteSelection", nodeIds: ["n1"], edgeIds: [] },
    );
    expect(restore.ok).toBe(true);
    if (!restore.ok) return;
    const n = restore.stateNode.document.document.nodes.find((x) => x.id === "n1")!;
    expect(n.kicker).toBe("K");
    expect(n.emphasis).toBe(true);
    expect(restore.stateNode.document.document.edges[0]!.lineStyle).toBe("dashed");
  });

  it("命令应用不降级 schemaVersion（v1 文档编辑后仍标 v1，保存输出 v2）", () => {
    const v1Doc = withNode();
    v1Doc.schemaVersion = 1;
    const s = makeStateNode(v1Doc);
    const r = applyCommand(s, { kind: "SetNodeEmphasis", id: "n1", emphasis: true });
    expect(r.ok && r.stateNode.document.schemaVersion).toBe(1);
    const saved = new TextDecoder().decode(encodeDocument(r.ok ? r.stateNode.document : v1Doc));
    expect(saved).toContain('"schemaVersion": 2'); // 保存（新写）= v2
    expect(saved).toContain('"emphasis": true');
  });
});
