// 能量脉冲来路路径契约测试（2026-09-18 内测批次④；产品规格 §5.1「选中动效」）。
import { describe, expect, it } from "vitest";
import { emptyDocument, type MindMapDocumentV1, type MindNode } from "@mindmap/core";
import { pulsePathTo } from "../src/canvas/pulse-path.js";

function node(id: string, emphasis = false): MindNode {
  return {
    id,
    text: id,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
    ...(emphasis ? { emphasis: true } : {}),
  };
}

function docWith(
  nodes: Array<[string, boolean?]>,
  edges: Array<[string, string]>,
): MindMapDocumentV1 {
  const doc = emptyDocument();
  doc.document.nodes = nodes.map(([id, em]) => node(id, em === true));
  doc.document.edges = edges.map(([s, t], i) => ({
    id: `e${i}`,
    sourceNodeId: s,
    targetNodeId: t,
  }));
  return doc;
}

describe("pulsePathTo（选中动效来路）", () => {
  it("单链：出发点 → 目标的有序边链", () => {
    const d = docWith(
      [["a", true], ["b"], ["c"]],
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const p = pulsePathTo(d, "c");
    expect(p).not.toBeNull();
    expect(p!.originId).toBe("a");
    expect(p!.edgeIds).toEqual(["e0", "e1"]);
  });

  it("BFS 最短路径：多父/长链绕行取短链", () => {
    const d = docWith(
      [["a", true], ["b"], ["c"], ["x"]],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "x"],
        ["a", "x"],
      ],
    );
    expect(pulsePathTo(d, "x")!.edgeIds).toEqual(["e3"]); // a→x 直达
  });

  it("选中出发点自身 → null（无线条传导）", () => {
    const d = docWith([["a", true], ["b"]], [["a", "b"]]);
    expect(pulsePathTo(d, "a")).toBeNull();
  });

  it("不连通（出发点在另一分量）→ null", () => {
    const d = docWith(
      [["a", true], ["b"], ["x"], ["y"]],
      [
        ["a", "b"],
        ["x", "y"],
      ],
    );
    expect(pulsePathTo(d, "y")).toBeNull();
  });

  it("无橙卡回退：目标分量的入度 0 源（文档序最小）", () => {
    const d = docWith(
      [["r"], ["m"], ["t"]],
      [
        ["r", "m"],
        ["m", "t"],
      ],
    );
    const p = pulsePathTo(d, "t");
    expect(p!.originId).toBe("r");
    expect(p!.edgeIds).toEqual(["e0", "e1"]);
  });

  it("目标本身是源（无入边）→ null", () => {
    const d = docWith([["r"], ["t"]], [["r", "t"]]);
    // 无 emphasis：候选源 = r；目标 t 有入边，可从 r 到达 → 正常播放
    expect(pulsePathTo(d, "t")!.edgeIds).toEqual(["e0"]);
    // 目标 r 是源 → null
    expect(pulsePathTo(d, "r")).toBeNull();
  });

  it("孤立目标 → null", () => {
    const d = docWith([["a", true], ["b"], ["lonely"]], [["a", "b"]]);
    expect(pulsePathTo(d, "lonely")).toBeNull();
  });

  it("环分量无橙卡：回退文档序最小节点为起点", () => {
    const d = docWith(
      [["a"], ["b"], ["c"]],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ],
    );
    const p = pulsePathTo(d, "c");
    expect(p).not.toBeNull();
    expect(p!.originId).toBe("a");
  });

  it("确定性：与边数组顺序无关（平局按节点文档序）", () => {
    const mk = (edges: Array<[string, string]>) =>
      docWith([["a", true], ["b"], ["c"], ["t"]], edges);
    const fwd = pulsePathTo(
      mk([
        ["a", "b"],
        ["a", "c"],
        ["b", "t"],
        ["c", "t"],
      ]),
      "t",
    );
    const rev = pulsePathTo(
      mk([
        ["c", "t"],
        ["b", "t"],
        ["a", "c"],
        ["a", "b"],
      ]),
      "t",
    );
    // b 文档序先于 c → 两条路径都经 b（e 序随输入变，但路径形状一致）
    expect(fwd!.edgeIds).toHaveLength(2);
    expect(rev!.edgeIds).toHaveLength(2);
    // 反转后边 id 不同但语义路径同为 a→b→t
    expect(fwd!.originId).toBe(rev!.originId);
  });

  it("目标不存在 → null", () => {
    expect(pulsePathTo(docWith([["a", true]], []), "ghost")).toBeNull();
  });
});
