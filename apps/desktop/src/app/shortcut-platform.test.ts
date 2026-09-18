// detectShortcutPlatform（ADR 0017）：UA → 键位徽记平台（仅显示用）。
import { describe, expect, it } from "vitest";
import { detectShortcutPlatform } from "./shortcut-platform.js";

describe("detectShortcutPlatform", () => {
  it("Windows WebView2 UA → pc", () => {
    expect(
      detectShortcutPlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toBe("pc");
  });

  it("macOS WKWebView UA → mac", () => {
    expect(
      detectShortcutPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("mac");
  });

  it("Linux/Android → pc（Ctrl 系显示）", () => {
    expect(detectShortcutPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("pc");
    expect(detectShortcutPlatform("Mozilla/5.0 (Linux; Android 15)")).toBe("pc");
  });

  it("未知环境 → mac（历史行为）", () => {
    expect(detectShortcutPlatform(undefined)).toBe("mac");
  });
});
