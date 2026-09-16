// @vitest-environment jsdom
// IME 与编辑提交测试（ADR 0002 exit criteria：中文 IME 无阻断；
// 组合期间 Enter 不提交、快捷键不派发）。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession, makeStateNode } from "@mindmap/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("./helpers/rf-stub.js").then((m) => m.rfStubModule()));

const { EditorCanvas } = await import("../src/canvas/editor-canvas.js");
const { NodeTextEditor } = await import("../src/canvas/node-text-editor.js");
const { makeDoc } = await import("./projection.test.js");

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

describe("NodeTextEditor（直接渲染）", () => {
  it("组合期间的 Enter 不提交（IME 确认优先）", async () => {
    let committed: string | null = null;
    render(
      <NodeTextEditor initialText="旧" onCommit={(t) => (committed = t)} onCancel={() => {}} />,
    );
    const editor = screen.getByLabelText("编辑节点文本") as HTMLTextAreaElement;

    fireEvent.change(editor, { target: { value: "旧中文" } });
    fireEvent.compositionStart(editor);
    // IME 组合中的 Enter（isComposing）
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(committed).toBeNull();

    fireEvent.compositionEnd(editor);
    // Enter 已定稿为换行（不提交）；⌘Enter 提交
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(committed).toBeNull();
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    await waitFor(() => expect(committed).toBe("旧中文"));
  });

  it("Escape 取消、不提交", () => {
    let committed: string | null = null;
    let cancelled = false;
    render(
      <NodeTextEditor
        initialText="旧"
        onCommit={(t) => (committed = t)}
        onCancel={() => (cancelled = true)}
      />,
    );
    const editor = screen.getByLabelText("编辑节点文本");
    fireEvent.change(editor, { target: { value: "改" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(committed).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("blur 提交一次（不重复）", () => {
    let count = 0;
    render(<NodeTextEditor initialText="" onCommit={() => count++} onCancel={() => {}} />);
    const editor = screen.getByLabelText("编辑节点文本");
    fireEvent.change(editor, { target: { value: "x" } });
    fireEvent.blur(editor);
    fireEvent.blur(editor);
    expect(count).toBe(1);
  });
});

describe("EditorCanvas 编辑流（中文提交 + 权威 size）", () => {
  it("双击节点 → 输入中文 → ⌘Enter 提交 EditNodeText（size 同命令）", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    render(<EditorCanvas session={session} fonts={fakeFonts} />);
    const nodeText = await screen.findByText("根节点");
    fireEvent.doubleClick(nodeText);
    const editor = (await screen.findByLabelText("编辑节点文本")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "中心主题" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(session.current.document.document.nodes[0]?.text).toBe("中心主题");
    });
    // 权威 size：假字体 CJK 一字 = 字号宽（16px）：4×16+32 padding = 96 < 120 → 卡宽下限
    expect(session.current.document.document.nodes[0]?.size.width).toBe(120);
  });

  it("DFR-020：带眉题节点正文编辑后保留眉题高度（ready 路径）", async () => {
    const doc = makeDoc();
    doc.document.nodes[0]!.kicker = "IDEA";
    const session = new DocumentSession(makeStateNode(doc).document);
    render(<EditorCanvas session={session} fonts={fakeFonts} />);
    const nodeText = await screen.findByText("根节点");
    fireEvent.doubleClick(nodeText);
    const editor = (await screen.findByLabelText("编辑节点文本")) as HTMLTextAreaElement;
    // 编辑态 textarea 顶内距含眉题占位（12 + 14.3 + 6 = 32.3），与提交后一致
    expect(editor.style.paddingTop).toBe("32.3px");
    fireEvent.change(editor, { target: { value: "改后正文" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(session.current.document.document.nodes[0]?.text).toBe("改后正文");
    });
    const node = session.current.document.document.nodes[0]!;
    expect(node.kicker).toBe("IDEA"); // 眉题保留
    // 高度含眉题行：12 + 14.3 + 6 + 22.4 + 12 = 66.7（不得量成无眉题的 46.4）
    expect(node.size.height).toBeCloseTo(66.7, 3);
  });

  it("Escape 取消后文本不变", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    render(<EditorCanvas session={session} fonts={fakeFonts} />);
    const nodeText = await screen.findByText("根节点");
    fireEvent.doubleClick(nodeText);
    const editor = await screen.findByLabelText("编辑节点文本");
    fireEvent.change(editor, { target: { value: "放弃" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("编辑节点文本")).toBeNull());
    expect(session.current.document.document.nodes[0]?.text).toBe("根节点");
  });
});
