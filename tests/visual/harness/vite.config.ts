// tests/visual/harness/vite.config.ts — VRA-080 视觉测试宿主 Vite 配置
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default {
  resolve: {
    alias: [
      { find: "@mindmap/core", replacement: r("../../../packages/core/src/index.ts") },
      {
        find: "@mindmap/export/src/font-source.js",
        replacement: r("../../../packages/export/src/font-source.ts"),
      },
      {
        find: "@mindmap/export/src/layout.js",
        replacement: r("../../../packages/export/src/layout.ts"),
      },
      {
        find: "@mindmap/export/src/visual-style.js",
        replacement: r("../../../packages/export/src/visual-style.ts"),
      },
      {
        find: "@mindmap/export/src/edge-geometry.js",
        replacement: r("../../../packages/export/src/edge-geometry.ts"),
      },
      { find: /^@mindmap\/export$/, replacement: r("../../../packages/export/src/index.ts") },
      { find: "@mindmap/ui", replacement: r("../../../packages/ui/src/index.ts") },
      { find: /^react$/, replacement: r("../../../packages/ui/node_modules/react") },
      {
        find: "react/jsx-runtime",
        replacement: r("../../../packages/ui/node_modules/react/jsx-runtime"),
      },
      { find: /^react-dom$/, replacement: r("../../../packages/ui/node_modules/react-dom") },
      {
        find: "react-dom/client",
        replacement: r("../../../packages/ui/node_modules/react-dom/client"),
      },
      { find: "@xyflow/react", replacement: r("../../../packages/ui/node_modules/@xyflow/react") },
    ],
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
};
