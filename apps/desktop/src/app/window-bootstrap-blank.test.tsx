// @vitest-environment jsdom
// MRT-004 Wave 2：blank 交付的独立 WebView 语义验证（§5C5）——blank 只在
// 目标窗口初始 session 已空白时回报 blank-created。独立文件=独立模块级
// bootstrap adapter（首个用例的 session 初始为空，符合新窗口真实时序）。

import { cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
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

function makePorts() {
  return {
    filePort: new FakeFilePort(),
    preferences: new FakePreferencesPort(),
    renderer: new FakeExportRenderer(),
    fonts: {
      regular: () => ({ advance: () => 1, ascentRatio: 0.8 }),
      bold: () => ({ advance: () => 1, ascentRatio: 0.8 }),
    },
    globalShortcut: new FakeGlobalShortcut(),
    closeLifecycle: new FakeCloseLifecyclePort(),
    launch: new FakeLaunchPort(),
    isBrowserDev: false,
  };
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "platform_window_ready") return [];
    if (cmd === "platform_launch_errors") return [];
    if (cmd === "platform_pending_recovery") return null;
    return undefined;
  });
});

afterEach(() => cleanup());

describe("StrictMode 双挂载（§5C5）", () => {
  it("重挂载不重复 listener/不重读快照：windowReady 恰好一次、action 恰好一次", async () => {
    const readyCalls: number[] = [];
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "platform_window_ready") {
        readyCalls.push(readyCalls.length);
        return [];
      }
      return undefined;
    });
    const { unmount } = render(
      <StrictMode>
        <MindMapApp ports={makePorts()} />
      </StrictMode>,
    );
    unmount();
    const second = render(
      <StrictMode>
        <MindMapApp ports={makePorts()} />
      </StrictMode>,
    );
    listeners.get("platform://window-bootstrap")?.({
      payload: { deliveryId: "d-strict", intentId: "i-strict", kind: "open-path" },
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("platform_complete_window_bootstrap", {
        deliveryId: "d-strict",
        outcome: { kind: "retryable-error", reason: expect.any(String) },
      });
    });
    // windowReady 只读一次（模块级单例跨挂载复用；快照不重复消费）
    expect(readyCalls).toHaveLength(1);
    second.unmount();
  });
});

describe("blank 交付（§5C5）", () => {
  it("初始 session 空白 → 回报 blank-created", async () => {
    render(<MindMapApp ports={makePorts()} />);
    listeners.get("platform://window-bootstrap")?.({
      payload: { deliveryId: "d-blank", kind: "blank" },
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("platform_complete_window_bootstrap", {
        deliveryId: "d-blank",
        outcome: { kind: "blank-created" },
      });
    });
  });
});
