// Projection contract tests（ADR 0002 exit criteria）：
// core 是唯一事实源 —— 投影保真、命令后重投影一致、
// 画布内部状态（selection/viewport/measurement）绝不进入投影产物。

import { describe, expect, it } from "vitest";
import {
  applyCommand,
  deriveNodeDepths,
  makeStateNode,
  type Command,
  type MindMapDocumentV1,
} from "@mindmap/core";
import {
  deriveHandleSides,
  documentDefaults,
  projectDocument,
  projectEdge,
  projectNode,
  projectionIsStable,
} from "../src/projection/projection.js";

export function makeDoc(): MindMapDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: [
        {
          id: "n1",
          text: "根节点",
          position: { x: 0, y: 0 },
          size: { width: 120, height: 37 },
        },
        {
          id: "n2",
          text: "子节点\n第二行",
          position: { x: 200, y: 80 },
          size: { width: 140, height: 58 },
          shape: "ellipse",
        },
      ],
      edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
    },
  };
}

describe("projectDocument", () => {
  it("全量投影 nodes/edges，字段与 core 一一对应", () => {
    const doc = makeDoc();
    const view = projectDocument(doc);
    expect(view.nodes).toHaveLength(2);
    expect(view.edges).toHaveLength(1);
    const [a, b] = view.nodes;
    expect(a?.id).toBe("n1");
    expect(a?.position).toEqual({ x: 0, y: 0 });
    expect(a?.width).toBe(120);
    expect(a?.height).toBe(37);
    expect(a?.data.text).toBe("根节点");
    expect(a?.type).toBe("mind");
    expect(b?.data.shape).toBe("ellipse"); // 节点覆盖优先
    expect(b?.data.text).toBe("子节点\n第二行");
    expect(view.edges[0]).toMatchObject({ id: "e1", source: "n1", target: "n2" });
  });

  it("文档默认值下发给每个节点（theme/font/shape/framesVisible）", () => {
    const defaults = documentDefaults(makeDoc());
    expect(defaults).toEqual({
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
    });
    const view = projectDocument(makeDoc());
    expect(
      view.nodes.every((n) => n.data.theme === "light" && n.data.font === "noto-sans-sc"),
    ).toBe(true);
  });

  it("投影产物不含画布内部状态（selection/viewport/measured）", () => {
    const serialized = JSON.stringify(projectDocument(makeDoc()));
    for (const banned of [
      '"selected"',
      '"viewport"',
      '"measured"',
      '"dragging"',
      '"handleBounds"',
    ]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("projectionIsStable 校验通过；被篡改后失败", () => {
    const doc = makeDoc();
    const view = projectDocument(doc);
    expect(projectionIsStable(doc, view)).toBe(true);
    const tampered = {
      ...view,
      nodes: [
        { ...view.nodes[0]!, data: { ...view.nodes[0]!.data, text: "篡改" } },
        ...view.nodes.slice(1),
      ],
    };
    expect(projectionIsStable(doc, tampered)).toBe(false);
  });
});

describe("命令后重投影一致性（无双状态漂移）", () => {
  it("CreateNode/EditNodeText/MoveNodes/DeleteSelection 后投影与 core 同步", () => {
    let state = makeStateNode(makeDoc());
    const apply = (cmd: Command) => {
      const r = applyCommand(state, cmd);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      state = r.stateNode;
      return state;
    };

    apply({
      kind: "CreateNode",
      id: "n3",
      text: "新",
      position: { x: 300, y: 0 },
      size: { width: 60, height: 37 },
    });
    expect(projectionIsStable(state.document, projectDocument(state.document))).toBe(true);
    expect(projectDocument(state.document).nodes).toHaveLength(3);

    apply({ kind: "EditNodeText", id: "n1", text: "改名", size: { width: 80, height: 37 } });
    expect(projectDocument(state.document).nodes[0]?.data.text).toBe("改名");

    apply({ kind: "MoveNodes", moves: [{ id: "n2", position: { x: 999, y: 1 } }] });
    expect(projectDocument(state.document).nodes[1]?.position).toEqual({ x: 999, y: 1 });
    expect(projectionIsStable(state.document, projectDocument(state.document))).toBe(true);

    apply({ kind: "DeleteSelection", nodeIds: ["n3"], edgeIds: [] });
    expect(projectDocument(state.document).nodes).toHaveLength(2);
    expect(projectDocument(state.document).edges).toHaveLength(1);
    expect(projectionIsStable(state.document, projectDocument(state.document))).toBe(true);
  });

  it("单节点/单边投影与整体投影等价", () => {
    const doc = makeDoc();
    const defaults = documentDefaults(doc);
    const depths = deriveNodeDepths(doc); // ADR 0020：depth 由整体投影派生
    const whole = projectDocument(doc);
    expect(projectNode(doc.document.nodes[1]!, defaults, depths.get("n2"))).toEqual(whole.nodes[1]);
    // ADR 0019：锚点侧由整体投影按几何派生（此处用同一规则重建期望值）
    const e0 = doc.document.edges[0]!;
    const byId = new Map(doc.document.nodes.map((n) => [n.id, n]));
    const s0 = byId.get(e0.sourceNodeId)!;
    const t0 = byId.get(e0.targetNodeId)!;
    const anchors = deriveHandleSides(
      s0.position.x + s0.size.width / 2,
      t0.position.x + t0.size.width / 2,
    );
    expect(projectEdge(e0, defaults.theme, anchors)).toEqual(whole.edges[0]);
  });
});
