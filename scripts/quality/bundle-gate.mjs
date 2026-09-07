// bundle-gate.mjs — 打包 fail-closed 门（PRC-055 契约）。
// 强制校验 G2 scope（build 动作授权与 candidate-root 边界），检测到签名配置/凭据即拒绝。
// 构建完成后盘点批准目录内的新产物，生成 inventory 与 hash。
// 用法：node bundle-gate.mjs --host tauri [--scope-from <register>] [--candidate-root <path>] -- <tauri-build-command>

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync, lstatSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAndValidateG2Scope, checkSigningHints, computeArtifactSha256 } from "./g2-scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}

const host = flag("host");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const candidateRoot = flag("candidate-root") ?? "apps/desktop/src-tauri/target/release/bundle";
const dashdash = args.indexOf("--");
const command = dashdash === -1 ? [] : args.slice(dashdash + 1);

if (!host || command.length === 0) {
  console.error(
    "usage: bundle-gate.mjs --host <tauri|electron> [--scope-from <register>] [--candidate-root <path>] -- <command...>",
  );
  process.exit(2);
}

// 1. 校验 G2 scope 与 build action 授权
let validated;
try {
  validated = loadAndValidateG2Scope({
    scopeFrom,
    host,
    action: "build",
    candidateRoot,
    repoRoot: ROOT,
  });
} catch (err) {
  console.error(`bundle-gate: BLOCKED — G2 scope 校验未通过: ${err.message}`);
  process.exit(1);
}

const { scope } = validated;

// 2. 签名与凭据检测：任何签名配置/凭据迹象直接 fail-closed
const hits = checkSigningHints(host, ROOT);
if (hits.length) {
  console.error(`bundle-gate: FAIL — 检测到签名配置/凭据迹象（${hits.join(", ")}）。`);
  console.error("签名/公证是独立授权门槛，不能由打包脚本顺带执行（MM-100/G2 规则）。");
  process.exit(1);
}

// 3. 记录构建前 candidateRoot 状态（若存在）
const candidateRootAbs = resolve(ROOT, candidateRoot);
function scanDirEntries(dir) {
  if (!existsSync(dir)) return new Set();
  const set = new Set();
  function walk(curr) {
    const entries = readdirSync(curr, { withFileTypes: true });
    for (const ent of entries) {
      const full = join(curr, ent.name);
      set.add(relative(candidateRootAbs, full));
      if (ent.isDirectory() && !ent.name.endsWith(".app")) {
        walk(full);
      }
    }
  }
  walk(dir);
  return set;
}

const preExisting = scanDirEntries(candidateRootAbs);

// 4. 执行原始构建命令
console.log(
  `bundle-gate: unsigned 候选构建放行（host=${host}, candidateRoot=${candidateRoot}, 未检测到签名凭据）`,
);

let gitHead = "unknown";
try {
  gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch {}

const r = spawnSync(command[0], command.slice(1), { cwd: ROOT, stdio: "inherit" });
if ((r.status ?? 1) !== 0) {
  console.error(`bundle-gate: 子进程退出码非零 (${r.status})`);
  process.exit(r.status ?? 1);
}

// 5. 盘点产生的新候选产物并核实范围
const currentEntries = scanDirEntries(candidateRootAbs);
const newEntries = [...currentEntries].filter((e) => !preExisting.has(e));

// 识别 bundle 顶级候选条目 (.app 目录或 .dmg 文件)
const candidateArtifacts = [];
for (const relEntry of currentEntries) {
  const full = join(candidateRootAbs, relEntry);
  const relToRepo = relative(ROOT, full);
  if (relEntry.endsWith(".app") || relEntry.endsWith(".dmg")) {
    // 必须在 G2 批准的 candidateOutputPaths 中
    const isApproved = scope.candidateOutputPaths.some(
      (cop) => cop === relToRepo || relToRepo.startsWith(cop),
    );
    if (!isApproved) {
      console.error(
        `bundle-gate: FAIL — 发现越界产物: ${relToRepo}（未在 G2 批准 candidateOutputPaths 内）`,
      );
      process.exit(1);
    }
    const sha256 = computeArtifactSha256(full);
    const sizeBytes = statSync(full).size;
    candidateArtifacts.push({
      path: relToRepo,
      sha256,
      sizeBytes,
    });
  }
}

const inventory = {
  sourceCommit: gitHead,
  runner: "bundle-gate.mjs",
  os: process.platform,
  arch: process.arch,
  command: command.join(" "),
  generatedAt: new Date().toISOString(),
  artifacts: candidateArtifacts,
};

console.log(`bundle-gate: PASS — 成功构建并盘点 ${candidateArtifacts.length} 个候选产物`);
for (const art of candidateArtifacts) {
  console.log(`  - ${art.path} (sha256: ${art.sha256.slice(0, 16)}… size: ${art.sizeBytes}B)`);
}

process.exit(0);
