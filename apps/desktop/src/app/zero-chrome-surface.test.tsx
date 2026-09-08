// @vitest-environment jsdom
// PRR-065 红灯（卡 §红灯 1/2/5）：零 WebView Chrome 命令面。
// 1. 生产渲染树无 AppHeader（主工具条 / 文件 ▾ / 整理 / 视图 / 主题按钮 / 40px 占位）
// 2. 首启偏好 not-started 不自动出示 onboarding；⌘⇧H（浏览器 dev keydown）可显式打开
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

describe("红灯 2：onboarding explicit-only", () => {
  it("偏好 not-started 首次启动不自动出现 onboarding 遮罩", async () => {
    const preferences = new FakePreferencesPort();
    const loadSpy = vi.spyOn(preferences, "load");
    setup(preferences); // 空 snapshot → not-started
    // 先等 restore 链路真实跑完（load 被消费），再断言最终不可见——
    // 避免异步未完成时的假阴性。
    await waitFor(() => expect(loadSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("onboarding-overlay")).toBeNull();
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
