// MRT-003A：close 协议协调器（CloseRequestGate）契约测试。
// 003A 阶段全部红（骨架抛错）；003C 实现后转绿。

import { describe, expect, it } from "vitest";
import { IPC_COMMANDS, IPC_EVENTS } from "../ipc/types.js";
import { PlatformError } from "../file/errors.js";
import { CloseRequestGate, toClosePlatformError, type CloseTransport } from "./close-protocol.js";

/** 记录调用顺序与注入行为的 fake 传输。 */
function fakeTransport(
  opts: {
    pending?: { requestId: string } | null;
    resolveError?: unknown;
  } = {},
): CloseTransport & { order: string[]; handler: (p: unknown) => void } {
  const order: string[] = [];
  let handler: (p: unknown) => void = () => {};
  const transport: CloseTransport & { order: string[]; handler: (p: unknown) => void } = {
    order,
    get handler() {
      return handler;
    },
    async listen(event, h) {
      order.push(`listen:${event}`);
      handler = h;
      return () => {
        order.push("unlisten");
      };
    },
    async pendingCloseRequest() {
      order.push("snapshot");
      return opts.pending ?? null;
    },
    async resolveCloseRequest(requestId, disposition) {
      order.push(`resolve:${requestId}:${disposition}`);
      if (opts.resolveError) throw opts.resolveError;
    },
  };
  return transport;
}

describe("CloseRequestGate：订阅先于快照与去重（MRT-003A / A1）", () => {
  it("A1：start 先 listen 后读快照；快照中的请求不丢、恰好送达一次", async () => {
    const transport = fakeTransport({ pending: { requestId: "r-early" } });
    const gate = new CloseRequestGate(transport);
    const received: string[] = [];
    await gate.start((r) => received.push(r.requestId));

    // ★ 顺序契约：订阅必须先于快照（listener 竞态补偿的前提）
    expect(transport.order[0]).toBe(`listen:${IPC_EVENTS.closeRequested}`);
    expect(transport.order[1]).toBe("snapshot");
    // ★ 快照请求被补回
    expect(received).toEqual(["r-early"]);
  });

  it("A1：event 与 snapshot 双达同一 requestId 只处理一次", async () => {
    const transport = fakeTransport({ pending: { requestId: "r-dup" } });
    const gate = new CloseRequestGate(transport);
    const received: string[] = [];
    await gate.start((r) => received.push(r.requestId));

    const handler = transport.handler;
    handler({ requestId: "r-dup" }); // listener 迟到送达同一请求
    handler({ requestId: "r-dup" }); // 再一次重放
    expect(received).toEqual(["r-dup"]); // ★ 恰好一次
  });

  it("不同 requestId 各自送达一次（新请求不被旧去重吞掉）", async () => {
    const transport = fakeTransport();
    const gate = new CloseRequestGate(transport);
    const received: string[] = [];
    await gate.start((r) => received.push(r.requestId));

    const handler = transport.handler;
    handler({ requestId: "r-1" });
    handler({ requestId: "r-2" });
    handler({ requestId: "r-1" });
    expect(received).toEqual(["r-1", "r-2"]);
  });

  it("stop 后停止订阅，后续事件不再送达", async () => {
    const transport = fakeTransport();
    const gate = new CloseRequestGate(transport);
    const received: string[] = [];
    await gate.start((r) => received.push(r.requestId));
    await gate.stop();
    expect(transport.order).toContain("unlisten");

    const handler = transport.handler;
    handler({ requestId: "r-after-stop" });
    expect(received).toEqual([]);
  });
});

describe("CloseRequestGate：resolve 映射（MRT-003A / R3 前端面）", () => {
  it("resolve 转发命令名与参数（requestId + disposition）", async () => {
    const transport = fakeTransport();
    const gate = new CloseRequestGate(transport);
    await gate.start(() => {});
    await gate.resolve("r-1", "saved");
    expect(transport.order).toContain("resolve:r-1:saved");
    expect(IPC_COMMANDS.resolveCloseRequest).toBe("platform_resolve_close_request");
  });

  it("host 拒绝映射为 PlatformError(INVALID_CLOSE_REQUEST)", async () => {
    const transport = fakeTransport({
      resolveError: { code: "INVALID_CLOSE_REQUEST", message: "请求不存在或已消费" },
    });
    const gate = new CloseRequestGate(transport);
    await gate.start(() => {});
    await expect(gate.resolve("forged", "saved")).rejects.toMatchObject({
      code: "INVALID_CLOSE_REQUEST",
    });
    await expect(gate.resolve("forged", "saved")).rejects.toBeInstanceOf(PlatformError);
  });

  it("host close 失败映射为 PlatformError(WINDOW_CLOSE_FAILED)", async () => {
    const transport = fakeTransport({
      resolveError: { code: "WINDOW_CLOSE_FAILED", message: "close 失败" },
    });
    const gate = new CloseRequestGate(transport);
    await gate.start(() => {});
    await expect(gate.resolve("r-1", "discarded")).rejects.toMatchObject({
      code: "WINDOW_CLOSE_FAILED",
    });
  });
});

describe("toClosePlatformError（映射纯函数）", () => {
  it("保持既有 PlatformError 原样", () => {
    const e = new PlatformError("INVALID_CLOSE_REQUEST", "x");
    expect(toClosePlatformError(e)).toBe(e);
  });

  it("未知形状归一为 INVALID_CLOSE_REQUEST（不退化为任意字符串）", () => {
    expect(toClosePlatformError("boom")).toBeInstanceOf(PlatformError);
    expect(toClosePlatformError("boom").code).toBe("INVALID_CLOSE_REQUEST");
  });
});
