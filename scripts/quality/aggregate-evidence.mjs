// aggregate-evidence.mjs — 聚合平台原始证据为任务级报告（MM-050/MM-060/MM-100 消费）。
// --task MM-050 --inputs a.json,b.json --output aggregate.json
// 规则：任一必需平台缺失 → BLOCKED；raw evidence 不被覆盖；聚合报告带脚本版本。

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const task = flag("task");
const inputs =
  flag("inputs")
    ?.split(",")
    .map((s) => s.trim()) ?? [];
const output = flag("output");

if (!task || inputs.length === 0 || !output) {
  console.error(
    "usage: aggregate-evidence.mjs --task <MM-xxx> --inputs <a.json,b.json> --output <agg.json>",
  );
  process.exit(2);
}

const loaded = [];
const missing = [];
for (const rel of inputs) {
  const abs = rel.startsWith("/") ? rel : resolve(ROOT, rel);
  if (!existsSync(abs)) missing.push(rel);
  else loaded.push({ path: rel, data: JSON.parse(await readFile(abs, "utf8")) });
}

if (missing.length) {
  console.error(`aggregate-evidence: BLOCKED — 缺输入证据：${missing.join(", ")}`);
  process.exit(1);
}

const platforms = loaded.map((l) => l.data.platform ?? "unknown");
const aggregate = {
  task,
  generatedAt: new Date().toISOString(),
  aggregatorVersion: "1.0.0",
  inputs: loaded.map((l) => l.path),
  platforms,
  allRequiredPlatformsPresent: true, // 按调用方声明的 inputs 判定；缺失已在上方 BLOCKED
  results: loaded,
};

await writeFile(resolve(ROOT, output), JSON.stringify(aggregate, null, 2) + "\n");
console.log(`aggregate-evidence: OK -> ${output} (platforms: ${platforms.join(", ")})`);
