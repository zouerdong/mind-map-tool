// @vitest-environment jsdom
// PRR-010 perf 探针协议测试：
// - 未启用（host 未返回 config）时 no-op，不触碰 session/DOM；
// - renderer-ready 在画布可交互后上报，launch 场景到此为止；
// - edit/save 场景驱动真实 DocumentSession 与 FakeFilePort，
//   scenario-result 携带可复算 raw samples；
// - 场景失败上报 scenario-failed（reason），不静默吞掉。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSession, type MindMapDocumentV1 } from "@mindmap/core";
import type * as PortsModule from "./ports.js";
import { FakeFilePort, FakeExportRenderer } from "./fake-ports.js";
import { ExportRendererError } from "./export-commands.js";

// resetModules 会重新执行 mock factory——用 vi.hoisted 保证 invoke spy
// 跨模块重载是同一个实例，primeProbe 的实现不被丢弃。
const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeSpy,
}));

vi.mock("./ports.js", async (importOriginal) => {
  const original = (await importOriginal()) as typeof PortsModule;
  return { ...original, isTauriRuntime: () => true };
});

const invokeMock = invokeSpy;

function fixtureDocument(nodeCount = 4): MindMapDocumentV1 {
  return {
    schemaVersion: 2,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: Array.from({ length: nodeCount }, (_, i) => ({
        id: `node-${i}`,
        text: `节点 ${i}`,
        position: { x: i * 160, y: 0 },
        size: { width: 120, height: 40 },
      })),
      edges:
        nodeCount > 1
          ? Array.from({ length: nodeCount - 1 }, (_, i) => ({
              id: `edge-${i}`,
              sourceNodeId: `node-${i}`,
              targetNodeId: `node-${i + 1}`,
            }))
          : [],
    },
  };
}

function stubCanvasDom(nodeCount: number) {
  document.body.replaceChildren();
  const renderer = document.createElement("div");
  renderer.className = "react-flow__renderer";
  const pane = document.createElement("div");
  pane.className = "react-flow__pane";
  renderer.appendChild(pane);
  for (let i = 0; i < nodeCount; i++) {
    const node = document.createElement("div");
    node.className = "react-flow__node";
    renderer.appendChild(node);
  }
  document.body.appendChild(renderer);
}

const reportedEvents: Array<Record<string, unknown>> = [];

function primeProbe(config: Record<string, unknown> | null) {
  reportedEvents.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "platform_get_perf_probe_config") return config;
    if (command === "platform_report_perf_event") {
      reportedEvents.push(
        (args as { payload: Record<string, unknown> }).payload as Record<string, unknown>,
      );
      return undefined;
    }
    throw new Error(`unexpected invoke: ${command}`);
  });
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// runPerfProbe 的模块级单例每测例需重置：vi.resetModules 后动态 import
// 拿到新模块实例（mock factory 仍然生效）。
async function importFreshProbe() {
  vi.resetModules();
  const mod = await import("./perf-probe.js");
  return mod.runPerfProbe;
}

describe("perf probe (PRR-010)", () => {
  beforeEach(() => {
    if (!globalThis.PointerEvent) {
      Object.defineProperty(globalThis, "PointerEvent", {
        configurable: true,
        value: MouseEvent,
      });
    }
    stubCanvasDom(4);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("未启用时 no-op（无上报、无场景副作用）", async () => {
    primeProbe(null);
    const session = new DocumentSession(fixtureDocument());
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session,
      filePort: new FakeFilePort(),
      renderer: new FakeExportRenderer(),
      loadDocument: () => {},
      notifySaved: () => {},
      notifyExported: () => {},
    });
    expect(reportedEvents.length).toBe(0);
  });

  it("launch 场景：画布可交互后上报 renderer-ready 并停止", async () => {
    primeProbe({
      runId: "run-launch",
      scenario: "launch",
      fixtureJson: null,
      samples: 1,
      windowGeneration: 3,
    });
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session: new DocumentSession(fixtureDocument()),
      filePort: new FakeFilePort(),
      renderer: new FakeExportRenderer(),
      loadDocument: () => {},
      notifySaved: () => {},
      notifyExported: () => {},
    });
    await flushMicrotasks();
    expect(reportedEvents.length).toBe(1);
    expect(reportedEvents[0]).toEqual({
      runId: "run-launch",
      windowGeneration: 3,
      milestone: "renderer-ready",
      data: null,
    });
  });

  it("edit 场景：scenario-result 携带 4 类命令 raw samples", async () => {
    const doc = fixtureDocument(4);
    primeProbe({
      runId: "run-edit",
      scenario: "edit",
      fixtureJson: JSON.stringify(doc),
      samples: 2,
      windowGeneration: 1,
    });
    const session = new DocumentSession(fixtureDocument());
    const loaded: MindMapDocumentV1[] = [];
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session,
      filePort: new FakeFilePort(),
      renderer: new FakeExportRenderer(),
      loadDocument: (next) => {
        loaded.push(next);
        session.load(next);
        stubCanvasDom(next.document.nodes.length);
      },
      notifySaved: () => {},
      notifyExported: () => {},
    });
    await flushMicrotasks();
    expect(loaded.length).toBe(1);
    expect(reportedEvents.map((event) => event.milestone)).toEqual([
      "renderer-ready",
      "scenario-result",
    ]);
    const data = reportedEvents[1]!.data as Record<string, unknown>;
    expect(data.editSamples).toHaveLength(8); // 2 轮 × create/move/connect/undo
    for (const sample of data.editSamples as number[]) {
      expect(Number.isFinite(sample)).toBe(true);
      expect(sample).toBeGreaterThanOrEqual(0);
    }
    // 编辑命令在真实 session 上生效并整轮 undo 还原
    expect(session.document.document.nodes.length).toBe(4);
    expect(session.isDirty).toBe(false);
  });

  it("canvas 场景：分别保留 pan/drag/zoom 的原始帧样本", async () => {
    const doc = fixtureDocument(4);
    primeProbe({
      runId: "run-canvas",
      scenario: "canvas",
      fixtureJson: JSON.stringify(doc),
      samples: 1,
      windowGeneration: 1,
    });
    const session = new DocumentSession(fixtureDocument());
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session,
      filePort: new FakeFilePort(),
      renderer: new FakeExportRenderer(),
      loadDocument: (next) => {
        session.load(next);
        stubCanvasDom(next.document.nodes.length);
      },
      notifySaved: () => {},
      notifyExported: () => {},
    });
    await flushMicrotasks();
    expect(reportedEvents.map((event) => event.milestone)).toEqual([
      "renderer-ready",
      "scenario-result",
    ]);
    const data = reportedEvents[1]?.data as Record<string, unknown>;
    for (const key of ["panFrameSamples", "nodeDragFrameSamples", "zoomFrameSamples"]) {
      const samples = data?.[key] as number[];
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    }
    const p95 = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    };
    expect(data?.frameP95Ms).toBe(
      Math.max(
        p95(data.panFrameSamples as number[])!,
        p95(data.nodeDragFrameSamples as number[])!,
        p95(data.zoomFrameSamples as number[])!,
      ),
    );
  });

  it("save 场景：Save As 建立 handle 后 ordinary save 全链计时", async () => {
    const doc = fixtureDocument(4);
    primeProbe({
      runId: "run-save",
      scenario: "save",
      fixtureJson: JSON.stringify(doc),
      samples: 2,
      windowGeneration: 1,
    });
    const filePort = new FakeFilePort();
    filePort.nextSaveDialog = "/tmp/perf-sample.mindmap";
    const session = new DocumentSession(fixtureDocument());
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session,
      filePort,
      renderer: new FakeExportRenderer(),
      loadDocument: (next) => {
        session.load(next);
        stubCanvasDom(next.document.nodes.length);
      },
      notifySaved: () => {},
      notifyExported: () => {},
    });
    await flushMicrotasks();
    const data = reportedEvents[1]?.data as Record<string, unknown>;
    expect(data?.saveSamples).toHaveLength(2); // 2 轮 ordinary save（首次 Save As 仅建立 handle，不计入）
    expect(filePort.files.size).toBe(1);
  });

  it("场景失败上报 scenario-failed（fixture 解码失败路径）", async () => {
    primeProbe({
      runId: "run-bad",
      scenario: "edit",
      fixtureJson: "not-json{{",
      samples: 1,
      windowGeneration: 1,
    });
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session: new DocumentSession(fixtureDocument()),
      filePort: new FakeFilePort(),
      renderer: new FakeExportRenderer(),
      loadDocument: () => {},
      notifySaved: () => {},
      notifyExported: () => {},
    });
    await flushMicrotasks();
    expect(reportedEvents.map((event) => event.milestone)).toEqual([
      "renderer-ready",
      "scenario-failed",
    ]);
    const data = reportedEvents[1]!.data as { reason: string };
    expect(data.reason).toContain("fixture");
  });

  it("PNG 失败同时保留错误码与底层消息", async () => {
    const doc = fixtureDocument(4);
    primeProbe({
      runId: "run-png-failed",
      scenario: "png-export",
      fixtureJson: JSON.stringify(doc),
      samples: 1,
      windowGeneration: 1,
    });
    const renderer = new FakeExportRenderer();
    renderer.renderPng = vi.fn().mockRejectedValue(new Error("WASM bootstrap failed"));
    const filePort = new FakeFilePort();
    filePort.nextSaveDialog = "/tmp/perf-sample.png";
    const session = new DocumentSession(fixtureDocument());
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session,
      filePort,
      renderer,
      loadDocument: (next) => {
        session.load(next);
        stubCanvasDom(next.document.nodes.length);
      },
      notifySaved: () => {},
      notifyExported: () => {},
    });
    await flushMicrotasks();
    const data = reportedEvents[1]!.data as { reason: string };
    expect(data.reason).toContain("UNKNOWN");
    expect(data.reason).toContain("WASM bootstrap failed");
  });

  it("WASM 边界失败以稳定 code EXPORT_WASM_UNAVAILABLE 上报，携带底层原因", async () => {
    const doc = fixtureDocument(4);
    primeProbe({
      runId: "run-png-wasm",
      scenario: "png-export",
      fixtureJson: JSON.stringify(doc),
      samples: 1,
      windowGeneration: 1,
    });
    const renderer = new FakeExportRenderer();
    // 复现 production 边界（ports.ts LazyTauriExportRenderer）：renderer
    // 结构化失败 → ExportRendererError(code) → exportFlow toError 透传。
    renderer.renderPng = vi
      .fn()
      .mockRejectedValue(
        new ExportRendererError(
          "EXPORT_WASM_UNAVAILABLE",
          "PNG 渲染失败：resvg WASM 初始化/渲染失败：CompileError: WebAssembly.instantiate(): Type mismatch",
        ),
      );
    const filePort = new FakeFilePort();
    filePort.nextSaveDialog = "/tmp/perf-sample.png";
    const session = new DocumentSession(fixtureDocument());
    const runPerfProbe = await importFreshProbe();
    await runPerfProbe({
      session,
      filePort,
      renderer,
      loadDocument: (next) => {
        session.load(next);
        stubCanvasDom(next.document.nodes.length);
      },
      notifySaved: () => {},
      notifyExported: () => {},
    });
    await flushMicrotasks();
    const data = reportedEvents[1]!.data as { reason: string };
    expect(data.reason).toContain("EXPORT_WASM_UNAVAILABLE");
    expect(data.reason).toContain("CompileError");
    expect(data.reason).not.toMatch(/error\/UNKNOWN/);
  });
});
