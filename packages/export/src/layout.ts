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
 *  字号/行高只影响测量与几何，不改变 runs 解析语义。
 *  wrapWidth：软换行内容宽度上限（px，不含 padding）；缺省不换行（只认显式 \n）。
 *  OFR-2026-09-15（负责人 dogfood：长文本节点失焦后显示不全）：G-VIS §1.3 卡宽
 *  上限 260 的语义是超出即折行、卡片纵向生长，而非无限加宽；折行偏好词边界
 * （行内最后空格后断开），无空格（CJK 长句）按字符硬折。 */
export interface TextLayoutProfile {
  baseFontSize?: number;
  lineHeightFactor?: number;
  wrapWidth?: number;
}

/** 带样式的字符原子（折行中间表示；样式按 runs 全局偏移解析）。 */
interface LayoutAtom {
  ch: string;
  st: SegmentStyle;
  adv: number;
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
  const wrapWidth = profile.wrapWidth;
  const regular = fonts.regular(fontId);
  const bold = fonts.bold(fontId);
  const fontSizeOf = (st: SegmentStyle) => st.fontSize ?? baseFontSize;
  // R2-F3：区分语义粗体与字重度量选择——请求 bold 保留在段上（scene 派生
  // fauxBold 分支），缺真粗体字面时用 regular 度量。
  const metricsFor = (st: SegmentStyle) => (st.bold === true ? (bold ?? regular) : regular);

  /** 原子序列 → 行：相邻同样式合并为段，startX 累加，行高取行内最大字号。 */
  const buildLine = (atoms: LayoutAtom[]): LayoutLine => {
    const segments: LayoutSegment[] = [];
    let cur: LayoutAtom[] = [];
    const flushSeg = () => {
      if (cur.length === 0) return;
      const st = cur[0]!.st;
      let width = 0;
      for (const a of cur) width += a.adv;
      segments.push({
        text: cur.map((a) => a.ch).join(""),
        startX: 0,
        width,
        fontSize: fontSizeOf(st),
        bold: st.bold === true,
        underline: st.underline === true,
      });
      cur = [];
    };
    for (const a of atoms) {
      if (cur.length > 0 && !sameStyle(cur[0]!.st, a.st)) flushSeg();
      cur.push(a);
    }
    flushSeg();
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
    return { segments, height, baselineOffset, width: x };
  };

  const lines: LayoutLine[] = [];
  let globalBase = 0; // 行首在完整 text 中的偏移（runs 使用全局偏移）
  for (const raw of text.split("\n")) {
    const atoms: LayoutAtom[] = [];
    for (let i = 0; i < raw.length; i++) {
      const st = styleAt(runs, globalBase + i); // 全局偏移
      atoms.push({ ch: raw[i]!, st, adv: metricsFor(st).advance(raw[i]!, fontSizeOf(st)) });
    }
    if (wrapWidth === undefined || atoms.length === 0) {
      lines.push(buildLine(atoms));
    } else {
      // 贪心折行：不变式为已累积行宽 ≤ wrapWidth（空行才接受的超宽单字符除外）。
      // 行内存在空格时在最后空格后断开（拉丁词边界），否则字符级硬折（CJK）。
      let start = 0;
      let width = 0;
      let lastSpace = -1;
      let widthThroughSpace = 0;
      for (let i = 0; i < atoms.length; i++) {
        const a = atoms[i]!;
        while (i > start && width + a.adv > wrapWidth) {
          if (lastSpace >= 0) {
            lines.push(buildLine(atoms.slice(start, lastSpace + 1)));
            width -= widthThroughSpace; // 后缀（空格之后）宽度 ≤ wrapWidth，不变式保持
            start = lastSpace + 1;
            lastSpace = -1; // 后缀在最后一个空格之后，不含空格
            widthThroughSpace = 0;
          } else {
            lines.push(buildLine(atoms.slice(start, i)));
            width = 0;
            start = i;
          }
        }
        width += a.adv;
        if (a.ch === " ") {
          lastSpace = i;
          widthThroughSpace = width;
        }
      }
      lines.push(buildLine(atoms.slice(start)));
    }
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
