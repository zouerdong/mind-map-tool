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
}

export type MindFlowNode = Node<MindNodeData, "mind">;

export interface MindEdgeData extends Record<string, unknown> {
  lineStyle: LineStyle;
  theme: ThemeName;
  /** 自定义主线 SVG path（整理动效或规整态由 edgePathD 计算，缺省走 RF 平滑贝塞尔） */
  pathD?: string;
  /** 自定义箭头 SVG path（与 export 共享三角箭头，缺省走 markerEnd） */
  arrowD?: string;
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
  } satisfies Pick< MindNodeData, "theme" | "font" | "shape" | "framesVisible">;
}

export function projectNode(node: MindNode, defaults: ReturnType<typeof documentDefaults>): MindFlowNode {
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
    },
  };
}

/** 线型 dash（G-VIS tokens §1.4：虚 5 4 / 点 0.1 5 round；实线无 dash）。 */
export function edgeDash(lineStyle: LineStyle): string | undefined {
  if (lineStyle === "dashed") return "5 4";
  if (lineStyle === "dotted") return "0.1 5";
  return undefined;
}

export function projectEdge(edge: MindEdge, theme: ThemeName): MindFlowEdge {
  // G-VIS D4：默认箭头（指向 target）；实/虚/点线型；颜色与 export 同源。
  // 自由拖动态为平滑曲线（RF default bezier）；正交规整态布线归 VRA-060 消费
  // export planEdgeGeometry —— 本卡先把方向（底出顶入）与外观做对。
  const t = themeTokens(theme);
  const lineStyle = edge.lineStyle ?? "solid";
  const stroke = lineStyle === "solid" ? t.edgePrimary : t.edgeSecondary;
  return {
    id: edge.id,
    type: "mind",
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    data: { lineStyle, theme },
    style: {
      stroke,
      strokeWidth: lineStyle === "solid" ? 2 : 1.5,
      ...(edgeDash(lineStyle) !== undefined
        ? { strokeDasharray: edgeDash(lineStyle) }
        : {}),
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
  };
}

export function projectDocument(doc: MindMapDocumentV1): ProjectedView {
  const defaults = documentDefaults(doc);
  return {
    nodes: doc.document.nodes.map((n) => projectNode(n, defaults)),
    edges: doc.document.edges.map((e) => projectEdge(e, defaults.theme)),
  };
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
