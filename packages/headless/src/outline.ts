// outline.ts — Agent 大纲契约 v0（ADR 0014 §3）。
// 输入为 LLM 友好的树状大纲；bridge 负责校验并转成 core 统一命令层调用，
// 不直接拼装文档对象。节点 size 一律经 export 度量契约（measureNodeVisual）。

import {
  applyCommand,
  emptyDocument,
  makeStateNode,
  organize,
  LIMITS,
  type CommandError,
  type FontToken,
  type MindMapDocumentV1,
  type OrganizeDirection,
  type StateNode,
} from "@mindmap/core";
import type { ExportRenderer } from "@mindmap/export";
import { wideColumnarLayout } from "./wide-layout.js";

/** 树状大纲节点。text 必填非空；children 缺省为叶子。 */
export interface OutlineNode {
  text: string;
  children?: OutlineNode[];
}

export interface BuildOptions {
  /** 文档字体；缺省沿用产品默认（新文档文楷，OFR-2026-09-14 #4）。 */
  font?: FontToken;
  /** 整理布局方向；缺省 horizontal（G-VIS D7）。 */
  direction?: OrganizeDirection;
  /** 根节点强调角色（橙色"出发点"卡）；缺省 true，对齐 GUI 空文档首节点行为。 */
  emphasisRoot?: boolean;
  /** 宽而浅自适应分栏布局（horizontal 时生效，根在左、分支按宽高比分栏并排，
   *  ADR 0014 v1.2.0）；缺省 true；非单根树自动回退 organize 单侧层叠。 */
  wide?: boolean;
}

export type OutlineError =
  | { code: "BAD_OUTLINE"; reason: string }
  | { code: "LIMIT_EXCEEDED"; reason: string }
  | { code: "COMMAND_FAILED"; command: string; error: CommandError }
  | { code: "ORGANIZE_FAILED"; span: number; max: number };

export type BuildResult =
  | {
      ok: true;
      document: MindMapDocumentV1;
      nodeCount: number;
      edgeCount: number;
      /** 实际落地的布局：wide = 宽而浅分栏，layered = organize 单侧层叠（含回退）。 */
      layout: "wide" | "layered";
      /** wide 时的实际栏数；layered 时 0。 */
      columns: number;
    }
  | { ok: false; error: OutlineError };

/** 校验并展开大纲为 (id, text, parentId) 先序序列；迭代栈，10k 深链不爆调用栈。 */
function flattenOutline(root: unknown):
  | { ok: true; entries: { id: string; text: string; parentId: string | null }[] }
  | {
      ok: false;
      error: OutlineError;
    } {
  const bad = (reason: string): { ok: false; error: OutlineError } => ({
    ok: false,
    error: { code: "BAD_OUTLINE", reason },
  });
  if (typeof root !== "object" || root === null || Array.isArray(root))
    return bad("根必须是 { text, children? } 对象");
  const entries: { id: string; text: string; parentId: string | null }[] = [];
  // 显式栈：[node, parentId]
  const stack: { node: unknown; parentId: string | null }[] = [{ node: root, parentId: null }];
  while (stack.length > 0) {
    const { node, parentId } = stack.pop()!;
    if (typeof node !== "object" || node === null || Array.isArray(node))
      return bad("每个节点必须是 { text, children? } 对象");
    const o = node as Record<string, unknown>;
    if (typeof o.text !== "string" || o.text.trim().length === 0)
      return bad("节点 text 必须是非空字符串");
    if (o.text.length > LIMITS.maxTextLength)
      return {
        ok: false,
        error: {
          code: "LIMIT_EXCEEDED",
          reason: `text 长度 ${o.text.length} 超过上限 ${LIMITS.maxTextLength}`,
        },
      };
    const id = `n-${entries.length + 1}`;
    entries.push({ id, text: o.text, parentId });
    if (entries.length > LIMITS.maxNodes)
      return {
        ok: false,
        error: {
          code: "LIMIT_EXCEEDED",
          reason: `节点数超过上限 ${LIMITS.maxNodes}`,
        },
      };
    if (o.children !== undefined) {
      if (!Array.isArray(o.children)) return bad(`节点 ${id} 的 children 必须是数组`);
      // 逆序压栈保持先序（兄弟顺序与输入一致）
      for (let i = o.children.length - 1; i >= 0; i--) {
        stack.push({ node: o.children[i], parentId: id });
      }
    }
  }
  return { ok: true, entries };
}

/**
 * 大纲 → MindMapDocumentV1。全流程走 core 统一命令层
 * （CreateNode/CreateEdge/MoveNodes + 可选 SetDocumentStyle），
 * size 由 renderer.measureNodeVisual 权威度量；布局由 organize 计算。
 */
export function buildDocumentFromOutline(
  renderer: ExportRenderer,
  outline: unknown,
  options: BuildOptions = {},
): BuildResult {
  const flat = flattenOutline(outline);
  if (!flat.ok) return flat;
  const { entries } = flat;

  let state: StateNode = makeStateNode(emptyDocument());
  const apply = (
    command: Parameters<typeof applyCommand>[1],
    label: string,
  ): OutlineError | null => {
    const result = applyCommand(state, command);
    if (!result.ok) return { code: "COMMAND_FAILED", command: label, error: result.error };
    state = result.stateNode;
    return null;
  };

  if (options.font !== undefined && options.font !== state.document.document.font) {
    const err = apply({ kind: "SetDocumentStyle", font: options.font }, "SetDocumentStyle");
    if (err) return { ok: false, error: err };
  }
  const font = state.document.document.font;

  for (const entry of entries) {
    const size = renderer.measureNodeVisual({ text: entry.text }, font);
    const err = apply(
      {
        kind: "CreateNode",
        id: entry.id,
        text: entry.text,
        position: { x: 0, y: 0 },
        size,
        ...(entry.parentId === null && (options.emphasisRoot ?? true) ? { emphasis: true } : {}),
      },
      "CreateNode",
    );
    if (err) return { ok: false, error: err };
    if (entry.parentId !== null) {
      const edgeErr = apply(
        {
          kind: "CreateEdge",
          id: `e-${entry.id}`,
          sourceNodeId: entry.parentId,
          targetNodeId: entry.id,
        },
        "CreateEdge",
      );
      if (edgeErr) return { ok: false, error: edgeErr };
    }
  }

  const layout = organize(state.document, { direction: options.direction ?? "horizontal" });
  if (!layout.ok) {
    return {
      ok: false,
      error: { code: "ORGANIZE_FAILED", span: layout.error.span, max: layout.error.max },
    };
  }
  let finalPositions = layout.positions;
  let layoutKind: "wide" | "layered" = "layered";
  let columns = 0;
  if ((options.direction ?? "horizontal") === "horizontal" && (options.wide ?? true)) {
    const wideResult = wideColumnarLayout(state.document);
    if (wideResult.wide) {
      finalPositions = wideResult.positions;
      layoutKind = "wide";
      columns = wideResult.columns;
    }
  }
  const moves = [...finalPositions.entries()].map(([id, position]) => ({ id, position }));
  if (moves.length > 0) {
    const err = apply({ kind: "MoveNodes", moves }, "MoveNodes(organize)");
    if (err) return { ok: false, error: err };
  }

  return {
    ok: true,
    document: state.document,
    nodeCount: entries.length,
    edgeCount: entries.length - 1,
    layout: layoutKind,
    columns,
  };
}
