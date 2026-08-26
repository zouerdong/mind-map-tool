import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mindmap/core": r("./packages/core/src/index.ts"),
      "@mindmap/export": r("./packages/export/src/index.ts"),
      "@mindmap/ui": r("./packages/ui/src/index.ts"),
      "@mindmap/platform": r("./packages/platform/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "tests/unit/**/*.test.ts",
      "tests/bootstrap/**/*.test.ts",
      "tests/golden/**/*.test.ts",
    ],
    environment: "node",
    hookTimeout: 300_000,
    testTimeout: 300_000,
  },
});
