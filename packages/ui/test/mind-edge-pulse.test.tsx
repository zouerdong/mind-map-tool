// @vitest-environment jsdom
// 边脉冲渲染测试（2026-09-18 内测批次④）：SMIL animateMotion/opacity 关键帧与高亮底衬。
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MindEdgeView } from "../src/canvas/mind-edge.js";
import type { MindFlowEdge } from "../src/projection/projection.js";

const BASE_PROPS = {
  id: "e1",
  sourceX: 100,
  sourceY: 50,
  targetX: 300,
  targetY: 80,
  sourcePosition: "right",
  targetPosition: "left",
} as const;

function renderEdge(data: Partial<MindFlowEdge["data"]> & object): string {
  return renderToStaticMarkup(
    createElement(
      "svg",
      null,
      createElement(MindEdgeView as never, {
        ...BASE_PROPS,
        data: { lineStyle: "solid", theme: "light", ...data },
      }),
    ),
  );
}

describe("MindEdgeView 脉冲渲染", () => {
  it("无 pulse：不渲染脉冲与高亮", () => {
    const html = renderEdge({});
    expect(html).not.toContain("react-flow__edge-pulse");
    expect(html).not.toContain("animateMotion");
  });

  it("pulse：双层圆点 + animateMotion 窗口关键帧", () => {
    const html = renderEdge({ pulse: { beginFrac: 0.3, endFrac: 0.8, durMs: 2400 } });
    expect(html).toContain("react-flow__edge-pulse-halo");
    expect(html).toContain("react-flow__edge-pulse-core");
    expect(html).toContain("animateMotion");
    expect(html).toContain('dur="2400ms"');
    expect(html).toContain('keyPoints="0;0;1;1"');
    expect(html).toContain("0;0.3;0.8;1");
    expect(html).toContain('repeatCount="indefinite"');
  });

  it("pulseHighlight：渲染高亮底衬（reduced-motion 的静态退化）", () => {
    const html = renderEdge({ pulseHighlight: true });
    expect(html).toContain("react-flow__edge-pulse-highlight");
    expect(html).not.toContain("animateMotion"); // 仅高亮、不动效
  });

  it("规整态 pathD 存在时脉冲沿自定义路径", () => {
    const html = renderEdge({
      pathD: "M 0 0 L 100 0 L 100 50",
      arrowD: "M 0 0 L 1 1 L 2 0 Z",
      pulse: { beginFrac: 0, endFrac: 1, durMs: 1200 },
    });
    expect(html).toContain('path="M 0 0 L 100 0 L 100 50"');
  });
});
