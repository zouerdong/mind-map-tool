// PRR-065：AppCommandId 单一 dispatcher 契约（红灯 3/4 的纯逻辑层）。
// 未识别命令（host-owned 泄漏/脏数据）fail-closed；一次派发恰好一个 handler。

import { describe, expect, it, vi } from "vitest";
import {
  APP_COMMAND_EVENT,
  createAppCommandListenerBridge,
  dispatchAppCommand,
  isAppCommandId,
  shouldDispatchShortcutViaKeydown,
  shortcutActionToCommandId,
  type AppCommandHandlers,
} from "./app-commands.js";

function recordingHandlers(calls: string[]): AppCommandHandlers {
  const handlers = {} as unknown as AppCommandHandlers;
  for (const id of [
    "file.new",
    "file.open",
    "file.save",
    "file.save-as",
    "file.export-panel",
    "view.fit",
    "view.organize",
    "view.layout-horizontal",
    "view.layout-vertical",
    "view.theme-warm",
    "view.theme-dark",
    "app.shortcuts",
    "help.onboarding",
  ] as const) {
    handlers[id] = () => calls.push(id);
  }
  return handlers;
}

describe("dispatchAppCommand", () => {
  it("合法命令恰好派发一次到对应 handler", () => {
    const calls: string[] = [];
    expect(dispatchAppCommand("file.save", recordingHandlers(calls))).toBe(true);
    expect(calls).toEqual(["file.save"]);
  });

  it("host-owned / 未知命令零副作用并返回 false", () => {
    const calls: string[] = [];
    const handlers = recordingHandlers(calls);
    for (const id of ["app-quit", "app-new-window", "file-close-window", "", "nonsense"]) {
      expect(dispatchAppCommand(id, handlers)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it("isAppCommandId 覆盖全部 renderer 命令表", () => {
    for (const id of ["file.new", "help.onboarding", "view.theme-dark", "app.shortcuts"]) {
      expect(isAppCommandId(id)).toBe(true);
    }
    expect(isAppCommandId("file.close-window")).toBe(false); // host-owned
  });
});

describe("快捷键 → 命令映射与 exactly-once 分工", () => {
  it("shortcutActionToCommandId 全表映射稳定", () => {
    expect(shortcutActionToCommandId("new")).toBe("file.new");
    expect(shortcutActionToCommandId("open")).toBe("file.open");
    expect(shortcutActionToCommandId("save")).toBe("file.save");
    expect(shortcutActionToCommandId("save-as")).toBe("file.save-as");
    expect(shortcutActionToCommandId("export-panel")).toBe("file.export-panel");
    expect(shortcutActionToCommandId("replay-onboarding")).toBe("help.onboarding");
    expect(shortcutActionToCommandId("organize")).toBe("view.organize");
  });

  it("Tauri 生产环境 keydown 不派发应用级快捷键；浏览器 dev 派发", () => {
    // 生产：菜单 accelerator 是唯一来源（红灯 4：防双重派发）
    expect(shouldDispatchShortcutViaKeydown(true)).toBe(false);
    expect(shouldDispatchShortcutViaKeydown(false)).toBe(true);
  });
});

describe("createAppCommandListenerBridge（原生菜单事件桥接）", () => {
  it("订阅 APP_COMMAND_EVENT，事件 payload 派发到 dispatcher", async () => {
    const calls: string[] = [];
    const handlers = recordingHandlers(calls);
    const dispatch = (id: string) => dispatchAppCommand(id, handlers);
    let captured: ((payload: { payload: unknown }) => void) | null = null;
    const unlisten = vi.fn();
    const bridge = createAppCommandListenerBridge(dispatch, (event, handler) => {
      expect(event).toBe(APP_COMMAND_EVENT);
      captured = handler;
      return Promise.resolve(unlisten);
    });
    captured!({ payload: { commandId: "file.save" } });
    captured!({ payload: { commandId: "app-quit" } }); // host-owned 泄漏：丢弃
    captured!({ payload: null }); // 脏数据：不抛
    expect(calls).toEqual(["file.save"]);
    bridge();
    await Promise.resolve(); // listen 的 then 微任务冲刷后清理生效
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("bridge 卸载晚于 listen resolve 时同样清理", async () => {
    let resolveListen: (u: () => void) => void = () => {};
    const late = new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    });
    const dispose = vi.fn();
    const bridge = createAppCommandListenerBridge(
      () => false,
      () => late,
    );
    bridge(); // resolve 之前卸载
    resolveListen(dispose);
    await late;
    expect(dispose).toHaveBeenCalledOnce();
  });
});
