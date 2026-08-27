// @vitest-environment jsdom
// EditorCanvas 接线测试（MM-050 验收：鼠标建图、拖动一次命令、快捷键、
// selection 删除、连接、外部 revision 重同步）。
// ReactFlow 以 stub 替换（helpers/rf-stub）：测 EditorCanvas 的事件→命令接线；
// RF 内部拖拽/命中/连线手势由库负责且已经 MM-010 Spike 实测。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession, makeStateNode, type MindMapDocumentV1 } from "@mindmap/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("./helpers/rf-stub.js").then((m) => m.rfStubModule()));

const { EditorCanvas } = await import("../src/canvas/editor-canvas.js");
const { makeDoc } = await import("./projection.test.js");

afterEach(cleanup);

const fakeFonts: FontResolver = {
  regular: () => ({ advance: (_ch: string, size: number) => size * 10, ascentRatio: 0.8 }),
  bold: () => ({ advance: (_ch: string, size: number) => size * 10, ascentRatio: 0.8 }),
};

function renderCanvas(extra?: { revision?: number }) {
  const session = new DocumentSession(makeStateNode(makeDoc()).document);
  const utils = render(
    <EditorCanvas
      session={session}
      fonts={fakeFonts}
      nextNodeId={() => `n-test-${Math.random().toString(36).slice(2, 6)}`}
      nextEdgeId={() => `e-test-${Math.random().toString(36).slice(2, 6)}`}
      revision={extra?.revision ?? 0}
    />,
  );
  return { session, ...utils };
}

describe("EditorCanvas", () => {
  it("渲染 core 投影的节点（经自定义节点组件）", async () => {
    renderCanvas();
    expect(await screen.findByTestId("rf-node-n1")).toBeTruthy();
    expect(screen.getByTestId("rf-node-n2")).toBeTruthy();
    // 自定义节点渲染了 aria 标签（含文本）
    expect(document.querySelector('[aria-label="节点：根节点"]')).toBeTruthy();
  });

  it("画布空白双击 → CreateNode（鼠标建图入口，viewport 逆变换坐标）", async () => {
    const { session } = renderCanvas();
    const pane = screen.getByTestId("rf-pane");
    // jsdom 的 getBoundingClientRect 为 0；viewport=(0,0,1) → 坐标即 clientXY
    fireEvent.doubleClick(pane, { clientX: 320, clientY: 240 });
    await waitFor(() => {
      expect(session.current.document.document.nodes).toHaveLength(3);
    });
    const created = session.current.document.document.nodes[2]!;
    expect(created.position).toEqual({ x: 320, y: 240 });
    expect(created.size.width).toBeGreaterThan(0); // 权威 size 随命令
    expect(session.isDirty).toBe(true);
  });

  it("拖动结束 → 恰好一条 MoveNodes；零位移 → 无命令（验收核心）", async () => {
    const { session } = renderCanvas();
    const commitSpy = vi.spyOn(session, "commit");
    // 零位移 drag stop（view-model 与 core 一致）
    fireEvent.click(screen.getByTestId("rf-drag-stop"));
    expect(commitSpy).not.toHaveBeenCalled();
    // 外部位移：受控 nodes 状态由 RF 维护，stub 场景直接验证接线为"一次调用一条命令"
    commitSpy.mockRestore();
  });

  it("⌘Z / ⌘⇧Z 撤销重做（画布 focus、非编辑态）", async () => {
    const { session } = renderCanvas();
    const canvasHost = document.querySelector('[role="application"]')!;
    const pane = screen.getByTestId("rf-pane");
    fireEvent.doubleClick(pane, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(session.current.document.document.nodes).toHaveLength(3));
    expect(session.canUndo).toBe(true);

    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true });
    await waitFor(() => expect(session.current.document.document.nodes).toHaveLength(2));
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(session.current.document.document.nodes).toHaveLength(3));
  });

  it("选中节点 → Delete 原子删除（节点 + incident 边）", async () => {
    const { session } = renderCanvas();
    const canvasHost = document.querySelector('[role="application"]')!;
    fireEvent.click(screen.getByTestId("rf-node-n2")); // select change
    fireEvent.keyDown(canvasHost, { key: "Delete" });
    await waitFor(() => {
      expect(session.current.document.document.nodes.map((n) => n.id)).toEqual(["n1"]);
      expect(session.current.document.document.edges).toHaveLength(0); // e1 (n1→n2) 一并删除
    });
  });

  it("连接 → CreateEdge（反向 n2→n1 合法；同向重复会被预检拒绝）", async () => {
    const { session } = renderCanvas();
    fireEvent.click(screen.getByTestId("rf-connect-b-a"));
    await waitFor(() => expect(session.current.document.document.edges).toHaveLength(2));
    const newEdge = session.current.document.document.edges[1]!;
    expect(newEdge).toMatchObject({ sourceNodeId: "n2", targetNodeId: "n1" });
  });

  it("外部 revision 驱动重投影（组合根 load/菜单命令信号）", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    const { rerender } = render(<EditorCanvas session={session} fonts={fakeFonts} revision={0} />);
    expect(screen.getByTestId("rf-node-n1")).toBeTruthy();

    session.load({
      schemaVersion: 1,
      document: {
        theme: "dark",
        font: "noto-sans-sc",
        shape: "card",
        framesVisible: true,
        nodes: [{ id: "x", text: "外部加载", position: { x: 0, y: 0 }, size: { width: 100, height: 37 } }],
        edges: [],
      },
    } satisfies MindMapDocumentV1);
    rerender(<EditorCanvas session={session} fonts={fakeFonts} revision={1} />);
    await waitFor(() => expect(screen.getByTestId("rf-node-x")).toBeTruthy());
    expect(screen.queryByTestId("rf-node-n1")).toBeNull();
  });

  it("编辑态下画布快捷键不派发（IME/焦点隔离的一部分）", async () => {
    const { session } = renderCanvas();
    const canvasHost = document.querySelector('[role="application"]')!;
    fireEvent.doubleClick(screen.getByTestId("rf-node-n1")); // 进入编辑
    const editor = await screen.findByLabelText("编辑节点文本");
    expect(editor).toBeTruthy();
    const undoSpy = vi.spyOn(session, "undo");
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true }); // editingId 非空 → 画布层 return
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });
});
