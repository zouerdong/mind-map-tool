// 主题 tokens 测试（VRA-050 ①；AC-05）：G-VIS 定稿 palette 的对比度实算断言。
// 正文 ≥4.5:1；眉题为辅助文字 ≥3:1；图形非文本（线/选中/焦点/端口）≥3:1。
// 暖白/黑板极简约束（无装饰色）；与 export palette 的同源对照见 visual-contract.test.ts。

import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DARK_TOKENS,
  LIGHT_TOKENS,
  themeTokens,
  type ThemeTokens,
} from "../src/theme/theme-tokens.js";

const TEXT_PAIRS = (t: ThemeTokens) =>
  [
    ["普通卡正文/卡底", t.cardNormalText, t.cardNormalFill],
    ["强调卡正文/卡底", t.cardAccentText, t.cardAccentFill],
    ["编辑光标/普通卡底", t.editingCaret, t.cardNormalFill],
    ["shell 文字/画布底", t.shellText, t.canvasBackground],
    ["提示卡正文/卡底", t.onboardingCardText, t.onboardingCardBackground],
  ] as const;

const KICKER_PAIRS = (t: ThemeTokens) =>
  [
    ["普通卡眉题/卡底", t.cardNormalKicker, t.cardNormalFill],
    ["强调卡眉题/卡底", t.cardAccentKicker, t.cardAccentFill],
  ] as const;

const GRAPHIC_PAIRS = (t: ThemeTokens) =>
  [
    ["主线/画布底", t.edgePrimary, t.canvasBackground],
    ["次线/画布底", t.edgeSecondary, t.canvasBackground],
    ["选择描边/画布底", t.selectionOutline, t.canvasBackground],
    ["焦点环/画布底", t.focusRing, t.canvasBackground],
    ["拖动框/画布底", t.draggingOutline, t.canvasBackground],
    ["端口/画布底", t.hoverPort, t.canvasBackground],
    ["提示卡描边/卡底", t.onboardingCardBorder, t.onboardingCardBackground],
  ] as const;

describe("两主题对比度（WCAG 2.2，实算断言；G-VIS palette）", () => {
  for (const [name, tokens] of [
    ["light", LIGHT_TOKENS],
    ["dark", DARK_TOKENS],
  ] as const) {
    it(`${name}：正文对比 ≥4.5:1`, () => {
      for (const [label, fg, bg] of TEXT_PAIRS(tokens)) {
        expect(contrastRatio(fg, bg), `${name} ${label} ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${name}：眉题辅助文字 ≥3:1`, () => {
      for (const [label, fg, bg] of KICKER_PAIRS(tokens)) {
        expect(contrastRatio(fg, bg), `${name} ${label} ${fg}/${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
    it(`${name}：图形非文本对比 ≥3:1（内容/选择/焦点/连接，AC-05）`, () => {
      for (const [label, fg, bg] of GRAPHIC_PAIRS(tokens)) {
        expect(contrastRatio(fg, bg), `${name} ${label} ${fg}/${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("暖白/黑板极简（G-VIS D1，覆盖旧纯白/纯黑措辞）", () => {
    expect(LIGHT_TOKENS.canvasBackground).toBe("#F9F8F4");
    expect(DARK_TOKENS.canvasBackground).toBe("#16140F");
    expect(LIGHT_TOKENS.cardNormalFill).toBe("#141412");
  });

  it("两主题 tokens 覆盖同一状态面（键一致）", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
  });

  it("强调色/圆角/状态色跨主题一致（橙不随主题反转；§1.1 原则 + 状态变体）", () => {
    expect(LIGHT_TOKENS.cardAccentFill).toBe(DARK_TOKENS.cardAccentFill);
    expect(LIGHT_TOKENS.cardRadius).toBe(DARK_TOKENS.cardRadius);
    expect(LIGHT_TOKENS.cardAccentFill).toBe("#D97757"); // 卡片填充 = G-VIS 已批产品 token
    expect(LIGHT_TOKENS.selectionOutline).toBe("#D06B47"); // 细描边状态变体（≥3:1 实测修正）
  });

  it("themeTokens 按 ThemeName 派生", () => {
    expect(themeTokens("light")).toBe(LIGHT_TOKENS);
    expect(themeTokens("dark")).toBe(DARK_TOKENS);
  });
});

describe("对比度工具", () => {
  it("已知值：黑白对比 = 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
  it("自身对比 = 1；非法 hex 报错", () => {
    expect(contrastRatio("#808080", "#808080")).toBeCloseTo(1, 5);
    expect(() => contrastRatio("red", "#ffffff")).toThrow();
  });
});
