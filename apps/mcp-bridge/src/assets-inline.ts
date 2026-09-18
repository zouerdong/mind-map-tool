// assets-inline.ts — 独立运行时（安装包内）的内嵌资产（ADR 0018）。
// 仅供 server-standalone.ts 经 esbuild binary loader 打包：字体与 resvg
// WASM 字节直接编译进 mindmap-mcp.mjs，运行时零文件系统依赖。
// 与 assets.ts（fs 读取）加载同一批文件，渲染结果字节级同源。
// 本模块不得在仓库开发态直接执行（离开 esbuild loader 无法解析这些导入）。

import lxgwWenkaiRegular from "../../../assets/fonts/lxgw-wenkai-regular.woff2";
import notoSansScBold from "../../../assets/fonts/noto-sans-sc-bold.woff2";
import notoSansScRegular from "../../../assets/fonts/noto-sans-sc-regular.woff2";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import type { FontBundle } from "@mindmap/export";

export function loadInlineFontBundle(): FontBundle {
  return {
    "noto-sans-sc-regular": notoSansScRegular,
    "noto-sans-sc-bold": notoSansScBold,
    "lxgw-wenkai-regular": lxgwWenkaiRegular,
  };
}

export function loadInlineResvgWasm(): Uint8Array {
  return resvgWasm;
}
