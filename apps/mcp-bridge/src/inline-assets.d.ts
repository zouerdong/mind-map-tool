// inline-assets.d.ts — esbuild binary loader 导入的类型声明（ADR 0018）。
// 运行值由打包器注入（Uint8Array）；tsc 仅据此通过类型检查。

declare module "*.woff2" {
  const data: Uint8Array;
  export default data;
}

declare module "@resvg/resvg-wasm/index_bg.wasm" {
  const data: Uint8Array;
  export default data;
}
