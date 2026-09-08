// @vitest-environment jsdom
// OnboardingFlow 组件测试（MM-070 ④⑤）：fake 偏好 + fake 命令通道；
// 非模态/非阻塞断言（遮罩 pointer-events:none、卡片 aria-modal=false）。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "@mindmap/core";
import {
  createOnboardingPreferences,
  InMemoryPreferenceStore,
  OnboardingFlow,
  OnboardingOverlay,
  LIGHT_TOKENS,
  INITIAL_ONBOARDING_STATE,
} from "../src/index.js";
import { onboardingReducer } from "../src/onboarding/onboarding-reducer.js";

afterEach(cleanup);

import type { OnboardingObservation } from "../src/onboarding/onboarding-types.js";

/** fake 命令通道：测试直接向订阅者转发 observation。 */
function fakeChannel() {
  const subs = new Set<(o: OnboardingObservation) => void>();
  return {
    observeCommands(cb: (o: OnboardingObservation) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    emit(o: OnboardingObservation) {
      for (const s of subs) s(o);
    },
  };
}

const CREATE: Command = {
  kind: "CreateNode",
  id: "n1",
  text: "",
  position: { x: 0, y: 0 },
  size: { width: 10, height: 10 },
};
const EDIT: Command = {
  kind: "EditNodeText",
  id: "n1",
  text: "一",
  size: { width: 20, height: 10 },
};
const MOVE: Command = { kind: "MoveNodes", moves: [{ id: "n1", position: { x: 1, y: 1 } }] };
const EDGE: Command = { kind: "CreateEdge", id: "e1", sourceNodeId: "n1", targetNodeId: "n2" };
const THEME: Command = { kind: "SetDocumentStyle", theme: "dark" };

describe("OnboardingOverlay", () => {
  it("welcome 卡：标题/正文/开始/跳过按钮齐全", () => {
    const state = onboardingReducer(INITIAL_ONBOARDING_STATE, {
      type: "restore",
      status: "not-started",
    });
    render(
      <OnboardingOverlay
        state={state}
        tokens={LIGHT_TOKENS}
        onStart={() => {}}
        onSkip={() => {}}
        onHide={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "欢迎使用脑图" })).toBeTruthy();
    expect(screen.getByText("开始引导")).toBeTruthy();
    expect(screen.getByText("跳过")).toBeTruthy();
  });

  it("非模态且不拦截：遮罩 pointer-events:none、dialog aria-modal=false（AC-09 不阻塞）", () => {
    const state = onboardingReducer(INITIAL_ONBOARDING_STATE, { type: "start" });
    const { container } = render(
      <OnboardingOverlay
        state={state}
        tokens={LIGHT_TOKENS}
        onStart={() => {}}
        onSkip={() => {}}
        onHide={() => {}}
      />,
    );
    const overlay = container.querySelector('[data-testid="onboarding-overlay"]') as HTMLElement;
    expect(overlay.style.pointerEvents).toBe("none");
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.style.pointerEvents).toBe("auto"); // 只有卡片可交互
  });

  it("锚定 semantic anchor（anchorLookup 命中时卡片贴近锚点）", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () =>
      ({ left: 100, top: 50, bottom: 90, right: 200, width: 100, height: 40 }) as DOMRect;
    const state = onboardingReducer(INITIAL_ONBOARDING_STATE, { type: "start" }); // create-first → canvas.pane
    const { container } = render(
      <OnboardingOverlay
        state={state}
        tokens={LIGHT_TOKENS}
        onStart={() => {}}
        onSkip={() => {}}
        onHide={() => {}}
        anchorLookup={(id) => (id === "canvas.pane" ? anchor : null)}
      />,
    );
    const card = container.querySelector('[data-testid="onboarding-card"]') as HTMLElement;
    expect(card.style.left).toContain("100");
    expect(card.style.top).toContain("98"); // bottom(90)+8
  });

  it("× 隐藏按钮回调 onHide（不等于跳过）", () => {
    const state = onboardingReducer(INITIAL_ONBOARDING_STATE, { type: "start" });
    const onHide = vi.fn();
    render(
      <OnboardingOverlay
        state={state}
        tokens={LIGHT_TOKENS}
        onStart={() => {}}
        onSkip={() => {}}
        onHide={onHide}
      />,
    );
    fireEvent.click(screen.getByTestId("onboarding-hide"));
    expect(onHide).toHaveBeenCalled();
  });
});

describe("OnboardingFlow（端到端：偏好 + 命令通道）", () => {
  it("首次（not-started）自动出示 welcome → 开始 → 命令流推进 → 完成写偏好", async () => {
    const store = new InMemoryPreferenceStore();
    const prefs = createOnboardingPreferences(store);
    const channel = fakeChannel();
    render(<OnboardingFlow observeCommands={channel.observeCommands} preferences={prefs} />);

    await screen.findByRole("dialog", { name: "欢迎使用脑图" });
    fireEvent.click(screen.getByText("开始引导"));

    // 第 1 步：CreateNode + EditNodeText
    channel.emit({ kind: "command", command: CREATE });
    channel.emit({ kind: "command", command: EDIT });
    await screen.findByText("第 2 步 · 第二个节点与连接");

    // 第 2 步
    channel.emit({ kind: "command", command: CREATE });
    channel.emit({ kind: "command", command: MOVE });
    channel.emit({ kind: "command", command: EDGE });
    await screen.findByText("第 3 步 · 撤销或换主题");

    // 第 3 步（任一）
    channel.emit({ kind: "command", command: THEME });
    await screen.findByText("第 4 步 · 保存或导出");

    // 第 4 步（外部动作 save）→ completed
    channel.emit({ kind: "external", action: "save" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // Overlay 隐藏与偏好持久化由两个独立 effect 完成；不能用前者的
    // DOM 终态推断后者的 Promise 已经落定，否则全量门禁负载下会抖动。
    await waitFor(async () => {
      expect(await prefs.load()).toBe("completed");
      expect(store.snapshot()).toEqual({ onboardingStatus: "completed" });
    });
  });

  it("跳过：写偏好，后续启动不再弹出（AC-09）", async () => {
    const store = new InMemoryPreferenceStore({ onboardingStatus: "skipped" });
    const prefs = createOnboardingPreferences(store);
    const channel = fakeChannel();
    render(<OnboardingFlow observeCommands={channel.observeCommands} preferences={prefs} />);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull(); // 不再强制弹出
    });
  });

  it("presentRestoredState=false：恢复 not-started/in-progress 但启动不呈现", async () => {
    for (const status of ["not-started", "in-progress"] as const) {
      cleanup();
      const store = new InMemoryPreferenceStore(
        status === "not-started" ? {} : { onboardingStatus: status },
      );
      const prefs = createOnboardingPreferences(store);
      const loadSpy = vi.spyOn(prefs, "load");
      const channel = fakeChannel();
      render(
        <OnboardingFlow
          observeCommands={channel.observeCommands}
          preferences={prefs}
          presentRestoredState={false}
        />,
      );
      await waitFor(() => expect(loadSpy).toHaveBeenCalled());
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("偏好读取失败不阻塞画布，并向宿主报告非致命提示", async () => {
    const onPreferenceWarning = vi.fn();
    const prefs = {
      load: vi.fn().mockRejectedValue(new Error("permission denied")),
      store: vi.fn(),
    };
    const channel = fakeChannel();

    render(
      <OnboardingFlow
        observeCommands={channel.observeCommands}
        preferences={prefs}
        onPreferenceWarning={onPreferenceWarning}
      />,
    );

    await screen.findByRole("dialog", { name: "欢迎使用脑图" });
    expect(onPreferenceWarning).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
  });

  it("replaySignal 自增 → 从头重放", async () => {
    const store = new InMemoryPreferenceStore({ onboardingStatus: "completed" });
    const prefs = createOnboardingPreferences(store);
    const channel = fakeChannel();
    const { rerender } = render(
      <OnboardingFlow
        observeCommands={channel.observeCommands}
        preferences={prefs}
        replaySignal={0}
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(
      <OnboardingFlow
        observeCommands={channel.observeCommands}
        preferences={prefs}
        replaySignal={1}
      />,
    );
    // 重放从第一步（create-first）开始
    await screen.findByText("第 1 步 · 创建第一个节点");
  });

  it("组件卸载时取消命令订阅（不泄漏）", async () => {
    const store = new InMemoryPreferenceStore();
    const prefs = createOnboardingPreferences(store);
    const channel = fakeChannel();
    const unsubscribe = vi.fn();
    const original = channel.observeCommands;
    channel.observeCommands = (cb: never) => {
      void original(cb);
      return unsubscribe;
    };
    const { unmount } = render(
      <OnboardingFlow observeCommands={channel.observeCommands as never} preferences={prefs} />,
    );
    await waitFor(() => expect(unsubscribe).not.toHaveBeenCalled());
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
