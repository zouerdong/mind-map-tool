// OnboardingFlow（MM-070 ④）：状态机 + 偏好 + 命令观察的装配组件。
// 观察通道由外部注入（observeCommands：MM-080 在组合根把画布命令与
// undo/redo、保存/导出完成事件转发进来）；引导状态只写本机偏好。
// replaySignal 自增触发重放（帮助/设置菜单入口，模式同 EditorCanvas revision）。

import { useEffect, useMemo, useReducer, useRef } from "react";
import { DARK_TOKENS, LIGHT_TOKENS, type ThemeTokens } from "../theme/theme-tokens.js";
import {
  INITIAL_ONBOARDING_STATE,
  type OnboardingObservation,
  type OnboardingState,
} from "./onboarding-types.js";
import { onboardingReducer } from "./onboarding-reducer.js";
import type { OnboardingPreferencesPort } from "./onboarding-preferences.js";
import { OnboardingOverlay } from "./onboarding-overlay.js";

export interface OnboardingFlowProps {
  /** 命令/动作观察通道（返回取消订阅）。 */
  observeCommands(observe: (o: OnboardingObservation) => void): () => void;
  preferences: OnboardingPreferencesPort;
  /** 应用/文档主题 → 遮罩 tokens（默认 light）。 */
  theme?: "light" | "dark";
  /** 外部重放信号（自增触发）。 */
  replaySignal?: number;
}

export function OnboardingFlow({
  observeCommands,
  preferences,
  theme = "light",
  replaySignal = 0,
}: OnboardingFlowProps) {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING_STATE);
  const tokens: ThemeTokens = theme === "dark" ? DARK_TOKENS : LIGHT_TOKENS;

  // 启动：载入本机偏好（completed/skipped 不再自动弹出；in-progress 继续）。
  useEffect(() => {
    let cancelled = false;
    void preferences.load().then((status) => {
      if (!cancelled) dispatch({ type: "restore", status });
    });
    return () => {
      cancelled = true;
    };
  }, [preferences]);

  // 命令观察：状态机推进只依赖 observation（真实命令/动作）。
  useEffect(() => {
    const unsubscribe = observeCommands((observation) => {
      dispatch({ type: "observe", observation });
    });
    return unsubscribe;
  }, [observeCommands]);

  // 重放信号（帮助菜单）。
  useEffect(() => {
    if (replaySignal > 0) dispatch({ type: "replay" });
  }, [replaySignal]);

  // 状态持久化：completed/skipped/in-progress 写偏好；not-started 不写。
  const lastPersisted = useRef<OnboardingState["status"]>("not-started");
  useEffect(() => {
    if (state.status === lastPersisted.current) return;
    if (state.status === "not-started") return;
    lastPersisted.current = state.status;
    void preferences.store(state.status).catch(() => {
      // 偏好写失败不阻塞引导/编辑（本机偏好可丢失，PRD 不要求强一致）。
    });
  }, [state.status, preferences]);

  const handlers = useMemo(
    () => ({
      onStart: () => dispatch({ type: "start" }),
      onSkip: () => dispatch({ type: "skip" }),
      onHide: () => dispatch({ type: "hide" }),
    }),
    [],
  );

  return (
    <OnboardingOverlay
      state={state}
      tokens={tokens}
      onStart={handlers.onStart}
      onSkip={handlers.onSkip}
      onHide={handlers.onHide}
    />
  );
}
