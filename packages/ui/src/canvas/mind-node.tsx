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
import { measureNodeBox, LAYOUT, type FontResolver } from "@mindmap/export/src/layout.js";
import { themeTokens } from "../theme/theme-tokens.js";
import type { MindFlowNode } from "../projection/projection.js";
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
  const fill = accent ? t.cardAccentFill : t.cardNormalFill;
  const text = accent ? t.cardAccentText : t.cardNormalText;
  const kicker = accent ? t.cardAccentKicker : t.cardNormalKicker;
  const isEllipse = data.shape === "ellipse";
  const primary = selected || focused; // 主选/焦点：角标记
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
    [-6, -6, 1, 1], [1, -6, -1, 1], [-6, 1, 1, -1], [1, 1, -1, -1],
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
            ? `2px solid ${t.selectionOutline}`
            : focused
              ? `2px solid ${t.focusRing}`
              : dragging
                ? `1.5px dashed ${t.draggingOutline}`
                : "none",
        outlineOffset: 3,
      }}
      role="button"
      aria-label={`${data.kicker ? data.kicker + "·" : ""}节点：${data.text || "空"}${accent ? "（强调）" : ""}`}
      tabIndex={-1}
    >
      {/* G-VIS D7：整理默认横向（右出左入）；纵向可选时由 VRA-060 协调切换 */}
      <Handle type="target" position={Position.Left} style={{ opacity: selected || focused ? 0.9 : 0.35 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: selected || focused ? 0.9 : 0.35 }} />

      {editing ? (
        <NodeTextEditor
          initialText={data.text}
          fontFamily={fontFamily(data.font)}
          textColor={text}
          background={fill}
          // 实时增长与提交后渲染同一测量源（所见即所得；runs 在编辑态按纯文本计）
          measureBox={(txt) => measureNodeBox(txt, undefined, data.font, fonts)}
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
                  lastX = x + seg.width;
                  return (
                    <g key={si}>
                      <text
                        x={x}
                        y={yBase}
                        fill={text}
                        fontSize={seg.fontSize}
                        fontFamily={fontFamily(data.font)}
                        fontWeight={seg.bold ? 700 : 400}
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
