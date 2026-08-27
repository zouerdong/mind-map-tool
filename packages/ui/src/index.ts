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

// 键盘导航与连线流（MM-089）
export {
  linkingReducer,
  nearestNodeInDirection,
} from "./canvas/keyboard-navigation.js";
export type {
  LinkingAction,
  LinkingState,
  MindFlowNodeLite,
  NavDirection,
} from "./canvas/keyboard-navigation.js";

// 主题（MM-070）
export {
  contrastRatio,
  DARK_TOKENS,
  LIGHT_TOKENS,
  relativeLuminance,
  themeTokens,
} from "./theme/theme-tokens.js";
export type { ThemeTokens } from "./theme/theme-tokens.js";
export { ThemeToggle } from "./theme/theme-toggle.js";
export type { ThemeToggleProps } from "./theme/theme-toggle.js";

// 首次使用引导（MM-070）
export {
  INITIAL_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  observationKey,
} from "./onboarding/onboarding-types.js";
export type {
  OnboardingObservation,
  OnboardingState,
  OnboardingStepId,
  OnboardingStepSpec,
  OnboardingStatus,
} from "./onboarding/onboarding-types.js";
export { onboardingReducer } from "./onboarding/onboarding-reducer.js";
export type { OnboardingAction } from "./onboarding/onboarding-reducer.js";
export {
  createOnboardingPreferences,
  InMemoryPreferenceStore,
  ONBOARDING_STATUS_KEY,
} from "./onboarding/onboarding-preferences.js";
export type { OnboardingPreferencesPort, PreferenceStore } from "./onboarding/onboarding-preferences.js";
export { ONBOARDING_COPY, ONBOARDING_REPLAY_LABEL } from "./onboarding/onboarding-copy.js";
export { OnboardingOverlay } from "./onboarding/onboarding-overlay.js";
export type { OnboardingOverlayProps } from "./onboarding/onboarding-overlay.js";
export { OnboardingFlow } from "./onboarding/onboarding-flow.js";
export type { OnboardingFlowProps } from "./onboarding/onboarding-flow.js";
