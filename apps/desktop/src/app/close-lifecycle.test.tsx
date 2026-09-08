// @vitest-environment jsdom
// MRT-003 / CR-003：原生关闭三分支的 App 集成测试（fake CloseLifecyclePort）。
// host fail-closed 发起 close-requested；此处证明 App 的应答契约：
// C1 clean 自动放行、S1–S5 Save 分支复用 saveFlow、D1/D2 Discard、X1 Cancel、
// R2 重复请求幂等。003A 阶段全红（App 仅有接线骨架）；003C 实现后转绿。

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument, encodeDocument } from "@mindmap/core";
import type { MindMapDocumentV1 } from "@mindmap/core";
import { PlatformError } from "@mindmap/platform";
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

function docWithNode(text = "打开的文档"): MindMapDocumentV1 {
  const doc = emptyDocument();
  doc.document.nodes.push({
    id: "seed-1",
    text,
    position: { x: 0, y: 0 },
    size: { width: 60, height: 37 },
  });
  return doc;
}

class CountingFilePort extends FakeFilePort {
  commitCalls = 0;
  nextCommitError: PlatformError | null = null;
  override async commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt> {
    this.commitCalls += 1;
    if (this.nextCommitError !== null) {
      const error = this.nextCommitError;
      this.nextCommitError = null;
      throw error;
    }
    return super.commitDocument(request);
  }
}

/** 挂起下一次提交（D2/S5：制造 pending save 窗口）。 */
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
  const closePort = new FakeCloseLifecyclePort();
  filePort.writeFile("/docs/a.json", encodeDocument(docWithNode()));
  filePort.nextOpenDialog = "/docs/a.json";
  const preferences = new FakePreferencesPort();
  const renderer = new FakeExportRenderer();
  const utils = render(
    <MindMapApp
      ports={{
        filePort,
        preferences,
        renderer,
        fonts: renderer.fonts(),
        isBrowserDev: true,
        globalShortcut: new FakeGlobalShortcut(),
        closeLifecycle: closePort,
        launch: new FakeLaunchPort(),
      }}
    />,
  );
  return { filePort, closePort, ...utils };
}

/** 画布空白双击创建节点（RF stub pane 事件）。 */
async function createNodeViaCanvas(x = 42, y = 24) {
  fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: x, clientY: y });
  await waitFor(() => {
    expect(screen.getAllByTestId(/^rf-node-/).length).toBeGreaterThan(0);
  });
}

async function openExisting(filePort: CountingFilePort) {
  filePort.nextOpenDialog = "/docs/a.json";
  fireEvent.keyDown(window, { key: "o", metaKey: true });
  await waitFor(() => expect(screen.getByText(/已打开 \/docs\/a\.json/)).toBeTruthy());
}

// PRR-065：dirty 状态由原生窗口标题（● 前缀）承载
const dirtyIndicator = () => document.title.startsWith("● ");

/**
 * 注入 host 关闭请求。emit 直调 handler 触发的 setState 发生在 act 之外，
 * 其渲染时序在 RTL waitFor 轮询间不可依赖——统一用 act 包裹保证落地。
 */
async function emitClose(closePort: { emit(id: string): void }, requestId: string) {
  await act(async () => {
    closePort.emit(requestId);
  });
}

describe("原生关闭三分支（MRT-003 / CR-003）", () => {
  it("C1：clean 文档收到关闭请求——不弹 modal，自动应答 clean", async () => {
    const { closePort } = setup();
    await emitClose(closePort, "r-clean");
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-clean", disposition: "clean" }]);
    });
    expect(screen.queryByTestId("close-dialog")).toBeNull(); // 无三分支 modal
  });

  it("C1：close port 随 App 挂载启动（订阅先于任何请求）", async () => {
    const { closePort } = setup();
    await waitFor(() => expect(closePort.startCalls).toBe(1));
  });

  it("R4：clean 关闭派发失败时保留显式重试入口，重试沿用 clean 语义", async () => {
    const { closePort } = setup();
    closePort.nextResolveError = new PlatformError("WINDOW_CLOSE_FAILED", "原生窗口暂时无法关闭");
    await emitClose(closePort, "r-clean-fail");

    const dialog = await screen.findByTestId("close-dialog");
    expect(dialog.getAttribute("data-phase")).toBe("retry-close");
    expect(screen.getByTestId("close-error").textContent).toContain("原生窗口暂时无法关闭");
    fireEvent.click(screen.getByTestId("close-retry"));
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-clean-fail", disposition: "clean" }]);
    });
    expect(screen.getByTestId("close-dialog").getAttribute("data-phase")).toBe("closing");
  });

  it("R2：dirty 时收到请求显示三分支 modal；同一 requestId 重复到达只保留一个流程", async () => {
    const { closePort } = setup();
    await createNodeViaCanvas();
    await emitClose(closePort, "r-dup");
    const dialog = await screen.findByTestId("close-dialog");
    expect(dialog.getAttribute("data-phase")).toBe("deciding");
    await emitClose(closePort, "r-dup"); // host 复用同 id（不重发）；防重放
    expect(screen.getAllByTestId("close-dialog").length).toBe(1);

    fireEvent.click(screen.getByTestId("close-discard"));
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-dup", disposition: "discarded" }]);
    });
  });

  it("S1：dirty 未命名文档——保存走 Save As，成功且 clean 后应答 saved", async () => {
    const { filePort, closePort } = setup();
    await createNodeViaCanvas();
    filePort.nextSaveDialog = "/docs/close-save.json";
    await emitClose(closePort, "r-save");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-save"));
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-save", disposition: "saved" }]);
    });
    expect(filePort.saveDialogCalls).toBe(1); // 复用 saveFlow：Save As 弹过一次
    expect(screen.getByText(/已保存 \/docs\/close-save\.json/)).toBeTruthy();
  });

  it("S2：Save As 被用户取消——modal 与窗口保持，不应答", async () => {
    const { filePort, closePort } = setup();
    await createNodeViaCanvas();
    filePort.nextSaveDialog = null; // 用户取消选址
    await emitClose(closePort, "r-cancel-save");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-save"));
    await waitFor(() => expect(filePort.saveDialogCalls).toBe(1));
    // modal 保持可继续操作；无任何 disposition 应答
    expect(screen.getByTestId("close-dialog").getAttribute("data-phase")).toBe("deciding");
    expect(closePort.resolutions).toEqual([]);
    expect(dirtyIndicator()).toBeTruthy();
  });

  it("S3：dirty 已命名文档——ordinary 保存恰好 commit 一次，不弹选址，应答 saved", async () => {
    const { filePort, closePort } = setup();
    await openExisting(filePort);
    await createNodeViaCanvas();
    await emitClose(closePort, "r-ord");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-save"));
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-ord", disposition: "saved" }]);
    });
    expect(filePort.commitCalls).toBe(1); // 恰好一次提交
    expect(filePort.saveDialogCalls).toBe(0); // 有 handle 不弹选址
  });

  it("S4：外部修改冲突——显示稳定错误，modal 与窗口保持，不应答 allow", async () => {
    const { filePort, closePort } = setup();
    await openExisting(filePort);
    await createNodeViaCanvas();
    // 保存期间目标被外部修改 → ordinary commit 拒绝（TARGET_MODIFIED_EXTERNALLY）
    filePort.writeFile("/docs/a.json", encodeDocument(docWithNode("外部新内容")));
    await emitClose(closePort, "r-conflict");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-save"));
    const error = await screen.findByTestId("close-error");
    expect(error.textContent).toContain("应用外被修改"); // MRT-001 既有稳定文案
    expect(screen.getByTestId("close-dialog").getAttribute("data-phase")).toBe("deciding");
    expect(closePort.resolutions).toEqual([]); // 不 resolve allow
    expect(filePort.files.get("/docs/a.json")).toBeDefined();
  });

  it("S4：只读/IO 保存失败——显示 host 错误，modal 与 dirty 保持，不应答 allow", async () => {
    const { filePort, closePort } = setup();
    await openExisting(filePort);
    await createNodeViaCanvas();
    filePort.nextCommitError = new PlatformError("FILE_IO_ERROR", "目标只读，无法写入");
    await emitClose(closePort, "r-io-fail");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-save"));

    const error = await screen.findByTestId("close-error");
    expect(error.textContent).toContain("目标只读，无法写入");
    expect(screen.getByTestId("close-dialog").getAttribute("data-phase")).toBe("deciding");
    expect(closePort.resolutions).toEqual([]);
    expect(dirtyIndicator()).toBeTruthy();
    expect(filePort.commitCalls).toBe(1);
  });

  it("S5：保存期间再次编辑——回执不误清 dirty，modal 保持允许再次决定", async () => {
    const filePort = new HoldingFilePort();
    const { closePort } = setup(filePort);
    await openExisting(filePort);
    await createNodeViaCanvas();
    let release!: () => void;
    filePort.holdNextCommit(new Promise<void>((r) => (release = r)));
    await emitClose(closePort, "r-reedit");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-save"));
    await waitFor(() => expect(filePort.arrivedCalls).toBe(1));
    expect(screen.getByTestId("close-dialog").getAttribute("data-phase")).toBe("saving");

    await createNodeViaCanvas(120, 80); // 保存进行中再次编辑
    release();
    await waitFor(() => expect(filePort.commitCalls).toBe(1));
    // 保存 ok 但新编辑使 dirty 保持 → 窗口保持，回到 deciding 允许再次决定
    await waitFor(() => {
      expect(screen.getByTestId("close-dialog").getAttribute("data-phase")).toBe("deciding");
    });
    expect(closePort.resolutions).toEqual([]);
    expect(dirtyIndicator()).toBeTruthy();
  });

  it("D1：Discard——零写盘零对话框，应答 discarded", async () => {
    const { filePort, closePort } = setup();
    await createNodeViaCanvas();
    await emitClose(closePort, "r-discard");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-discard"));
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-discard", disposition: "discarded" }]);
    });
    expect(filePort.commitCalls).toBe(0); // ★ 不写盘
    expect(filePort.saveDialogCalls).toBe(0); // ★ 不弹选址
  });

  it("D2：pending save 期间收到请求——受控等待态；Discard 禁用直至保存链终态", async () => {
    const filePort = new HoldingFilePort();
    const { closePort } = setup(filePort);
    await openExisting(filePort);
    await createNodeViaCanvas();
    let release!: () => void;
    filePort.holdNextCommit(new Promise<void>((r) => (release = r)));
    fireEvent.keyDown(window, { key: "s", metaKey: true }); // 工具条保存 → in-flight 挂起
    await waitFor(() => expect(filePort.arrivedCalls).toBe(1));

    await emitClose(closePort, "r-pending");
    const dialog = await screen.findByTestId("close-dialog");
    expect(dialog.getAttribute("data-phase")).toBe("awaiting-save"); // 受控等待
    expect((screen.getByTestId("close-discard") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("close-save") as HTMLButtonElement).disabled).toBe(true);

    // 保存链自然终态：保存覆盖全部编辑 → clean → 等待的保存完成即放行（saved）
    release();
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-pending", disposition: "saved" }]);
    });
    await waitFor(() => expect(screen.queryByTestId("close-dialog")).toBeNull());
  });

  it("D2：等待态 Cancel 仍可取消本次关闭（不应答 discard/save）", async () => {
    const filePort = new HoldingFilePort();
    const { closePort } = setup(filePort);
    await openExisting(filePort);
    await createNodeViaCanvas();
    filePort.holdNextCommit(new Promise<void>(() => {})); // 永久挂起
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(filePort.arrivedCalls).toBe(1));

    await emitClose(closePort, "r-wait-cancel");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-cancel"));
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([
        { requestId: "r-wait-cancel", disposition: "cancelled" },
      ]);
    });
    expect(screen.queryByTestId("close-dialog")).toBeNull(); // modal 清除
    expect(filePort.commitCalls).toBe(0); // 挂起的保存未完成，零新增写盘
  });

  it("X1：host 未确认 Cancel 时保留 modal 与重试能力", async () => {
    const { closePort } = setup();
    await createNodeViaCanvas();
    await emitClose(closePort, "r-cancel-fail");
    await screen.findByTestId("close-dialog");
    closePort.nextResolveError = new PlatformError(
      "INVALID_CLOSE_REQUEST",
      "取消应答暂未被 host 接受",
    );
    fireEvent.click(screen.getByTestId("close-cancel"));
    await waitFor(() => {
      expect(screen.getByTestId("close-error").textContent).toContain("取消应答暂未被 host 接受");
    });
    expect(screen.getByTestId("close-dialog").getAttribute("data-phase")).toBe("deciding");
    expect(closePort.resolutions).toEqual([]);

    fireEvent.click(screen.getByTestId("close-cancel"));
    await waitFor(() => expect(screen.queryByTestId("close-dialog")).toBeNull());
    expect(closePort.resolutions).toEqual([
      { requestId: "r-cancel-fail", disposition: "cancelled" },
    ]);
  });

  it("关闭决策期间屏蔽背后的文件快捷键，避免新增保存/替换竞态", async () => {
    const { filePort, closePort } = setup();
    await createNodeViaCanvas();
    await emitClose(closePort, "r-modal-shortcut");
    await screen.findByTestId("close-dialog");

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await Promise.resolve();
    expect(filePort.saveDialogCalls).toBe(0);
    expect(screen.queryByTestId("dirty-confirm")).toBeNull();
    expect(dirtyIndicator()).toBeTruthy();
  });

  it("X1：Cancel——零写盘、dirty 不变、modal 清除、窗口保持", async () => {
    const { filePort, closePort } = setup();
    await createNodeViaCanvas();
    await emitClose(closePort, "r-x1");
    await screen.findByTestId("close-dialog");
    fireEvent.click(screen.getByTestId("close-cancel"));
    await waitFor(() => {
      expect(closePort.resolutions).toEqual([{ requestId: "r-x1", disposition: "cancelled" }]);
    });
    expect(screen.queryByTestId("close-dialog")).toBeNull();
    expect(dirtyIndicator()).toBeTruthy(); // dirty 不变
    expect(filePort.commitCalls).toBe(0);
    expect(filePort.saveDialogCalls).toBe(0);
  });
});
