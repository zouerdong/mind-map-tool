// canvas 性能 harness 的 vite 配置（MM-050）。
// build 产物由 run-performance.mjs 起静态服务并用 headless Chromium 采样。
// 零 import（harness 不是 workspace 包，config 加载时不解析 vite 包）；
// workspace 源码直出包（main: src/index.ts）统一 alias 到 TS 源。
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default {
  resolve: {
    alias: {
      "@mindmap/core": r("../../../core/src/index.ts"),
      "@mindmap/export/src/font-source.js": r("../../../export/src/font-source.ts"),
      "@mindmap/export/src/layout.js": r("../../../export/src/layout.ts"),
      "@mindmap/ui": r("../../src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
};
