// WindowBootstrapAdapter 状态机测试（MRT-004A 任务卡 §7 P1～P4）：
// listener-first、双达去重、action 终态前零 report、reject 转 retryable、
// dispose 语义。纯 fake port，不触达 Tauri。

import { describe, expect, it } from "vitest";
import {
  WindowBootstrapAdapter,
  type BootstrapActionOutcome,
  type WindowBootstrap,
  type WindowBootstrapPorts,
} from "../src/lifecycle/window-bootstrap.js";

// Y1:判别联合的类型级验证(编译期即约束 open-path 形状;Wave 2 起
// canonicalPath 为可选展示投影——打开一律经 deliveryId)。
type AssertOpenPathShape = WindowBootstrap extends
  { kind: "open-path"; canonicalPath?: string } | { kind: "blank" }
  ? true
  : never;
const _assertOpenPathShape: AssertOpenPathShape = true;
void _assertOpenPathShape;

const openBootstrap = (deliveryId: string, path = "/a.mm"): WindowBootstrap => ({
  deliveryId,
  intentId: `intent-${deliveryId}`,
  kind: "open-path",
  canonicalPath: path,
});

/** 可编程 fake port：记录订阅时序与回报。 */
function makePorts() {
  const state = {
    listenerInstalledAt: 0,
    snapshotReadAt: 0,
    tick: 0,
    handlers: new Set<(b: WindowBootstrap) => void>(),
    reports: [] as { deliveryId: string; outcome: BootstrapActionOutcome }[],
    snapshot: [] as WindowBootstrap[],
  };
  const ports: WindowBootstrapPorts = {
    onBootstrap(handler) {
      state.handlers.add(handler);
      state.listenerInstalledAt = ++state.tick;
      return Promise.resolve(() => state.handlers.delete(handler));
    },
    readPendingSnapshot() {
      state.snapshotReadAt = ++state.tick;
      return Promise.resolve(state.snapshot);
    },
    reportOutcome(deliveryId, outcome) {
      state.reports.push({ deliveryId, outcome });
      return Promise.resolve();
    },
  };
  return {
    ports,
    state,
    emit(b: WindowBootstrap) {
      for (const h of state.handlers) h(b);
    },
  };
}

describe("listener-first 顺序（RED-2 的回归）", () => {
  it("先安装 listener 再读快照", async () => {
    const f = makePorts();
    const adapter = new WindowBootstrapAdapter(f.ports, () => Promise.resolve({ kind: "opened" }));
    await adapter.start();
    expect(f.state.listenerInstalledAt).toBeLessThan(f.state.snapshotReadAt);
  });

  it("listener 注册后、快照返回前到达的事件不丢失（恰好执行一次）", async () => {
    const f = makePorts();
    const acted: string[] = [];
    // 快照读取挂起：事件在 listener 已装、快照未返回的间隙到达
    let resolveSnapshot: (v: WindowBootstrap[]) => void = () => {};
    f.ports.readPendingSnapshot = () =>
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      });
    const adapter = new WindowBootstrapAdapter(f.ports, async (b) => {
      acted.push(b.deliveryId);
      return { kind: "opened" };
    });
    const started = adapter.start();
    await Promise.resolve(); // 等 listener 安装完成
    f.emit(openBootstrap("d-gap"));
    resolveSnapshot([]);
    await started;
    await adapter.dispose();
    expect(acted).toEqual(["d-gap"]);
    expect(f.state.reports.map((r) => r.deliveryId)).toEqual(["d-gap"]);
  });
});

describe("P1 事件与快照双达去重", () => {
  it("同一 deliveryId 只执行一次 action、只 report 一次", async () => {
    const f = makePorts();
    const acted: string[] = [];
    const adapter = new WindowBootstrapAdapter(f.ports, async (b) => {
      acted.push(b.deliveryId);
      return { kind: "opened" };
    });
    f.state.snapshot = [openBootstrap("d-1")];
    await adapter.start();
    f.emit(openBootstrap("d-1")); // 快照已处理过的 delivery 再以事件到达
    f.emit(openBootstrap("d-1"));
    await adapter.dispose();
    // A1 最终语义:action 恰好一次;report 至少一次且内容一致
    // (report-pending 期间的重发按协议重报缓存 outcome;host 幂等去重)
    expect(acted).toEqual(["d-1"]);
    expect(f.state.reports.length).toBeGreaterThanOrEqual(1);
    for (const r of f.state.reports) {
      expect(r).toEqual({ deliveryId: "d-1", outcome: { kind: "opened" } });
    }
  });

  it("不同 deliveryId 各自执行（顺序稳定）", async () => {
    const f = makePorts();
    const acted: string[] = [];
    const adapter = new WindowBootstrapAdapter(f.ports, async (b) => {
      acted.push(b.deliveryId);
      return { kind: "opened" };
    });
    f.state.snapshot = [openBootstrap("d-1"), openBootstrap("d-2", "/b.mm")];
    await adapter.start();
    // 等串行 drain 完成(Dispose 语义:未开始的 queue 交付会被丢弃,
    // 由 host Destroyed 恢复路径承接——T4;此处验证的是正常全量执行)
    await new Promise((r) => setTimeout(r, 0));
    await adapter.dispose();
    expect(acted).toEqual(["d-1", "d-2"]);
    expect(f.state.reports).toHaveLength(2);
  });
});

describe("P2 action 未终态时零 report", () => {
  it("action Promise pending 时不得 report", async () => {
    const f = makePorts();
    let resolveAction: (o: BootstrapActionOutcome) => void = () => {};
    const adapter = new WindowBootstrapAdapter(
      f.ports,
      () =>
        new Promise<BootstrapActionOutcome>((resolve) => {
          resolveAction = resolve;
        }),
    );
    f.state.snapshot = [openBootstrap("d-1")];
    await adapter.start();
    await new Promise((r) => setTimeout(r, 0)); // 让 drain 进入 await action
    expect(f.state.reports).toEqual([]);
    resolveAction({ kind: "opened" });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.state.reports).toHaveLength(1);
    await adapter.dispose();
  });
});

describe("P4 action reject 转 retryable-error", () => {
  it("reject 的原因可见、恰好一次 report、不自动重试", async () => {
    const f = makePorts();
    let calls = 0;
    const adapter = new WindowBootstrapAdapter(f.ports, async () => {
      calls += 1;
      throw new Error("decode failed");
    });
    f.state.snapshot = [openBootstrap("d-1")];
    await adapter.start();
    await adapter.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    expect(f.state.reports).toEqual([
      { deliveryId: "d-1", outcome: { kind: "retryable-error", reason: "decode failed" } },
    ]);
  });

  it("非 Error 抛出值字符串化，不吞信息", async () => {
    const f = makePorts();
    const adapter = new WindowBootstrapAdapter(f.ports, async () => {
      throw "disk full"; // eslint-disable-line no-throw-literal
    });
    f.state.snapshot = [openBootstrap("d-2")];
    await adapter.start();
    await adapter.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.state.reports[0]?.outcome).toEqual({
      kind: "retryable-error",
      reason: "disk full",
    });
  });
});

describe("dispose 语义", () => {
  it("dispose 后忽略新 delivery；已开始的 action 仍完成并 report", async () => {
    const f = makePorts();
    let resolveAction: (o: BootstrapActionOutcome) => void = () => {};
    const adapter = new WindowBootstrapAdapter(
      f.ports,
      () =>
        new Promise<BootstrapActionOutcome>((resolve) => {
          resolveAction = resolve;
        }),
    );
    f.state.snapshot = [openBootstrap("d-inflight")];
    await adapter.start();
    await new Promise((r) => setTimeout(r, 0)); // action 进行中
    await adapter.dispose();
    f.emit(openBootstrap("d-after-dispose"));
    expect(adapter.stageOf("d-after-dispose")).toBeUndefined();
    resolveAction({ kind: "opened" });
    await new Promise((r) => setTimeout(r, 0));
    // 显式策略：进行中的 action 完成后仍 report（host 需要终态）
    expect(f.state.reports).toEqual([{ deliveryId: "d-inflight", outcome: { kind: "opened" } }]);
  });

  it("dispose 卸载 listener", async () => {
    const f = makePorts();
    const adapter = new WindowBootstrapAdapter(f.ports, () => Promise.resolve({ kind: "opened" }));
    await adapter.start();
    await adapter.dispose();
    expect(f.state.handlers.size).toBe(0);
    f.emit(openBootstrap("d-x"));
    expect(adapter.stageOf("d-x")).toBeUndefined();
  });
});

describe("blank 交付", () => {
  it("activation blank bootstrap 正常执行并回报 blank-created", async () => {
    const f = makePorts();
    const acted: WindowBootstrap[] = [];
    const adapter = new WindowBootstrapAdapter(f.ports, async (b) => {
      acted.push(b);
      return { kind: "blank-created" };
    });
    f.state.snapshot = [{ deliveryId: "d-blank", kind: "blank" }];
    await adapter.start();
    await adapter.dispose();
    expect(acted).toEqual([{ deliveryId: "d-blank", kind: "blank" }]);
    expect(f.state.reports).toEqual([
      { deliveryId: "d-blank", outcome: { kind: "blank-created" } },
    ]);
  });
});

describe("A1 红灯:reportOutcome 失败后的可靠重报", () => {
  it("B2/B3:report 首次失败后,同 delivery 重发必须重报缓存 outcome 而非丢弃", async () => {
    const f = makePorts();
    let reportCalls = 0;
    let failFirst = true;
    f.ports.reportOutcome = async (deliveryId, outcome) => {
      reportCalls += 1;
      if (failFirst) {
        failFirst = false;
        throw new Error("ipc disconnected");
      }
      f.state.reports.push({ deliveryId, outcome });
    };
    let actionCalls = 0;
    const adapter = new WindowBootstrapAdapter(f.ports, async () => {
      actionCalls += 1;
      return { kind: "opened" };
    });
    f.state.snapshot = [openBootstrap("d-1")];
    await adapter.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(reportCalls).toBe(1);
    // 同 delivery 重发(事件/快照重达):不得丢 outcome
    f.emit(openBootstrap("d-1"));
    await new Promise((r) => setTimeout(r, 0));
    expect(actionCalls).toBe(1);
    expect(reportCalls).toBe(2);
    expect(f.state.reports).toEqual([{ deliveryId: "d-1", outcome: { kind: "opened" } }]);
    await adapter.dispose();
  });

  it("B2:report 失败必须可观察(不得空 catch 吞掉)", async () => {
    const f = makePorts();
    f.ports.reportOutcome = async () => {
      throw new Error("ipc disconnected");
    };
    const failures: unknown[] = [];
    const adapter = new WindowBootstrapAdapter(f.ports, async () => ({ kind: "opened" }), {
      onReportError: (_id, error) => failures.push(error),
    });
    f.state.snapshot = [openBootstrap("d-2")];
    await adapter.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(failures.length).toBe(1);
    expect(adapter.pendingReports()).toHaveLength(1);
    await adapter.dispose();
  });

  it("B4:retryPendingReports 对每个 pending 至多重报一次,成功后 reported", async () => {
    const f = makePorts();
    let reportCalls = 0;
    let failFirst = true;
    f.ports.reportOutcome = async (deliveryId, outcome) => {
      reportCalls += 1; // 计数含失败尝试(重报语义的关键度量)
      if (failFirst) {
        failFirst = false;
        throw new Error("down");
      }
      f.state.reports.push({ deliveryId, outcome });
    };
    const adapter = new WindowBootstrapAdapter(f.ports, async () => ({ kind: "opened" }));
    f.state.snapshot = [openBootstrap("d-3")];
    await adapter.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.pendingReports()).toHaveLength(1);
    await adapter.retryPendingReports();
    expect(reportCalls).toBe(2);
    expect(adapter.pendingReports()).toHaveLength(0);
    // 已 reported 的交付再次 retry 不重报
    await adapter.retryPendingReports();
    expect(reportCalls).toBe(2);
    await adapter.dispose();
  });

  it("B5:action reject + report 失败 → retryable outcome 不丢,action 不重跑", async () => {
    const f = makePorts();
    f.ports.reportOutcome = async () => {
      throw new Error("down");
    };
    let actionCalls = 0;
    const adapter = new WindowBootstrapAdapter(f.ports, async () => {
      actionCalls += 1;
      throw new Error("decode failed");
    });
    f.state.snapshot = [openBootstrap("d-4")];
    await adapter.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.pendingReports()).toEqual([
      { deliveryId: "d-4", outcome: { kind: "retryable-error", reason: "decode failed" } },
    ]);
    f.emit(openBootstrap("d-4"));
    await new Promise((r) => setTimeout(r, 0));
    expect(actionCalls).toBe(1);
    expect(adapter.pendingReports()).toHaveLength(1);
    await adapter.dispose();
  });

  it("B6:start 重复调用必须稳定拒绝且不泄漏第二个 listener;snapshot 失败须清理 listener", async () => {
    const f = makePorts();
    const adapter = new WindowBootstrapAdapter(f.ports, () => Promise.resolve({ kind: "opened" }));
    await adapter.start();
    await expect(adapter.start()).rejects.toThrow();
    expect(f.state.handlers.size).toBe(1);

    const f2 = makePorts();
    f2.ports.readPendingSnapshot = () => Promise.reject(new Error("ipc down"));
    const adapter2 = new WindowBootstrapAdapter(f2.ports, () =>
      Promise.resolve({ kind: "opened" }),
    );
    await expect(adapter2.start()).rejects.toThrow("ipc down");
    expect(f2.state.handlers.size).toBe(0);
  });
});
