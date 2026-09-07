// @vitest-environment jsdom
// MRT-004 Wave 2 renderer 腿集成测试：Tauri 运行时下 MindMapApp 的
// per-window bootstrap 装配（§5C5）与 retry/dismiss/recovery UI（§5D2/§4.3）。
// mock @tauri-apps/api；fake ports 注入；不触达真实 Tauri。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LaunchRetryableError, PendingRecovery } from "@mindmap/platform";
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

function makePorts(launch: InstanceType<typeof FakeLaunchPort>) {
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
    launch,
    isBrowserDev: false,
  };
}

function openedDto(contentJson: string) {
  return {
    contentJson,
    documentTargetHandle: "doc-1",
    versionToken: "tok-1",
    displayPath: "/tmp/启动 文档.json",
  };
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Tauri 运行时标记（isTauriRuntime 的判定依据）
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

afterEach(() => {
  // 不清 listeners：模块级 bootstrap adapter 跨测试（同一"WebView"）存活，
  // 其 handler 必须保留——事件通道是后续交付的唯一入口（ready 快照只在
  // 首次 start 读取一次，与真实 WebView 语义一致）。
  cleanup();
});

/** 经事件通道注入一次交付（同 WebView 的后续交付路径）。 */
function emitBootstrap(payload: unknown): void {
  listeners.get("platform://window-bootstrap")?.({ payload });
}

describe("per-window bootstrap 装配（§5C5）", () => {
  it("open-path 交付：host 分配读取 → decode → load/adopt → 回报 opened", async () => {
    const doc = new TextDecoder().decode(
      (await import("@mindmap/core")).encodeDocument(
        (await import("@mindmap/core")).emptyDocument(),
      ),
    );
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "platform_window_ready")
        return [{ deliveryId: "d-1", intentId: "i-1", kind: "open-path" }];
      if (cmd === "platform_open_assigned_document") return openedDto(doc);
      return undefined;
    });
    render(<MindMapApp ports={makePorts(new FakeLaunchPort())} />);
    // action 完成后回报 opened（终态；不是事件到达即 ack）
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("platform_complete_window_bootstrap", {
        deliveryId: "d-1",
        outcome: { kind: "opened" },
      });
    });
    // 文档已加载：窗口标题携带文档名
    await waitFor(() => expect(document.title).toContain("启动 文档.json"));
  });

  it("decode 失败：回报 retryable-error（不回报 opened）", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "platform_window_ready") return [];
      if (cmd === "platform_open_assigned_document") return openedDto("not-json");
      return undefined;
    });
    render(<MindMapApp ports={makePorts(new FakeLaunchPort())} />);
    emitBootstrap({ deliveryId: "d-bad", intentId: "i-bad", kind: "open-path" });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("platform_complete_window_bootstrap", {
        deliveryId: "d-bad",
        outcome: { kind: "retryable-error", reason: expect.stringContaining("有效的脑图文档") },
      });
    });
  });

  it("同一 delivery 事件重发不重跑 action（去重；只 report 已缓存 outcome）", async () => {
    const doc = new TextDecoder().decode(
      (await import("@mindmap/core")).encodeDocument(
        (await import("@mindmap/core")).emptyDocument(),
      ),
    );
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "platform_window_ready") return [];
      if (cmd === "platform_open_assigned_document") return openedDto(doc);
      return undefined;
    });
    render(<MindMapApp ports={makePorts(new FakeLaunchPort())} />);
    emitBootstrap({ deliveryId: "d-evt", intentId: "i-evt", kind: "open-path" });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("platform_complete_window_bootstrap", {
        deliveryId: "d-evt",
        outcome: { kind: "opened" },
      });
    });
    const opensBefore = invokeMock.mock.calls.filter(
      ([c]) => c === "platform_open_assigned_document",
    ).length;
    // 同 delivery 重发（host 幂等重发语义）：action 不重跑
    emitBootstrap({ deliveryId: "d-evt", intentId: "i-evt", kind: "open-path" });
    await new Promise((r) => setTimeout(r, 0));
    const opensAfter = invokeMock.mock.calls.filter(
      ([c]) => c === "platform_open_assigned_document",
    ).length;
    expect(opensAfter).toBe(opensBefore);
  });
});

describe("retry / dismiss / recovery UI（§5D2/§4.3）", () => {
  it("定向 launch-retryable-error 事件 → 快照显示 + 重试/放弃动作", async () => {
    const launch = new FakeLaunchPort();
    const retryCalls: string[] = [];
    launch.retryLaunchIntent = async (id: string): Promise<void> => {
      retryCalls.push(id);
    };
    launch.launchErrors = async (): Promise<LaunchRetryableError[]> => [
      {
        intentId: "intent-err",
        reason: "webview 创建失败",
        kind: "open-file",
        receivedAt: 1,
        presentationWindowLabel: "main",
        presentationWindowGeneration: 1,
        originFailedWindowLabel: null,
      },
    ];
    render(<MindMapApp ports={makePorts(launch)} />);
    listeners.get("platform://launch-retryable-error")?.({ payload: { intentId: "intent-err" } });
    await waitFor(() => expect(screen.getByTestId("launch-errors")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("重试打开"));
    await waitFor(() => expect(retryCalls).toEqual(["intent-err"]));
  });

  it("pending recovery 状态可见并提供一次显式恢复", async () => {
    const launch = new FakeLaunchPort();
    const resolveCalls: number[] = [];
    launch.pendingRecovery = async (): Promise<PendingRecovery | null> => ({
      displayPath: "/tmp/new.mm",
      cause: "已写入目标文件；窗口文件状态恢复待完成（另存为换绑）",
    });
    launch.resolvePendingRecovery = async () => {
      resolveCalls.push(resolveCalls.length);
    };
    render(<MindMapApp ports={makePorts(launch)} />);
    await waitFor(() => expect(screen.getByTestId("pending-recovery")).toBeTruthy());
    expect(screen.getByTestId("pending-recovery").textContent).toContain("/tmp/new.mm");
    fireEvent.click(screen.getByTestId("resolve-recovery"));
    await waitFor(() => expect(resolveCalls).toHaveLength(1));
  });
});

describe("MRT-004W2R 红灯（R3/P4/H1 renderer 腿）", () => {
  const docOf = async () =>
    new TextDecoder().decode(
      (await import("@mindmap/core")).encodeDocument(
        (await import("@mindmap/core")).emptyDocument(),
      ),
    );

  it("R3:report 传输失败 → pending-reports UI 出现，一次重报成功后消失；action 不重跑", async () => {
    const doc = await docOf();
    let reportCalls = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "platform_window_ready") return [];
      if (cmd === "platform_open_assigned_document") return openedDto(doc);
      if (cmd === "platform_complete_window_bootstrap") {
        reportCalls += 1;
        if (reportCalls === 1) throw { code: "IPC_TRANSPORT", message: "传输中断" };
        return undefined;
      }
      return undefined;
    });
    render(<MindMapApp ports={makePorts(new FakeLaunchPort())} />);
    emitBootstrap({ deliveryId: "d-r3", intentId: "i-r3", kind: "open-path" });
    // report 失败可见：delivery 级 report-pending UI（不是只有一条 notice）
    await waitFor(() => expect(screen.getByTestId("pending-reports")).toBeTruthy());
    expect(screen.getByTestId("pending-reports").textContent).toContain("d-r3");
    await waitFor(() => expect(document.body.textContent).toContain("传输中断"));
    expect(document.body.textContent).not.toContain("[object Object]");
    // 显式一次重报：成功后提示消失
    fireEvent.click(screen.getByTestId("retry-bootstrap-report"));
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([c]) => c === "platform_complete_window_bootstrap"),
      ).toHaveLength(2),
    );
    await waitFor(() => expect(screen.queryByTestId("pending-reports")).toBeNull());
    // 再次点击入口不存在（成功后清空；无自动 timer、不自旋）
    expect(screen.queryByTestId("retry-bootstrap-report")).toBeNull();
    // action 恰好一次（重报不重跑 open/decode/load）
    expect(
      invokeMock.mock.calls.filter(([c]) => c === "platform_open_assigned_document").length,
    ).toBe(1);
  });

  it("P4:模块级 adapter 单例不得捕获失效 session——重挂载后的当前 session 承接交付", async () => {
    const doc = await docOf();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "platform_window_ready") return [];
      if (cmd === "platform_open_assigned_document")
        return {
          contentJson: doc,
          documentTargetHandle: "doc-p4",
          versionToken: "tok-p4",
          displayPath: "/tmp/重挂载后.json",
        };
      return undefined;
    });
    // 模块级 bootstrap adapter 单例已被此前测试的第一次挂载创建(同一
    // "WebView");本次 render 是一次真实重挂载:交付必须进入**当前** session
    // (旧闭包指向已卸载组件的 session → 文档永不显示 → 红灯)。
    render(<MindMapApp ports={makePorts(new FakeLaunchPort())} />);
    emitBootstrap({ deliveryId: "d-p4", intentId: "i-p4", kind: "open-path" });
    await waitFor(() => expect(document.title).toContain("重挂载后.json"), { timeout: 3000 });
  });

  it("H1:Tauri invoke reject 的 {code,message} 映射为 PlatformError（不退化为 [object Object]）", async () => {
    const { TauriLaunchPort } = await import("./ports.js");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "platform_retry_launch_intent")
        throw { code: "INVALID_INTENT_ACTION", message: "该意图当前没有可见错误" };
      return undefined;
    });
    const port = new TauriLaunchPort();
    const err = await port.retryLaunchIntent("intent-x").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toContain("该意图当前没有可见错误");
    expect(String(err.message)).not.toContain("[object Object]");
  });
});
