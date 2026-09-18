// 层级深度派生契约测试（ADR 0020）：BFS 最短路径深度、SCC 环降级、孤立节点不染色、确定性。
import { describe, expect, it } from "vitest";
import { deriveNodeDepths } from "./node-depth.js";
import { emptyDocument, type MindMapDocumentV1, type MindNode } from "./schema.js";

function node(id: string): MindNode {
  return { id, text: id, position: { x: 0, y: 0 }, size: { width: 100, height: 40 } };
}

function docWith(nodeIds: string[], edges: Array<[string, string]>): MindMapDocumentV1 {
  const doc = emptyDocument();
  doc.document.nodes = nodeIds.map(node);
  doc.document.edges = edges.map(([s, t], i) => ({
    id: `e${i}`,
    sourceNodeId: s,
    targetNodeId: t,
  }));
  return doc;
}

describe("deriveNodeDepths（ADR 0020）", () => {
  it("空文档与全孤立文档：无层级", () => {
    expect(deriveNodeDepths(emptyDocument()).size).toBe(0);
    expect(deriveNodeDepths(docWith(["a", "b"], [])).size).toBe(0);
  });

  it("单链：源 = 1，逐层 +1", () => {
    const d = deriveNodeDepths(
      docWith(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "d"],
        ],
      ),
    );
    expect(d.get("a")).toBe(1);
    expect(d.get("b")).toBe(2);
    expect(d.get("c")).toBe(3);
    expect(d.get("d")).toBe(4);
  });

  it("多源：各自入度 0 节点同为深度 1", () => {
    const d = deriveNodeDepths(
      docWith(
        ["r1", "r2", "x"],
        [
          ["r1", "x"],
          ["r2", "x"],
        ],
      ),
    );
    expect(d.get("r1")).toBe(1);
    expect(d.get("r2")).toBe(1);
    expect(d.get("x")).toBe(2);
  });

  it("多父取 BFS 最短路径（区别于 organize 的最长前驱分层）", () => {
    // a→b→c→x（长链深度 4）与 a→x（短链深度 2）：x 取 2
    const d = deriveNodeDepths(
      docWith(
        ["a", "b", "c", "x"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "x"],
          ["a", "x"],
        ],
      ),
    );
    expect(d.get("x")).toBe(2);
    expect(d.get("c")).toBe(3);
  });

  it("环：SCC 内节点同深度，不发散不死循环", () => {
    // a→b→c→b（环 b↔c）+ c→d
    const d = deriveNodeDepths(
      docWith(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "b"],
          ["c", "d"],
        ],
      ),
    );
    expect(d.get("a")).toBe(1);
    expect(d.get("b")).toBe(2);
    expect(d.get("c")).toBe(2); // 与 b 同 SCC
    expect(d.get("d")).toBe(3);
  });

  it("自环节点仍在主图且按 SCC 规则取深度", () => {
    const d = deriveNodeDepths(docWith(["a"], [["a", "a"]]));
    expect(d.get("a")).toBe(1);
  });

  it("孤立节点不出现在结果中（保持普通色，不染色）", () => {
    const d = deriveNodeDepths(docWith(["a", "b", "orphan"], [["a", "b"]]));
    expect(d.has("orphan")).toBe(false);
    expect(d.get("a")).toBe(1);
    expect(d.get("b")).toBe(2);
  });

  it("确定性：与边数组顺序无关", () => {
    const edges: Array<[string, string]> = [
      ["a", "b"],
      ["b", "c"],
      ["a", "c"],
    ];
    const forward = deriveNodeDepths(docWith(["a", "b", "c"], edges));
    const reversed = deriveNodeDepths(docWith(["a", "b", "c"], [...edges].reverse()));
    expect([...forward.entries()].sort()).toEqual([...reversed.entries()].sort());
    expect(forward.get("c")).toBe(2); // 最短路径 a→c
  });

  it("悬空边（指向不存在节点）被忽略，不污染深度", () => {
    const d = deriveNodeDepths(
      docWith(
        ["a", "b"],
        [
          ["a", "b"],
          ["ghost", "b"],
        ],
      ),
    );
    expect(d.get("a")).toBe(1);
    expect(d.get("b")).toBe(2);
    expect(d.has("ghost")).toBe(false);
  });
});
