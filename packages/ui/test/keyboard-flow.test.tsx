// @vitest-environment jsdom
// MM-089 键盘流集成测试（AC-17）：全键盘建图闭环——
// quick-create 建节点（⌥Space 同键分流，信号驱动）、方向键导航、
// ⌘L 连线流（方向换目标/Enter 确认/Esc 取消）、Enter 进编辑、
// ⌘A 全选、Delete 删除、编辑态/IME 隔离贯穿。
// 键位定稿 2026-08-29（键位专项讨论）；本测试锁机制不锁键位终值（键位集中在 onKeyDown）。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DocumentSession, makeStateNode } from "@mindmap/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("./helpers/rf-stub.js").then((m) => m.rfStubModule()));

const { EditorCanvas } = await import("../src/canvas/editor-canvas.js");

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

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

function setup() {
  const session = new DocumentSession(
    makeStateNode({
      schemaVersion: 1,
      document: {
        theme: "light",
        font: "noto-sans-sc",
        shape: "card",
        framesVisible: true,
        nodes: [
          { id: "a", text: "甲", position: { x: 0, y: 0 }, size: { width: 100, height: 40 } },
          { id: "b", text: "乙", position: { x: 300, y: 0 }, size: { width: 100, height: 40 } },
        ],
        edges: [],
      },
    }).document,
  );
  let nextId = 0;
  const utils = render(
    <EditorCanvas session={session} fonts={fakeFonts} nextNodeId={() => `kb-${nextId++}`} />,
  );
  const host = () => document.querySelector('[role="application"]')!;
  const keyDown = (k: string, init?: KeyboardEventInit) =>
    fireEvent.keyDown(host(), { key: k, ...init });
  const rerenderWith = (quickCreateSignal: number) =>
    utils.rerender(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        nextNodeId={() => `kb-${nextId++}`}
        quickCreateSignal={quickCreateSignal}
      />,
    );
  return { session, ...utils, host, keyDown, rerenderWith };
}

describe("全键盘建图（AC-17）", () => {
  it("方向键导航：无焦点→首个；→ 到右侧节点；焦点环出现", async () => {
    const { host, keyDown } = setup();
    await screen.findByTestId("rf-node-a");
    keyDown("ArrowRight"); // 无焦点 → 首个 a
    keyDown("ArrowRight"); // a → b（右侧最近）
    await waitFor(() => {
      expect(document.querySelector('[aria-label="节点：乙"]')?.getAttribute("style")).toContain(
        "#D06B47",
      );
    });
    void host;
  });

  it("Enter：焦点节点进编辑 → 输入 → Enter 换行不提交，⌘Enter 提交", async () => {
    const { session, keyDown } = setup();
    await screen.findByTestId("rf-node-a");
    keyDown("ArrowDown"); // 焦点 a
    keyDown("Enter");
    const editor = await screen.findByLabelText("编辑节点文本");
    fireEvent.change(editor, { target: { value: "新标题" } });
    fireEvent.keyDown(editor, { key: "Enter" }); // 换行（textarea 默认，不提交）
    expect(session.current.document.document.nodes[0]?.text).toBe("甲");
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    await waitFor(() => expect(session.current.document.document.nodes[0]?.text).toBe("新标题"));
  });

  it("quick-create：信号自增 → 视口中心建节点并自动进编辑（原设计，用户决策 2026-08-29）", async () => {
    const { session, rerenderWith } = setup();
    await screen.findByTestId("rf-node-a");
    expect(session.current.document.document.nodes).toHaveLength(2);
    rerenderWith(1);
    const editor = await screen.findByLabelText("编辑节点文本");
    expect(session.current.document.document.nodes).toHaveLength(3);
    fireEvent.change(editor, { target: { value: "灵感" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(session.current.document.document.nodes.some((n) => n.text === "灵感")).toBe(true),
    );
  });

  it("quick-create：编辑态下信号 = 焦点修复（重新聚焦，不盲建）", async () => {
    const { session, rerenderWith, keyDown } = setup();
    await screen.findByTestId("rf-node-a");
    keyDown("ArrowDown");
    keyDown("Enter"); // 焦点 a 进编辑
    const editor = (await screen.findByLabelText("编辑节点文本")) as HTMLTextAreaElement;
    const focusSpy = vi.spyOn(editor, "focus");
    rerenderWith(1); // 编辑中：第二按=焦点修复（调用 focus）
    expect(focusSpy).toHaveBeenCalled();
    expect(session.current.document.document.nodes).toHaveLength(2); // 未盲建
  });

  it("⌘L 连线流：方向换候选 → Enter 确认 CreateEdge；Esc 取消不产生边", async () => {
    const { session, keyDown } = setup();
    await screen.findByTestId("rf-node-a");
    // 焦点 a（首个），发起连线，向右 → 候选 b
    keyDown("ArrowDown");
    keyDown("l", { metaKey: true });
    keyDown("ArrowRight");
    // 候选高亮（Claude 橙）
    await waitFor(() =>
      expect(document.querySelector('[aria-label="节点：乙"]')?.getAttribute("style")).toContain(
        "#D06B47",
      ),
    );
    keyDown("Enter");
    await waitFor(() => {
      expect(session.current.document.document.edges).toHaveLength(1);
      expect(session.current.document.document.edges[0]).toMatchObject({
        sourceNodeId: "a",
        targetNodeId: "b",
      });
    });

    // Esc 取消路径：再发起后取消，无新边
    const before = session.current.document.document.edges.length;
    keyDown("l", { metaKey: true });
    keyDown("ArrowLeft"); // b 无左侧候选（a 是 source 不可候选？nearest 允许任何节点）——取消即可
    keyDown("Escape");
    expect(session.current.document.document.edges.length).toBe(before);
  });

  it("⌘A 全选 → Delete 原子删除全部", async () => {
    const { session, keyDown } = setup();
    await screen.findByTestId("rf-node-a");
    keyDown("a", { metaKey: true });
    keyDown("Delete");
    await waitFor(() => {
      expect(session.current.document.document.nodes).toHaveLength(0);
      expect(session.current.document.document.edges).toHaveLength(0);
    });
  });

  it("编辑态隔离：⌘L/⌘A 在编辑时不派发", async () => {
    const { session, keyDown } = setup();
    await screen.findByTestId("rf-node-a");
    keyDown("ArrowDown");
    keyDown("Enter");
    const editor = await screen.findByLabelText("编辑节点文本");
    fireEvent.keyDown(editor, { key: "a", metaKey: true }); // 不应全选删除
    fireEvent.keyDown(editor, { key: "l", metaKey: true });
    expect(session.current.document.document.nodes).toHaveLength(2); // 未被删
    expect(screen.queryByTestId(/linking/)).toBeNull();
  });

  it("IME 组合期方向键不移动焦点", async () => {
    const { keyDown } = setup();
    await screen.findByTestId("rf-node-a");
    keyDown("ArrowDown"); // 焦点 a
    keyDown("ArrowRight", { isComposing: true }); // 组合期：忽略
    // 焦点仍在 a：再按 Right 应到 b；若组合期已移动则这次会失败（b 无右侧）
    keyDown("ArrowRight");
    await waitFor(() =>
      expect(document.querySelector('[aria-label="节点：乙"]')?.getAttribute("style")).toContain(
        "#D06B47",
      ),
    );
  });
});
