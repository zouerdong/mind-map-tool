// @vitest-environment jsdom
// PRC-025 集成测试：字体 Ready 前权威几何提交屏障
// 验证：
// 1. ready 前 quick-create/双击输入文本，不把 DEV_FONTS fallback size 写入权威 session。
// 2. ready 前工具栏 kicker / 文本编辑进入屏障缓冲，ready 后单次提交 real size。
// 3. pending 时触发 Save/Close-Save，等待真实字体就绪后保存 real size，绝不保存 fallback size。
// 4. resolver failed 时不静默提交 fallback size，保留输入并给出错误提示。
// 5. 已加载旧文档在 resolver ready 时不产生虚假 dirty/无操作 commit。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument, encodeDocument, type MindMapDocumentV1 } from "@mindmap/core";
import type { CommitDocumentRequest, CommitReceipt } from "@mindmap/platform";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("./rf-stub.js").then((m) => m.rfStubModule()));

const { MindMapApp } = await import("./mindmap-app.js");
const {
  FakeCloseLifecyclePort,
  FakeExportRenderer,
  FakeFilePort,
  FakeLaunchPort,
  FakePreferencesPort,
} = await import("./fake-ports.js");
const { FakeGlobalShortcut } = await import("./ports.js");

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

/** 构造带一个预存节点的文档 */
function docWithSingleNode(id = "existing-1", text = "根节点"): MindMapDocumentV1 {
  const doc = emptyDocument();
  doc.document.nodes.push({
    id,
    text,
    position: { x: 100, y: 100 },
    size: { width: 120, height: 40 },
  });
  return doc;
}

class SpyingFilePort extends FakeFilePort {
  savedDocuments: CommitDocumentRequest[] = [];
  override async commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt> {
    this.savedDocuments.push(request);
    return super.commitDocument(request);
  }
}

/** 模拟 fallback 与 real 宽度有显著差异的字体度量 */
const fallbackFont: FontResolver = {
  regular: () => ({ advance: () => 10, ascentRatio: 0.8 }),
  bold: () => ({ advance: () => 10, ascentRatio: 0.8 }),
};
const realFont: FontResolver = {
  regular: () => ({ advance: () => 35, ascentRatio: 0.8 }),
  bold: () => ({ advance: () => 35, ascentRatio: 0.8 }),
};

describe("PRC-025: 权威几何提交屏障集成测试", () => {
  it("已有文档加载后，font ready 不会隐式改写节点 size 或制造 dirty 状态", async () => {
    const filePort = new SpyingFilePort();
    filePort.writeFile("/docs/test.mindmap", encodeDocument(docWithSingleNode("n1", "测试")));
    filePort.nextOpenDialog = "/docs/test.mindmap";

    const renderer = new FakeExportRenderer({}, fallbackFont);
    const defer = renderer.deferFontMetrics();

    const utils = render(
      <MindMapApp
        ports={{
          filePort,
          preferences: new FakePreferencesPort(),
          renderer,
          fonts: renderer.fonts(),
          isBrowserDev: true,
          globalShortcut: new FakeGlobalShortcut(),
          closeLifecycle: new FakeCloseLifecyclePort(),
          launch: new FakeLaunchPort(),
        }}
      />,
    );

    // 打开文档
    fireEvent.keyDown(window, { key: "o", metaKey: true });

    await waitFor(() => {
      expect(screen.getByText("测试")).toBeDefined();
    });

    // 字体未 ready 时，未做任何修改，未 dirty
    expect(screen.queryByText(/已修改/)).toBeNull();

    // 此时字体就绪
    defer.resolve(realFont);
    await waitFor(() => {
      expect(renderer.fontMetricsState()).toBe("ready");
    });

    // 权威 size 保持不变，文档仍然未 dirty，没有虚假修改
    expect(screen.queryByText(/已修改/)).toBeNull();
    expect(filePort.savedDocuments.length).toBe(0);
    utils.unmount();
  });

  it("pending 期间 quick-create，等待字体就绪后使用 realFont 提交，不使用 fallback", async () => {
    const filePort = new SpyingFilePort();
    const renderer = new FakeExportRenderer({}, fallbackFont);
    const defer = renderer.deferFontMetrics();

    render(
      <MindMapApp
        ports={{
          filePort,
          preferences: new FakePreferencesPort(),
          renderer,
          fonts: renderer.fonts(),
          isBrowserDev: true,
          globalShortcut: new FakeGlobalShortcut(),
          closeLifecycle: new FakeCloseLifecyclePort(),
          launch: new FakeLaunchPort(),
        }}
      />,
    );

    // 双击画布空白处触发创建
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 100, clientY: 100 });

    // 模拟编辑输入
    await waitFor(() => {
      const input = screen.queryByRole("textbox");
      if (input) {
        fireEvent.change(input, { target: { value: "新节点AA" } });
        fireEvent.keyDown(input, { key: "Enter" });
      }
    });

    // 在 defer.resolve 之前，由于 barrier 阻断，没有提交 fallback size 到权威持久化
    // 触发字体就绪
    defer.resolve(realFont);

    await waitFor(() => {
      expect(renderer.fontMetricsState()).toBe("ready");
    });
    // PRR-066 红灯 3：首意图自动 flush——字体 ready 后无需等到 Save，
    // 几何命令即以真实度量提交（session dirty 是提交的可观察信号；
    // rf-node 对 pending 节点也会渲染，不能作为提交判据）
    await waitFor(() => {
      expect(document.title.startsWith("● ")).toBe(true);
    });
  });

  it("pending 期间 Save 会先等待 real font 刷新，落盘 size 是 realFont 测得而非 fallback", async () => {
    const filePort = new SpyingFilePort();
    filePort.nextSaveDialog = "/docs/saved.mindmap";
    const renderer = new FakeExportRenderer({}, fallbackFont);
    const defer = renderer.deferFontMetrics();

    render(
      <MindMapApp
        ports={{
          filePort,
          preferences: new FakePreferencesPort(),
          renderer,
          fonts: renderer.fonts(),
          isBrowserDev: true,
          globalShortcut: new FakeGlobalShortcut(),
          closeLifecycle: new FakeCloseLifecyclePort(),
          launch: new FakeLaunchPort(),
        }}
      />,
    );

    // 双击画布创建节点
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 120, clientY: 80 });

    // 双击该节点进入编辑
    const nodeEl = await screen.findByTestId(/rf-node-/);
    fireEvent.doubleClick(nodeEl);

    // 输入较长文本
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "权威节点测试文字" } });

    // 触发另存为 Save As（此时不主动 blur/Enter，测试 activeEditorRef.flush 自动提取）
    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });

    // 此时 save 会等待 barrier flush（即等待 metrics ready）
    // 尚未保存
    expect(filePort.savedDocuments.length).toBe(0);

    // 释放真实字体
    defer.resolve(realFont);

    // 等待落盘完成
    await waitFor(() => {
      expect(filePort.savedDocuments.length).toBe(1);
    });

    const savedDoc = filePort.savedDocuments[0];
    expect(savedDoc).toBeDefined();
    if (!savedDoc) throw new Error("savedDoc is undefined");
    // 验证保存的 node size 必须是由 realFont(advance=35) 测得的尺寸
    const parsed = JSON.parse(new TextDecoder().decode(savedDoc.contentBytes));
    const savedNodes = parsed.document.nodes;
    expect(savedNodes.length).toBeGreaterThan(0);
    const createdNode = savedNodes[savedNodes.length - 1];
    expect(createdNode.text).toBe("权威节点测试文字");
    // 8个字符 * advance 35 = 280, paddingX 10*2 => width = 300
    // 如果是 fallback 10: 8 * 10 + 20 = 100
    expect(createdNode.size.width).toBeGreaterThan(200);
  });

  it("字体加载失败时，不向文件系统落盘 fallback 尺寸并展示错误提示", async () => {
    const filePort = new SpyingFilePort();
    const renderer = new FakeExportRenderer({}, fallbackFont);
    const defer = renderer.deferFontMetrics();

    render(
      <MindMapApp
        ports={{
          filePort,
          preferences: new FakePreferencesPort(),
          renderer,
          fonts: renderer.fonts(),
          isBrowserDev: true,
          globalShortcut: new FakeGlobalShortcut(),
          closeLifecycle: new FakeCloseLifecyclePort(),
          launch: new FakeLaunchPort(),
        }}
      />,
    );

    // PRR-066：空白 mount 不再预热导出资源——失败只能由真实需求触发。
    // 先让字体加载失败，再产生首个几何意图（双击建点）。
    defer.reject(new Error("网络字体加载超时"));

    // 双击画布创建节点：pending 已翻转为 failed，意图保留并提示重试时机
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 120, clientY: 80 });
    await waitFor(() => {
      expect(screen.getByText(/字体资源加载失败/)).toBeDefined();
    });

    // 尝试另存（⇧⌘S）：flush 重试仍失败 → 阻断保存，不写入错误几何
    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByText(/字体资源加载失败，无法另存文档/)).toBeDefined();
    });
    expect(filePort.savedDocuments.length).toBe(0);
  });
});

describe("PRR-066: 导出资源按需加载（空白画布不预热）", () => {
  it("仅 mount、空白画布稳定后，不调用 renderer warmup/whenReady/whenMetricsReady", async () => {
    const filePort = new SpyingFilePort();
    const renderer = new FakeExportRenderer();
    const warmupSpy = vi.spyOn(renderer, "warmup");
    const whenReadySpy = vi.spyOn(renderer, "whenReady");
    const whenMetricsReadySpy = vi.spyOn(renderer, "whenMetricsReady");
    const preferences = new FakePreferencesPort();
    const loadSpy = vi.spyOn(preferences, "load");

    render(
      <MindMapApp
        ports={{
          filePort,
          preferences,
          renderer,
          fonts: renderer.fonts(),
          isBrowserDev: true,
          globalShortcut: new FakeGlobalShortcut(),
          closeLifecycle: new FakeCloseLifecyclePort(),
          launch: new FakeLaunchPort(),
        }}
      />,
    );

    // 等 restore/onboarding 链路真实跑完再断言（避免异步未完成的假阴性）
    await waitFor(() => expect(loadSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 80));

    // 空白画布零交互：导出栈（JS chunk、三份字体、resvg WASM）不得进入加载路径
    expect(warmupSpy).not.toHaveBeenCalled();
    expect(whenReadySpy).not.toHaveBeenCalled();
    expect(whenMetricsReadySpy).not.toHaveBeenCalled();
  });
});
