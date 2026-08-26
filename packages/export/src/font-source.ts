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

interface CachedFont {
  unitsPerEm: number;
  ascent: number;
  advanceCache: Map<string, number>;
  glyphWidth(ch: string): number;
}

function loadFont(bytes: Uint8Array): CachedFont {
  const font = fontkitCreate(Buffer.from(bytes)); // 内存字节用 create（openSync 只收路径）
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
