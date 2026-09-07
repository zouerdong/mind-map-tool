// run-all.mjs — 唯一质量总入口（MRT-010；MM-090 消费）。
// 支持 --focus <case-set> 稳定子集；--suite <integration|a11y|visual> 选择套件。
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
const releaseEvidenceIdx = args.indexOf("--release-evidence");
const releaseEvidence = releaseEvidenceIdx === -1 ? null : args[releaseEvidenceIdx + 1];

const STAGES = {
  format: () => run("pnpm", ["format:check"], ROOT),
  unit: () => run("pnpm", ["test:unit"], ROOT),
  typecheck: () => run("pnpm", ["typecheck"], ROOT),
  lint: () => run("pnpm", ["lint"], ROOT),
  integration: () =>
    run("pnpm", ["exec", "vitest", "run", "apps/desktop/src/app", "--root", "."], ROOT),
  a11y: () => run("pnpm", ["--filter", "./packages/ui", "run", "test:a11y"], ROOT),
  build: () => run("pnpm", ["build"], ROOT),
  cargoFmt: () =>
    run(
      "cargo",
      ["fmt", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--", "--check"],
      ROOT,
    ),
  cargoTest: () =>
    run(
      "cargo",
      ["test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--", "--test-threads=1"],
      ROOT,
    ),
  cargoClippy: () =>
    run(
      "cargo",
      [
        "clippy",
        "--manifest-path",
        "apps/desktop/src-tauri/Cargo.toml",
        "--all-targets",
        "--",
        "-D",
        "warnings",
      ],
      ROOT,
    ),
  boundaries: () =>
    run("node", [resolve(HERE, "check-boundaries.mjs"), "--scope", "selected-canvas"], ROOT),
  licenses: () =>
    run(
      "node",
      [resolve(HERE, "scan-dependency-licenses.mjs"), "--output", ".tmp/quality/license-scan.json"],
      ROOT,
    ),
  network: () => run("node", [resolve(HERE, "scan-network-endpoints.mjs")], ROOT),
  golden: () =>
    run(
      "node",
      [resolve(HERE, "run-export-golden.mjs"), ...(focus ? ["--focus", focus] : [])],
      ROOT,
    ),
  performance: () =>
    run("node", [resolve(HERE, "run-performance.mjs"), ...(focus ? ["--focus", focus] : [])], ROOT),
  assets: () =>
    run(
      "node",
      [resolve(HERE, "measure-release-assets.mjs"), "--output", ".tmp/quality/release-assets.json"],
      ROOT,
    ),
  releasePerformance: () =>
    run(
      "node",
      [
        resolve(HERE, "run-performance.mjs"),
        "--scope",
        "release",
        "--output",
        ".tmp/quality/release-performance.json",
      ],
      ROOT,
    ),
  evidence: () => {
    if (!releaseEvidence) {
      console.error(
        "\nrun-all: BLOCKED_BY_CANDIDATE_EVIDENCE — 未提供 --release-evidence <manifest-path>，不允许回退读取陈旧 manifest 假绿。",
      );
      return false;
    }
    return run(
      "node",
      [
        resolve(HERE, "verify-evidence.mjs"),
        "--manifest",
        releaseEvidence,
      ],
      ROOT,
    );
  },
  visual: () => run("node", [resolve(HERE, "run-visual-alignment.mjs")], ROOT),
};

function run(cmd, cmdArgs, cwd) {
  console.log(`\n=== ${cmd} ${cmdArgs.join(" ")} ===`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  return r.status === 0;
}

const SUITES = {
  all: [
    "format",
    "typecheck",
    "lint",
    "unit",
    "integration",
    "a11y",
    "build",
    "cargoFmt",
    "cargoTest",
    "cargoClippy",
    "boundaries",
    "licenses",
    "network",
    "golden",
    "performance",
    "assets",
    "releasePerformance",
    "visual",
    "evidence",
  ],
  integration: ["integration", "boundaries"],
  a11y: ["a11y"],
  visual: ["visual"],
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
