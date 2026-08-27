// run-all.mjs — 质量总入口（MM-090 消费；MM-020 建立骨架）。
// 支持 --focus <case-set> 稳定子集；--suite <integration|a11y> 选择套件。
// fail-closed：阶段未到/证据缺失即非零退出，不产假绿。

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const args = process.argv.slice(2);
const suiteIdx = args.indexOf("--suite");
const suite = suiteIdx === -1 ? "all" : args[suiteIdx + 1];
const focusIdx = args.indexOf("--focus");
const focus = focusIdx === -1 ? null : args[focusIdx + 1];

const STAGES = {
  unit: () => run("pnpm", ["test:unit"], ROOT),
  typecheck: () => run("pnpm", ["typecheck"], ROOT),
  lint: () => run("pnpm", ["lint"], ROOT),
  boundaries: () =>
    run("node", [resolve(HERE, "check-boundaries.mjs"), "--scope", "selected-canvas"], ROOT),
  licenses: () => run("node", [resolve(HERE, "scan-dependency-licenses.mjs")], ROOT),
  network: () => run("node", [resolve(HERE, "scan-network-endpoints.mjs")], ROOT),
  golden: () =>
    run(
      "node",
      [resolve(HERE, "run-export-golden.mjs"), ...(focus ? ["--focus", focus] : [])],
      ROOT,
    ),
  performance: () =>
    run("node", [resolve(HERE, "run-performance.mjs"), ...(focus ? ["--focus", focus] : [])], ROOT),
};

function run(cmd, cmdArgs, cwd) {
  console.log(`\n=== ${cmd} ${cmdArgs.join(" ")} ===`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  return r.status === 0;
}

STAGES.a11y = () =>
  run("pnpm", ["--filter", "./packages/ui", "run", "test:a11y"], ROOT); // MM-070 落地：axe-core（jsdom）

const SUITES = {
  all: ["typecheck", "lint", "unit", "boundaries", "licenses", "network", "golden", "performance"],
  integration: ["unit", "boundaries"], // 集成测试在 MM-090 扩展
  a11y: ["a11y"],
};

const plan = SUITES[suite] ?? SUITES.all;
const results = {};
for (const stage of plan) {
  results[stage] = STAGES[stage]();
}

const failed = Object.entries(results).filter(([, ok]) => !ok);
console.log(`\n=== run-all [suite=${suite}] summary ===`);
for (const [stage, ok] of Object.entries(results))
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${stage}`);

if (failed.length) {
  console.error(`run-all: FAIL (${failed.map(([s]) => s).join(", ")})`);
  process.exit(1);
}
console.log("run-all: PASS");
