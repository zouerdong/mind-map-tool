// visual-style 契约测试（VRA-040）：token 数值与 tokens 文档一致、双层文案测量、角色/线型外观。
// FontResolver 注入 fake 度量：CJK 全角 = fontSize、其余 = fontSize/2；ascent = 0.8。

import { describe, expect, it } from "vitest";
import {
  DARK_PALETTE,
  EDGE_VISUAL,
  LIGHT_PALETTE,
  VISUAL_TYPOGRAPHY,
  edgeAppearance,
  layoutNodeVisual,
  measureNodeVisual,
  nodeColorsOf,
  nodeRoleOf,
} from "../src/visual-style.js";
import type { FontResolver } from "../src/layout.js";

const isWide = (ch: string) => ch.codePointAt(0)! > 0x2e7f;

const fonts: FontResolver = {
  regular: () => ({
    advance: (ch, fontSize) => (isWide(ch) ? fontSize : fontSize / 2),
    ascentRatio: 0.8,
  }),
  bold: () => null, // 无真粗体（文楷同型）→ 测量走 regular
};

describe("视觉 token 与文档一致（docs/product/visual-state-tokens-2026-09-06.md）", () => {
  it("§1.1 暖白色板精确值", () => {
    expect(LIGHT_PALETTE.canvas).toBe("#F9F8F4");
    expect(LIGHT_PALETTE.cardNormalFill).toBe("#141412");
    expect(LIGHT_PALETTE.cardNormalText).toBe("#F5F2EA");
    expect(LIGHT_PALETTE.cardNormalKicker).toBe("#A8A296");
    expect(LIGHT_PALETTE.cardAccentFill).toBe("#D97757");
    expect(LIGHT_PALETTE.cardAccentText).toBe("#331708");
    expect(LIGHT_PALETTE.cardAccentKicker).toBe("#6B3A22");
    expect(LIGHT_PALETTE.edgePrimary).toBe("#4A4640");
    expect(LIGHT_PALETTE.edgeSecondary).toBe("#8A8478");
  });

  it("§1.2 黑板同构色板（卡片实心、两级文字、橙不反转）", () => {
    expect(DARK_PALETTE.canvas).toBe("#16140F");
    expect(DARK_PALETTE.cardNormalFill).toBe("#EFEAE0");
    expect(DARK_PALETTE.cardNormalText).toBe("#141412");
    expect(DARK_PALETTE.cardNormalKicker).toBe("#7A7264");
    expect(DARK_PALETTE.cardAccentFill).toBe("#D97757");
    expect(DARK_PALETTE.cardAccentText).toBe("#331708");
    expect(DARK_PALETTE.edgePrimary).toBe("#A39C8E");
    expect(DARK_PALETTE.edgeSecondary).toBe("#6B655A");
  });

  it("§1.3 排版与几何 token（眉题 11 / 正文 16 / 圆角 12 / 内距 16-12）", () => {
    expect(VISUAL_TYPOGRAPHY.kickerFontSize).toBe(11);
    expect(VISUAL_TYPOGRAPHY.kickerLineHeight).toBeCloseTo(14.3, 6);
    expect(VISUAL_TYPOGRAPHY.kickerLetterSpacing).toBeCloseTo(0.66, 6);
    expect(VISUAL_TYPOGRAPHY.bodyFontSize).toBe(16);
    expect(VISUAL_TYPOGRAPHY.bodyLineHeightFactor).toBe(1.4);
    expect(VISUAL_TYPOGRAPHY.paddingX).toBe(16);
    expect(VISUAL_TYPOGRAPHY.paddingTop).toBe(12);
    expect(VISUAL_TYPOGRAPHY.kickerBodyGap).toBe(6);
    expect(VISUAL_TYPOGRAPHY.paddingBottom).toBe(12);
    expect(VISUAL_TYPOGRAPHY.cardRadius).toBe(12);
    expect(VISUAL_TYPOGRAPHY.cardMinWidth).toBe(120);
    expect(VISUAL_TYPOGRAPHY.cardMaxWidth).toBe(260);
  });

  it("§1.4 连线外观 token（宽 2/1.5、虚 5 4、点 0.1 5、箭头 9×7、gap 4、r 12）", () => {
    expect(EDGE_VISUAL.widthPrimary).toBe(2);
    expect(EDGE_VISUAL.widthSecondary).toBe(1.5);
    expect([...EDGE_VISUAL.dashDashed]).toEqual([5, 4]);
    expect([...EDGE_VISUAL.dashDotted]).toEqual([0.1, 5]);
    expect(EDGE_VISUAL.arrowLength).toBe(9);
    expect(EDGE_VISUAL.arrowHalfWidth).toBe(3.5);
    expect(EDGE_VISUAL.endpointGap).toBe(4);
    expect(EDGE_VISUAL.filletRadius).toBe(12);
  });

  it("线型 → 色/宽/dash/端帽（次要线用 edge.secondary 与 1.5px）", () => {
    expect(edgeAppearance("solid", LIGHT_PALETTE)).toEqual({
      stroke: "#4A4640",
      width: 2,
      dash: null,
      roundCap: false,
    });
    const dashed = edgeAppearance("dashed", LIGHT_PALETTE);
    expect(dashed.stroke).toBe("#8A8478");
    expect(dashed.width).toBe(1.5);
    expect([...(dashed.dash ?? [])]).toEqual([5, 4]);
    expect(dashed.roundCap).toBe(false);
    const dotted = edgeAppearance("dotted", LIGHT_PALETTE);
    expect([...(dotted.dash ?? [])]).toEqual([0.1, 5]);
    expect(dotted.roundCap).toBe(true);
  });
});

describe("节点角色与配色（ADR 0010 / D2）", () => {
  it("emphasis 缺省为 normal，true 为 accent；不自动派生", () => {
    expect(nodeRoleOf({})).toBe("normal");
    expect(nodeRoleOf({ emphasis: false })).toBe("normal");
    expect(nodeRoleOf({ emphasis: true })).toBe("accent");
  });

  it("角色配色：普通=深卡暖白字，强调=橙卡深字；两主题橙卡一致", () => {
    const lightNormal = nodeColorsOf(LIGHT_PALETTE, "normal", true);
    expect(lightNormal.fill).toBe("#141412");
    expect(lightNormal.text).toBe("#F5F2EA");
    expect(lightNormal.kicker).toBe("#A8A296");
    const lightAccent = nodeColorsOf(LIGHT_PALETTE, "accent", true);
    expect(lightAccent.fill).toBe("#D97757");
    expect(lightAccent.text).toBe("#331708");
    const darkAccent = nodeColorsOf(DARK_PALETTE, "accent", true);
    expect(darkAccent.fill).toBe("#D97757");
    expect(darkAccent.text).toBe("#331708");
    const darkNormal = nodeColorsOf(DARK_PALETTE, "normal", true);
    expect(darkNormal.fill).toBe("#EFEAE0");
    expect(darkNormal.text).toBe("#141412");
  });

  it("framesVisible=false：无卡底，文字落到画布墨色（墨纸互换）", () => {
    expect(nodeColorsOf(LIGHT_PALETTE, "normal", false).fill).toBeNull();
    expect(nodeColorsOf(LIGHT_PALETTE, "normal", false).text).toBe("#141412");
    expect(nodeColorsOf(DARK_PALETTE, "normal", false).text).toBe("#EFEAE0");
  });
});

describe("节点测量（kicker + runs 正文，UI/导出同源）", () => {
  it("无眉题单行：卡高 = 12 + 22.4 + 12；宽度走 120 下限", () => {
    const s = measureNodeVisual({ text: "起点" }, "noto-sans-sc", fonts);
    expect(s.height).toBeCloseTo(12 + 16 * 1.4 + 12, 6);
    expect(s.width).toBe(VISUAL_TYPOGRAPHY.cardMinWidth); // 2 字 ×16 = 32 + 32 < 120
  });

  it("眉题加高：+14.3 行高 + 6 gap（§1.3 卡高基准 68 ≈ 单眉题+单行正文）", () => {
    const plain = measureNodeVisual({ text: "捕捉" }, "noto-sans-sc", fonts);
    const withKicker = measureNodeVisual({ text: "捕捉", kicker: "灵感 IDEA" }, "noto-sans-sc", fonts);
    expect(withKicker.height - plain.height).toBeCloseTo(14.3 + 6, 6);
    expect(withKicker.height).toBeCloseTo(66.7, 6);
  });

  it("空串眉题等价缺省（D3：不渲染眉题行，卡高自然收缩）", () => {
    expect(measureNodeVisual({ text: "A", kicker: "" }, "noto-sans-sc", fonts)).toEqual(
      measureNodeVisual({ text: "A" }, "noto-sans-sc", fonts),
    );
  });

  it("多行正文按 1.4 行高累加；\\n 显式换行", () => {
    const two = measureNodeVisual({ text: "Alpha\nBeta" }, "noto-sans-sc", fonts);
    expect(two.height).toBeCloseTo(12 + 2 * 22.4 + 12, 6);
  });

  it("runs 字号抬高行高（行高 = 行内最大字号 × 1.4）", () => {
    const s = measureNodeVisual(
      { text: "标题小", runs: [{ start: 0, end: 2, fontSize: 22 }] },
      "noto-sans-sc",
      fonts,
    );
    expect(s.height).toBeCloseTo(12 + 22 * 1.4 + 12, 6);
  });

  it("宽度自适应：内容超过 260 下限按内容延展（无软换行，不截断）", () => {
    const wide = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; // 36 字符 × 8 = 288 + 32
    const s = measureNodeVisual({ text: wide }, "noto-sans-sc", fonts);
    expect(s.width).toBeGreaterThan(VISUAL_TYPOGRAPHY.cardMaxWidth);
    expect(s.width).toBeCloseTo(36 * 8 + 32, 6);
  });

  it("眉题宽度计入卡宽（长中文眉题不溢出）", () => {
    const kicker = "知识库长期沉淀 KNOWLEDGE BASE"; // ≤ 40 字符（ADR 0010 上限内）
    expect(kicker.length).toBeLessThanOrEqual(40);
    const s = measureNodeVisual({ text: "笔记", kicker }, "noto-sans-sc", fonts);
    const bodyOnly = measureNodeVisual({ text: "笔记" }, "noto-sans-sc", fonts);
    expect(s.width).toBeGreaterThan(bodyOnly.width);
    expect(s.width).toBeLessThanOrEqual(VISUAL_TYPOGRAPHY.cardMaxWidth);
  });
});

describe("完整节点布局（相对框几何）", () => {
  it("眉题在上、正文在下；baseline 均为正值且眉题先于正文", () => {
    const v = layoutNodeVisual(
      { text: "Alpha\nBeta", kicker: "SECTION" },
      "card",
      "noto-sans-sc",
      fonts,
    );
    expect(v.kicker).not.toBeNull();
    expect(v.kicker!.fontSize).toBe(11);
    expect(v.kicker!.letterSpacing).toBeCloseTo(0.66, 6);
    expect(v.kicker!.baselineY).toBeGreaterThan(0);
    expect(v.kicker!.baselineY).toBeLessThan(VISUAL_TYPOGRAPHY.kickerLineHeight + 12);
    expect(v.bodyTop).toBeCloseTo(14.3 + 6, 6); // 相对内容块顶（paddingTop 由 scene 定位时加）
    expect(v.lines).toHaveLength(2);
    expect(v.role).toBe("normal");
    expect(v.measured.height).toBeCloseTo(66.7 + 22.4, 6); // 眉题 + 两行正文
  });

  it("emphasis 角色映射到布局；shape 透传", () => {
    const v = layoutNodeVisual({ text: "重点", emphasis: true }, "ellipse", "noto-sans-sc", fonts);
    expect(v.role).toBe("accent");
    expect(v.shape).toBe("ellipse");
  });

  it("确定性：同输入两次布局完全一致", () => {
    const node = { text: "Alpha\nBeta 中文", kicker: "眉题", runs: [{ start: 0, end: 1, bold: true }] };
    expect(layoutNodeVisual(node, "card", "noto-sans-sc", fonts)).toEqual(
      layoutNodeVisual(node, "card", "noto-sans-sc", fonts),
    );
  });
});
