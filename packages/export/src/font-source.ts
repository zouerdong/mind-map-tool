// fontkit 字体度量实现（node 与 WebView 通用——fontkit 是纯 JS）。

import { create as fontkitCreate } from "fontkit";
import type { FontMetrics, FontResolver } from "./layout.js";
import type { FontToken } from "@mindmap/core";

export type ExportFontId = "noto-sans-sc-regular" | "noto-sans-sc-bold" | "lxgw-wenkai-regular";

export interface FontBundle {
  "noto-sans-sc-regular": Uint8Array;
  "noto-sans-sc-bold": Uint8Array;
  "lxgw-wenkai-regular": Uint8Array;
}

/** 导出资源上限：覆盖宿主注入的字体，避免异常资源绕过文档 50MB
 * 上限后在 fontkit/resvg/pdf-lib 内部制造不可控分配。当前仓库字体包
 * 总量约 42MB，预留到 64MB；单字体 32MB 足以容纳现有文楷。 */
export const FONT_RESOURCE_LIMITS = {
  maxBytesPerFont: 32 * 1024 * 1024,
  maxBundleBytes: 64 * 1024 * 1024,
} as const;

export interface FontResourceLimitError {
  code: "EXPORT_FONT_RESOURCE_LIMIT";
  fontId: ExportFontId | null;
  bytes: number;
  max: number;
  message: string;
}

export function validateFontBundle(
  bundle: FontBundle,
): { ok: true } | { ok: false; error: FontResourceLimitError } {
  const entries = Object.entries(bundle) as Array<[ExportFontId, Uint8Array]>;
  let total = 0;
  for (const [fontId, bytes] of entries) {
    const size = bytes.byteLength;
    if (size > FONT_RESOURCE_LIMITS.maxBytesPerFont) {
      return {
        ok: false,
        error: {
          code: "EXPORT_FONT_RESOURCE_LIMIT",
          fontId,
          bytes: size,
          max: FONT_RESOURCE_LIMITS.maxBytesPerFont,
          message: `${fontId} exceeds the per-font resource limit`,
        },
      };
    }
    total += size;
  }
  if (total > FONT_RESOURCE_LIMITS.maxBundleBytes) {
    return {
      ok: false,
      error: {
        code: "EXPORT_FONT_RESOURCE_LIMIT",
        fontId: null,
        bytes: total,
        max: FONT_RESOURCE_LIMITS.maxBundleBytes,
        message: "font bundle exceeds the total resource limit",
      },
    };
  }
  return { ok: true };
}

interface CachedFont {
  unitsPerEm: number;
  ascent: number;
  advanceCache: Map<string, number>;
  glyphWidth(ch: string): number;
}

function loadFont(bytes: Uint8Array): CachedFont {
  // 字节直接传（fontkit create 收 Uint8Array）；禁用 Node Buffer——
  // WKWebView 无 Buffer 全局，曾致 app 初始化崩溃（MM-090 E2E 缺陷 #1）。
  const font = fontkitCreate(bytes);
  const advanceCache = new Map<string, number>();
  return {
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent / font.unitsPerEm,
    advanceCache,
    glyphWidth(ch: string): number {
      let w: number | undefined = advanceCache.get(ch);
      if (w === undefined) {
        const glyph = font.glyphsForString(ch)[0];
        w = glyph ? glyph.advanceWidth : 0;
        advanceCache.set(ch, w);
      }
      return w;
    },
  };
}

function metricsOf(f: CachedFont): FontMetrics {
  return {
    ascentRatio: f.ascent,
    advance(ch: string, fontSize: number): number {
      return (f.glyphWidth(ch) / f.unitsPerEm) * fontSize;
    },
  };
}

export function createFontResolver(bundle: FontBundle): FontResolver {
  const guard = validateFontBundle(bundle);
  if (!guard.ok) throw new Error(guard.error.message);
  const notoRegular = loadFont(bundle["noto-sans-sc-regular"]);
  const notoBold = loadFont(bundle["noto-sans-sc-bold"]);
  const lxgwRegular = loadFont(bundle["lxgw-wenkai-regular"]);
  return {
    regular(fontId: FontToken): FontMetrics {
      return metricsOf(fontId === "lxgw-wenkai" ? lxgwRegular : notoRegular);
    },
    bold(fontId: FontToken): FontMetrics | null {
      // 霞鹜文楷无真粗体 → null（调用方描边/双绘模拟）
      return fontId === "lxgw-wenkai" ? null : metricsOf(notoBold);
    },
  };
}

/** resvg 的 fontBuffers 输入（family 匹配依赖字体内部命名）。 */
export function resvgFontBuffers(bundle: FontBundle): Uint8Array[] {
  return [
    bundle["noto-sans-sc-regular"],
    bundle["noto-sans-sc-bold"],
    bundle["lxgw-wenkai-regular"],
  ];
}

/** SVG font-family 引用名（与 bundle 字体内部 family 对应）。 */
export const SVG_FONT_FAMILY: Record<FontToken, string> = {
  "noto-sans-sc": "Noto Sans SC",
  "lxgw-wenkai": "LXGW WenKai",
};
