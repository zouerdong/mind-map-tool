// LaunchRouter（MM-060 步骤⑨）：LaunchIntent → queue → AppReady →
// normalize/dedupe → WindowAction → ack 的纯状态机。
// 不可信输入（argv/系统事件路径）已在 Rust host canonicalize；
// 本机只做：等价键去重、就绪前缓存、窗口路由决策、ack 幂等。
// 真正执行窗口操作的副作用由装配方注入（MM-080 接线），本类不触达 Tauri。

import type { LaunchIntentPayload } from "../ipc/types.js";

/** 路由器可见的窗口状态（由应用层提供；v1 主窗口优先）。 */
export interface WindowContext {
  windowId: string;
  /** 该窗口当前承载文档的 canonical path；空白窗口为 null。 */
  occupiedPath: string | null;
  dirty: boolean;
}

export type WindowAction =
  | { type: "focus-existing"; windowId: string }
  | { type: "open-in-window"; windowId: string; canonicalPath: string }
  | { type: "open-new-window"; canonicalPath: string }
  | { type: "new-blank-window" }
  | { type: "none" };

export interface LaunchRouterCallbacks {
  /** 路由决策产出；装配方负责真正聚焦/建窗/加载文档。 */
  onWindowAction: (action: WindowAction, intent: LaunchIntentPayload) => void;
  /** ack 回执；装配方转发 host（幂等，失败不阻塞路由）。 */
  onAck: (intentId: string) => void;
}

/**
 * 窗口路由决策（纯函数）：
 * - open-file：同一文件已在某窗口 → 聚焦；否则进首个 clean 空闲窗口（主窗口优先）；
 *   没有 clean 空闲窗口 → 新窗口（绝不覆盖 dirty 窗）。
 * - activation：无窗口 → 新建空白；有窗口 → 不动作（不碰 dirty 窗）。
 */
export function decideWindowAction(
  intent: LaunchIntentPayload,
  windows: WindowContext[],
): WindowAction {
  if (intent.kind === "activation") {
    return windows.length === 0 ? { type: "new-blank-window" } : { type: "none" };
  }
  const path = intent.canonicalPath as string;
  const existing = windows.find((w) => w.occupiedPath === path);
  if (existing) return { type: "focus-existing", windowId: existing.windowId };
  const idle = windows.find((w) => !w.dirty && w.occupiedPath === null);
  if (idle) return { type: "open-in-window", windowId: idle.windowId, canonicalPath: path };
  return { type: "open-new-window", canonicalPath: path };
}

/** 等价键：host 已 canonicalize，此处以 (kind, path) 为键；activation 无键（不去重）。 */
export function intentDedupeKey(intent: LaunchIntentPayload): string | null {
  return intent.canonicalPath === null ? null : `${intent.kind}:${intent.canonicalPath}`;
}

export class LaunchRouter {
  private ready = false;
  /** pending 期间的等价键（host 队列已按未 ack 合并；此处兜底前端重连重取）。 */
  private readonly pendingKeys = new Set<string>();
  private readonly acked = new Set<string>();
  private pending: LaunchIntentPayload[] = [];

  constructor(
    private readonly callbacks: LaunchRouterCallbacks,
    private readonly getWindows: () => WindowContext[],
  ) {}

  /** 前端就绪（AppReady）：处理就绪前缓存的所有 intent。幂等：重复调用无效果。 */
  markAppReady(): void {
    if (this.ready) return;
    this.ready = true;
    const queued = this.pending;
    this.pending = [];
    this.pendingKeys.clear();
    for (const intent of queued) this.dispatch(intent);
  }

  get isReady(): boolean {
    return this.ready;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * host flush / 事件到达入口；返回是否被接收（false = 等价重复，已忽略）。
   * 就绪后不去重路径键：host 队列保证未 ack 的同键 intent 不重复投递，
   * ack 后同路径到达是新用户动作（再次双击文件 → 聚焦已有窗口）。
   */
  onIntent(intent: LaunchIntentPayload): boolean {
    if (this.ready) {
      this.dispatch(intent);
      return true;
    }
    const key = intentDedupeKey(intent);
    if (key !== null) {
      if (this.pendingKeys.has(key)) {
        this.callbacks.onAck(intent.intentId);
        return false;
      }
      this.pendingKeys.add(key);
    }
    this.pending.push(intent);
    return true;
  }

  /** ack 幂等：重复/未知 id 不报错；返回是否首次 ack。 */
  acknowledge(intentId: string): boolean {
    if (this.acked.has(intentId)) return false;
    this.acked.add(intentId);
    return true;
  }

  private dispatch(intent: LaunchIntentPayload): void {
    if (!this.acknowledge(intent.intentId)) return;
    const action = decideWindowAction(intent, this.getWindows());
    this.callbacks.onWindowAction(action, intent);
    this.callbacks.onAck(intent.intentId);
  }
}
