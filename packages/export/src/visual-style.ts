// 视觉样式契约（VRA-040 ①）：UI 与三格式导出唯一消费的视觉事实源。
// 全部数值逐项来自 docs/product/visual-state-tokens-2026-09-06.md（G-VIS 2026-09-06 已校准），
// 不在渲染器内另设常数；颜色/圆角/内距/字号的注释均标注来源 §x.x。
// 纯函数 + 注入字体度量：平台无关、确定性（无 locale/timezone/DOM 依赖）。

import type { FontToken, LineStyle, MindNode, NodeShape, Size } from "@mindmap/core";
import { layoutNodeText, type FontResolver, type LayoutLine } from "./layout.js";

export type ExportTheme = "light" | "dark";

/** 节点色彩角色（ADR 0010：用户手动设置、不自动派生；缺省 normal）。 */
export type NodeRole = "normal" | "accent";

/** 主题色板。light = 暖白方案（§1.1）；dark = 黑板同构（§1.2）。 */
export interface VisualPalette {
  /** 画布底（§1.1 canvas.light / §1.2 canvas.dark） */
  canvas: string;
  /** 普通节点实心填充（§1.1 card.normal.fill / §1.2 粉笔白亮卡） */
  cardNormalFill: string;
  /** 普通卡正文（§1.1 card.normal.text / §1.2 反转） */
  cardNormalText: string;
  /** 普通卡眉题（§1.1 card.normal.kicker / §1.2 亮卡深眉题） */
  cardNormalKicker: string;
  /** 强调节点实心填充（橙，两主题不随主题反转，§1.2） */
  cardAccentFill: string;
  /** 强调卡正文（深字，两主题同值） */
  cardAccentText: string;
  /** 强调卡眉题（§1.1 card.accent.kicker；§1.2 未单列 → 沿用 light） */
  cardAccentKicker: string;
  /** 主关系线（实线）（§1.1 edge.primary / §1.2 深底亮线） */
  edgePrimary: string;
  /** 虚线/点线（次要关系）（§1.1 edge.secondary / §1.2 edge.secondary） */
  edgeSecondary: string;
  /** framesVisible=false（纯文字态）画布上的正文色：墨/纸互换（取各主题卡底色） */
  canvasInk: string;
  /** framesVisible=false 画布上的眉题色（辅助文字，对所在底 ≥3:1） */
  canvasKicker: string;
}

/** §1.1 暖白方案（精确 token 值）。 */
export const LIGHT_PALETTE: VisualPalette = {
  canvas: "#F9F8F4",
  cardNormalFill: "#141412",
  cardNormalText: "#F5F2EA",
  cardNormalKicker: "#A8A296",
  cardAccentFill: "#D97757",
  cardAccentText: "#331708",
  cardAccentKicker: "#5C2F1A",
  edgePrimary: "#4A4640",
  edgeSecondary: "#8A8478",
  canvasInk: "#141412",
  canvasKicker: "#8A8478", // = §1.1 shell.subtle/edge.secondary（对 #F9F8F4 3.4:1，眉题辅助线 ≥3:1）
};

/** §1.2 黑板同构方案（原型初值，G-VIS "展示后定"）。 */
export const DARK_PALETTE: VisualPalette = {
  canvas: "#16140F",
  cardNormalFill: "#EFEAE0",
  cardNormalText: "#141412",
  cardNormalKicker: "#7A7264",
  cardAccentFill: "#D97757",
  cardAccentText: "#331708",
  cardAccentKicker: "#5C2F1A",
  edgePrimary: "#A39C8E",
  edgeSecondary: "#6B655A",
  canvasInk: "#EFEAE0",
  canvasKicker: "#A39C8E",
};

export const VISUAL_PALETTES: Record<ExportTheme, VisualPalette> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
};

/** 兼容别名：scene/svg/pdf 以 SceneColors 消费同一份色板。 */
export type SceneColors = VisualPalette;

/** §1.3 排版与几何 token。 */
export const VISUAL_TYPOGRAPHY = {
  /** 眉题字号（§1.3 眉题字号 11px） */
  kickerFontSize: 11,
  /** 眉题行高 = 11 × 1.3（§1.3 行高 1.3） */
  kickerLineHeight: 14.3,
  /** 眉题 letter-spacing = 11px × 0.06em（§1.3 letter-spacing 0.06em；近似参考的等宽观感） */
  kickerLetterSpacing: 0.66,
  /** 正文字号（§1.3 正文字号 16px） */
  bodyFontSize: 16,
  /** 正文行高系数 = 1.4（§1.3 行高 1.4 → 16 × 1.4 = 22.4） */
  bodyLineHeightFactor: 1.4,
  /** 卡内左右内距（§1.3 内距 左右 16px） */
  paddingX: 16,
  /** 眉题顶内距（§1.3 眉题顶 12） */
  paddingTop: 12,
  /** 眉题-正文间距（§1.3 gap 6） */
  kickerBodyGap: 6,
  /** 正文底内距（§1.3 正文底 12） */
  paddingBottom: 12,
  /** 卡圆角（§1.3 圆角 12px；§1.4 拐角 r≈12 同源） */
  cardRadius: 12,
  /** 卡宽自适应下限（§1.3 卡宽基准 188px，内容自适应 120–260） */
  cardMinWidth: 120,
  /** 卡宽自适应上限（同上；本契约无软换行，超宽内容按内容延展而非截断） */
  cardMaxWidth: 260,
} as const;

/** §1.4 连线外观 token（几何/路由常量见 edge-geometry.ts）。 */
export const EDGE_VISUAL = {
  /** 主线宽（§1.4 线宽 2px） */
  widthPrimary: 2,
  /** 次要线宽（§1.4 次要线 1.5px） */
  widthSecondary: 1.5,
  /** 虚线 dash（§1.4 次线型 虚线 5 4） */
  dashDashed: [5, 4] as const,
  /** 点线 dash + round cap（§1.4 点线 0.1 5 + round cap） */
  dashDotted: [0.1, 5] as const,
  /** 箭头长（§1.4 实心三角，长 9） */
  arrowLength: 9,
  /** 箭头半宽（§1.4 宽 7） */
  arrowHalfWidth: 3.5,
  /** 端点 gap：卡边界外留缝（§1.4 端点 gap 4px） */
  endpointGap: 4,
  /** 规整态拐角圆角 r（§1.4 拐点圆角 r≈12px） */
  filletRadius: 12,
} as const;

/** 边的最终外观（色 + 宽 + dash + 端帽），scene/svg/pdf 三方消费同一结果。 */
export interface EdgeAppearance {
  stroke: string;
  width: number;
  /** null = 实线；否则为 SVG stroke-dasharray / PDF borderDashArray 数值 */
  dash: readonly number[] | null;
  /** 点线 round cap（§1.4） */
  roundCap: boolean;
}

export function edgeAppearance(style: LineStyle, palette: VisualPalette): EdgeAppearance {
  if (style === "dashed")
    return {
      stroke: palette.edgeSecondary,
      width: EDGE_VISUAL.widthSecondary,
      dash: EDGE_VISUAL.dashDashed,
      roundCap: false,
    };
  if (style === "dotted")
    return {
      stroke: palette.edgeSecondary,
      width: EDGE_VISUAL.widthSecondary,
      dash: EDGE_VISUAL.dashDotted,
      roundCap: true,
    };
  return {
    stroke: palette.edgePrimary,
    width: EDGE_VISUAL.widthPrimary,
    dash: null,
    roundCap: false,
  };
}

export function nodeRoleOf(node: Pick<MindNode, "emphasis">): NodeRole {
  return node.emphasis === true ? "accent" : "normal";
}

/** 角色与 frame visibility 共同决定卡底/正文/眉题三色（§1.1、§1.2；D3 眉题可选）。 */
export function nodeColorsOf(
  palette: VisualPalette,
  role: NodeRole,
  framesVisible: boolean,
): { fill: string | null; text: string; kicker: string } {
  if (!framesVisible) return { fill: null, text: palette.canvasInk, kicker: palette.canvasKicker };
  if (role === "accent")
    return {
      fill: palette.cardAccentFill,
      text: palette.cardAccentText,
      kicker: palette.cardAccentKicker,
    };
  return {
    fill: palette.cardNormalFill,
    text: palette.cardNormalText,
    kicker: palette.cardNormalKicker,
  };
}

export interface KickerLayout {
  text: string;
  /** 相对内容块左缘（= paddingX，§1.3） */
  x: number;
  /** 相对内容块顶的 baseline（不含 paddingTop —— scene 以块顶定位） */
  baselineY: number;
  width: number; // 含 letter-spacing（测量与导出同源）
  fontSize: number;
  letterSpacing: number;
}

export interface NodeVisualLayout {
  role: NodeRole;
  shape: NodeShape;
  kicker: KickerLayout | null; // D3：空眉题不渲染，卡高自然收缩
  /** 正文行（runs 感知；startX 相对内容区左缘，与 layoutNodeText 语义一致） */
  lines: LayoutLine[];
  /** 正文块顶相对内容块顶（= kicker 行高 + gap；不含 paddingTop） */
  bodyTop: number;
  /** kicker(+gap)+正文 的内容总高（不含 padding） */
  contentHeight: number;
  /** 权威卡尺寸：UI 几何编辑事务与导出共用（渲染不静默改持久化尺寸） */
  measured: Size;
}

function cardWidthOf(contentWidth: number): number {
  const natural = contentWidth + VISUAL_TYPOGRAPHY.paddingX * 2;
  if (natural <= VISUAL_TYPOGRAPHY.cardMaxWidth)
    return Math.max(VISUAL_TYPOGRAPHY.cardMinWidth, natural);
  return natural;
}

function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * 完整节点视觉布局：眉题（11px 上行）+ 正文（16px runs 感知）双层（§1.3）。
 * 返回相对节点框的几何与权威尺寸 —— UI 卡片、SVG、PDF 消费同一份结果。
 */
export function layoutNodeVisual(
  node: Pick<MindNode, "text" | "runs" | "kicker" | "emphasis">,
  shape: NodeShape,
  fontId: FontToken,
  fonts: FontResolver,
): NodeVisualLayout {
  const body = layoutNodeText(node.text, node.runs, fontId, fonts, {
    baseFontSize: VISUAL_TYPOGRAPHY.bodyFontSize,
    lineHeightFactor: VISUAL_TYPOGRAPHY.bodyLineHeightFactor,
  });

  const kickerText = node.kicker ?? "";
  let kicker: KickerLayout | null = null;
  let kickerWidth = 0;
  if (kickerText.length > 0) {
    const regular = fonts.regular(fontId);
    const fs = VISUAL_TYPOGRAPHY.kickerFontSize;
    const ls = VISUAL_TYPOGRAPHY.kickerLetterSpacing;
    let w = 0;
    for (const ch of kickerText) w += regular.advance(ch, fs) + ls;
    kickerWidth = w;
    kicker = {
      text: kickerText,
      x: VISUAL_TYPOGRAPHY.paddingX,
      baselineY: (VISUAL_TYPOGRAPHY.kickerLineHeight - fs) / 2 + fs * regular.ascentRatio,
      width: w,
      fontSize: fs,
      letterSpacing: ls,
    };
  }

  const contentHeight =
    (kicker ? VISUAL_TYPOGRAPHY.kickerLineHeight + VISUAL_TYPOGRAPHY.kickerBodyGap : 0) +
    body.height;
  const contentWidth = Math.max(kickerWidth, body.width);

  return {
    role: nodeRoleOf(node),
    shape,
    kicker,
    lines: body.lines,
    bodyTop:
      kicker === null ? 0 : VISUAL_TYPOGRAPHY.kickerLineHeight + VISUAL_TYPOGRAPHY.kickerBodyGap,
    contentHeight,
    measured: {
      width: round3(cardWidthOf(contentWidth)),
      height: round3(
        VISUAL_TYPOGRAPHY.paddingTop + contentHeight + VISUAL_TYPOGRAPHY.paddingBottom,
      ),
    },
  };
}

/** 共享节点测量入口（供 VRA-020/050 的几何编辑事务注入 measured 尺寸使用）。
 *  shape 不影响尺寸（card/ellipse 共用同一文本测量），传 "card" 即可。 */
export function measureNodeVisual(
  node: Pick<MindNode, "text" | "runs" | "kicker">,
  fontId: FontToken,
  fonts: FontResolver,
): Size {
  return layoutNodeVisual(node, "card", fontId, fonts).measured;
}
