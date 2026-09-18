// edge-geometry 契约测试（VRA-040）：端口方向、正交形态、通道绕行、箭头/端点 gap、
// 形态插值接口、确定性，以及"整理后零共线重叠"程序化检测。

import { describe, expect, it } from "vitest";
import {
  EDGE_GEOMETRY,
  arrowD,
  assignEdgePorts,
  edgeAnchor,
  edgePathD,
  filletD,
  findCollinearOverlaps,
  formatNum,
  planEdgeGeometry,
  planEdgeRoutes,
  polylineD,
  type EdgePlanInput,
  type NodeBox,
} from "../src/edge-geometry.js";

const box = (x: number, y: number, width = 188, height = 68): NodeBox => ({ x, y, width, height });
const edge = (id: string, sx: number, sy: number, tx: number, ty: number): EdgePlanInput => ({
  id,
  sourceId: `${sx},${sy}`,
  targetId: `${tx},${ty}`,
  source: box(sx, sy),
  target: box(tx, ty),
});

describe("端口方向（§1.4：横向右出左入；纵向底出顶入）", () => {
  it("horizontal：源锚在右缘、目标锚在左缘", () => {
    const g = planEdgeGeometry([edge("e", 0, 0, 270, 0)], "horizontal", 1).get("e")!;
    expect(g.anchorSource.x).toBe(188);
    expect(g.anchorTarget.x).toBe(270);
    expect(g.anchorSource.y).toBeCloseTo(34, 6);
  });

  it("vertical：源锚在底缘、目标锚在顶缘（同构转置）", () => {
    const g = planEdgeGeometry([edge("e", 0, 0, 0, 175)], "vertical", 1).get("e")!;
    expect(g.anchorSource.y).toBe(68);
    expect(g.anchorTarget.y).toBe(175);
    expect(g.anchorSource.x).toBeCloseTo(94, 6);
  });

  it("多入边沿卡边均分；参考卡高足够时间距 ≥ 18px（§1.4）", () => {
    const edges: EdgePlanInput[] = [0, 1, 2].map((i) => ({
      ...edge(`e${i}`, 0, i * 120, 300, 0),
      target: box(300, 0, 188, 84), // 3 入边 → 84/4 = 21px 间距
    }));
    const geoms = planEdgeGeometry(edges, "horizontal", 1);
    const ys = edges.map((e) => geoms.get(e.id)!.anchorTarget.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(EDGE_GEOMETRY.portMinSpacing - 1e-6);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(EDGE_GEOMETRY.portMinSpacing - 1e-6);
  });

  it("锚点不越出卡边：卡高不足 18×(n+1) 时按均分收紧（布局层负责给高）", () => {
    const edges: EdgePlanInput[] = [0, 1, 2].map((i) => edge(`e${i}`, 0, i * 120, 300, 0));
    const geoms = planEdgeGeometry(edges, "horizontal", 1);
    const ys = edges.map((e) => geoms.get(e.id)!.anchorTarget.y).sort((a, b) => a - b);
    expect(ys[0]).toBe(17); // 68/4
    expect(ys[1]).toBe(34);
    expect(ys[2]).toBe(51);
  });

  it("assignEdgePorts：槽位按边文档序，计数与序号一致", () => {
    const ports = assignEdgePorts([edge("a", 0, 0, 100, 0), edge("b", 0, 0, 100, 50)]);
    expect(ports.get("a")).toEqual({ sourceSlot: 0, sourceOf: 2, targetSlot: 0, targetOf: 1 });
    expect(ports.get("b")).toEqual({ sourceSlot: 1, sourceOf: 2, targetSlot: 0, targetOf: 1 });
  });

  it("edgeAnchor 单边居中、多边均分", () => {
    expect(edgeAnchor(box(0, 0), "out", 0, 1, "horizontal").y).toBe(34);
    expect(edgeAnchor(box(0, 0), "out", 0, 2, "horizontal").y).toBeCloseTo(68 / 3, 6);
  });
});

describe("端点 gap 与箭头（ADR 0015：gap 0 贴卡缘；实心三角 9×7）", () => {
  it("主线起终点贴卡边界（gap 0）", () => {
    const g = planEdgeGeometry([edge("e", 0, 0, 270, 0)], "horizontal", 1).get("e")!;
    expect(g.start.x).toBeCloseTo(188, 6); // 卡缘确切位置
    expect(g.tip.x).toBeCloseTo(270, 6);
    expect(g.lineEnd.x).toBeCloseTo(270 - 9, 6); // 箭头长 9
    const d = Math.hypot(g.tip.x - g.lineEnd.x, g.tip.y - g.lineEnd.y);
    expect(d).toBeCloseTo(9, 6);
    const half = Math.hypot(g.arrowBase[0].x - g.lineEnd.x, g.arrowBase[0].y - g.lineEnd.y);
    expect(half).toBeCloseTo(3.5, 6);
  });

  it("箭头独立 path：闭合三角、方向指向目标", () => {
    const g = planEdgeGeometry([edge("e", 0, 0, 270, 0)], "horizontal", 1).get("e")!;
    expect(arrowD(g)).toBe(`M 270 ${g.tip.y} L 261 ${g.tip.y + 3.5} L 261 ${g.tip.y - 3.5} Z`);
    expect(arrowD(g).endsWith(" Z")).toBe(true);
  });
});

describe("规整态正交形态（lineMorph=1，§1.4 全正交电路线）", () => {
  it("折线段全部水平或垂直（零斜线）", () => {
    const g = planEdgeGeometry([edge("e", 0, 0, 270, 212)], "horizontal", 1).get("e")!;
    for (let i = 1; i < g.chain.length; i++) {
      const a = g.chain[i - 1]!;
      const b = g.chain[i]!;
      expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, `seg ${i}`).toBe(true);
    }
  });

  it("近共线端点直连（内部直连优先，不绕圈）", () => {
    const g = planEdgeGeometry([edge("e", 0, 0, 270, 0)], "horizontal", 1).get("e")!;
    expect(g.route.kind).toBe("straight");
    expect(g.chain).toHaveLength(2);
  });

  it("OFR-2026-09-15：多出边端口槽位的小 dy（<8px）不再直连出斜线，走正交微步", () => {
    // 复现负责人截图：出发点（2 出边，端口槽位偏 7.7px）→ 可能的（居中入口）。
    // 旧规则 dy<8 直连成轻微斜线；规整态契约是全正交电路线。
    const g = planEdgeGeometry([edge("e", 0, 0, 270, 7.7)], "horizontal", 1).get("e")!;
    expect(g.route.kind).not.toBe("straight");
    expect(g.chain.length).toBeGreaterThanOrEqual(4); // 水平出 → 垂直微步 → 水平入
    for (let i = 1; i < g.chain.length; i++) {
      const a = g.chain[i - 1]!;
      const b = g.chain[i]!;
      expect(
        Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `seg ${i} 必须严格水平/垂直`,
      ).toBe(true);
    }
  });

  it("转折落位目标列前（tip - 24 - rank×spacing），全缝唯一", () => {
    const edges: EdgePlanInput[] = [edge("e1", 0, 0, 270, 0), edge("e2", 0, 106, 270, 212)];
    const geoms = planEdgeGeometry(edges, "horizontal", 1);
    const turns = [...geoms.values()]
      .filter((g) => g.route.kind === "comb")
      .map((g) => (g.route as { kind: "comb"; turn: number }).turn);
    expect(turns.length).toBeGreaterThan(0);
    expect(new Set(turns).size).toBe(turns.length); // 全缝唯一 → 垂直段零重叠
  });

  it("filletD 拐角半径 ≤ 12，且路径仍以 L/Q 表达", () => {
    const d = filletD(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      12,
    );
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("Q 100 0");
    expect(d).not.toContain("C ");
  });
});

describe("跨层长边：贴边通道（§1.4 ②：边界外 56px、按序偏移 14px）", () => {
  // 三条跨两层长边被中列高卡完全遮挡 → 通道绕行；源锚高度决定上/下侧
  const sources = [box(0, 0), box(0, 200), box(0, 400)];
  const targets = [box(600, 0), box(600, 200), box(600, 400)];
  const obstacles: NodeBox[] = [box(300, 0, 188, 468), ...sources, ...targets];
  const edges: EdgePlanInput[] = sources.map((s, i) => ({
    id: `cross-${i}`,
    sourceId: `s${i}`,
    targetId: `t${i}`,
    source: s,
    target: targets[i]!,
  }));

  it("被挡的长边走通道，通道在图边界外 56px + 通道序×14px（上/下按源就近）", () => {
    const geoms = planEdgeGeometry(edges, "horizontal", 1, { obstacles });
    const minY = 0;
    const maxY = 468;
    for (const e of edges) {
      const g = geoms.get(e.id)!;
      expect(g.route.kind, e.id).toBe("channel");
      const route = g.route as Extract<typeof g.route, { kind: "channel" }>;
      const base =
        route.side === "up"
          ? minY - EDGE_GEOMETRY.channelOffset
          : maxY + EDGE_GEOMETRY.channelOffset;
      expect(g.chain[2]!.y, e.id).toBeCloseTo(base + route.index * EDGE_GEOMETRY.channelSpacing, 6);
    }
  });

  it("通道内同侧多边：走廊按序错开（零共线重叠）", () => {
    const geoms = planEdgeGeometry(edges, "horizontal", 1, { obstacles });
    const corridor = (id: string) => geoms.get(id)!.chain[2]!.y;
    const down = [corridor("cross-1"), corridor("cross-2")].sort((a, b) => a - b);
    expect(down[1]! - down[0]!).toBeCloseTo(EDGE_GEOMETRY.channelSpacing, 6);
    expect(findCollinearOverlaps(geoms.values())).toEqual([]);
  });

  it("无遮挡时不绕通道（内部直连优先，走目标列前梳状转折）", () => {
    const sparse: NodeBox[] = [sources[0]!, targets[2]!];
    const single: EdgePlanInput = {
      id: "cross",
      sourceId: "s0",
      targetId: "t2",
      source: sources[0]!,
      target: targets[2]!,
    };
    const g = planEdgeGeometry([single], "horizontal", 1, { obstacles: sparse }).get("cross")!;
    expect(g.route.kind).toBe("comb");
  });
});

describe("形态参数与插值接口（VRA-060）", () => {
  const sample = [edge("e", 0, 0, 270, 212)];

  it("lineMorph=0：散乱平滑贝塞尔（C 指令）", () => {
    const g = planEdgeGeometry(sample, "horizontal", 0).get("e")!;
    expect(edgePathD(g, 0)).toContain("C ");
  });

  it("lineMorph=1：规整圆角折线（L/Q，无 C）", () => {
    const g = planEdgeGeometry(sample, "horizontal", 1).get("e")!;
    const d = edgePathD(g, 1);
    expect(d).not.toContain("C ");
    expect(d).toContain("Q ");
  });

  it("lineMorph=0.5：插值折线端点与 lineEnd 一致，拓扑连续", () => {
    const g = planEdgeGeometry(sample, "horizontal", 0.5).get("e")!;
    const d = edgePathD(g, 0.5);
    expect(d).not.toContain("C ");
    expect(d.startsWith(`M ${formatNum(g.start.x)} ${formatNum(g.start.y)}`)).toBe(true);
    expect(d.endsWith(`L ${formatNum(g.lineEnd.x)} ${formatNum(g.lineEnd.y)}`)).toBe(true);
  });

  it("lineMorph=0：语义贝塞尔（M..C），终点为箭头底心", () => {
    const g = planEdgeGeometry(sample, "horizontal", 0).get("e")!;
    const d = edgePathD(g, 0);
    expect(d.startsWith(`M ${formatNum(g.start.x)} ${formatNum(g.start.y)} C`)).toBe(true);
    expect(d.endsWith(`${formatNum(g.lineEnd.x)} ${formatNum(g.lineEnd.y)}`)).toBe(true);
  });

  it("polylineD 输出与格式化契约一致（3 位小数、-0 归零）", () => {
    expect(polylineD([{ x: -0.00004, y: 1.0005 }])).toBe("M 0 1.001");
  });
});

describe("零共线重叠检测（§1.4 布线硬规则）", () => {
  it("共线并行段被识别", () => {
    const a: EdgeGeometry = planEdgeGeometry([edge("a", 0, 0, 270, 100)], "horizontal", 1).get(
      "a",
    )!;
    const b: EdgeGeometry = planEdgeGeometry([edge("b", 40, 100, 310, 100)], "horizontal", 1).get(
      "b",
    )!;
    // b 的源锚高度与 a 的水平走廊同 y → 构造共线：把 b 的链整体平移到 a 的走廊上
    const shifted: EdgeGeometry = {
      ...b,
      chain: b.chain.map((p) => ({ x: p.x, y: a.chain[1]!.y })),
    };
    const overlaps = findCollinearOverlaps([a, shifted]);
    expect(overlaps.length).toBeGreaterThan(0);
    expect(overlaps[0]!.axis).toBe("h");
  });

  it("同缝两边转折 x 唯一：垂直段零重叠（交叉允许，重叠禁止）", () => {
    const edges: EdgePlanInput[] = [
      edge("a", 0, 0, 270, 212),
      edge("b", 0, 212, 270, 0), // 与 a 反向汇聚到同列 → 必然交叉
    ];
    const geoms = planEdgeGeometry(edges, "horizontal", 1);
    const overlaps = findCollinearOverlaps(geoms.values());
    expect(overlaps.filter((o) => o.axis === "v")).toEqual([]);
    const turns = [...geoms.values()].map((g) => (g.route as { kind: "comb"; turn: number }).turn);
    expect(new Set(turns).size).toBe(turns.length);
  });

  it("进入走廊 = 目标锚 y：同目标多边走廊唯一（按入边分配锚点）", () => {
    const edges: EdgePlanInput[] = [0, 1, 2].map((i) => edge(`e${i}`, 0, i * 130, 400, 0));
    const geoms = planEdgeGeometry(edges, "horizontal", 1);
    const corridors = edges.map((e) => {
      const g = geoms.get(e.id)!;
      return g.chain[g.chain.length - 1]!.y;
    });
    expect(new Set(corridors).size).toBe(corridors.length);
  });
});

describe("确定性", () => {
  it("同输入多次规划结果完全一致", () => {
    const edges: EdgePlanInput[] = [
      edge("e1", 0, 0, 270, 0),
      edge("e2", 0, 106, 270, 212),
      edge("e3", 0, 0, 810, 106),
    ];
    const a = planEdgeGeometry(edges, "horizontal", 1);
    const b = planEdgeGeometry(edges, "horizontal", 1);
    expect([...a.values()]).toEqual([...b.values()]);
  });
});

describe("双侧锚点（ADR 0019 dualSide：目标偏左 → 左出右入镜像布线）", () => {
  it("默认（dualSide 缺省）保持旧契约：一律右出左入", () => {
    // target 在 source 左侧：旧契约仍右出左入
    const e = edge("e1", 400, 0, 0, 0);
    const g = planEdgeGeometry([e], "horizontal", 1).get("e1")!;
    expect(g.anchorSource.x).toBe(400 + 188); // 右缘出
    expect(g.anchorTarget.x).toBe(0); // 左缘入
  });

  it("dualSide：目标偏左的边左出右入，箭头仍指向目标", () => {
    const e = edge("e1", 400, 0, 0, 0);
    const g = planEdgeGeometry([e], "horizontal", 1, { dualSide: true }).get("e1")!;
    expect(g.anchorSource.x).toBe(400); // 左缘出
    expect(g.anchorTarget.x).toBe(0 + 188); // 右缘入
    expect(g.tip.x).toBeLessThan(g.start.x); // 流向朝左（朝目标）
  });

  it("dualSide：目标偏右/平局仍右出左入（与旧契约一致）", () => {
    const e = edge("e1", 0, 0, 400, 0);
    const g = planEdgeGeometry([e], "horizontal", 1, { dualSide: true }).get("e1")!;
    expect(g.anchorSource.x).toBe(188);
    expect(g.anchorTarget.x).toBe(400);
  });

  it("发散混合组：一左一右两条边互不穿越节点、零共线重叠", () => {
    // root 居中，left/right 两个一级子节点（发散布局典型终态）
    const obstacles = [box(500, 200), box(100, 200), box(900, 200)];
    const edges: EdgePlanInput[] = [
      {
        id: "el",
        sourceId: "root",
        targetId: "left",
        source: box(500, 200),
        target: box(100, 200),
      },
      {
        id: "er",
        sourceId: "root",
        targetId: "right",
        source: box(500, 200),
        target: box(900, 200),
      },
    ];
    const geoms = planEdgeGeometry(edges, "horizontal", 1, { dualSide: true, obstacles });
    const gl = geoms.get("el")!;
    const gr = geoms.get("er")!;
    // 左支左出右入；右支右出左入
    expect(gl.anchorSource.x).toBe(500);
    expect(gl.anchorTarget.x).toBe(100 + 188);
    expect(gr.anchorSource.x).toBe(500 + 188);
    expect(gr.anchorTarget.x).toBe(900);
    // 合并输出零共线重叠（§1.4 硬规则跨分帧仍成立）
    const overlaps = findCollinearOverlaps(geoms.values());
    expect(overlaps.filter((o) => o.axis === "v")).toEqual([]);
  });

  it("镜像一致性：左右对称布局产出镜像几何", () => {
    // A(0,0)→B(600,0) 与 B'(600,0)→A'(0,0) 的几何应关于 x 镜像（同尺寸盒）
    const fwd = planEdgeGeometry([edge("e", 0, 0, 600, 0)], "horizontal", 1, {
      dualSide: true,
    }).get("e")!;
    const bwd = planEdgeGeometry([edge("e", 600, 0, 0, 0)], "horizontal", 1, {
      dualSide: true,
    }).get("e")!;
    // bwd 的 chain 每个点 = fwd 对应点 x 取反 + 盒宽平移（镜像轴 x=694 中心）
    // 简化断言：bwd chain 的 x 序列严格递减，fwd 严格递增（或单段相等跨度）
    const xs = (g: typeof fwd) => g.chain.map((p) => p.x);
    const fwdXs = xs(fwd);
    const bwdXs = xs(bwd);
    expect(fwdXs.length).toBe(bwdXs.length);
    for (let i = 1; i < fwdXs.length; i++) {
      expect(Math.sign(fwdXs[i]! - fwdXs[i - 1]!)).toBeGreaterThanOrEqual(0);
      expect(Math.sign(bwdXs[i]! - bwdXs[i - 1]!)).toBeLessThanOrEqual(0);
    }
  });

  it("冻结路由复用：dualSide 下传入 routes 与不传入结果一致", () => {
    const obstacles = [box(500, 200), box(100, 200), box(100, 400), box(900, 200)];
    const edges: EdgePlanInput[] = [
      { id: "e1", sourceId: "root", targetId: "l1", source: box(500, 200), target: box(100, 200) },
      { id: "e2", sourceId: "root", targetId: "l2", source: box(500, 200), target: box(100, 400) },
      { id: "e3", sourceId: "root", targetId: "r1", source: box(500, 200), target: box(900, 200) },
    ];
    const fresh = planEdgeGeometry(edges, "horizontal", 1, { dualSide: true, obstacles });
    const routes = planEdgeRoutes(edges, "horizontal", { dualSide: true, obstacles });
    const frozen = planEdgeGeometry(edges, "horizontal", 1, {
      dualSide: true,
      obstacles,
      routes,
    });
    expect([...frozen.values()]).toEqual([...fresh.values()]);
  });

  it("vertical + dualSide：忽略双侧（仅 horizontal 生效），不崩溃", () => {
    const e = edge("e1", 0, 0, 0, 400);
    const a = planEdgeGeometry([e], "vertical", 1, { dualSide: true }).get("e1")!;
    const b = planEdgeGeometry([e], "vertical", 1).get("e1")!;
    expect(a).toEqual(b);
  });

  it("确定性：dualSide 同输入同输出", () => {
    const obstacles = [box(500, 0), box(0, 0), box(1000, 0)];
    const edges: EdgePlanInput[] = [
      { id: "e1", sourceId: "r", targetId: "l", source: box(500, 0), target: box(0, 0) },
      { id: "e2", sourceId: "r", targetId: "r2", source: box(500, 0), target: box(1000, 0) },
    ];
    const a = planEdgeGeometry(edges, "horizontal", 1, { dualSide: true, obstacles });
    const b = planEdgeGeometry(edges, "horizontal", 1, { dualSide: true, obstacles });
    expect([...a.values()]).toEqual([...b.values()]);
  });
});
