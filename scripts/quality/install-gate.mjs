// install-gate.mjs — 本地安装/卸载验证门（PRC-055 契约）。
// 消费 G2 approvedScope，执行安装/卸载验证。
// --plan（默认）模式零文件系统变更，仅输出规范化计划；
// --execute 模式在 deletionBoundaries 内执行沙箱安装、身份探针与干净卸载。
// 用法：
//   node install-gate.mjs --host tauri --scope-from <register> --candidate <path> --evidence-dir <path> [--plan|--execute]

import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  cpSync,
  mkdirSync,
  lstatSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAndValidateG2Scope,
  checkSigningHints,
  computeFileSha256,
  computeArtifactSha256,
  isSameOrDescendant,
} from "./g2-scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(HERE, "../..");

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}

const host = flag("host");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const candidate = flag("candidate");
const evidenceDir = flag("evidence-dir");
const isExecute = args.includes("--execute");
const isPlan = args.includes("--plan") || !isExecute;

if (!host || !scopeFrom || !candidate || !evidenceDir) {
  console.error(
    "usage: install-gate.mjs --host <tauri|electron> --scope-from <register> --candidate <path> --evidence-dir <path> [--plan|--execute]",
  );
  process.exit(2);
}

// 1. 签名提示检查（fail-closed）
const hits = checkSigningHints(host, ROOT);
if (hits.length) {
  console.error(`install-gate: FAIL — 检测到签名配置/凭据迹象（${hits.join(", ")}）`);
  process.exit(1);
}

// 2. G2 Scope 校验
let validated;
try {
  validated = loadAndValidateG2Scope({
    scopeFrom,
    host,
    action: "install",
    candidate,
    evidenceDir,
    repoRoot: ROOT,
  });
} catch (err) {
  console.error(`install-gate: BLOCKED — G2 scope 校验未通过: ${err.message}`);
  process.exit(1);
}

const { scope } = validated;

// 同时校验 uninstall 动作是否授权
if (!scope.allowedActions.includes("uninstall")) {
  console.error("install-gate: BLOCKED — G2.approvedScope.allowedActions 必须包含 'uninstall'");
  process.exit(1);
}

// 候选安装目标：取 scope.installationTargets 中首个匹配项
const targetRel = scope.installationTargets[0];
const targetAbs = resolve(ROOT, targetRel);

// 校验 target 是否在 deletionBoundaries 内
const isWithinDeletionBoundary = scope.deletionBoundaries.some((db) => {
  const dbAbs = resolve(ROOT, db);
  return isSameOrDescendant(dbAbs, targetAbs);
});

if (!isWithinDeletionBoundary) {
  console.error(
    `install-gate: FAIL — 安装目标 ${targetRel} 不在 deletionBoundaries 范围内，拒绝执行`,
  );
  process.exit(1);
}

const candidateAbs = resolve(ROOT, candidate);
let candidateSha256 = "(pending build)";
if (existsSync(candidateAbs)) {
  if (lstatSync(candidateAbs).isSymbolicLink()) {
    console.error(`install-gate: FAIL — 候选产物不能是符号链接: ${candidate}`);
    process.exit(1);
  }
  candidateSha256 = computeArtifactSha256(candidateAbs);
} else if (!isPlan) {
  console.error(`install-gate: FAIL — 候选产物不存在: ${candidate}`);
  process.exit(1);
}

// 3. Plan 模式：零文件系统变更
if (isPlan) {
  const plan = {
    mode: "plan",
    host,
    scopeFrom,
    candidate: candidate,
    candidateSha256,
    target: targetRel,
    operations: [
      {
        step: 1,
        name: "verify-candidate-integrity",
        path: candidate,
        sha256: candidateSha256,
      },
      {
        step: 2,
        name: "check-preexisting-target",
        path: targetRel,
        behavior: "refuse-alien-preexisting",
      },
      {
        step: 3,
        name: "sandboxed-install",
        source: candidate,
        destination: targetRel,
        boundary: scope.deletionBoundaries,
      },
      {
        step: 4,
        name: "probe-installed-identity",
        path: targetRel,
        expectedBundleId: scope.bundleIdentifier,
        expectedVersion: scope.version,
      },
      {
        step: 5,
        name: "verified-uninstall",
        target: targetRel,
        condition: "matches-installed-receipt-and-sha256",
      },
    ],
  };

  console.log("install-gate: PLAN SUCCESS — 计划输出（零文件系统变更）:");
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

// 4. Execute 模式：严格沙箱安装、校验与卸载
console.log(`install-gate: EXECUTE 模式开始（target=${targetRel}）...`);

// 检查是否存在预存但未受控的文件
const targetParent = dirname(targetAbs);
const receiptPath = join(targetParent, ".install-receipt.json");

if (existsSync(targetAbs)) {
  let isAlien = true;
  if (existsSync(receiptPath)) {
    try {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      const existingTargetSha256 = computeArtifactSha256(targetAbs);
      if (
        receipt.candidateSha256 === candidateSha256 &&
        existingTargetSha256 === candidateSha256 &&
        receipt.target === targetRel
      ) {
        isAlien = false;
      }
    } catch {}
  }
  if (isAlien) {
    console.error(
      `install-gate: FAIL — 目标位置已存在预存应用且不属于本 candidate: ${targetRel}，拒绝覆盖或清理`,
    );
    process.exit(1);
  }
}

// 确保父目录存在
mkdirSync(targetParent, { recursive: true });

// 复制应用到目标
console.log(`install-gate: 复制候选到沙箱目标 -> ${targetRel}`);
const installStartedAt = new Date().toISOString();
cpSync(candidateAbs, targetAbs, { recursive: true });

const receipt = {
  candidate,
  candidateSha256,
  target: targetRel,
  installedAt: new Date().toISOString(),
  expectedBundleId: scope.bundleIdentifier,
  expectedVersion: scope.version,
};
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

function plistString(plistText, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = plistText.match(
    new RegExp(`<key>\\s*${escapedKey}\\s*</key>\\s*<string>([^<]*)</string>`),
  );
  return match?.[1]?.trim() ?? null;
}

// 身份探针：核实 bundle ID、版本与结构
console.log("install-gate: 执行安装身份探针...");
const plistPath = join(targetAbs, "Contents/Info.plist");
if (!existsSync(plistPath)) {
  console.error("install-gate: FAIL — 安装目标缺少 Contents/Info.plist，停止清理并保留现场");
  process.exit(1);
}
const plistText = readFileSync(plistPath, "utf8");
const installedBundleId = plistString(plistText, "CFBundleIdentifier");
const installedVersion =
  plistString(plistText, "CFBundleShortVersionString") ?? plistString(plistText, "CFBundleVersion");
if (installedBundleId !== scope.bundleIdentifier) {
  console.error(
    `install-gate: FAIL — bundle identifier 不匹配（expected=${scope.bundleIdentifier}, actual=${installedBundleId ?? "missing"}），停止清理并保留现场`,
  );
  process.exit(1);
}
if (installedVersion !== scope.version) {
  console.error(
    `install-gate: FAIL — bundle version 不匹配（expected=${scope.version}, actual=${installedVersion ?? "missing"}），停止清理并保留现场`,
  );
  process.exit(1);
}

// 卸载与清理：只移除本次 execution 创建且 hash/identity 相符的目标
console.log("install-gate: 执行核验卸载...");
const installedSha256 = computeArtifactSha256(targetAbs);
if (installedSha256 !== candidateSha256) {
  console.error(
    `install-gate: FAIL — 安装产物哈希 (${installedSha256}) 与候选 (${candidateSha256}) 不符，停止清理以保留现场`,
  );
  process.exit(1);
}

rmSync(targetAbs, { recursive: true, force: true });
rmSync(receiptPath, { force: true });

if (existsSync(targetAbs)) {
  console.error(`install-gate: FAIL — 卸载后目标依然存在: ${targetRel}`);
  process.exit(1);
}

// 写入证据
const evidenceDirAbs = resolve(ROOT, evidenceDir);
mkdirSync(evidenceDirAbs, { recursive: true });
const evidenceOutPath = join(evidenceDirAbs, "install-gate-evidence.json");

const evidence = {
  schemaVersion: 2,
  task: "PRC-055",
  status: "PASS",
  mode: "execute",
  host,
  candidate,
  candidateSha256,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  runnerSha256: computeFileSha256(RUNNER_PATH),
  os: process.platform,
  arch: process.arch,
  command: [process.execPath, ...process.argv.slice(1)].join(" "),
  target: targetRel,
  installedBundleId,
  installedVersion,
  installedAndUninstalled: true,
  executedAt: new Date().toISOString(),
  startedAt: installStartedAt,
  finishedAt: new Date().toISOString(),
};
writeFileSync(evidenceOutPath, JSON.stringify(evidence, null, 2) + "\n");
console.log(`install-gate: PASS — 安装与干净卸载验证完成，证据写入 ${evidenceOutPath}`);
process.exit(0);
