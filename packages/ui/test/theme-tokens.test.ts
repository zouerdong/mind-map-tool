// 主题 tokens 测试（MM-070 ①；AC-05）：
// 两主题全状态对比达标（正文 ≥4.5:1、图形非文本 ≥3:1，WCAG 2.2），
// 纯白/纯黑极简约束（无装饰色），tokens 覆盖状态面完整。

import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DARK_TOKENS,
  LIGHT_TOKENS,
  themeTokens,
  type ThemeTokens,
} from "../src/theme/theme-tokens.js";

const TEXT_PAIRS = (t: ThemeTokens) => [
  ["正文/节点底", t.nodeText, t.nodeBackground],
  ["编辑光标/编辑底", t.editingCaret, t.editingBackground],
  ["提示卡正文/卡底", t.onboardingCardText, t.onboardingCardBackground],
] as const;

const GRAPHIC_PAIRS = (t: ThemeTokens) => [
  ["节点描边/画布底", t.nodeBorder, t.canvasBackground],
  ["节点描边/节点底", t.nodeBorder, t.nodeBackground],
  ["连接线/画布底", t.edgeStroke, t.canvasBackground],
  ["选择框/画布底", t.selectionOutline, t.canvasBackground],
  ["焦点环/画布底", t.focusRing, t.canvasBackground],
  ["拖动框/画布底", t.draggingOutline, t.canvasBackground],
  ["卡描边/卡底", t.onboardingCardBorder, t.onboardingCardBackground],
] as const;

describe("两主题对比度（WCAG 2.2，实算断言）", () => {
  for (const [name, tokens] of [
    ["light", LIGHT_TOKENS],
    ["dark", DARK_TOKENS],
  ] as const) {
    it(`${name}：正文对比 ≥4.5:1`, () => {
      for (const [label, fg, bg] of TEXT_PAIRS(tokens)) {
        expect(contrastRatio(fg, bg), `${name} ${label} ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${name}：图形非文本对比 ≥3:1（内容/选择/焦点/连接状态清晰，AC-05）`, () => {
      for (const [label, fg, bg] of GRAPHIC_PAIRS(tokens)) {
        expect(contrastRatio(fg, bg), `${name} ${label} ${fg}/${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("纯白/纯黑极简：画布底色为 #ffffff / #000000（PRD [from-user] 无质感装饰）", () => {
    expect(LIGHT_TOKENS.canvasBackground).toBe("#ffffff");
    expect(DARK_TOKENS.canvasBackground).toBe("#000000");
  });

  it("两主题 tokens 互不相同且覆盖同一状态面（键一致）", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
    for (const key of Object.keys(LIGHT_TOKENS) as Array<keyof ThemeTokens>) {
      expect(LIGHT_TOKENS[key]).not.toBe(DARK_TOKENS[key]);
    }
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
