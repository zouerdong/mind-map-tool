import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mindmap/core": r("./packages/core/src/index.ts"),
      "@mindmap/export/src/layout.js": r("./packages/export/src/layout.ts"),
      "@mindmap/export": r("./packages/export/src/index.ts"),
      "@mindmap/ui": r("./packages/ui/src/index.ts"),
      "@mindmap/platform": r("./packages/platform/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "packages/*/test/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/bootstrap/**/*.test.ts",
      "tests/golden/**/*.test.ts",
    ],
    environment: "node",
    hookTimeout: 300_000,
    testTimeout: 300_000,
  },
});
