// LaunchRouter 状态机测试（MM-060 步骤⑨⑩：early events、activation、
// 等价路径 dedupe、连续多文件、ack 幂等）。

import { describe, expect, it } from "vitest";
import {
  decideWindowAction,
  intentDedupeKey,
  LaunchRouter,
} from "../src/lifecycle/launch-router.js";
import type { LaunchIntentPayload, WindowAction, WindowContext } from "../src/index.js";

let seq = 0;
const fileIntent = (path: string): LaunchIntentPayload => ({
  intentId: `i-${++seq}`,
  kind: "open-file",
  canonicalPath: path,
  receivedAt: seq,
});
const activationIntent = (): LaunchIntentPayload => ({
  intentId: `i-${++seq}`,
  kind: "activation",
  canonicalPath: null,
  receivedAt: seq,
});

describe("decideWindowAction", () => {
  const windows = (n: number, states: Partial<WindowContext>[]): WindowContext[] =>
    states.slice(0, n).map((s, i) => ({
      windowId: s.windowId ?? `w${i}`,
      occupiedPath: s.occupiedPath ?? null,
      dirty: s.dirty ?? false,
    }));

  it("无窗口时 open-file 进新窗口", () => {
    const a = decideWindowAction(fileIntent("/a.mm"), []);
    expect(a).toEqual({ type: "open-new-window", canonicalPath: "/a.mm" });
  });

  it("clean 空闲主窗口优先承载（带文件 cold start 无多余空窗）", () => {
    const a = decideWindowAction(fileIntent("/a.mm"), windows(1, [{}]));
    expect(a).toEqual({ type: "open-in-window", windowId: "w0", canonicalPath: "/a.mm" });
  });

  it("dirty 窗口不被占用，开新窗口", () => {
    const a = decideWindowAction(fileIntent("/b.mm"), windows(1, [{ dirty: true }]));
    expect(a).toEqual({ type: "open-new-window", canonicalPath: "/b.mm" });
  });

  it("已承载同文件的窗口被聚焦（重复打开）", () => {
    const a = decideWindowAction(fileIntent("/a.mm"), windows(1, [{ occupiedPath: "/a.mm" }]));
    expect(a).toEqual({ type: "focus-existing", windowId: "w0" });
  });

  it("clean 但已承载其他文档的窗口不接收新文件", () => {
    const a = decideWindowAction(fileIntent("/b.mm"), windows(1, [{ occupiedPath: "/a.mm" }]));
    expect(a).toEqual({ type: "open-new-window", canonicalPath: "/b.mm" });
  });

  it("activation：无窗口 → 新建空白；有窗口 → 不动作（不碰 dirty 窗）", () => {
    expect(decideWindowAction(activationIntent(), [])).toEqual({ type: "new-blank-window" });
    expect(decideWindowAction(activationIntent(), windows(1, [{ dirty: true }]))).toEqual({
      type: "none",
    });
  });
});

describe("LaunchRouter", () => {
  const setup = (windows: WindowContext[]) => {
    const actions: { action: WindowAction; intentId: string }[] = [];
    const acks: string[] = [];
    const router = new LaunchRouter(
      {
        onWindowAction: (action, intent) => actions.push({ action, intentId: intent.intentId }),
        onAck: (id) => acks.push(id),
      },
      () => windows,
    );
    return { router, actions, acks };
  };

  it("AppReady 前缓存 early intents，ready 后统一 flush", () => {
    const { router, actions, acks } = setup([
      { windowId: "main", occupiedPath: null, dirty: false },
    ]);
    const early = fileIntent("/early.mm");
    router.onIntent(early);
    expect(actions).toHaveLength(0);
    router.markAppReady();
    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toEqual({
      type: "open-in-window",
      windowId: "main",
      canonicalPath: "/early.mm",
    });
    expect(acks).toEqual([early.intentId]);
  });

  it("连续多文件：第一个进空闲主窗口，第二个开新窗口", () => {
    let windows: WindowContext[] = [{ windowId: "main", occupiedPath: null, dirty: false }];
    const actions: WindowAction[] = [];
    const router = new LaunchRouter(
      {
        onWindowAction: (a) => {
          actions.push(a);
          if (a.type === "open-in-window")
            windows = [{ windowId: a.windowId, occupiedPath: a.canonicalPath, dirty: false }];
          if (a.type === "open-new-window")
            windows = [
              ...windows,
              { windowId: "new", occupiedPath: a.canonicalPath, dirty: false },
            ];
        },
        onAck: () => {},
      },
      () => windows,
    );
    router.markAppReady();
    router.onIntent(fileIntent("/one.mm"));
    router.onIntent(fileIntent("/two.mm"));
    expect(actions.map((a) => a.type)).toEqual(["open-in-window", "open-new-window"]);
  });

  it("pending 期间等价重复 intent 合并（仍 ack）；ready 后同 intentId 重放不重复路由", () => {
    const { router, actions, acks } = setup([]);
    const first = fileIntent("/same.mm");
    router.onIntent(first);
    const dup: LaunchIntentPayload = { ...fileIntent("/same.mm"), intentId: "dup" };
    expect(router.onIntent(dup)).toBe(false); // 未就绪期间合并
    router.markAppReady();
    expect(actions).toHaveLength(1);
    expect(acks).toEqual([dup.intentId, first.intentId]);
    // host 重发（ack 丢失）同 intentId → intentId 幂等兜底
    router.onIntent({ ...first });
    expect(actions).toHaveLength(1);
  });

  it("ack 幂等：同 intentId 重放不重复路由", () => {
    const { router, actions } = setup([]);
    router.markAppReady();
    const intent = fileIntent("/x.mm");
    router.onIntent(intent);
    router.onIntent({ ...intent }); // host 重发（ack 丢失场景）
    expect(actions).toHaveLength(1);
  });

  it("activation 不参与路径 dedupe（可多次到达）", () => {
    const { router, actions } = setup([{ windowId: "main", occupiedPath: null, dirty: false }]);
    router.markAppReady();
    router.onIntent(activationIntent());
    router.onIntent(activationIntent());
    expect(actions.map((a) => a.action.type)).toEqual(["none", "none"]);
    expect(intentDedupeKey(activationIntent())).toBeNull();
  });

  it("markAppReady 幂等：重复调用不再触发已 flush 的 intent", () => {
    const { router, actions } = setup([]);
    router.onIntent(fileIntent("/a.mm"));
    router.markAppReady();
    router.markAppReady();
    expect(actions).toHaveLength(1);
  });
});
