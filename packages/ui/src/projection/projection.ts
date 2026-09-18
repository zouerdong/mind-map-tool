// SelectedCanvasProjection（ADR 0002）：core document → React Flow 视图模型。
// 纯函数、无 React 依赖：core nodes/edges 是唯一事实源；画布库内部
// selection/measurement/缓存绝不进入投影产物，也绝不进入文件。
// node size 直接采用 core 持久化权威值（不触发 RF 自动测量）。
// VRA-050：kicker/emphasis/lineStyle（ADR 0010）与 G-VIS palette 同源投影。

import type {
  FontToken,
  LineStyle,
  MindEdge,
  MindMapDocumentV1,
  MindNode,
  NodeShape,
  TextRun,
  ThemeName,
} from "@mindmap/core";
import { deriveNodeDepths } from "@mindmap/core";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { themeTokens } from "../theme/theme-tokens.js";

export interface MindNodeData extends Record<string, unknown> {
  text: string;
  runs: TextRun[] | undefined;
  /** 可选单行眉题（ADR 0010；缺省 undefined = 无眉题自然卡）。 */
  kicker: string | undefined;
  /** 强调角色（ADR 0010；true = 橙实心卡）。 */
  emphasis: boolean;
  /** 解析后的有效形状（节点覆盖 ?? 文档默认）。 */
  shape: NodeShape;
  theme: ThemeName;
  font: FontToken;
  /** frame（节点外框）是否绘制。 */
  framesVisible: boolean;
  /** 层级深度（ADR 0020；BFS 最短路径派生，源=1；孤立节点 undefined = 不染色）。 */
  depth: number | undefined;
}

export type MindFlowNode = Node<MindNodeData, "mind">;

export interface MindEdgeData extends Record<string, unknown> {
  lineStyle: LineStyle;
  theme: ThemeName;
  /** 自定义主线 SVG path（整理动效或规整态由 edgePathD 计算，缺省走 RF 平滑贝塞尔） */
  pathD?: string;
  /** 自定义箭头 SVG path（与 export 共享三角箭头，缺省走 markerEnd） */
  arrowD?: string;
  /** 能量脉冲窗口（2026-09-18 内测批次④）：[0,1] 周期内的起止份额与周期时长。
   *  会话态，只在 mind-edge 渲染期消费，不进文件与导出。 */
  pulse?: { beginFrac: number; endFrac: number; durMs: number };
  /** 脉冲来路的静态高亮（pulse 播放时同亮；reduced-motion 退化为仅此）。 */
  pulseHighlight?: boolean;
}

export type MindFlowEdge = Edge<MindEdgeData, "mind">;

export interface ProjectedView {
  nodes: MindFlowNode[];
  edges: MindFlowEdge[];
}

/** 文档级默认值（theme/font/shape/framesVisible）。 */
export function documentDefaults(doc: MindMapDocumentV1) {
  const d = doc.document;
  return {
    theme: d.theme,
    font: d.font,
    shape: d.shape,
    framesVisible: d.framesVisible,
  } satisfies Pick<MindNodeData, "theme" | "font" | "shape" | "framesVisible">;
}

export function projectNode(
  node: MindNode,
  defaults: ReturnType<typeof documentDefaults>,
  depth?: number,
): MindFlowNode {
  return {
    id: node.id,
    type: "mind",
    position: { x: node.position.x, y: node.position.y },
    width: node.size.width,
    height: node.size.height,
    data: {
      text: node.text,
      runs: node.runs,
      kicker: node.kicker,
      emphasis: node.emphasis === true,
      shape: node.shape ?? defaults.shape,
      theme: defaults.theme,
      font: defaults.font,
      framesVisible: defaults.framesVisible,
      depth,
    },
  };
}

/** 线型 dash（G-VIS tokens §1.4：虚 5 4 / 点 0.1 5 round；实线无 dash）。 */
export function edgeDash(lineStyle: LineStyle): string | undefined {
  if (lineStyle === "dashed") return "5 4";
  if (lineStyle === "dotted") return "0.1 5";
  return undefined;
}

export function projectEdge(
  edge: MindEdge,
  theme: ThemeName,
  anchors?: { sourceHandle: string; targetHandle: string },
): MindFlowEdge {
  // G-VIS D4：默认箭头（指向 target）；实/虚/点线型；颜色与 export 同源。
  // 自由拖动态为平滑曲线（RF default bezier）；正交规整态布线归 VRA-060 消费
  // export planEdgeGeometry —— 本卡先把方向（底出顶入）与外观做对。
  // ADR 0019：双侧锚点——sourceHandle/targetHandle 由投影按相对几何派生（见下方调用点）。
  const t = themeTokens(theme);
  const lineStyle = edge.lineStyle ?? "solid";
  const stroke = lineStyle === "solid" ? t.edgePrimary : t.edgeSecondary;
  return {
    id: edge.id,
    type: "mind",
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    ...(anchors ? { sourceHandle: anchors.sourceHandle, targetHandle: anchors.targetHandle } : {}),
    data: { lineStyle, theme },
    style: {
      stroke,
      strokeWidth: lineStyle === "solid" ? 2 : 1.5,
      ...(edgeDash(lineStyle) !== undefined ? { strokeDasharray: edgeDash(lineStyle) } : {}),
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
  };
}

export function projectDocument(doc: MindMapDocumentV1): ProjectedView {
  const defaults = documentDefaults(doc);
  const depths = deriveNodeDepths(doc); // ADR 0020：层级阶梯派生（投影层，不落 schema）
  const nodesById = new Map(doc.document.nodes.map((n) => [n.id, n]));
  return {
    nodes: doc.document.nodes.map((n) => projectNode(n, defaults, depths.get(n.id))),
    edges: doc.document.edges.map((e) => {
      // ADR 0019：锚点侧确定性派生（目标中心在源中心左侧 → 左出右入；平局右出左入）
      const s = nodesById.get(e.sourceNodeId);
      const tgt = nodesById.get(e.targetNodeId);
      const anchors =
        s && tgt
          ? deriveHandleSides(s.position.x + s.size.width / 2, tgt.position.x + tgt.size.width / 2)
          : undefined;
      return projectEdge(e, defaults.theme, anchors);
    }),
  };
}

/** 双侧锚点规则（ADR 0019）：目标中心严格偏左 → 源左出/目标右入；否则右出左入。 */
export function deriveHandleSides(
  sourceCenterX: number,
  targetCenterX: number,
): { sourceHandle: string; targetHandle: string } {
  return targetCenterX < sourceCenterX
    ? { sourceHandle: "s-left", targetHandle: "t-right" }
    : { sourceHandle: "s-right", targetHandle: "t-left" };
}

/** 投影幂等性检查（contract tests 使用；生产亦可防御性调用）。 */
export function projectionIsStable(doc: MindMapDocumentV1, view: ProjectedView): boolean {
  const d = doc.document;
  if (view.nodes.length !== d.nodes.length || view.edges.length !== d.edges.length) return false;
  const nodeById = new Map(view.nodes.map((n) => [n.id, n]));
  for (const core of d.nodes) {
    const vm = nodeById.get(core.id);
    if (!vm) return false;
    if (vm.position.x !== core.position.x || vm.position.y !== core.position.y) return false;
    if (vm.width !== core.size.width || vm.height !== core.size.height) return false;
    if (vm.data.text !== core.text) return false;
  }
  const edgeById = new Map(view.edges.map((e) => [e.id, e]));
  for (const core of d.edges) {
    const vm = edgeById.get(core.id);
    if (!vm) return false;
    if (vm.source !== core.sourceNodeId || vm.target !== core.targetNodeId) return false;
  }
  return true;
}
