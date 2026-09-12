// 导出流（MM-080 ⑤）：唯一 renderer owner = web-ts-wasm（G1）。
// 一次性 export 授权 → buildScene → 三视觉格式之一 → commitExport 落盘。
// 不含 UI overlay（selection/onboarding/viewport 绝不进导出，ADR/MM-040 契约）。
// Graph JSON（PRR-070-R2）：第四格式，纯数据序列化（encodeGraphJson），
// 不进渲染管线——不 buildScene、不依赖字体/WASM/画布截图。

import type { DocumentSession } from "@mindmap/core";
import { PlatformError, type FilePort } from "@mindmap/platform";
import type { FontResolver } from "@mindmap/export/src/layout.js";

export type ExportFormat = "graph-json" | "svg" | "png" | "pdf";

/** 导出面板展示顺序与文案（PRR-070-R2 §2.4：Graph JSON 固定首位）。 */
export const EXPORT_PANEL_FORMATS: ReadonlyArray<{ format: ExportFormat; label: string }> = [
  { format: "graph-json", label: "Graph JSON（供 Agent）" },
  { format: "svg", label: "SVG" },
  { format: "png", label: "PNG（2x）" },
  { format: "pdf", label: "PDF" },
];

/** renderer 接口（@mindmap/export ExportRenderer 的结构子集；测试用 fake）。 */
export interface ExportRendererLike {
  buildScene(
    doc: unknown,
  ): Promise<
    { ok: true; scene: unknown } | { ok: false; error: { code: string; message: string } }
  >;
  renderSvg(scene: unknown): Uint8Array | Promise<Uint8Array>;
  renderPng(svgBytes: Uint8Array, scene: unknown): Promise<Uint8Array>;
  renderPdf(scene: unknown): Promise<Uint8Array>;
  /** EditorCanvas 共享 layout 度量（与导出同源）。 */
  fonts(): FontResolver;
  /** 可选：首帧之后预热导出资源，不阻塞画布挂载。 */
  warmup?(): void;
  /** 可选：导出资源就绪通知，用于字体度量切换后的受控重投影。 */
  whenReady?(): Promise<void>;
  /** 可选：字体度量就绪状态（PRC-025）。 */
  fontMetricsState?(): "pending" | "ready" | "failed";
  /** 可选：等待真实字体度量就绪（PRC-025）。 */
  whenMetricsReady?(): Promise<FontResolver>;
}

export type ExportResult =
  | { kind: "ok"; displayPath: string; format: ExportFormat }
  | { kind: "cancelled" }
  | { kind: "error"; code: string; message: string };

/**
 * 导出 renderer 边界的结构化失败（PRR-066）：code 是对外契约（如
 * EXPORT_WASM_UNAVAILABLE / EXPORT_SIZE_LIMIT），message 携带底层原因。
 * renderer 适配层（ports.ts）以此替代裸 Error，避免失败链退化为 UNKNOWN。
 */
export class ExportRendererError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExportRendererError";
    this.code = code;
  }
}

export function exportSuggestedName(session: DocumentSession, format: ExportFormat): string {
  const display = session.displayPath;
  const base = (display?.split(/[\\/]/).pop() ?? "未命名").replace(/\.[^.]*$/, "");
  // graph-json 的稳定扩展名是 .graph.json（双段），不是裸 format 拼接
  if (format === "graph-json") return `${base}.graph.json`;
  return `${base}.${format}`;
}

export async function exportFlow(
  session: DocumentSession,
  deps: { filePort: FilePort; renderer: ExportRendererLike },
  format: ExportFormat,
): Promise<ExportResult> {
  // 目标选择前冻结导出内容（授权对话框期间文档可继续变化，本次导出保持
  // 打开面板那一刻的快照）：
  // - graph-json：直接 encodeGraphJson，不触碰 renderer（buildScene/字体/
  //   WASM/几何全不依赖——renderer 或字体资源不可用时该格式仍可导出）；
  // - 视觉三格式：buildScene 前置（PRR-066 结构化失败在授权前返回）。
  let frozenBytes: Uint8Array | null = null;
  let scene: unknown;
  if (format === "graph-json") {
    // 动态导入与 ports.ts 的 LazyTauriExportRenderer 同模式（ADR 0011：
    // 导出栈不占首屏 entry）；这里只加载纯序列化模块代码——字体/WASM
    // 资源由 renderer 实例在视觉格式路径才加载，本分支零依赖。
    try {
      const { encodeGraphJson } = await import("@mindmap/export");
      frozenBytes = encodeGraphJson(session.current.document);
    } catch (e) {
      return {
        kind: "error",
        code: "GRAPH_JSON_ENCODING_FAILED",
        message: `Graph JSON 编码失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } else {
    const sceneResult = await deps.renderer.buildScene(session.current.document);
    if (!sceneResult.ok)
      return { kind: "error", code: sceneResult.error.code, message: sceneResult.error.message };
    scene = sceneResult.scene;
  }

  let grant;
  try {
    grant = await deps.filePort.requestTargetAuthorization(
      "export",
      exportSuggestedName(session, format),
    );
  } catch (e) {
    return toError(e);
  }
  if (grant === null) return { kind: "cancelled" };

  let bytes: Uint8Array;
  try {
    if (frozenBytes !== null) bytes = frozenBytes;
    else if (format === "svg") bytes = await deps.renderer.renderSvg(scene);
    else if (format === "png")
      bytes = await deps.renderer.renderPng(await deps.renderer.renderSvg(scene), scene);
    else bytes = await deps.renderer.renderPdf(scene);
  } catch (e) {
    return toError(e);
  }

  try {
    const done = await deps.filePort.commitExport(grant.authorizationRef, bytes);
    return { kind: "ok", displayPath: done.displayPath, format };
  } catch (e) {
    return toError(e);
  }
}

function toError(e: unknown): { kind: "error"; code: string; message: string } {
  if (e instanceof PlatformError) return { kind: "error", code: e.code, message: e.message };
  // PRR-066：结构化错误 duck-type 透传（ExportRendererError 及同形错误）。
  // 不用 instanceof 判定 ExportRendererError——perf 探针等动态 import 场景
  // 下模块实例可能不同（resetModules），class 身份不可靠；code 为 string
  // 即视为携带稳定错误码契约，message 保留底层原因。
  if (typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string") {
    const structured = e as { code: string; message?: string };
    return { kind: "error", code: structured.code, message: structured.message ?? String(e) };
  }
  return { kind: "error", code: "UNKNOWN", message: String(e) };
}
