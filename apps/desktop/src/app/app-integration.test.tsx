// @vitest-environment jsdom
// MM-080 集成测试（fake 端口全流程；ReactFlow 以 stub 替换——见 rf-stub.tsx）：
// 覆盖 AC-04/06/08/09/10/11 的应用层语义：
// open/Save As 后 ordinary save 不重复弹选址对话框、外部冲突不覆盖且 dirty
// 保持、三格式导出唯一 owner、快捷键与输入隔离、dirty 确认、标题/dirty 指示。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument, encodeDocument, makeStateNode } from "@mindmap/core";
import type { MindMapDocumentV1 } from "@mindmap/core";

vi.mock("@xyflow/react", () => import("./rf-stub.js").then((m) => m.rfStubModule()));

const { MindMapApp } = await import("./mindmap-app.js");
const { FakeFilePort, FakePreferencesPort, FakeExportRenderer } = await import("./fake-ports.js");
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

function setup() {
  const filePort = new FakeFilePort();
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
    expect(screen.getByText("未保存 · 浏览器 dev（fake 端口）")).toBeTruthy();

    filePort.nextSaveDialog = "/docs/new-1.json";
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText(/已保存 \/docs\/new-1\.json/)).toBeTruthy());
    expect(filePort.saveDialogCalls).toBe(1); // Save As 弹过一次
    expect(screen.getByText("已保存 · 浏览器 dev（fake 端口）")).toBeTruthy();

    // 再次编辑（创建第二个节点）→ ordinary save：对话框计数不变
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 120, clientY: 80 });
    await waitFor(() => expect(screen.getByText("未保存 · 浏览器 dev（fake 端口）")).toBeTruthy());
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("已保存 · 浏览器 dev（fake 端口）")).toBeTruthy());
    expect(filePort.saveDialogCalls).toBe(1); // ★ 不重复弹选址对话框
  });

  it("open → edit → ordinary save 不弹选址（AC-06 核心路径）", async () => {
    const { filePort } = setup();
    fireEvent.click(screen.getByText("打开…"));
    await waitFor(() => expect(screen.getByText(/已打开 \/docs\/a\.json/)).toBeTruthy());
    expect(filePort.openDialogCalls).toBe(1);

    await createNodeViaCanvas(); // 编辑
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("已保存 · 浏览器 dev（fake 端口）")).toBeTruthy());
    expect(filePort.openDialogCalls).toBe(1);
    expect(filePort.saveDialogCalls).toBe(0); // ★ ordinary save 全程无选址对话框
  });

  it("Save As → edit → ordinary save 用新目标且不重弹", async () => {
    const { filePort } = setup();
    await createNodeViaCanvas();
    filePort.nextSaveDialog = "/docs/saveas.json";
    fireEvent.click(screen.getByText("另存为…"));
    await waitFor(() => expect(screen.getByText(/已保存 \/docs\/saveas\.json/)).toBeTruthy());

    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 10, clientY: 200 });
    await waitFor(() => expect(screen.getByText("未保存 · 浏览器 dev（fake 端口）")).toBeTruthy());
    filePort.nextSaveDialog = null; // 若误弹 → requestTargetAuthorization 返回 null → 保存取消（可检测）
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("已保存 · 浏览器 dev（fake 端口）")).toBeTruthy());
    expect(filePort.saveDialogCalls).toBe(1); // ★ 只有 Save As 弹过
  });
});

describe("外部冲突（AC-08 应用层语义）", () => {
  it("外部修改后保存：不覆盖、dirty 保持、明确提示", async () => {
    const { filePort } = setup();
    fireEvent.click(screen.getByText("打开…"));
    await waitFor(() => expect(screen.getByText(/已打开/)).toBeTruthy());

    await createNodeViaCanvas();
    // 模拟外部修改同一文件
    filePort.writeFile("/docs/a.json", encodeDocument(docWithNode("被外部改写")));

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(screen.getByText(/文件在应用外被修改或删除/)).toBeTruthy(),
    );
    // 未覆盖：文件内容仍是外部版本；应用侧 dirty 保持
    expect(new TextDecoder().decode(filePort.files.get("/docs/a.json")!)).toContain("被外部改写");
    expect(screen.getByText("未保存 · 浏览器 dev（fake 端口）")).toBeTruthy();
  });
});

describe("导出（AC-10/11：唯一 owner = web-ts-wasm 通道）", () => {
  it("三格式经一次性 export 授权落盘；空文档拒绝", async () => {
    const { filePort, renderer } = setup();
    await createNodeViaCanvas();

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    const panel = await screen.findByTestId("export-panel");

    filePort.nextSaveDialog = "/out/map.svg";
    fireEvent.click(screen.getByTestId("export-svg"));
    await waitFor(() => expect(screen.getByText(/已导出 \/out\/map\.svg/)).toBeTruthy());
    expect(filePort.files.get("/out/map.svg")).toBeTruthy();
    expect(renderer.rendered.at(-1)?.format).toBe("svg");

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    filePort.nextSaveDialog = "/out/map.png";
    fireEvent.click((await screen.findByTestId("export-panel")).querySelector('[data-testid="export-png"]')!);
    await waitFor(() => expect(screen.getByText(/已导出 \/out\/map\.png/)).toBeTruthy());
    expect(renderer.rendered.at(-1)?.format).toBe("png");

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    filePort.nextSaveDialog = "/out/map.pdf";
    fireEvent.click((await screen.findByTestId("export-panel")).querySelector('[data-testid="export-pdf"]')!);
    await waitFor(() => expect(screen.getByText(/已导出 \/out\/map\.pdf/)).toBeTruthy());
    expect(renderer.rendered.at(-1)?.format).toBe("pdf");
    void panel;

    // 空文档：新建（丢弃）→ 导出被拒绝且不请求授权
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.click(await screen.findByTestId("confirm-discard"));
    await waitFor(() => expect(screen.getByText(/已新建空白文档/)).toBeTruthy());
    const calls = filePort.saveDialogCalls;
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    fireEvent.click((await screen.findByTestId("export-panel")).querySelector('[data-testid="export-svg"]')!);
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

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    expect(await screen.findByTestId("dirty-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    await waitFor(() => expect(screen.queryByTestId("dirty-confirm")).toBeNull());
    expect(screen.getByText("未保存 · 浏览器 dev（fake 端口）")).toBeTruthy(); // 修改保留

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.click(await screen.findByTestId("confirm-discard"));
    await waitFor(() => expect(screen.getByText(/已新建空白文档/)).toBeTruthy());
  });

  it("窗口标题随 dirty/文件名变化", async () => {
    const { filePort } = setup();
    expect(document.title).toContain("未命名");
    fireEvent.click(screen.getByText("打开…"));
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
      seen.push(o.kind === "command" ? o.command.kind : o.kind);
    });
    session.commit({
      kind: "CreateNode",
      id: "n1",
      text: "",
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
    });
    session.undo();
    expect(seen).toEqual(["CreateNode", "history"]);
  });
});
