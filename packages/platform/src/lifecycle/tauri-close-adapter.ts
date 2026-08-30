// 原生关闭协议的 Tauri 装配（MRT-003）：listen + snapshot + resolve 转发。
// 协调逻辑（订阅先于快照、去重、错误映射）在 close-protocol.ts 的
// CloseRequestGate；本类只做传输接线，无独立状态。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { IPC_COMMANDS, type CloseDisposition, type CloseRequestPayload } from "../ipc/types.js";
import { CloseRequestGate, type CloseLifecyclePort } from "./close-protocol.js";

export class TauriCloseLifecycleAdapter implements CloseLifecyclePort {
  private readonly gate: CloseRequestGate;

  constructor() {
    this.gate = new CloseRequestGate({
      listen: async (event, handler) => {
        const unlisten = await listen<CloseRequestPayload>(event, (e) => handler(e.payload));
        return () => {
          void unlisten();
        };
      },
      pendingCloseRequest: () => invoke(IPC_COMMANDS.pendingCloseRequest),
      resolveCloseRequest: (requestId, disposition) =>
        invoke(IPC_COMMANDS.resolveCloseRequest, { requestId, disposition }),
    });
  }

  start(onRequest: (request: CloseRequestPayload) => void): Promise<void> {
    return this.gate.start(onRequest);
  }

  stop(): Promise<void> {
    return this.gate.stop();
  }

  resolve(requestId: string, disposition: CloseDisposition): Promise<void> {
    return this.gate.resolve(requestId, disposition);
  }
}
