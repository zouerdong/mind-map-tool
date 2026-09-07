// 引导状态机（MM-070 ②）：纯 reducer，无 React/DOM 依赖。
// 语义（PRD §7）：
// - welcome 提供"开始/跳过"；跳过不禁用任何功能，且不再强制弹出；
// - 步骤完成 = 观察到真实命令/动作（成功标准是完成动作，不是翻页）；
// - 全部步骤完成 → completed 并记录本机偏好（onboardingCompleted 语义）；
// - replay：任意状态从头开始（completedSteps 清空）；
// - hide：本 session 隐藏（不阻塞用户、不改持久状态）；show：恢复显示。

import {
  INITIAL_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  observationKey,
  type OnboardingObservation,
  type OnboardingState,
  type OnboardingStepId,
} from "./onboarding-types.js";

export type OnboardingAction =
  | { type: "start" }
  | { type: "skip" }
  | { type: "replay" }
  | { type: "observe"; observation: OnboardingObservation }
  | { type: "hide" }
  | { type: "show" }
  /** 偏好载入（应用启动）：恢复持久状态；completed/skipped 不再自动弹出。 */
  | { type: "restore"; status: OnboardingState["status"] };

function stepAfter(id: OnboardingStepId): OnboardingStepId | null {
  const i = ONBOARDING_STEPS.findIndex((s) => s.id === id);
  return ONBOARDING_STEPS[i + 1]?.id ?? null;
}

/** 进入某步骤：只产出三字段（不 spread 旧 state，避免覆盖 status 等）。 */
function beginStep(
  step: OnboardingStepId,
): Pick<OnboardingState, "currentStep" | "stepProgress" | "visible"> {
  return { currentStep: step, stepProgress: [], visible: true };
}

export function onboardingReducer(
  state: OnboardingState = INITIAL_ONBOARDING_STATE,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case "restore": {
      if (action.status === "in-progress") {
        // 中断的引导：下次启动继续（从首个未完成步骤）。
        const next = ONBOARDING_STEPS[1]!;
        return { ...state, status: "in-progress", ...beginStep(next.id) };
      }
      if (action.status === "not-started") {
        // 首次使用：自动出示 welcome 卡（开始 2 分钟引导 / 跳过）。
        return { ...state, status: "not-started", ...beginStep("welcome") };
      }
      // completed/skipped：不再强制弹出（重放经 replay 信号）。
      return { ...INITIAL_ONBOARDING_STATE, status: action.status, visible: false };
    }
    case "start": {
      if (state.status === "completed" || state.status === "skipped") return state; // 只经 replay 重启
      const first = ONBOARDING_STEPS[1]!; // welcome 之后的第一步
      return { ...state, status: "in-progress", completedSteps: [], ...beginStep(first.id) };
    }
    case "skip":
      return { ...state, status: "skipped", currentStep: null, visible: false };
    case "replay":
      return {
        ...INITIAL_ONBOARDING_STATE,
        status: "in-progress",
        completedSteps: [],
        ...beginStep(ONBOARDING_STEPS[1]!.id),
      };
    case "hide":
      return { ...state, visible: false };
    case "show":
      return { ...state, visible: true };
    case "observe": {
      if (state.status !== "in-progress" || state.currentStep === null) return state;
      const spec = ONBOARDING_STEPS.find((s) => s.id === state.currentStep);
      if (!spec || spec.observe.length === 0) return state; // welcome 由显式 start 推进
      const key = observationKey(action.observation);
      if (!spec.observe.includes(key)) return state; // 与当前步骤无关的命令不推进
      const stepProgress = state.stepProgress.includes(key)
        ? state.stepProgress
        : [...state.stepProgress, key];
      const satisfied =
        spec.mode === "all"
          ? spec.observe.every((k) => stepProgress.includes(k))
          : stepProgress.length > 0;
      if (!satisfied) return { ...state, stepProgress };
      const completedSteps = [...state.completedSteps, spec.id];
      const next = stepAfter(spec.id);
      if (next === null) {
        return { ...state, completedSteps, status: "completed", currentStep: null, visible: false };
      }
      return { ...state, completedSteps, ...beginStep(next) };
    }
    default:
      return state;
  }
}
