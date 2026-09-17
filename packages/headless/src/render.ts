// render.ts — 无头渲染编排（ADR 0014 §1/§4）。
// 文档 → ExportScene → 目标格式字节；PNG 固定 2x（与 GUI 导出一致）。

import { encodeDocument, type MindMapDocumentV1 } from "@mindmap/core";
import { encodeGraphJson, type ExportRenderer } from "@mindmap/export";

export const OUTPUT_FORMATS = ["png", "svg", "pdf", "json", "mindmap"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const FORMAT_EXTENSIONS: Record<OutputFormat, string> = {
  png: ".png",
  svg: ".svg",
  pdf: ".pdf",
  json: ".json",
  mindmap: ".mindmap",
};

export type RenderError = { code: string; message: string };
export type RenderResult =
  { ok: true; bytes: Uint8Array; format: OutputFormat } | { ok: false; error: RenderError };

/** 归一化下游错误（SceneError/FontResourceLimitError 无 message 字段）为 code+message。 */
const normalize = (error: { code: string; message?: string }): RenderError => ({
  code: error.code,
  message: error.message ?? JSON.stringify(error),
});

/** PNG 固定 2x 导出（GUI 与 golden 契约一致）。 */
export const PNG_SCALE = 2;

export async function renderDocument(
  renderer: ExportRenderer,
  doc: MindMapDocumentV1,
  format: OutputFormat,
): Promise<RenderResult> {
  if (format === "mindmap") return { ok: true, bytes: encodeDocument(doc), format };
  if (format === "json") return { ok: true, bytes: encodeGraphJson(doc), format };

  const built = renderer.buildScene(doc);
  if (!built.ok) return { ok: false, error: normalize(built.error) };
  const scene = built.scene;

  if (format === "svg") return { ok: true, bytes: renderer.renderSvg(scene), format };
  if (format === "png") {
    const result = await renderer.renderPng(renderer.renderSvg(scene), scene, PNG_SCALE);
    if (!result.ok) return { ok: false, error: normalize(result.error) };
    return { ok: true, bytes: result.bytes, format };
  }
  const pdf = await renderer.renderPdf(scene);
  if (!pdf.ok) return { ok: false, error: pdf.error };
  return { ok: true, bytes: pdf.bytes, format };
}
