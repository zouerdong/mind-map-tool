// PRR-010 perf 诊断探针（renderer 侧；仅 MINDMAP_PERF_SAMPLE=1 的候选
// 采样进程激活，浏览器 dev / 普通用户路径全部 no-op）。
// 协议（指南 §4.1）：
// 1. mount 后查询 host 配置（含 host 权威 windowGeneration）；
// 2. 等待画布可交互（.react-flow__pane 出现 + 两次 rAF）后上报
//    renderer-ready——启动计时的终点是真实可交互，不是 setup 日志；
// 3. canvas/edit/save/png-export 场景在 renderer 内驱动合成文档并计时，
//    结果经 typed IPC 回传，由 host 校验后输出机器可解析 JSON；
// 4. launch/rss 场景在 renderer-ready 后交还 host（退出 / RSS 采样）。

import { invoke } from "@tauri-apps/api/core";
import type { DocumentSession, MindMapDocumentV1 } from "@mindmap/core";
import { decodeDocument } from "@mindmap/core";
import type { FilePort } from "@mindmap/platform";
import type { ExportRendererLike } from "./export-commands.js";
import { exportFlow } from "./export-commands.js";
import { saveAsFlow, saveFlow } from "./file-commands.js";
import { isTauriRuntime } from "./ports.js";

export type PerfScenario = "launch" | "rss" | "canvas" | "edit" | "save" | "png-export";

export interface PerfProbeConfig {
  runId: string;
  scenario: PerfScenario;
  fixtureJson: string | null;
  samples: number;
  windowGeneration: number;
}

/** 场景执行的依赖（由 MindMapApp 组合根接线；测试注入 fake）。 */
export interface PerfScenarioDeps {
  session: DocumentSession;
  filePort: FilePort;
  renderer: ExportRendererLike;
  /** 加载文档并驱动画布重投影（load + bump + fitView 信号由组合根接线）。 */
  loadDocument(doc: MindMapDocumentV1): void;
  notifySaved(): void;
  notifyExported(): void;
}

interface PerfProbeConfigDto {
  runId: string;
  scenario: string;
  fixtureJson: string | null;
  samples: number;
  windowGeneration: number;
}

function isPerfScenario(value: string): value is PerfScenario {
  return ["launch", "rss", "canvas", "edit", "save", "png-export"].includes(value);
}

export async function fetchPerfProbeConfig(): Promise<PerfProbeConfig | null> {
  if (!isTauriRuntime()) return null;
  let dto: PerfProbeConfigDto | null;
  try {
    dto = await invoke<PerfProbeConfigDto | null>("platform_get_perf_probe_config");
  } catch {
    return null; // 未启用（无 perf state）或绑定失败：生产路径 no-op
  }
  if (!dto || !isPerfScenario(dto.scenario)) return null;
  return {
    runId: dto.runId,
    scenario: dto.scenario,
    fixtureJson: dto.fixtureJson,
    samples: dto.samples,
    windowGeneration: dto.windowGeneration,
  };
}

export async function reportPerfEvent(
  config: PerfProbeConfig,
  milestone: "renderer-ready" | "scenario-result" | "scenario-failed",
  data?: unknown,
): Promise<void> {
  await invoke("platform_report_perf_event", {
    payload: {
      runId: config.runId,
      windowGeneration: config.windowGeneration,
      milestone,
      data: data === undefined ? null : data,
    },
  });
}

// ---- 交互/帧工具 ----

export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** 等待画布可交互：pane 出现后再过两帧（布局提交）。 */
export async function whenCanvasInteractive(timeoutMs = 30_000): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pane = document.querySelector<HTMLElement>(".react-flow__pane");
    if (pane) {
      await nextFrame();
      await nextFrame();
      return pane;
    }
    if (Date.now() > deadline) throw new Error("perf probe: 画布未在超时内可交互");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 等待画布呈现 expectedNodes 个节点（fixture 加载完成的可观察信号）。 */
export async function whenNodeCountRendered(expected: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const count = document.querySelectorAll(".react-flow__node").length;
    if (count === expected) {
      await nextFrame();
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`perf probe: 画布节点数未达到 ${expected}（当前 ${count}）`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** rAF 帧间隔采样器：start() 后逐帧记录，stop() 返回统计。 */
export function createFrameTracker() {
  const intervals: number[] = [];
  let last: number | null = null;
  let tracking = false;
  function tick(now: number) {
    if (!tracking) return;
    if (last !== null) intervals.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  }
  return {
    start() {
      tracking = true;
      last = null;
      requestAnimationFrame(tick);
    },
    stop() {
      tracking = false;
      return frameStats(intervals);
    },
  };
}

export interface FrameStats {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  samples: number[];
}

export function frameStats(values: number[]): FrameStats {
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const samples = values.map(round1);
  if (samples.length === 0) return { count: 0, p50: null, p95: null, max: null, samples };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (index: number) => sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
  return {
    count: sorted.length,
    p50: at(Math.floor(sorted.length * 0.5)),
    p95: at(Math.floor(sorted.length * 0.95)),
    max: sorted[sorted.length - 1] ?? 0,
    samples,
  };
}

/** FlowResult 各终态的可读描述（cancelled/conflict 无 code 字段）。 */
function describeFlow(result: { kind: string; code?: string; message?: string }): string {
  const detail = [result.code, result.message].filter(Boolean).join(": ");
  return `${result.kind}${detail ? `/${detail}` : ""}`;
}

function pointerEvent(type: string, x: number, y: number, buttons: number): PointerEvent {
  return new PointerEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    buttons,
  });
}

/** 画布平移：pane pointerdown → 连续 pointermove → up（真实 d3-drag 路径）。 */
export async function driveCanvasPan(steps = 30): Promise<void> {
  const pane = document.querySelector<HTMLElement>(".react-flow__pane");
  if (!pane) throw new Error("perf probe: 画布 pane 不存在");
  const rect = pane.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  pane.dispatchEvent(pointerEvent("pointerdown", cx, cy, 1));
  for (let i = 1; i <= steps; i++) {
    window.dispatchEvent(pointerEvent("pointermove", cx + i * 18, cy + i * 6, 1));
    await nextFrame();
  }
  window.dispatchEvent(pointerEvent("pointerup", cx + steps * 18, cy + steps * 6, 0));
}

/** 节点拖动：node pointerdown → 连续 pointermove → up。 */
export async function driveNodeDrag(steps = 30): Promise<void> {
  const node = document.querySelector<HTMLElement>(".react-flow__node");
  if (!node) throw new Error("perf probe: 画布节点不存在");
  const rect = node.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  node.dispatchEvent(pointerEvent("pointerdown", cx, cy, 1));
  for (let i = 1; i <= steps; i++) {
    window.dispatchEvent(pointerEvent("pointermove", cx + i * 12, cy + i * 5, 1));
    await nextFrame();
  }
  window.dispatchEvent(pointerEvent("pointerup", cx + steps * 12, cy + steps * 5, 0));
}

/** 缩放：pane wheel 序列。 */
export async function driveCanvasZoom(steps = 20): Promise<void> {
  const pane = document.querySelector<HTMLElement>(".react-flow__pane");
  if (!pane) throw new Error("perf probe: 画布 pane 不存在");
  const rect = pane.getBoundingClientRect();
  for (let i = 0; i < steps; i++) {
    pane.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -80,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextFrame();
  }
}

// ---- 场景 ----

function loadFixture(config: PerfProbeConfig, deps: PerfScenarioDeps): MindMapDocumentV1 {
  if (!config.fixtureJson) throw new Error("perf probe: 场景缺少 fixture 文档");
  // decodeDocument 消费规范字节（与 open 流程同入口）；host 侧已读文件
  // 内容为 UTF-8 JSON 文本。
  const bytes = new TextEncoder().encode(config.fixtureJson);
  const decoded = decodeDocument(bytes);
  if (!decoded.ok) {
    throw new Error(`perf probe: fixture 解码失败（${decoded.error.code}）`);
  }
  deps.loadDocument(decoded.doc);
  return decoded.doc;
}

async function runCanvasScenario(config: PerfProbeConfig, deps: PerfScenarioDeps) {
  const doc = loadFixture(config, deps);
  await whenNodeCountRendered(doc.document.nodes.length);
  const rounds = Math.max(1, Math.min(config.samples || 20, 100));
  const panStats: FrameStats[] = [];
  const dragStats: FrameStats[] = [];
  const zoomStats: FrameStats[] = [];
  for (let round = 0; round < rounds; round++) {
    const tracker = createFrameTracker();
    tracker.start();
    await driveCanvasPan();
    panStats.push(tracker.stop());
    const dragTracker = createFrameTracker();
    dragTracker.start();
    await driveNodeDrag();
    dragStats.push(dragTracker.stop());
    const zoomTracker = createFrameTracker();
    zoomTracker.start();
    await driveCanvasZoom();
    zoomStats.push(zoomTracker.stop());
  }
  const merge = (stats: FrameStats[]): { count: number; max: number | null } => ({
    count: stats.reduce((sum, item) => sum + item.count, 0),
    max: stats.reduce<number | null>((max, item) => Math.max(max ?? 0, item.max ?? 0), null),
  });
  // p95 以每类动作的全部原始帧间隔复算，再取三类动作最大值；各轮 p95
  // 仅作诊断。不能取“每轮 p95 的最大值”，否则单轮离群会被误报成整体
  // p95，且无法与发布验收器从 raw samples 的独立复算保持一致。
  const panFrameSamples = panStats.flatMap((item) => item.samples);
  const nodeDragFrameSamples = dragStats.flatMap((item) => item.samples);
  const zoomFrameSamples = zoomStats.flatMap((item) => item.samples);
  const frameP95Ms = Math.max(
    frameStats(panFrameSamples).p95 ?? 0,
    frameStats(nodeDragFrameSamples).p95 ?? 0,
    frameStats(zoomFrameSamples).p95 ?? 0,
  );
  return {
    measurementSource: "native-candidate",
    fixtureNodes: doc.document.nodes.length,
    fixtureEdges: doc.document.edges.length,
    rounds,
    pan: merge(panStats),
    nodeDrag: merge(dragStats),
    zoom: merge(zoomStats),
    panRoundP95Ms: panStats.map((item) => item.p95),
    nodeDragRoundP95Ms: dragStats.map((item) => item.p95),
    zoomRoundP95Ms: zoomStats.map((item) => item.p95),
    panFrameSamples,
    nodeDragFrameSamples,
    zoomFrameSamples,
    frameP95Ms,
  };
}

async function runEditScenario(config: PerfProbeConfig, deps: PerfScenarioDeps) {
  const doc = loadFixture(config, deps);
  await whenNodeCountRendered(doc.document.nodes.length);
  const rounds = Math.max(1, Math.min(config.samples || 20, 100));
  const anchor = doc.document.nodes[0];
  if (!anchor) throw new Error("perf probe: fixture 无节点");
  const createSamples: number[] = [];
  const moveSamples: number[] = [];
  const connectSamples: number[] = [];
  const undoSamples: number[] = [];
  const size = { width: anchor.size.width, height: anchor.size.height };
  for (let round = 0; round < rounds; round++) {
    const nodeId = `perf-node-${round}`;
    const edgeId = `perf-edge-${round}`;
    let t0 = performance.now();
    const created = deps.session.commit({
      kind: "CreateNode",
      id: nodeId,
      text: `性能采样 ${round}`,
      position: { x: anchor.position.x + 40 + round * 2, y: anchor.position.y + 40 },
      size,
    });
    if (!created.ok) throw new Error(`perf probe: CreateNode 失败（${created.error.code}）`);
    await nextFrame();
    createSamples.push(performance.now() - t0);

    t0 = performance.now();
    const moved = deps.session.commit({
      kind: "MoveNodes",
      moves: [{ id: nodeId, position: { x: anchor.position.x + 80, y: anchor.position.y + 90 } }],
    });
    if (!moved.ok) throw new Error(`perf probe: MoveNodes 失败（${moved.error.code}）`);
    await nextFrame();
    moveSamples.push(performance.now() - t0);

    t0 = performance.now();
    const connected = deps.session.commit({
      kind: "CreateEdge",
      id: edgeId,
      sourceNodeId: anchor.id,
      targetNodeId: nodeId,
    });
    if (!connected.ok) throw new Error(`perf probe: CreateEdge 失败（${connected.error.code}）`);
    await nextFrame();
    connectSamples.push(performance.now() - t0);

    t0 = performance.now();
    deps.session.undo();
    deps.session.undo();
    deps.session.undo();
    await nextFrame();
    undoSamples.push(performance.now() - t0);
  }
  return {
    measurementSource: "native-candidate",
    rounds,
    fixtureNodes: doc.document.nodes.length,
    createSamples,
    moveSamples,
    connectSamples,
    undoSamples,
    editSamples: [...createSamples, ...moveSamples, ...connectSamples, ...undoSamples],
  };
}

async function runSaveScenario(config: PerfProbeConfig, deps: PerfScenarioDeps) {
  const doc = loadFixture(config, deps);
  await whenNodeCountRendered(doc.document.nodes.length);
  // 首次 Save As 建立 ordinary handle（host perf 旁路授权 env 精确目标）。
  const first = await saveAsFlow(deps.session, { filePort: deps.filePort }, "perf-sample.mindmap");
  if (first.kind !== "ok") {
    throw new Error(`perf probe: 首次 Save As 失败（${describeFlow(first)}）`);
  }
  deps.notifySaved();
  const rounds = Math.max(1, Math.min(config.samples || 20, 100));
  const anchor = doc.document.nodes[0];
  if (!anchor) throw new Error("perf probe: fixture 无节点");
  const anchorId = anchor.id;
  const saveSamples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const edited = deps.session.commit({
      kind: "MoveNodes",
      moves: [{ id: anchorId, position: { x: 20 + round, y: 20 + round } }],
    });
    if (!edited.ok) throw new Error(`perf probe: 保存前编辑失败（${edited.error.code}）`);
    await nextFrame();
    const t0 = performance.now();
    const result = await saveFlow(deps.session, { filePort: deps.filePort });
    const elapsed = performance.now() - t0;
    if (result.kind !== "ok") {
      throw new Error(`perf probe: ordinary save 失败（${describeFlow(result)}）`);
    }
    deps.notifySaved();
    saveSamples.push(elapsed);
  }
  return {
    measurementSource: "native-candidate",
    rounds,
    fixtureNodes: doc.document.nodes.length,
    saveSamples,
  };
}

async function runPngExportScenario(config: PerfProbeConfig, deps: PerfScenarioDeps) {
  const doc = loadFixture(config, deps);
  await whenNodeCountRendered(doc.document.nodes.length);
  // 导出资源（字体/WASM）就绪后再计时（PRC-025 同口径）。PRR-066 起生产
  // 不再预热导出栈：首次 whenReady 触发真实加载，其耗时只作诊断值
  // （resourceLoadMs），绝不混入 2x PNG render p95 样本。
  const resourceLoadStart = performance.now();
  if (deps.renderer.whenReady) await deps.renderer.whenReady();
  const resourceLoadMs = Math.round(performance.now() - resourceLoadStart);
  const rounds = Math.max(1, Math.min(config.samples || 20, 100));
  const pngExportSamples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const t0 = performance.now();
    const result = await exportFlow(
      deps.session,
      { filePort: deps.filePort, renderer: deps.renderer },
      "png",
    );
    const elapsed = performance.now() - t0;
    if (result.kind !== "ok") {
      throw new Error(`perf probe: 2x PNG 导出失败（${describeFlow(result)}）`);
    }
    deps.notifyExported();
    pngExportSamples.push(elapsed);
  }
  return {
    measurementSource: "native-candidate",
    rounds,
    fixtureNodes: doc.document.nodes.length,
    resourceLoadMs,
    pngExportSamples,
  };
}

/** 探针入口：MindMapApp mount 后调用一次；未启用时立即返回。
 * StrictMode 重挂载复用模块级单例（同 windowBootstrapAdapter 模式）——
 * 每 WebView 至多执行一次采样协议。 */
let probeStarted = false;

export async function runPerfProbe(deps: PerfScenarioDeps): Promise<void> {
  if (probeStarted) return;
  probeStarted = true;
  const config = await fetchPerfProbeConfig();
  if (!config) return;
  try {
    await whenCanvasInteractive();
    await reportPerfEvent(config, "renderer-ready");
    switch (config.scenario) {
      case "launch":
      case "rss":
        return; // host 负责（launch 退出 / rss 采样后退出）
      case "canvas":
        await reportPerfEvent(config, "scenario-result", await runCanvasScenario(config, deps));
        return;
      case "edit":
        await reportPerfEvent(config, "scenario-result", await runEditScenario(config, deps));
        return;
      case "save":
        await reportPerfEvent(config, "scenario-result", await runSaveScenario(config, deps));
        return;
      case "png-export":
        await reportPerfEvent(config, "scenario-result", await runPngExportScenario(config, deps));
        return;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await reportPerfEvent(config, "scenario-failed", { reason });
    } catch {
      // 上报失败由 sampler 超时判定；不再抛出避免影响宿主。
    }
  }
}
