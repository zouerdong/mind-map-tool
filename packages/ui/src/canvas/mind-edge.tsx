// 边渲染（VRA-060）：与 export 共同绘制契约。
// 当 pathD/arrowD 存在时消费同源 edgePathD/arrowD（整理动画及规整态）；
// 自由拖动态缺省时优雅降级为平滑贝塞尔与 RF 默认 marker。
// 2026-09-18 内测批次④：能量脉冲——data.pulse 携带周期窗口（pulse-timing.ts），
// 沿本边实际路径（规整 pathD / 自由贝塞尔）播放 SMIL animateMotion；
// data.pulseHighlight 渲染来路静态高亮（reduced-motion 时仅有高亮）。
// 脉冲层在边平面内（节点卡下方），跨卡段被卡片自然遮挡，呈「穿卡传导」观感。

import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { themeTokens } from "../theme/theme-tokens.js";
import { pulseOpacityKeyframes } from "./pulse-timing.js";
import type { MindFlowEdge } from "../projection/projection.js";

function MindEdgeViewImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<MindFlowEdge>) {
  const customPath = data?.pathD;
  const customArrow = data?.arrowD;

  let path = customPath;
  if (!path) {
    const [bezier] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    path = bezier;
  }

  const stroke = (style?.stroke as string) || "#4A4640";
  const baseWidth = typeof style?.strokeWidth === "number" ? style.strokeWidth : 2;
  const t = themeTokens(data?.theme ?? "light");
  const pulse = data?.pulse;
  const highlight = data?.pulseHighlight === true;

  const markerProps = customArrow || !markerEnd ? {} : { markerEnd };

  return (
    <>
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
      <BaseEdge id={id} path={path} style={style} {...markerProps} />
      {customArrow ? (
        <path
          d={customArrow}
          fill={stroke}
          stroke="none"
          className="react-flow__edge-arrow"
          style={{ pointerEvents: "none" }}
        />
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
