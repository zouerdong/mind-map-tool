// @vitest-environment jsdom
// ReactFlow 组件的测试 stub：保留真实 hooks（useNodesState/useEdgesState）与
// 受控协议，仅替换内部 DOM 交互（jsdom 下 RF 12 的 nodeInternals 测量会死循环；
// 库内部交互已由 MM-010 Spike 实测覆盖，这里只测 EditorCanvas 的接线逻辑）。
// 事件代理：节点点击→select change、节点双击→onNodeDoubleClick、
// pane 双击→EditorCanvas wrapper（closest('.react-flow__pane') 真实路径）、
// 隐藏按钮→onNodeDragStop/onConnect。

import { createElement, useEffect } from "react";
import { vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = any;

export async function rfStubModule(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await vi.importActual("@xyflow/react")) as any;

  const ReactFlowStub = (props: AnyProps) => {
    // onInit：最小实例（缩放/fitView/坐标换算——quick-create 与 ⌘+/⌘- 路径可达）。
    useEffect(() => {
      props.onInit?.({
        fitView: () => {},
        zoomIn: () => {},
        zoomOut: () => {},
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        setViewport: () => {},
        screenToFlowPosition: (p: { x: number; y: number }) => ({ ...p }),
      });
    }, []);
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
            // 单击=选中；Ctrl+单击=取消选中（2026-09-18 主选首落定测试需要）
            onClick: (e: AnyProps) =>
              props.onNodesChange?.([
                { id: n.id, type: "select", selected: !(e as { ctrlKey?: boolean }).ctrlKey },
              ]),
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
      createElement(
        "svg",
        { className: "react-flow__edges" },
        ...(props.edges ?? []).map((e: AnyProps) =>
          createElement(
            "g",
            {
              key: e.id,
              className: "react-flow__edge",
              "data-testid": `rf-edge-${e.id}`,
              "data-path": e.data?.pathD,
            },
            props.edgeTypes?.[e.type]
              ? createElement(props.edgeTypes[e.type], {
                  id: e.id,
                  source: e.source,
                  target: e.target,
                  data: e.data,
                  style: e.style,
                  markerEnd: e.markerEnd,
                })
              : null,
          ),
        ),
      ),
      createElement("button", {
        "data-testid": "rf-drag-stop",
        style: { display: "none" },
        onClick: () => props.onNodeDragStop?.(null, null),
      }),
      // 拖动中事件（OFR-2026-09-14 #2：驻留规整态拖动的实时连线测试）
      createElement("button", {
        "data-testid": "rf-drag-n2-pos",
        style: { display: "none" },
        onClick: () =>
          props.onNodesChange?.([
            { id: "n2", type: "position", position: { x: 260, y: 220 }, dragging: true },
          ]),
      }),
      // children（VRA-050：ContextToolbar 以 Panel 形式作为 ReactFlow 子元素）
      ...(Array.isArray(props.children) ? props.children : props.children ? [props.children] : []),
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
