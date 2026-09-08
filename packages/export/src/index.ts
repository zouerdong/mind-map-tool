// @mindmap/export — 确定性导出包（web-ts-wasm 唯一 owner，G1 批准）。
// 公共入口：createExportRenderer；UI 与 exporter 共享 layout/visual-style/edge-geometry 契约。
//
// 模块导航：
// - layout.ts         共享文本布局契约（runs 感知）
// - visual-style.ts   视觉样式契约（VRA-040：色板/眉题/圆角/内距/线型 + 节点测量）
// - edge-geometry.ts  边几何契约（VRA-040：端口/路由/形态插值/箭头/零共线检测）
// - font-source.ts    fontkit 度量 + FontBundle + resvg 字节
// - scene.ts          document → ExportScene（纯函数）
// - svg.ts            scene → canonical SVG bytes
// - render-png.ts     SVG → 2x PNG（resvg-wasm）
// - render-pdf.ts     scene → PDF（pdf-lib，单页适合内容）

export const EXPORT_PACKAGE_VERSION = "0.1.0";

export * from "./layout.js";
export * from "./visual-style.js";
export * from "./edge-geometry.js";
export * from "./graph-json.js";
export * from "./font-source.js";
export * from "./scene.js";
export * from "./svg.js";
// PNG/PDF 实现通过 renderer 方法按需加载；避免把 resvg/pdf-lib 送进
// 首次导出模块。需要底层函数的测试/工具直接导入对应文件。

import type { MindMapDocumentV1 } from "@mindmap/core";
import { createFontResolver, SVG_FONT_FAMILY, type FontBundle } from "./font-source.js";
import { buildScene, type ExportScene, type SceneError, type SceneOptions } from "./scene.js";
import { sceneToSvg } from "./svg.js";
import type { PngResult } from "./render-png.js";
import { layoutNodeText, measureNodeBox, type FontResolver, type NodeLayout } from "./layout.js";
import { layoutNodeVisual, measureNodeVisual, type NodeVisualLayout } from "./visual-style.js";
import { planEdgeGeometry, type EdgePlanInput, type EdgeGeometry } from "./edge-geometry.js";
import type { FontToken, MindNode, NodeShape, Size, TextRun } from "@mindmap/core";

export interface ExportRenderer {
  /** 共享布局（UI 编辑完成时计算权威 node size）。 */
  layoutNodeText(text: string, runs: TextRun[] | undefined, fontId: FontToken): NodeLayout;
  measureNodeBox(
    text: string,
    runs: TextRun[] | undefined,
    fontId: FontToken,
  ): { width: number; height: number };
  /** VRA-040 共同绘制契约：双层文案完整节点布局（眉题 + 正文 + 权威尺寸）。 */
  layoutNodeVisual(
    node: Pick<MindNode, "text" | "runs" | "kicker" | "emphasis">,
    shape: NodeShape,
    fontId: FontToken,
  ): NodeVisualLayout;
  /** VRA-040 测量入口：kicker+runs 正文 → 权威卡尺寸（几何编辑事务注入 measured 用）。 */
  measureNodeVisual(node: Pick<MindNode, "text" | "runs" | "kicker">, fontId: FontToken): Size;
  /** VRA-040 边几何：端口/路由/控制点/箭头拓扑（UI 显示坐标与导出 canonical 同源）。 */
  planEdgeGeometry(
    edges: readonly EdgePlanInput[],
    direction: EdgeGeometry["direction"],
    lineMorph: number,
    context?: Parameters<typeof planEdgeGeometry>[3],
  ): Map<string, EdgeGeometry>;
  fontResolver(): FontResolver;
  buildScene(
    doc: MindMapDocumentV1,
    options?: SceneOptions,
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
  const resvgWasm = options.resvgWasm;
  return {
    layoutNodeText: (text, runs, fontId) => layoutNodeText(text, runs, fontId, fonts),
    measureNodeBox: (text, runs, fontId) => measureNodeBox(text, runs, fontId, fonts),
    layoutNodeVisual: (node, shape, fontId) => layoutNodeVisual(node, shape, fontId, fonts),
    measureNodeVisual: (node, fontId) => measureNodeVisual(node, fontId, fonts),
    planEdgeGeometry: (edges, direction, lineMorph, context) =>
      planEdgeGeometry(edges, direction, lineMorph, context),
    fontResolver: () => fonts,
    buildScene: (doc, sceneOptions) =>
      buildScene(doc, fonts, (token) => SVG_FONT_FAMILY[token as FontToken] ?? token, sceneOptions),
    renderSvg: (scene) => sceneToSvg(scene),
    renderPng: async (svgBytes, scene, scale = 2) => {
      if (!resvgWasm) {
        return {
          ok: false,
          error: {
            code: "EXPORT_WASM_UNAVAILABLE",
            message: "PNG 导出所需的 resvg WASM 尚未加载",
          },
        };
      }
      try {
        const { initResvgWasm, renderPng } = await import("./render-png.js");
        await initResvgWasm(resvgWasm);
        return await renderPng(svgBytes, scene, options.fonts, scale);
      } catch (error) {
        // PRR-066：WASM init/render 失败（如 CSP 禁止编译时的
        // CompileError）映射为稳定 code + 底层 message，不得以裸异常
        // 冒泡成 UNKNOWN，也不得吞掉底层原因伪装成资源不存在。
        return {
          ok: false,
          error: {
            code: "EXPORT_WASM_UNAVAILABLE",
            message: `resvg WASM 初始化/渲染失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        };
      }
    },
    renderPdf: async (scene) => {
      const { renderPdf } = await import("./render-pdf.js");
      return renderPdf(scene, options.fonts);
    },
  };
}
