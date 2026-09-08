import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop UI bundled fonts", () => {
  it("main imports CSS that maps both UI font families to shipped WOFF2 assets", () => {
    const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    const css = readFileSync(resolve(__dirname, "../fonts.css"), "utf8");

    expect(main).toContain('import "./fonts.css"');
    expect(css).toContain('font-family: "Noto Sans SC"');
    expect(css).toContain("noto-sans-sc-regular.woff2");
    expect(css).toContain("noto-sans-sc-bold.woff2");
    expect(css).toContain('font-family: "LXGW WenKai"');
    expect(css).toContain("lxgw-wenkai-regular.woff2");
  });
});
