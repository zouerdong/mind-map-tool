// @vitest-environment jsdom
// a11y 套件（MM-070 ⑥；AC-05 的 a11y 门槛）：
// axe-core 扫描画布、引导遮罩、主题切换的真实渲染。
// color-contrast 规则在此排除 —— jsdom 无布局，色对比由
// theme-tokens.test.ts 以 WCAG 相对亮度公式实算锁定（更强的保证）。

import axe from "axe-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DocumentSession, makeStateNode } from "@mindmap/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("../helpers/rf-stub.js").then((m) => m.rfStubModule()));

const { EditorCanvas } = await import("../../src/canvas/editor-canvas.js");
const { OnboardingFlow } = await import("../../src/onboarding/onboarding-flow.js");
const { ThemeToggle } = await import("../../src/theme/theme-toggle.js");
const { createOnboardingPreferences, InMemoryPreferenceStore } = await import("../../src/index.js");
const { makeDoc } = await import("../projection.test.js");

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

const fakeFonts: FontResolver = {
  regular: () => ({ advance: (_ch: string, size: number) => size * 10, ascentRatio: 0.8 }),
  bold: () => ({ advance: (_ch: string, size: number) => size * 10, ascentRatio: 0.8 }),
};

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom 无布局，色对比由 theme-tokens.test 数学断言（WCAG 公式实算）
      "color-contrast": { enabled: false },
    },
  });
  const violations = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`);
  expect(violations, `axe violations:\n${violations.join("\n")}`).toEqual([]);
}

describe("a11y：画布（AC-02/05 焦点与语义）", () => {
  it("EditorCanvas 无 axe violations", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    const { container } = render(<EditorCanvas session={session} fonts={fakeFonts} />);
    await expectNoViolations(container);
  });
});

describe("a11y：引导（AC-09）", () => {
  it("welcome 卡无 violations（dialog 语义、可聚焦按钮、live 区域）", async () => {
    const channel = {
      observeCommands: (_cb: unknown) => () => {},
    };
    const { container } = render(
      <OnboardingFlow
        observeCommands={channel.observeCommands as never}
        preferences={createOnboardingPreferences(new InMemoryPreferenceStore())}
      />,
    );
    // 等 welcome 卡出现（偏好异步载入后）
    await new Promise((r) => setTimeout(r, 10));
    await expectNoViolations(container);
  });
});

describe("a11y：主题切换（AC-05 可发现控件）", () => {
  it("ThemeToggle 有可读名称且无 violations", async () => {
    const onCommand = vi.fn();
    const { container, getByRole } = render(
      <ThemeToggle currentTheme="light" onCommand={onCommand} />,
    );
    expect(getByRole("button", { name: "切换到黑板主题" })).toBeTruthy();
    await expectNoViolations(container);
  });
});
