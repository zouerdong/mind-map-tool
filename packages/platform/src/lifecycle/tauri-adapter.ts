// LaunchRouter 的 Tauri 装配（MM-060）：订阅 host 事件、AppReady 握手、ack 转发。
// 窗口执行副作用由调用方注入（MM-080）；本类只负责协议接线。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { IPC_COMMANDS, IPC_EVENTS, type LaunchIntentPayload } from "../ipc/types.js";
import {
  decideWindowAction,
  LaunchRouter,
  type WindowAction,
  type WindowContext,
} from "./launch-router.js";

export type LaunchActionHandler = (action: WindowAction, intent: LaunchIntentPayload) => void;

export class TauriLifecycleAdapter {
  private unlisten: UnlistenFn | null = null;
  readonly router: LaunchRouter;

  constructor(getWindows: () => WindowContext[], onAction: LaunchActionHandler) {
    this.router = new LaunchRouter(
      {
        onWindowAction: onAction,
        onAck: (id) => {
          void invoke(IPC_COMMANDS.ackLaunchIntent, { intentId: id }).catch(() => {
            // ack 失败不阻塞路由；host 会在下次 flush 幂等重发未确认 intent。
          });
        },
      },
      getWindows,
    );
  }

  /**
   * AppReady 握手：invoke 返回 host 缓存的 early intents（cold argv 与
   * 就绪前到达的系统事件），逐个注入 router 后标记就绪；随后订阅后续
   * 事件（warm 期 second-instance / open-file / activation）。
   */
  async start(): Promise<void> {
    const flushed = await invoke<LaunchIntentPayload[]>(IPC_COMMANDS.appReady);
    for (const intent of flushed) this.router.onIntent(intent);
    this.router.markAppReady();
    this.unlisten = await listen<LaunchIntentPayload>(IPC_EVENTS.launchIntent, (event) => {
      this.router.onIntent(event.payload);
    });
  }

  /** ack 转发（幂等；host 侧重复 ack 不报错）。 */
  ack(intentId: string): Promise<void> {
    return invoke(IPC_COMMANDS.ackLaunchIntent, { intentId });
  }

  async stop(): Promise<void> {
    await this.unlisten?.();
    this.unlisten = null;
  }
}

// 供装配方显式复用路由决策（测试/MM-080）。
export { decideWindowAction };
