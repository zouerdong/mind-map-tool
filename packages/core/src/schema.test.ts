import { describe, expect, it } from "vitest";
import { validateDocument, emptyDocument, LIMITS } from "./schema.js";

function base() {
  return emptyDocument();
}

describe("schema 校验", () => {
  it("合法 v1 文档通过", () => {
    const doc = base();
    doc.document.nodes.push({
      id: "a",
      text: "A",
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
    });
    doc.document.nodes.push({
      id: "b",
      text: "B",
      position: { x: 100, y: 0 },
      size: { width: 10, height: 10 },
    });
    doc.document.edges.push({ id: "e", sourceNodeId: "a", targetNodeId: "b" });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("重复节点 ID 拒绝", () => {
    const doc = base();
    doc.document.nodes.push({
      id: "a",
      text: "1",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    doc.document.nodes.push({
      id: "a",
      text: "2",
      position: { x: 1, y: 1 },
      size: { width: 1, height: 1 },
    });
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "DUPLICATE_NODE_ID") expect(r.error.id).toBe("a");
  });

  it("dangling edge / 自环 / 同方向重复边 拒绝", () => {
    const doc = base();
    doc.document.nodes.push({
      id: "a",
      text: "A",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    doc.document.edges.push({ id: "e1", sourceNodeId: "a", targetNodeId: "ghost" });
    expect(validateDocument(doc).ok).toBe(false);

    doc.document.edges = [{ id: "e2", sourceNodeId: "a", targetNodeId: "a" }];
    expect(validateDocument(doc).ok).toBe(false);

    doc.document.nodes.push({
      id: "b",
      text: "B",
      position: { x: 1, y: 1 },
      size: { width: 1, height: 1 },
    });
    doc.document.edges = [
      { id: "e3", sourceNodeId: "a", targetNodeId: "b" },
      { id: "e4", sourceNodeId: "a", targetNodeId: "b" },
    ];
    expect(validateDocument(doc).ok).toBe(false);
    // 反方向允许
    doc.document.edges = [
      { id: "e3", sourceNodeId: "a", targetNodeId: "b" },
      { id: "e4", sourceNodeId: "b", targetNodeId: "a" },
    ];
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("NaN/Infinity/越界坐标与尺寸拒绝", () => {
    const badNode = (mut: (n: Record<string, unknown>) => void) => {
      const d = base();
      const n: Record<string, unknown> = {
        id: "a",
        text: "A",
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
      };
      mut(n);
      d.document.nodes.push(n as never);
      return d;
    };
    expect(validateDocument(badNode((n) => ((n.position as { x: number }).x = NaN))).ok).toBe(
      false,
    );
    expect(validateDocument(badNode((n) => ((n.position as { x: number }).x = Infinity))).ok).toBe(
      false,
    );
    expect(
      validateDocument(badNode((n) => ((n.position as { x: number }).x = LIMITS.maxCoordAbs + 1)))
        .ok,
    ).toBe(false);
    expect(validateDocument(badNode((n) => ((n.size as { width: number }).width = 0))).ok).toBe(
      false,
    );
    expect(
      validateDocument(badNode((n) => ((n.size as { width: number }).width = LIMITS.maxSize + 1)))
        .ok,
    ).toBe(false);
  });

  it("未知未来版本拒绝", () => {
    const r = validateDocument({ schemaVersion: 3, document: {} });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "BAD_SCHEMA_VERSION") expect(r.error.actual).toBe(3);
  });

  it("节点数超上限拒绝（前置，不构造大数组本体）", () => {
    const doc = base() as unknown as {
      document: { nodes: unknown[]; theme: string; font: string; shape: string; edges: unknown[] };
    };
    doc.document.nodes = new Array(LIMITS.maxNodes + 1).fill({
      id: "x",
      text: "",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "LIMIT_EXCEEDED") expect(r.error.what).toBe("nodes");
  });

  it("确认 schema 不含 viewport/zoom 字段位置", () => {
    const doc = base();
    expect(Object.hasOwn(doc.document, "viewport")).toBe(false);
    expect(Object.hasOwn(doc, "selection")).toBe(false);
  });
});
