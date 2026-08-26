// canonical SVG 序列化（MM-040 ②）：语义元素、固定属性顺序、无 foreignObject。
// runs → <text>/<tspan>（显式 x）；下划线为显式 <line>；模拟粗体为描边。

import type { ExportScene } from "./scene.js";
import { num } from "./scene.js";
import { LAYOUT } from "./layout.js";
import { THEME_TOKENS } from "./scene.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sceneToSvg(scene: ExportScene): Uint8Array {
  const t = THEME_TOKENS[scene.theme];
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
  );
  parts.push(`<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${t.bg}"/>`);

  for (const item of scene.items) {
    switch (item.kind) {
      case "edge":
        parts.push(
          `<path d="${item.d}" fill="none" stroke="${item.stroke}" stroke-width="${num(LAYOUT.strokeWidth)}"/>`,
        );
        break;
      case "frame-rect":
        parts.push(
          `<rect x="${num(item.x)}" y="${num(item.y)}" width="${num(item.w)}" height="${num(item.h)}" rx="6" fill="${item.fill}" stroke="${item.stroke}" stroke-width="1"/>`,
        );
        break;
      case "frame-ellipse":
        parts.push(
          `<ellipse cx="${num(item.cx)}" cy="${num(item.cy)}" rx="${num(item.rx)}" ry="${num(item.ry)}" fill="${item.fill}" stroke="${item.stroke}" stroke-width="1"/>`,
        );
        break;
      case "text": {
        if (item.segments.length === 0) break;
        const first = item.segments[0]!;
        const tspans = item.segments.map((seg) => {
          const attrs = [`x="${num(seg.x)}"`];
          if (seg.fontSize !== LAYOUT.baseFontSize) attrs.push(`font-size="${num(seg.fontSize)}"`);
          if (seg.bold) attrs.push(`font-weight="700"`);
          if (seg.fauxBold) {
            attrs.push(
              `stroke="${item.color}" stroke-width="${num(seg.fontSize * LAYOUT.fauxBoldStrokeRatio)}"`,
            );
          }
          return `<tspan ${attrs.join(" ")}>${esc(seg.text)}</tspan>`;
        });
        parts.push(
          `<text y="${num(first.baselineY)}" fill="${item.color}" font-family="${esc(item.family)}" font-size="${LAYOUT.baseFontSize}">${tspans.join("")}</text>`,
        );
        break;
      }
      case "underline":
        parts.push(
          `<line x1="${num(item.x1)}" y1="${num(item.y1)}" x2="${num(item.x2)}" y2="${num(item.y2)}" stroke="${item.color}" stroke-width="${LAYOUT.underlineThickness}"/>`,
        );
        break;
    }
  }
  parts.push("</svg>");
  return new TextEncoder().encode(parts.join("\n") + "\n");
}
