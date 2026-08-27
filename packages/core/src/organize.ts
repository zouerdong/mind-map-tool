// 一键整理（MM-085；AC-15 [from-user 2026-08-27]）：垂直树布局纯函数。
// 主干向下（BFS 分层 y）、分支横向（简版 Reingold-Tilford：子树宽度递归、
// 兄弟等距、父居中于子树范围）；多根并列、孤立节点右侧独立列；
// 环形拓扑以 DFS 生成树破环降级（被忽略的回边仍存在，只是不参与分层）。
// 纯确定性：输出只依赖节点/边集合与文档顺序，与当前坐标无关。

import type { Command, MindMapDocumentV1, Point } from "./index.js";

export const ORGANIZE_GAPS = {
  /** 同父相邻子树的水平间距。 */
  siblingGapX: 60,
  /** 层间距（上层节点底 → 下层节点顶）。 */
  layerGapY: 56,
  /** 多棵树的并列间距。 */
  treeGapX: 100,
  /** 孤立节点列与主布局的间距。 */
  orphanGapX: 140,
} as const;

/** 计算整理后的全部节点位置（确定性；空文档返回空 map）。 */
export function organize(doc: MindMapDocumentV1): Map<string, Point> {
  const nodes = doc.document.nodes;
  const positions = new Map<string, Point>();
  if (nodes.length === 0) return positions;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 邻接（按文档顺序）；同时以 DFS 生成树破环。
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const visited = new Set<string>();
  const inTree = new Set<string>();

  const dfs = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    inTree.add(id);
    for (const e of doc.document.edges) {
      if (e.sourceNodeId !== id) continue;
      const t = e.targetNodeId;
      if (!byId.has(t)) continue;
      if (inTree.has(t)) continue; // 回边：破环（不加入生成树）
      children.get(id)!.push(t);
      dfs(t);
    }
    inTree.delete(id);
  };
  // 从每个尚未访问的节点起 DFS（覆盖环与森林）
  for (const n of nodes) dfs(n.id);

  // 根 = 生成树中无入边的节点（保持文档顺序稳定）
  const hasParent = new Set<string>();
  for (const list of children.values()) for (const c of list) hasParent.add(c);
  const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);

  // 分层（BFS）与每层最大高度（统一行高 → 整齐的等距对齐）
  const depthOf = new Map<string, number>();
  for (const root of roots) {
    depthOf.set(root, 0);
    const queue = [root];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const c of children.get(id)!) {
        if (!depthOf.has(c)) {
          depthOf.set(c, depthOf.get(id)! + 1);
          queue.push(c);
        }
      }
    }
  }
  const layerMaxH = new Map<number, number>();
  for (const n of nodes) {
    const d = depthOf.get(n.id) ?? 0;
    layerMaxH.set(d, Math.max(layerMaxH.get(d) ?? 0, n.size.height));
  }
  const layerY = new Map<number, number>();
  let y = 0;
  const maxDepth = Math.max(...layerMaxH.keys());
  for (let d = 0; d <= maxDepth; d++) {
    layerY.set(d, y);
    y += (layerMaxH.get(d) ?? 0) + ORGANIZE_GAPS.layerGapY;
  }

  // 水平布局：子树宽度递归 + 父居中
  const widthOf = new Map<string, number>();
  const subtreeWidth = (id: string): number => {
    const cached = widthOf.get(id);
    if (cached !== undefined) return cached;
    const kids = children.get(id)!;
    const self = byId.get(id)!.size.width;
    const w =
      kids.length === 0
        ? self
        : Math.max(
            self,
            kids.reduce((s, k) => s + subtreeWidth(k), 0) + ORGANIZE_GAPS.siblingGapX * (kids.length - 1),
          );
    widthOf.set(id, w);
    return w;
  };
  const place = (id: string, left: number, depth: number) => {
    const node = byId.get(id)!;
    const w = subtreeWidth(id);
    positions.set(id, {
      x: round3(left + w / 2 - node.size.width / 2), // 父居中于子树范围
      y: layerY.get(depth)!,
    });
    let childLeft = left;
    for (const c of children.get(id)!) {
      place(c, childLeft, depth + 1);
      childLeft += subtreeWidth(c) + ORGANIZE_GAPS.siblingGapX;
    }
  };

  let cursorX = 0;
  let maxHeight = 0;
  for (const n of nodes) maxHeight = Math.max(maxHeight, n.size.height);
  for (const root of roots) {
    place(root, cursorX, 0);
    cursorX += subtreeWidth(root) + ORGANIZE_GAPS.treeGapX;
  }

  // 孤立节点（不在任何边里）：主布局右侧独立列，垂直等距
  const connected = new Set<string>();
  for (const e of doc.document.edges) {
    if (byId.has(e.sourceNodeId)) connected.add(e.sourceNodeId);
    if (byId.has(e.targetNodeId)) connected.add(e.targetNodeId);
  }
  const orphans = nodes.filter((n) => !connected.has(n.id));
  if (orphans.length > 0) {
    const columnX = Math.max(cursorX - ORGANIZE_GAPS.treeGapX, 0) + ORGANIZE_GAPS.orphanGapX;
    let oy = 0;
    for (const o of orphans) {
      positions.set(o.id, { x: columnX, y: oy });
      oy += o.size.height + ORGANIZE_GAPS.layerGapY;
    }
  }

  return positions;
}

/** 整理命令：位置有实际变化才产生一条 MoveNodes（可 undo、单命令）。 */
export function organizeCommand(doc: MindMapDocumentV1): Command | null {
  const positions = organize(doc);
  const moves = doc.document.nodes
    .map((n) => {
      const p = positions.get(n.id);
      if (!p) return null;
      if (n.position.x === p.x && n.position.y === p.y) return null;
      return { id: n.id, position: p };
    })
    .filter((m): m is { id: string; position: Point } => m !== null);
  if (moves.length === 0) return null;
  return { kind: "MoveNodes", moves };
}

function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}
