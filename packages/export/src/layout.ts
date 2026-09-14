// 共享文本布局契约（MM-040 ①）：UI 与 exporter 唯一使用的排版实现。
// runs 感知：同一行内可有不同字号/加粗/下划线；行高 = 行内最大字号 × 1.5。
// 只认显式 \n 换行；node size 由本契约产生（持久化权威），exporter 不重测。
// 纯函数 + 注入字体度量：平台无关、确定性（无 locale/timezone 依赖）。

import type { FontToken, TextRun } from "@mindmap/core";

export interface SegmentStyle {
  bold?: boolean;
  underline?: boolean;
  fontSize?: number;
}

export interface LayoutSegment {
  text: string;
  startX: number; // 相对节点内容区左缘
  width: number;
  fontSize: number;
  bold: boolean;
  underline: boolean;
}

export interface LayoutLine {
  segments: LayoutSegment[];
  height: number;
  baselineOffset: number; // 行顶到 baseline 的距离
  width: number;
}

export interface NodeLayout {
  lines: LayoutLine[];
  width: number; // 内容区宽度（不含 padding）
  height: number; // 内容区高度（不含 padding）
}

/** 字体度量抽象（fontkit 实现见 font-source.ts；测试可注入 fake）。 */
export interface FontMetrics {
  advance(ch: string, fontSize: number): number;
  ascentRatio: number; // ascent / unitsPerEm
}

export interface FontResolver {
  regular(fontId: FontToken): FontMetrics;
  /** 无真粗体（如霞鹜文楷）返回 null —— 调用方用描边/双绘模拟 */
  bold(fontId: FontToken): FontMetrics | null;
}

export const LAYOUT = {
  baseFontSize: 14,
  lineHeightFactor: 1.5,
  paddingX: 10,
  paddingY: 8,
  contentMargin: 40,
  strokeWidth: 1.5,
  underlineGap: 2, // baseline 到下划线的距离
  underlineThickness: 1,
  fauxBoldStrokeRatio: 1 / 32, // 模拟粗体描边宽 = fontSize × 此值
  fauxBoldPdfOffset: 0.25, // PDF 模拟粗体双绘偏移（pt）
} as const;

function styleAt(runs: TextRun[] | undefined, offset: number): SegmentStyle {
  if (!runs) return {};
  for (const run of runs) {
    if (offset >= run.start && offset < run.end) {
      const st: SegmentStyle = {};
      if (run.bold !== undefined) st.bold = run.bold;
      if (run.underline !== undefined) st.underline = run.underline;
      if (run.fontSize !== undefined) st.fontSize = run.fontSize;
      return st;
    }
  }
  return {};
}

function sameStyle(a: SegmentStyle, b: SegmentStyle): boolean {
  return a.bold === b.bold && a.underline === b.underline && a.fontSize === b.fontSize;
}

/** 排版 profile：覆盖默认字号/行高（visual-style 的 v2 排版由此注入，缺省沿用 LAYOUT）。
 *  字号/行高只影响测量与几何，不改变 runs 解析与换行语义（仍只认显式 \n）。 */
export interface TextLayoutProfile {
  baseFontSize?: number;
  lineHeightFactor?: number;
}

/** 布局一个节点的文本：text + runs → 行/段几何。 */
export function layoutNodeText(
  text: string,
  runs: TextRun[] | undefined,
  fontId: FontToken,
  fonts: FontResolver,
  profile: TextLayoutProfile = {},
): NodeLayout {
  const baseFontSize = profile.baseFontSize ?? LAYOUT.baseFontSize;
  const lineHeightFactor = profile.lineHeightFactor ?? LAYOUT.lineHeightFactor;
  const regular = fonts.regular(fontId);
  const bold = fonts.bold(fontId);
  const lines: LayoutLine[] = [];
  const rawLines = text.split("\n");

  let globalBase = 0; // 行首在完整 text 中的偏移（runs 使用全局偏移）
  for (const raw of rawLines) {
    const segments: LayoutSegment[] = [];
    let currentText = "";
    let currentStyle: SegmentStyle = raw.length > 0 ? styleAt(runs, globalBase) : {};
    let currentStart = 0;

    const flush = (endExclusive: number) => {
      if (currentText.length === 0) return;
      const fontSize = currentStyle.fontSize ?? baseFontSize;
      // R2-F3：区分语义粗体与字重度量选择——用户请求的 bold 必须保留在段上
      //（scene 据此派生 fauxBold 模拟分支；PRD §5.1 文楷无真粗体用描边模拟），
      // 缺真粗体字面时用 regular 度量，不得把请求标记一并抹掉。
      const requestedBold = currentStyle.bold === true;
      const metrics = requestedBold ? (bold ?? regular) : regular;
      let width = 0;
      for (const ch of currentText) width += metrics.advance(ch, fontSize);
      segments.push({
        text: currentText,
        startX: 0, // 稍后统一累加
        width,
        fontSize,
        bold: requestedBold,
        underline: currentStyle.underline === true,
      });
      void endExclusive;
      currentText = "";
    };

    for (let i = 0; i < raw.length; i++) {
      const st = styleAt(runs, globalBase + i); // 全局偏移
      if (!sameStyle(st, currentStyle)) {
        flush(i);
        currentStyle = st;
        currentStart = i;
      }
      currentText += raw[i]!;
    }
    flush(raw.length);
    void currentStart;

    // 行内 startX 累加
    let x = 0;
    for (const seg of segments) {
      seg.startX = x;
      x += seg.width;
    }

    const maxFontSize = segments.reduce<number>((m, s) => Math.max(m, s.fontSize), baseFontSize);
    const ascentRatio =
      segments.length > 0 ? maxAscentRatio(segments, regular, bold) : regular.ascentRatio;
    const height = maxFontSize * lineHeightFactor;
    const baselineOffset = (height - maxFontSize) / 2 + maxFontSize * ascentRatio;
    lines.push({ segments, height, baselineOffset, width: x });
    globalBase += raw.length + 1; // +1 跳过换行符
  }

  const width = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const height = lines.reduce((s, l) => s + l.height, 0);
  return { lines, width, height };
}

function maxAscentRatio(
  segments: LayoutSegment[],
  regular: FontMetrics,
  bold: FontMetrics | null,
): number {
  let ratio = regular.ascentRatio;
  for (const seg of segments) {
    if (seg.bold && bold) ratio = Math.max(ratio, bold.ascentRatio);
  }
  return ratio;
}

/** UI 侧计算节点权威 size（EditNodeText/CreateNode 命令携带）。 */
export function measureNodeBox(
  text: string,
  runs: TextRun[] | undefined,
  fontId: FontToken,
  fonts: FontResolver,
): { width: number; height: number } {
  const layout = layoutNodeText(text, runs, fontId, fonts);
  return {
    width: round3(layout.width + LAYOUT.paddingX * 2),
    height: round3(layout.height + LAYOUT.paddingY * 2),
  };
}

function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}
