// @vitest-environment jsdom
// PRC-030 单元与集成测试：全局快捷键 Pre-Focus 两阶段协议
// 覆盖：
// 1. 收到 shortcut://pre-focus-probe 时，立即读取真实 document.hasFocus() 并回报 host；
// 2. 失焦/后台状态下回报 hadDocumentFocus=false；
// 3. 聚焦空闲状态下收到 quick-create，创建节点并进入编辑；
// 4. 编辑状态下收到 quick-create，画布不盲建节点、不打断现有输入；
// 5. 组件卸载后 probe/quick-create 监听器正确解绑。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listeners = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (e: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return () => {
      listeners.delete(event);
    };
  },
}));

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

beforeEach(() => {
  invokeMock.mockReset();
  listeners.clear();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

function setup() {
  const launch = new FakeLaunchPort();
  const filePort = new FakeFilePort();
  const preferences = new FakePreferencesPort();
  const renderer = new FakeExportRenderer();
  const shortcut = new FakeGlobalShortcut();
  const closeLifecycle = new FakeCloseLifecyclePort();

  const utils = render(
    <MindMapApp
      ports={{
        filePort,
        preferences,
        renderer,
        fonts: renderer.fonts(),
        isBrowserDev: false,
        globalShortcut: shortcut,
        closeLifecycle,
        launch,
      }}
    />,
  );
  return { ...utils, launch, filePort, renderer };
}

describe("PRC-030: 全局快捷键 Pre-Focus 两阶段协议与状态机", () => {
  it("窗口处于前台且聚焦时，收到 probe 回报 hadDocumentFocus=true", async () => {
    setup();

    const probeHandler = listeners.get("shortcut://pre-focus-probe");
    expect(probeHandler).toBeDefined();

    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });

    invokeMock.mockResolvedValueOnce(undefined);

    probeHandler!({
      payload: {
        invocationId: "inv-101",
        windowId: "main",
        generation: 1,
      },
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("platform_resolve_shortcut_invocation", {
        invocationId: "inv-101",
        windowId: "main",
        generation: 1,
        hadDocumentFocus: true,
      });
    });
  });

  it("窗口失焦/后台时，收到 probe 回报 hadDocumentFocus=false", async () => {
    setup();

    const probeHandler = listeners.get("shortcut://pre-focus-probe");
    expect(probeHandler).toBeDefined();

    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    invokeMock.mockResolvedValueOnce(undefined);

    probeHandler!({
      payload: {
        invocationId: "inv-102",
        windowId: "main",
        generation: 1,
      },
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("platform_resolve_shortcut_invocation", {
        invocationId: "inv-102",
        windowId: "main",
        generation: 1,
        hadDocumentFocus: false,
      });
    });
  });

  it("空闲态收到 quick-create，创建节点并进入编辑", async () => {
    setup();

    const quickCreateHandler = listeners.get("quick-create");
    expect(quickCreateHandler).toBeDefined();

    expect(screen.queryByRole("textbox")).toBeNull();

    // 模拟 host 判定前台聚焦后发放 quick-create
    quickCreateHandler!({ payload: { invocationId: "inv-103", generation: 1 } });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeDefined();
    });
  });

  it("正在编辑状态下收到 quick-create，不打断现有输入、不创建多余节点", async () => {
    setup();

    const quickCreateHandler = listeners.get("quick-create");
    expect(quickCreateHandler).toBeDefined();

    // 第一次 quick-create 进入编辑
    quickCreateHandler!({ payload: { invocationId: "inv-104", generation: 1 } });

    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "用户正在编辑内容" } });
    expect(textbox).toHaveProperty("value", "用户正在编辑内容");

    // 再次收到 quick-create（例如连续敲击）
    quickCreateHandler!({ payload: { invocationId: "inv-105", generation: 1 } });

    // 确认输入内容未被清空或打断，且仍然只有一个输入框
    expect(screen.getAllByRole("textbox").length).toBe(1);
    expect(screen.getByRole("textbox")).toHaveProperty("value", "用户正在编辑内容");
  });

  it("组件卸载时正确注销 probe 和 quick-create 监听器", async () => {
    const { unmount } = setup();

    expect(listeners.has("shortcut://pre-focus-probe")).toBe(true);
    expect(listeners.has("quick-create")).toBe(true);

    unmount();

    await waitFor(() => {
      expect(listeners.has("shortcut://pre-focus-probe")).toBe(false);
      expect(listeners.has("quick-create")).toBe(false);
    });
  });
});
