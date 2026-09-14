// DFR-090 F2：正文编辑的 runs 区间映射（既有 TextRun [start,end) 区间模型，
// 见 packages/core/src/schema.ts）。
//
// 问题：正文编辑提交不带 runs 时 core 按既定命令语义清除全部样式——整节点
// 粗体/字号/下划线在续写一个字后丢失；原样套旧索引又在文本长度变化后错位。
//
// 规则：
// 1. 整节点统一样式（runs 完全覆盖 [0, oldLen) 且属性一致，含 stepFontSize
//    产生的多段同属性）→ 新文本全域保留同一样式（含全量替换）。
// 2. 混合 runs → 以前缀/后缀 diff 定位变更区间，run 边界按区间映射：
//    变更点前不变、变更区后平移、落在变更区内折叠；插入点落在 run 内部时
//    run 扩展覆盖新文本（常见编辑器惯例）；空 run 丢弃、相邻同属性合并。
// 3. 结果为空或新文本为空 → undefined（core 语义：清除 runs）。

import type { TextRun } from "@mindmap/core";

type RunAttrs = Pick<TextRun, "bold" | "underline" | "fontSize">;

function attrsOf(run: TextRun): RunAttrs {
  const attrs: RunAttrs = {};
  if (run.bold !== undefined) attrs.bold = run.bold;
  if (run.underline !== undefined) attrs.underline = run.underline;
  if (run.fontSize !== undefined) attrs.fontSize = run.fontSize;
  return attrs;
}

function sameAttrs(a: RunAttrs, b: RunAttrs): boolean {
  return a.bold === b.bold && a.underline === b.underline && a.fontSize === b.fontSize;
}

/** runs 是否以同一组属性完整覆盖 [0, textLen)（整节点样式语义）。 */
function uniformCoverage(runs: readonly TextRun[], textLen: number): RunAttrs | null {
  if (textLen <= 0 || runs.length === 0) return null;
  const attrs = attrsOf(runs[0]!);
  let cursor = 0;
  for (const run of runs) {
    if (run.start !== cursor) return null; // 覆盖必须连续无缺口
    if (!sameAttrs(attrs, attrsOf(run))) return null;
    cursor = run.end;
  }
  return cursor === textLen ? attrs : null;
}

export function remapRunsForTextChange(
  oldText: string,
  runs: readonly TextRun[] | undefined,
  newText: string,
): TextRun[] | undefined {
  if (!runs || runs.length === 0 || newText.length === 0) return undefined;

  // 整节点统一样式：任何正文变更（含全量替换）都保留全域样式。
  const uniform = uniformCoverage(runs, oldText.length);
  if (uniform) return [{ start: 0, end: newText.length, ...uniform }];

  // 前缀/后缀 diff 定位变更区间 old[prefix, oldLen-suffix) → new[prefix, newLen-suffix)
  const oldLen = oldText.length;
  const newLen = newText.length;
  let prefix = 0;
  const maxPrefix = Math.min(oldLen, newLen);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(oldLen, newLen) - prefix;
  while (suffix < maxSuffix && oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]) {
    suffix += 1;
  }
  const oldChangeEnd = oldLen - suffix;
  const delta = newLen - oldLen;

  // start/end 边界规则不同：插入点恰在 run 起点时，新文本在 run 之前
  //（起点平移）；恰在 run 终点时，新文本不并入 run（终点不动）。
  const mapStart = (pos: number): number => {
    if (pos < prefix) return pos;
    if (pos >= oldChangeEnd) return pos + delta;
    return prefix;
  };
  const mapEnd = (pos: number): number => {
    if (pos <= prefix) return pos;
    if (pos >= oldChangeEnd) return pos + delta;
    return prefix; // 落在变更区内 → 折叠到变更起点
  };

  const mapped: TextRun[] = [];
  for (const run of runs) {
    const start = mapStart(run.start);
    const end = mapEnd(run.end);
    if (end <= start) continue; // 空 run 丢弃
    const prev = mapped[mapped.length - 1];
    if (prev && prev.end === start && sameAttrs(attrsOf(prev), attrsOf(run))) {
      prev.end = end; // 相邻同属性合并，保持区间模型整洁
      continue;
    }
    mapped.push({ start, end, ...attrsOf(run) });
  }
  return mapped.length > 0 ? mapped : undefined;
}

/** R2-F2：把 [0, textLength) 分割为已有 runs 与未覆盖空隙（空隙为
 *  默认属性空集），供整节点格式命令在全文本域上操作。 */
export function segmentTextRuns(
  textLength: number,
  runs: readonly TextRun[] | undefined,
): TextRun[] {
  if (textLength <= 0) return [];
  const segments: TextRun[] = [];
  let cursor = 0;
  for (const run of runs ?? []) {
    if (run.start > cursor) segments.push({ start: cursor, end: run.start });
    segments.push({ ...run });
    cursor = run.end;
  }
  if (cursor < textLength) segments.push({ start: cursor, end: textLength });
  return segments;
}

/** R2-F2：合并相邻同属性段（整节点格式翻转/步进后保持区间模型整洁）。 */
export function mergeAdjacentRuns(runs: readonly TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (run.end <= run.start) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.end === run.start && sameAttrs(attrsOf(prev), attrsOf(run))) {
      prev.end = run.end;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

/** 整节点统一样式 → 编辑态渲染样式（textarea 只能呈现单一排版；
 *  混合 runs 返回 null，编辑态退回纯文本渲染，提交后样式仍由映射保留）。 */
export function uniformRunsStyle(
  runs: readonly TextRun[] | undefined,
  textLength: number,
): { fontSize?: number; bold?: boolean; underline?: boolean } | null {
  if (!runs) return null;
  const uniform = uniformCoverage(runs, textLength);
  if (!uniform) return null;
  const style: { fontSize?: number; bold?: boolean; underline?: boolean } = {};
  if (uniform.fontSize !== undefined) style.fontSize = uniform.fontSize;
  if (uniform.bold !== undefined) style.bold = uniform.bold;
  if (uniform.underline !== undefined) style.underline = uniform.underline;
  return style;
}
