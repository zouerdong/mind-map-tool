// @vitest-environment jsdom
// MM-080 集成测试（fake 端口全流程；ReactFlow 以 stub 替换——见 rf-stub.tsx）：
// 覆盖 AC-04/06/08/09/10/11 的应用层语义：
// open/Save As 后 ordinary save 不重复弹选址对话框、外部冲突不覆盖且 dirty
// 保持、三格式导出唯一 owner、快捷键与输入隔离、dirty 确认、标题/dirty 指示。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument, encodeDocument, makeStateNode } from "@mindmap/core";
import type { MindMapDocumentV1 } from "@mindmap/core";
import type { CommitDocumentRequest, CommitReceipt } from "@mindmap/platform";

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

function docWithNode(text = "一"): MindMapDocumentV1 {
  const doc = emptyDocument();
  doc.document.nodes.push({
    id: "seed-1",
    text,
    position: { x: 0, y: 0 },
    size: { width: 60, height: 37 },
  });
  return doc;
}

/** 统计提交次数（CR-001 回归：断言"恰好提交 N 次、不自旋"）。 */
class CountingFilePort extends FakeFilePort {
  commitCalls = 0;
  override async commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt> {
    this.commitCalls += 1;
    return super.commitDocument(request);
  }
}

/**
 * 挂起下一次提交（MRT-001A：制造 pending save 窗口）。arrivedCalls 在
 * 门闩前自增——commit 挂起中即可断言"请求已到达、in-flight 已占位"。
 */
class HoldingFilePort extends CountingFilePort {
  arrivedCalls = 0;
  private gate: Promise<void> | null = null;
  holdNextCommit(promise: Promise<void>): void {
    this.gate = promise;
  }
  override async commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt> {
    this.arrivedCalls += 1;
    if (this.gate) {
      const gate = this.gate;
      this.gate = null;
      await gate;
    }
    return super.commitDocument(request);
  }
}

function setup(filePort: CountingFilePort = new CountingFilePort()) {
  const preferences = new FakePreferencesPort();
  const renderer = new FakeExportRenderer();
  filePort.writeFile("/docs/a.json", encodeDocument(docWithNode("打开的文档")));
  filePort.nextOpenDialog = "/docs/a.json";
  const utils = render(
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
  return { filePort, preferences, renderer, ...utils };
}

/** 画布空白双击创建节点（RF stub pane 事件 → EditorCanvas wrapper onDoubleClick）。 */
async function createNodeViaCanvas() {
  fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 42, clientY: 24 });
  await waitFor(() => {
    expect(screen.getAllByTestId(/^rf-node-/).length).toBeGreaterThan(0);
  });
}

describe("保存闭环（AC-04/06）", () => {
  it("新建 → 画布创建节点（dirty）→ 保存自动转 Save As → clean；再次编辑后 ordinary save 不再弹选址", async () => {
    const { filePort } = setup();
    await createNodeViaCanvas();
    expect(document.title.startsWith("● ")).toBeTruthy();

    filePort.nextSaveDialog = "/docs/new-1.json";
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(screen.getByText(/已保存 \/docs\/new-1\.json/)).toBeTruthy());
    expect(filePort.saveDialogCalls).toBe(1); // Save As 弹过一次
    expect(document.title.startsWith("● ")).toBeFalsy();

    // 再次编辑（创建第二个节点）→ ordinary save：对话框计数不变
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 120, clientY: 80 });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeTruthy());
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeFalsy());
    expect(filePort.saveDialogCalls).toBe(1); // ★ 不重复弹选址对话框
  });

  it("open → edit → ordinary save 不弹选址（AC-06 核心路径）", async () => {
    const { filePort } = setup();
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(screen.getByText(/已打开 \/docs\/a\.json/)).toBeTruthy());
    expect(filePort.openDialogCalls).toBe(1);

    await createNodeViaCanvas(); // 编辑
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeFalsy());
    expect(filePort.openDialogCalls).toBe(1);
    expect(filePort.saveDialogCalls).toBe(0); // ★ ordinary save 全程无选址对话框
  });

  it("Save As → edit → ordinary save 用新目标且不重弹", async () => {
    const { filePort } = setup();
    await createNodeViaCanvas();
    filePort.nextSaveDialog = "/docs/saveas.json";
    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText(/已保存 \/docs\/saveas\.json/)).toBeTruthy());

    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 10, clientY: 200 });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeTruthy());
    filePort.nextSaveDialog = null; // 若误弹 → requestTargetAuthorization 返回 null → 保存取消（可检测）
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(document.title.startsWith("● ")).toBeFalsy());
    expect(filePort.saveDialogCalls).toBe(1); // ★ 只有 Save As 弹过
  });

  it("CR-001 回归：已有目标时连续两次保存不弹 Save As，恰好提交两次", async () => {
    const { filePort } = setup();
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(screen.getByText(/已打开 \/docs\/a\.json/)).toBeTruthy());
    await createNodeViaCanvas(); // dirty

    fireEvent.keyDown(window, { key: "s", metaKey: true }); // 第一次：捕获快照并提交（异步未完成）
    fireEvent.keyDown(window, { key: "s", metaKey: true }); // 第二次：提交进行中 → 应排队而非弹 Save As
    await waitFor(() => expect(document.title.startsWith("● ")).toBeFalsy());
    expect(filePort.saveDialogCalls).toBe(0); // ★ 第二次普通保存不得弹选址对话框
    await waitFor(() => expect(filePort.commitCalls).toBe(2)); // ★ 恰好两次提交，队列最终为 0
    expect(document.title.startsWith("● ")).toBeFalsy();
  }, 10_000);

  it('MRT-001A：保存 pending 时新建/打开被 gate——busy 提示、不弹 discard、不开对话框；完成后无"已新建"notice 且可重试', async () => {
    const filePort = new HoldingFilePort();
    setup(filePort);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(screen.getByText(/已打开 \/docs\/a\.json/)).toBeTruthy());
    expect(filePort.openDialogCalls).toBe(1);
    await createNodeViaCanvas(); // dirty

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    filePort.holdNextCommit(gate);
    fireEvent.keyDown(window, { key: "s", metaKey: true }); // 提交挂起 → in-flight pending
    await waitFor(() => expect(filePort.arrivedCalls).toBe(1));

    // ★ 新建被 gate：busy 非致命提示，不弹 discard 确认，文档未替换
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("app-notice").textContent).toContain("保存尚未完成"),
    );
    expect(screen.queryByTestId("dirty-confirm")).toBeNull();
    expect(document.title.startsWith("● ")).toBeTruthy(); // dirty 保持

    // ★ 打开同样被 gate：不弹文件对话框
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    expect(filePort.openDialogCalls).toBe(1); // 计数不变（无新对话框）
    expect(screen.queryByTestId("dirty-confirm")).toBeNull();

    // ★ 保存链自然终态：notice 是"已保存"，不出现"已新建/已打开"（场景 9）
    release();
    await waitFor(() => expect(document.title.startsWith("● ")).toBeFalsy());
    expect(screen.getByTestId("app-notice").textContent).toContain("已保存 /docs/a.json");
    expect(screen.queryByText(/已新建空白文档/)).toBeNull();
    expect(screen.queryByText(/已打开/)).toBeNull();

    // ★ 终态后重试新建成功（clean → 不弹 discard）
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() => expect(screen.getByText(/已新建空白文档/)).toBeTruthy());
    expect(screen.queryByTestId("dirty-confirm")).toBeNull();
    expect(filePort.commitCalls).toBe(1); // 全程恰好 1 次提交
  }, 10_000);
});

describe("外部冲突（AC-08 应用层语义）", () => {
  it("外部修改后保存：不覆盖、dirty 保持、明确提示", async () => {
    const { filePort } = setup();
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(screen.getByText(/已打开/)).toBeTruthy());

    await createNodeViaCanvas();
    // 模拟外部修改同一文件
    filePort.writeFile("/docs/a.json", encodeDocument(docWithNode("被外部改写")));

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(screen.getByText(/文件在应用外被修改或删除/)).toBeTruthy());
    // 未覆盖：文件内容仍是外部版本；应用侧 dirty 保持
    expect(new TextDecoder().decode(filePort.files.get("/docs/a.json")!)).toContain("被外部改写");
    expect(document.title.startsWith("● ")).toBeTruthy();
  });
});

describe("导出（AC-10/11：唯一 owner = web-ts-wasm 通道）", () => {
  it("三格式经一次性 export 授权落盘；空文档拒绝", async () => {
    const { filePort, renderer } = setup();
    await createNodeViaCanvas();

    fireEvent.keyDown(window, { key: "e", metaKey: true });
    const panel = await screen.findByTestId("export-panel");

    filePort.nextSaveDialog = "/out/map.svg";
    fireEvent.click(screen.getByTestId("export-svg"));
    await waitFor(() => expect(screen.getByText(/已导出 \/out\/map\.svg/)).toBeTruthy());
    expect(filePort.files.get("/out/map.svg")).toBeTruthy();
    expect(renderer.rendered.at(-1)?.format).toBe("svg");

    fireEvent.keyDown(window, { key: "e", metaKey: true });
    filePort.nextSaveDialog = "/out/map.png";
    fireEvent.click(
      (await screen.findByTestId("export-panel")).querySelector('[data-testid="export-png"]')!,
    );
    await waitFor(() => expect(screen.getByText(/已导出 \/out\/map\.png/)).toBeTruthy());
    expect(renderer.rendered.at(-1)?.format).toBe("png");

    fireEvent.keyDown(window, { key: "e", metaKey: true });
    filePort.nextSaveDialog = "/out/map.pdf";
    fireEvent.click(
      (await screen.findByTestId("export-panel")).querySelector('[data-testid="export-pdf"]')!,
    );
    await waitFor(() => expect(screen.getByText(/已导出 \/out\/map\.pdf/)).toBeTruthy());
    expect(renderer.rendered.at(-1)?.format).toBe("pdf");
    void panel;

    // 空文档：新建（丢弃）→ 导出被拒绝且不请求授权
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    fireEvent.click(await screen.findByTestId("confirm-discard"));
    await waitFor(() => expect(screen.getByText(/已新建空白文档/)).toBeTruthy());
    const calls = filePort.saveDialogCalls;
    fireEvent.keyDown(window, { key: "e", metaKey: true });
    fireEvent.click(
      (await screen.findByTestId("export-panel")).querySelector('[data-testid="export-svg"]')!,
    );
    await waitFor(() => expect(screen.getByText(/空文档/)).toBeTruthy());
    expect(filePort.saveDialogCalls).toBe(calls); // buildScene 前置失败 → 不弹授权
  });
});

describe("快捷键与隔离（AC-02/04）", () => {
  it("⌘S 触发保存；输入态 ⌘S 不派发", async () => {
    const { filePort } = setup();
    await createNodeViaCanvas();
    filePort.nextSaveDialog = "/docs/kb.json";

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(screen.getByText(/已保存 \/docs\/kb\.json/)).toBeTruthy());

    // 输入态隔离：编辑节点时 ⌘S 不派发（不会弹出另存）
    await createNodeViaCanvas();
    fireEvent.doubleClick(screen.getAllByTestId(/^rf-node-/)[0]!);
    const editor = await screen.findByLabelText("编辑节点文本");
    const calls = filePort.saveDialogCalls;
    fireEvent.keyDown(editor, { key: "s", metaKey: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(filePort.saveDialogCalls).toBe(calls); // 未触发保存流
  });
});

describe("dirty 确认与标题（PRD §5-6/AC-09）", () => {
  it("dirty 时新建/打开先确认；取消则保留修改", async () => {
    setup();
    await createNodeViaCanvas();

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(await screen.findByTestId("dirty-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    await waitFor(() => expect(screen.queryByTestId("dirty-confirm")).toBeNull());
    expect(document.title.startsWith("● ")).toBeTruthy(); // 修改保留

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    fireEvent.click(await screen.findByTestId("confirm-discard"));
    await waitFor(() => expect(screen.getByText(/已新建空白文档/)).toBeTruthy());
  });

  it("窗口标题随 dirty/文件名变化", async () => {
    const { filePort } = setup();
    expect(document.title).toContain("未命名");
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(document.title).toContain("a.json"));
    await createNodeViaCanvas();
    await waitFor(() => expect(document.title.startsWith("● ")).toBeTruthy());
    void filePort;
  });
});

describe("引导观察通道（MM-080 ⑥/MM-070 契约）", () => {
  it("画布命令经 ObservedDocumentSession 广播给 onboarding 观察者", async () => {
    const { ObservedDocumentSession } = await import("./observed-session.js");
    const seen: string[] = [];
    const session = new ObservedDocumentSession(makeStateNode(emptyDocument()).document, (o) => {
      seen.push(o.kind === "command" ? o.command.kind : o.kind === "history" ? o.action : o.kind);
    });
    session.commit({
      kind: "CreateNode",
      id: "n1",
      text: "",
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
    });
    session.undo();
    session.redo();
    expect(seen).toEqual(["CreateNode", "undo", "redo"]); // O1：redo 只广播一次 history observation
  });
});
