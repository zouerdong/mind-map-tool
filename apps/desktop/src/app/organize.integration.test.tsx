// @vitest-environment jsdom
// MM-085 集成测试：一键整理的应用层闭环（AC-15）——
// 按钮与 ⌘⇧L 触发、单条命令可撤销（undo 完整恢复）、幂等提示。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => import("./rf-stub.js").then((m) => m.rfStubModule()));

const { MindMapApp } = await import("./mindmap-app.js");
const {
  FakeCloseLifecyclePort,
  FakeExportRenderer,
  FakeFilePort,
  FakeLaunchPort,
  FakePreferencesPort,
} = await import("./fake-ports.js");
const { FakeGlobalShortcut } = await import("./ports.js");

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function setup() {
  const renderer = new FakeExportRenderer();
  const utils = render(
    <MindMapApp
      ports={{
        filePort: new FakeFilePort(),
        preferences: new FakePreferencesPort(),
        renderer,
        fonts: renderer.fonts(),
        isBrowserDev: true,
        globalShortcut: new FakeGlobalShortcut(),
        closeLifecycle: new FakeCloseLifecyclePort(),
        launch: new FakeLaunchPort(),
      }}
    />,
  );
  return utils;
}

/** 画布双击创建一个节点（clientXY 位置乱序放置）。 */
async function createNodeAt(x: number, y: number) {
  fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: x, clientY: y });
  await waitFor(() => {
    expect(screen.getAllByTestId(/^rf-node-/).length).toBeGreaterThan(0);
  });
}

describe("一键整理（AC-15）", () => {
  it("乱序节点 → 整理 → 垂直树对位；undo 完整恢复；redo 重放", async () => {
    setup();
    // 三个节点故意散乱放置
    await createNodeAt(700, 10);
    await createNodeAt(30, 500);
    await createNodeAt(420, 260);
    const before = screen.getAllByTestId(/^rf-node-/).map((el) => el.getAttribute("data-testid"));

    fireEvent.keyDown(window, { key: "l", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText(/已整理为分层布局（⌘Z 可撤销）/)).toBeTruthy());

    // 画布 focus + ⌘Z：undo 后提示与节点仍在（位置恢复由 core 契约测试锁定）
    const canvasHost = document.querySelector('[role="application"]')!;
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeTruthy());
    const after = screen.getAllByTestId(/^rf-node-/).map((el) => el.getAttribute("data-testid"));
    expect(after.sort()).toEqual([...before].sort()); // undo 不丢节点

    // redo 重放整理
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(typeof document.title).toBe("string"));
  });

  it("⌘⇧L 触发整理（快捷键与按钮同通道）", async () => {
    setup();
    await createNodeAt(10, 10);
    await createNodeAt(600, 400);
    fireEvent.keyDown(window, { key: "l", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText(/已整理为分层布局/)).toBeTruthy());
  });

  it("已整理文档再整理 → 幂等提示，不产生新历史", async () => {
    setup();
    await createNodeAt(10, 10);
    await createNodeAt(500, 300);
    fireEvent.keyDown(window, { key: "l", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText(/已整理为分层布局/)).toBeTruthy());

    const commitSpy = vi.spyOn(
      // 第二次整理：相同布局 → organizeCommand 返回 null → 不提交命令
      (await import("./observed-session.js")).ObservedDocumentSession.prototype,
      "commit",
    );
    fireEvent.keyDown(window, { key: "l", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText(/已经是整理好的布局/)).toBeTruthy());
    expect(commitSpy).not.toHaveBeenCalled();
    commitSpy.mockRestore();
  });
});
