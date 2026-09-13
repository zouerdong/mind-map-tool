// 动效协调者（VRA-060）：单一 rAF 时钟管理散乱→规整整理过渡。
// 契约：
// - 节点、连线与箭头每帧消费同一份显示坐标集；
// - 线形态双轨插值：m 从 0（贝塞尔曲线）到 1（正交圆角折线）；
// - 路由拓扑在动作启动时冻结，同一次动作内不重选通道（禁止中段跳形）；
// - 错峰：叶子先动，主干/汇聚最后归位；每层错峰 25ms，总错峰上限 ≤120ms；
// - 密集图（≥300 节点）取消错峰（总时长 600ms，P95 ≤32ms 门槛）；
// - prefers-reduced-motion 时时长归零直接呈现终态；
// - 支持单节点拖拽打断、undo 从当前显示态平滑接续、视口一次性协调。

import type { MindMapDocumentV1, Point } from "@mindmap/core";
import {
  arrowD,
  edgePathD,
  graphBoundsOf,
  planEdgeGeometry,
  planEdgeRoutes,
  type EdgePlanInput,
  type LayoutDirection,
  type NodeBox,
  type RoutedEdge,
} from "@mindmap/export/src/edge-geometry.js";

export const MOTION_TIMELINE = {
  /** 整理动画标准总时长（ms） */
  duration: 800,
  /** 节点主运动时长（ms；其余 200ms 为主干/汇聚归位余量） */
  mainDuration: 600,
  /** 同层错峰步长（ms/层） */
  perLayerDelay: 25,
  /** 总错峰上限（ms） */
  maxDelay: 120,
  /** 视口安全留白（px） */
  viewportPadding: 80,
  /** 规模降级阈值（节点数） */
  scaleDegradationThreshold: 300,
} as const;

/** 缓动函数：ease-out-cubic（G-VIS 裁决：柔和减速，无弹跳、无回弹） */
export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

export type MotionPhase = "idle" | "running" | "interrupted" | "completed";

export interface MotionFrame {
  positions: Map<string, Point>;
  edgePaths: Map<string, { pathD: string; arrowD: string }>;
  lineMorph: number;
  phase: MotionPhase;
}

export interface MotionOptions {
  direction?: LayoutDirection;
  reducedMotion?: boolean;
  /** 手动时钟模式（用于单元测试精确步进，不启动后台 rAF 循环） */
  manualTick?: boolean;
  onFrame?: (frame: MotionFrame) => void;
  onComplete?: () => void;
}

export interface CoordinatedViewport {
  x: number;
  y: number;
  zoom: number;
}

/** 计算 DAG 中每个节点的层深（0 = 根；最长路径层级） */
export function computeNodeDepths(doc: MindMapDocumentV1): Map<string, number> {
  const nodes = doc.document.nodes;
  const edges = doc.document.edges;
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();

  for (const n of nodes) {
    succ.set(n.id, []);
    pred.set(n.id, []);
  }
  for (const e of edges) {
    succ.get(e.sourceNodeId)?.push(e.targetNodeId);
    pred.get(e.targetNodeId)?.push(e.sourceNodeId);
  }

  // Kahn 拓扑层级计算
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, pred.get(n.id)?.length ?? 0);

  const queue: string[] = [];
  const depths = new Map<string, number>();
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      depths.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currDepth = depths.get(curr) ?? 0;
    for (const next of succ.get(curr) ?? []) {
      depths.set(next, Math.max(depths.get(next) ?? 0, currDepth + 1));
      const remaining = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  // 孤立节点或环中残留节点赋 0
  for (const n of nodes) {
    if (!depths.has(n.id)) depths.set(n.id, 0);
  }

  return depths;
}

/** 计算每个节点的错峰延迟（叶子先动 delay=0，主干最后归位；≥300 取消错峰） */
export function computeNodeDelays(doc: MindMapDocumentV1): Map<string, number> {
  const delays = new Map<string, number>();
  const nodeCount = doc.document.nodes.length;
  if (nodeCount >= MOTION_TIMELINE.scaleDegradationThreshold) {
    for (const n of doc.document.nodes) delays.set(n.id, 0);
    return delays;
  }

  const depths = computeNodeDepths(doc);
  let maxDepth = 0;
  for (const d of depths.values()) {
    if (d > maxDepth) maxDepth = d;
  }

  for (const [id, depth] of depths) {
    const rawDelay = (maxDepth - depth) * MOTION_TIMELINE.perLayerDelay;
    delays.set(id, Math.min(MOTION_TIMELINE.maxDelay, Math.max(0, rawDelay)));
  }

  return delays;
}

/** 视口一次性协调计算：前后边界并集 + 80px 安全留白 */
export function computeCoordinatedViewport(
  fromPositions: Map<string, Point>,
  toPositions: Map<string, Point>,
  doc: MindMapDocumentV1,
  containerWidth: number,
  containerHeight: number,
  currentViewport?: CoordinatedViewport,
): { target: CoordinatedViewport; needed: boolean } {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { target: { x: 0, y: 0, zoom: 1 }, needed: false };
  }

  const nodeMap = new Map(doc.document.nodes.map((n) => [n.id, n]));
  const boxes: NodeBox[] = [];

  for (const [id, to] of toPositions) {
    const n = nodeMap.get(id);
    if (!n) continue;
    const from = fromPositions.get(id) ?? to;
    boxes.push({ x: from.x, y: from.y, width: n.size.width, height: n.size.height });
    boxes.push({ x: to.x, y: to.y, width: n.size.width, height: n.size.height });
  }

  const bounds = graphBoundsOf(boxes);
  const pad = MOTION_TIMELINE.viewportPadding;
  const contentW = bounds.maxX - bounds.minX + pad * 2;
  const contentH = bounds.maxY - bounds.minY + pad * 2;

  // 缩放上限 clamp 至 [0.2, 1.0]（不把单个小节点放大到 maxZoom）
  const zoom = Math.max(0.2, Math.min(1.0, containerWidth / contentW, containerHeight / contentH));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const x = containerWidth / 2 - centerX * zoom;
  const y = containerHeight / 2 - centerY * zoom;

  const target = { x, y, zoom };

  // 若终态已经在当前视口安全边距内，无需改变镜头
  if (currentViewport) {
    const toBoxes: NodeBox[] = [];
    for (const [id, to] of toPositions) {
      const n = nodeMap.get(id);
      if (n) toBoxes.push({ x: to.x, y: to.y, width: n.size.width, height: n.size.height });
    }
    const toGb = graphBoundsOf(toBoxes);
    const vpMinX = -currentViewport.x / currentViewport.zoom;
    const vpMinY = -currentViewport.y / currentViewport.zoom;
    const vpMaxX = vpMinX + containerWidth / currentViewport.zoom;
    const vpMaxY = vpMinY + containerHeight / currentViewport.zoom;

    if (
      toGb.minX >= vpMinX + pad &&
      toGb.minY >= vpMinY + pad &&
      toGb.maxX <= vpMaxX - pad &&
      toGb.maxY <= vpMaxY - pad
    ) {
      return { target: currentViewport, needed: false };
    }
  }

  return { target, needed: true };
}

/** 动画状态协调器单例类 */
export class MotionCoordinator {
  private phase: MotionPhase = "idle";
  private t0 = 0;
  private duration: number = MOTION_TIMELINE.duration;
  private mainDuration: number = MOTION_TIMELINE.mainDuration;
  private fromPositions = new Map<string, Point>();
  private toPositions = new Map<string, Point>();
  private delays = new Map<string, number>();
  private interruptedNodes = new Map<string, Point>();
  private lineMorphFrom = 0;
  private lineMorphTo = 1;
  private currentLineMorph = 0;
  private currentPositions = new Map<string, Point>();
  private frozenRoutes?: Map<string, RoutedEdge> | undefined;
  private direction: LayoutDirection = "horizontal";
  private rafId: number | null = null;
  private manualTick = false;
  private activeDoc: MindMapDocumentV1 | null = null;
  private onFrameCallback?: ((frame: MotionFrame) => void) | undefined;
  private onCompleteCallback?: (() => void) | undefined;

  public getPhase(): MotionPhase {
    return this.phase;
  }

  public getCurrentPositions(): Map<string, Point> {
    return new Map(this.currentPositions);
  }

  public getCurrentLineMorph(): number {
    return this.currentLineMorph;
  }

  /**
   * 启动散乱→规整过渡
   * @param doc 当前包含目标位置的 canonical document
   * @param from 初始显示坐标集（从屏幕当前显示态接续）
   * @param to 目标坐标集
   * @param options 运行配置
   */
  public start(
    doc: MindMapDocumentV1,
    from: Map<string, Point>,
    to: Map<string, Point>,
    options: MotionOptions = {},
  ): void {
    this.cancel();

    this.activeDoc = doc;
    this.direction = options.direction ?? "horizontal";
    this.fromPositions = new Map(from);
    this.toPositions = new Map(to);
    this.interruptedNodes.clear();
    this.manualTick = options.manualTick ?? false;
    this.lineMorphFrom = this.currentLineMorph;
    this.lineMorphTo = 1;
    this.onFrameCallback = options.onFrame;
    this.onCompleteCallback = options.onComplete;

    // 规模降级：≥300 节点取消错峰，总时长收缩为 600ms
    const isDense = doc.document.nodes.length >= MOTION_TIMELINE.scaleDegradationThreshold;
    this.mainDuration = MOTION_TIMELINE.mainDuration;
    this.duration = isDense ? this.mainDuration : MOTION_TIMELINE.duration;
    this.delays = computeNodeDelays(doc);

    // 冻结目标拓扑的路由通道，动画期间不重选
    const nodeMap = new Map(doc.document.nodes.map((n) => [n.id, n]));
    const targetBoxes: NodeBox[] = [];
    const targetInputs: EdgePlanInput[] = [];
    for (const n of doc.document.nodes) {
      const p = to.get(n.id) ?? n.position;
      targetBoxes.push({ x: p.x, y: p.y, width: n.size.width, height: n.size.height });
    }
    for (const e of doc.document.edges) {
      const srcNode = nodeMap.get(e.sourceNodeId);
      const tgtNode = nodeMap.get(e.targetNodeId);
      if (!srcNode || !tgtNode) continue;
      const srcPos = to.get(srcNode.id) ?? srcNode.position;
      const tgtPos = to.get(tgtNode.id) ?? tgtNode.position;
      targetInputs.push({
        id: e.id,
        sourceId: srcNode.id,
        targetId: tgtNode.id,
        source: {
          x: srcPos.x,
          y: srcPos.y,
          width: srcNode.size.width,
          height: srcNode.size.height,
        },
        target: {
          x: tgtPos.x,
          y: tgtPos.y,
          width: tgtNode.size.width,
          height: tgtNode.size.height,
        },
      });
    }
    this.frozenRoutes = planEdgeRoutes(targetInputs, this.direction, { obstacles: targetBoxes });

    // prefers-reduced-motion：归零直接到达终态
    if (options.reducedMotion) {
      this.currentPositions = new Map(to);
      this.currentLineMorph = 1;
      this.phase = "completed";
      const frame = this.calculateFrame(this.currentPositions, 1, "completed");
      this.onFrameCallback?.(frame);
      this.onCompleteCallback?.();
      return;
    }

    this.phase = "running";
    this.t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.tick(this.t0);
  }

  /**
   * 撤销/重做接续过渡：从当前显示坐标 lerp 回目标历史态（lineMorph 回退至 0）
   */
  public reverseTo(
    doc: MindMapDocumentV1,
    targetPositions: Map<string, Point>,
    options: MotionOptions = {},
  ): void {
    const from = new Map(this.currentPositions);
    this.cancel();

    this.activeDoc = doc;
    this.direction = options.direction ?? "horizontal";
    this.fromPositions = from;
    this.toPositions = new Map(targetPositions);
    this.interruptedNodes.clear();
    this.manualTick = options.manualTick ?? false;
    this.lineMorphFrom = this.currentLineMorph;
    this.lineMorphTo = 0; // 回到散乱曲线态
    this.onFrameCallback = options.onFrame;
    this.onCompleteCallback = options.onComplete;

    // undo 时全节点同频复位（无错峰）
    this.mainDuration = MOTION_TIMELINE.mainDuration;
    this.duration = this.mainDuration;
    this.delays = new Map(doc.document.nodes.map((n) => [n.id, 0]));

    if (options.reducedMotion) {
      this.currentPositions = new Map(targetPositions);
      this.currentLineMorph = 0;
      this.phase = "completed";
      const frame = this.calculateFrame(this.currentPositions, 0, "completed");
      this.onFrameCallback?.(frame);
      this.onCompleteCallback?.();
      return;
    }

    this.phase = "running";
    this.t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.tick(this.t0);
  }

  /** 节点拖动打断：该节点脱离过渡动画被拖拽接管，其余节点继续过渡 */
  public interruptNode(nodeId: string, position: Point): void {
    if (this.phase !== "running") return;
    this.interruptedNodes.set(nodeId, position);
    this.currentPositions.set(nodeId, position);
    if (this.activeDoc) {
      const frame = this.calculateFrame(this.currentPositions, this.currentLineMorph, "running");
      this.onFrameCallback?.(frame);
    }
  }

  /** 终止动画 */
  public cancel(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.phase === "running") this.phase = "interrupted";
  }

  /** 当前线形态参数（0 = 散乱曲线，1 = 规整正交；整理/undo 动画终态驻留）。 */
  public getLineMorph(): number {
    return this.currentLineMorph;
  }

  /**
   * 规整态驻留（DFR-020）：整理完成后再次编辑/单节点拖动走的是普通重投影，
   * 不能把连线掉回贝塞尔——用最新 doc（位置/尺寸已变）按驻留 lineMorph
   * 重算整态连线几何。散乱态（morph ≤ 0）返回 null，走投影默认曲线。
   */
  public settledEdgePaths(
    doc: MindMapDocumentV1,
  ): Map<string, { pathD: string; arrowD: string }> | null {
    if (this.currentLineMorph <= 0) return null;
    this.activeDoc = doc;
    const positions = new Map<string, Point>(
      doc.document.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
    this.currentPositions = new Map(positions);
    const frame = this.calculateFrame(positions, this.currentLineMorph, "completed");
    return frame.edgePaths;
  }

  /** rAF 帧更新步进 */
  public tick(now: number): void {
    if (this.phase !== "running" || !this.activeDoc) return;

    const elapsed = now - this.t0;
    const positions = new Map<string, Point>();
    let allFinished = true;

    for (const n of this.activeDoc.document.nodes) {
      if (this.interruptedNodes.has(n.id)) {
        positions.set(n.id, this.interruptedNodes.get(n.id)!);
        continue;
      }
      const from = this.fromPositions.get(n.id) ?? n.position;
      const to = this.toPositions.get(n.id) ?? n.position;
      const delay = this.delays.get(n.id) ?? 0;
      const localProgress = Math.max(0, Math.min(1, (elapsed - delay) / this.mainDuration));
      if (localProgress < 1) allFinished = false;

      const f = easeOutCubic(localProgress);
      positions.set(n.id, {
        x: from.x + (to.x - from.x) * f,
        y: from.y + (to.y - from.y) * f,
      });
    }

    const morphT = Math.max(0, Math.min(1, elapsed / this.mainDuration));
    const m = this.lineMorphFrom + (this.lineMorphTo - this.lineMorphFrom) * easeOutCubic(morphT);

    this.currentPositions = positions;
    this.currentLineMorph = m;

    if (allFinished || elapsed >= this.duration - 1) {
      this.phase = "completed";
      this.currentPositions = new Map(this.toPositions);
      // 保持被拖拽打断的节点位置
      for (const [id, p] of this.interruptedNodes) this.currentPositions.set(id, p);
      this.currentLineMorph = this.lineMorphTo;
      const finalFrame = this.calculateFrame(
        this.currentPositions,
        this.currentLineMorph,
        "completed",
      );
      this.onFrameCallback?.(finalFrame);
      this.onCompleteCallback?.();
      this.rafId = null;
      return;
    }

    const frame = this.calculateFrame(positions, m, "running");
    this.onFrameCallback?.(frame);

    if (!this.manualTick && typeof requestAnimationFrame !== "undefined") {
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  /** 由当前当帧显示坐标与形态参数，计算全图连线与箭头 SVG 几何 */
  public calculateFrame(
    positions: Map<string, Point>,
    lineMorph: number,
    phase: MotionPhase,
  ): MotionFrame {
    if (!this.activeDoc) {
      return { positions, edgePaths: new Map(), lineMorph, phase };
    }

    const nodeMap = new Map(this.activeDoc.document.nodes.map((n) => [n.id, n]));
    const boxes: NodeBox[] = [];
    const inputs: EdgePlanInput[] = [];

    for (const [id, pos] of positions) {
      const n = nodeMap.get(id);
      if (!n) continue;
      boxes.push({ x: pos.x, y: pos.y, width: n.size.width, height: n.size.height });
    }

    for (const e of this.activeDoc.document.edges) {
      const srcNode = nodeMap.get(e.sourceNodeId);
      const tgtNode = nodeMap.get(e.targetNodeId);
      if (!srcNode || !tgtNode) continue;
      const srcPos = positions.get(srcNode.id) ?? srcNode.position;
      const tgtPos = positions.get(tgtNode.id) ?? tgtNode.position;

      inputs.push({
        id: e.id,
        sourceId: srcNode.id,
        targetId: tgtNode.id,
        source: {
          x: srcPos.x,
          y: srcPos.y,
          width: srcNode.size.width,
          height: srcNode.size.height,
        },
        target: {
          x: tgtPos.x,
          y: tgtPos.y,
          width: tgtNode.size.width,
          height: tgtNode.size.height,
        },
      });
    }

    const geoms = planEdgeGeometry(inputs, this.direction, lineMorph, {
      obstacles: boxes,
      routes: this.frozenRoutes,
    });

    const edgePaths = new Map<string, { pathD: string; arrowD: string }>();
    for (const [id, g] of geoms) {
      edgePaths.set(id, {
        pathD: edgePathD(g, lineMorph),
        arrowD: arrowD(g),
      });
    }

    return { positions, edgePaths, lineMorph, phase };
  }
}
