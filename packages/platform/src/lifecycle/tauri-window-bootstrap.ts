// Per-window bootstrap 协议的 Tauri 装配（MRT-004 Wave 2 §5C3/C5）：
// 只做传输接线（targeted listen + ready 快照 + 终态回报转发），协调逻辑
// （listener-first、deliveryId 去重、action-once、可靠重报）在
// window-bootstrap.ts 的 WindowBootstrapAdapter。
//
// 事件 `platform://window-bootstrap` 由 host 定向 emit 到本窗口
// （emit_to），因此本窗口普通 listen 即只收到自己的交付（ADR 0008 §6）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toPlatformError } from "../file/errors.js";
import { IPC_COMMANDS, IPC_EVENTS } from "../ipc/types.js";
import type {
  BootstrapActionOutcome,
  WindowBootstrap,
  WindowBootstrapPorts,
} from "./window-bootstrap.js";

export function createTauriBootstrapPorts(): WindowBootstrapPorts {
  return {
    async onBootstrap(handler) {
      const unlisten = await listen<WindowBootstrap>(IPC_EVENTS.windowBootstrap, (event) => {
        handler(event.payload);
      });
      return () => {
        void unlisten();
      };
    },
    async readPendingSnapshot() {
      try {
        return await invoke<WindowBootstrap[]>(IPC_COMMANDS.windowReady);
      } catch (error) {
        throw toPlatformError(error);
      }
    },
    async reportOutcome(deliveryId: string, outcome: BootstrapActionOutcome) {
      try {
        await invoke<void>(IPC_COMMANDS.completeWindowBootstrap, { deliveryId, outcome });
      } catch (error) {
        throw toPlatformError(error);
      }
    },
  };
}
