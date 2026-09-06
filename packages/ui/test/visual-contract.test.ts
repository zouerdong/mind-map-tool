// 同源防线（VRA-050 ①）：ui theme-tokens ↔ export visual-style palette 对照断言。
// ui 与 export 必须消费同一组视觉常数（G-VIS tokens）；任何一侧漂移在本测试失败，
// 而不是等到 UI/导出视觉分叉（audit 差距 #6）才被发现。

import { describe, expect, it } from "vitest";
import { DARK_TOKENS, LIGHT_TOKENS } from "../src/theme/theme-tokens.js";
// 直引 visual-style 源（包入口 index.ts 会拉入 font-source/fontkit——
// 其 ambient 声明只对 export 自身 tsconfig 生效，ui 工程解析不到）
import { DARK_PALETTE, LIGHT_PALETTE } from "@mindmap/export/src/visual-style.js";

describe("ui ↔ export 视觉同源", () => {
  const cases = [
    ["light", LIGHT_TOKENS, LIGHT_PALETTE],
    ["dark", DARK_TOKENS, DARK_PALETTE],
  ] as const;

  it.each(cases)("%s：核心色值逐一相等", (_name, ui, ex) => {
    expect(ui.canvasBackground).toBe(ex.canvas);
    expect(ui.cardNormalFill).toBe(ex.cardNormalFill);
    expect(ui.cardNormalText).toBe(ex.cardNormalText);
    expect(ui.cardNormalKicker).toBe(ex.cardNormalKicker);
    expect(ui.cardAccentFill).toBe(ex.cardAccentFill);
    expect(ui.cardAccentText).toBe(ex.cardAccentText);
    expect(ui.cardAccentKicker).toBe(ex.cardAccentKicker);
    expect(ui.edgePrimary).toBe(ex.edgePrimary);
    expect(ui.edgeSecondary).toBe(ex.edgeSecondary);
    expect(ui.canvasInk).toBe(ex.canvasInk);
    expect(ui.canvasKicker).toBe(ex.canvasKicker);
  });

  it("状态色（选中/焦点/端口）= 加深强调变体（#D06B47，暖白底 3.36:1 / 黑板 5.15:1）；卡填充 = 产品强调 #D97757", () => {
    for (const t of [LIGHT_TOKENS, DARK_TOKENS]) {
      expect(t.cardAccentFill).toBe("#D97757"); // 卡片大色块保持 G-VIS 已批产品 token
      expect(t.selectionOutline).toBe("#D06B47"); // 细描边需自身 ≥3:1（#D97757 对暖白仅 2.94:1）
      expect(t.focusRing).toBe("#D06B47");
      expect(t.hoverPort).toBe("#D06B47");
      expect(t.draggingOutline).toBe("#D06B47");
    }
  });
});
