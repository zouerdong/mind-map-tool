// 2x PNG renderer（web-ts-wasm 分支唯一 owner；Spike 已验证 resvg-wasm 用法）。

import { Resvg, initWasm } from "@resvg/resvg-wasm";
import type { ExportScene } from "./scene.js";
import { checkExportSize } from "./scene.js";
import { resvgFontBuffers, type FontBundle } from "./font-source.js";

export type PngResult =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; error: { code: "EXPORT_SIZE_LIMIT"; w: number; h: number } };

let wasmReady: Promise<void> | null = null;

/** resvg wasm 初始化（幂等）；wasmBinary 由宿主注入（Node 读文件 / WebView 打包资源）。 */
export async function initResvgWasm(wasmBinary: Uint8Array): Promise<void> {
  if (!wasmReady)
    wasmReady = initWasm(wasmBinary).catch((e) => {
      wasmReady = null;
      throw e;
    });
  return wasmReady;
}

export async function renderPng(
  svgBytes: Uint8Array,
  scene: ExportScene,
  bundle: FontBundle,
  scale = 2,
): Promise<PngResult> {
  const guard = checkExportSize(scene, scale);
  if (!guard.ok) return { ok: false, error: guard.error };
  const resvg = new Resvg(svgBytes, {
    fitTo: { mode: "zoom", value: scale },
    font: {
      fontBuffers: resvgFontBuffers(bundle),
      loadSystemFonts: false,
      defaultFontFamily: scene.fontToken === "lxgw-wenkai" ? "LXGW WenKai" : "Noto Sans SC",
    },
  });
  const png = resvg.render().asPng();
  return { ok: true, bytes: png, width: guard.w, height: guard.h };
}
