// OnboardingFlow（MM-070 ④）：状态机 + 偏好 + 命令观察的装配组件。
// 观察通道由外部注入（observeCommands：MM-080 在组合根把画布命令与
// undo/redo、保存/导出完成事件转发进来）；引导状态只写本机偏好。
// replaySignal 自增触发显式打开：未开始显示 welcome、中断从第一步继续、
// 已完成/跳过则从第一步重放（帮助/设置菜单入口）。

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
  /** 是否在恢复 not-started/in-progress 偏好后自动呈现；默认保持历史行为。 */
  presentRestoredState?: boolean;
  /** OFR-2026-09-14 #7（负责人 dogfood：开局没看到新手指引）：偏好为
   *  not-started（首次使用）时启动自动呈现 welcome，无论
   *  presentRestoredState 为何。in-progress 仍遵 presentRestoredState
   * （ADR 0012 §7：中断引导仅后台恢复，不遮挡画布）。 */
  presentOnFirstRun?: boolean;
  /** 偏好损坏/写入失败时的非致命提示；不阻塞画布与引导。 */
  onPreferenceWarning?: (message: string) => void;
}

export function OnboardingFlow({
  observeCommands,
  preferences,
  theme = "light",
  replaySignal = 0,
  presentRestoredState = true,
  presentOnFirstRun = false,
  onPreferenceWarning,
}: OnboardingFlowProps) {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_ONBOARDING_STATE);
  const explicitOpenRequested = useRef(false);
  const tokens: ThemeTokens = theme === "dark" ? DARK_TOKENS : LIGHT_TOKENS;

  // 启动：载入本机偏好（completed/skipped 不再自动弹出；in-progress 继续）。
  useEffect(() => {
    let cancelled = false;
    void preferences
      .load()
      .then((status) => {
        if (cancelled) return;
        const warning = preferences.consumeWarning?.();
        if (warning) onPreferenceWarning?.(warning);
        // OFR-2026-09-14 #7：首次使用（not-started）按 presentOnFirstRun
        // 自动呈现 welcome；其余状态仍遵 presentRestoredState。
        const present =
          status === "not-started" && presentOnFirstRun ? true : presentRestoredState;
        dispatch({ type: "restore", status, present });
        // 用户可能在异步偏好读取完成前已调用显式入口；restore 之后重放
        // show，避免启动策略把刚打开的引导再次隐藏。
        if (explicitOpenRequested.current) dispatch({ type: "show" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onPreferenceWarning?.(
          `本机偏好读取失败，已使用默认设置：${error instanceof Error ? error.message : String(error)}`,
        );
        dispatch({
          type: "restore",
          status: "not-started",
          present: presentOnFirstRun ? true : presentRestoredState,
        });
        if (explicitOpenRequested.current) dispatch({ type: "show" });
      });
    return () => {
      cancelled = true;
    };
  }, [onPreferenceWarning, preferences, presentRestoredState, presentOnFirstRun]);

  // 命令观察：状态机推进只依赖 observation（真实命令/动作）。
  useEffect(() => {
    const unsubscribe = observeCommands((observation) => {
      dispatch({ type: "observe", observation });
    });
    return unsubscribe;
  }, [observeCommands]);

  // 显式打开/重放信号（帮助菜单）。
  useEffect(() => {
    if (replaySignal > 0) {
      explicitOpenRequested.current = true;
      dispatch({ type: "show" });
    }
  }, [replaySignal]);

  // 状态持久化：completed/skipped/in-progress 写偏好；not-started 不写。
  const lastPersisted = useRef<OnboardingState["status"]>("not-started");
  useEffect(() => {
    if (state.status === lastPersisted.current) return;
    if (state.status === "not-started") return;
    lastPersisted.current = state.status;
    void preferences.store(state.status).catch((error: unknown) => {
      // 偏好写失败不阻塞引导/编辑（本机偏好可丢失，PRD 不要求强一致）。
      onPreferenceWarning?.(
        `本机偏好保存失败，引导仍可继续：${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, [onPreferenceWarning, state.status, preferences]);

  const handlers = useMemo(
    () => ({
      onStart: () => dispatch({ type: "start" }),
      onNext: () => dispatch({ type: "next" }),
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
      onNext={handlers.onNext}
      onSkip={handlers.onSkip}
      onHide={handlers.onHide}
    />
  );
}
