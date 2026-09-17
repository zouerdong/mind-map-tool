// request.ts — 渲染请求契约与落盘编排（CLI 与 MCP bridge 共用，ADR 0014 §4）。
// fail-closed：格式枚举、显式文件路径、扩展名与格式一致、父目录已存在。

import { writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, extname, basename } from "node:path";
import type { FontToken, OrganizeDirection } from "@mindmap/core";
import type { ExportRenderer } from "@mindmap/export";
import { buildDocumentFromOutline } from "./outline.js";
import { renderDocument, OUTPUT_FORMATS, FORMAT_EXTENSIONS, type OutputFormat } from "./render.js";

export interface RenderRequest {
  outline: unknown;
  outPath: string;
  format?: OutputFormat;
  font?: FontToken;
  direction?: OrganizeDirection;
  /** 默认 true：同时写出同名 .mindmap 源文件（format=mindmap 时主输出即源文件）。 */
  saveSource?: boolean;
  /** 默认 true：根节点强调角色。 */
  emphasisRoot?: boolean;
  /** 默认 true：horizontal 时使用宽而浅自适应分栏布局；非单根树自动回退。 */
  wide?: boolean;
}

export type RenderFileResult =
  | {
      ok: true;
      out: string;
      source: string | null;
      format: OutputFormat;
      bytes: number;
      nodes: number;
      edges: number;
      layout: "wide" | "layered";
      columns: number;
    }
  | { ok: false; error: { code: string; message: string } };

export async function renderOutlineToFile(
  renderer: ExportRenderer,
  request: RenderRequest,
): Promise<RenderFileResult> {
  const fail = (code: string, message: string): RenderFileResult => ({
    ok: false,
    error: { code, message },
  });

  const format: OutputFormat = request.format ?? "png";
  if (!OUTPUT_FORMATS.includes(format))
    return fail("BAD_ARGS", `format 必须是 ${OUTPUT_FORMATS.join("/")}（实际 ${request.format}）`);
  if (typeof request.outPath !== "string" || request.outPath.trim().length === 0)
    return fail("BAD_OUT_PATH", "outPath 缺失或为空");

  const outPath = resolve(request.outPath);
  if (extname(outPath) !== FORMAT_EXTENSIONS[format])
    return fail(
      "BAD_OUT_PATH",
      `输出扩展名必须是 ${FORMAT_EXTENSIONS[format]}（format=${format}）`,
    );
  const parent = dirname(outPath);
  if (!existsSync(parent) || !statSync(parent).isDirectory())
    return fail("BAD_OUT_PATH", `输出父目录不存在：${parent}`);

  const built = buildDocumentFromOutline(renderer, request.outline, {
    ...(request.font !== undefined ? { font: request.font } : {}),
    ...(request.direction !== undefined ? { direction: request.direction } : {}),
    ...(request.emphasisRoot !== undefined ? { emphasisRoot: request.emphasisRoot } : {}),
    ...(request.wide !== undefined ? { wide: request.wide } : {}),
  });
  if (!built.ok) return fail(built.error.code, JSON.stringify(built.error));

  const rendered = await renderDocument(renderer, built.document, format);
  if (!rendered.ok) return fail(rendered.error.code, rendered.error.message);
  writeFileSync(outPath, rendered.bytes);

  let sourcePath: string | null = null;
  if ((request.saveSource ?? true) && format !== "mindmap") {
    const src = await renderDocument(renderer, built.document, "mindmap");
    if (!src.ok) return fail(src.error.code, src.error.message);
    sourcePath = resolve(parent, `${basename(outPath, extname(outPath))}.mindmap`);
    writeFileSync(sourcePath, src.bytes);
  }

  return {
    ok: true,
    out: outPath,
    source: sourcePath,
    format,
    bytes: rendered.bytes.length,
    nodes: built.nodeCount,
    edges: built.edgeCount,
    layout: built.layout,
    columns: built.columns,
  };
}
