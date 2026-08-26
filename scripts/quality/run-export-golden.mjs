// run-export-golden.mjs — 三层导出 golden 入口（MM-040 起生效）。
// 实际断言在 tests/golden/export/export-golden.test.ts（vitest）：
//   语义 golden（SVG hash）/ 视觉 golden（2x PNG hash + 尺寸）/ PDF golden。
// 更新 golden 必须显式 REGEN=1，且在变更报告中说明原因——不得作为常规通过手段。

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const args = process.argv.slice(2);
const focusIdx = args.indexOf("--focus");
const focus = focusIdx === -1 ? null : args[focusIdx + 1];
void focus; // 子集过滤由 vitest -t 提供；当前全量运行

const r = spawnSync("npx", ["vitest", "run", "tests/golden/export", "--root", "."], {
  cwd: ROOT,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
