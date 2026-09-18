// 主题 tokens（VRA-050 ①）：G-VIS 定稿视觉（docs/product/visual-state-tokens-2026-09-06.md
// §1.1 暖白工作态 / §1.2 黑板同构，2026-09-06 用户逐项校准）。
// 覆盖旧「纯白/纯黑 + 蓝色选择」MM-070 方案（该方案随 G-VIS 裁决退役，见 tokens §5 D1）。
//
// 同源约束：色值与 packages/export/src/visual-style.ts（LIGHT_PALETTE/DARK_PALETTE/
// VISUAL_TYPOGRAPHY/EDGE_VISUAL，VRA-040 契约）逐项一致 —— ui 侧经 @mindmap/export
// 直接消费同一份常数（packages/ui/package.json 已有该 workspace 依赖），不复制第二份；
// 同步防线见 test/visual-contract.test.ts（ui tokens ↔ export palette 对照断言）。
//
// 对比度按 WCAG 2.2 相对亮度公式实算断言（theme-tokens.test.ts，不引依赖、不靠目测）：
// 正文 ≥4.5:1；眉题为辅助文字 ≥3:1；非文本图形（线/选中/焦点/端口）≥3:1。
// 状态区分不靠颜色单通道：选中=描边、主选=角标记、焦点=环（§2/§3，形状双通道）。

import type { ThemeName } from "@mindmap/core";

export interface ThemeTokens {
  /** 画布底（§1.1 canvas.light / §1.2 canvas.dark）。平坦无纹理、无常驻点阵。 */
  canvasBackground: string;
  /** 普通卡：实心填充 + 正文 + 眉题（无投影无描边，§1.1）。 */
  cardNormalFill: string;
  cardNormalText: string;
  cardNormalKicker: string;
  /** 深度阶梯（ADR 0020）：depth=3 深灰 / depth≥4 浅灰；深色主题镜像。depth 1–2 复用 cardNormal*。 */
  cardDepth3Fill: string;
  cardDepth3Text: string;
  cardDepth3Kicker: string;
  cardDepth4Fill: string;
  cardDepth4Text: string;
  cardDepth4Kicker: string;
  /** depth≥4 卡描边（ADR 0020 第二轮：镜像描边——暖白白卡黑边 / 黑板黑卡白边）。 */
  cardDepth4Stroke: string;
  /** 强调卡（用户手动角色，橙卡不随主题反转，§1.2）。 */
  cardAccentFill: string;
  cardAccentText: string;
  cardAccentKicker: string;
  /** 卡圆角（§1.3 12px；与 export VISUAL_TYPOGRAPHY.cardRadius 同源）。 */
  cardRadius: number;
  /** 连线：主（实线）/ 次（虚线、点线）。 */
  edgePrimary: string;
  edgeSecondary: string;
  /** 状态：选中描边 / 键盘焦点环 / 拖动反馈 / hover 连接端口（同一橙 token，§1.1 原则）。 */
  selectionOutline: string;
  /** 选中高亮（2026-09-18 [from-user]）：与出发点橙卡同 hue 的选中描边 + 外发光环。
   *  描边用产品橙 #D97757（呼应语义优先，2.94:1 略低于 3:1 图形基线——可见性由
   *  发光环通道承担）；发光环为半透明橙。 */
  selectionAccent: string;
  selectionAccentHalo: string;
  focusRing: string;
  draggingOutline: string;
  hoverPort: string;
  /** framesVisible=false 纯文字态：画布上的正文/眉题色（墨/纸互换）。 */
  canvasInk: string;
  canvasKicker: string;
  /** 编辑态文本光标（§2 编辑中：对卡底 14.6:1）。 */
  editingCaret: string;
  /** shell 文字（顶栏/菜单/提示）与次要文字。 */
  shellText: string;
  shellSubtle: string;
  /** 引导遮罩与提示卡。 */
  onboardingScrim: string;
  onboardingCardBackground: string;
  onboardingCardBorder: string;
  onboardingCardText: string;
}

/** §1.1 暖白工作态（light）。 */
export const LIGHT_TOKENS: ThemeTokens = {
  canvasBackground: "#F9F8F4",
  cardNormalFill: "#141412",
  cardNormalText: "#F5F2EA",
  cardNormalKicker: "#A8A296",
  // ADR 0020 色值定稿（2026-09-18 负责人原型过目）：阶梯间距拉大——
  // depth3 = 高级暖灰（浅字），depth4+ = 白卡墨字（与暖白画布仍可辨）。
  cardDepth3Fill: "#57524B",
  cardDepth3Text: "#F5F2EA",
  cardDepth3Kicker: "#C9C4B8",
  cardDepth4Fill: "#FFFFFF",
  cardDepth4Text: "#141412",
  cardDepth4Kicker: "#8A8478",
  cardDepth4Stroke: "#141412",
  cardAccentFill: "#D97757",
  cardAccentText: "#331708",
  cardAccentKicker: "#5C2F1A",
  cardRadius: 12,
  edgePrimary: "#4A4640",
  edgeSecondary: "#8A8478",
  selectionOutline: "#D06B47",
  selectionAccent: "#D97757",
  selectionAccentHalo: "rgba(217, 119, 87, 0.25)",
  focusRing: "#D06B47",
  draggingOutline: "#D06B47",
  hoverPort: "#D06B47",
  canvasInk: "#141412",
  canvasKicker: "#8A8478",
  editingCaret: "#F5F2EA",
  shellText: "#3B372F",
  shellSubtle: "#8A8478",
  onboardingScrim: "rgba(20, 20, 18, 0.45)",
  onboardingCardBackground: "#FFFFFF",
  onboardingCardBorder: "#141412",
  onboardingCardText: "#141412",
};

/** §1.2 黑板同构（dark）：卡片实心镜像反转、同一橙强调、深底亮线。 */
export const DARK_TOKENS: ThemeTokens = {
  canvasBackground: "#16140F",
  cardNormalFill: "#EFEAE0",
  cardNormalText: "#141412",
  cardNormalKicker: "#7A7264",
  cardDepth3Fill: "#B4AEA0",
  cardDepth3Text: "#141412",
  cardDepth3Kicker: "#575146",
  cardDepth4Fill: "#141412",
  cardDepth4Text: "#F5F2EA",
  cardDepth4Kicker: "#A39C8E",
  cardDepth4Stroke: "#EFEAE0",
  cardAccentFill: "#D97757",
  cardAccentText: "#331708",
  cardAccentKicker: "#5C2F1A", // §1.2 未单列 → 沿用 light（与 export DARK_PALETTE 一致）
  cardRadius: 12,
  edgePrimary: "#A39C8E",
  edgeSecondary: "#6B655A",
  selectionOutline: "#D06B47",
  selectionAccent: "#D97757",
  selectionAccentHalo: "rgba(217, 119, 87, 0.32)",
  focusRing: "#D06B47",
  draggingOutline: "#D06B47",
  hoverPort: "#D06B47",
  canvasInk: "#EFEAE0",
  canvasKicker: "#A39C8E",
  editingCaret: "#141412",
  shellText: "#EFEAE0",
  shellSubtle: "#A39C8E",
  onboardingScrim: "rgba(0, 0, 0, 0.55)",
  onboardingCardBackground: "#201D17",
  onboardingCardBorder: "#EFEAE0",
  onboardingCardText: "#EFEAE0",
};

export function themeTokens(theme: ThemeName): ThemeTokens {
  return theme === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
}

// ---- 对比度工具（测试与设计声明共用） ----

/** 相对亮度（WCAG 2.x 定义；sRGB 8 位 hex）。 */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`hex 颜色格式错误：${hex}`);
  const n = m[1]!;
  const channel = (i: number) => {
    const c = parseInt(n.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** 对比度（1..21）。 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
