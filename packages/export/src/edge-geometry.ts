// 边几何契约（VRA-040 ②）：端点、端口分配、路由、路径段与箭头的唯一派生源。
// UI 与三格式导出消费同一几何；PDF 不另猜曲线或圆角。
// 形态：lineMorph 0 = 散乱平滑贝塞尔；1 = 规整全正交圆角折线（"电路线"）；(0,1) = 冻结拓扑后逐点插值
// （tokens §1.4：两形态在整理动画中连续过渡，VRA-060 消费 chain/controls/route 完成插值）。
// 路由（tokens §1.4 三级策略，移植 tests/visual-prototype/reference-prototype.html 的 planRoutes/elbowPts）：
//   ① 内部直连优先（comb：源锚高度直走到目标列前唯一转折 x，再垂直进入）；
//   ② 被挡才贴边通道（channel：图边界外 56px，通道内按序偏移 14px）；
//   ③ 目标侧梳状转折（turn = tip - 24 - rank×spacing，rank 按目标锚 y 升序 → 全缝唯一）。
// 硬规则：整理后零共线重叠（findCollinearOverlaps 程序化检测，VRA-080 复用）。

import { EDGE_VISUAL } from "./visual-style.js";

/** 布局方向（层轴）：horizontal = 右出左入（G-VIS D7 默认）；vertical = 底出顶入（可选，轴对称转置）。 */
export type LayoutDirection = "horizontal" | "vertical";

export interface Pt {
  x: number;
  y: number;
}

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ChannelSide = "up" | "down" | "left" | "right";

/** 路由拓扑（VRA-060 冻结后插值的单位）。
 *  形状（§1.4 规整态线型）：水平出一小段 → 圆角垂直折 → 水平跨越 → 圆角垂直折 → 水平进入。
 *  exitTurn：引出垂直段位置（源列包络外 6px + 同列出边序×14，跨源也错开）；
 *  turn/entryTurn：进入缝的垂直转折（rank = 同缝进入序：垂直行程短者转折近目标列、
 *  长者靠外——扇出边默认零交叉；通道边与梳状边共用同一序）→ 全缝唯一。 */
export type EdgeRoute =
  | {
      kind: "comb";
      lane: number;
      rank: number;
      spacing: number;
      turn: number;
      exitTurn: number;
    }
  | {
      kind: "channel";
      side: ChannelSide;
      index: number;
      offset: number;
      entryTurn: number;
      exitTurn: number;
    }
  | { kind: "straight" };

export interface EdgePlanInput {
  id: string;
  /** 源/目标节点 id（端口分配按节点计数；自环被 schema 拒绝） */
  sourceId: string;
  targetId: string;
  source: NodeBox;
  target: NodeBox;
  /** 散乱态外弧提示（跨层长边绕图外侧）；规整态由通道路由接管 */
  outerArc?: ChannelSide;
}

/** 双侧路由（ADR 0019）：按端点中心 x 分帧，镜像组 x 取反后走标准横向规划。
 *  镜像组的锚点与路由数值保留在镜像帧（mirrored=true），几何出口处统一镜像回真实坐标。 */
function planEdgeRoutesDualSide(
  edges: readonly EdgePlanInput[],
  context: PlanContext,
): Map<string, RoutedEdge> {
  const obstacles = context.obstacles ?? edges.flatMap((e) => [e.source, e.target]);
  const normal: EdgePlanInput[] = [];
  const mirrored: EdgePlanInput[] = [];
  for (const e of edges) (edgeIsMirrored(e) ? mirrored : normal).push(e);
  const result = new Map<string, RoutedEdge>();
  if (normal.length > 0) {
    const r = planEdgeRoutes(normal, "horizontal", { ...context, dualSide: false, obstacles });
    for (const [id, re] of r) result.set(id, { ...re, mirrored: false });
  }
  if (mirrored.length > 0) {
    const mEdges = mirrored.map((e) => ({
      ...e,
      source: mirrorBoxX(e.source),
      target: mirrorBoxX(e.target),
    }));
    const mObstacles = obstacles.map(mirrorBoxX);
    const r = planEdgeRoutes(mEdges, "horizontal", {
      ...context,
      dualSide: false,
      obstacles: mObstacles,
      bounds: undefined, // 镜像帧 bounds 由镜像 obstacles 重推
    });
    for (const [id, re] of r) {
      const orig = mirrored.find((e) => e.id === id)!;
      result.set(id, { ...re, input: orig, mirrored: true });
    }
  }
  return result;
}

/** 端口分配（同卡多出边/多入边沿卡边均分，边文档序即槽位序 —— 算法可重复）。 */
export interface PortAllocation {
  sourceSlot: number;
  sourceOf: number;
  targetSlot: number;
  targetOf: number;
}

export interface RoutedEdge {
  id: string;
  input: EdgePlanInput;
  ports: PortAllocation;
  /** dualSide 镜像组的锚点/路由处于镜像坐标系（x 取反）；正常组为真实坐标。
   *  冻结路由复用时由 planEdgeGeometry 按当前端点框重新分帧，保持同帧消费。 */
  mirrored?: boolean;
  /** 卡边界锚点（端点 gap 之前） */
  anchorSource: Pt;
  anchorTarget: Pt;
  route: EdgeRoute;
}

export interface EdgeGeometry {
  id: string;
  direction: LayoutDirection;
  route: EdgeRoute;
  anchorSource: Pt;
  anchorTarget: Pt;
  /** 主线起点（源锚 + 进入方向 × gap） */
  start: Pt;
  /** 箭头尖（目标锚 - 进入方向 × gap；指向目标卡边界） */
  tip: Pt;
  /** 主线终点 = tip - enterDir × arrowLength（箭头底边中点，主线不留进箭头内部） */
  lineEnd: Pt;
  /** 进入方向单位向量 */
  enterDir: Pt;
  /** 箭头底边两端点（实心三角，长 9 × 宽 7） */
  arrowBase: [Pt, Pt];
  /** 散乱态三次贝塞尔控制点（相对 lineMorph=0 形态） */
  controls: [Pt, Pt];
  /** 规整态正交折线顶点（含 lineEnd；lineMorph=1 形态） */
  chain: Pt[];
  /** scene bounds 需包含的极值点（控制点/折线顶点/箭头，负坐标与外弧不裁切） */
  extremes: Pt[];
}

/** 路由/端口常量（tokens §1.4；箭头与 gap 数值在 EDGE_VISUAL）。 */
export const EDGE_GEOMETRY = {
  /** 贴边通道与图边界的距离（§1.4 ②：56px） */
  channelOffset: 56,
  /** 通道内多边按序偏移（§1.4 ②：14px） */
  channelSpacing: 14,
  /** 多入/多出边锚点的目标最小间距（§1.4：≥18px）。
   *  实际锚点 = 卡边均分（卡高/(n+1)），不越出卡边；参考卡高 68 且 3 入边时为 17px，
   *  达到 ≥18px 由布局层（VRA-030 按真实尺寸/入边数）保证，路由不截断也不越界。 */
  portMinSpacing: 18,
  /** 目标列入口缝宽基准（organize layerGap=82 同量级；触发通道的跨度阈值 = 缝宽×1.6） */
  seamWidth: 80,
  /** 目标列前垂直转折缩进（§1.4 ③：tip - 24 - rank×spacing） */
  laneInset: 24,
  /** 近共线阈值：端点连线与主轴偏差小于此值时直接直连 */
  nearCollinear: 8,
  /** 直连判定的硬阈值（px）：OFR-2026-09-15 负责人实机反馈——多出边卡的
   *  端口槽位均分产生数 px 的 dy（如卡高 47、2 出边时槽位偏 7.7px），旧
   *  规则（<8px 直连）画出轻微斜线，破坏规整态"全正交电路线"观感。
   *  仅亚像素级偏差（舍入噪声）允许直连；真实 dy 一律走正交圆角微步。 */
  collinearEpsilon: 0.5,
  /** 散乱曲线控制点距离 = 跨度 × 0.4，并夹在 [40,160]（参考原型） */
  scatterK: 0.4,
  scatterKMin: 40,
  scatterKMax: 160,
  /** 散乱态外弧与图边界的距离（参考原型） */
  arcOffset: 120,
  /** 规整态出边水平引出段长度（§1.4：水平出一小段 40px） */
  exitStub: 40,
  /** 同源多出边引出垂直段的错开间距（同通道偏移量纲） */
  exitSpacing: 14,
  /** 形态插值采样段数（VRA-060 冻结拓扑后同帧插值） */
  resampleSegments: 24,
} as const;

export interface PlanContext {
  /** 全图节点框（遮挡检测 obstacles；缺省用边端点框） */
  obstacles?: readonly NodeBox[] | undefined;
  /** 全图边界（贴边通道/外弧基准；缺省由 obstacles 推导） */
  bounds?: GraphBounds | undefined;
  /** 目标列入口缝宽（缺省 EDGE_GEOMETRY.seamWidth） */
  seamWidth?: number | undefined;
  /** 冻结的路由拓扑（动效期间保持通道与拓扑不变，防止离散跳形；缺省由 planEdgeRoutes 计算） */
  routes?: Map<string, RoutedEdge> | undefined;
  /** 双侧锚点（ADR 0019）：仅 horizontal 生效。目标中心在源中心左侧的边走镜像规划
   * （左出右入），其余右出左入；缺省 false = 全部右出左入（旧契约）。 */
  dualSide?: boolean | undefined;
}

export function formatNum(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

function add(p: Pt, dx: number, dy: number): Pt {
  return { x: p.x + dx, y: p.y + dy };
}

/** 平移（scene 的 offX/offY 机制：先在文档坐标规划，再整体平移进画布）。 */
export function translatePt(p: Pt, dx: number, dy: number): Pt {
  return { x: p.x + dx, y: p.y + dy };
}

export function translatePts(pts: readonly Pt[], dx: number, dy: number): Pt[] {
  return pts.map((p) => translatePt(p, dx, dy));
}

// ---------- 双侧锚点（ADR 0019）：镜像坐标系工具 ----------
// 镜像 = x 轴取反（box.x' = -(x+width)，点 x' = -x）。镜像后「左出右入」的边
// 变成标准横向「右出左入」，整体规划完成后再镜像回真实坐标。

/** 双侧分帧判定：目标中心严格在源中心左侧 → 镜像组（左出右入）。平局归正常组。 */
export function edgeIsMirrored(e: Pick<EdgePlanInput, "source" | "target">): boolean {
  return e.target.x + e.target.width / 2 < e.source.x + e.source.width / 2;
}

function mirrorBoxX(b: NodeBox): NodeBox {
  return { x: -(b.x + b.width), y: b.y, width: b.width, height: b.height };
}

function mirrorPtX(p: Pt): Pt {
  return { x: -p.x, y: p.y };
}

/** 几何整体镜像回真实坐标（点/向量/折线/箭头一致变换；route 数值字段保留在规划帧，
 *  下游消费者（冻结路由）按 mirrored 标记同帧复用，不直接读坐标字段）。 */
function mirrorGeometryX(g: EdgeGeometry): EdgeGeometry {
  return {
    ...g,
    anchorSource: mirrorPtX(g.anchorSource),
    anchorTarget: mirrorPtX(g.anchorTarget),
    start: mirrorPtX(g.start),
    tip: mirrorPtX(g.tip),
    lineEnd: mirrorPtX(g.lineEnd),
    enterDir: { x: -g.enterDir.x, y: g.enterDir.y },
    arrowBase: [mirrorPtX(g.arrowBase[0]), mirrorPtX(g.arrowBase[1])],
    controls: [mirrorPtX(g.controls[0]), mirrorPtX(g.controls[1])],
    chain: g.chain.map(mirrorPtX),
    extremes: g.extremes.map(mirrorPtX),
  };
}

function len(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

function unit(dx: number, dy: number): Pt {
  const l = len(dx, dy);
  return l === 0 ? { x: 1, y: 0 } : { x: dx / l, y: dy / l };
}

/** 端口分配：出边/入边分别计数，槽位按边文档序（确定性；与原型 frozenAnchors 同规则）。 */
export function assignEdgePorts(edges: readonly EdgePlanInput[]): Map<string, PortAllocation> {
  const outCnt = new Map<string, number>();
  const inCnt = new Map<string, number>();
  const outIdx = new Map<string, number>();
  const inIdx = new Map<string, number>();
  const result = new Map<string, PortAllocation>();
  for (const e of edges) {
    outCnt.set(e.sourceId, (outCnt.get(e.sourceId) ?? 0) + 1);
    inCnt.set(e.targetId, (inCnt.get(e.targetId) ?? 0) + 1);
  }
  for (const e of edges) {
    const sourceSlot = outIdx.get(e.sourceId) ?? 0;
    outIdx.set(e.sourceId, sourceSlot + 1);
    const targetSlot = inIdx.get(e.targetId) ?? 0;
    inIdx.set(e.targetId, targetSlot + 1);
    result.set(e.id, {
      sourceSlot,
      sourceOf: outCnt.get(e.sourceId)!,
      targetSlot,
      targetOf: inCnt.get(e.targetId)!,
    });
  }
  return result;
}

/** 卡边界锚点：horizontal 右出左入；vertical 底出顶入；多边沿卡边均分（of=1 时居中）。 */
export function edgeAnchor(
  box: NodeBox,
  side: "out" | "in",
  slot: number,
  of: number,
  direction: LayoutDirection,
): Pt {
  const spread = of > 1 ? (slot + 1) / (of + 1) : 0.5;
  if (direction === "horizontal") {
    return {
      x: side === "out" ? box.x + box.width : box.x,
      y: box.y + box.height * spread,
    };
  }
  return {
    x: box.x + box.width * spread,
    y: side === "out" ? box.y + box.height : box.y,
  };
}

export function graphBoundsOf(boxes: readonly NodeBox[]): GraphBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * 路由规划（三级策略；输出端口侧 + 通道 + 转折拓扑）。
 * 确定性：同缝内按目标锚 y（纵向为 x）升序分配 rank，同序号时按边 id 决胜。
 */
export function planEdgeRoutes(
  edges: readonly EdgePlanInput[],
  direction: LayoutDirection,
  context: PlanContext = {},
): Map<string, RoutedEdge> {
  if (direction === "horizontal" && context.dualSide === true) {
    return planEdgeRoutesDualSide(edges, context);
  }
  const obstacles = context.obstacles ?? edges.flatMap((e) => [e.source, e.target]);
  const gb = context.bounds ?? graphBoundsOf(obstacles);
  const seam = Math.max(40, context.seamWidth ?? EDGE_GEOMETRY.seamWidth);
  const ports = assignEdgePorts(edges);
  const routed = new Map<string, RoutedEdge>();

  interface Member {
    id: string;
    key: number; // 目标锚 y（横向）/ x（纵向）：缝内排序键
    src: number; // 源锚 y（横向）/ x（纵向）：垂直行程 = |key - src|
    tie: string;
  }
  const seamGroups = new Map<number, Member[]>(); // 目标列入口（横向 = b.x；纵向 = b.y）
  const channelGroups = new Map<ChannelSide, string[]>();
  const channelLane = new Map<string, number>();
  const exitGroups = new Map<number, Member[]>(); // 同一源列（x0 对齐）的出边：引出垂直段错开

  // 源列包络：同列（x0 对齐）卡片的最右缘 —— 引出垂直段放在包络外，避免穿同列更宽的邻卡
  const columnEdge = new Map<number, number>();
  for (const c of obstacles) {
    const key = Math.round(c.x);
    const extent = direction === "horizontal" ? c.x + c.width : c.y + c.height;
    columnEdge.set(key, Math.max(columnEdge.get(key) ?? -Infinity, extent));
  }

  for (const e of edges) {
    const p = ports.get(e.id)!;
    const a = edgeAnchor(e.source, "out", p.sourceSlot, p.sourceOf, direction);
    const b = edgeAnchor(e.target, "in", p.targetSlot, p.targetOf, direction);
    const span = direction === "horizontal" ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const alongTarget = direction === "horizontal" ? b.y : b.x;
    const lane = direction === "horizontal" ? b.x : b.y;
    let useChannel = span > seam * 1.6;
    if (useChannel) {
      // ① 内部直连走廊遮挡检测：源锚高度到目标列之间无卡 → 不绕通道
      const blocked = obstacles.some((c) =>
        direction === "horizontal"
          ? a.y > c.y + 2 && a.y < c.y + c.height - 2 && c.x + c.width > a.x + 4 && c.x < b.x - 4
          : a.x > c.x + 2 && a.x < c.x + c.width - 2 && c.y + c.height > a.y + 4 && c.y < b.y - 4,
      );
      if (!blocked) useChannel = false;
    }
    // 引出垂直段基准：源列包络外 6px（纵向布局取同列最下缘）
    const sourceKey = Math.round(direction === "horizontal" ? e.source.x : e.source.y);
    const envelope =
      columnEdge.get(sourceKey) ??
      (direction === "horizontal" ? e.source.x + e.source.width : e.source.y + e.source.height);
    const exitBase = envelope + 6;
    let route: EdgeRoute;
    if (useChannel) {
      // ② 贴边通道：按源就近选上/下（横向）或左/右（纵向）
      const side: ChannelSide =
        direction === "horizontal"
          ? a.y < (gb.minY + gb.maxY) / 2
            ? "up"
            : "down"
          : a.x < (gb.minX + gb.maxX) / 2
            ? "left"
            : "right";
      const list = channelGroups.get(side) ?? [];
      list.push(e.id);
      channelGroups.set(side, list);
      channelLane.set(e.id, lane);
      route = {
        kind: "channel",
        side,
        index: 0,
        offset: EDGE_GEOMETRY.channelSpacing,
        entryTurn: 0,
        exitTurn: exitBase,
      };
    } else {
      route = {
        kind: "comb",
        lane,
        rank: 0,
        spacing: EDGE_GEOMETRY.portMinSpacing,
        turn: 0,
        exitTurn: exitBase,
      };
    }
    const member: Member = {
      id: e.id,
      key: alongTarget,
      src: direction === "horizontal" ? a.y : a.x,
      tie: e.id,
    };
    const members = seamGroups.get(lane) ?? [];
    members.push(member);
    seamGroups.set(lane, members);
    // 引出段排序键 = 源锚沿卡边坐标（stub 所在 y/x）；同一源列内全局错开
    const exitMember: Member = {
      id: e.id,
      key: direction === "horizontal" ? a.y : a.x,
      src: 0, // 引出段排序只用 key（源锚坐标），src 不参与
      tie: e.id,
    };
    const exitKey = sourceKey;
    const exit = exitGroups.get(exitKey) ?? [];
    exit.push(exitMember);
    exitGroups.set(exitKey, exit);
    routed.set(e.id, { id: e.id, input: e, ports: p, anchorSource: a, anchorTarget: b, route });
  }

  // ③ 同缝进入序（comb + channel 共用同一序）：垂直行程短者 rank 小（转折近目标列）、
  // 行程长者 rank 大（转折靠外）——长行程垂直段不穿短行程边的进入横段，单侧扇出默认零交叉
  // （ADR 0019 v1.2.0；旧规则按目标锚 y 升序，根居中后上方组会出现"麻花"交叉）。
  // 纯横向/纵向布局中同缝各边行程序与目标锚序一致，行为不变；同距按目标锚升序、再按 id。
  const byTravel = (p: Member, q: Member) =>
    Math.abs(p.key - p.src) - Math.abs(q.key - q.src) ||
    p.key - q.key ||
    (p.tie < q.tie ? -1 : p.tie > q.tie ? 1 : 0);
  const byKey = (p: Member, q: Member) =>
    p.key - q.key || (p.tie < q.tie ? -1 : p.tie > q.tie ? 1 : 0);
  for (const [lane, list] of seamGroups) {
    const ordered = [...list].sort(byTravel);
    const spacing = seamSpacing(ordered.length, seam);
    ordered.forEach((member, rank) => {
      const r = routed.get(member.id)!.route;
      if (r.kind === "comb") {
        r.rank = rank;
        r.spacing = spacing;
      } else if (r.kind === "channel") {
        r.entryTurn = lane - EDGE_GEOMETRY.laneInset - rank * spacing;
      }
    });
  }
  // 通道走廊序（同侧多边按序错开）
  for (const list of channelGroups.values()) {
    list.forEach((id, i) => {
      const r = routed.get(id)!.route;
      if (r.kind === "channel") r.index = i;
    });
  }
  // 引出垂直段：同源列内按源锚坐标依次外移（跨源也不共线）
  for (const list of exitGroups.values()) {
    const ordered = [...list].sort(byKey);
    ordered.forEach((member, i) => {
      const r = routed.get(member.id)!.route;
      if (r.kind === "straight") return;
      r.exitTurn += i * EDGE_GEOMETRY.exitSpacing;
    });
  }
  return routed;
}

/** 同缝进入边的转折间距：缝越挤越密，下限 6px、上限 18px（§1.4 rank×spacing）。 */
function seamSpacing(count: number, seam: number): number {
  return Math.min(
    EDGE_GEOMETRY.portMinSpacing,
    Math.max(6, Math.floor((seam - EDGE_GEOMETRY.laneInset) / (count + 1))),
  );
}

function chainOf(
  p1: Pt,
  tip: Pt,
  route: EdgeRoute,
  direction: LayoutDirection,
  gb: GraphBounds,
): Pt[] {
  const off = EDGE_GEOMETRY.channelOffset;
  if (route.kind === "channel") {
    const k =
      route.side === "up"
        ? gb.minY - (off + route.index * route.offset)
        : route.side === "down"
          ? gb.maxY + (off + route.index * route.offset)
          : route.side === "left"
            ? gb.minX - (off + route.index * route.offset)
            : gb.maxX + (off + route.index * route.offset);
    if (direction === "horizontal") {
      const exitX = Math.max(p1.x + EDGE_GEOMETRY.nearCollinear, route.exitTurn);
      const entryX = Math.max(
        p1.x + EDGE_GEOMETRY.nearCollinear,
        Math.min(route.entryTurn, tip.x - EDGE_GEOMETRY.nearCollinear),
      );
      return [
        p1,
        { x: exitX, y: p1.y },
        { x: exitX, y: k },
        { x: entryX, y: k },
        { x: entryX, y: tip.y },
        tip,
      ];
    }
    const exitY = Math.max(p1.y + EDGE_GEOMETRY.nearCollinear, route.exitTurn);
    const entryY = Math.max(
      p1.y + EDGE_GEOMETRY.nearCollinear,
      Math.min(route.entryTurn, tip.y - EDGE_GEOMETRY.nearCollinear),
    );
    return [
      p1,
      { x: p1.x, y: exitY },
      { x: k, y: exitY },
      { x: k, y: entryY },
      { x: tip.x, y: entryY },
      tip,
    ];
  }
  if (route.kind === "straight") return [p1, tip];
  // 梳状边（§1.4 ③）：水平跨越（源锚 y）→ 垂直折（目标缝内，全缝唯一）→ 水平进入（目标锚 y）
  if (direction === "horizontal") {
    const turn = Math.max(route.turn, p1.x + EDGE_GEOMETRY.nearCollinear);
    return [p1, { x: turn, y: p1.y }, { x: turn, y: tip.y }, tip];
  }
  const turn = Math.max(route.turn, p1.y + EDGE_GEOMETRY.nearCollinear);
  return [p1, { x: p1.x, y: turn }, { x: tip.x, y: turn }, tip];
}

/** 让行偏移步长（px）：为消除共线重叠，引出走廊整体侧移的量。 */
const JOG_STEP = 7;

/**
 * 让行 pass：某条边的引出水平走廊与另一条边的走廊共线重叠时，
 * 给该边插入一个 JOG_STEP 的垂直偏移（靠近源卡处），使两走廊分离。
 * 确定性：按 (y, x) 排序取首个重叠对，偏移方向沿源→目标行进方向；最多 passes 轮。
 */
function resolveExitCorridors(geoms: Map<string, EdgeGeometry>, passes: number): void {
  for (let pass = 1; pass <= passes; pass++) {
    interface Seg {
      id: string;
      index: number;
      y: number;
      from: number;
      to: number;
    }
    const segs: Seg[] = [];
    for (const g of geoms.values()) {
      for (let i = 1; i < g.chain.length; i++) {
        const a = g.chain[i - 1]!;
        const b = g.chain[i]!;
        if (Math.abs(a.y - b.y) > 1e-6) continue;
        segs.push({
          id: g.id,
          index: i,
          y: a.y,
          from: Math.min(a.x, b.x),
          to: Math.max(a.x, b.x),
        });
      }
    }
    segs.sort((p, q) => p.y - q.y || p.from - q.from);
    let moved = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i]!;
        const b = segs[j]!;
        if (Math.abs(a.y - b.y) > 0.5) break;
        const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from);
        if (overlap <= 0.5) continue;
        // 让行者：链上更早的段（引出段优先；同为引出段时取延伸更远者）
        const mover = a.index < b.index ? a : a.index > b.index ? b : a.to >= b.to ? a : b;
        const g = geoms.get(mover.id)!;
        const sign = g.tip.y >= g.start.y ? 1 : -1;
        applyExitJog(g, mover.index, sign * JOG_STEP * pass);
        moved = true;
        break outer;
      }
    }
    if (!moved) return;
  }
}

/** 让行：引出段在源卡附近插入垂直偏移；中段走廊则整体平移。保持全正交。 */
function applyExitJog(g: EdgeGeometry, segIndex: number, delta: number): void {
  const chain = g.chain;
  if (chain.length < 4 || delta === 0) return;
  if (segIndex === 1) {
    const p1 = chain[0]!;
    const turnX = chain[1]!.x;
    const jogX = Math.min(turnX - EDGE_GEOMETRY.nearCollinear, p1.x + 12);
    if (jogX <= p1.x + 1) return; // 源卡与转折之间无空间，保持原状
    const corridorY = chain[1]!.y + delta;
    g.chain = [
      p1,
      { x: jogX, y: p1.y },
      { x: jogX, y: corridorY },
      { x: turnX, y: corridorY },
      ...chain.slice(2),
    ];
  } else {
    chain[segIndex - 1]!.y += delta;
    chain[segIndex]!.y += delta;
  }
  g.extremes = [g.start, g.tip, g.lineEnd, ...g.chain, g.arrowBase[0], g.arrowBase[1]];
}

function controlsOf(
  p1: Pt,
  end: Pt,
  direction: LayoutDirection,
  outerArc: ChannelSide | undefined,
  gb: GraphBounds,
): [Pt, Pt] {
  const horizontal = direction === "horizontal";
  const arc = outerArc ?? "none";
  if (horizontal) {
    if (arc === "up" || arc === "down" || arc === "left" || arc === "right") {
      const k =
        arc === "up"
          ? gb.minY - EDGE_GEOMETRY.arcOffset
          : arc === "down"
            ? gb.maxY + EDGE_GEOMETRY.arcOffset
            : p1.y < (gb.minY + gb.maxY) / 2
              ? gb.minY - EDGE_GEOMETRY.arcOffset
              : gb.maxY + EDGE_GEOMETRY.arcOffset;
      return [
        { x: p1.x + EDGE_GEOMETRY.arcOffset, y: k },
        { x: end.x - EDGE_GEOMETRY.arcOffset, y: k },
      ];
    }
    const k = Math.max(
      EDGE_GEOMETRY.scatterKMin,
      Math.min(EDGE_GEOMETRY.scatterKMax, Math.abs(end.x - p1.x) * EDGE_GEOMETRY.scatterK),
    );
    return [
      { x: p1.x + k, y: p1.y },
      { x: end.x - k, y: end.y },
    ];
  }
  if (arc === "left" || arc === "right" || arc === "up" || arc === "down") {
    const k =
      arc === "left"
        ? gb.minX - EDGE_GEOMETRY.arcOffset
        : arc === "right"
          ? gb.maxX + EDGE_GEOMETRY.arcOffset
          : p1.x < (gb.minX + gb.maxX) / 2
            ? gb.minX - EDGE_GEOMETRY.arcOffset
            : gb.maxX + EDGE_GEOMETRY.arcOffset;
    return [
      { x: k, y: p1.y + EDGE_GEOMETRY.arcOffset },
      { x: k, y: end.y - EDGE_GEOMETRY.arcOffset },
    ];
  }
  const k = Math.max(
    EDGE_GEOMETRY.scatterKMin,
    Math.min(EDGE_GEOMETRY.scatterKMax, Math.abs(end.y - p1.y) * EDGE_GEOMETRY.scatterK),
  );
  return [
    { x: p1.x, y: p1.y + k },
    { x: end.x, y: end.y - k },
  ];
}

/**
 * 全量边几何：端口分配 → 路由 → 端点/箭头/折线/控制点。
 * 相同静态输入输出完全相同几何（无随机、无时间、无 locale）。
 */
export function planEdgeGeometry(
  edges: readonly EdgePlanInput[],
  direction: LayoutDirection,
  lineMorph: number,
  context: PlanContext = {},
): Map<string, EdgeGeometry> {
  if (direction === "horizontal" && context.dualSide === true) {
    return planEdgeGeometryDualSide(edges, lineMorph, context);
  }
  const obstacles = context.obstacles ?? edges.flatMap((e) => [e.source, e.target]);
  const gb = context.bounds ?? graphBoundsOf(obstacles);
  const seam = Math.max(40, context.seamWidth ?? EDGE_GEOMETRY.seamWidth);
  const routed =
    context.routes ??
    planEdgeRoutes(edges, direction, { ...context, obstacles, bounds: gb, seamWidth: seam });
  const result = new Map<string, EdgeGeometry>();
  const gap = EDGE_VISUAL.endpointGap;
  const arrowLen = EDGE_VISUAL.arrowLength;
  const half = EDGE_VISUAL.arrowHalfWidth;

  for (const e of edges) {
    const r = routed.get(e.id)!;
    const a = r.anchorSource;
    const b = r.anchorTarget;
    const u = unit(b.x - a.x, b.y - a.y);
    const p1 = add(a, u.x * gap, u.y * gap);
    const tip = add(b, -u.x * gap, -u.y * gap);
    const route = r.route;

    // 规整态转折（comb 的 turn 值在此落定）
    if (route.kind === "comb") {
      if (direction === "horizontal")
        route.turn = tip.x - EDGE_GEOMETRY.laneInset - route.rank * route.spacing;
      else route.turn = tip.y - EDGE_GEOMETRY.laneInset - route.rank * route.spacing;
    }
    const collinear =
      direction === "horizontal"
        ? Math.abs(p1.y - tip.y) < EDGE_GEOMETRY.collinearEpsilon
        : Math.abs(p1.x - tip.x) < EDGE_GEOMETRY.collinearEpsilon;
    const effective: EdgeRoute = collinear && route.kind === "comb" ? { kind: "straight" } : route;

    const rawChain = chainOf(p1, tip, effective, direction, gb);
    // 主线在箭头底边中点收笔：沿末段方向回退 arrowLength，保持折线严格正交
    const n = rawChain.length;
    const prev = rawChain[Math.max(0, n - 2)]!;
    const segDir = unit(tip.x - prev.x, tip.y - prev.y);
    const segLen = len(tip.x - prev.x, tip.y - prev.y);
    const lineEnd = segLen > arrowLen ? add(tip, -segDir.x * arrowLen, -segDir.y * arrowLen) : tip;
    const chain = rawChain.slice(0, Math.max(0, n - 1));
    chain.push(lineEnd);

    const normal = { x: -segDir.y, y: segDir.x };
    const arrowBase: [Pt, Pt] = [
      add(lineEnd, normal.x * half, normal.y * half),
      add(lineEnd, -normal.x * half, -normal.y * half),
    ];

    // 散乱态曲线：以进入方向收笔到 lineEnd
    const enter = unit(tip.x - p1.x, tip.y - p1.y);
    const curveEnd = add(tip, -enter.x * arrowLen, -enter.y * arrowLen);
    const controls = controlsOf(p1, curveEnd, direction, e.outerArc, gb);

    const extremes: Pt[] = [p1, tip, lineEnd, ...chain, arrowBase[0], arrowBase[1]];
    if (lineMorph < 0.999) extremes.push(controls[0], controls[1]);

    result.set(e.id, {
      id: e.id,
      direction,
      route: effective,
      anchorSource: a,
      anchorTarget: b,
      start: p1,
      tip,
      lineEnd,
      enterDir: segDir,
      arrowBase,
      controls,
      chain,
      extremes,
    });
  }
  // 让行 pass：消除引出走廊与其它走廊的共线重叠（§1.4 硬规则的收尾保障）
  if (lineMorph >= 0.999) resolveExitCorridors(result, 3);
  return result;
}

/** 双侧几何（ADR 0019）：镜像组在镜像帧完成全部几何构建后镜像回真实坐标。
 *  冻结路由契约：镜像组的 routes 由 planEdgeRoutes dualSide 存于镜像帧，此处同帧复用。 */
function planEdgeGeometryDualSide(
  edges: readonly EdgePlanInput[],
  lineMorph: number,
  context: PlanContext,
): Map<string, EdgeGeometry> {
  const obstacles = context.obstacles ?? edges.flatMap((e) => [e.source, e.target]);
  const normal: EdgePlanInput[] = [];
  const mirrored: EdgePlanInput[] = [];
  for (const e of edges) (edgeIsMirrored(e) ? mirrored : normal).push(e);
  const result = new Map<string, EdgeGeometry>();
  if (normal.length > 0) {
    const g = planEdgeGeometry(normal, "horizontal", lineMorph, {
      ...context,
      dualSide: false,
      obstacles,
    });
    for (const [id, geo] of g) result.set(id, geo);
  }
  if (mirrored.length > 0) {
    const mEdges = mirrored.map((e) => ({
      ...e,
      source: mirrorBoxX(e.source),
      target: mirrorBoxX(e.target),
    }));
    const mObstacles = obstacles.map(mirrorBoxX);
    let mRoutes: Map<string, RoutedEdge> | undefined;
    if (context.routes) {
      mRoutes = new Map<string, RoutedEdge>();
      for (const e of mirrored) {
        const r = context.routes.get(e.id);
        if (r) mRoutes.set(e.id, r);
      }
    }
    const g = planEdgeGeometry(mEdges, "horizontal", lineMorph, {
      ...context,
      dualSide: false,
      obstacles: mObstacles,
      bounds: undefined,
      routes: mRoutes,
    });
    for (const [id, geo] of g) result.set(id, mirrorGeometryX(geo));
  }
  return result;
}

// ---------- path 构造（SVG d 字符串与 PDF 共用同一几何） ----------

export function polylineD(pts: readonly Pt[]): string {
  if (pts.length === 0) return "";
  let d = `M ${formatNum(pts[0]!.x)} ${formatNum(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${formatNum(pts[i]!.x)} ${formatNum(pts[i]!.y)}`;
  return d;
}

/** 规整态圆角折线：拐点以 r 为半径的二次贝塞尔圆角（§1.4 拐点圆角 r≈12）。 */
export function filletD(pts: readonly Pt[], radius = EDGE_VISUAL.filletRadius): string {
  if (pts.length < 2) return pts.length === 1 ? polylineD(pts) : "";
  let d = `M ${formatNum(pts[0]!.x)} ${formatNum(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const a = pts[i - 1]!;
    const b = pts[i + 1]!;
    const v1 = { x: p.x - a.x, y: p.y - a.y };
    const v2 = { x: b.x - p.x, y: b.y - p.y };
    const l1 = len(v1.x, v1.y) || 1;
    const l2 = len(v2.x, v2.y) || 1;
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    const pA = add(p, (-v1.x / l1) * rr, (-v1.y / l1) * rr);
    const pB = add(p, (v2.x / l2) * rr, (v2.y / l2) * rr);
    d += ` L ${formatNum(pA.x)} ${formatNum(pA.y)} Q ${formatNum(p.x)} ${formatNum(p.y)} ${formatNum(pB.x)} ${formatNum(pB.y)}`;
  }
  const e = pts[pts.length - 1]!;
  d += ` L ${formatNum(e.x)} ${formatNum(e.y)}`;
  return d;
}

export function bezierD(p0: Pt, c1: Pt, c2: Pt, p3: Pt): string {
  return (
    `M ${formatNum(p0.x)} ${formatNum(p0.y)}` +
    ` C ${formatNum(c1.x)} ${formatNum(c1.y)}, ${formatNum(c2.x)} ${formatNum(c2.y)}, ${formatNum(p3.x)} ${formatNum(p3.y)}`
  );
}

/** 箭头为独立 path（实心三角，进入方向）。 */
export function arrowD(g: Pick<EdgeGeometry, "tip" | "arrowBase">): string {
  const t = g.tip;
  const b = g.arrowBase;
  return `M ${formatNum(t.x)} ${formatNum(t.y)} L ${formatNum(b[0].x)} ${formatNum(b[0].y)} L ${formatNum(b[1].x)} ${formatNum(b[1].y)} Z`;
}

/** 按形态输出主线 path：1 = fillet 折线；0 = 贝塞尔（语义曲线）；(0,1) = 冻结拓扑逐点插值折线。 */
export function edgePathD(g: EdgeGeometry, lineMorph: number): string {
  if (lineMorph >= 0.999) return filletD(g.chain);
  if (lineMorph <= 0) return bezierD(g.start, g.controls[0], g.controls[1], g.lineEnd);
  const curve = bezierPoints(
    g.start,
    g.controls[0],
    g.controls[1],
    g.lineEnd,
    EDGE_GEOMETRY.resampleSegments,
  );
  const elbow = resamplePts(g.chain, EDGE_GEOMETRY.resampleSegments);
  return polylineD(lerpChains(curve, elbow, lineMorph));
}

// ---------- 形态插值（VRA-060：冻结拓扑后同帧插值，禁止离散重选路径） ----------

export function bezierPoints(
  p0: Pt,
  c1: Pt,
  c2: Pt,
  p3: Pt,
  n = EDGE_GEOMETRY.resampleSegments,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    });
  }
  return pts;
}

export function resamplePts(src: readonly Pt[], n = EDGE_GEOMETRY.resampleSegments): Pt[] {
  if (src.length === 0) return [];
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < src.length; i++) {
    const s = len(src[i]!.x - src[i - 1]!.x, src[i]!.y - src[i - 1]!.y);
    segs.push(s);
    total += s;
  }
  if (total === 0) return Array.from({ length: n + 1 }, () => ({ ...src[0]! }));
  const out: Pt[] = [];
  let acc = 0;
  let seg = 0;
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * total;
    while (seg < segs.length - 1 && acc + segs[seg]! < d) {
      acc += segs[seg]!;
      seg++;
    }
    const segLen = segs[seg] ?? 0;
    const r = segLen > 0 ? (d - acc) / segLen : 0;
    const cur = src[seg]!;
    const next = src[Math.min(seg + 1, src.length - 1)]!;
    out.push({ x: cur.x + (next.x - cur.x) * r, y: cur.y + (next.y - cur.y) * r });
  }
  return out;
}

export function lerpChains(a: readonly Pt[], b: readonly Pt[], m: number): Pt[] {
  const n = Math.min(a.length, b.length);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++)
    out.push({
      x: a[i]!.x + (b[i]!.x - a[i]!.x) * m,
      y: a[i]!.y + (b[i]!.y - a[i]!.y) * m,
    });
  return out;
}

// ---------- 零共线重叠检测（tokens §1.4 布线硬规则；VRA-040/080 程序化验收） ----------

export interface CollinearOverlap {
  edgeA: string;
  edgeB: string;
  axis: "h" | "v";
  /** 共线所在 y（横向段）/ x（纵向段） */
  line: number;
  from: number;
  to: number;
}

interface Segment {
  edge: string;
  axis: "h" | "v";
  line: number;
  from: number;
  to: number;
}

function segmentsOf(g: EdgeGeometry): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < g.chain.length; i++) {
    const a = g.chain[i - 1]!;
    const b = g.chain[i]!;
    if (Math.abs(a.y - b.y) < 1e-6)
      out.push({
        edge: g.id,
        axis: "h",
        line: a.y,
        from: Math.min(a.x, b.x),
        to: Math.max(a.x, b.x),
      });
    else if (Math.abs(a.x - b.x) < 1e-6)
      out.push({
        edge: g.id,
        axis: "v",
        line: a.x,
        from: Math.min(a.y, b.y),
        to: Math.max(a.y, b.y),
      });
  }
  return out;
}

/** 正交段两两比较：同轴同线且投影重叠 > eps 即为共线重叠（交叉允许，重叠禁止）。 */
export function findCollinearOverlaps(
  geoms: Iterable<EdgeGeometry>,
  eps = 0.5,
): CollinearOverlap[] {
  const segs: Segment[] = [];
  for (const g of geoms) segs.push(...segmentsOf(g));
  const out: CollinearOverlap[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]!;
      const b = segs[j]!;
      if (a.edge === b.edge || a.axis !== b.axis || Math.abs(a.line - b.line) > eps) continue;
      const from = Math.max(a.from, b.from);
      const to = Math.min(a.to, b.to);
      if (to - from > eps)
        out.push({ edgeA: a.edge, edgeB: b.edge, axis: a.axis, line: a.line, from, to });
    }
  }
  return out;
}
