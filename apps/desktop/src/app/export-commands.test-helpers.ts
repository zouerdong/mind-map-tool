// 导出 renderer fake（export-commands 与 file-commands 两个测试文件共用）。

import type { ExportRendererLike } from "./export-commands.js";

/** 可用 renderer（视觉格式路径的对照组；file-commands 统一流程测试共用）。 */
export function okRenderer(): ExportRendererLike {
  return {
    async buildScene() {
      return { ok: true as const, scene: { nodeCount: 2 } };
    },
    async renderSvg() {
      return new TextEncoder().encode("<svg/>");
    },
    async renderPng() {
      return new Uint8Array([0x89, 0x50]);
    },
    async renderPdf() {
      return new Uint8Array([0x25, 0x50]);
    },
    fonts() {
      return {
        regular: () => ({ advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 }),
        bold: () => ({ advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 }),
      };
    },
  };
}
