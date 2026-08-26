// run-export-golden.mjs — 三层导出 golden 断言（MM-040 建立夹具/golden 后生效）。
// 语义 golden：canonical SVG hash；视觉 golden：固定 renderer/font 的 PNG；
// PDF 结构/视觉：双 viewer 容差。fail-closed：golden 不存在即失败，不自动生成。

import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const GOLDEN_DIR = resolve(ROOT, "tests/golden/export");
const FIXTURE_DIR = resolve(ROOT, "tests/fixtures/export");

const args = process.argv.slice(2);
const focusIdx = args.indexOf("--focus");
const focus = focusIdx === -1 ? null : args[focusIdx + 1];

if (!existsSync(GOLDEN_DIR) || readdirSync(GOLDEN_DIR).length === 0) {
  console.error(
    "run-export-golden: FAIL — tests/golden/export/** 为空。" +
      "golden 由 MM-040 建立后本入口才允许通过；不得用本脚本自动生成或更新 golden 冒充通过。",
  );
  process.exit(1);
}
if (!existsSync(FIXTURE_DIR)) {
  console.error("run-export-golden: FAIL — tests/fixtures/export/** 缺失（MM-040 建立）。");
  process.exit(1);
}

// MM-040 起：在此实现三层断言（读 golden manifest，重建 scene/SVG/PNG/PDF，
// 比较 hash/尺寸/感知 diff/PDF 结构）。当前 fail-closed 占位由上方守卫保证。
console.log(`run-export-golden: TODO(MM-040) focus=${focus ?? "all"} — 夹具就绪前保持 fail-closed`);
process.exit(1);
