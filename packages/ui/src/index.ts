// @mindmap/ui — 视觉与交互层（获选画布：React Flow，G1 批准 ADR 0002）。
// 禁止依赖：操作系统 API / Tauri / Electron（check-boundaries 强制）。
// 依赖方向：ui → @mindmap/export（仅共享 layout 契约）→ @mindmap/core。
//
// 模块导航：
// - projection/       SelectedCanvasProjection（core doc → RF 视图模型，纯函数）
// - controller/       InteractionController（UI 事件 → core commands）+ 映射文档
// - canvas/           EditorCanvas（可嵌入画布）、节点渲染、IME 编辑输入、会话 hook

export const UI_PACKAGE_VERSION = "0.1.0-mm050";

// 投影
export {
  documentDefaults,
  projectDocument,
  projectEdge,
  projectNode,
  projectionIsStable,
} from "./projection/projection.js";
export type {
  MindFlowEdge,
  MindFlowNode,
  MindNodeData,
  ProjectedView,
} from "./projection/projection.js";

// 控制器
export { createInteractionController } from "./controller/interaction-controller.js";
export type {
  InteractionController,
  InteractionControllerDeps,
  MeasureText,
  NodeDragDelta,
} from "./controller/interaction-controller.js";

// 画布
export { EditorCanvas } from "./canvas/editor-canvas.js";
export type { EditorCanvasProps } from "./canvas/editor-canvas.js";
export { MindNodeView, MIND_NODE_THEME } from "./canvas/mind-node.js";
export { NodeTextEditor, isCompositionEvent } from "./canvas/node-text-editor.js";
export { useCanvasSession } from "./canvas/use-canvas-session.js";
export type { CanvasSessionApi } from "./canvas/use-canvas-session.js";
