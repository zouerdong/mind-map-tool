// VRA-030：DAG 分层布局（横向默认/纵向可选）测试。
// 覆盖任务卡必测反例：边序置换稳定性、diamond、多根汇聚、参考 DAG、环/双向边/
// 无边/单节点/负起始坐标、不同尺寸、300/450、10k 单链结构化失败、幂等、无重叠、层约束。

import { describe, expect, it } from "vitest";
import { ORGANIZE_GAPS, organize, organizeCommand } from "./organize.js";
import type { MindMapDocumentV1, MindMapDocumentData, MindNode } from "./schema.js";

function node(id: string, x: number, y: number, w = 100, h = 40, text = id): MindNode {
  return { id, text, position: { x, y }, size: { width: w, height: h } };
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
function posKey(result: ReturnType<typeof organize>): Map<string, string> {
  if (!result.ok) throw new Error("expected ok");
  const m = new Map<string, string>();
  for (const [id, p] of result.positions) m.set(id, `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
  return m;
}
/** 解包 ok 结果（测试内联断言用）。 */
function ok(result: ReturnType<typeof organize>): Map<string, { x: number; y: number }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.positions;
}
const P = (positions: Map<string, { x: number; y: number }>, id: string) => {
  const p = positions.get(id);
  if (!p) throw new Error(`missing position for ${id}`);
  return p;
};
function rectsOverlap(
  a: MindNode,
  pa: { x: number; y: number },
  b: MindNode,
  pb: { x: number; y: number },
): boolean {
  return (
    pa.x < pb.x + b.size.width &&
    pb.x < pa.x + a.size.width &&
    pa.y < pb.y + b.size.height &&
    pb.y < pa.y + a.size.height
  );
}
/** 通用断言：全节点恰好一次、坐标 finite、无矩形重叠。 */
function expectLayoutInvariants(
  nodes: MindNode[],
  positions: Map<string, { x: number; y: number }>,
) {
  expect(positions.size).toBe(nodes.length);
  for (const n of nodes) {
    const p = positions.get(n.id)!;
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      expect(
        rectsOverlap(nodes[i]!, P(positions, nodes[i]!.id), nodes[j]!, P(positions, nodes[j]!.id)),
      ).toBe(false);
    }
  }
}

describe("organize：层级与汇聚", () => {
  it("三角 DAG a→c,a→b,b→c：a=层0、b=层1、c=层2（最长路径；跨层边 a→c 不把 c 拉回）", () => {
    const d = doc(
      [node("a", 0, 0), node("b", 50, 200), node("c", 100, 400)],
      [
        ["a", "c"],
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const p = ok(organize(d));
    expect(p.get("a")).toEqual({ x: 0, y: 0 });
    expect(p.get("b")).toEqual({ x: 100 + ORGANIZE_GAPS.layerGap, y: 0 }); // 层1
    expect(P(p, "c").x).toBe(100 * 2 + ORGANIZE_GAPS.layerGap * 2); // 层2：c 在 b 严格之后
    expectLayoutInvariants(d.document.nodes, p);
  });

  it("全部 6 种边顺序置换产生完全相同布局（边序无关）", () => {
    const base = doc(
      [node("a", 0, 0), node("b", 50, 200), node("c", 100, 400)],
      [
        ["a", "c"],
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const expected = posKey(organize(base));
    const perms: Array<Array<[string, string]>> = [
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "c"],
      ],
      [
        ["a", "b"],
        ["b", "c"],
        ["a", "c"],
      ],
      [
        ["a", "c"],
        ["b", "c"],
        ["a", "b"],
      ],
      [
        ["b", "c"],
        ["a", "b"],
        ["a", "c"],
      ],
      [
        ["b", "c"],
        ["a", "c"],
        ["a", "b"],
      ],
    ];
    for (const edges of perms) {
      const d = doc([node("a", 0, 0), node("b", 50, 200), node("c", 100, 400)], edges);
      expect(posKey(organize(d))).toEqual(expected);
    }
  });

  it("diamond：a→b,a→c,b→d,c→d → b/c 同层，d 严格靠后", () => {
    const d = doc(
      [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0), node("d", 0, 0)],
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ],
    );
    const p = ok(organize(d));
    expect(P(p, "b").x).toBe(P(p, "c").x); // 同层同列
    expect(P(p, "b").y).toBeLessThan(P(p, "c").y); // 层内堆叠有序
    expect(P(p, "d").x).toBeGreaterThan(P(p, "b").x);
    expectLayoutInvariants(d.document.nodes, p);
  });

  it("多根汇聚：两个根都指向同一汇聚节点，汇聚放一次且严格靠后", () => {
    const d = doc(
      [node("r1", 0, 0), node("r2", 0, 0), node("s", 0, 0)],
      [
        ["r1", "s"],
        ["r2", "s"],
      ],
    );
    const p = ok(organize(d));
    expect(P(p, "r1").x).toBe(P(p, "r2").x);
    expect(P(p, "s").x).toBeGreaterThan(P(p, "r1").x);
    expect(p.size).toBe(3); // s 恰好一次
  });

  it("与当前坐标无关：同拓扑不同散乱输入（含负坐标）结果相同", () => {
    const nodesA = [node("a", -140, 60), node("b", 620, -90), node("c", 990, 330)];
    const nodesB = [node("a", 0, 0), node("b", 10, 10), node("c", 20, 20)];
    const edges: Array<[string, string]> = [
      ["a", "b"],
      ["b", "c"],
    ];
    expect(posKey(organize(doc(nodesA, edges)))).toEqual(posKey(organize(doc(nodesB, edges))));
  });
});

describe("organize：环与孤立", () => {
  it("双向边/环：SCC 分量内同层并排，不删除不翻向（边数不变）", () => {
    const d = doc(
      [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)],
      [
        ["a", "b"],
        ["b", "a"],
        ["b", "c"],
      ],
    );
    const p = ok(organize(d));
    expect(P(p, "a").x).toBe(P(p, "b").x); // a↔b 同一分量 → 同层
    expect(P(p, "c").x).toBeGreaterThan(P(p, "a").x); // 分量 → c 严格靠后
    expectLayoutInvariants(d.document.nodes, p);
  });

  it("三节点环：全部同层并排", () => {
    const d = doc(
      [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ],
    );
    const p = ok(organize(d));
    expect(P(p, "a").x).toBe(P(p, "b").x);
    expect(P(p, "b").x).toBe(P(p, "c").x);
  });

  it("孤立节点：横向在主图下方成行、首项左齐第一层；纵向在右侧成列、首项顶齐第一层", () => {
    const d = doc(
      [node("a", 0, 0), node("b", 0, 0), node("iso1", 0, 0), node("iso2", 0, 0)],
      [["a", "b"]],
    );
    const h = ok(organize(d, { direction: "horizontal" }));
    expect(P(h, "iso1").x).toBe(0); // 首项左齐第一列
    expect(P(h, "iso1").y).toBe(40 + ORGANIZE_GAPS.orphanGap); // 主图（单节点层，最高堆叠 40）下方
    expect(P(h, "iso2").x).toBe(100 + ORGANIZE_GAPS.intraGap); // 成行（默认横向）
    expectLayoutInvariants(d.document.nodes, h);
    const v = ok(organize(d, { direction: "vertical" }));
    expect(P(v, "iso1").y).toBe(0); // 首项顶齐第一层
    expect(P(v, "iso1").x).toBe(100 + ORGANIZE_GAPS.orphanGap); // 主图（单节点层，最深堆叠 100）右侧
    expect(P(v, "iso2").y).toBe(40 + ORGANIZE_GAPS.intraGap); // 成列
    expectLayoutInvariants(d.document.nodes, v);
  });

  it("无边文档（全孤立）：全部成行/列，无重叠", () => {
    const d = doc([node("a", 0, 0), node("b", 0, 0)], []);
    const p = ok(organize(d));
    expectLayoutInvariants(d.document.nodes, p);
  });

  it("单节点与空文档", () => {
    expect(ok(organize(doc([], []))).size).toBe(0);
    const d = doc([node("only", 5, 5)], []);
    expect(ok(organize(d)).get("only")).toEqual({ x: 0, y: 0 });
  });
});

describe("organize：尺寸感知与参考 DAG", () => {
  it("同层不同尺寸：层内间距按真实高度累计；下一列位置按本列最大宽度", () => {
    // a→b、a→c（b/c 同层堆叠）；b→d（d 在下一列，验证列宽取层内最大宽 120）
    const d = doc(
      [
        node("a", 0, 0, 100, 40),
        node("b", 0, 0, 120, 80),
        node("c", 0, 0, 100, 40),
        node("d", 0, 0, 100, 40),
      ],
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
      ],
    );
    const p = ok(organize(d));
    // 层1（b、c 堆叠，b 先——文档序）：b=(层1x, 0)、c=(层1x, 80+38)
    expect(P(p, "b").y).toBe(0);
    expect(P(p, "c").y).toBe(80 + ORGANIZE_GAPS.intraGap);
    // 列：层0 宽 100 → 层1 x=182；层1 最大宽 120（b）→ 层2 x=182+120+82=384
    expect(P(p, "b").x).toBe(100 + ORGANIZE_GAPS.layerGap);
    expect(P(p, "d").x).toBe(100 + ORGANIZE_GAPS.layerGap + 120 + ORGANIZE_GAPS.layerGap);
    expectLayoutInvariants(d.document.nodes, p);
  });

  it("12 节点/13 边参考 DAG（与 tests/fixtures/visual/reference-dag-12-scattered.json 同拓扑）：全节点一次、无重叠、五层、孤立在下方成行", () => {
    const nodes = [
      node("n-inbox", 640, 660, 188, 68, "收件箱 Inbox"),
      node("n-capture", -140, 60, 188, 68, "捕捉灵感 Capture"),
      node("n-notes", 620, -90, 188, 68, "知识库 Notes"),
      node("n-review-loop", 150, 320, 188, 68, "反馈环 Review loop"),
      node("n-hooks", 960, 190, 188, 68, "自动化 Hooks"),
      node("n-skills", 40, 540, 188, 68, "技能 Skills"),
      node("n-subtasks", 480, 430, 188, 68, "子任务 Subtasks"),
      node("n-evals", 990, 330, 188, 68, "评估 Evals"),
      node("n-design", 810, 580, 230, 84, "需求与设计 Requirements & design"),
      node("n-peer", 100, 730, 188, 68, "同伴审阅 Peer review"),
      node("n-cicd", -80, 400, 188, 68, "持续集成 CI/CD"),
      node("n-close", 420, 750, 230, 84, "闭环收尾 Closing the loop"),
    ];
    const edges: Array<[string, string]> = [
      ["n-capture", "n-design"],
      ["n-capture", "n-close"],
      ["n-notes", "n-skills"],
      ["n-notes", "n-subtasks"],
      ["n-notes", "n-evals"],
      ["n-review-loop", "n-subtasks"],
      ["n-review-loop", "n-evals"],
      ["n-hooks", "n-cicd"],
      ["n-skills", "n-design"],
      ["n-skills", "n-peer"],
      ["n-evals", "n-peer"],
      ["n-peer", "n-cicd"],
      ["n-cicd", "n-close"],
    ];
    const d = doc(nodes, edges);
    const p = ok(organize(d));
    expectLayoutInvariants(nodes, p);
    // 层级（最长路径）：capture0 notes0 review0 hooks0 → skills1 subtasks1 evals1 → design2 peer2 → cicd3 → close4
    const col = (id: string) => p.get(id)!.x;
    expect(col("n-design")).toBeGreaterThan(col("n-skills"));
    expect(col("n-close")).toBeGreaterThan(col("n-cicd"));
    expect(col("n-cicd")).toBeGreaterThan(col("n-peer"));
    // 孤立 inbox 在主图下方
    const maxY = Math.max(...nodes.filter((n) => n.id !== "n-inbox").map((n) => p.get(n.id)!.y));
    expect(P(p, "n-inbox").y).toBeGreaterThan(maxY);
  });
});

describe("organize：规模与失败", () => {
  it("300 节点/450 边（确定性生成）：全节点一次、无重叠、有限坐标", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const nodes: MindNode[] = Array.from({ length: 300 }, (_, i) =>
      node(
        `n${i}`,
        Math.floor(rand() * 2000) - 500,
        Math.floor(rand() * 2000) - 500,
        100 + Math.floor(rand() * 60),
        40,
      ),
    );
    const edges: Array<[string, string]> = [];
    const seen = new Set<string>();
    while (edges.length < 450) {
      const s = Math.floor(rand() * 299); // 只向后连（i<j）保证 DAG 可分层
      const t = s + 1 + Math.floor(rand() * (299 - s));
      const key = `${s} ${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([`n${s}`, `n${t}`]);
    }
    const p = ok(organize(doc(nodes, edges)));
    expectLayoutInvariants(nodes, p);
  });

  it("10,000 节点单链：不栈溢出，超出坐标上限返回结构化 COORD_LIMIT，不产坐标", () => {
    const nodes: MindNode[] = Array.from({ length: 10_000 }, (_, i) => node(`c${i}`, 0, 0));
    const edges: Array<[string, string]> = Array.from(
      { length: 9_999 },
      (_, i) => [`c${i}`, `c${i + 1}`] as [string, string],
    );
    const result = organize(doc(nodes, edges));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("COORD_LIMIT");
      expect(result.error.span).toBeGreaterThan(result.error.max);
    }
    const cmd = organizeCommand(doc(nodes, edges));
    expect(cmd.status).toBe("error");
  });
});

describe("organizeCommand：命令契约", () => {
  it("散乱 → moved：单条 MoveNodes 覆盖全部变化节点；再跑 → no-op", () => {
    const d = doc([node("a", 999, 999), node("b", -50, -50)], [["a", "b"]]);
    const first = organizeCommand(d);
    expect(first.status).toBe("moved");
    if (first.status !== "moved") return;
    expect(first.command.kind).toBe("MoveNodes");
    if (first.command.kind !== "MoveNodes") return;
    expect(first.command.moves.length).toBe(2);
    // 应用后重跑 = no-op（幂等）
    const moves = first.command.kind === "MoveNodes" ? first.command.moves : [];
    const applied: MindMapDocumentV1 = {
      ...d,
      document: {
        ...d.document,
        nodes: d.document.nodes.map((n) => ({
          ...n,
          position: moves.find((m) => m.id === n.id)?.position ?? n.position,
        })),
      },
    };
    expect(organizeCommand(applied).status).toBe("no-op");
  });

  it("已就位 → no-op（不产生命令）", () => {
    // 默认横向：a 层0 (0,0)、b 层1 (100+layerGap, 0)
    const d = doc([node("a", 0, 0), node("b", 100 + ORGANIZE_GAPS.layerGap, 0)], [["a", "b"]]);
    expect(organizeCommand(d).status).toBe("no-op");
  });

  it("布局不改文本/样式/尺寸/边，不改未列节点；默认横向、可选纵向", () => {
    const d = doc([node("a", 7, 7, 120, 50), node("b", 9, 9)], [["a", "b"]]);
    const h = ok(organize(d));
    const v = ok(organize(d, { direction: "vertical" }));
    // 转置关系（对称）
    expect(P(v, "a").x).toBe(P(h, "a").y);
    expect(P(v, "a").y).toBe(P(h, "a").x);
    // 文档未被改动
    expect(d.document.nodes[0]!.text).toBe("a");
    expect(d.document.edges.length).toBe(1);
  });
});
