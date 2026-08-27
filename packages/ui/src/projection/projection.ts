// SelectedCanvasProjection（ADR 0002）：core document → React Flow 视图模型。
// 纯函数、无 React 依赖：core nodes/edges 是唯一事实源；画布库内部
// selection/measurement/缓存绝不进入投影产物，也绝不进入文件。
// node size 直接采用 core 持久化权威值（不触发 RF 自动测量）。

import type {
  FontToken,
  MindEdge,
  MindMapDocumentV1,
  MindNode,
  NodeShape,
  TextRun,
  ThemeName,
} from "@mindmap/core";
import type { Edge, Node } from "@xyflow/react";

export interface MindNodeData extends Record<string, unknown> {
  text: string;
  runs: TextRun[] | undefined;
  /** 解析后的有效形状（节点覆盖 ?? 文档默认）。 */
  shape: NodeShape;
  theme: ThemeName;
  font: FontToken;
  /** frame（节点外框）是否绘制。 */
  framesVisible: boolean;
}

export type MindFlowNode = Node<MindNodeData, "mind">;
export type MindFlowEdge = Edge;

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
      shape: node.shape ?? defaults.shape,
      theme: defaults.theme,
      font: defaults.font,
      framesVisible: defaults.framesVisible,
    },
  };
}

export function projectEdge(edge: MindEdge): MindFlowEdge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
  };
}

export function projectDocument(doc: MindMapDocumentV1): ProjectedView {
  const defaults = documentDefaults(doc);
  return {
    nodes: doc.document.nodes.map((n) => projectNode(n, defaults)),
    edges: doc.document.edges.map(projectEdge),
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
