// canonical SVG 序列化（MM-040 ② / VRA-040）：语义元素、固定属性顺序、无 foreignObject。
// runs → <text>/<tspan>；每个 tspan 携带各自 x/y（多行不再共用首行 baseline）；
// 下划线为显式 <line>；模拟粗体为描边；虚/点线为 stroke-dasharray；箭头为独立实心 path。

import type { ExportScene } from "./scene.js";
import { num } from "./scene.js";
import { THEME_TOKENS } from "./scene.js";
import { LAYOUT } from "./layout.js";

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
  parts.push(`<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${t.canvas}"/>`);

  for (const item of scene.items) {
    switch (item.kind) {
      case "edge": {
        const dash = item.dash ? ` stroke-dasharray="${item.dash.map(num).join(" ")}"` : "";
        const cap = item.roundCap ? ` stroke-linecap="round"` : "";
        parts.push(
          `<path d="${item.d}" fill="none" stroke="${item.stroke}" stroke-width="${num(item.width)}"${dash}${cap}/>`,
        );
        parts.push(`<path d="${item.arrowD}" fill="${item.stroke}" stroke="none"/>`);
        break;
      }
      case "frame-rect": {
        const stroke = item.stroke
          ? ` stroke="${item.stroke}" stroke-width="1"`
          : ` stroke="none"`;
        parts.push(
          `<rect x="${num(item.x)}" y="${num(item.y)}" width="${num(item.w)}" height="${num(item.h)}" rx="${num(item.rx)}" fill="${item.fill}"${stroke}/>`,
        );
        break;
      }
      case "frame-ellipse": {
        const stroke = item.stroke
          ? ` stroke="${item.stroke}" stroke-width="1"`
          : ` stroke="none"`;
        parts.push(
          `<ellipse cx="${num(item.cx)}" cy="${num(item.cy)}" rx="${num(item.rx)}" ry="${num(item.ry)}" fill="${item.fill}"${stroke}/>`,
        );
        break;
      }
      case "text": {
        if (item.segments.length === 0) break;
        const first = item.segments[0]!;
        const baseSize = first.fontSize;
        const tspans = item.segments.map((seg) => {
          const attrs = [`x="${num(seg.x)}"`, `y="${num(seg.baselineY)}"`];
          if (seg.fontSize !== baseSize) attrs.push(`font-size="${num(seg.fontSize)}"`);
          if (seg.letterSpacing !== 0) attrs.push(`letter-spacing="${num(seg.letterSpacing)}"`);
          if (seg.bold) attrs.push(`font-weight="700"`);
          if (seg.fauxBold) {
            attrs.push(
              `stroke="${item.color}" stroke-width="${num(seg.fontSize * LAYOUT.fauxBoldStrokeRatio)}"`,
            );
          }
          return `<tspan ${attrs.join(" ")}>${esc(seg.text)}</tspan>`;
        });
        parts.push(
          `<text x="${num(first.x)}" y="${num(first.baselineY)}" fill="${item.color}" font-family="${esc(item.family)}" font-size="${num(baseSize)}">${tspans.join("")}</text>`,
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
