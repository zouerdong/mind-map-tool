// 节点渲染（MM-050 ①④）：视觉与 exporter 同源——行/段几何来自共享
// layoutNodeText（packages/export），card/ellipse、白/黑主题与 ExportScene
// 的绘制规则一致（scene.ts），保证画布所见 = 导出所得。
// 尺寸由 core size 权威决定（RF 不测量）。

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FontToken } from "@mindmap/core";
import { layoutNodeText, LAYOUT, type FontResolver } from "@mindmap/export/src/layout.js";
import type { MindFlowNode } from "../projection/projection.js";
import { NodeTextEditor } from "./node-text-editor.js";

export const MIND_NODE_THEME = {
  light: { bg: "#ffffff", border: "#1f2328", text: "#1f2328" },
  dark: { bg: "#0d1117", border: "#e6edf3", text: "#e6edf3" },
} as const;

interface MindNodeViewProps extends NodeProps {
  data: MindFlowNode["data"];
  fonts: FontResolver;
  editing: boolean;
  onCommitEdit(id: string, text: string): void;
  onCancelEdit(): void;
}

function MindNodeViewImpl({ id, data, selected, dragging, fonts, editing, onCommitEdit, onCancelEdit }: MindNodeViewProps) {
  const layout = layoutNodeText(data.text, data.runs, data.font, fonts);
  const palette = MIND_NODE_THEME[data.theme];
  const isEllipse = data.shape === "ellipse";

  const textStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        background: palette.bg,
        border: `${LAYOUT.strokeWidth}px solid ${palette.border}`,
        borderRadius: isEllipse ? "50%" : 6,
        position: "relative",
        outline: selected ? "2px solid #4c8bf5" : dragging ? "1.5px dashed #4c8bf5" : "none",
        outlineOffset: 2,
        boxShadow: data.framesVisible ? `0 0 0 ${LAYOUT.strokeWidth}px ${palette.border}22` : undefined,
      }}
      role="group"
      aria-label={`节点：${data.text || "空"}`}
      tabIndex={-1}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0.35 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0.35 }} />

      {editing ? (
        <NodeTextEditor
          initialText={data.text}
          onCommit={(text) => onCommitEdit(id, text)}
          onCancel={onCancelEdit}
        />
      ) : (
        <svg style={textStyle} aria-hidden="true">
          {layout.lines.map((line, li) => {
            const y =
              LAYOUT.paddingY +
              layout.lines.slice(0, li).reduce((s, l) => s + l.height, 0) +
              line.baselineOffset;
            let lastX = -1;
            return (
              <g key={li}>
                {line.segments.map((seg, si) => {
                  const x = LAYOUT.paddingX + seg.startX;
                  const showUnderline = seg.underline;
                  lastX = x + seg.width;
                  return (
                    <g key={si}>
                      <text
                        x={x}
                        y={y}
                        fill={palette.text}
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
                          y1={y + LAYOUT.underlineGap}
                          y2={y + LAYOUT.underlineGap}
                          stroke={palette.text}
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
