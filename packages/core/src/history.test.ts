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

function createNode(id: string) {
  return {
    kind: "CreateNode" as const,
    id,
    text: `T${id}`,
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
  };
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

  it("H1：redo 返回原 StateNode 对象与原 identity（ADR 0003：undo/redo 只移动 cursor）", () => {
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
    // ★ 同一对象引用：redo 不得重放命令重建 StateNode（applyCommand 必然新建对象）
    expect(redone).toBe(s1);
    // ★ 原 identity：绝不新发
    expect(redone!.identity).toBe(s1.identity);
    expect(redone!.document.document.nodes.length).toBe(1);
    expect(h.current).toBe(s1); // current 也指向原节点
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

describe("history：redo 的 cursor 语义（MRT-002 / ADR 0003）", () => {
  it("H2：S0/S1/S2 多级往返——每一级对象引用与 identity 始终稳定", () => {
    const h = new History(emptyDocument());
    const s0 = h.current;
    h.commit(createNode("n1"));
    const s1 = h.current;
    h.commit(createNode("n2"));
    const s2 = h.current;
    expect(new Set([s0.identity, s1.identity, s2.identity]).size).toBe(3);

    for (let round = 0; round < 2; round++) {
      expect(h.undo()).toBe(s1); // ★ 对象引用稳定
      expect(h.undo()).toBe(s0);
      expect(h.redo()).toBe(s1);
      expect(h.redo()).toBe(s2);
      expect(h.undo()).toBe(s1); // 反向再走一级
      expect(h.redo()).toBe(s2);
    }
    expect(h.current).toBe(s2);
    expect(h.current.identity).toBe(s2.identity); // ★ identity 始终是原值
  });

  it("H3：undo 后分叉 commit 截断 redo；S3 identity 从未出现过", () => {
    const h = new History(emptyDocument());
    const s0 = h.current;
    h.commit(createNode("n1"));
    const s1 = h.current;
    h.commit(createNode("n2"));
    const s2 = h.current;
    h.undo(); // 回 S1
    h.commit(createNode("n3")); // 分叉
    const s3 = h.current;
    expect(h.canRedo).toBe(false); // ★ redo 分支被截断
    expect(h.redo()).toBeNull();
    expect(new Set([s0.identity, s1.identity, s2.identity, s3.identity]).size).toBe(4); // ★ S3 identity 从未出现
    expect(h.current).toBe(s3);
    // 分叉前的分支已删除；undo/redo 在新分支上仍稳定
    expect(h.undo()).toBe(s1);
    expect(h.redo()).toBe(s3);
  });

  it("H4：首端 undo 与末端 redo 返回 null，current/cursor 语义不变", () => {
    const h = new History(emptyDocument());
    const s0 = h.current;
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.current).toBe(s0); // history 完全不变
    h.commit(createNode("n1"));
    const s1 = h.current;
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.current).toBe(s1); // history 完全不变
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });
});
