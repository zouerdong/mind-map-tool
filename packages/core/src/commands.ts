// 命令模型（ADR 0003）：纯函数 applyCommand(stateNode, command)。
// 首版命令：CreateNode / EditNodeText / SetNodeShape / MoveNodes /
// DeleteSelection / CreateEdge / DeleteEdges / SetDocumentStyle /
// ReplaceDocument(load-only) / RestoreSelection(结构化逆，仅供 undo)。
// node size 由共享 layoutText（packages/export）在 UI 侧计算后随命令提交，
// core 不做字体测量——size 是持久化权威，命令携带它。

import type {
  MindMapDocumentV1,
  MindNode,
  MindEdge,
  Point,
  Size,
  NodeShape,
  ThemeName,
  FontToken,
  TextRun,
  LineStyle,
} from "./schema.js";
import { LIMITS } from "./schema.js";
import { nextIdentity, type StateIdentity } from "./identity.js";

export interface StateNode {
  identity: StateIdentity;
  document: MindMapDocumentV1;
}

export function makeStateNode(document: MindMapDocumentV1): StateNode {
  return { identity: nextIdentity(), document };
}

export type Command =
  | {
      kind: "CreateNode";
      id: string;
      text: string;
      position: Point;
      size: Size;
      shape?: NodeShape;
      runs?: TextRun[];
      /** OFR-2026-09-15（[from-user] 负责人定稿）：空文档创建的第一个节点
       *  自动带强调角色（橙色"出发点"卡）；其余创建缺省不派生（ADR 0010
       *  v1.1.0 例外条款）。 */
      emphasis?: boolean;
    }
  | { kind: "EditNodeText"; id: string; text: string; size: Size; runs?: TextRun[] }
  | { kind: "SetNodeShape"; id: string; shape: NodeShape | null } // null = 清除覆盖，继承文档默认
  // [ADR 0010 v2] 眉题/强调/线型三条单命令（各自可撤销、触发 dirty、进入历史）。
  // SetNodeKicker 的 measured 为调用方经共享 FontResolver 测得的权威尺寸——
  // 眉题增删改变节点高度，内容/样式与 size 作为同一条历史原子提交（ADR 0010 §4）。
  | {
      kind: "SetNodeKicker";
      id: string;
      kicker: string; // 空串 = 清除（等价缺省）
      measured?: Size; // 眉题增删后的新尺寸；未提供则 size 不变（无高度影响的调用场景）
    }
  | { kind: "SetNodeEmphasis"; id: string; emphasis: boolean }
  | { kind: "SetEdgeLineStyle"; id: string; lineStyle: LineStyle }
  | { kind: "MoveNodes"; moves: Array<{ id: string; position: Point }> }
  | { kind: "DeleteSelection"; nodeIds: string[]; edgeIds: string[] }
  | { kind: "CreateEdge"; id: string; sourceNodeId: string; targetNodeId: string }
  | { kind: "DeleteEdges"; ids: string[] }
  | {
      kind: "SetDocumentStyle";
      theme?: ThemeName;
      font?: FontToken;
      shape?: NodeShape;
      framesVisible?: boolean;
    }
  | {
      /** [PRR-040] 字体切换的权威几何事务：目标字体 + 全部节点按目标字体
       * 重新度量的 size，作为单条可撤销、全有或全无的用户命令提交。
       * sizes 必须覆盖文档全部节点；旧尺寸只从当前 state 派生，不能由
       * 调用方注入。previousFont 必须等于当前文档字体（陈旧命令
       * fail-closed）。 */
      kind: "SetDocumentFontAndResizeNodes";
      font: FontToken;
      previousFont: FontToken;
      sizes: Array<{ id: string; size: Size }>;
    }
  | { kind: "ReplaceDocument"; document: MindMapDocumentV1 }
  | { kind: "RestoreSelection"; nodes: MindNode[]; edges: MindEdge[] }; // 结构化逆

export type CommandError =
  | { code: "NODE_NOT_FOUND"; id: string }
  | { code: "NODE_ALREADY_EXISTS"; id: string }
  | { code: "EDGE_NOT_FOUND"; id: string }
  | { code: "EDGE_ALREADY_EXISTS"; id: string }
  | { code: "SELF_LOOP" }
  | { code: "DUPLICATE_EDGE_DIRECTION"; source: string; target: string }
  | { code: "BAD_KICKER"; reason: string } // [ADR 0010 v2]
  | { code: "BAD_SIZE"; id: string } // [ADR 0010 v2] measured 尺寸非法
  | { code: "FONT_MISMATCH"; expected: FontToken; actual: FontToken } // [PRR-040]
  | { code: "INCOMPLETE_RESIZE_MAP"; reason: string }; // [PRR-040] 尺寸映射未覆盖全部节点

export type Effect =
  | { kind: "nodes-created"; ids: string[] }
  | { kind: "nodes-deleted"; ids: string[]; incidentEdgeIds: string[] }
  | { kind: "edges-created"; ids: string[] }
  | { kind: "edges-deleted"; ids: string[] }
  | { kind: "document-style-changed" };

export type ApplyResult =
  | { ok: true; stateNode: StateNode; inverse: Command | null; effects: Effect[] }
  | { ok: false; error: CommandError };

function cloneDocument(doc: MindMapDocumentV1): MindMapDocumentV1 {
  return {
    schemaVersion: doc.schemaVersion, // [ADR 0010] 保留来源版本（保存时由 encode 输出 2）
    document: {
      theme: doc.document.theme,
      font: doc.document.font,
      shape: doc.document.shape,
      framesVisible: doc.document.framesVisible,
      nodes: doc.document.nodes.map((n) => ({
        id: n.id,
        text: n.text,
        position: { ...n.position },
        size: { ...n.size },
        ...(n.shape !== undefined ? { shape: n.shape } : {}),
        ...(n.runs !== undefined ? { runs: n.runs.map((r) => ({ ...r })) } : {}),
        ...(n.kicker !== undefined ? { kicker: n.kicker } : {}),
        ...(n.emphasis !== undefined ? { emphasis: n.emphasis } : {}),
      })),
      edges: doc.document.edges.map((e) => ({ ...e })),
    },
  };
}

export function applyCommand(stateNode: StateNode, command: Command): ApplyResult {
  const doc = cloneDocument(stateNode.document);
  const d = doc.document;
  const effects: Effect[] = [];
  let inverse: Command | null = null;

  const findNode = (id: string): MindNode | undefined => d.nodes.find((n) => n.id === id);

  switch (command.kind) {
    case "CreateNode": {
      if (findNode(command.id))
        return { ok: false, error: { code: "NODE_ALREADY_EXISTS", id: command.id } };
      const node: MindNode = {
        id: command.id,
        text: command.text,
        position: { ...command.position },
        size: { ...command.size },
        ...(command.shape !== undefined ? { shape: command.shape } : {}),
        ...(command.runs !== undefined ? { runs: command.runs.map((r) => ({ ...r })) } : {}),
        ...(command.emphasis === true ? { emphasis: true } : {}),
      };
      d.nodes.push(node);
      inverse = { kind: "DeleteSelection", nodeIds: [command.id], edgeIds: [] };
      effects.push({ kind: "nodes-created", ids: [command.id] });
      break;
    }
    case "EditNodeText": {
      const node = findNode(command.id);
      if (!node) return { ok: false, error: { code: "NODE_NOT_FOUND", id: command.id } };
      inverse = {
        kind: "EditNodeText",
        id: command.id,
        text: node.text,
        size: { ...node.size },
        ...(node.runs !== undefined ? { runs: node.runs.map((r) => ({ ...r })) } : {}),
      };
      node.text = command.text;
      node.size = { ...command.size };
      if (command.runs !== undefined) node.runs = command.runs.map((r) => ({ ...r }));
      else delete node.runs;
      break;
    }
    case "SetNodeShape": {
      const node = findNode(command.id);
      if (!node) return { ok: false, error: { code: "NODE_NOT_FOUND", id: command.id } };
      inverse = { kind: "SetNodeShape", id: command.id, shape: node.shape ?? null };
      if (command.shape === null) delete node.shape;
      else node.shape = command.shape;
      break;
    }
    case "SetNodeKicker": {
      // [ADR 0010 v2] 眉题 + 权威 size 原子提交；命令层校验（fail-closed，非法命令不动文档）
      if (typeof command.kicker !== "string" || command.kicker.includes("\n"))
        return { ok: false, error: { code: "BAD_KICKER", reason: "invalid" } };
      if (command.kicker.length > LIMITS.maxKickerLength)
        return { ok: false, error: { code: "BAD_KICKER", reason: "too-long" } };
      if (command.measured !== undefined) {
        const m = command.measured;
        if (
          !Number.isFinite(m.width) ||
          !Number.isFinite(m.height) ||
          m.width < LIMITS.minSize ||
          m.height < LIMITS.minSize ||
          m.width > LIMITS.maxSize ||
          m.height > LIMITS.maxSize
        )
          return { ok: false, error: { code: "BAD_SIZE", id: command.id } };
      }
      const node = findNode(command.id);
      if (!node) return { ok: false, error: { code: "NODE_NOT_FOUND", id: command.id } };
      inverse = {
        kind: "SetNodeKicker",
        id: command.id,
        kicker: node.kicker ?? "",
        measured: { ...node.size },
      };
      if (command.kicker.length === 0) delete node.kicker;
      else node.kicker = command.kicker;
      if (command.measured !== undefined) node.size = { ...command.measured };
      break;
    }
    case "SetNodeEmphasis": {
      const node = findNode(command.id);
      if (!node) return { ok: false, error: { code: "NODE_NOT_FOUND", id: command.id } };
      inverse = { kind: "SetNodeEmphasis", id: command.id, emphasis: node.emphasis === true };
      if (command.emphasis) node.emphasis = true;
      else delete node.emphasis;
      break;
    }
    case "SetEdgeLineStyle": {
      const edge = d.edges.find((e) => e.id === command.id);
      if (!edge) return { ok: false, error: { code: "EDGE_NOT_FOUND", id: command.id } };
      inverse = { kind: "SetEdgeLineStyle", id: command.id, lineStyle: edge.lineStyle ?? "solid" };
      if (command.lineStyle === "solid") delete edge.lineStyle;
      else edge.lineStyle = command.lineStyle;
      break;
    }
    case "MoveNodes": {
      const inverses: Array<{ id: string; position: Point }> = [];
      for (const mv of command.moves) {
        const node = findNode(mv.id);
        if (!node) return { ok: false, error: { code: "NODE_NOT_FOUND", id: mv.id } };
        inverses.push({ id: mv.id, position: { ...node.position } });
      }
      // 全部存在才应用：批量移动是一个原子命令
      for (const mv of command.moves) {
        findNode(mv.id)!.position = { ...mv.position };
      }
      inverse = { kind: "MoveNodes", moves: inverses };
      break;
    }
    case "DeleteSelection": {
      const deletedNodes: MindNode[] = [];
      for (const id of command.nodeIds) {
        const node = findNode(id);
        if (!node) return { ok: false, error: { code: "NODE_NOT_FOUND", id } };
        deletedNodes.push(node);
      }
      for (const id of command.edgeIds) {
        if (!d.edges.some((e) => e.id === id))
          return { ok: false, error: { code: "EDGE_NOT_FOUND", id } };
      }
      // 删除节点 + incident 边 + 选中边（一个原子命令）
      const nodeSet = new Set(command.nodeIds);
      const edgeIdSet = new Set(command.edgeIds);
      const removedEdges = d.edges.filter(
        (e) => edgeIdSet.has(e.id) || nodeSet.has(e.sourceNodeId) || nodeSet.has(e.targetNodeId),
      );
      const removedEdgeIds = new Set(removedEdges.map((e) => e.id));
      d.nodes = d.nodes.filter((n) => !nodeSet.has(n.id));
      d.edges = d.edges.filter((e) => !removedEdgeIds.has(e.id));
      inverse = {
        kind: "RestoreSelection",
        nodes: deletedNodes.map((n) => ({
          ...n,
          ...(n.runs !== undefined ? { runs: n.runs.map((r) => ({ ...r })) } : {}),
        })),
        edges: removedEdges.map((e) => ({ ...e })),
      };
      effects.push({
        kind: "nodes-deleted",
        ids: command.nodeIds,
        incidentEdgeIds: [...removedEdgeIds],
      });
      break;
    }
    case "CreateEdge": {
      if (!findNode(command.sourceNodeId))
        return { ok: false, error: { code: "NODE_NOT_FOUND", id: command.sourceNodeId } };
      if (!findNode(command.targetNodeId))
        return { ok: false, error: { code: "NODE_NOT_FOUND", id: command.targetNodeId } };
      if (command.sourceNodeId === command.targetNodeId)
        return { ok: false, error: { code: "SELF_LOOP" } };
      if (d.edges.some((e) => e.id === command.id))
        return { ok: false, error: { code: "EDGE_ALREADY_EXISTS", id: command.id } };
      if (
        d.edges.some(
          (e) => e.sourceNodeId === command.sourceNodeId && e.targetNodeId === command.targetNodeId,
        )
      )
        return {
          ok: false,
          error: {
            code: "DUPLICATE_EDGE_DIRECTION",
            source: command.sourceNodeId,
            target: command.targetNodeId,
          },
        };
      d.edges.push({
        id: command.id,
        sourceNodeId: command.sourceNodeId,
        targetNodeId: command.targetNodeId,
      });
      inverse = { kind: "DeleteEdges", ids: [command.id] };
      effects.push({ kind: "edges-created", ids: [command.id] });
      break;
    }
    case "DeleteEdges": {
      const removed: MindEdge[] = [];
      for (const id of command.ids) {
        const e = d.edges.find((edge) => edge.id === id);
        if (!e) return { ok: false, error: { code: "EDGE_NOT_FOUND", id } };
        removed.push(e);
      }
      const idSet = new Set(command.ids);
      d.edges = d.edges.filter((e) => !idSet.has(e.id));
      inverse = { kind: "RestoreSelection", nodes: [], edges: removed.map((e) => ({ ...e })) };
      effects.push({ kind: "edges-deleted", ids: command.ids });
      break;
    }
    case "SetDocumentStyle": {
      const prev = { theme: d.theme, font: d.font, shape: d.shape, framesVisible: d.framesVisible };
      if (command.theme !== undefined) d.theme = command.theme;
      if (command.font !== undefined) d.font = command.font;
      if (command.shape !== undefined) d.shape = command.shape;
      if (command.framesVisible !== undefined) d.framesVisible = command.framesVisible;
      inverse = { kind: "SetDocumentStyle", ...prev };
      effects.push({ kind: "document-style-changed" });
      break;
    }
    case "SetDocumentFontAndResizeNodes": {
      // [PRR-040] 先全量校验再写入：字体必须真的在切换、previousFont 必须
      // 等于当前文档字体（陈旧命令 fail-closed）、尺寸映射必须与文档节点
      // 集合完全一致（双向、无重复）、全部尺寸 finite 且在限额内。
      // 任一校验失败返回错误，clone 丢弃 → 零写入。
      if (command.font === command.previousFont)
        return {
          ok: false,
          error: { code: "FONT_MISMATCH", expected: command.previousFont, actual: d.font },
        };
      if (command.previousFont !== d.font)
        return {
          ok: false,
          error: { code: "FONT_MISMATCH", expected: command.previousFont, actual: d.font },
        };
      const sizeIds = new Set(command.sizes.map((entry) => entry.id));
      const nodeIds = new Set(d.nodes.map((n) => n.id));
      if (sizeIds.size !== command.sizes.length)
        return { ok: false, error: { code: "INCOMPLETE_RESIZE_MAP", reason: "存在重复节点 id" } };
      if (sizeIds.size !== nodeIds.size || [...nodeIds].some((id) => !sizeIds.has(id)))
        return {
          ok: false,
          error: { code: "INCOMPLETE_RESIZE_MAP", reason: "尺寸映射未覆盖全部文档节点" },
        };
      for (const entry of command.sizes) {
        const s = entry.size;
        if (
          !Number.isFinite(s.width) ||
          !Number.isFinite(s.height) ||
          s.width < LIMITS.minSize ||
          s.height < LIMITS.minSize ||
          s.width > LIMITS.maxSize ||
          s.height > LIMITS.maxSize
        )
          return { ok: false, error: { code: "BAD_SIZE", id: entry.id } };
      }
      const previousSizes = d.nodes.map((node) => ({ id: node.id, size: { ...node.size } }));
      // 校验全部通过：原子应用（font + 全部 node size 一次写入；position、
      // edges、selection、viewport 均不动）。
      d.font = command.font;
      for (const entry of command.sizes) {
        findNode(entry.id)!.size = { ...entry.size };
      }
      inverse = {
        kind: "SetDocumentFontAndResizeNodes",
        font: command.previousFont,
        previousFont: command.font,
        sizes: previousSizes,
      };
      effects.push({ kind: "document-style-changed" });
      break;
    }
    case "ReplaceDocument": {
      inverse = { kind: "ReplaceDocument", document: stateNode.document };
      doc.document = cloneDocument(command.document).document;
      break;
    }
    case "RestoreSelection": {
      // 把恢复的对象按原数组顺序插回（用于 undo 删除）
      for (const e of command.edges) {
        if (d.edges.some((x) => x.id === e.id))
          return { ok: false, error: { code: "EDGE_ALREADY_EXISTS", id: e.id } };
      }
      for (const n of command.nodes) {
        if (findNode(n.id)) return { ok: false, error: { code: "NODE_ALREADY_EXISTS", id: n.id } };
      }
      d.nodes.push(
        ...command.nodes.map((n) => ({
          ...n,
          ...(n.runs !== undefined ? { runs: n.runs.map((r) => ({ ...r })) } : {}),
        })),
      );
      d.edges.push(...command.edges.map((e) => ({ ...e })));
      inverse = null; // RestoreSelection 自身不可再逆（其逆是原 Delete，由 history 链处理）
      break;
    }
  }

  return { ok: true, stateNode: makeStateNode(doc), inverse, effects };
}
