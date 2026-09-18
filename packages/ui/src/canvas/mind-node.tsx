// 节点渲染（VRA-050）：视觉与 exporter 同源——行/段几何来自共享
// layoutNodeVisual（packages/export，含眉题+正文两层），palette 与
// theme-tokens / export visual-style 同一事实源（G-VIS 定稿）。
// 实心卡（普通近黑/强调橙）、无投影无描边、圆角 12；状态双通道：
// 选中=描边、主选/焦点=角标记+环（形状区分，不靠颜色深浅）。
// 尺寸由 core size 权威决定（RF 不测量）。

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FontToken } from "@mindmap/core";
import { layoutNodeVisual, VISUAL_TYPOGRAPHY } from "@mindmap/export/src/visual-style.js";
import { depthTierOf, measureNodeVisual } from "@mindmap/export/src/visual-style.js";
import { LAYOUT, type FontResolver } from "@mindmap/export/src/layout.js";
import { themeTokens } from "../theme/theme-tokens.js";
import type { MindFlowNode } from "../projection/projection.js";
import { remapRunsForTextChange, uniformRunsStyle } from "../controller/runs-remap.js";
import { NodeTextEditor } from "./node-text-editor.js";

interface MindNodeViewProps extends NodeProps {
  data: MindFlowNode["data"];
  fonts: FontResolver;
  editing: boolean;
  /** 键盘焦点（MM-089 焦点环）。 */
  focused?: boolean;
  /** 键盘连线模式的当前候选（高亮）。 */
  linkCandidate?: boolean;
  onCommitEdit(id: string, text: string): void;
  onCancelEdit(): void;
}

function MindNodeViewImpl({
  id,
  data,
  selected,
  dragging,
  fonts,
  editing,
  focused,
  linkCandidate,
  onCommitEdit,
  onCancelEdit,
}: MindNodeViewProps) {
  // 眉题 + 正文两层排版（export 同源；无眉题自然单层）
  const layout = layoutNodeVisual(
    {
      text: data.text,
      ...(data.runs !== undefined ? { runs: data.runs } : {}),
      ...(data.kicker !== undefined && data.kicker.length > 0 ? { kicker: data.kicker } : {}),
    },
    data.shape,
    data.font,
    fonts,
  );
  const t = themeTokens(data.theme);
  const accent = data.emphasis === true;
  // DFR-020：隐藏框线（framesVisible=false）必须实际隐藏填充并切换到画布
  // 墨色/眉题色（与 export nodeColorsOf 同语义），此前 UI 忽略该字段。
  const frameless = data.framesVisible === false;
  // ADR 0020：普通卡按深度阶梯取色（depth3 深灰 / depth4+ 浅灰；孤立与 depth 1–2 保持
  // 现状普通色）；强调橙卡优先级最高、frameless 纯文字态不受阶梯影响。
  const tier = depthTierOf(data.depth);
  const fill = frameless
    ? "transparent"
    : accent
      ? t.cardAccentFill
      : tier === "depth4"
        ? t.cardDepth4Fill
        : tier === "depth3"
          ? t.cardDepth3Fill
          : t.cardNormalFill;
  const text = frameless
    ? t.canvasInk
    : accent
      ? t.cardAccentText
      : tier === "depth4"
        ? t.cardDepth4Text
        : tier === "depth3"
          ? t.cardDepth3Text
          : t.cardNormalText;
  const kicker = frameless
    ? t.canvasKicker
    : accent
      ? t.cardAccentKicker
      : tier === "depth4"
        ? t.cardDepth4Kicker
        : tier === "depth3"
          ? t.cardDepth3Kicker
          : t.cardNormalKicker;
  const isEllipse = data.shape === "ellipse";
  const primary = selected || focused; // 主选/焦点：角标记
  // OFR-2026-09-14 #6：无真粗体字体（文楷 bold()=null）的语义粗体段不能用
  // fontWeight 700——浏览器合成加粗比 regular 度量更宽，SVG 视口会裁掉尾部
  // （用户实测：idea 框里文字显示不全）。与导出 scene.fauxBold 同一契约：
  // 描边模拟（stroke + fontSize×1/32），不用合成粗体。
  const hasRealBold = fonts.bold(data.font) !== null;
  // 编辑态实时尺寸（用户实测 2026-08-29：编辑框长大了、节点框没长，文字溢出框外）。
  const [editBox, setEditBox] = useState<{ width: number; height: number } | null>(null);

  const textStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  };

  // 角标记（主选/键盘焦点；形状通道，色弱可辨）
  const corner = 9;
  const corners: Array<[number, number, number, number]> = [
    [-6, -6, 1, 1],
    [1, -6, -1, 1],
    [-6, 1, 1, -1],
    [1, 1, -1, -1],
  ];

  return (
    <div
      style={{
        width: editing && editBox ? `max(100%, ${editBox.width}px)` : "100%",
        height: editing && editBox ? `max(100%, ${editBox.height}px)` : "100%",
        boxSizing: "border-box",
        background: fill,
        borderRadius: isEllipse ? "50%" : t.cardRadius,
        position: "relative",
        outline: linkCandidate
          ? `3px solid ${t.hoverPort}`
          : selected
            ? `2px solid ${t.selectionAccent}`
            : focused
              ? `2px solid ${t.focusRing}`
              : dragging
                ? `1.5px dashed ${t.draggingOutline}`
                : "none",
        outlineOffset: 3,
        // boxShadow 复合（互不干扰）：depth≥4 镜像描边卡（ADR 0020 第二轮，内侧 1px）
        // + 选中橙色发光环（2026-09-18 [from-user]，外侧 6px）。
        boxShadow: (() => {
          const shadows: string[] = [];
          if (!frameless && !accent && tier === "depth4")
            shadows.push(`inset 0 0 0 1px ${t.cardDepth4Stroke}`);
          if (selected && !linkCandidate) shadows.push(`0 0 0 6px ${t.selectionAccentHalo}`);
          return shadows.length > 0 ? shadows.join(", ") : "none";
        })(),
      }}
      role="button"
      aria-label={`${data.kicker ? data.kicker + "·" : ""}节点：${data.text || "空"}${accent ? "（强调）" : ""}`}
      tabIndex={-1}
    >
      {/* ADR 0019（2026-09-18 内测批次，负责人定稿 Q2=B）：左右两侧均可进线/出线，
          箭头表达流向；锚点侧由投影按相对几何派生（projection deriveHandleSides）。
          同侧 target/source 手柄重叠渲染，source 居顶层——从任一侧拖出均为正向连线。 */}
      <Handle
        type="target"
        id="t-left"
        position={Position.Left}
        style={{ opacity: selected || focused ? 0.9 : 0.35 }}
      />
      <Handle
        type="target"
        id="t-right"
        position={Position.Right}
        style={{ opacity: selected || focused ? 0.9 : 0.35 }}
      />
      <Handle
        type="source"
        id="s-left"
        position={Position.Left}
        style={{ opacity: selected || focused ? 0.9 : 0.35 }}
      />
      <Handle
        type="source"
        id="s-right"
        position={Position.Right}
        style={{ opacity: selected || focused ? 0.9 : 0.35 }}
      />

      {editing ? (
        <NodeTextEditor
          initialText={data.text}
          fontFamily={fontFamily(data.font)}
          textColor={text}
          background={fill}
          // DFR-090 F2：整节点统一样式在编辑态沿用同一排版渲染（不再是
          // 退回普通 16px）；混合 runs 则退回纯文本渲染，提交后样式仍保留。
          {...(() => {
            const editStyle = uniformRunsStyle(data.runs, data.text.length);
            const editFauxBold = editStyle?.bold === true && !hasRealBold;
            return {
              ...(editStyle?.fontSize !== undefined ? { fontSize: editStyle.fontSize } : {}),
              ...(editStyle?.bold === true && !editFauxBold ? { fontWeight: 700 } : {}),
              ...(editFauxBold ? { fauxBold: true } : {}),
              underline: editStyle?.underline === true,
            };
          })()}
          // 眉题存在时正文起始位置与提交后渲染一致（paddingTop + 眉题行高 + gap）
          paddingTop={
            layout.kicker
              ? VISUAL_TYPOGRAPHY.paddingTop +
                VISUAL_TYPOGRAPHY.kickerLineHeight +
                VISUAL_TYPOGRAPHY.kickerBodyGap
              : VISUAL_TYPOGRAPHY.paddingTop
          }
          // 实时增长与提交后渲染同一测量源（所见即所得）；DFR-090 F2：测量
          // 携带 runs 的文本变更映射结果——带样式节点续写时外框不再先缩后跳。
          measureBox={(txt) => {
            const mappedRuns = remapRunsForTextChange(data.text, data.runs, txt);
            return measureNodeVisual(
              {
                text: txt,
                ...(data.kicker !== undefined ? { kicker: data.kicker } : {}),
                ...(mappedRuns !== undefined ? { runs: mappedRuns } : {}),
              },
              data.font,
              fonts,
            );
          }}
          onMeasure={setEditBox}
          onCommit={(txt) => onCommitEdit(id, txt)}
          onCancel={onCancelEdit}
        />
      ) : (
        <svg style={textStyle} aria-hidden="true">
          {primary
            ? corners.map(([cx, cy, sx, sy], i) => (
                <path
                  key={`c${i}`}
                  className="corner-tick"
                  d={`M ${cx + sx * corner} ${cy} L ${cx} ${cy} L ${cx} ${cy + sy * corner}`}
                  stroke={t.focusRing}
                  strokeWidth={2.5}
                  fill="none"
                  transform={i % 2 === 0 ? "translate(-3,-3)" : "translate(3,-3)"}
                />
              ))
            : null}
          {/* 眉题（§1.3：11px 上行、letter-spacing 0.06em；空眉题自然不渲染） */}
          {layout.kicker ? (
            <text
              x={layout.kicker.x}
              y={VISUAL_TYPOGRAPHY.paddingTop + layout.kicker.baselineY}
              fill={kicker}
              fontSize={layout.kicker.fontSize}
              fontFamily={fontFamily(data.font)}
              letterSpacing={`${layout.kicker.letterSpacing}px`}
              style={{ whiteSpace: "pre" }}
            >
              {layout.kicker.text}
            </text>
          ) : null}
          {layout.lines.map((line, li) => {
            const yBase =
              VISUAL_TYPOGRAPHY.paddingTop +
              layout.bodyTop +
              layout.lines.slice(0, li).reduce((s, l) => s + l.height, 0) +
              line.baselineOffset;
            let lastX = -1;
            return (
              <g key={li}>
                {line.segments.map((seg, si) => {
                  const x = VISUAL_TYPOGRAPHY.paddingX + seg.startX;
                  const showUnderline = seg.underline;
                  const segFauxBold = seg.bold && !hasRealBold;
                  lastX = x + seg.width;
                  return (
                    <g key={si}>
                      <text
                        x={x}
                        y={yBase}
                        fill={text}
                        fontSize={seg.fontSize}
                        fontFamily={fontFamily(data.font)}
                        fontWeight={seg.bold && !segFauxBold ? 700 : 400}
                        // fauxBold：与导出 SVG 同一描边模拟（R2-F3 契约；
                        // 合成粗体宽度超出 regular 度量会被视口裁剪）
                        stroke={segFauxBold ? text : "none"}
                        strokeWidth={
                          segFauxBold ? seg.fontSize * LAYOUT.fauxBoldStrokeRatio : undefined
                        }
                        style={{ whiteSpace: "pre" }}
                        textDecoration={showUnderline ? "underline" : undefined}
                      >
                        {seg.text}
                      </text>
                      {showUnderline ? (
                        <line
                          x1={x}
                          x2={lastX}
                          y1={yBase + LAYOUT.underlineGap}
                          y2={yBase + LAYOUT.underlineGap}
                          stroke={text}
                          strokeWidth={LAYOUT.underlineThickness}
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function fontFamily(font: FontToken): string {
  return font === "lxgw-wenkai" ? "LXGW WenKai, serif" : "'Noto Sans SC', sans-serif";
}

export const MindNodeView = memo(MindNodeViewImpl);
