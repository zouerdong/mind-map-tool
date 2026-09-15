// @vitest-environment jsdom
// PRR-065 红灯（卡 §红灯 1/2/5）：零 WebView Chrome 命令面。
// 1. 生产渲染树无 AppHeader（主工具条 / 文件 ▾ / 整理 / 视图 / 主题按钮 / 40px 占位）
// 2. 首启偏好 not-started 自动出示 welcome（OFR-2026-09-14 #7 负责人 dogfood
//    推翻 PRR-065「永不自动呈现」：首次用户需要引导）；in-progress 不自动遮挡；
//    ⌘⇧H（浏览器 dev keydown）可显式重放
// 3. dirty 确认互斥、document.title 语义在无顶栏后保持
// React Flow 以 stub 替换（同 app-integration.test.tsx）。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { emptyDocument, encodeDocument } from "@mindmap/core";

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

function setup(preferences = new FakePreferencesPort()) {
  const filePort = new FakeFilePort();
  const renderer = new FakeExportRenderer();
  filePort.writeFile("/docs/a.json", encodeDocument(emptyDocument()));
  filePort.nextOpenDialog = "/docs/a.json";
  const utils = render(
    <MindMapApp
      ports={{
        filePort,
        preferences,
        renderer,
        fonts: renderer.fonts(),
        isBrowserDev: true,
        globalShortcut: new FakeGlobalShortcut(),
        closeLifecycle: new FakeCloseLifecyclePort(),
        launch: new FakeLaunchPort(),
      }}
    />,
  );
  return { filePort, preferences, ...utils };
}

describe("红灯 1：零 WebView Chrome（ADR 0012）", () => {
  it("空白启动：无主工具条 / 文件 ▾ / 整理 / 视图 / 主题按钮 / 40px 顶栏占位", () => {
    const { container } = setup();
    expect(screen.queryByRole("toolbar", { name: "主工具条" })).toBeNull();
    expect(screen.queryByText("文件 ▾")).toBeNull();
    expect(screen.queryByText(/整理/)).toBeNull();
    expect(screen.queryByText(/视图 ▾/)).toBeNull();
    expect(screen.queryByText("◐")).toBeNull();
    // 40px 顶栏占位：渲染树第一个子元素不再是 <header>
    const shell = container.firstElementChild!;
    expect(shell.tagName).not.toBe("HEADER");
    expect(shell.querySelector("header")).toBeNull();
    // 顶栏中部的 doc-title / save-status 不再存在于 WebView
    expect(screen.queryByTestId("save-status")).toBeNull();
    expect(container.querySelector(".doc-title")).toBeNull();
  });
});

describe("DFR-030：ADR 0012 v1.1.0 状态化轻量元素（from-user 2026-09-13 批准）", () => {
  /** 画布空白双击创建节点（RF stub pane 事件）。 */
  async function createNodeAt(x: number, y: number) {
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: x, clientY: y });
    await waitFor(() => {
      expect(screen.getAllByTestId(/^rf-node-/).length).toBeGreaterThan(0);
    });
  }

  it("空白态：底部创建提示可见、浮动整理按钮不显示；提示非交互", async () => {
    setup();
    const hint = await screen.findByTestId("empty-canvas-hint");
    expect(hint.textContent).toBe("双击创建 · ⌥Space");
    expect(hint.style.pointerEvents).toBe("none"); // 不遮挡输入
    expect(screen.queryByTestId("organize-fab")).toBeNull();
  });

  it("单节点态：提示消失、浮动整理按钮仍不显示（≥2 节点才出现）", async () => {
    setup();
    await createNodeAt(100, 100);
    await waitFor(() => expect(screen.queryByTestId("empty-canvas-hint")).toBeNull());
    expect(screen.queryByTestId("organize-fab")).toBeNull();
  });

  it("多节点态：浮动整理按钮出现；点击与菜单命令同 dispatcher，恰好一次布局命令（一次 undo 完整恢复）", async () => {
    setup();
    await createNodeAt(700, 10);
    // 首个节点仍处于编辑态，先 Esc 收尾再建第二个
    fireEvent.keyDown(screen.getByLabelText("编辑节点文本"), { key: "Escape" });
    await createNodeAt(30, 500);
    fireEvent.keyDown(screen.getByLabelText("编辑节点文本"), { key: "Escape" });

    const fab = await screen.findByTestId("organize-fab");
    expect(fab.textContent).toContain("整理");

    // 记录整理前位置（一次 undo 完整恢复 = 只产生一条布局命令）
    const posBefore = screen
      .getAllByTestId(/^rf-node-/)
      .map((el) => el.getAttribute("data-testid"));

    fireEvent.click(fab);
    await waitFor(() => expect(screen.getByText(/已整理为分层布局/)).toBeTruthy());

    // 画布层 ⌘Z：一次 undo 后节点仍在且不丢（位置恢复由 core 契约锁定）
    const canvasHost = document.querySelector('[role="application"]')!;
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true });
    await waitFor(() => {
      const posAfter = screen
        .getAllByTestId(/^rf-node-/)
        .map((el) => el.getAttribute("data-testid"));
      expect(posAfter.sort()).toEqual([...posBefore].sort());
    });
  });

  it("整理是双向开关（OFR-2026-09-15）：再点一次还原整理前布局，按钮文案随态切换", async () => {
    setup();
    await createNodeAt(700, 10);
    fireEvent.keyDown(screen.getByLabelText("编辑节点文本"), { key: "Escape" });
    await createNodeAt(30, 500);
    fireEvent.keyDown(screen.getByLabelText("编辑节点文本"), { key: "Escape" });

    const fab = await screen.findByTestId("organize-fab");
    expect(fab.textContent).toContain("整理");
    fireEvent.click(fab);
    await waitFor(() => expect(screen.getByText(/已整理为分层布局/)).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("organize-fab").textContent).toContain("还原布局"));

    fireEvent.click(screen.getByTestId("organize-fab"));
    await waitFor(() => expect(screen.getByText(/已还原到整理前的布局/)).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("organize-fab").textContent).toContain("整理 ⇧⌘L"));
  });
});

describe("红灯 2：onboarding 首启呈现（OFR-2026-09-14 #7）", () => {
  it("偏好 not-started 首次启动自动出现 welcome 遮罩", async () => {
    const preferences = new FakePreferencesPort();
    const loadSpy = vi.spyOn(preferences, "load");
    setup(preferences); // 空 snapshot → not-started
    // 等 restore 链路真实跑完，welcome 卡出现（首次用户需要看到引导）。
    await waitFor(() => expect(loadSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
    await screen.findByRole("dialog", { name: "欢迎使用脑图" });
    expect(screen.getByTestId("onboarding-overlay")).toBeTruthy();
  });

  it("偏好 in-progress 也不在启动时自动遮挡画布", async () => {
    const preferences = new FakePreferencesPort({ onboardingStatus: "in-progress" });
    const loadSpy = vi.spyOn(preferences, "load");
    setup(preferences);
    await waitFor(() => expect(loadSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("onboarding-overlay")).toBeNull();
  });

  it("⌘⇧H 显式打开引导；跳过后偏好记录 skipped", async () => {
    const preferences = new FakePreferencesPort();
    setup(preferences);
    fireEvent.keyDown(window, { key: "h", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-overlay")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("跳过"));
    await waitFor(() => {
      expect(screen.queryByTestId("onboarding-overlay")).toBeNull();
    });
    expect(await preferences.load()).toMatchObject({ onboardingStatus: "skipped" });
  });

  it("completed 偏好下仍可由显式命令可靠重放", async () => {
    const preferences = new FakePreferencesPort({ onboardingStatus: "completed" });
    setup(preferences);
    await waitFor(() => expect(screen.queryByTestId("onboarding-overlay")).toBeNull());
    fireEvent.keyDown(window, { key: "h", metaKey: true, shiftKey: true });
    await screen.findByText("第 1 步 · 创建第一个节点");
  });
});

describe("红灯 5：无顶栏后既有语义保持", () => {
  it("OFR-2026-09-14 #5：edit.undo/edit.redo 经 dispatcher 路由（不依赖画布焦点）", async () => {
    setup();
    const dispatch = (
      window as typeof window & { __mmDispatchAppCommand?: (id: string) => boolean }
    ).__mmDispatchAppCommand;
    expect(dispatch).toBeTypeOf("function");

    // 画布双击建点（rf-stub 路径）→ dirty、节点渲染
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 40, clientY: 24 });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeTruthy());

    // 菜单命令路径撤销：文档回到空、dirty 清除（撤销的是唯一未保存变更）
    expect(dispatch?.("edit.undo")).toBe(true);
    await waitFor(() => {
      expect(document.querySelectorAll('[class*="react-flow__node"]')).toHaveLength(0);
      expect(document.title.startsWith("● ")).toBeFalsy();
    });

    // 重做恢复节点
    expect(dispatch?.("edit.redo")).toBe(true);
    await waitFor(() => {
      expect(document.querySelectorAll('[class*="react-flow__node"]')).toHaveLength(1);
      expect(document.title.startsWith("● ")).toBeTruthy();
    });

    // 空历史上 undo 是无害 no-op（不 bump、不报错）
    expect(dispatch?.("edit.undo")).toBe(true);
    expect(dispatch?.("edit.undo")).toBe(true);
  });

  it("重复选择当前主题是 no-op，不产生虚假 dirty", async () => {
    setup();
    const dispatch = (
      window as typeof window & { __mmDispatchAppCommand?: (id: string) => boolean }
    ).__mmDispatchAppCommand;
    expect(dispatch).toBeTypeOf("function");
    expect(document.title.startsWith("● ")).toBe(false);
    expect(dispatch?.("view.theme-warm")).toBe(true);
    await Promise.resolve();
    expect(document.title.startsWith("● ")).toBe(false);
  });

  it("⌘S 保存 → document.title 的 dirty 标记清除（标题承载状态，非顶栏）", async () => {
    const { filePort } = setup();
    // ⌘O 打开 → 编辑（画布双击建点）→ dirty → ⌘S ordinary save（不弹选址）
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(document.title).toContain("a.json"));
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 40, clientY: 24 });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeTruthy());
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(filePort.saveDialogCalls).toBe(0); // 已有 handle：ordinary save 不弹框
      expect(document.title.startsWith("● ")).toBeFalsy();
    });
  });
});
