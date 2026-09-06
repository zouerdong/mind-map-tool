// ExportScene：document → 确定性场景（MM-040 ② / VRA-040 共同绘制契约）。
// 视觉（色板/角色/眉题/圆角/内距/线型）来自 visual-style.ts；边几何来自 edge-geometry.ts；
// 本文件只做装配：document + FontResolver → 绝对坐标 items（UI 期望几何与 SVG/PNG/PDF 同源）。
// items 全部绝对坐标；数值 3 位小数、-0 归零；locale/timezone 无关。
// framesVisible=false 时不产 frame 项，文字落到画布墨色（§1.1/§1.2 墨纸互换）。

import type { MindMapDocumentV1, NodeShape } from "@mindmap/core";
import { LAYOUT, type FontResolver } from "./layout.js";
import {
  EDGE_VISUAL,
  VISUAL_PALETTES,
  VISUAL_TYPOGRAPHY,
  edgeAppearance,
  layoutNodeVisual,
  nodeColorsOf,
  nodeRoleOf,
  type ExportTheme,
  type NodeRole,
  type SceneColors,
  type VisualPalette,
} from "./visual-style.js";
import {
  arrowD,
  edgePathD,
  planEdgeGeometry,
  translatePt,
  translatePts,
  type EdgeGeometry,
  type EdgePlanInput,
  type LayoutDirection,
} from "./edge-geometry.js";

export type { ExportTheme, NodeRole, SceneColors };
/** 兼容别名： THEME_TOKENS = VISUAL_PALETTES（v1 消费方沿用旧名，值已切换为暖白/黑板 token）。 */
export const THEME_TOKENS = VISUAL_PALETTES;
export { EDGE_VISUAL } from "./visual-style.js";

export interface SceneSegment {
  text: string;
  x: number; // 绝对
  baselineY: number; // 绝对
  fontSize: number;
  bold: boolean; // 需要真粗体或模拟
  fauxBold: boolean; // 无真粗体字重 → 描边/双绘模拟
  underline: boolean;
  /** 眉题 letter-spacing（px；§1.3 0.06em，正文为 0） */
  letterSpacing: number;
}

export interface SceneEdgeItem {
  kind: "edge";
  d: string; // 主线 path（规整态圆角折线 / 散乱态贝塞尔）
  stroke: string;
  width: number;
  /** null = 实线；否则为 stroke-dasharray 数值（§1.4 虚线 5 4 / 点线 0.1 5） */
  dash: readonly number[] | null;
  roundCap: boolean;
  /** 箭头独立 path（实心三角，进入方向；§1.4 默认有箭头） */
  arrowD: string;
}

export interface SceneFrameRectItem {
  kind: "frame-rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number; // §1.3 圆角 12
  fill: string;
  /** 新视觉为实心卡（无投影无描边，tokens §6）；null = 不描边 */
  stroke: string | null;
}

export interface SceneFrameEllipseItem {
  kind: "frame-ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
  stroke: string | null;
}

export interface SceneTextItem {
  kind: "text";
  segments: SceneSegment[];
  color: string;
  family: string;
}

export interface SceneUnderlineItem {
  kind: "underline";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export type SceneItem =
  | SceneEdgeItem
  | SceneFrameRectItem
  | SceneFrameEllipseItem
  | SceneTextItem
  | SceneUnderlineItem;

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

/** 边形态与方向参数（VRA-040 契约）：导出消费 canonical 终态 → 正交形态 + 默认横向（G-VIS D7）。 */
export interface SceneOptions {
  /** 0 = 散乱曲线，1 = 规整正交圆角折线；导出默认 1（canonical 终态） */
  lineMorph?: number;
  /** 布局方向（端口侧随方向转置）；导出默认 horizontal（organize 默认，VRA-030） */
  direction?: LayoutDirection;
}

export function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

function resolvedShapeOf(node: { shape?: NodeShape }, docShape: NodeShape): NodeShape {
  return node.shape ?? docShape;
}

export function buildScene(
  doc: MindMapDocumentV1,
  fonts: FontResolver,
  familyOf: (token: string) => string,
  options: SceneOptions = {},
): { ok: true; scene: ExportScene } | { ok: false; error: SceneError } {
  const d = doc.document;
  if (d.nodes.length === 0) return { ok: false, error: { code: "EXPORT_EMPTY_DOCUMENT" } };

  const palette: VisualPalette = VISUAL_PALETTES[d.theme];
  const fontToken = d.font;
  const framesVisible = d.framesVisible !== false;
  const lineMorph = options.lineMorph ?? 1;
  const direction = options.direction ?? "horizontal";

  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const boxById = new Map(
    d.nodes.map((n) => [
      n.id,
      { x: n.position.x, y: n.position.y, width: n.size.width, height: n.size.height },
    ]),
  );
  const boxes = [...boxById.values()];

  // ---- 边几何：文档坐标规划 → bounds 计入极值 → 整体平移进画布（offX/offY） ----
  const inputs: EdgePlanInput[] = [];
  const edgeIds: string[] = [];
  for (const e of d.edges) {
    const a = byId.get(e.sourceNodeId);
    const b = byId.get(e.targetNodeId);
    if (!a || !b) continue; // schema 层已拒绝 DANGLING_EDGE；此处保守跳过
    inputs.push({
      id: e.id,
      sourceId: a.id,
      targetId: b.id,
      source: boxById.get(a.id)!,
      target: boxById.get(b.id)!,
    });
    edgeIds.push(e.id);
  }
  const geoms = planEdgeGeometry(inputs, direction, lineMorph, { obstacles: boxes });

  // ---- bounds：卡片 + 边极值（控制点/外弧/箭头）+ 描边留白；负坐标不裁切 ----
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const b of boxes) {
    grow(b.x, b.y);
    grow(b.x + b.width, b.y + b.height);
  }
  const halfStroke =
    Math.max(EDGE_VISUAL.widthPrimary, EDGE_VISUAL.widthSecondary, LAYOUT.strokeWidth) / 2;
  for (const g of geoms.values())
    for (const p of g.extremes) grow(p.x - halfStroke, p.y - halfStroke);

  const m = LAYOUT.contentMargin;
  const offX = -(minX - m);
  const offY = -(minY - m);
  const width = Math.round(maxX - minX + m * 2);
  const height = Math.round(maxY - minY + m * 2);

  const items: SceneItem[] = [];

  // ---- 边（层级最低）：主线 + 独立箭头 path，线型/箭头/端点 gap 全部同源 ----
  for (let i = 0; i < edgeIds.length; i++) {
    const g = geoms.get(edgeIds[i]!);
    if (!g) continue;
    const edge = d.edges[i]!;
    const appear = edgeAppearance(edge.lineStyle ?? "solid", palette);
    items.push({
      kind: "edge",
      d: edgePathD(shift(g, offX, offY), lineMorph),
      stroke: appear.stroke,
      width: appear.width,
      dash: appear.dash,
      roundCap: appear.roundCap,
      arrowD: arrowD({
        tip: translatePt(g.tip, offX, offY),
        arrowBase: [
          translatePt(g.arrowBase[0], offX, offY),
          translatePt(g.arrowBase[1], offX, offY),
        ],
      }),
    });
  }

  // ---- 节点卡 + 双层文本 ----
  for (const n of d.nodes) {
    const x = n.position.x + offX;
    const y = n.position.y + offY;
    const shape = resolvedShapeOf(n, d.shape);
    const role: NodeRole = nodeRoleOf(n);
    const colors = nodeColorsOf(palette, role, framesVisible);
    const visual = layoutNodeVisual(n, shape, d.font, fonts);

    if (framesVisible && colors.fill) {
      if (shape === "ellipse") {
        items.push({
          kind: "frame-ellipse",
          cx: x + n.size.width / 2,
          cy: y + n.size.height / 2,
          rx: n.size.width / 2,
          ry: n.size.height / 2,
          fill: colors.fill,
          stroke: null,
        });
      } else {
        items.push({
          kind: "frame-rect",
          x,
          y,
          w: n.size.width,
          h: n.size.height,
          rx: VISUAL_TYPOGRAPHY.cardRadius,
          fill: colors.fill,
          stroke: null,
        });
      }
    }

    // 文本块在卡内垂直居中（尺寸与测量一致时等价于 padding 对齐；兼容历史持久化尺寸）
    const blockTop = y + Math.max(0, (n.size.height - visual.contentHeight) / 2);
    const family = familyOf(fontToken);
    const hasRealBold = (bold: boolean) => bold && fonts.bold(d.font) !== null;

    // 眉题层（§1.3：11px、上行、letter-spacing 0.06em；空眉题不渲染，卡高自然收缩）
    const k = visual.kicker;
    if (k) {
      items.push({
        kind: "text",
        color: colors.kicker,
        family,
        segments: [
          {
            text: k.text,
            x: k.x + x,
            baselineY: blockTop + k.baselineY,
            fontSize: k.fontSize,
            bold: false,
            fauxBold: false,
            underline: false,
            letterSpacing: k.letterSpacing,
          },
        ],
      });
    }

    // 正文层（§1.3：16px、行高 1.4、runs 感知、左对齐于 paddingX）
    const bodySegments: SceneSegment[] = [];
    const underlineItems: SceneItem[] = [];
    let lineTop = blockTop + visual.bodyTop;
    for (const line of visual.lines) {
      const baselineAbs = lineTop + line.baselineOffset;
      const lineX = x + VISUAL_TYPOGRAPHY.paddingX;
      for (const seg of line.segments) {
        const segAbsX = lineX + seg.startX;
        bodySegments.push({
          text: seg.text,
          x: segAbsX,
          baselineY: baselineAbs,
          fontSize: seg.fontSize,
          bold: seg.bold,
          fauxBold: seg.bold && !hasRealBold(seg.bold),
          underline: seg.underline,
          letterSpacing: 0,
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
    if (bodySegments.length > 0)
      items.push({ kind: "text", segments: bodySegments, color: colors.text, family });
    items.push(...underlineItems);
  }

  return { ok: true, scene: { empty: false, theme: d.theme, width, height, fontToken, items } };
}

function shift(g: EdgeGeometry, dx: number, dy: number): EdgeGeometry {
  return {
    ...g,
    start: translatePt(g.start, dx, dy),
    tip: translatePt(g.tip, dx, dy),
    lineEnd: translatePt(g.lineEnd, dx, dy),
    arrowBase: [translatePt(g.arrowBase[0], dx, dy), translatePt(g.arrowBase[1], dx, dy)],
    controls: [translatePt(g.controls[0], dx, dy), translatePt(g.controls[1], dx, dy)],
    chain: translatePts(g.chain, dx, dy),
    extremes: translatePts(g.extremes, dx, dy),
  };
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
