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
} from "./schema.js";
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
    }
  | { kind: "EditNodeText"; id: string; text: string; size: Size; runs?: TextRun[] }
  | { kind: "SetNodeShape"; id: string; shape: NodeShape | null } // null = 清除覆盖，继承文档默认
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
  | { kind: "ReplaceDocument"; document: MindMapDocumentV1 }
  | { kind: "RestoreSelection"; nodes: MindNode[]; edges: MindEdge[] }; // 结构化逆

export type CommandError =
  | { code: "NODE_NOT_FOUND"; id: string }
  | { code: "NODE_ALREADY_EXISTS"; id: string }
  | { code: "EDGE_NOT_FOUND"; id: string }
  | { code: "EDGE_ALREADY_EXISTS"; id: string }
  | { code: "SELF_LOOP" }
  | { code: "DUPLICATE_EDGE_DIRECTION"; source: string; target: string };

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
    schemaVersion: 1,
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
