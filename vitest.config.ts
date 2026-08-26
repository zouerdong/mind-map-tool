import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "tests/unit/**/*.test.ts",
      "tests/bootstrap/**/*.test.ts",
    ],
    environment: "node",
  },
});
