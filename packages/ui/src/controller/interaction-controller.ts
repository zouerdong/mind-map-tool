// InteractionController（ADR 0002）：把归一化后的 UI 事件映射为 core commands。
// 纯函数工厂：无 DOM/React 依赖；id 生成与文本测量注入（测试可替换）。
// 映射总表见同目录 event-command-map.md（单一事实源，改动须同步）。

import type {
  Command,
  FontToken,
  MindMapDocumentV1,
  NodeShape,
  Point,
  Size,
  ThemeName,
  TextRun,
} from "@mindmap/core";
import { remapRunsForTextChange } from "./runs-remap.js";

export type MeasureText = (text: string, fontId: FontToken, kicker?: string, runs?: TextRun[]) => Size;

export interface InteractionControllerDeps {
  nextNodeId(): string;
  nextEdgeId(): string;
  /** 共享完整视觉度量（packages/export measureNodeVisual + FontResolver 注入）。 */
  measure: MeasureText;
  /** 当前文档字体（EditNodeText/CreateNode 尺寸必须与文档字体一致）。 */
  currentFont: () => FontToken;
}

export interface NodeDragDelta {
  id: string;
  position: Point;
}

export function createInteractionController(deps: InteractionControllerDeps) {
  return {
    /** 画布空白双击：任意位置创建节点（空文本，权威 size 由共享 layout 计算）。 */
    createNodeAt(position: Point, text = ""): Command {
      return {
        kind: "CreateNode",
        id: deps.nextNodeId(),
        text,
        position: { x: round3(position.x), y: round3(position.y) },
        size: deps.measure(text, deps.currentFont()),
      };
    },

    /**
     * 编辑提交（Enter/blur）：text 与 size 同命令提交（size 由共享 layout 计算）。
     * 文本未变化时返回 null（不产生空历史）。
     * DFR-020：kicker 独立于正文编辑——正文编辑必须保留眉题高度（传入节点
     * 当前眉题参与测量），不得量出无眉题的矮卡把眉题压掉。
     * DFR-090 F2：currentRuns（节点当前样式区间）经文本变更映射后随命令
     * 提交——整节点样式随正文续写保留，混合 runs 按区间模型映射而非原样
     * 套旧索引；测量也使用映射后的 runs，提交前后几何一致。不传
     *  currentRuns 时维持纯文本语义（core 清除旧 runs）。
     */
    commitEditText(
      id: string,
      nextText: string,
      currentText: string,
      kicker?: string,
      currentRuns?: TextRun[],
    ): Command | null {
      if (nextText === currentText) return null;
      const runs = remapRunsForTextChange(currentText, currentRuns, nextText);
      return {
        kind: "EditNodeText",
        id,
        text: nextText,
        size: deps.measure(nextText, deps.currentFont(), kicker, runs),
        ...(runs !== undefined ? { runs } : {}),
      };
    },

    /** 节点拖动结束：位置真实变化才提交（拖动只提交一次 command）。 */
    moveNodes(deltas: NodeDragDelta[], doc: MindMapDocumentV1): Command | null {
      const moves = deltas
        .map((d) => {
          const core = doc.document.nodes.find((n) => n.id === d.id);
          if (!core) return null;
          if (core.position.x === round3(d.position.x) && core.position.y === round3(d.position.y))
            return null;
          return { id: d.id, position: { x: round3(d.position.x), y: round3(d.position.y) } };
        })
        .filter((m): m is { id: string; position: Point } => m !== null);
      if (moves.length === 0) return null;
      return { kind: "MoveNodes", moves };
    },

    /**
     * 连接（handle 拖放）：预检自环与同方向重复（core 亦会拒绝；
     * 预检避免产生注定失败的历史请求）。
     */
    connect(sourceNodeId: string, targetNodeId: string, doc: MindMapDocumentV1): Command | null {
      if (sourceNodeId === targetNodeId) return null;
      const d = doc.document;
      if (d.edges.some((e) => e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId))
        return null;
      if (
        !d.nodes.some((n) => n.id === sourceNodeId) ||
        !d.nodes.some((n) => n.id === targetNodeId)
      )
        return null;
      return {
        kind: "CreateEdge",
        id: deps.nextEdgeId(),
        sourceNodeId,
        targetNodeId,
      };
    },

    /** 删除当前选择（节点 + 选中边；incident 边由 core 原子删除）。 */
    deleteSelection(nodeIds: string[], edgeIds: string[]): Command | null {
      if (nodeIds.length === 0 && edgeIds.length === 0) return null;
      return { kind: "DeleteSelection", nodeIds, edgeIds };
    },

    /** 主题切换（持久化、可 undo）。 */
    setTheme(theme: ThemeName): Command {
      return { kind: "SetDocumentStyle", theme };
    },

    /** 节点形状覆盖（持久化、可 undo）。 */
    setNodeShape(id: string, shape: NodeShape | null): Command {
      return { kind: "SetNodeShape", id, shape };
    },
  };
}

export type InteractionController = ReturnType<typeof createInteractionController>;

function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}
