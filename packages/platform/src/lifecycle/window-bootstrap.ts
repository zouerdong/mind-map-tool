// Per-window bootstrap 协议(MRT-004A/A1 / ADR 0008 §6):renderer 只消费
// 定向给自己窗口的 bootstrap 交付,按固定顺序完成一次动作并可靠回报终态。
//
// 协议顺序(任务卡 §5.4,listener-first):
//   install targeted listener → read own pending snapshot → dedupe deliveryId
//   → await renderer action → report terminal / retryable outcome
//
// A1 修复(A1-F2/A1-F5):
// - per-delivery 状态机 `processing → report-pending → reported`:
//   - action 恰好执行一次(event/snapshot 双达去重);
//   - action resolve/reject 后缓存标准化 outcome;
//   - `reportOutcome` 成功才进入 reported;失败保留 report-pending 与
//     outcome,绝不空 catch、绝不重跑 action;
//   - 同 delivery 重发:processing 忽略、report-pending 只重报缓存
//     outcome、reported 忽略;
//   - `retryPendingReports()` 每次 pending 至多重报一次,不自旋;
//   - report 失败经 `onReportError` 回调与 `pendingReports()` 快照可观察;
// - `start()` 重复调用稳定拒绝;snapshot 读取失败先卸载 listener 再抛
//   (不泄漏);
// - `dispose()` 后不接新 delivery;进行中的 action 继续完成并保留
//   report(host 需要终态,否则 intent 永久悬挂——显式策略);
// - 判别联合 payload 与收窄的 renderer outcome(与 Rust `RendererOutcome`
//   一一对应;focused-existing/dismissed 只属于 host)。
//
// 本模块不依赖 Tauri/React/DOM;真实 IPC 装配在 MRT-004C。

/** host 定向交付给本窗口的 bootstrap(判别联合:kind 决定必带字段)。
 * MRT-004 Wave 2 §4.2:open 建议只携带 deliveryId + intentId + kind;
 * canonicalPath 仅为展示投影(可选),renderer 打开文档一律经
 * platform_open_assigned_document(deliveryId),不把路径字符串传回 host。 */
export type WindowBootstrap =
  | { deliveryId: string; intentId: string; kind: "open-path"; canonicalPath?: string }
  | { deliveryId: string; intentId?: string; kind: "blank" };

/**
 * renderer action 的 awaitable 终态(与 Rust RendererOutcome 一一对应;
 * A1-F5:不含 focused-existing / dismissed——它们由 host FocusWindow
 * effect 与用户 dismiss 通道产生)。
 */
export type BootstrapActionOutcome =
  { kind: "opened" } | { kind: "blank-created" } | { kind: "retryable-error"; reason: string };

/** report 失败的可观察通道(构造参数;不得静默吞掉 IPC 故障)。 */
export interface BootstrapReportHooks {
  onReportError?: (deliveryId: string, error: unknown) => void;
}

/** 副作用 port(Tauri 装配在 MRT-004C;测试注入 fake)。 */
export interface WindowBootstrapPorts {
  /** 安装定向 bootstrap listener;返回卸载函数。 */
  onBootstrap(handler: (bootstrap: WindowBootstrap) => void): Promise<() => void>;
  /** 读取本窗口 pending 快照(listener 注册前到达的交付;host 幂等重发)。 */
  readPendingSnapshot(): Promise<WindowBootstrap[]>;
  /** 回报终态(host 校验 deliveryId/label/generation 后 ack)。 */
  reportOutcome(deliveryId: string, outcome: BootstrapActionOutcome): Promise<void>;
}

type DeliveryStage = "processing" | "report-pending" | "reported";

interface DeliveryRecord {
  stage: DeliveryStage;
  outcome?: BootstrapActionOutcome;
}

/** 待重报的交付快照(稳定 error snapshot 的一部分)。 */
export interface PendingReport {
  deliveryId: string;
  outcome: BootstrapActionOutcome;
}

/**
 * 纯 bootstrap 状态机:listener-first + 快照兜底 + deliveryId 去重 +
 * action-once + outcome-at-least-once-report。
 */
export class WindowBootstrapAdapter {
  private readonly deliveries = new Map<string, DeliveryRecord>();
  private queue: WindowBootstrap[] = [];
  private processing = false;
  private disposed = false;
  private started = false;
  private unlisten: (() => void) | null = null;

  constructor(
    private readonly ports: WindowBootstrapPorts,
    private readonly action: (bootstrap: WindowBootstrap) => Promise<BootstrapActionOutcome>,
    private readonly hooks: BootstrapReportHooks = {},
  ) {}

  /** 启动:先订阅、再读快照(顺序是协议核心,不得调换)。
   * 重复调用稳定拒绝;snapshot 失败时卸载 listener 后原样上抛。 */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("WindowBootstrapAdapter.start() 已调用,不得重复启动");
    }
    this.started = true;
    this.unlisten = await this.ports.onBootstrap((bootstrap) => {
      this.enqueue(bootstrap);
    });
    try {
      const snapshot = await this.ports.readPendingSnapshot();
      for (const bootstrap of snapshot) {
        this.enqueue(bootstrap);
      }
    } catch (error) {
      // 不泄漏 listener:snapshot 失败即卸载,再原样上抛
      await this.dispose();
      throw error;
    }
  }

  /**
   * 停止接收新交付。已开始的 action 会继续完成并缓存 outcome:
   * host 必须拿到终态才能 ack/释放 intent,中途丢弃会让 intent 永久
   * 悬挂(显式策略,A1 子规格 §4.4)。
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.unlisten?.();
    this.unlisten = null;
  }

  /** 事件/快照双达入口:processing/report-pending/reported 语义分发。 */
  private enqueue(bootstrap: WindowBootstrap): void {
    if (this.disposed) return; // dispose 后忽略新 delivery
    const record = this.deliveries.get(bootstrap.deliveryId);
    if (record) {
      if (record.stage === "report-pending" && record.outcome) {
        // 重发:只重报缓存 outcome(action 不重跑)
        void this.report(bootstrap.deliveryId, record);
      }
      return; // processing(action 进行中)/ reported:去重
    }
    this.deliveries.set(bootstrap.deliveryId, { stage: "processing" });
    this.queue.push(bootstrap);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        if (this.disposed) break; // dispose 后不再开始新交付
        const bootstrap = this.queue.shift();
        if (!bootstrap) break;
        let outcome: BootstrapActionOutcome;
        try {
          // action 恰好一次;resolve 前零 report(P2)
          outcome = await this.action(bootstrap);
        } catch (error) {
          // action reject → retryable-error(原因可见,不吞、不自动重试)
          outcome = {
            kind: "retryable-error",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        const record = this.deliveries.get(bootstrap.deliveryId);
        if (!record) continue; // 防御:不该发生
        record.outcome = outcome; // 缓存:host 确认前不丢
        record.stage = "report-pending";
        await this.report(bootstrap.deliveryId, record);
      }
    } finally {
      this.processing = false;
    }
  }

  /** 一次 report 尝试:成功 → reported;失败 → 保留 pending 并可观察。 */
  private async report(deliveryId: string, record: DeliveryRecord): Promise<void> {
    const outcome = record.outcome;
    if (!outcome) return;
    try {
      await this.ports.reportOutcome(deliveryId, outcome);
      if (record.stage === "report-pending") {
        record.stage = "reported";
      }
    } catch (error) {
      // A1-F2:不吞错、不重跑 action;pending 保留待重报
      this.hooks.onReportError?.(deliveryId, error);
    }
  }

  /** 显式重报通道(transport reconnect / 窗口 ready 接线调用):
   *  每个 pending delivery 至多重报一次,不自旋。 */
  async retryPendingReports(): Promise<void> {
    for (const [deliveryId, record] of this.deliveries) {
      if (record.stage === "report-pending" && record.outcome) {
        await this.report(deliveryId, record);
      }
    }
  }

  /** 当前待重报交付的只读快照(可观察的稳定 error snapshot)。 */
  pendingReports(): PendingReport[] {
    const out: PendingReport[] = [];
    for (const [deliveryId, record] of this.deliveries) {
      if (record.stage === "report-pending" && record.outcome) {
        out.push({ deliveryId, outcome: record.outcome });
      }
    }
    return out;
  }

  /** 已见交付的阶段(测试/诊断)。 */
  stageOf(deliveryId: string): DeliveryStage | undefined {
    return this.deliveries.get(deliveryId)?.stage;
  }
}
