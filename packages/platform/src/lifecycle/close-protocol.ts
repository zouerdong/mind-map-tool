// 原生关闭协议的前端侧（MRT-003 / CR-003）：
// host 对 native close fail closed（prevent_close + pending request），前端只
// 通过本 port 应答 disposition。协议要点（任务卡 §4.3/§5）：
// - 订阅先于快照：先 listen close-requested，再读 pending 快照，覆盖
//   "host 已建立请求但 listener 尚未安装"的窗口（不得用延时重发解决）；
// - event 与 snapshot 统一入口，按 requestId 去重（双达只处理一次）；
// - resolve 的拒绝统一映射为 PlatformError(INVALID_CLOSE_REQUEST)，不退化为
//   任意字符串判断。
// 003A 骨架：类型与接口已定，协调逻辑未实现（失败测试先行）。

import { IPC_EVENTS, type CloseDisposition, type CloseRequestPayload } from "../ipc/types.js";
import { PlatformError } from "../file/errors.js";

/** App 参与原生关闭协议的 port；host 掌握最终关闭权。 */
export interface CloseLifecyclePort {
  /** 订阅关闭请求（内部保证订阅先于快照与 requestId 去重）。 */
  start(onRequest: (request: CloseRequestPayload) => void): Promise<void>;
  stop(): Promise<void>;
  /**
   * 应答一次 close request。host 校验调用者窗口与 requestId；
   * 伪造/跨窗/过期/已消费 reject PlatformError("INVALID_CLOSE_REQUEST")；
   * host 发起第二次 close 失败 reject PlatformError("WINDOW_CLOSE_FAILED")
   * （此时 pending 已被 host 恢复，窗口仍可重试）。
   */
  resolve(requestId: string, disposition: CloseDisposition): Promise<void>;
}

/** 传输注入：tauri-close-adapter 提供真实实现，测试注入 fake。 */
export interface CloseTransport {
  /** 订阅事件；返回取消订阅函数。 */
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
  /** 读取当前窗口的 pending close 快照（listener 竞态补偿）。 */
  pendingCloseRequest(): Promise<CloseRequestPayload | null>;
  /** 转发 resolve（IPC 层错误原样抛出，由 gate 统一映射）。 */
  resolveCloseRequest(requestId: string, disposition: CloseDisposition): Promise<void>;
}

/** IPC 拒绝 → 稳定 PlatformError（错误码不退化为任意字符串）。 */
export function toClosePlatformError(e: unknown): PlatformError {
  if (e instanceof PlatformError) return e;
  if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
    const { code, message } = e as { code: unknown; message: unknown };
    if (typeof code === "string" && typeof message === "string") {
      if (code === "WINDOW_CLOSE_FAILED") return new PlatformError("WINDOW_CLOSE_FAILED", message);
      return new PlatformError("INVALID_CLOSE_REQUEST", message);
    }
  }
  return new PlatformError("INVALID_CLOSE_REQUEST", String(e));
}

/**
 * 纯协调逻辑：订阅先于快照、双源合一、requestId 去重、response 映射。
 * 不依赖 Tauri runtime，可直接单测。
 */
export class CloseRequestGate {
  private seen = new Set<string>();
  private handler: ((request: CloseRequestPayload) => void) | null = null;
  private unlisten: (() => void) | null = null;

  constructor(private readonly transport: CloseTransport) {}

  async start(onRequest: (request: CloseRequestPayload) => void): Promise<void> {
    this.handler = onRequest;
    // 1. 先订阅：覆盖 start 之后到达的 close-requested 事件。
    this.unlisten = await this.transport.listen(IPC_EVENTS.closeRequested, (payload) => {
      this.dispatch(payload as CloseRequestPayload);
    });
    // 2. 后读快照：补偿"host 已建立请求但 listener 尚未安装"的窗口。
    //    与事件统一入口并按 requestId 去重 → 双达只处理一次。
    const pending = await this.transport.pendingCloseRequest();
    if (pending) this.dispatch(pending);
  }

  async stop(): Promise<void> {
    this.handler = null;
    this.unlisten?.();
    this.unlisten = null;
  }

  /** event 与 snapshot 的统一入口（去重后恰好送达一次）。 */
  dispatch(request: CloseRequestPayload): void {
    if (this.seen.has(request.requestId)) return;
    this.seen.add(request.requestId);
    this.handler?.(request);
  }

  async resolve(requestId: string, disposition: CloseDisposition): Promise<void> {
    try {
      await this.transport.resolveCloseRequest(requestId, disposition);
    } catch (e) {
      throw toClosePlatformError(e);
    }
  }
}
