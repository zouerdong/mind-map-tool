// @vitest-environment jsdom
// ReactFlow 组件的测试 stub：保留真实 hooks（useNodesState/useEdgesState）与
// 受控协议，仅替换内部 DOM 交互（jsdom 下 RF 12 的 nodeInternals 测量会死循环；
// 库内部交互已由 MM-010 Spike 实测覆盖，这里只测 EditorCanvas 的接线逻辑）。
// 事件代理：节点点击→select change、节点双击→onNodeDoubleClick、
// pane 双击→EditorCanvas wrapper（closest('.react-flow__pane') 真实路径）、
// 隐藏按钮→onNodeDragStop/onConnect。

import { createElement } from "react";
import { vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = any;

export async function rfStubModule(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await vi.importActual("@xyflow/react")) as any;

  const ReactFlowStub = (props: AnyProps) => {
    return createElement(
      "div",
      { className: "react-flow__renderer", "data-testid": "rf-canvas" },
      createElement("div", {
        className: "react-flow__pane",
        "data-testid": "rf-pane",
        style: { width: 800, height: 600 },
      }),
      ...(props.nodes ?? []).map((n: AnyProps) =>
        createElement(
          "div",
          {
            key: n.id,
            className: "react-flow__node",
            "data-testid": `rf-node-${n.id}`,
            onClick: () => props.onNodesChange?.([{ id: n.id, type: "select", selected: true }]),
            onDoubleClick: (e: unknown) => props.onNodeDoubleClick?.(e, n),
          },
          props.nodeTypes?.[n.type]
            ? createElement(props.nodeTypes[n.type], {
                id: n.id,
                data: n.data,
                selected: Boolean(n.selected),
                dragging: false,
                zIndex: 0,
                isConnectable: true,
                positionAbsoluteX: n.position.x,
                positionAbsoluteY: n.position.y,
                width: n.width,
                height: n.height,
                // RF NodeProps 其余字段对 MindNodeView 非必需
              })
            : String(n.data?.text ?? n.id),
        ),
      ),
      createElement("button", {
        "data-testid": "rf-drag-stop",
        style: { display: "none" },
        onClick: () => props.onNodeDragStop?.(null, null),
      }),
      createElement("button", {
        "data-testid": "rf-connect-b-a",
        style: { display: "none" },
        onClick: () => props.onConnect?.({ source: "n2", target: "n1" }),
      }),
    );
  };
  ReactFlowStub.displayName = "ReactFlowStub";

  // Handle/Background 依赖 RF 内部 store（ReactFlowProvider）；stub 场景渲染为占位。
  const HandleStub = (props: { type?: string; position?: string }) =>
    createElement("div", {
      className: `react-flow__handle react-flow__handle-${props.position ?? "left"}`,
      "data-handle-type": props.type ?? "source",
    });
  const BackgroundStub = () => createElement("div", { className: "react-flow__background" });

  return {
    ...actual,
    ReactFlow: ReactFlowStub,
    Handle: HandleStub,
    Background: BackgroundStub,
  };
}
