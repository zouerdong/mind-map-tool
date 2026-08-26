import { describe, expect, it } from "vitest";
import { History } from "./history.js";
import { emptyDocument } from "./schema.js";
import { makeStateNode } from "./commands.js";

function docWithNode(n: number) {
  const doc = emptyDocument();
  doc.document.nodes.push({
    id: `n${n}`,
    text: `T${n}`,
    position: { x: n, y: 0 },
    size: { width: 10, height: 10 },
  });
  return doc;
}

describe("history：identity 语义", () => {
  it("identity 永不复用（do → undo → do 分配新 identity；undo 返回原 identity）", () => {
    const h = new History(emptyDocument());
    const s0 = h.current;

    h.commit({
      kind: "CreateNode",
      id: "n1",
      text: "T",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    const s1 = h.current;
    expect(s1.identity).not.toBe(s0.identity);

    const undone = h.undo();
    expect(undone!.identity).toBe(s0.identity); // 原 identity 回来，不是新发

    h.commit({
      kind: "CreateNode",
      id: "n2",
      text: "T",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    const s2 = h.current;
    expect(s2.identity).not.toBe(s0.identity);
    expect(s2.identity).not.toBe(s1.identity); // 分叉编辑永远新 identity

    const seen = new Set([s0.identity, s1.identity, s2.identity]);
    expect(seen.size).toBe(3);
  });

  it("新命令截断 redo 分支", () => {
    const h = new History(emptyDocument());
    h.commit({
      kind: "CreateNode",
      id: "n1",
      text: "T",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    h.commit({
      kind: "CreateNode",
      id: "n2",
      text: "T",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    expect(h.canRedo).toBe(false);
    h.undo();
    expect(h.canRedo).toBe(true);
    // 分叉：新命令应截断 redo
    h.commit({
      kind: "CreateNode",
      id: "n3",
      text: "T",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    expect(h.canRedo).toBe(false);
    expect(h.current.document.document.nodes.map((n) => n.id)).toEqual(["n1", "n3"]);
  });

  it("redo 重放产生新 identity（前进语义）", () => {
    const h = new History(emptyDocument());
    h.commit({
      kind: "CreateNode",
      id: "n1",
      text: "T",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    const s1 = h.current;
    h.undo();
    const redone = h.redo();
    expect(redone!.identity).not.toBe(s1.identity); // 重放是"新"状态（identity 不复用）
    expect(redone!.document.document.nodes.length).toBe(1);
  });

  it("load 清空历史并产生新 identity", () => {
    const h = new History(emptyDocument());
    h.commit({
      kind: "CreateNode",
      id: "n1",
      text: "T",
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    const beforeLoad = h.current.identity;
    const loaded = h.load(docWithNode(9));
    expect(h.canUndo).toBe(false);
    expect(loaded.document.document.nodes[0]!.id).toBe("n9");
    expect(loaded.identity).not.toBe(beforeLoad); // load 分配新 identity
    void makeStateNode;
  });
});
