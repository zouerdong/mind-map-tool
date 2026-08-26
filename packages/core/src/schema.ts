// V1 schema：类型、上限与校验。平台无关；不依赖任何运行时环境。
// PRD §8.1 / ADR 0003：selection/viewport/history/path/target handle/onboarding
// 一律不入文件。shape/font 为 [from-user] G1 后新增的产品字段（PRD §5.1）。

export type ThemeName = "light" | "dark";
export type FontToken = "noto-sans-sc" | "lxgw-wenkai";
export type NodeShape = "card" | "ellipse";

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

/** [from-user] 节点内富文本样式区间：作用于 text 的 [start, end) 偏移。
 *  约束：区间有序、互不重叠、落在 text 长度内；fontSize 绝对值（px，8–72）。 */
export interface TextRun {
  start: number;
  end: number;
  bold?: boolean;
  underline?: boolean;
  fontSize?: number;
}

export const RUN_LIMITS = { minFontSize: 8, maxFontSize: 72 } as const;

export interface MindNode {
  id: string;
  text: string;
  position: Point;
  size: Size;
  /** 可选的单节点形状覆盖；缺省继承文档级默认形状 */
  shape?: NodeShape;
  /** 可选的富文本样式区间（无则整段使用节点默认排版） */
  runs?: TextRun[];
}

export interface MindEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface MindMapDocumentData {
  theme: ThemeName;
  font: FontToken;
  shape: NodeShape;
  /** [from-user] 框体一键显隐：false 时全部节点隐藏框体（纯文字呈现）；随文档持久化、可 undo、触发 dirty */
  framesVisible: boolean;
  nodes: MindNode[];
  edges: MindEdge[];
}

export interface MindMapDocumentV1 {
  schemaVersion: 1;
  document: MindMapDocumentData;
}

/** schema 上限：在 parse 后、分配大结构前拒绝。 */
export const LIMITS = {
  maxNodes: 10_000,
  maxEdges: 30_000,
  maxTextLength: 10_000,
  maxCoordAbs: 1_000_000,
  minSize: 1,
  maxSize: 100_000,
  maxInputBytes: 50 * 1024 * 1024, // 50 MB 读取前置上限
} as const;

export type SchemaError =
  | { code: "NOT_OBJECT" }
  | { code: "BAD_SCHEMA_VERSION"; actual: unknown }
  | { code: "BAD_THEME"; actual: unknown }
  | { code: "BAD_FONT"; actual: unknown }
  | { code: "BAD_SHAPE"; actual: unknown }
  | { code: "BAD_FRAMES_VISIBLE"; actual: unknown }
  | { code: "BAD_DOCUMENT" }
  | { code: "NODES_NOT_ARRAY" }
  | { code: "EDGES_NOT_ARRAY" }
  | { code: "NODE_MISSING_FIELD"; index: number; field: string }
  | { code: "NODE_BAD_ID"; index: number }
  | { code: "NODE_BAD_TEXT"; index: number }
  | { code: "NODE_BAD_POSITION"; index: number }
  | { code: "NODE_BAD_SIZE"; index: number }
  | { code: "NODE_BAD_SHAPE"; index: number }
  | { code: "NODE_OUT_OF_RANGE"; index: number }
  | { code: "DUPLICATE_NODE_ID"; id: string }
  | { code: "EDGE_MISSING_FIELD"; index: number; field: string }
  | { code: "EDGE_BAD_ID"; index: number }
  | { code: "EDGE_BAD_ENDPOINT"; index: number }
  | { code: "DUPLICATE_EDGE_ID"; id: string }
  | { code: "DANGLING_EDGE"; id: string }
  | { code: "SELF_LOOP"; id: string }
  | { code: "DUPLICATE_EDGE_DIRECTION"; source: string; target: string }
  | { code: "LIMIT_EXCEEDED"; what: string; actual: number; max: number }
  | { code: "RUNS_BAD"; index: number; reason: string };

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateDocument(
  input: unknown,
): { ok: true; doc: MindMapDocumentV1 } | { ok: false; error: SchemaError } {
  if (typeof input !== "object" || input === null)
    return { ok: false, error: { code: "NOT_OBJECT" } };
  const root = input as Record<string, unknown>;
  if (root.schemaVersion !== 1)
    return { ok: false, error: { code: "BAD_SCHEMA_VERSION", actual: root.schemaVersion } };
  const doc = root.document;
  if (typeof doc !== "object" || doc === null)
    return { ok: false, error: { code: "BAD_DOCUMENT" } };
  const d = doc as Record<string, unknown>;
  if (d.theme !== "light" && d.theme !== "dark")
    return { ok: false, error: { code: "BAD_THEME", actual: d.theme } };
  if (d.font !== "noto-sans-sc" && d.font !== "lxgw-wenkai")
    return { ok: false, error: { code: "BAD_FONT", actual: d.font } };
  if (d.shape !== "card" && d.shape !== "ellipse")
    return { ok: false, error: { code: "BAD_SHAPE", actual: d.shape } };
  if (!Array.isArray(d.nodes)) return { ok: false, error: { code: "NODES_NOT_ARRAY" } };
  if (!Array.isArray(d.edges)) return { ok: false, error: { code: "EDGES_NOT_ARRAY" } };
  if (d.nodes.length > LIMITS.maxNodes)
    return {
      ok: false,
      error: {
        code: "LIMIT_EXCEEDED",
        what: "nodes",
        actual: d.nodes.length,
        max: LIMITS.maxNodes,
      },
    };
  if (d.edges.length > LIMITS.maxEdges)
    return {
      ok: false,
      error: {
        code: "LIMIT_EXCEEDED",
        what: "edges",
        actual: d.edges.length,
        max: LIMITS.maxEdges,
      },
    };

  const nodeIds = new Set<string>();
  for (let i = 0; i < d.nodes.length; i++) {
    const n = d.nodes[i] as Record<string, unknown>;
    if (typeof n.id !== "string" || n.id.length === 0 || n.id.length > 256)
      return { ok: false, error: { code: "NODE_BAD_ID", index: i } };
    if (typeof n.text !== "string" || n.text.length > LIMITS.maxTextLength)
      return { ok: false, error: { code: "NODE_BAD_TEXT", index: i } };
    const p = n.position as Record<string, unknown> | undefined;
    if (
      typeof p !== "object" ||
      p === null ||
      !isFiniteNumber(p.x) ||
      !isFiniteNumber(p.y) ||
      Math.abs(p.x) > LIMITS.maxCoordAbs ||
      Math.abs(p.y) > LIMITS.maxCoordAbs
    )
      return { ok: false, error: { code: "NODE_BAD_POSITION", index: i } };
    const s = n.size as Record<string, unknown> | undefined;
    if (
      typeof s !== "object" ||
      s === null ||
      !isFiniteNumber(s.width) ||
      !isFiniteNumber(s.height) ||
      s.width < LIMITS.minSize ||
      s.height < LIMITS.minSize ||
      s.width > LIMITS.maxSize ||
      s.height > LIMITS.maxSize
    )
      return { ok: false, error: { code: "NODE_BAD_SIZE", index: i } };
    if (n.shape !== undefined && n.shape !== "card" && n.shape !== "ellipse")
      return { ok: false, error: { code: "NODE_BAD_SHAPE", index: i } };
    if (n.runs !== undefined) {
      if (!Array.isArray(n.runs))
        return { ok: false, error: { code: "RUNS_BAD", index: i, reason: "not-array" } };
      let prevEnd = -1;
      for (let r = 0; r < n.runs.length; r++) {
        const run = n.runs[r] as Record<string, unknown>;
        const start = run.start,
          end = run.end;
        if (
          typeof start !== "number" ||
          typeof end !== "number" ||
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end <= start ||
          end > n.text.length ||
          start < prevEnd // 有序且不重叠
        )
          return { ok: false, error: { code: "RUNS_BAD", index: i, reason: `range-${r}` } };
        prevEnd = end;
        if (run.bold !== undefined && typeof run.bold !== "boolean")
          return { ok: false, error: { code: "RUNS_BAD", index: i, reason: `bold-${r}` } };
        if (run.underline !== undefined && typeof run.underline !== "boolean")
          return { ok: false, error: { code: "RUNS_BAD", index: i, reason: `underline-${r}` } };
        if (
          run.fontSize !== undefined &&
          (typeof run.fontSize !== "number" ||
            run.fontSize < RUN_LIMITS.minFontSize ||
            run.fontSize > RUN_LIMITS.maxFontSize)
        )
          return { ok: false, error: { code: "RUNS_BAD", index: i, reason: `fontSize-${r}` } };
        if (run.bold === undefined && run.underline === undefined && run.fontSize === undefined)
          return { ok: false, error: { code: "RUNS_BAD", index: i, reason: `empty-${r}` } };
      }
    }
    if (nodeIds.has(n.id)) return { ok: false, error: { code: "DUPLICATE_NODE_ID", id: n.id } };
    nodeIds.add(n.id);
  }

  const edgeIds = new Set<string>();
  const directions = new Set<string>();
  for (let i = 0; i < d.edges.length; i++) {
    const e = d.edges[i] as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0 || e.id.length > 256)
      return { ok: false, error: { code: "EDGE_BAD_ID", index: i } };
    if (typeof e.sourceNodeId !== "string" || typeof e.targetNodeId !== "string")
      return { ok: false, error: { code: "EDGE_MISSING_FIELD", index: i, field: "endpoint" } };
    if (edgeIds.has(e.id)) return { ok: false, error: { code: "DUPLICATE_EDGE_ID", id: e.id } };
    edgeIds.add(e.id);
    if (!nodeIds.has(e.sourceNodeId) || !nodeIds.has(e.targetNodeId))
      return { ok: false, error: { code: "DANGLING_EDGE", id: e.id } };
    if (e.sourceNodeId === e.targetNodeId)
      return { ok: false, error: { code: "SELF_LOOP", id: e.id } };
    const dirKey = `${e.sourceNodeId} ${e.targetNodeId}`;
    if (directions.has(dirKey))
      return {
        ok: false,
        error: { code: "DUPLICATE_EDGE_DIRECTION", source: e.sourceNodeId, target: e.targetNodeId },
      };
    directions.add(dirKey);
  }

  // 深拷贝以隔离调用方（canonical 化前的规范化在这里做，见 canonical.ts）
  return {
    ok: true,
    doc: {
      schemaVersion: 1,
      document: {
        theme: d.theme,
        font: d.font,
        shape: d.shape,
        framesVisible: (d as { framesVisible?: unknown }).framesVisible === false ? false : true,
        nodes: d.nodes.map((raw) => {
          const n = raw as MindNode;
          const node: MindNode = {
            id: n.id,
            text: n.text,
            position: { x: n.position.x, y: n.position.y },
            size: { width: n.size.width, height: n.size.height },
          };
          if (n.shape !== undefined) node.shape = n.shape;
          if (n.runs !== undefined)
            node.runs = n.runs.map((r) => ({
              start: r.start,
              end: r.end,
              ...(r.bold !== undefined ? { bold: r.bold } : {}),
              ...(r.underline !== undefined ? { underline: r.underline } : {}),
              ...(r.fontSize !== undefined ? { fontSize: r.fontSize } : {}),
            }));
          return node;
        }),
        edges: d.edges.map((raw) => {
          const e = raw as MindEdge;
          return { id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId };
        }),
      },
    },
  };
}

export function emptyDocument(): MindMapDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: [],
      edges: [],
    },
  };
}
