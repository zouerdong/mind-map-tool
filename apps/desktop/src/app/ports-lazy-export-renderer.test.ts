// @vitest-environment jsdom
// PRR-066 红灯 5（renderer 边界）：LazyTauriExportRenderer 的 WASM 资源
// fetch 失败原因必须保留并随结构化错误透出，不得吞掉后伪装成"资源不存在"；
// 结构化失败以稳定 code 抛出（ExportRendererError 形状）供 toError 透传。

import { describe, expect, it, vi } from "vitest";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@mindmap/export", () => {
  const stubFonts: FontResolver = {
    regular: () => ({ advance: () => 10, ascentRatio: 0.8 }),
    bold: () => ({ advance: () => 10, ascentRatio: 0.8 }),
  };
  return {
    // loadResources 只消费 createExportRenderer；PNG 结构化失败由测试
    // 注入，其余方法给出最小可用实现。
    createExportRenderer: vi.fn(async () => ({
      fontResolver: () => stubFonts,
      buildScene: async () => ({ ok: true, scene: { nodeCount: 1 } }),
      renderSvg: async () => new TextEncoder().encode("<svg/>"),
      renderPng: async () => ({
        ok: false as const,
        error: {
          code: "EXPORT_WASM_UNAVAILABLE",
          message: "PNG 导出所需的 resvg WASM 尚未加载",
        },
      }),
      renderPdf: async () => ({ ok: true as const, bytes: new Uint8Array([1]) }),
    })),
  };
});

const { LazyTauriExportRenderer } = await import("./ports.js");

function stubFetch(wasmFailure: Error | null) {
  const fontResponse = () =>
    Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }) as unknown as Response,
    );
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("index_bg.wasm")) {
      return wasmFailure ? Promise.reject(wasmFailure) : fontResponse();
    }
    return fontResponse();
  });
}

describe("PRR-066: LazyTauriExportRenderer WASM 失败原因保留", () => {
  it("wasm fetch 失败：renderPng 错误同时携带稳定 code 与 fetch 底层原因", async () => {
    const fetchMock = stubFetch(new Error("wasm 网络中断"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const renderer = new LazyTauriExportRenderer();
      const error = await renderer
        .renderPng(new TextEncoder().encode("<svg/>"), {})
        .catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      const err = error as Error & { code?: string };
      expect(err.code).toBe("EXPORT_WASM_UNAVAILABLE");
      expect(err.message).toContain("PNG 导出所需的 resvg WASM 尚未加载");
      // 不吞 fetch 原因、不伪装成"资源不存在"
      expect(err.message).toContain("wasm 网络中断");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("wasm fetch 成功：结构化失败直接透传（不追加伪原因）", async () => {
    const fetchMock = stubFetch(null);
    vi.stubGlobal("fetch", fetchMock);
    try {
      const renderer = new LazyTauriExportRenderer();
      const error = await renderer
        .renderPng(new TextEncoder().encode("<svg/>"), {})
        .catch((e) => e);
      const err = error as Error & { code?: string };
      expect(err.code).toBe("EXPORT_WASM_UNAVAILABLE");
      expect(err.message).toContain("PNG 导出所需的 resvg WASM 尚未加载");
      expect(err.message).not.toContain("WASM 资源加载失败");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
