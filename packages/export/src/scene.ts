// ExportScene：document → 确定性场景（MM-040 ②）。
// items 全部绝对坐标；数值 3 位小数、-0 归零；locale/timezone 无关。
// 纯白/纯黑双主题（[from-user] 停点C）；framesVisible=false 时不产 frame 项。

import type { MindMapDocumentV1, NodeShape } from "@mindmap/core";
import { LAYOUT, layoutNodeText, type FontResolver } from "./layout.js";

export type ExportTheme = "light" | "dark";

export interface SceneColors {
  bg: string;
  frameFill: string;
  frameStroke: string;
  text: string;
  edge: string;
}

export const THEME_TOKENS: Record<ExportTheme, SceneColors> = {
  light: {
    bg: "#ffffff",
    frameFill: "#ffffff",
    frameStroke: "#1a1a1a",
    text: "#1a1a1a",
    edge: "#75746f",
  },
  dark: {
    bg: "#000000",
    frameFill: "#000000",
    frameStroke: "#f2f2f2",
    text: "#f2f2f2",
    edge: "#8a8f99",
  },
};

export interface SceneSegment {
  text: string;
  x: number; // 绝对
  baselineY: number; // 绝对
  fontSize: number;
  bold: boolean; // 需要真粗体或模拟
  fauxBold: boolean; // 无真粗体字重 → 描边/双绘模拟
  underline: boolean;
}

export type SceneItem =
  | { kind: "edge"; d: string; stroke: string }
  | { kind: "frame-rect"; x: number; y: number; w: number; h: number; fill: string; stroke: string }
  | {
      kind: "frame-ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill: string;
      stroke: string;
    }
  | { kind: "text"; segments: SceneSegment[]; color: string; family: string }
  | { kind: "underline"; x1: number; y1: number; x2: number; y2: number; color: string };

export interface ExportScene {
  empty: boolean;
  theme: ExportTheme;
  width: number;
  height: number;
  fontToken: string;
  items: SceneItem[];
}

export type SceneError =
  | { code: "EXPORT_EMPTY_DOCUMENT" }
  | { code: "EXPORT_SIZE_LIMIT"; w: number; h: number; maxPixels: number; maxSide: number };

export const SIZE_LIMITS = { maxPixels: 120_000_000, maxSide: 32_767 } as const;

export function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

function nodeShapeOf(node: { shape?: NodeShape }, doc: MindMapDocumentV1): NodeShape {
  return node.shape ?? doc.document.shape;
}

export function buildScene(
  doc: MindMapDocumentV1,
  fonts: FontResolver,
  familyOf: (token: string) => string,
): { ok: true; scene: ExportScene } | { ok: false; error: SceneError } {
  const d = doc.document;
  if (d.nodes.length === 0) return { ok: false, error: { code: "EXPORT_EMPTY_DOCUMENT" } };

  const colors = THEME_TOKENS[d.theme];
  const fontToken = d.font;

  // content bounds（含节点尺寸权威值）
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of d.nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.size.width);
    maxY = Math.max(maxY, n.position.y + n.size.height);
  }
  const m = LAYOUT.contentMargin;
  const offX = -(minX - m);
  const offY = -(minY - m);
  const width = Math.round(maxX - minX + m * 2);
  const height = Math.round(maxY - minY + m * 2);

  const items: SceneItem[] = [];

  // 边（层级最低）
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  for (const e of d.edges) {
    const a = byId.get(e.sourceNodeId);
    const b = byId.get(e.targetNodeId);
    if (!a || !b) continue;
    const x1 = a.position.x + a.size.width / 2 + offX;
    const y1 = a.position.y + a.size.height / 2 + offY;
    const x2 = b.position.x + b.size.width / 2 + offX;
    const y2 = b.position.y + b.size.height / 2 + offY;
    const dx = (x2 - x1) / 2;
    items.push({
      kind: "edge",
      d: `M ${num(x1)} ${num(y1)} C ${num(x1 + dx)} ${num(y1)}, ${num(x2 - dx)} ${num(y2)}, ${num(x2)} ${num(y2)}`,
      stroke: colors.edge,
    });
  }

  // 节点框 + 文本
  const framesVisible = d.framesVisible !== false;
  for (const n of d.nodes) {
    const x = n.position.x + offX;
    const y = n.position.y + offY;
    const shape = nodeShapeOf(n, doc);

    if (framesVisible) {
      if (shape === "ellipse") {
        items.push({
          kind: "frame-ellipse",
          cx: x + n.size.width / 2,
          cy: y + n.size.height / 2,
          rx: n.size.width / 2,
          ry: n.size.height / 2,
          fill: colors.frameFill,
          stroke: colors.frameStroke,
        });
      } else {
        items.push({
          kind: "frame-rect",
          x,
          y,
          w: n.size.width,
          h: n.size.height,
          fill: colors.frameFill,
          stroke: colors.frameStroke,
        });
      }
    }

    // 文本布局（runs 感知）；行水平居中、块垂直居中于节点框
    const layout = layoutNodeText(n.text, n.runs, d.font, fonts);
    const blockH = layout.height + LAYOUT.paddingY * 2;
    let lineTop = y + (n.size.height - blockH) / 2 + LAYOUT.paddingY;
    const textSegments: SceneSegment[] = [];
    const underlineItems: SceneItem[] = [];
    for (const line of layout.lines) {
      const baselineAbs = lineTop + line.baselineOffset;
      const lineX = x + LAYOUT.paddingX + (layout.width - line.width) / 2;
      for (const seg of line.segments) {
        const segAbsX = lineX + seg.startX;
        const requestedBold = seg.bold;
        const hasRealBold = requestedBold && fonts.bold(d.font) !== null;
        textSegments.push({
          text: seg.text,
          x: segAbsX,
          baselineY: baselineAbs,
          fontSize: seg.fontSize,
          bold: requestedBold,
          fauxBold: requestedBold && !hasRealBold,
          underline: seg.underline,
        });
        if (seg.underline) {
          underlineItems.push({
            kind: "underline",
            x1: segAbsX,
            y1: baselineAbs + LAYOUT.underlineGap,
            x2: segAbsX + seg.width,
            y2: baselineAbs + LAYOUT.underlineGap,
            color: colors.text,
          });
        }
      }
      lineTop += line.height;
    }
    items.push({
      kind: "text",
      segments: textSegments,
      color: colors.text,
      family: familyOf(fontToken),
    });
    items.push(...underlineItems);
  }

  return { ok: true, scene: { empty: false, theme: d.theme, width, height, fontToken, items } };
}

/** 2x PNG 前置尺寸守卫（MM-040 ③：分配大内存前拒绝）。 */
export function checkExportSize(
  scene: ExportScene,
  scale: number,
):
  | { ok: true; w: number; h: number }
  | { ok: false; error: { code: "EXPORT_SIZE_LIMIT"; w: number; h: number } } {
  const w = scene.width * scale;
  const h = scene.height * scale;
  if (w > SIZE_LIMITS.maxSide || h > SIZE_LIMITS.maxSide || w * h > SIZE_LIMITS.maxPixels) {
    return { ok: false, error: { code: "EXPORT_SIZE_LIMIT", w, h } };
  }
  return { ok: true, w, h };
}
