// organize（MM-085；AC-15）单元测试：
// 确定性垂直树、单条可撤销命令、环/孤立降级、空文档、幂等、规模。

import { describe, expect, it } from "vitest";
import { applyCommand, emptyDocument, makeStateNode, type MindMapDocumentV1, type MindNode } from "./index.js";
import { organize, organizeCommand, ORGANIZE_GAPS } from "./organize.js";

function node(id: string, x = 0, y = 0, w = 100, h = 40): MindNode {
  return { id, text: id, position: { x, y }, size: { width: w, height: h } };
}

function doc(nodes: MindNode[], edges: Array<[string, string]>): MindMapDocumentV1 {
  const d = emptyDocument();
  d.document.nodes = nodes;
  d.document.edges = edges.map(([s, t], i) => ({
    id: `e${i}`,
    sourceNodeId: s,
    targetNodeId: t,
  }));
  return d;
}

describe("organize：垂直树布局", () => {
  it("链式 3 节点：主干垂直向下、水平居中对齐", () => {
    const d = doc([node("a", 500, 500), node("b", -30, 0), node("c", 9, 999)], [
      ["a", "b"],
      ["b", "c"],
    ]);
    const p = organize(d);
    // 同一主干：x 一致（等宽居中），y 按层递增
    expect(p.get("a")).toEqual({ x: 0, y: 0 });
    expect(p.get("b")).toEqual({ x: 0, y: 40 + ORGANIZE_GAPS.layerGapY });
    expect(p.get("c")!.y).toBe(2 * (40 + ORGANIZE_GAPS.layerGapY));
    expect(p.get("c")!.x).toBe(0);
  });

  it("分支：子并排等距、父居中于子树范围", () => {
    const d = doc(
      [node("root"), node("l"), node("r"), node("ll")],
      [
        ["root", "l"],
        ["root", "r"],
        ["l", "ll"],
      ],
    );
    const p = organize(d);
    const rootX = p.get("root")!.x + 50; // 中心
    const l = p.get("l")!, r = p.get("r")!;
    expect(l.x).toBeLessThan(r.x); // 文档顺序：l 左 r 右
    expect(r.x - l.x).toBe(100 + ORGANIZE_GAPS.siblingGapX); // 等宽等距
    // root 中心 ≈ 子树范围中心（l..l+100 与 r..r+100 的中点）
    const mid = (l.x + 100 + r.x) / 2;
    expect(Math.abs(rootX - mid)).toBeLessThan(0.001);
    // 孙节点在 l 下方一层（深度 2）
    expect(p.get("ll")!.y).toBe(2 * (40 + ORGANIZE_GAPS.layerGapY));
    expect(p.get("ll")!.x).toBe(p.get("l")!.x); // 链式延续同 x
  });

  it("多根并列（森林），保持文档顺序", () => {
    const d = doc(
      [node("t1a"), node("t2a"), node("t1b"), node("t2b")],
      [
        ["t1a", "t1b"],
        ["t2a", "t2b"],
      ],
    );
    const p = organize(d);
    // t1 树整体在 t2 左侧
    expect(p.get("t1a")!.x).toBeLessThan(p.get("t2a")!.x);
    expect(p.get("t1b")!.x).toBeLessThan(p.get("t2a")!.x);
    expect(p.get("t1b")!.y).toBe(40 + ORGANIZE_GAPS.layerGapY);
  });

  it("环形拓扑：破环降级，全部节点仍有确定位置", () => {
    const d = doc(
      [node("a"), node("b"), node("c"), node("d")],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"], // 环
        ["d", "b"],
      ],
    );
    const p = organize(d);
    expect(p.size).toBe(4); // 不丢节点
    expect(p.get("a")).toEqual({ x: 0, y: 0 }); // a 为根（DFS 从 a 起，回边 c→a 被忽略）
    expect(p.get("b")!.y).toBe(40 + ORGANIZE_GAPS.layerGapY);
    expect(p.get("c")!.y).toBe(2 * (40 + ORGANIZE_GAPS.layerGapY));
    expect(p.get("d")).toBeTruthy(); // d 并列为一棵树
  });

  it("孤立节点：主布局右侧独立列", () => {
    const d = doc(
      [node("a", 0, 0), node("b"), node("lonely"), node("lonely2")],
      [["a", "b"]],
    );
    const p = organize(d);
    const treeRight = Math.max(p.get("a")!.x + 100, p.get("b")!.x + 100);
    expect(p.get("lonely")!.x).toBeGreaterThanOrEqual(treeRight + ORGANIZE_GAPS.siblingGapX);
    expect(p.get("lonely2")!.y).toBeGreaterThan(p.get("lonely")!.y); // 垂直堆叠
  });

  it("确定性：同输入两次输出相同；与当前坐标无关", () => {
    const d1 = doc(
      [node("a", 7, 7), node("b", 3, 1), node("c", 99, -5)],
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const d2 = doc(
      [node("a", -400, 12345), node("b", 0, 0), node("c", 8, 8)],
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    expect([...organize(d1).entries()]).toEqual([...organize(d2).entries()]); // 坐标无关
    expect([...organize(d1).entries()]).toEqual([...organize(d1).entries()]); // 幂等确定
  });

  it("空文档 → 空 map；命令为 null", () => {
    expect(organize(emptyDocument()).size).toBe(0);
    expect(organizeCommand(emptyDocument())).toBeNull();
  });

  it("层高不一时：行高取该层最大节点高（整齐对齐）", () => {
    const d = doc(
      [node("a", 0, 0, 100, 40), node("big", 0, 0, 100, 120), node("c", 0, 0, 100, 40)],
      [
        ["a", "big"],
        ["a", "c"],
      ],
    );
    const p = organize(d);
    expect(p.get("big")!.y).toBe(p.get("c")!.y); // 同层同 y
    expect(p.get("big")!.y).toBe(40 + ORGANIZE_GAPS.layerGapY);
  });
});

describe("organizeCommand：单条可撤销命令（AC-15）", () => {
  it("整理 = 一条 MoveNodes；applyCommand 后位置全部就位；逆命令完整恢复", () => {
    const d = doc(
      [node("a", 50, 50), node("b", -10, 300), node("c", 400, 20)],
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const cmd = organizeCommand(d);
    expect(cmd).not.toBeNull();
    expect(cmd!.kind).toBe("MoveNodes");
    if (cmd!.kind === "MoveNodes") expect(cmd!.moves).toHaveLength(3);

    const state = makeStateNode(d);
    const applied = applyCommand(state, cmd!);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      const organized = organize(applied.stateNode.document);
      for (const n of applied.stateNode.document.document.nodes) {
        expect(n.position).toEqual(organized.get(n.id)); // 整理后即终态
      }
      // undo 完整恢复
      expect(applied.inverse).not.toBeNull();
      const undone = applyCommand(applied.stateNode, applied.inverse!);
      expect(undone.ok).toBe(true);
      if (undone.ok) {
        const before = d.document.nodes.map((n) => ({ id: n.id, position: n.position }));
        const after = undone.stateNode.document.document.nodes.map((n) => ({ id: n.id, position: n.position }));
        expect(after).toEqual(before);
      }
    }
  });

  it("已整理的文档再整理 → null（无空命令）", () => {
    const d0 = doc(
      [node("a"), node("b"), node("c")],
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const cmd = organizeCommand(d0);
    const state0 = makeStateNode(d0);
    const applied = applyCommand(state0, cmd!);
    if (applied.ok) expect(organizeCommand(applied.stateNode.document)).toBeNull();
  });

  it("300 节点 450 边规模：正确完成且不丢节点", () => {
    const nodes: MindNode[] = [];
    const edges: Array<[string, string]> = [];
    for (let i = 0; i < 300; i++) {
      nodes.push(node(`n${i}`, (i * 37) % 900, (i * 91) % 900, 80, 40));
    }
    for (let i = 0; i < 450; i++) {
      edges.push([`n${i % 300}`, `n${(i * 7 + 1) % 300}`]);
    }
    const d = doc(nodes, edges);
    const p = organize(d);
    expect(p.size).toBe(300);
    const cmd = organizeCommand(d);
    expect(cmd!.kind).toBe("MoveNodes");
  });
});
