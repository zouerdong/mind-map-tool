// 引导类型（MM-070 ②③）：状态机与步骤的 semantic 锚点定义。
// 引导状态属于本地应用偏好（PRD §7.3），绝不进入脑图文档文件（AC-06/09）。

import type { Command } from "@mindmap/core";

/** 步骤 semantic id（稳定标识，文案/锚点映射用，不得随 UI 结构改名）。 */
export type OnboardingStepId =
  "welcome" | "create-first" | "second-connect" | "undo-or-theme" | "save-or-export";

export type OnboardingStatus = "not-started" | "in-progress" | "completed" | "skipped";

export interface OnboardingState {
  status: OnboardingStatus;
  currentStep: OnboardingStepId | null;
  /** 已完成步骤（重放清空）。 */
  completedSteps: OnboardingStepId[];
  /** 当前步骤内已观察到的动作（Command kind 或外部动作名）。 */
  stepProgress: string[];
  /** 本 session 的显隐（关闭≠跳过；不改持久状态）。 */
  visible: boolean;
}

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  status: "not-started",
  currentStep: null,
  completedSteps: [],
  stepProgress: [],
  visible: false,
};

/** 步骤完成条件：kind 集合全部观察到（mode=all）或任一观察到（mode=any）。 */
export interface OnboardingStepSpec {
  id: OnboardingStepId;
  /** 提示锚定的 semantic anchor（data-onboarding-anchor 值；null=居中卡片）。 */
  anchor: string | null;
  /** 观察要求：core Command 的 kind，或外部动作名（"action:save" 等）。 */
  observe: readonly string[];
  /** all=全部出现才完成；any=任一出现即完成。 */
  mode: "all" | "any";
}

export const ONBOARDING_STEPS: readonly OnboardingStepSpec[] = [
  { id: "welcome", anchor: null, observe: [], mode: "all" }, // 入口卡：显式开始/跳过
  {
    id: "create-first",
    anchor: "canvas.pane",
    observe: ["CreateNode", "EditNodeText"],
    mode: "all",
  },
  {
    id: "second-connect",
    anchor: "canvas.pane",
    observe: ["CreateNode", "MoveNodes", "CreateEdge"],
    mode: "all",
  },
  {
    id: "undo-or-theme",
    anchor: "theme.toggle",
    // OFR-2026-09-14：文案提及 ⇧⌘L 整理——MoveNodes（整理/拖动提交同一
    // kind）纳入完成条件，保持“完成靠真实动作”契约。
    observe: ["undo", "redo", "SetDocumentStyle", "MoveNodes"],
    mode: "any",
  },
  { id: "save-or-export", anchor: null, observe: ["action:save", "action:export"], mode: "any" },
];

/** 观察到的输入：真实 command kind，或 undo/redo 动作、外部动作（保存/导出）。 */
export type OnboardingObservation =
  | { kind: "command"; command: Command }
  | { kind: "history"; action: "undo" | "redo" }
  | { kind: "external"; action: "save" | "export" };

export function observationKey(o: OnboardingObservation): string {
  switch (o.kind) {
    case "command":
      return o.command.kind;
    case "history":
      return o.action;
    case "external":
      return `action:${o.action}`;
  }
}
