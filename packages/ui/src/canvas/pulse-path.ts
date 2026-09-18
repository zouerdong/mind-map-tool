// 能量脉冲来路路径派生（2026-09-18 内测批次④；产品规格 §5.1「选中动效」）。
// 纯函数、确定性（只依赖节点/边集合与文档序），供画布层消费；会话态，不落文件。
//
// 规则（负责人定稿 2026-09-18）：
// - 起点 = 「出发点」橙卡（文档序首个 emphasis 节点）；无橙卡时回退为目标所在
//   弱连通分量的入度 0 源（文档序最小者；纯环分量取文档序最小节点）；
// - 路径 = 起点沿边方向到目标的 BFS 最短路径（平局按目标节点文档序 + 边文档序）；
// - 目标即出发点 / 不连通 / 孤立节点 → null（不播放）；
// - 多选场景由调用方决定只传主选节点。

import type { MindMapDocumentV1 } from "@mindmap/core";

export interface PulsePath {
  /** 有序边 id 链（出发点 → 目标），长度 ≥1。 */
  edgeIds: string[];
  /** 链起点节点 id。 */
  originId: string;
}

/** 派生目标节点的来路边链；不可播放返回 null。 */
export function pulsePathTo(doc: MindMapDocumentV1, targetId: string): PulsePath | null {
  const nodes = doc.document.nodes;
  const edges = doc.document.edges;
  const docOrder = new Map(nodes.map((n, i) => [n.id, i]));
  if (!docOrder.has(targetId)) return null;

  // 邻接（有向，出边按目标节点文档序 + 边文档序排序 → BFS 平局确定）
  const out = new Map<string, Array<{ to: string; edgeId: string }>>();
  const undirected = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    undirected.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!docOrder.has(e.sourceNodeId) || !docOrder.has(e.targetNodeId)) continue;
    out.get(e.sourceNodeId)!.push({ to: e.targetNodeId, edgeId: e.id });
    undirected.get(e.sourceNodeId)!.push(e.targetNodeId);
    undirected.get(e.targetNodeId)!.push(e.sourceNodeId);
    indeg.set(e.targetNodeId, (indeg.get(e.targetNodeId) ?? 0) + 1);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) => docOrder.get(a.to)! - docOrder.get(b.to)! || a.edgeId.localeCompare(b.edgeId),
    );
  }

  // 起点候选：出发点橙卡优先；否则目标弱连通分量的入度 0 源（文档序），纯环兜底最小文档序
  const emphasisOrigin = nodes.find((n) => n.emphasis === true)?.id;
  const candidates: string[] = [];
  if (emphasisOrigin !== undefined) {
    candidates.push(emphasisOrigin);
  } else {
    // 目标弱连通分量（无向 BFS）
    const comp = new Set<string>([targetId]);
    const queue = [targetId];
    for (let qi = 0; qi < queue.length; qi++) {
      for (const w of undirected.get(queue[qi]!) ?? []) {
        if (!comp.has(w)) {
          comp.add(w);
          queue.push(w);
        }
      }
    }
    const compNodes = nodes.filter((n) => comp.has(n.id)); // 已按文档序
    const sources = compNodes.filter((n) => (indeg.get(n.id) ?? 0) === 0);
    for (const s of sources) candidates.push(s.id);
    if (candidates.length === 0 && compNodes.length > 0) candidates.push(compNodes[0]!.id);
  }

  for (const origin of candidates) {
    if (origin === targetId) continue; // 选中出发点自身 / 目标即源 → 不播放
    // BFS 最短路径（父指针携带所经边 id）
    const parent = new Map<string, { prev: string; edgeId: string }>();
    const visited = new Set<string>([origin]);
    const queue = [origin];
    let reached = false;
    for (let qi = 0; qi < queue.length && !reached; qi++) {
      const v = queue[qi]!;
      for (const { to, edgeId } of out.get(v) ?? []) {
        if (visited.has(to)) continue;
        visited.add(to);
        parent.set(to, { prev: v, edgeId });
        if (to === targetId) {
          reached = true;
          break;
        }
        queue.push(to);
      }
    }
    if (!reached) continue;
    const edgeIds: string[] = [];
    let cur = targetId;
    while (cur !== origin) {
      const p = parent.get(cur)!;
      edgeIds.unshift(p.edgeId);
      cur = p.prev;
    }
    if (edgeIds.length === 0) continue;
    return { edgeIds, originId: origin };
  }
  return null;
}
