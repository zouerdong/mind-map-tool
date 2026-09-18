// 边渲染（VRA-060）：与 export 共同绘制契约。
// 当 pathD/arrowD 存在时消费同源 edgePathD/arrowD（整理动画及规整态）；
// 自由拖动态缺省时优雅降级为平滑贝塞尔与 RF 默认 marker。
// 2026-09-18 内测批次④：能量脉冲——data.pulse 携带周期窗口（pulse-timing.ts），
// 沿本边实际路径（规整 pathD / 自由贝塞尔）播放 SMIL animateMotion；
// data.pulseHighlight 渲染来路静态高亮（reduced-motion 时仅有高亮）。
// 脉冲层在边平面内（节点卡下方），跨卡段被卡片自然遮挡，呈「穿卡传导」观感。
// 2026-09-22 内测反馈（连线删除不可发现）：
// - 选中态视觉——RF base.css 的 .selected 描边被投影 inline style.stroke 压死，
//   改为组件内消费 selected prop：描边换 selectionAccent 橙 + 光晕底衬
//   （与节点选中语言同源，theme-tokens §1.1 同一橙 token 原则）。
// - 中点删除按钮——selected || data.hover 时在线中点（foreignObject）浮出 ×，
//   点击经 EdgeActionsContext.deleteEdge → DeleteSelection（仅 edgeIds）。
//   已知取舍：RF marker 箭头颜色在建边时定死，选中时箭头不随描边变橙
//   （规整态 customArrow 用 fill=stroke 会跟随；自由态 marker 不跟随）。

import { createContext, memo, useContext } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { themeTokens } from "../theme/theme-tokens.js";
import { pulseOpacityKeyframes } from "./pulse-timing.js";
import type { MindFlowEdge } from "../projection/projection.js";

/** 边操作（删除）由组合根（EditorCanvas）注入；测试/独立渲染缺省 null → 点击空操作。 */
export interface EdgeActions {
  deleteEdge: (edgeId: string) => void;
}

export const EdgeActionsContext = createContext<EdgeActions | null>(null);

/** 自定义 pathD 的中点（规整态无 getBezierPath label 坐标）。
 *  用游离 SVGPathElement 测量，jsdom 等无几何实现环境返回 null（调用方给兜底）。 */
function pathMidpoint(d: string): { x: number; y: number } | null {
  if (typeof document === "undefined") return null;
  try {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    const len = el.getTotalLength();
    if (!Number.isFinite(len) || len <= 0) return null;
    const p = el.getPointAtLength(len / 2);
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

function MindEdgeViewImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
  markerEnd,
  data,
}: EdgeProps<MindFlowEdge>) {
  const customPath = data?.pathD;
  const customArrow = data?.arrowD;
  const t = themeTokens(data?.theme ?? "light");

  let path = customPath;
  // 自由贝塞尔：getBezierPath 顺手给 label 中点；规整 pathD：仅删除按钮可见时才测量
  let label: { x: number; y: number } | null = null;
  if (!path) {
    const [bezier, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    path = bezier;
    label = { x: labelX, y: labelY };
  }

  const isSelected = selected === true;
  const showDelete = isSelected || data?.hover === true;
  if (showDelete && customPath) {
    label = pathMidpoint(customPath);
  }
  if (showDelete && !label) {
    label = { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
  }

  const stroke = isSelected ? t.selectionAccent : (style?.stroke as string) || "#4A4640";
  const baseWidth = typeof style?.strokeWidth === "number" ? style.strokeWidth : 2;
  // BaseEdge 主路径描边：选中时显式换橙（inline style 覆盖 RF .selected CSS 的根因修复）
  const edgeStyle = isSelected ? { ...style, stroke: t.selectionAccent } : style;
  const pulse = data?.pulse;
  const highlight = data?.pulseHighlight === true;
  const actions = useContext(EdgeActionsContext);

  const markerProps = customArrow || !markerEnd ? {} : { markerEnd };

  return (
    <>
      {isSelected ? (
        // 选中光晕底衬（不动主路径、不改变命中区；与节点选中发光环同 token）
        <path
          d={path}
          fill="none"
          stroke={t.selectionAccentHalo}
          strokeWidth={baseWidth + 6}
          strokeLinecap="round"
          style={{ pointerEvents: "none" }}
          className="react-flow__edge-selected-halo"
        />
      ) : null}
      {highlight ? (
        // 来路静态高亮：加宽半透明底衬（不动主路径，不改变命中区）
        <path
          d={path}
          fill="none"
          stroke={t.hoverPort}
          strokeWidth={baseWidth + 4}
          strokeOpacity={0.22}
          strokeLinecap="round"
          style={{ pointerEvents: "none" }}
          className="react-flow__edge-pulse-highlight"
        />
      ) : null}
      <BaseEdge id={id} path={path} style={edgeStyle} {...markerProps} />
      {customArrow ? (
        <path
          d={customArrow}
          fill={stroke}
          stroke="none"
          className="react-flow__edge-arrow"
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {showDelete && label ? (
        // 中点删除按钮（连线删除的显性入口）：foreignObject 挂在边平面内，
        // 随视口缩放平移；nopan 防 d3-zoom 抢拖，pointerEvents 恢复可点。
        <foreignObject
          x={label.x - 11}
          y={label.y - 11}
          width={22}
          height={22}
          className="react-flow__edge-delete nopan"
          style={{ pointerEvents: "all", overflow: "visible" }}
        >
          <button
            type="button"
            aria-label="删除连线"
            title="删除连线（⌫）"
            onClick={(e) => {
              e.stopPropagation();
              actions?.deleteEdge(id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: `1.5px solid ${t.selectionAccent}`,
              background: t.onboardingCardBackground,
              color: t.selectionAccent,
              fontSize: 14,
              lineHeight: "1",
              padding: 0,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </foreignObject>
      ) : null}
      {pulse
        ? (
            [
              { r: 7, scale: 0.3, key: "halo" },
              { r: 3, scale: 1, key: "core" },
            ] as const
          ).map(({ r, scale, key }) => {
            const opacity = pulseOpacityKeyframes(pulse.beginFrac, pulse.endFrac, scale);
            return (
              <circle
                key={key}
                r={r}
                fill={t.cardAccentFill}
                opacity={0}
                style={{ pointerEvents: "none" }}
                className={`react-flow__edge-pulse react-flow__edge-pulse-${key}`}
              >
                <animateMotion
                  dur={`${pulse.durMs}ms`}
                  begin="0s"
                  repeatCount="indefinite"
                  calcMode="linear"
                  keyPoints="0;0;1;1"
                  keyTimes={`0;${pulse.beginFrac};${pulse.endFrac};1`}
                  path={path}
                />
                <animate
                  attributeName="opacity"
                  dur={`${pulse.durMs}ms`}
                  begin="0s"
                  repeatCount="indefinite"
                  values={opacity.values}
                  keyTimes={opacity.keyTimes}
                />
              </circle>
            );
          })
        : null}
    </>
  );
}

export const MindEdgeView = memo(MindEdgeViewImpl);
