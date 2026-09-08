import { describe, expect, it, vi } from "vitest";
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

  it("字体加载失败时 fail-closed：后台自动 flush 失败不提交、保留意图；下次显式 flush 重试成功", async () => {
    const session = new DocumentSession(emptyDocument());
    const err = new Error("网络超时");
    const errors: unknown[] = [];
    let attempt = 0;

    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => (++attempt === 1 ? Promise.reject(err) : Promise.resolve(REAL_FONTS)),
      getFallbackFonts: () => FALLBACK_FONTS,
      onError: (error) => errors.push(error),
    });

    // PRR-066：enqueue 自动启动的后台 flush 触发第一次加载并失败——
    // 错误经 onError 呈现，无未处理拒绝，意图保留。
    await barrier.enqueue({
      kind: "create-node",
      id: "n-err",
      position: { x: 0, y: 0 },
      text: "失败测试",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain("网络超时");
    // session 必须没有节点入库
    expect(session.current.document.document.nodes).toHaveLength(0);
    expect(barrier.hasPendingIntents()).toBe(true);

    // 用户下一次显式保存触发重试后，原意图仍可用真实字体完成提交。
    await barrier.flush();
    expect(session.current.document.document.nodes[0]?.text).toBe("失败测试");
    expect(session.current.document.document.nodes[0]?.size.width).toBe(120);
    expect(barrier.hasPendingIntents()).toBe(false);
  });

  it("显式 flush 的字体重试仍失败时向上抛出（Save 语义：阻断并可见）", async () => {
    const session = new DocumentSession(emptyDocument());
    const err = new Error("二次失败");
    let attempt = 0;
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => (++attempt <= 2 ? Promise.reject(err) : Promise.resolve(REAL_FONTS)),
      getFallbackFonts: () => FALLBACK_FONTS,
      onError: () => {
        /* 显式 flush 失败由 rejects 断言；后台失败由本空实现消化 */
      },
    });
    await barrier.enqueue({
      kind: "create-node",
      id: "n-err2",
      position: { x: 0, y: 0 },
      text: "二次失败测试",
    });
    await new Promise((resolve) => setTimeout(resolve, 0)); // 后台 flush 失败（attempt 1）
    await expect(barrier.flush()).rejects.toThrow("二次失败"); // attempt 2
    expect(session.current.document.document.nodes).toHaveLength(0);
    expect(barrier.hasPendingIntents()).toBe(true);
    await barrier.flush(); // attempt 3 成功
    expect(session.current.document.document.nodes[0]?.text).toBe("二次失败测试");
  });

  it("failed 状态继续编辑时保留意图且不返回未处理拒绝，也不自动重试字体加载", async () => {
    const session = new DocumentSession(emptyDocument());
    let state: "failed" | "ready" = "failed";
    const errors: unknown[] = [];
    let readyCalls = 0;
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => state,
      whenMetricsReady: () => {
        readyCalls += 1;
        return Promise.resolve(REAL_FONTS);
      },
      getFallbackFonts: () => FALLBACK_FONTS,
      onError: (error) => errors.push(error),
    });

    await expect(
      barrier.enqueue({
        kind: "create-node",
        id: "n-retry",
        position: { x: 0, y: 0 },
        text: "保留",
      }),
    ).resolves.toBeUndefined();
    expect(session.current.document.document.nodes).toHaveLength(0);
    expect(barrier.hasPendingIntents()).toBe(true);
    expect(errors).toHaveLength(1);
    // PRR-066：failed 态不自动重试——重试留给下次显式 flush（保存语义）
    expect(readyCalls).toBe(0);

    state = "ready";
    await barrier.flush();
    expect(session.current.document.document.nodes[0]?.text).toBe("保留");
  });

  it("并发 flush 共用一次 drain，不会重复提交同一意图", async () => {
    const session = new DocumentSession(emptyDocument());
    let resolveFonts!: (fonts: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((resolve) => {
      resolveFonts = resolve;
    });
    let readyCalls = 0;
    const errors: unknown[] = [];
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => {
        readyCalls += 1;
        return readyPromise;
      },
      getFallbackFonts: () => FALLBACK_FONTS,
      onError: (error) => errors.push(error),
    });

    await barrier.enqueue({
      kind: "create-node",
      id: "n-concurrent",
      position: { x: 0, y: 0 },
      text: "只提交一次",
    });
    const first = barrier.flush();
    const second = barrier.flush();
    resolveFonts(REAL_FONTS);
    await Promise.all([first, second]);

    expect(readyCalls).toBe(1);
    expect(errors).toHaveLength(0);
    expect(session.current.document.document.nodes).toHaveLength(1);
    expect(barrier.hasPendingIntents()).toBe(false);
  });

  it("create 提交期间同节点继续编辑时不会重复 CreateNode", async () => {
    const session = new DocumentSession(emptyDocument());
    const originalCommit = session.commit.bind(session);
    let injected = false;

    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => Promise.resolve(REAL_FONTS),
      getFallbackFonts: () => FALLBACK_FONTS,
    });
    vi.spyOn(session, "commit").mockImplementation((command) => {
      const result = originalCommit(command);
      if (command.kind === "CreateNode" && !injected) {
        injected = true;
        void barrier.enqueue({ kind: "edit-text", id: command.id, text: "最终文本" });
      }
      return result;
    });

    await barrier.enqueue({
      kind: "create-node",
      id: "n-create-edit",
      position: { x: 0, y: 0 },
      text: "初始文本",
    });
    await expect(barrier.flush()).resolves.toBeUndefined();

    expect(session.current.document.document.nodes).toHaveLength(1);
    expect(session.current.document.document.nodes[0]?.text).toBe("最终文本");
    expect(barrier.hasPendingIntents()).toBe(false);
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

describe("PRR-066 首个几何意图自动启动字体加载", () => {
  it("pending 首次 create：自动 flush，字体 ready 后恰好提交一次（无需等到 Save）", async () => {
    const session = new DocumentSession(emptyDocument());
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });
    let readyCalls = 0;
    const committed: number[] = [];
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => {
        readyCalls += 1;
        return readyPromise;
      },
      getFallbackFonts: () => FALLBACK_FONTS,
      onCommitted: () => committed.push(session.current.document.document.nodes.length),
    });

    await barrier.enqueue({
      kind: "create-node",
      id: "n-auto",
      position: { x: 10, y: 10 },
      text: "自动加载",
    });
    // enqueue 已自动触发一次字体加载（in-flight）
    expect(readyCalls).toBe(1);
    expect(session.current.document.document.nodes).toHaveLength(0);

    resolveReady(REAL_FONTS);
    await barrier.flush(); // 并入同一 in-flight（或已完成后 no-op）
    expect(session.current.document.document.nodes).toHaveLength(1);
    // REAL_FONTS 口径："自动加载" 4 字 × 25 + padding 20 = 120（fallback 会是 60）
    expect(session.current.document.document.nodes[0]!.size.width).toBe(120);
    expect(committed).toEqual([1]); // 恰好一次 onCommitted
    expect(barrier.hasPendingIntents()).toBe(false);
    expect(readyCalls).toBe(1); // 单一 in-flight，不重复加载
  });

  it("pending 首次 edit-text / set-kicker / set-document-font 同样自动启动一次 flush", async () => {
    const doc = emptyDocument();
    doc.document.nodes.push({
      id: "n-1",
      text: "原文本",
      position: { x: 0, y: 0 },
      size: { width: 40, height: 30 },
    });
    const session = new DocumentSession(doc);
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });
    let readyCalls = 0;
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => {
        readyCalls += 1;
        return readyPromise;
      },
      getFallbackFonts: () => FALLBACK_FONTS,
    });

    await barrier.enqueue({ kind: "edit-text", id: "n-1", text: "编辑文本" });
    await barrier.enqueue({ kind: "set-kicker", id: "n-1", kicker: "眉题" });
    await barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });

    // 三类意图在字体 ready 前共享同一 in-flight 加载（deferred 保证时序确定）
    expect(readyCalls).toBe(1);
    resolveReady(REAL_FONTS);
    await barrier.flush();
    expect(readyCalls).toBe(1);
    expect(session.current.document.document.nodes[0]!.text).toBe("编辑文本");
    expect(session.current.document.document.nodes[0]!.kicker).toBe("眉题");
    expect(session.current.document.document.font).toBe("lxgw-wenkai");
    expect(barrier.hasPendingIntents()).toBe(false);
  });

  it("enqueue 返回已解决 promise：后台 flush 失败不向调用方制造 rejection", async () => {
    const session = new DocumentSession(emptyDocument());
    let rejectReady!: (error: Error) => void;
    const readyPromise = new Promise<FontResolver>((_, rej) => {
      rejectReady = rej;
    });
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => readyPromise,
      getFallbackFonts: () => FALLBACK_FONTS,
      onError: () => {
        /* 消化呈现路径；断言聚焦 enqueue 语义 */
      },
    });
    await expect(
      barrier.enqueue({ kind: "create-node", id: "n-bg", position: { x: 0, y: 0 }, text: "后台" }),
    ).resolves.toBeUndefined();
    rejectReady(new Error("后台失败"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 意图仍在，等待显式 flush 重试
    expect(barrier.hasPendingIntents()).toBe(true);
  });

  it("空队列 flush 不触发字体加载（clean 文档的 Save 不预热导出资源）", async () => {
    const session = new DocumentSession(emptyDocument());
    let readyCalls = 0;
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => {
        readyCalls += 1;
        return Promise.resolve(REAL_FONTS);
      },
      getFallbackFonts: () => FALLBACK_FONTS,
    });
    await expect(barrier.flush()).resolves.toBeUndefined();
    expect(readyCalls).toBe(0);
  });

  it("显式 Save 与后台自动 flush 等待同一次 in-flight 字体加载", async () => {
    const session = new DocumentSession(emptyDocument());
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });
    let readyCalls = 0;
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => {
        readyCalls += 1;
        return readyPromise;
      },
      getFallbackFonts: () => FALLBACK_FONTS,
    });
    await barrier.enqueue({
      kind: "create-node",
      id: "n-save",
      position: { x: 0, y: 0 },
      text: "保存等待",
    });
    const saveFlush = barrier.flush(); // Save 到达：并入 in-flight，不另起加载
    resolveReady(REAL_FONTS);
    await saveFlush;
    expect(readyCalls).toBe(1);
    expect(session.current.document.document.nodes).toHaveLength(1);
    // 落盘内容必须源自真实字体（4 字 × 25 + 20 = 120；fallback 会是 60）
    expect(session.current.document.document.nodes[0]!.size.width).toBe(120);
  });
});

describe("PRR-040 set-document-font 意图", () => {
  /** 目标字体与当前字体度量不同的 resolver（模拟 Noto↔LXGW advance 差异）。 */
  const NOTO_FONTS: FontResolver = {
    regular: (fontId) => ({
      advance: () => (fontId === "lxgw-wenkai" ? 25 : 10),
      ascentRatio: 0.8,
    }),
    bold: (fontId) => ({
      advance: () => (fontId === "lxgw-wenkai" ? 25 : 10),
      ascentRatio: 0.8,
    }),
  };

  function seededSession() {
    const doc = emptyDocument();
    doc.document.nodes.push(
      {
        id: "n-1",
        text: "起点",
        position: { x: 0, y: 0 },
        size: { width: 40, height: 30 },
      },
      {
        id: "n-2",
        text: "目标",
        position: { x: 200, y: 0 },
        size: { width: 40, height: 30 },
      },
    );
    return new DocumentSession(doc);
  }

  it("ready 后用目标字体重测全部节点并作为单条命令提交；一步 undo 恢复旧字体与全部旧 size", async () => {
    const session = seededSession();
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "ready",
      whenMetricsReady: () => Promise.resolve(NOTO_FONTS),
      getFallbackFonts: () => NOTO_FONTS,
    });

    await barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });

    expect(session.current.document.document.font).toBe("lxgw-wenkai");
    // 目标字体 advance=25：两字宽度 50 + 20 padding（measureNodeVisual 口径）
    for (const node of session.current.document.document.nodes) {
      expect(node.size.width).toBeGreaterThan(40);
    }
    expect(session.current.document.document.nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
    expect(session.isDirty).toBe(true);

    // 一次 undo 恢复字体 + 全部旧 size
    session.undo();
    expect(session.current.document.document.font).toBe("noto-sans-sc");
    for (const node of session.current.document.document.nodes) {
      expect(node.size).toEqual({ width: 40, height: 30 });
    }
    // redo 一步恢复新值
    session.redo();
    expect(session.current.document.document.font).toBe("lxgw-wenkai");
  });

  it("pending 时保留意图不提交；ready flush 后一次原子提交", async () => {
    const session = seededSession();
    let state: "pending" | "ready" | "failed" = "pending";
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => state,
      whenMetricsReady: () => readyPromise,
      getFallbackFonts: () => NOTO_FONTS,
    });

    await barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });
    expect(session.current.document.document.font).toBe("noto-sans-sc");
    expect(barrier.hasPendingIntents()).toBe(true);

    state = "ready";
    resolveReady(NOTO_FONTS);
    await barrier.flush();
    expect(session.current.document.document.font).toBe("lxgw-wenkai");
    expect(barrier.hasPendingIntents()).toBe(false);
  });

  it("重复切换意图归并：未提交的旧意图被最新字体替换（一次 flush 只有一个 undo step）", async () => {
    const session = seededSession();
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => readyPromise,
      getFallbackFonts: () => NOTO_FONTS,
    });
    // deferred ready：两次切换都落在同一 in-flight 加载窗口内（PRR-066
    // 后 enqueue 会自动启动 flush，时序由 deferred 控制）
    await barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });
    await barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });
    expect(barrier.getPendingIntents()).toHaveLength(1);

    resolveReady(NOTO_FONTS);
    await barrier.flush();
    session.undo();
    expect(session.current.document.document.font).toBe("noto-sans-sc");
  });

  it("目标字体与当前字体相同时不产生命令（无用户可见变化零提交）", async () => {
    const session = seededSession();
    const before = session.current.identity;
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "ready",
      whenMetricsReady: () => Promise.resolve(NOTO_FONTS),
      getFallbackFonts: () => NOTO_FONTS,
    });
    await barrier.enqueue({ kind: "set-document-font", font: "noto-sans-sc" });
    expect(session.current.identity).toBe(before);
    expect(session.isDirty).toBe(false);
  });

  it("自动 flush 提交失败时意图回队首，显式 flush 重试后成功（意图不丢失）", async () => {
    const session = seededSession();
    let resolveReady!: (f: FontResolver) => void;
    const readyPromise = new Promise<FontResolver>((res) => {
      resolveReady = res;
    });
    let broken = false;
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => readyPromise,
      getFallbackFonts: () => NOTO_FONTS,
      onError: () => {
        /* 后台/显式 flush 失败由队列断言验证；避免未处理拒绝 */
      },
    });
    const originalCommit = session.commit.bind(session);
    const spy = vi.spyOn(session, "commit").mockImplementation((command) => {
      if (broken && command.kind === "SetDocumentFontAndResizeNodes") {
        return {
          ok: false as const,
          error: {
            code: "FONT_MISMATCH" as const,
            expected: "noto-sans-sc" as const,
            actual: "noto-sans-sc" as const,
          },
        };
      }
      return originalCommit(command as never) as never;
    });

    await barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });
    // 字体 ready 前打开故障注入，再释放：自动 flush 的提交失败，
    // 意图必须回队首保留
    broken = true;
    resolveReady(NOTO_FONTS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(barrier.hasPendingIntents()).toBe(true);
    expect(session.current.document.document.font).toBe("noto-sans-sc");

    broken = false;
    spy.mockRestore();
    await barrier.flush();
    expect(session.current.document.document.font).toBe("lxgw-wenkai");
    expect(barrier.hasPendingIntents()).toBe(false);
  });
});
