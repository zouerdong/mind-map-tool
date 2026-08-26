// install-gate.mjs — 本地安装/卸载验证门（MM-100 消费）。
// --scope-from docs/decisions/decision-register.json 必填；G2 未批准精确
// 安装/删除边界时 fail-closed。

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const hostIdx = args.indexOf("--host");
const host = hostIdx === -1 ? null : args[hostIdx + 1];
const scopeIdx = args.indexOf("--scope-from");
const scopeFrom = scopeIdx === -1 ? null : args[scopeIdx + 1];

if (!host || !scopeFrom) {
  console.error(
    "usage: install-gate.mjs --host <tauri|electron> --scope-from <decision-register.json> [--unsigned]",
  );
  process.exit(2);
}

const regPath = resolve(ROOT, scopeFrom);
if (!existsSync(regPath)) {
  console.error(`install-gate: FAIL — register 缺失 ${scopeFrom}`);
  process.exit(1);
}
const register = JSON.parse(await readFile(regPath, "utf8"));
const g2 = register.gates?.G2;

if (g2?.status !== "approved") {
  console.error(
    "install-gate: BLOCKED — G2 未批准。安装/卸载目标与删除边界必须由项目负责人精确批准后写入 G2.approvedScope。",
  );
  process.exit(1);
}
const scope = g2.approvedScope ?? {};
if (scope.selectedHost !== host) {
  console.error(`install-gate: BLOCKED — G2 批准 host=${scope.selectedHost}，请求 host=${host}`);
  process.exit(1);
}
for (const key of [
  "candidateOutputPaths",
  "installationTargets",
  "allowedActions",
  "deletionBoundaries",
]) {
  if (!Array.isArray(scope[key]) || scope[key].length === 0) {
    console.error(`install-gate: BLOCKED — G2.approvedScope.${key} 为空（必须精确列出）`);
    process.exit(1);
  }
}

// G2 批准后：在此执行 scope.allowedActions 限定的本地安装/卸载与验证。
console.error(
  "install-gate: G2 已批准——安装动作本体由 MM-100 按批准清单执行（尚未实现到该阶段）。",
);
process.exit(1);
