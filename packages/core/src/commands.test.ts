import { describe, expect, it } from "vitest";
import {
  applyCommand,
  makeStateNode,
  type ApplyResult,
  type Command,
  type StateNode,
} from "./commands.js";
import { emptyDocument } from "./schema.js";

function unwrap(r: ApplyResult): { stateNode: StateNode; inverse: Command | null } {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return { stateNode: r.stateNode, inverse: r.inverse };
}

function stateWithTwoNodes(): ReturnType<typeof makeStateNode> {
  const doc = emptyDocument();
  doc.document.nodes.push({
    id: "a",
    text: "A",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
  });
  doc.document.nodes.push({
    id: "b",
    text: "B",
    position: { x: 200, y: 0 },
    size: { width: 100, height: 40 },
  });
  return makeStateNode(doc);
}

function roundTrip(state: ReturnType<typeof makeStateNode>, command: Command) {
  const r1 = applyCommand(state, command);
  expect(r1.ok).toBe(true);
  if (!r1.ok) throw new Error("unreachable");
  if (r1.inverse === null) throw new Error("no inverse");
  const r2 = applyCommand(r1.stateNode, r1.inverse);
  expect(r2.ok).toBe(true);
  if (!r2.ok) throw new Error("unreachable");
  return { after: r1, back: r2 };
}

describe("命令与逆命令", () => {
  it("create/edit/move/delete node + inverse round-trip", () => {
    const s0 = makeStateNode(emptyDocument());

    const create: Command = {
      kind: "CreateNode",
      id: "n1",
      text: "文本",
      position: { x: 10, y: 20 },
      size: { width: 80, height: 36 },
    };
    const { back: b1 } = roundTrip(s0, create);
    expect(b1.stateNode.document.document.nodes.length).toBe(0);

    const s1 = unwrap(applyCommand(s0, create)).stateNode;
    const edit: Command = {
      kind: "EditNodeText",
      id: "n1",
      text: "新文本",
      size: { width: 120, height: 36 },
    };
    const { back: b2 } = roundTrip(s1, edit);
    expect(b2.stateNode.document.document.nodes[0]!.text).toBe("文本");
    expect(b2.stateNode.document.document.nodes[0]!.size.width).toBe(80);

    const move: Command = { kind: "MoveNodes", moves: [{ id: "n1", position: { x: 99, y: 99 } }] };
    const { back: b3 } = roundTrip(s1, move);
    expect(b3.stateNode.document.document.nodes[0]!.position.x).toBe(10);

    const del: Command = { kind: "DeleteSelection", nodeIds: ["n1"], edgeIds: [] };
    const r = applyCommand(s1, del);
    expect(r.ok && r.stateNode.document.document.nodes.length).toBe(0);
  });

  it("批量移动是一个原子命令（部分失败时整体不变）", () => {
    const s = stateWithTwoNodes();
    const bad: Command = {
      kind: "MoveNodes",
      moves: [
        { id: "a", position: { x: 50, y: 50 } },
        { id: "ghost", position: { x: 1, y: 1 } },
      ],
    };
    const r = applyCommand(s, bad);
    expect(r.ok).toBe(false);
    // 原状态不受影响
    expect(s.document.document.nodes[0]!.position.x).toBe(0);
  });

  it("删除节点与 incident edges 是一个原子命令", () => {
    const s = stateWithTwoNodes();
    const withEdge = unwrap(
      applyCommand(s, {
        kind: "CreateEdge",
        id: "e1",
        sourceNodeId: "a",
        targetNodeId: "b",
      }),
    ).stateNode;
    const r = applyCommand(withEdge, { kind: "DeleteSelection", nodeIds: ["a"], edgeIds: [] });
    expect(r.ok && r.stateNode.document.document.nodes.map((n) => n.id)).toEqual(["b"]);
    expect(r.ok && r.stateNode.document.document.edges.length).toBe(0); // incident edge 一并删除
    // undo 恢复节点 + 边
    if (r.ok && r.inverse) {
      const back = applyCommand(r.stateNode, r.inverse);
      expect(back.ok && back.stateNode.document.document.nodes.length).toBe(2);
      expect(back.ok && back.stateNode.document.document.edges.length).toBe(1);
    }
  });

  it("create/delete edge：拒绝自环与同方向重复；反方向允许", () => {
    const s = stateWithTwoNodes();
    expect(
      applyCommand(s, { kind: "CreateEdge", id: "e1", sourceNodeId: "a", targetNodeId: "a" }).ok,
    ).toBe(false);
    const e1 = unwrap(
      applyCommand(s, {
        kind: "CreateEdge",
        id: "e1",
        sourceNodeId: "a",
        targetNodeId: "b",
      }),
    );
    const dup = applyCommand(e1.stateNode, {
      kind: "CreateEdge",
      id: "e2",
      sourceNodeId: "a",
      targetNodeId: "b",
    });
    expect(dup.ok).toBe(false);
    const reverse = applyCommand(e1.stateNode, {
      kind: "CreateEdge",
      id: "e3",
      sourceNodeId: "b",
      targetNodeId: "a",
    });
    expect(reverse.ok).toBe(true);
    const { back } = roundTrip(e1.stateNode, { kind: "DeleteEdges", ids: ["e1"] });
    // undo（RestoreSelection）把 e1 恢复回来
    expect(back.stateNode.document.document.edges.some((e) => e.id === "e1")).toBe(true);
  });

  it("SetDocumentStyle（theme/font/shape）与节点形状覆盖", () => {
    const s = stateWithTwoNodes();
    const themed = applyCommand(s, {
      kind: "SetDocumentStyle",
      theme: "dark",
      font: "lxgw-wenkai",
    });
    expect(themed.ok && themed.stateNode.document.document.theme).toBe("dark");
    expect(themed.ok && themed.stateNode.document.document.font).toBe("lxgw-wenkai");

    // [from-user] 框体一键显隐：SetDocumentStyle.framesVisible，与形状正交
    const hidden = unwrap(applyCommand(s, { kind: "SetDocumentStyle", framesVisible: false }));
    expect(hidden.stateNode.document.document.framesVisible).toBe(false);
    expect(hidden.stateNode.document.document.shape).toBe("card"); // 形状保留，仅框体隐藏
    const shown = unwrap(
      applyCommand(hidden.stateNode, { kind: "SetDocumentStyle", framesVisible: true }),
    );
    expect(shown.stateNode.document.document.framesVisible).toBe(true);

    const shaped = unwrap(applyCommand(s, { kind: "SetNodeShape", id: "a", shape: "ellipse" }));
    expect(shaped.stateNode.document.document.nodes[0]!.shape).toBe("ellipse");
    // null 清除覆盖
    const cleared = unwrap(
      applyCommand(shaped.stateNode, { kind: "SetNodeShape", id: "a", shape: null }),
    );
    expect(cleared.stateNode.document.document.nodes[0]!.shape).toBeUndefined();
  });

  it("ReplaceDocument 整体替换且可逆", () => {
    const s = stateWithTwoNodes();
    const fresh = emptyDocument();
    fresh.document.theme = "dark";
    const r = applyCommand(s, { kind: "ReplaceDocument", document: fresh });
    expect(r.ok && r.stateNode.document.document.nodes.length).toBe(0);
    expect(r.ok && r.stateNode.document.document.theme).toBe("dark");
    if (r.ok && r.inverse) {
      const back = applyCommand(r.stateNode, r.inverse);
      expect(back.ok && back.stateNode.document.document.nodes.length).toBe(2);
    }
  });
});
