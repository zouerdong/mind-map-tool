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
    // 完整视觉卡使用 32px 横向内距并遵守 120px 最小宽度；不能回退成
    // 旧 measureNodeBox 的 40/70px 微型节点。
    expect(node.size.width).toBe(120);
    expect(node.size.width).not.toBe(70);
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
    expect(session.current.document.document.nodes[0]?.size.width).toBe(132);
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
    // G-VIS 口径："自动加载" 4 字 × 25 + padding 32 = 132（旧口径为 120）
    expect(session.current.document.document.nodes[0]!.size.width).toBe(132);
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
    // 落盘内容必须源自真实字体和完整视觉内距（4 字 × 25 + 32 = 132）
    expect(session.current.document.document.nodes[0]!.size.width).toBe(132);
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
    const onCommitted = vi.fn();
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "ready",
      whenMetricsReady: () => Promise.resolve(NOTO_FONTS),
      getFallbackFonts: () => NOTO_FONTS,
      onCommitted,
    });

    const pending = barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });

    // 回归真实 WebView 竞态：core commit 与 React 版本信号不能隔一个
    // Promise 微任务，否则 selection state 先重渲染会触发 projection drift。
    expect(session.current.document.document.font).toBe("lxgw-wenkai");
    expect(onCommitted).toHaveBeenCalledTimes(1);
    await pending;

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

describe("DFR-010 状态同步复核（指南 §1）", () => {
  it("队列部分提交后失败：已提交内容立即 onCommitted 通知 UI，失败意图回队首保留", async () => {
    const session = new DocumentSession(emptyDocument());
    const onCommitted = vi.fn();
    const onError = vi.fn();
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => Promise.resolve(REAL_FONTS),
      getFallbackFonts: () => FALLBACK_FONTS,
      onCommitted,
      onError,
    });

    await barrier.enqueue({
      kind: "create-node",
      id: "ok-1",
      position: { x: 0, y: 0 },
      text: "会成功",
    });
    await barrier.enqueue({
      kind: "create-node",
      id: "dup-1",
      position: { x: 200, y: 0 },
      text: "会失败",
    });

    // drain 前外部已存在同 id 节点 → 第二条 commit 必失败（NODE_ALREADY_EXISTS）
    const direct = session.commit({
      kind: "CreateNode",
      id: "dup-1",
      text: "外部",
      position: { x: 9, y: 9 },
      size: { width: 120, height: 50 },
    });
    expect(direct.ok).toBe(true);

    await expect(barrier.flush()).rejects.toThrow();

    // 部分提交必须通知：core 已含第一条，若跳过 onCommitted 画布将停留旧版本
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(session.current.document.document.nodes.map((n) => n.id).sort()).toEqual([
      "dup-1",
      "ok-1",
    ]);
    // 失败意图保留在队首，用户文本不丢失
    const pending = barrier.getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "create-node", id: "dup-1", text: "会失败" });
  });

  it("cancelPendingNode 保留文档级 set-document-font 意图，只移除目标节点意图", async () => {
    const session = new DocumentSession(emptyDocument());
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => new Promise<FontResolver>(() => {}),
      getFallbackFonts: () => FALLBACK_FONTS,
    });

    await barrier.enqueue({ kind: "set-document-font", font: "lxgw-wenkai" });
    await barrier.enqueue({
      kind: "create-node",
      id: "cancel-me",
      position: { x: 0, y: 0 },
      text: "",
    });
    await barrier.enqueue({ kind: "edit-text", id: "cancel-me", text: "打字中" });

    barrier.cancelPendingNode("cancel-me");

    const pending = barrier.getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "set-document-font", font: "lxgw-wenkai" });
  });

  it("ready 分支提交失败：onError 呈现且返回已消化 promise（void 调用不留未处理拒绝）", async () => {
    const session = new DocumentSession(emptyDocument());
    const onCommitted = vi.fn();
    const onError = vi.fn();
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "ready",
      whenMetricsReady: () => Promise.resolve(REAL_FONTS),
      getFallbackFonts: () => REAL_FONTS,
      onCommitted,
      onError,
    });
    const direct = session.commit({
      kind: "CreateNode",
      id: "dup",
      text: "已有",
      position: { x: 0, y: 0 },
      size: { width: 120, height: 50 },
    });
    expect(direct.ok).toBe(true);

    // 调用方形态即 `void enqueue(...)`：resolve 而非 reject
    await expect(
      barrier.enqueue({ kind: "create-node", id: "dup", position: { x: 1, y: 1 }, text: "冲突" }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onCommitted).not.toHaveBeenCalled();
  });
});

describe("DFR-090 F1：ready 提交失败的意图保留（与 pending 同规则）", () => {
  function readyBarrier(
    session: DocumentSession,
    hooks?: { onCommitted?: () => void; onError?: (e: unknown) => void },
  ) {
    return new GeometryBarrier({
      session,
      getMetricsState: () => "ready",
      whenMetricsReady: () => Promise.resolve(REAL_FONTS),
      getFallbackFonts: () => REAL_FONTS,
      ...(hooks?.onCommitted !== undefined ? { onCommitted: hooks.onCommitted } : {}),
      ...(hooks?.onError !== undefined ? { onError: hooks.onError } : {}),
    });
  }

  it("ready 提交失败：意图保留可重试；故障恢复后显式 flush 恰好提交一次", async () => {
    const session = new DocumentSession(emptyDocument());
    const onError = vi.fn();
    const onCommitted = vi.fn();
    const barrier = readyBarrier(session, { onError, onCommitted });
    const direct = session.commit({
      kind: "CreateNode",
      id: "dup",
      text: "已有",
      position: { x: 0, y: 0 },
      size: { width: 120, height: 50 },
    });
    expect(direct.ok).toBe(true);

    // 提交失败：意图不得丢失——hasPendingIntents 为 true，用户文本保留
    await barrier.enqueue({ kind: "create-node", id: "dup", position: { x: 9, y: 9 }, text: "冲突草稿" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(barrier.hasPendingIntents()).toBe(true);
    expect(barrier.getPendingIntents()[0]).toMatchObject({
      kind: "create-node",
      id: "dup",
      text: "冲突草稿",
    });
    // 文档未被误改
    expect(session.current.document.document.nodes).toHaveLength(1);

    // 故障恢复（外部删除冲突节点）→ flush 恰好提交一次
    session.commit({ kind: "DeleteSelection", nodeIds: ["dup"], edgeIds: [] });
    await barrier.flush();
    expect(barrier.hasPendingIntents()).toBe(false);
    const nodes = session.current.document.document.nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: "dup", text: "冲突草稿" });
  });

  it("ready 失败意图持续失败：显式 flush 拒绝（Save 阻断可见），意图仍保留", async () => {
    const session = new DocumentSession(emptyDocument());
    const barrier = readyBarrier(session, { onError: () => {} });
    session.commit({
      kind: "CreateNode",
      id: "dup",
      text: "已有",
      position: { x: 0, y: 0 },
      size: { width: 120, height: 50 },
    });

    await barrier.enqueue({ kind: "create-node", id: "dup", position: { x: 9, y: 9 }, text: "冲突" });
    await expect(barrier.flush()).rejects.toThrow();
    expect(barrier.hasPendingIntents()).toBe(true);
    // 文档未被误改
    expect(session.current.document.document.nodes).toHaveLength(1);
    expect(session.current.document.document.nodes[0]?.text).toBe("已有");
  });

  it("提交成功但 onCommitted 通知抛错：不重复入队、不重复提交，错误仍呈现", async () => {
    const session = new DocumentSession(emptyDocument());
    const onError = vi.fn();
    const onCommitted = vi.fn(() => {
      throw new Error("通知故障");
    });
    const barrier = readyBarrier(session, { onError, onCommitted });

    await barrier.enqueue({ kind: "create-node", id: "n1", position: { x: 0, y: 0 }, text: "通知失败" });
    expect(onError).toHaveBeenCalledTimes(1);
    // 命令已提交且不得重入队——否则 flush 会以 NODE_ALREADY_EXISTS 重复提交
    expect(barrier.hasPendingIntents()).toBe(false);
    expect(session.current.document.document.nodes).toHaveLength(1);

    // 后续 flush 是无操作（不重复提交、不再报错）
    await barrier.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(session.current.document.document.nodes).toHaveLength(1);
  });
});

describe("DFR-020 edit-text 测量与 core runs 清除语义一致", () => {
  // 字号差异字体：advance = fontSize（1px/pt/字），让 runs 有无产生可区分几何
  const SIZE_SENSITIVE_FONTS: FontResolver = {
    regular: () => ({ advance: (_ch: string, fs: number) => fs, ascentRatio: 0.8 }),
    bold: () => ({ advance: (_ch: string, fs: number) => fs, ascentRatio: 0.8 }),
  };

  it("不携带 runs 的 edit-text 按纯文本测量（core 会清除旧 runs）；眉题高度保留", async () => {
    const session = new DocumentSession(emptyDocument());
    const text = "一二三四五六七八九十"; // 10 字
    const created = session.commit({
      kind: "CreateNode",
      id: "n1",
      text,
      position: { x: 0, y: 0 },
      size: { width: 352, height: 46.4 }, // 旧 runs（32px）量出的宽
      runs: [{ start: 0, end: text.length, fontSize: 32 }],
    });
    expect(created.ok).toBe(true);
    session.commit({ kind: "SetNodeKicker", id: "n1", kicker: "分类" });

    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => Promise.resolve(SIZE_SENSITIVE_FONTS),
      getFallbackFonts: () => FALLBACK_FONTS,
    });
    await barrier.enqueue({ kind: "edit-text", id: "n1", text: "abcdefghij" }); // 纯文本编辑，无 runs
    await barrier.flush();

    const node = session.current.document.document.nodes[0]!;
    expect(node.runs).toBeUndefined(); // core 语义：无 runs 命令清除旧 runs
    // 纯文本 16px 测量：10 × 16 + 32 内距 = 192，不得沿用旧 runs 的 352
    expect(node.size.width).toBe(192);
    // 眉题保留并参与高度：12 + 14.3 + 6 + 22.4 + 12 = 66.7
    expect(node.kicker).toBe("分类");
    expect(node.size.height).toBeCloseTo(66.7, 3);
  });
});
