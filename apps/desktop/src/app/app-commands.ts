// 应用命令单一 dispatcher（PRR-065 / ADR 0012）：
// 原生菜单事件（host 定向 emit）、应用级快捷键（浏览器 dev keydown）与
// 既有 UI 回调只能经由 dispatchAppCommand 到达业务逻辑，不得各自复制
// new/open/save/export/organize/theme 实现。
//
// AppCommandId 是平台无关契约（Windows 原生命令表同表移植）；
// host-owned 生命周期命令（Quit / 新建窗口 / 关闭窗口）不进本表——
// 它们保留在 Rust 侧（lib.rs menu 分流），不发给 renderer。

export type AppCommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.save-as"
  | "file.export-panel"
  | "view.fit"
  | "view.organize"
  | "view.layout-horizontal"
  | "view.layout-vertical"
  | "view.theme-warm"
  | "view.theme-dark"
  | "app.shortcuts"
  | "help.onboarding";

export interface AppCommandHandlers {
  "file.new": () => void;
  "file.open": () => void;
  "file.save": () => void;
  "file.save-as": () => void;
  "file.export-panel": () => void;
  "view.fit": () => void;
  "view.organize": () => void;
  "view.layout-horizontal": () => void;
  "view.layout-vertical": () => void;
  "view.theme-warm": () => void;
  "view.theme-dark": () => void;
  "app.shortcuts": () => void;
  "help.onboarding": () => void;
}

/** host → renderer 原生菜单命令事件（tauri 定向 emit；见 Rust menu 模块）。 */
export const APP_COMMAND_EVENT = "platform://app-command";

export interface AppCommandEventPayload {
  commandId: AppCommandId;
}

/** 命令表完备性锚点：key 集合必须与 AppCommandId 一致（satisfies 双向锁定）。 */
const APP_COMMAND_ID_TABLE = {
  "file.new": true,
  "file.open": true,
  "file.save": true,
  "file.save-as": true,
  "file.export-panel": true,
  "view.fit": true,
  "view.organize": true,
  "view.layout-horizontal": true,
  "view.layout-vertical": true,
  "view.theme-warm": true,
  "view.theme-dark": true,
  "app.shortcuts": true,
  "help.onboarding": true,
} as const satisfies Record<AppCommandId, true>;

const APP_COMMAND_IDS: ReadonlySet<string> = new Set(Object.keys(APP_COMMAND_ID_TABLE));

/** 是否为合法 renderer 应用命令（未识别的 menu id fail-closed 拒绝）。 */
export function isAppCommandId(value: string): value is AppCommandId {
  return APP_COMMAND_IDS.has(value);
}

/**
 * 派发一条应用命令。返回是否派发成功；未知 id（含 host-owned 泄漏）
 * 返回 false 且零副作用。一次调用恰好触发一个 handler。
 */
export function dispatchAppCommand(id: string, handlers: AppCommandHandlers): boolean {
  if (!isAppCommandId(id)) return false;
  handlers[id]();
  return true;
}

/**
 * exactly-once 平台分工（ADR 0012 §5）：生产（Tauri）环境应用级快捷键由
 * macOS 原生菜单 accelerator 拦截并产生唯一 menu event，WebView keydown
 * 不再派发；浏览器 dev（无原生菜单）keydown 是唯一来源。
 */
export function shouldDispatchShortcutViaKeydown(isTauri: boolean): boolean {
  return !isTauri;
}

/** 应用级快捷键动作 → 应用命令（keyboard.ts 的 ShortcutAction 单一事实源）。 */
export function shortcutActionToCommandId(
  action: "new" | "open" | "save" | "save-as" | "export-panel" | "replay-onboarding" | "organize",
): AppCommandId {
  switch (action) {
    case "new":
      return "file.new";
    case "open":
      return "file.open";
    case "save":
      return "file.save";
    case "save-as":
      return "file.save-as";
    case "export-panel":
      return "file.export-panel";
    case "replay-onboarding":
      return "help.onboarding";
    case "organize":
      return "view.organize";
  }
}

/** listen 的最小形状（@tauri-apps/api/event 与测试 fake 共用）。 */
export type EventUnlisten = () => void;
export type EventListenFn = (
  event: string,
  handler: (payload: { payload: unknown }) => void,
) => Promise<EventUnlisten>;

/**
 * 原生菜单命令桥接：订阅 APP_COMMAND_EVENT，把 host 定向发来的 commandId
 * 送入 dispatcher；返回卸载函数。未知 commandId（host-owned 泄漏或脏数据）
 * 由 dispatcher fail-closed 丢弃，不抛出。
 */
export function createAppCommandListenerBridge(
  dispatch: (id: string) => boolean,
  listenFn: EventListenFn,
  onListenError?: (error: unknown) => void,
): EventUnlisten {
  let disposed = false;
  let unlisten: EventUnlisten | null = null;
  void listenFn(APP_COMMAND_EVENT, (event) => {
    const payload = event.payload as AppCommandEventPayload | null;
    if (!payload || typeof payload.commandId !== "string") return;
    dispatch(payload.commandId);
  })
    .then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    })
    .catch((error: unknown) => {
      if (!disposed) onListenError?.(error);
    });
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}
