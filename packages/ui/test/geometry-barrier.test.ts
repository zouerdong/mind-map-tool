import { describe, expect, it } from "vitest";
import { emptyDocument, DocumentSession } from "@mindmap/core";
import { GeometryBarrier } from "../src/canvas/geometry-barrier.js";
import type { FontResolver } from "@mindmap/export/src/layout.js";

const FALLBACK_FONTS: FontResolver = {
  regular: () => ({ advance: () => 10, ascentRatio: 0.8 }),
  bold: () => ({ advance: () => 10, ascentRatio: 0.8 }),
};

const REAL_FONTS: FontResolver = {
  regular: () => ({ advance: () => 25, ascentRatio: 0.8 }),
  bold: () => ({ advance: () => 25, ascentRatio: 0.8 }),
};

describe("PRC-025 GeometryBarrier 单元测试", () => {
  it("pending 期间阻断 fallback 尺寸入库；ready 后恰好以真实尺寸提交一次", async () => {
    const session = new DocumentSession(emptyDocument());
    let state: "pending" | "ready" | "failed" = "pending";
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });

    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => state,
      whenMetricsReady: () => readyPromise,
      getFallbackFonts: () => FALLBACK_FONTS,
    });

    // 1. ready 前加入 create-node 和 edit-text
    await barrier.enqueue({
      kind: "create-node",
      id: "n-1",
      position: { x: 100, y: 100 },
      text: "测试",
    });

    // 尚未 ready：session 中不得有节点
    expect(session.current.document.document.nodes).toHaveLength(0);
    expect(barrier.hasPendingIntents()).toBe(true);

    // 2. 模拟真实字体就绪
    state = "ready";
    resolveReady(REAL_FONTS);
    await barrier.flush();

    // 3. session 中有节点，尺寸必须是 REAL_FONTS 计算的尺寸，绝非 FALLBACK_FONTS 尺寸
    expect(session.current.document.document.nodes).toHaveLength(1);
    const node = session.current.document.document.nodes[0]!;
    // FALLBACK 宽度: 2 * 10 = 20 + 20 = 40
    // REAL 宽度: 2 * 25 = 50 + 20 = 70
    expect(node.size.width).toBe(70);
    expect(node.size.width).not.toBe(40);
    expect(barrier.hasPendingIntents()).toBe(false);

    // 4. 单次 undo 撤销
    expect(session.canUndo).toBe(true);
    session.undo();
    expect(session.current.document.document.nodes).toHaveLength(0);
  });

  it("已载入旧文档在 ready flush 时不得无命令改写既有尺寸", async () => {
    const doc = emptyDocument();
    doc.document.nodes.push({
      id: "legacy-1",
      text: "历史遗留",
      position: { x: 50, y: 50 },
      size: { width: 123, height: 45 },
    });
    const session = new DocumentSession(doc);
    expect(session.isDirty).toBe(false);

    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "ready",
      whenMetricsReady: () => Promise.resolve(REAL_FONTS),
      getFallbackFonts: () => REAL_FONTS,
    });

    await barrier.flush();

    // 既有节点尺寸分毫不变，文档保持 clean
    expect(session.current.document.document.nodes[0]!.size).toEqual({ width: 123, height: 45 });
    expect(session.isDirty).toBe(false);
    expect(session.canUndo).toBe(false);
  });

  it("字体加载失败时 fail-closed：不提交残缺尺寸，向上抛出错误", async () => {
    const session = new DocumentSession(emptyDocument());
    const err = new Error("网络超时");

    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => Promise.reject(err),
      getFallbackFonts: () => FALLBACK_FONTS,
    });

    await barrier.enqueue({
      kind: "create-node",
      id: "n-err",
      position: { x: 0, y: 0 },
      text: "失败测试",
    });

    await expect(barrier.flush()).rejects.toThrow("网络超时");
    // session 必须没有节点入库
    expect(session.current.document.document.nodes).toHaveLength(0);
  });

  it("组件卸载/销毁后旧 promise 解决时不写入 session", async () => {
    const session = new DocumentSession(emptyDocument());
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });

    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => readyPromise,
      getFallbackFonts: () => FALLBACK_FONTS,
    });

    await barrier.enqueue({
      kind: "create-node",
      id: "n-disposed",
      position: { x: 0, y: 0 },
      text: "销毁测试",
    });

    barrier.dispose();
    resolveReady(REAL_FONTS);
    await barrier.flush();

    // dispose 后 session 不应被写入
    expect(session.current.document.document.nodes).toHaveLength(0);
  });
});
