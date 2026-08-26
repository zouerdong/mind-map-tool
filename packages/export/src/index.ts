// @mindmap/export — 确定性导出包（web-ts-wasm 唯一 owner，G1 批准）。
// 公共入口：createExportRenderer；UI 与 exporter 共享 layoutNodeText/measureNodeBox。
//
// 模块导航：
// - layout.ts       共享文本布局契约（runs 感知）
// - font-source.ts  fontkit 度量 + FontBundle + resvg 字节
// - scene.ts        document → ExportScene（纯函数）
// - svg.ts          scene → canonical SVG bytes
// - render-png.ts   SVG → 2x PNG（resvg-wasm）
// - render-pdf.ts   scene → PDF（pdf-lib，单页适合内容）

export const EXPORT_PACKAGE_VERSION = "0.1.0";

export * from "./layout.js";
export * from "./font-source.js";
export * from "./scene.js";
export * from "./svg.js";
export * from "./render-png.js";
export * from "./render-pdf.js";

import type { MindMapDocumentV1 } from "@mindmap/core";
import { createFontResolver, SVG_FONT_FAMILY, type FontBundle } from "./font-source.js";
import { buildScene, type ExportScene, type SceneError } from "./scene.js";
import { sceneToSvg } from "./svg.js";
import { renderPng, initResvgWasm, type PngResult } from "./render-png.js";
import { renderPdf } from "./render-pdf.js";
import { layoutNodeText, measureNodeBox, type FontResolver, type NodeLayout } from "./layout.js";
import type { FontToken, TextRun } from "@mindmap/core";

export interface ExportRenderer {
  /** 共享布局（UI 编辑完成时计算权威 node size）。 */
  layoutNodeText(text: string, runs: TextRun[] | undefined, fontId: FontToken): NodeLayout;
  measureNodeBox(
    text: string,
    runs: TextRun[] | undefined,
    fontId: FontToken,
  ): { width: number; height: number };
  fontResolver(): FontResolver;
  buildScene(
    doc: MindMapDocumentV1,
  ): { ok: true; scene: ExportScene } | { ok: false; error: SceneError };
  renderSvg(scene: ExportScene): Uint8Array;
  renderPng(svgBytes: Uint8Array, scene: ExportScene, scale?: number): Promise<PngResult>;
  renderPdf(
    scene: ExportScene,
  ): Promise<
    { ok: true; bytes: Uint8Array } | { ok: false; error: { code: string; message: string } }
  >;
}

export interface CreateRendererOptions {
  /** 三款字体字节（宿主注入：Node 读 assets/fonts，WebView 打包资源）。 */
  fonts: FontBundle;
  /** resvg wasm 二进制（宿主注入；仅 PNG 需要）。 */
  resvgWasm?: Uint8Array;
}

export async function createExportRenderer(
  options: CreateRendererOptions,
): Promise<ExportRenderer> {
  const fonts = createFontResolver(options.fonts);
  if (options.resvgWasm) await initResvgWasm(options.resvgWasm);
  return {
    layoutNodeText: (text, runs, fontId) => layoutNodeText(text, runs, fontId, fonts),
    measureNodeBox: (text, runs, fontId) => measureNodeBox(text, runs, fontId, fonts),
    fontResolver: () => fonts,
    buildScene: (doc) =>
      buildScene(doc, fonts, (token) => SVG_FONT_FAMILY[token as FontToken] ?? token),
    renderSvg: (scene) => sceneToSvg(scene),
    renderPng: (svgBytes, scene, scale = 2) => renderPng(svgBytes, scene, options.fonts, scale),
    renderPdf: async (scene) => renderPdf(scene, options.fonts),
  };
}
