// verify-evidence.mjs — MRT-010/MM-110/PRC-010 证据完整性门。
// 校验一份已经生成的运行记录，不替测试或平台人工报告造数据。
// 要求：case id、当前 HEAD、clean worktree、环境平台/架构、命令退出码、
// artifact 路径和发布范围（releaseScope）都可复算；任一缺失返回非零。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);

const manifestIdx = args.indexOf("--manifest");
const releaseEvidenceIdx = args.indexOf("--release-evidence");
let manifestRel = null;
if (manifestIdx !== -1) {
  manifestRel = args[manifestIdx + 1];
} else if (releaseEvidenceIdx !== -1) {
  manifestRel = args[releaseEvidenceIdx + 1];
}

const errors = [];
const fail = (message) => errors.push(message);

if (!manifestRel) {
  console.error(
    "verify-evidence: BLOCKED_BY_CANDIDATE_EVIDENCE — 未指定证据清单（使用 --manifest 或 --release-evidence <path>）",
  );
  process.exit(1);
}

const manifestPath = resolve(ROOT, manifestRel);

if (!existsSync(manifestPath)) {
  console.error(`verify-evidence: BLOCKED — 证据清单不存在：${manifestRel}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  console.error(`verify-evidence: FAIL — 证据清单不是合法 JSON：${error}`);
  process.exit(1);
}

const required = [
  "schemaVersion",
  "caseId",
  "task",
  "source",
  "environment",
  "commands",
  "platformReports",
  "overall",
];
for (const key of required) if (!(key in manifest)) fail(`缺少顶层字段 ${key}`);
if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2)
  fail(`schemaVersion 必须为 1 或 2（实际 ${manifest.schemaVersion}）`);
if (typeof manifest.caseId !== "string" || manifest.caseId.length < 3) fail("caseId 缺失或无效");
if (typeof manifest.task !== "string" || manifest.task.length === 0) fail("task 缺失或无效");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

let head = null;
let status = null;
try {
  head = git(["rev-parse", "HEAD"]);
  status = git(["status", "--porcelain"]);
} catch (error) {
  fail(`无法读取 Git source：${error}`);
}

const source = manifest.source ?? {};
if (typeof source.commit !== "string" || source.commit.length === 0) fail("source.commit 缺失");
else if (head && source.commit !== head)
  fail(
    `source.commit 不是当前 HEAD（记录 ${source.commit.slice(0, 12)}…，实际 ${head.slice(0, 12)}…）`,
  );
if (source.worktree !== "clean")
  fail(`source.worktree 必须为 clean（实际 ${source.worktree ?? "missing"}）`);
if (status && source.worktree === "clean" && status.length > 0)
  fail("Git worktree 实际仍有未提交改动");

const environment = manifest.environment ?? {};
for (const key of ["platform", "arch", "os", "node", "buildType"]) {
  if (typeof environment[key] !== "string" || environment[key].length === 0)
    fail(`environment.${key} 缺失`);
}

function artifactExists(reference, label) {
  if (typeof reference !== "string" || reference.length === 0) {
    fail(`${label}.artifact 缺失`);
    return;
  }
  const rel = reference.split("#", 1)[0];
  if (!existsSync(resolve(ROOT, rel))) fail(`${label}.artifact 不存在：${reference}`);
}

if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
  fail("commands 必须为非空数组");
} else {
  const ids = new Set();
  for (const [index, command] of manifest.commands.entries()) {
    const label = `commands[${index}]`;
    if (typeof command.id !== "string" || command.id.length === 0) fail(`${label}.id 缺失`);
    else if (ids.has(command.id)) fail(`${label}.id 重复：${command.id}`);
    else ids.add(command.id);
    if (typeof command.command !== "string" || command.command.length === 0)
      fail(`${label}.command 缺失`);
    if (!Number.isInteger(command.exitCode)) fail(`${label}.exitCode 必须是整数`);
    else if (command.exitCode !== 0) fail(`${label} 退出码为 ${command.exitCode}`);
    artifactExists(command.artifact, label);
  }
}

const reports = manifest.platformReports ?? {};
const KNOWN_PLATFORMS = new Set(["macos", "windows"]);

if (manifest.releaseScope) {
  const scope = manifest.releaseScope;
  if (typeof scope.productVersion !== "string" || scope.productVersion.length === 0) {
    fail("releaseScope.productVersion 缺失或为空");
  }

  if (!Array.isArray(scope.requiredPlatforms) || scope.requiredPlatforms.length === 0) {
    fail("releaseScope.requiredPlatforms 必须为非空数组");
  }

  const requiredSet = new Set();
  if (Array.isArray(scope.requiredPlatforms)) {
    for (const p of scope.requiredPlatforms) {
      if (!KNOWN_PLATFORMS.has(p)) fail(`releaseScope.requiredPlatforms 包含未知平台: ${p}`);
      if (requiredSet.has(p)) fail(`releaseScope.requiredPlatforms 包含重复平台: ${p}`);
      requiredSet.add(p);
    }
  }

  const deferredSet = new Set();
  if (scope.deferredPlatforms) {
    if (!Array.isArray(scope.deferredPlatforms)) {
      fail("releaseScope.deferredPlatforms 必须为数组");
    } else {
      for (const [idx, item] of scope.deferredPlatforms.entries()) {
        const dLabel = `releaseScope.deferredPlatforms[${idx}]`;
        if (typeof item !== "object" || item === null) {
          fail(`${dLabel} 必须为对象`);
          continue;
        }
        if (!KNOWN_PLATFORMS.has(item.platform)) fail(`${dLabel}.platform 未知: ${item.platform}`);
        if (deferredSet.has(item.platform))
          fail(`${dLabel}.platform 重复: ${item.platform}`);
        deferredSet.add(item.platform);

        if (typeof item.reason !== "string" || item.reason.length === 0) {
          fail(`${dLabel}.reason 缺失或为空`);
        }
        if (typeof item.decisionRef !== "string" || item.decisionRef.length === 0) {
          fail(`${dLabel}.decisionRef 缺失或为空`);
        }
      }
    }
  }

  // 校验 required 和 deferred 不能重叠
  for (const p of requiredSet) {
    if (deferredSet.has(p)) {
      fail(`平台 ${p} 不能同时出现在 requiredPlatforms 和 deferredPlatforms 中`);
    }
  }

  // 校验 requiredPlatforms 必须为 verified
  for (const platform of requiredSet) {
    const report = reports[platform];
    const label = `platformReports.${platform}`;
    if (!report) {
      fail(`${label} 缺失（required 平台必填）`);
      continue;
    }
    for (const key of ["platform", "arch", "os", "command"]) {
      if (typeof report[key] !== "string" || report[key].length === 0) fail(`${label}.${key} 缺失`);
    }
    if (report.status !== "verified") {
      fail(`${label} 必须为 verified（当前 ${report.status ?? "missing"}）`);
    }
    if (!Number.isInteger(report.exitCode) || report.exitCode !== 0) {
      fail(`${label}.exitCode 必须为 0（当前 ${report.exitCode}）`);
    }
    artifactExists(report.artifact, label);
  }

  // 校验 deferredPlatforms
  for (const platform of deferredSet) {
    const report = reports[platform];
    if (report) {
      const label = `platformReports.${platform}`;
      if (report.status === "verified") {
        if (!Number.isInteger(report.exitCode) || report.exitCode !== 0) {
          fail(`${label}.exitCode 必须为 0`);
        }
        artifactExists(report.artifact, label);
      } else if (report.status === "deferred" || report.status === "not-run") {
        if (typeof report.reason !== "string" || report.reason.length === 0) {
          fail(`${label} (deferred/not-run) 必须说明 reason`);
        }
      } else {
        fail(`${label} deferred 平台状态必须为 deferred、not-run 或 verified（实际 ${report.status}）`);
      }
    }
  }

  // 校验平台报告中没有未知或未在 scope 中声明的平台
  for (const platform of Object.keys(reports)) {
    if (!requiredSet.has(platform) && !deferredSet.has(platform)) {
      fail(`platformReports 包含未在 releaseScope 中声明的平台: ${platform}`);
    }
  }
} else {
  // 历史 schemaVersion 1 降级支持：要求双平台 verified
  for (const platform of ["macos", "windows"]) {
    const report = reports[platform];
    const label = `platformReports.${platform}`;
    if (!report) {
      fail(`${label} 缺失`);
      continue;
    }
    for (const key of ["platform", "arch", "os", "command"]) {
      if (typeof report[key] !== "string" || report[key].length === 0) fail(`${label}.${key} 缺失`);
    }
    if (!Number.isInteger(report.exitCode) && report.status === "verified")
      fail(`${label}.exitCode 缺失`);
    if (report.status !== "verified") {
      if (typeof report.reason !== "string" || report.reason.length === 0)
        fail(`${label} 非 verified 时必须说明 reason`);
      fail(`${label} 尚未 verified（${report.status ?? "missing"}）`);
    }
    artifactExists(report.artifact, label);
  }
}

if (manifest.overall !== "READY")
  fail(`overall 必须为 READY（实际 ${manifest.overall ?? "missing"}）`);

if (errors.length) {
  console.error(`verify-evidence: BLOCKED/FAIL (${errors.length})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`verify-evidence: PASS (${manifest.caseId})`);
