// balance-layout.ts — 平衡双侧布局（ADR 0014 v1.1.0，2026-09-17 dogfood 决定）。
// organize(horizontal) 是单侧层叠：遇"宽而浅"树，全部叶子堆成一列长带。
// 本模块对单根树直接计算紧凑树布局（父在子列内垂直居中、层 x 按层最大宽度），
// 并把根的分支按子树高度贪心均分到左右两侧——宽而浅的经典思维导图形态。
// 不改 core、不改 GUI 整理契约；非单根树（多根/孤儿/交叉多父/环）自动回退，
// 由调用方使用 organize 单侧层叠结果。全程迭代（显式栈），深链不爆调用栈。

import { LIMITS, ORGANIZE_GAPS, type MindMapDocumentV1, type Point } from "@mindmap/core";

export interface BalanceResult {
  /** true = 已应用平衡双侧；false = 触发回退守卫。 */
  balanced: boolean;
  positions: Map<string, Point>;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function balanceHorizontalLayout(doc: MindMapDocumentV1): BalanceResult {
  const passthrough = (): BalanceResult => ({ balanced: false, positions: new Map() });
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

  // 守卫：单根树——恰好一个根、无孤儿、每个非根节点恰好一个父、无环。
  const roots = nodes.filter((n) => (predCount.get(n.id) ?? 0) === 0);
  if (roots.length !== 1) return passthrough();
  const root = roots[0]!;
  for (const n of nodes) {
    if (n.id !== root.id && (predCount.get(n.id) ?? 0) !== 1) return passthrough();
  }
  const branches = succ.get(root.id) ?? [];
  if (branches.length < 2) return passthrough();

  // 深度（BFS，同时做环检测：10k 节点树的迭代遍历）
  const depthOf = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]!;
    for (const next of succ.get(id) ?? []) {
      if (depthOf.has(next)) return passthrough(); // 环/重访
      depthOf.set(next, depthOf.get(id)! + 1);
      queue.push(next);
    }
  }
  if (depthOf.size !== nodes.length) return passthrough(); // 不可达节点（异常图）

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
  const layerX: number[] = [0];
  for (let d = 1; d < maxWidthByDepth.length; d++) {
    layerX[d] = layerX[d - 1]! + maxWidthByDepth[d - 1]! + ORGANIZE_GAPS.layerGap;
  }

  // 贪心均分：子树高度降序，逐支放入累计更小的一侧（右侧 = 常规方向，左侧 = 镜像）
  const sides = { right: [] as string[], left: [] as string[] };
  const load = { right: 0, left: 0 };
  for (const id of [...branches].sort((a, b) => heightOf.get(b)! - heightOf.get(a)!)) {
    const side = load.right <= load.left ? "right" : "left";
    sides[side].push(id);
    load[side] += heightOf.get(id)! + ORGANIZE_GAPS.intraGap;
  }
  const sideHeight = (list: string[]): number =>
    list.length === 0
      ? 0
      : list.reduce((acc, id) => acc + heightOf.get(id)!, 0) +
        ORGANIZE_GAPS.intraGap * (list.length - 1);

  const positions = new Map<string, Point>();
  const rootW = root.size.width;
  // 根垂直居中于较高一侧（经典中心根形态）；x=0 为层 0 左缘
  const tallest = Math.max(sideHeight(sides.right), sideHeight(sides.left), root.size.height);
  positions.set(root.id, { x: 0, y: round3((tallest - root.size.height) / 2) });

  // 放置（迭代）：节点在子树高度带内垂直居中；子节点从带顶连续堆叠（文档序）
  const place = (list: string[], mirror: boolean): void => {
    const work: { id: string; topY: number }[] = [];
    let cursorY = 0;
    for (const id of [...list].sort((a, b) => branches.indexOf(a) - branches.indexOf(b))) {
      work.push({ id, topY: cursorY });
      cursorY += heightOf.get(id)! + ORGANIZE_GAPS.intraGap;
    }
    while (work.length > 0) {
      const { id, topY } = work.pop()!;
      const node = nodesById.get(id)!;
      const depth = depthOf.get(id)!;
      const h = heightOf.get(id)!;
      const x = mirror ? rootW - layerX[depth]! - node.size.width : layerX[depth]!;
      positions.set(id, { x: round3(x), y: round3(topY + (h - node.size.height) / 2) });
      let childY = topY;
      for (const c of succ.get(id) ?? []) {
        work.push({ id: c, topY: childY });
        childY += heightOf.get(c)! + ORGANIZE_GAPS.intraGap;
      }
    }
  };
  place(sides.right, false);
  place(sides.left, true);

  // 坐标上限守卫（镜像后跨度翻倍）——超限整体回退，不产非法坐标
  for (const p of positions.values()) {
    if (p.x > LIMITS.maxCoordAbs || -p.x > LIMITS.maxCoordAbs || p.y > LIMITS.maxCoordAbs)
      return passthrough();
  }

  return { balanced: true, positions };
}
