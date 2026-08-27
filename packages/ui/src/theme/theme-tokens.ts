// 主题 tokens（MM-070 ①）：白板/黑板，纯粹极简（PRD §6：纯白与纯黑，
// 无纸张/粉笔质感装饰 [from-user 2026-08-26]）。
// 覆盖 AC-05 的全部状态面：内容、选择、焦点、编辑、连接；非文本图形对比
// ≥ 3:1（WCAG 2.2），正文文本对比 ≥ 4.5:1 —— 对比值由 theme-tokens.test.ts
// 用相对亮度公式实算断言（不引依赖、不靠目测）。
// 文档主题（light/dark）持久化于 core schema 并经 SetDocumentStyle 进入 undo；
// 本 tokens 只负责视觉映射。canvas 接线（背景/边/选择色应用）在 MM-080。

import type { ThemeName } from "@mindmap/core";

export interface ThemeTokens {
  /** 画布背景（纯白/纯黑基调）。 */
  canvasBackground: string;
  /** 节点底色与描边。 */
  nodeBackground: string;
  nodeBorder: string;
  nodeText: string;
  /** 连接线。 */
  edgeStroke: string;
  /** 选择态（框线）。 */
  selectionOutline: string;
  /** 焦点环（键盘可达性）。 */
  focusRing: string;
  /** 编辑态输入底色/光标色（与节点底一致的纯色）。 */
  editingBackground: string;
  editingCaret: string;
  /** 拖动中反馈。 */
  draggingOutline: string;
  /** 引导遮罩与提示卡。 */
  onboardingScrim: string;
  onboardingCardBackground: string;
  onboardingCardBorder: string;
  onboardingCardText: string;
  /** 画布网格点。 */
  backgroundPattern: string;
}

/** 纯白主题（light）。 */
export const LIGHT_TOKENS: ThemeTokens = {
  canvasBackground: "#ffffff",
  nodeBackground: "#ffffff",
  nodeBorder: "#1f2328", // 近黑描边：对纯白底对比 > 12:1
  nodeText: "#1f2328",
  edgeStroke: "#424a53", // 非文本 ≥3:1
  selectionOutline: "#0969da",
  focusRing: "#0969da",
  editingBackground: "#ffffff",
  editingCaret: "#1f2328",
  draggingOutline: "#0969da",
  onboardingScrim: "rgba(31, 35, 40, 0.45)",
  onboardingCardBackground: "#ffffff",
  onboardingCardBorder: "#1f2328",
  onboardingCardText: "#1f2328",
  backgroundPattern: "#d0d7de",
};

/** 纯黑主题（dark）。 */
export const DARK_TOKENS: ThemeTokens = {
  canvasBackground: "#000000",
  nodeBackground: "#0d1117", // 纯黑画布上的节点面
  nodeBorder: "#e6edf3", // 近白描边：对纯黑底对比 > 14:1
  nodeText: "#e6edf3",
  edgeStroke: "#c9d1d9", // 非文本 ≥3:1
  selectionOutline: "#58a6ff",
  focusRing: "#58a6ff",
  editingBackground: "#0d1117",
  editingCaret: "#e6edf3",
  draggingOutline: "#58a6ff",
  onboardingScrim: "rgba(0, 0, 0, 0.55)",
  onboardingCardBackground: "#0d1117",
  onboardingCardBorder: "#e6edf3",
  onboardingCardText: "#e6edf3",
  backgroundPattern: "#30363d",
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
