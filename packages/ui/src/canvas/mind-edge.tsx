// 边渲染（VRA-060）：与 export 共同绘制契约。
// 当 pathD/arrowD 存在时消费同源 edgePathD/arrowD（整理动画及规整态）；
// 自由拖动态缺省时优雅降级为平滑贝塞尔与 RF 默认 marker。

import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
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

  const markerProps = customArrow || !markerEnd ? {} : { markerEnd };

  return (
    <>
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
    </>
  );
}

export const MindEdgeView = memo(MindEdgeViewImpl);
