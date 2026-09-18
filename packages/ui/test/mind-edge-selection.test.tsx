// @vitest-environment jsdom
// 边选中态与删除入口（2026-09-22 内测反馈：连线选中零视觉反馈 + 删除不可发现）：
// - selected → 描边换 selectionAccent 橙 + 光晕底衬（修复 inline style 压死 RF .selected CSS）；
// - selected || data.hover → 线中点浮出删除按钮，点击经 EdgeActionsContext.deleteEdge 提交。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EdgeActionsContext, MindEdgeView } from "../src/canvas/mind-edge.js";
import type { MindFlowEdge } from "../src/projection/projection.js";

afterEach(cleanup);

const BASE_PROPS = {
  id: "e1",
  sourceX: 100,
  sourceY: 50,
  targetX: 300,
  targetY: 80,
  sourcePosition: "right",
  targetPosition: "left",
} as const;

function renderEdge(
  data: Partial<MindFlowEdge["data"]> & object,
  opts?: { selected?: boolean; style?: Record<string, unknown> },
): string {
  return renderToStaticMarkup(
    createElement(
      "svg",
      null,
      createElement(MindEdgeView as never, {
        ...BASE_PROPS,
        selected: opts?.selected ?? false,
        style: opts?.style,
        data: { lineStyle: "solid", theme: "light", ...data },
      }),
    ),
  );
}

describe("MindEdgeView 选中态视觉", () => {
  it("未选中：无光晕、无删除按钮，描边取 style.stroke", () => {
    const html = renderEdge({}, { style: { stroke: "#4A4640", strokeWidth: 2 } });
    expect(html).not.toContain("react-flow__edge-selected-halo");
    expect(html).not.toContain("删除连线");
    expect(html).toContain('style="stroke:#4A4640');
  });

  it("选中：selectionAccent 橙描边 + 光晕底衬 + 删除按钮", () => {
    const html = renderEdge({}, { selected: true, style: { stroke: "#4A4640", strokeWidth: 2 } });
    expect(html).toContain("react-flow__edge-selected-halo");
    expect(html).toContain('style="stroke:#D97757'); // selectionAccent（light）
    expect(html).toContain("删除连线");
  });

  it("hover（未选中）：也显示删除按钮，但无光晕、描边不变橙", () => {
    const html = renderEdge({ hover: true }, { style: { stroke: "#4A4640", strokeWidth: 2 } });
    expect(html).toContain("删除连线");
    expect(html).not.toContain("react-flow__edge-selected-halo");
    expect(html).not.toContain('style="stroke:#D97757');
  });

  it("规整态 pathD 选中：自定义箭头 fill 跟随选中橙", () => {
    const html = renderEdge(
      { pathD: "M 0 0 L 100 0 L 100 50", arrowD: "M 0 0 L 1 1 L 2 0 Z" },
      { selected: true },
    );
    expect(html).toContain("react-flow__edge-selected-halo");
    expect(html).toContain('fill="#D97757"');
  });
});

describe("MindEdgeView 删除按钮交互", () => {
  function renderInteractive(deleteEdge?: (id: string) => void) {
    return render(
      createElement(
        "svg",
        null,
        createElement(
          EdgeActionsContext.Provider,
          { value: deleteEdge ? { deleteEdge } : null },
          createElement(MindEdgeView as never, {
            ...BASE_PROPS,
            selected: true,
            data: { lineStyle: "solid", theme: "light" },
          }),
        ),
      ),
    );
  }

  it("点击 × → deleteEdge（本边 id）", () => {
    const spy = vi.fn();
    renderInteractive(spy);
    fireEvent.click(screen.getByLabelText("删除连线"));
    expect(spy).toHaveBeenCalledWith("e1");
  });

  it("无 provider（独立渲染）：点击不炸、空操作", () => {
    renderInteractive();
    fireEvent.click(screen.getByLabelText("删除连线"));
  });
});
