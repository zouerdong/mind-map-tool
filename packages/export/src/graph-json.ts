// Graph JSON：Agent 可无缝理解的第四导出格式（PRD §5 导出行，[from-user 2026-09-06]）。
// 自描述图数据：graph.nodes / graph.edges + 位置/尺寸/样式语义，Agent 无需读内部 schema 文档。
// 与保存格式（schemaVersion 演进）相互独立——消费者不承担版本升级；确定性输出
// （同文档同 bytes，无时间戳/机器信息）。数值 3 位小数、-0 归零（与 canonical 一致）。

import type { MindMapDocumentV1, TextRun } from "@mindmap/core";

export const GRAPH_JSON_FORMAT = "mindmap-graph-json";
export const GRAPH_JSON_VERSION = 1;
/** label 截断上限（label 是 text 首行的便捷摘要，全文在 text）。 */
const LABEL_MAX = 60;

export interface GraphJsonMeta {
  theme: "light" | "dark";
  font: "noto-sans-sc" | "lxgw-wenkai";
  shape: "card" | "ellipse";
  framesVisible: boolean;
  nodeCount: number;
  edgeCount: number;
}

export interface GraphJsonNode {
  id: string;
  /** text 首行的便捷摘要（≤60 字符，无换行）；全文见 text。 */
  label: string;
  /** 节点正文（可含 \n 换行）。 */
  text: string;
  /** 可选眉题（单行小字标签；缺省不输出）。 */
  kicker?: string;
  /** 强调角色（橙实心卡；缺省不输出）。 */
  emphasis?: boolean;
  /** 单节点形状覆盖（缺省继承 meta.shape，不输出）。 */
  shape?: "card" | "ellipse";
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** 富文本样式区间（可选；偏移指向 text）。 */
  runs?: Array<Pick<TextRun, "start" | "end"> & Partial<Omit<TextRun, "start" | "end">>>;
}

export interface GraphJsonEdge {
  id: string;
  /** 指向 graph.nodes[].id。 */
  source: string;
  target: string;
  /** 线型外观（缺省 solid，不输出）。 */
  lineStyle?: "dashed" | "dotted";
}

export interface GraphJsonExport {
  format: typeof GRAPH_JSON_FORMAT;
  version: typeof GRAPH_JSON_VERSION;
  meta: GraphJsonMeta;
  graph: { nodes: GraphJsonNode[]; edges: GraphJsonEdge[] };
}

function num(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function labelOf(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.length > LABEL_MAX ? firstLine.slice(0, LABEL_MAX - 1) + "…" : firstLine;
}

/** document → Graph JSON 结构（顺序与字段确定；缺省值不输出）。 */
export function toGraphJson(doc: MindMapDocumentV1): GraphJsonExport {
  const d = doc.document;
  return {
    format: GRAPH_JSON_FORMAT,
    version: GRAPH_JSON_VERSION,
    meta: {
      theme: d.theme,
      font: d.font,
      shape: d.shape,
      framesVisible: d.framesVisible !== false,
      nodeCount: d.nodes.length,
      edgeCount: d.edges.length,
    },
    graph: {
      nodes: d.nodes.map((n) => {
        const node: GraphJsonNode = {
          id: n.id,
          label: labelOf(n.text),
          text: n.text,
          position: { x: num(n.position.x), y: num(n.position.y) },
          size: { width: num(n.size.width), height: num(n.size.height) },
        };
        if (n.kicker !== undefined && n.kicker.length > 0) node.kicker = n.kicker;
        if (n.emphasis === true) node.emphasis = true;
        if (n.shape !== undefined) node.shape = n.shape;
        if (n.runs !== undefined && n.runs.length > 0)
          node.runs = n.runs.map((r) => {
            const out: NonNullable<GraphJsonNode["runs"]>[number] = { start: r.start, end: r.end };
            if (r.bold !== undefined) out.bold = r.bold;
            if (r.underline !== undefined) out.underline = r.underline;
            if (r.fontSize !== undefined) out.fontSize = num(r.fontSize);
            return out;
          });
        return node;
      }),
      edges: d.edges.map((e) => {
        const edge: GraphJsonEdge = { id: e.id, source: e.sourceNodeId, target: e.targetNodeId };
        if (e.lineStyle === "dashed" || e.lineStyle === "dotted") edge.lineStyle = e.lineStyle;
        return edge;
      }),
    },
  };
}

/** 确定性编码：两空格缩进、LF、末尾换行、固定键序（JSON.stringify 按插入序）。 */
export function encodeGraphJson(doc: MindMapDocumentV1): Uint8Array {
  const text = JSON.stringify(toGraphJson(doc), null, 2) + "\n";
  return new TextEncoder().encode(text);
}
