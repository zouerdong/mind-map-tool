// ADR 0019：发散（balanced）整理方向测试。
// 覆盖：主根居中、第一层贪心分侧、深层跟随前驱侧、不可达子图回退右侧、
// 环降级、孤立组、确定性（边序置换）、坐标非负、无重叠、命令幂等。
import { describe, expect, it } from "vitest";
import { organize, organizeCommand } from "./organize.js";
import type { MindMapDocumentV1, MindMapDocumentData, MindNode } from "./schema.js";

function node(id: string, w = 100, h = 40): MindNode {
  return { id, text: id, position: { x: 500, y: 500 }, size: { width: w, height: h } };
}
function doc(nodes: MindNode[], edges: Array<[string, string]>): MindMapDocumentV1 {
  const d: MindMapDocumentData = {
    theme: "light",
    font: "noto-sans-sc",
    shape: "card",
    framesVisible: true,
    nodes,
    edges: edges.map(([s, t], i) => ({ id: `e-${i}`, sourceNodeId: s, targetNodeId: t })),
  };
  return { schemaVersion: 1, document: d };
}
function ok(result: ReturnType<typeof organize>): Map<string, { x: number; y: number }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.positions;
}
const P = (positions: Map<string, { x: number; y: number }>, id: string) => {
  const p = positions.get(id);
  if (!p) throw new Error(`missing ${id}`);
  return p;
};

/** 星形：root 带 n 个等权子节点。 */
function star(childCount: number): MindMapDocumentV1 {
  const nodes = [node("root")];
  const edges: Array<[string, string]> = [];
  for (let i = 1; i <= childCount; i++) {
    nodes.push(node(`c${i}`));
    edges.push(["root", `c${i}`]);
  }
  return doc(nodes, edges);
}

describe("organize balanced（ADR 0019 发散）", () => {
  it("星形 4 子：两右两左交替（等权贪心，右侧优先），主根居中", () => {
    const pos = ok(organize(star(4), { direction: "balanced" }));
    const root = P(pos, "root");
    const c1 = P(pos, "c1");
    const c2 = P(pos, "c2");
    const c3 = P(pos, "c3");
    const c4 = P(pos, "c4");
    // 等权交替：c1→右、c2→左、c3→右、c4→左
    expect(c1.x).toBeGreaterThan(root.x);
    expect(c2.x).toBeLessThan(root.x);
    expect(c3.x).toBeGreaterThan(root.x);
    expect(c4.x).toBeLessThan(root.x);
    // 左支镜像对称位（同宽节点）：左列右缘贴 root 列左缘 - layerGap
    expect(root.x - (c2.x + 100)).toBe(c1.x - (root.x + 100));
  });

  it("体量贪心：出度大的子节点优先放较轻侧", () => {
    // c1 带 3 个孙节点（体量 4），c2/c3 体量 1 → c1 右，c2 左，c3 左（wr=4 > wl=1 → c3 左）
    const d = doc(
      [node("root"), node("c1"), node("c2"), node("c3"), node("g1"), node("g2"), node("g3")],
      [
        ["root", "c1"],
        ["root", "c2"],
        ["root", "c3"],
        ["c1", "g1"],
        ["c1", "g2"],
        ["c1", "g3"],
      ],
    );
    const pos = ok(organize(d, { direction: "balanced" }));
    const root = P(pos, "root");
    expect(P(pos, "c1").x).toBeGreaterThan(root.x);
    expect(P(pos, "c2").x).toBeLessThan(root.x);
    expect(P(pos, "c3").x).toBeLessThan(root.x);
    // 孙节点跟随 c1 右侧，且比 c1 更靠右
    expect(P(pos, "g1").x).toBeGreaterThan(P(pos, "c1").x);
  });

  it("深层节点跟随文档序最小的已分侧前驱（含跨层边）", () => {
    // root→c1(右), root→c2(左)；c1→x, c2→x（x 双父）→ x 跟 c1（文档序小）= 右
    const d = doc(
      [node("root"), node("c1"), node("c2"), node("x")],
      [
        ["root", "c1"],
        ["root", "c2"],
        ["c1", "x"],
        ["c2", "x"],
      ],
    );
    const pos = ok(organize(d, { direction: "balanced" }));
    expect(P(pos, "x").x).toBeGreaterThan(P(pos, "root").x);
  });

  it("主根不可达子图回退右侧横向排布", () => {
    const d = doc(
      [node("root"), node("c1"), node("other"), node("oc1")],
      [
        ["root", "c1"],
        ["other", "oc1"],
      ],
    );
    const pos = ok(organize(d, { direction: "balanced" }));
    const root = P(pos, "root");
    // other 是另一源（第 0 层，与 root 同列或右侧）；oc1 必在右侧
    expect(P(pos, "oc1").x).toBeGreaterThan(root.x);
    expect(P(pos, "other").x).toBeGreaterThanOrEqual(root.x);
  });

  it("环降级不崩溃且坐标确定", () => {
    const d = doc(
      [node("root"), node("a"), node("b")],
      [
        ["root", "a"],
        ["a", "b"],
        ["b", "a"],
      ],
    );
    const pos = ok(organize(d, { direction: "balanced" }));
    expect(pos.size).toBe(3);
    for (const p of pos.values()) expect(p.x).toBeGreaterThanOrEqual(0);
  });

  it("孤立节点在主图下方成行；全孤立文档自 0 起排", () => {
    const d = doc(
      [node("root"), node("c1"), node("c2"), node("lonely")],
      [
        ["root", "c1"],
        ["root", "c2"],
      ],
    );
    const pos = ok(organize(d, { direction: "balanced" }));
    const lonely = P(pos, "lonely");
    const mainBottom = Math.max(...["root", "c1", "c2"].map((id) => P(pos, id).y + 40));
    expect(lonely.y).toBeGreaterThan(mainBottom);

    const orphanOnly = ok(organize(doc([node("x"), node("y")], []), { direction: "balanced" }));
    expect(P(orphanOnly, "x").y).toBe(0);
    expect(P(orphanOnly, "y").y).toBe(0);
  });

  it("确定性：边数组序置换不影响结果", () => {
    const edges: Array<[string, string]> = [
      ["root", "c1"],
      ["root", "c2"],
      ["root", "c3"],
      ["c1", "g1"],
      ["c2", "g2"],
    ];
    const nodes = ["root", "c1", "c2", "c3", "g1", "g2"].map((id) => node(id));
    const a = ok(organize(doc(nodes, edges), { direction: "balanced" }));
    const b = ok(organize(doc(nodes, [...edges].reverse()), { direction: "balanced" }));
    for (const n of nodes) expect(P(a, n.id)).toEqual(P(b, n.id));
  });

  it("无矩形重叠（含左右支混合）", () => {
    const d = star(8);
    const pos = ok(organize(d, { direction: "balanced" }));
    const nodes = d.document.nodes;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const pa = P(pos, a.id);
        const pb = P(pos, b.id);
        const overlap =
          pa.x < pb.x + b.size.width &&
          pb.x < pa.x + a.size.width &&
          pa.y < pb.y + b.size.height &&
          pb.y < pa.y + a.size.height;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it("organizeCommand：balanced 重复整理幂等（no-op）", () => {
    const d = star(5);
    const first = organizeCommand(d, { direction: "balanced" });
    expect(first.status).toBe("moved");
    if (first.status !== "moved") return;
    // 应用移动后再整理应 no-op
    const movedDoc = doc(
      d.document.nodes.map((n) => {
        const mv =
          first.command.kind === "MoveNodes"
            ? first.command.moves.find((m) => m.id === n.id)
            : undefined;
        return mv ? { ...n, position: mv.position } : n;
      }),
      d.document.edges.map((e) => [e.sourceNodeId, e.targetNodeId]),
    );
    expect(organizeCommand(movedDoc, { direction: "balanced" }).status).toBe("no-op");
  });
});
