// shortcut-hints（ADR 0017）：双平台键位徽记显示。
import { describe, expect, it } from "vitest";
import { shortcutHints } from "../src/shortcut-hints.js";
import { ONBOARDING_COPY, onboardingCopy } from "../src/onboarding/onboarding-copy.js";

const MAC_GLYPHS = /[⌘⌥⇧⌃]/;

describe("shortcutHints", () => {
  it("mac 表保留 ⌘ 系字形（历史行为）", () => {
    const h = shortcutHints("mac");
    expect(h.organize).toBe("⇧⌘L");
    expect(h.quickCreate).toBe("⌥Space");
  });

  it("pc 表为 Ctrl 系文字（Microsoft 修饰键序），无 mac 字形", () => {
    const h = shortcutHints("pc");
    for (const v of Object.values(h)) expect(v).not.toMatch(MAC_GLYPHS);
    expect(h.organize).toBe("Ctrl+Shift+L");
    expect(h.redo).toBe("Ctrl+Shift+Z");
    expect(h.quickCreate).toBe("Alt+Space");
    expect(h.save).toBe("Ctrl+S");
  });
});

describe("onboardingCopy 平台化", () => {
  it("默认导出 ONBOARDING_COPY 保持 mac 文案（兼容历史消费方）", () => {
    expect(ONBOARDING_COPY["create-first"].body).toContain("⌥Space");
  });

  it("pc 文案全部 Ctrl 系且无 mac 字形", () => {
    const table = onboardingCopy("pc");
    for (const copy of Object.values(table)) {
      expect(copy.body).not.toMatch(MAC_GLYPHS);
    }
    expect(table["create-first"].body).toContain("Alt+Space");
    expect(table["create-first"].body).toContain("Ctrl+Enter");
    expect(table["undo-or-theme"].body).toContain("Ctrl+Shift+L");
    expect(table["save-or-export"].body).toContain("Ctrl+E");
  });

  it("两平台步骤集合一致", () => {
    expect(Object.keys(onboardingCopy("pc")).sort()).toEqual(
      Object.keys(onboardingCopy("mac")).sort(),
    );
  });
});
