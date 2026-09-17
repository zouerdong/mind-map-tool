// wide-layout.ts — 宽而浅自适应分栏布局（ADR 0014 v1.2.0，2026-09-17 dogfood 二轮决定）。
// 背景：organize 单侧层叠遇宽而浅树排成长竖带（负责人："读着累"）；
// v1.1.0 中心根双侧镜像被负责人否决——连线契约是"右缘发出、左缘进入"，
// 左侧盒子的线只能反着走，视觉上别扭。
// v1.2.0：根置顶左 + 顶部布线通道 + 一级分支连续分栏并排。全部保持左→右流向，
// 根→各栏连线沿顶部通道直行（恰好是路由器 comb 直连路径），不穿盒、不反向。
// 栏数自适应：候选 1..MAX_COLUMNS 栏连续切分（DP 最小化最高栏），
// 按 |ln(实际宽高比 / TARGET_ASPECT)| 最小选定；1 栏 = 紧凑单栏（根垂直居中）。
// 守卫：非单根树（多根/孤儿/交叉多父/环）或坐标超限 → 回退，调用方以 organize 兜底。
// 纯 headless 几何布局：不改 core、不改 GUI 整理契约。全程迭代，深链不爆栈。

import { LIMITS, ORGANIZE_GAPS, type MindMapDocumentV1, type Point } from "@mindmap/core";

export interface WideLayoutResult {
  /** true = 已应用分栏布局；false = 触发回退守卫。 */
  wide: boolean;
  /** 实际栏数（≥2 = 通道分栏；1 = 紧凑单栏）。回退时 0。 */
  columns: number;
  positions: Map<string, Point>;
}

/** 目标宽高比（接近黄金比/16:9 之间的"宽而浅"观感）。 */
const TARGET_ASPECT = 1.6;
const MAX_COLUMNS = 6;
/** 分栏 DP 的分支数上限（超出用贪心连续切分兜底，避免 O(k·n²) 失控）。 */
const DP_BRANCH_LIMIT = 64;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function wideColumnarLayout(doc: MindMapDocumentV1): WideLayoutResult {
  const passthrough = (): WideLayoutResult => ({ wide: false, columns: 0, positions: new Map() });
  const nodes = doc.document.nodes;
  if (nodes.length < 3) return passthrough();

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const succ = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const predCount = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const e of doc.document.edges) {
    if (!nodesById.has(e.sourceNodeId) || !nodesById.has(e.targetNodeId)) return passthrough();
    succ.get(e.sourceNodeId)!.push(e.targetNodeId);
    predCount.set(e.targetNodeId, (predCount.get(e.targetNodeId) ?? 0) + 1);
  }

  // 守卫：单根树——恰好一个根、无孤儿、每个非根节点恰好一个父。
  const roots = nodes.filter((n) => (predCount.get(n.id) ?? 0) === 0);
  if (roots.length !== 1) return passthrough();
  const root = roots[0]!;
  for (const n of nodes) {
    if (n.id !== root.id && (predCount.get(n.id) ?? 0) !== 1) return passthrough();
  }
  const branches = succ.get(root.id) ?? [];
  if (branches.length < 2) return passthrough();

  // 深度（BFS，兼环检测）
  const depthOf = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]!;
    for (const next of succ.get(id) ?? []) {
      if (depthOf.has(next)) return passthrough();
      depthOf.set(next, depthOf.get(id)! + 1);
      queue.push(next);
    }
  }
  if (depthOf.size !== nodes.length) return passthrough();

  // 子树紧凑高度（后序迭代）：父在子列内垂直居中所需的最小高度
  const heightOf = new Map<string, number>();
  const postOrder: string[] = [];
  const walk: { id: string; processed: boolean }[] = [{ id: root.id, processed: false }];
  while (walk.length > 0) {
    const frame = walk.pop()!;
    if (frame.processed) {
      postOrder.push(frame.id);
      continue;
    }
    walk.push({ id: frame.id, processed: true });
    for (const c of succ.get(frame.id) ?? []) walk.push({ id: c, processed: false });
  }
  for (const id of postOrder) {
    const own = nodesById.get(id)!.size.height;
    const children = succ.get(id) ?? [];
    if (children.length === 0) {
      heightOf.set(id, own);
      continue;
    }
    let total = ORGANIZE_GAPS.intraGap * (children.length - 1);
    for (const c of children) total += heightOf.get(c)!;
    heightOf.set(id, Math.max(own, total));
  }

  // 层 x 列：每层最大宽度 + layerGap（与 organize 同一净距契约）
  const maxWidthByDepth: number[] = [];
  for (const n of nodes) {
    const d = depthOf.get(n.id)!;
    maxWidthByDepth[d] = Math.max(maxWidthByDepth[d] ?? 0, n.size.width);
  }
  const maxDepth = maxWidthByDepth.length - 1;
  const layerX: number[] = [0];
  for (let d = 1; d <= maxDepth; d++) {
    layerX[d] = layerX[d - 1]! + maxWidthByDepth[d - 1]! + ORGANIZE_GAPS.layerGap;
  }
  /** 一栏内 depth≥1 的相对 x（relX[1] = 0）。 */
  const relX = layerX.map((x) => x - layerX[1]!);
  /** 一栏宽度（depth 1..maxDepth 的跨度）。 */
  const groupW = relX[maxDepth]! + maxWidthByDepth[maxDepth]!;

  const m = branches.length;
  const branchH = branches.map((b) => heightOf.get(b)!);
  // 前缀和：stackHeight(i, j) = 分支 i..j（含）连续堆叠高度
  const prefix: number[] = [0];
  for (let i = 0; i < m; i++) prefix.push(prefix[i]! + branchH[i]!);
  const stackHeight = (i: number, j: number): number =>
    prefix[j + 1]! - prefix[i]! + ORGANIZE_GAPS.intraGap * (j - i);

  /** 连续切分：DP 最小化最高栏（平局取更靠后的切点 → 左栏更满，阅读顺序自然）。 */
  const partitionDP = (k: number): number[][] => {
    const f: number[][] = Array.from({ length: k + 1 }, () => new Array(m + 1).fill(Infinity));
    const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(m + 1).fill(0));
    f[0]![0] = 0;
    for (let g = 1; g <= k; g++) {
      for (let i = g; i <= m; i++) {
        for (let j = g - 1; j < i; j++) {
          const prev = f[g - 1]![j]!;
          if (prev === Infinity) continue;
          const v = Math.max(prev, stackHeight(j, i - 1));
          if (v <= f[g]![i]!) {
            f[g]![i] = v;
            cut[g]![i] = j;
          }
        }
      }
    }
    const groups: number[][] = [];
    let i = m;
    for (let g = k; g >= 1; g--) {
      const j = cut[g]![i]!;
      const range: number[] = [];
      for (let t = j; t < i; t++) range.push(t);
      groups.unshift(range);
      i = j;
    }
    return groups;
  };

  /** 贪心连续切分兜底（分支数超 DP 上限）：按目标高度顺序装栏。 */
  const partitionGreedy = (k: number): number[][] => {
    const target = stackHeight(0, m - 1) / k;
    const groups: number[][] = [[0]];
    for (let i = 1; i < m; i++) {
      const cur = groups[groups.length - 1]!;
      const would = stackHeight(cur[0]!, i);
      if (would > target && groups.length < k) groups.push([i]);
      else cur.push(i);
    }
    return groups;
  };

  interface Plan {
    /** 分支索引分组（连续区间）；空数组 = 单栏方案。 */
    groups: number[][];
    columns: number;
    width: number;
    height: number;
    score: number;
  }
  const rootH = root.size.height;
  const stripHeight = Math.max(rootH, stackHeight(0, m - 1));
  const singleWidth = layerX[maxDepth]! + maxWidthByDepth[maxDepth]!;
  const plans: Plan[] = [
    {
      groups: [],
      columns: 1,
      width: singleWidth,
      height: stripHeight,
      score: Math.abs(Math.log(singleWidth / stripHeight / TARGET_ASPECT)),
    },
  ];
  const maxCols = Math.min(MAX_COLUMNS, m);
  for (let k = 2; k <= maxCols; k++) {
    const groups = m <= DP_BRANCH_LIMIT ? partitionDP(k) : partitionGreedy(k);
    const cols = groups.length;
    const hMax = Math.max(...groups.map((g) => stackHeight(g[0]!, g[g.length - 1]!)));
    const height = rootH + ORGANIZE_GAPS.intraGap + hMax;
    const width = layerX[1]! + cols * groupW + (cols - 1) * ORGANIZE_GAPS.layerGap;
    plans.push({
      groups,
      columns: cols,
      width,
      height,
      score: Math.abs(Math.log(width / height / TARGET_ASPECT)),
    });
  }
  // 评分最小者优先；平局取栏数更少（形态更整）
  let best = plans[0]!;
  for (const p of plans) {
    if (
      p.score < best.score - 1e-9 ||
      (Math.abs(p.score - best.score) <= 1e-9 && p.columns < best.columns)
    )
      best = p;
  }

  const positions = new Map<string, Point>();
  /** 放置子树：节点在自身高度带内垂直居中；子节点从带顶连续堆叠（文档序）。 */
  const place = (start: string, baseX: number, startY: number): void => {
    const work: { id: string; baseX: number; topY: number }[] = [
      { id: start, baseX, topY: startY },
    ];
    while (work.length > 0) {
      const { id, baseX: bx, topY } = work.pop()!;
      const node = nodesById.get(id)!;
      const d = depthOf.get(id)!;
      const h = heightOf.get(id)!;
      positions.set(id, {
        x: round3(bx + relX[d]!),
        y: round3(topY + (h - node.size.height) / 2),
      });
      let childY = topY;
      for (const c of succ.get(id) ?? []) {
        work.push({ id: c, baseX: bx, topY: childY });
        childY += heightOf.get(c)! + ORGANIZE_GAPS.intraGap;
      }
    }
  };

  if (best.columns === 1) {
    // 紧凑单栏：根垂直居中于子列高度带
    positions.set(root.id, { x: 0, y: round3((stripHeight - rootH) / 2) });
    let cursorY = 0;
    for (const b of branches) {
      place(b, layerX[1]!, cursorY);
      cursorY += heightOf.get(b)! + ORGANIZE_GAPS.intraGap;
    }
  } else {
    // 通道分栏：根顶左，各栏从通道下方起排，栏间 layerGap 即布线缝
    positions.set(root.id, { x: 0, y: 0 });
    const channelTop = rootH + ORGANIZE_GAPS.intraGap;
    best.groups.forEach((group, gi) => {
      const baseX = layerX[1]! + gi * (groupW + ORGANIZE_GAPS.layerGap);
      let cursorY = channelTop;
      for (const bi of group) {
        place(branches[bi]!, baseX, cursorY);
        cursorY += branchH[bi]! + ORGANIZE_GAPS.intraGap;
      }
    });
  }

  // 坐标上限守卫——超限整体回退，不产非法坐标
  for (const p of positions.values()) {
    if (Math.abs(p.x) > LIMITS.maxCoordAbs || Math.abs(p.y) > LIMITS.maxCoordAbs)
      return passthrough();
  }

  return { wide: true, columns: best.columns, positions };
}
