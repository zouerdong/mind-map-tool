// @vitest-environment jsdom
// 连线删除闭环（2026-09-22 内测反馈）：点击边 → 选中（橙色光晕 + 中点 × 按钮 +
// 工具条边工具锚定到线附近）→ 点 × 仅删该边（不动两端节点，可 undo）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession, makeStateNode, type MindMapDocumentV1 } from "@mindmap/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("./helpers/rf-stub.js").then((m) => m.rfStubModule()));

const { EditorCanvas } = await import("../src/canvas/editor-canvas.js");

afterEach(cleanup);

const fakeFonts: FontResolver = {
  regular: () => ({
    advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2),
    ascentRatio: 0.8,
  }),
  bold: () => ({
    advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2),
    ascentRatio: 0.8,
  }),
};

function doc(): MindMapDocumentV1 {
  return {
    schemaVersion: 2,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: [
        { id: "a", text: "起点", position: { x: 0, y: 0 }, size: { width: 100, height: 40 } },
        { id: "b", text: "目标", position: { x: 200, y: 0 }, size: { width: 100, height: 40 } },
      ],
      edges: [{ id: "e1", sourceNodeId: "a", targetNodeId: "b", lineStyle: "solid" }],
    },
  };
}

function renderCanvas() {
  const session = new DocumentSession(makeStateNode(doc()).document);
  render(
    <EditorCanvas
      session={session}
      fonts={fakeFonts}
      nextNodeId={() => `n-${Math.random().toString(36).slice(2, 6)}`}
      nextEdgeId={() => `e-${Math.random().toString(36).slice(2, 6)}`}
    />,
  );
  return { session };
}

describe("连线选中与删除（2026-09-22 内测反馈）", () => {
  it("点击边 → 选中光晕 + 中点删除按钮 + 工具条边工具出现", async () => {
    renderCanvas();
    expect(document.querySelector(".react-flow__edge-selected-halo")).toBeNull();
    fireEvent.click(await screen.findByTestId("rf-edge-e1")); // rf-stub click → select change 流
    await waitFor(() => {
      expect(document.querySelector(".react-flow__edge-selected-halo")).toBeTruthy();
    });
    expect(screen.getByLabelText("删除连线")).toBeTruthy(); // 中点 × 按钮
    expect(screen.getByTitle("删除选中（⌫）")).toBeTruthy(); // 工具条边工具
  });

  it("点中点 × → 仅删该边（两端节点保留）；undo 恢复", async () => {
    const { session } = renderCanvas();
    fireEvent.click(await screen.findByTestId("rf-edge-e1"));
    fireEvent.click(await screen.findByLabelText("删除连线"));
    await waitFor(() => {
      expect(session.current.document.document.edges).toHaveLength(0);
    });
    expect(session.current.document.document.nodes).toHaveLength(2);
    session.undo();
    await waitFor(() => {
      expect(session.current.document.document.edges).toHaveLength(1);
    });
  });

  it("Delete 键删选中边（键盘路径回归）", async () => {
    const { session } = renderCanvas();
    fireEvent.click(await screen.findByTestId("rf-edge-e1"));
    await waitFor(() => {
      expect(document.querySelector(".react-flow__edge-selected-halo")).toBeTruthy();
    });
    fireEvent.keyDown(document.querySelector('[aria-label="脑图画布"]')!, {
      key: "Backspace",
    });
    await waitFor(() => {
      expect(session.current.document.document.edges).toHaveLength(0);
    });
    expect(session.current.document.document.nodes).toHaveLength(2);
  });
});
