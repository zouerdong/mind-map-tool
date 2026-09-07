import { describe, expect, it } from "vitest";
import { FONT_RESOURCE_LIMITS, validateFontBundle, type FontBundle } from "../src/font-source.js";
import { renderPdf } from "../src/render-pdf.js";
import { renderPng } from "../src/render-png.js";

function bundle(
  regular: Uint8Array = new Uint8Array(1),
  bold: Uint8Array = new Uint8Array(1),
  lxgw: Uint8Array = new Uint8Array(1),
): FontBundle {
  return {
    "noto-sans-sc-regular": regular,
    "noto-sans-sc-bold": bold,
    "lxgw-wenkai-regular": lxgw,
  };
}

const scene = {
  empty: false,
  theme: "light",
  width: 10,
  height: 10,
  fontToken: "noto-sans-sc",
  items: [],
} as never;

describe("导出字体资源上限", () => {
  it("按单字体和总包分别拒绝超限资源", () => {
    const perFont = bundle(new Uint8Array(FONT_RESOURCE_LIMITS.maxBytesPerFont + 1));
    const perFontResult = validateFontBundle(perFont);
    expect(perFontResult.ok).toBe(false);
    if (!perFontResult.ok) {
      expect(perFontResult.error.fontId).toBe("noto-sans-sc-regular");
    }

    const total = bundle(
      new Uint8Array(22 * 1024 * 1024),
      new Uint8Array(22 * 1024 * 1024),
      new Uint8Array(22 * 1024 * 1024),
    );
    const totalResult = validateFontBundle(total);
    expect(totalResult.ok).toBe(false);
    if (!totalResult.ok) expect(totalResult.error.fontId).toBeNull();
  });

  it("PNG/PDF 在进入 renderer 前返回结构化字体错误", async () => {
    const tooLarge = bundle(new Uint8Array(FONT_RESOURCE_LIMITS.maxBytesPerFont + 1));
    const png = await renderPng(new Uint8Array(), scene, tooLarge);
    expect(png.ok).toBe(false);
    if (!png.ok) expect(png.error.code).toBe("EXPORT_FONT_RESOURCE_LIMIT");

    const pdf = await renderPdf(scene, tooLarge);
    expect(pdf.ok).toBe(false);
    if (!pdf.ok) expect(pdf.error.code).toBe("EXPORT_FONT_RESOURCE_LIMIT");
  });
});
