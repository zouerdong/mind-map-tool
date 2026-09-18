// 引导遮罩与提示卡（MM-070 ③⑤）：
// - 遮罩 pointer-events:none —— 画布保持可交互（引导要求用户完成真实动作）；
// - 卡片锚定 semantic anchor（data-onboarding-anchor），不复制交互实现；
// - prefers-reduced-motion：无过渡，直接呈现；
// - 非模态（aria-modal=false、无焦点 trap）——不阻塞关闭或任何系统行为。

import { useEffect, useState } from "react";
import type { ThemeTokens } from "../theme/theme-tokens.js";
import type { ShortcutPlatform } from "../shortcut-hints.js";
import { ONBOARDING_COPY, onboardingCopy } from "./onboarding-copy.js";
import { ONBOARDING_STEPS } from "./onboarding-types.js";
import type { OnboardingState } from "./onboarding-types.js";

export interface OnboardingOverlayProps {
  state: OnboardingState;
  tokens: ThemeTokens;
  onStart(): void;
  /** 显式“下一步”（welcome→第一步；步骤内直接推进；末步=完成引导）。 */
  onNext(): void;
  onSkip(): void;
  onHide(): void;
  /** 锚点查找（默认 document.querySelector；测试可注入）。 */
  anchorLookup?(semanticId: string): HTMLElement | null;
  /** 键位徽记平台（ADR 0017；默认 mac 保持历史行为）。 */
  platform?: ShortcutPlatform;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof matchMedia === "function"
      ? matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function OnboardingOverlay({
  state,
  tokens,
  onStart,
  onNext,
  onSkip,
  onHide,
  anchorLookup,
  platform = "mac",
}: OnboardingOverlayProps) {
  const reducedMotion = usePrefersReducedMotion();
  if (!state.visible || state.currentStep === null) return null;

  const spec = ONBOARDING_STEPS.find((s) => s.id === state.currentStep);
  if (!spec) return null;
  const copy = (platform === "mac" ? ONBOARDING_COPY : onboardingCopy(platform))[spec.id];

  // 锚点定位（真实控件贴近展示；无锚点居中）。
  const anchorEl = spec.anchor
    ? (anchorLookup?.(spec.anchor) ??
      (typeof document === "undefined"
        ? null
        : document.querySelector<HTMLElement>(`[data-onboarding-anchor="${spec.anchor}"]`)))
    : null;
  const rect = anchorEl?.getBoundingClientRect();
  const cardStyle: React.CSSProperties = rect
    ? {
        position: "absolute",
        left: Math.max(8, rect.left),
        top: Math.max(8, rect.bottom + 8),
      }
    : {
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: reducedMotion ? "translate(-50%, -50%)" : "translate(-50%, -50%)",
      };

  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === spec.id);
  const actionableSteps = ONBOARDING_STEPS.filter((s) => s.observe.length > 0);
  const isWelcome = spec.id === "welcome";

  return (
    <div
      data-testid="onboarding-overlay"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none", // 遮罩不拦截：画布可操作、关闭不受阻
        background: tokens.onboardingScrim,
        ...(reducedMotion ? {} : { transition: "background 150ms ease" }),
      }}
    >
      <section
        role="dialog"
        aria-modal={false}
        aria-label={copy.title}
        style={{
          ...cardStyle,
          pointerEvents: "auto", // 只有卡片可交互
          maxWidth: 340,
          padding: "14px 16px",
          background: tokens.onboardingCardBackground,
          border: `1px solid ${tokens.onboardingCardBorder}`,
          color: tokens.onboardingCardText,
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          fontFamily: "inherit",
        }}
        data-testid="onboarding-card"
      >
        {/* OFR-2026-09-15：welcome 是入口卡不是第 1 步——不显示步数，避免与
            第一步同显“引导 1/4”造成“卡住”错觉（负责人 dogfood 实测误读）。 */}
        {!isWelcome ? (
          <div aria-live="polite" style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
            引导 {Math.max(0, stepIndex - 1) + 1}/{actionableSteps.length}
          </div>
        ) : null}
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>{copy.title}</h2>
        <p style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.6 }}>{copy.body}</p>
        {copy.hint ? (
          <p style={{ fontSize: 12, margin: "0 0 10px", opacity: 0.7 }}>{copy.hint}</p>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          {copy.primary ? (
            // welcome 的 primary=开始引导（onStart）；其余步骤的 primary
            //（如末步“稍后再说，完成引导”）语义是显式推进（onNext）——
            // 此前末步错接到 onStart 会跳回第一步（OFR-2026-09-15）。
            <button
              type="button"
              onClick={isWelcome ? onStart : onNext}
              data-testid="onboarding-primary"
            >
              {copy.primary}
            </button>
          ) : null}
          {/* PRD §7.2：步骤卡提供“下一步”与“跳过”——动作自动推进之外始终
              有显式出口，不再只能关掉（OFR-2026-09-15 负责人反馈）。 */}
          {!isWelcome && copy.primary === undefined ? (
            <button type="button" onClick={onNext} data-testid="onboarding-next">
              下一步
            </button>
          ) : null}
          {copy.secondary ? (
            <button type="button" onClick={onSkip} data-testid="onboarding-skip">
              {copy.secondary}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onHide}
            aria-label="暂时隐藏引导"
            data-testid="onboarding-hide"
            style={{ marginLeft: "auto" }}
          >
            ×
          </button>
        </div>
      </section>
    </div>
  );
}
