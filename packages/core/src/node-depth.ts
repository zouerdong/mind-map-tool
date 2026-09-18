// 层级深度派生（ADR 0020，2026-09-18 内测批次）：UI 与三格式导出共享的纯函数。
// 深度不落 schema、不进文件——连线编辑后由投影/渲染层即时重派生。
//
// 规则（确定性，只依赖节点/边集合与文档序，与边数组顺序无关）：
// - 主图 = 有边节点；SCC 缩点（环降级为同深度分量，原文档边不删不翻向）；
// - 缩点 DAG 入度 0 分量深度 = 1；沿边方向每层 +1；多父节点取所有前驱的
//   最小深度（BFS 最短路径——符合「二级/三级」直觉，区别于 organize 分层
//   使用的最长前驱层级，后者服务于布局紧凑，前者服务于层级语义）；
// - 完全无连线的孤立节点无层级语义：不出现在结果中，渲染层保持普通色（黑卡）。

import type { MindMapDocumentV1 } from "./index.js";
import { tarjanSCC } from "./strong-components.js";

/** 派生全部主图节点的层级深度（源 = 1）。孤立节点不在返回 map 中。 */
export function deriveNodeDepths(doc: MindMapDocumentV1): Map<string, number> {
  const depths = new Map<string, number>();
  const nodes = doc.document.nodes;
  if (nodes.length === 0) return depths;

  const known = new Set(nodes.map((n) => n.id));
  const succ = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const seenEdge = new Set<string>();
  for (const e of doc.document.edges) {
    if (!known.has(e.sourceNodeId) || !known.has(e.targetNodeId)) continue;
    const key = `${e.sourceNodeId}\0${e.targetNodeId}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    succ.get(e.sourceNodeId)!.push(e.targetNodeId);
    indeg.set(e.targetNodeId, (indeg.get(e.targetNodeId) ?? 0) + 1);
  }

  // 主图 = 有边节点（出或入）；孤立节点不派生层级
  const mainIds: string[] = [];
  for (const n of nodes) {
    if ((succ.get(n.id)!.length ?? 0) > 0 || (indeg.get(n.id) ?? 0) > 0) mainIds.push(n.id);
  }
  if (mainIds.length === 0) return depths;

  // SCC 缩点 → 缩点 DAG（去重邻接）
  const sccOf = tarjanSCC(mainIds, succ);
  const sccCount = Math.max(...sccOf.values()) + 1;
  const sccPreds: number[][] = Array.from({ length: sccCount }, () => []);
  const sccSuccs: number[][] = Array.from({ length: sccCount }, () => []);
  const seenSccEdge = new Set<string>();
  for (const v of mainIds) {
    const si = sccOf.get(v)!;
    for (const w of succ.get(v)!) {
      const sj = sccOf.get(w)!;
      if (si === sj) continue;
      const key = `${si}\0${sj}`;
      if (seenSccEdge.has(key)) continue;
      seenSccEdge.add(key);
      sccPreds[sj]!.push(si);
      sccSuccs[si]!.push(sj);
    }
  }

  // Kahn 拓扑 + 最短路径深度：源分量 = 1，其余 = 1 + min(前驱深度)。
  // 分量所有前驱处理完才出队（入度归零），min 在出队前已收敛，结果与队列顺序无关。
  const sccIndeg = sccPreds.map((ps) => ps.length);
  const depthScc = new Map<number, number>();
  const queue: number[] = [];
  for (let s = 0; s < sccCount; s++) {
    if (sccIndeg[s] === 0) {
      depthScc.set(s, 1);
      queue.push(s);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi]!;
    const next = depthScc.get(s)! + 1;
    for (const t of sccSuccs[s]!) {
      const cur = depthScc.get(t);
      if (cur === undefined || next < cur) depthScc.set(t, next);
      sccIndeg[t] = (sccIndeg[t] ?? 0) - 1;
      if (sccIndeg[t] === 0) queue.push(t);
    }
  }

  for (const id of mainIds) {
    const d = depthScc.get(sccOf.get(id)!);
    if (d !== undefined) depths.set(id, d);
  }
  return depths;
}
