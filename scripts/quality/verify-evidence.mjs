// verify-evidence.mjs — MRT-010/MM-110/PRC-010 证据完整性门。
// 校验一份已经生成的运行记录，不替测试或平台人工报告造数据。
// 要求：case id、当前 HEAD、clean worktree、环境平台/架构、命令退出码、
// artifact 路径和发布范围（releaseScope）都可复算；任一缺失返回非零。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, lstatSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeFileSha256,
  computeArtifactSha256,
  validateSafePath,
  loadAndValidateG2Scope,
} from "./g2-scope.mjs";
import { RELEASE_BUDGETS } from "./release-budgets.mjs";

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

let manifestPath;
try {
  manifestPath = resolve(ROOT, validateSafePath(manifestRel, ROOT, "manifest"));
} catch (error) {
  console.error(`verify-evidence: BLOCKED — 证据清单路径无效：${error.message}`);
  process.exit(1);
}

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
  "generatedAt",
  "source",
  "environment",
  "commands",
  "platformReports",
  "overall",
];
for (const key of required) if (!(key in manifest)) fail(`缺少顶层字段 ${key}`);
// PRR-000 readiness schema v3：v1/v2 是 PRC 批次的历史形态，只可审计，不能获得发布 PASS。
if (manifest.schemaVersion !== 3)
  fail(`schemaVersion 必须为 3（实际 ${manifest.schemaVersion}）；v1/v2 历史 manifest 只可审计`);
if (typeof manifest.caseId !== "string" || manifest.caseId.length < 3) fail("caseId 缺失或无效");
if (typeof manifest.task !== "string" || manifest.task.length === 0) fail("task 缺失或无效");

const manifestTime = Date.parse(manifest.generatedAt);
if (!Number.isFinite(manifestTime)) fail("generatedAt 缺失或不是合法 ISO 时间");

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
    return null;
  }
  const rel = reference.split("#", 1)[0];
  let safeRel;
  try {
    safeRel = validateSafePath(rel, ROOT, `${label}.artifact`);
  } catch (error) {
    fail(error.message);
    return null;
  }
  const absolute = resolve(ROOT, safeRel);
  if (!existsSync(absolute)) {
    fail(`${label}.artifact 不存在：${reference}`);
    return null;
  }
  return absolute;
}

function readJsonArtifact(absolute, label) {
  if (!absolute?.endsWith(".json")) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`${label}.artifact JSON 解析失败：${error.message}`);
    return null;
  }
}

function validateEvidenceTimestamp(evidence, label, required = false) {
  if (!evidence) return;
  const timestamp = evidence?.generatedAt ?? evidence?.executedAt;
  if (timestamp === undefined) {
    if (required) fail(`${label}.artifact 缺少 generatedAt/executedAt`);
    return;
  }
  const evidenceTime = Date.parse(timestamp);
  if (!Number.isFinite(evidenceTime)) {
    fail(`${label}.artifact 时间戳无效`);
  } else if (Number.isFinite(manifestTime) && evidenceTime > manifestTime) {
    fail(`${label}.artifact 晚于 manifest.generatedAt，manifest 不能证明尚未生成的证据`);
  }
}

// PRR-000 schema v3：commands[] 必须携带独立起止时间，且结束时间不得晚于 manifest 生成时间。
function validateCommandWindow(command, label) {
  const startedAt = Date.parse(command.startedAt);
  const finishedAt = Date.parse(command.finishedAt);
  if (!Number.isFinite(startedAt)) fail(`${label}.startedAt 缺失或不是合法 ISO 时间`);
  if (!Number.isFinite(finishedAt)) fail(`${label}.finishedAt 缺失或不是合法 ISO 时间`);
  if (Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt < startedAt)
    fail(`${label}.finishedAt 早于 startedAt`);
  if (Number.isFinite(finishedAt) && Number.isFinite(manifestTime) && finishedAt > manifestTime)
    fail(`${label}.finishedAt 晚于 manifest.generatedAt，manifest 不能证明尚未完成的命令`);
}

// PRR-000 schema v3：发布 runner 的 JSON 证据必须内嵌自身执行窗口，接受独立时间拓扑复算。
function validateRunnerWindow(artifact, label) {
  if (!artifact) return;
  const startedAt = Date.parse(artifact.startedAt);
  const finishedAt = Date.parse(artifact.finishedAt);
  if (!Number.isFinite(startedAt)) fail(`${label}.artifact 缺少 runner startedAt`);
  if (!Number.isFinite(finishedAt)) fail(`${label}.artifact 缺少 runner finishedAt`);
  if (Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt < startedAt)
    fail(`${label}.artifact runner finishedAt 早于 startedAt`);
  if (Number.isFinite(finishedAt) && Number.isFinite(manifestTime) && finishedAt > manifestTime)
    fail(`${label}.artifact runner finishedAt 晚于 manifest.generatedAt`);
}

function latestMtimeMs(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let latest = st.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    latest = Math.max(latest, latestMtimeMs(join(path, entry.name)));
  }
  return latest;
}

function validateArtifactIntegrity(path, recordedSha256, label, hashField = "artifactSha256") {
  if (!path) return;
  if (!/^[a-f0-9]{64}$/i.test(recordedSha256 ?? "")) {
    fail(`${label}.${hashField} 缺失或无效`);
  } else {
    try {
      const actual = computeArtifactSha256(path);
      if (actual !== recordedSha256) fail(`${label}.${hashField} 与当前 artifact 不一致`);
    } catch (error) {
      fail(`${label}.artifact 无法计算 SHA-256：${error.message}`);
    }
  }
}

function validatePositiveSamples(values, minimum, label) {
  if (!Array.isArray(values) || values.length < minimum) {
    fail(`${label} 少于 ${minimum} 个`);
    return false;
  }
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    fail(`${label} 包含非有限、零或负数样本`);
    return false;
  }
  return true;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function sameMetric(actual, expected) {
  return (
    Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 0.001
  );
}

const commandIds = new Set();
if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
  fail("commands 必须为非空数组");
} else {
  for (const [index, command] of manifest.commands.entries()) {
    const label = `commands[${index}]`;
    if (typeof command.id !== "string" || command.id.length === 0) fail(`${label}.id 缺失`);
    else if (commandIds.has(command.id)) fail(`${label}.id 重复：${command.id}`);
    else commandIds.add(command.id);
    if (typeof command.command !== "string" || command.command.length === 0)
      fail(`${label}.command 缺失`);
    if (!Number.isInteger(command.exitCode)) fail(`${label}.exitCode 必须是整数`);
    else if (command.exitCode !== 0) fail(`${label} 退出码为 ${command.exitCode}`);
    validateCommandWindow(command, label);
    const artifactPath = artifactExists(command.artifact, label);
    const artifact = readJsonArtifact(artifactPath, label);
    const releaseRunner = ["cmd-bundle", "cmd-install-gate", "cmd-release-performance"].includes(
      command.id,
    );
    validateEvidenceTimestamp(artifact, label, releaseRunner);
    if (releaseRunner) validateRunnerWindow(artifact, label);
    // schema v3：manifest 必须为每个 command artifact 记录并绑定 SHA-256，不区分 runner 与普通命令。
    validateArtifactIntegrity(artifactPath, command.artifactSha256, label);

    if (releaseRunner && !artifact) {
      fail(`${label}.artifact 必须是对应 runner 生成的 JSON 证据，不能直接指向二进制`);
    }

    if (command.id === "cmd-bundle" && artifact) {
      if (artifact.sourceCommit !== source.commit)
        fail(`${label}.artifact sourceCommit 与 manifest 不一致`);
      if (artifact.sourceWorktree !== "clean")
        fail(`${label}.artifact sourceWorktree 必须为 clean`);
      const expectedRunnerHash = computeFileSha256(resolve(HERE, "bundle-gate.mjs"));
      if (artifact.runnerSha256 !== expectedRunnerHash)
        fail(`${label}.artifact runnerSha256 与当前 source runner 不一致`);
      const inventory = Array.isArray(artifact.artifacts) ? artifact.artifacts : [];
      const app = inventory.find((item) => item.path === manifest.candidate?.path);
      const dmg = inventory.find((item) => item.path === manifest.candidate?.installerDmg);
      if (app?.sha256 !== manifest.candidate?.sha256)
        fail(`${label}.artifact 未绑定 manifest candidate app/hash`);
      if (dmg?.sha256 !== manifest.candidate?.dmgSha256)
        fail(`${label}.artifact 未绑定 manifest candidate dmg/hash`);
    }

    if (command.id === "cmd-install-gate" && artifact) {
      if (artifact.status !== "PASS" || artifact.mode !== "execute")
        fail(`${label}.artifact 不是成功的 install execute 证据`);
      if (artifact.sourceCommit !== source.commit)
        fail(`${label}.artifact sourceCommit 与 manifest 不一致`);
      if (artifact.candidate !== manifest.candidate?.path)
        fail(`${label}.artifact candidate 与 manifest 不一致`);
      if (artifact.candidateSha256 !== manifest.candidate?.sha256)
        fail(`${label}.artifact candidateSha256 与 manifest 不一致`);
      const expectedRunnerHash = computeFileSha256(resolve(HERE, "install-gate.mjs"));
      if (artifact.runnerSha256 !== expectedRunnerHash)
        fail(`${label}.artifact runnerSha256 与当前 source runner 不一致`);
    }

    if (command.id === "cmd-release-performance" && artifact) {
      if (artifact.overall !== "PASS")
        fail(`${label}.artifact release performance 必须为 PASS（实际 ${artifact.overall}）`);
      if (artifact.measurementMode !== "release")
        fail(
          `${label}.artifact measurementMode 必须为 release（diagnostic-preflight 不能作为发布证据）`,
        );
      if (artifact.sourceCommit !== source.commit)
        fail(`${label}.artifact sourceCommit 与 manifest 不一致`);
      if (artifact.candidate !== manifest.candidate?.path)
        fail(`${label}.artifact candidate 与 manifest 不一致`);
      if (artifact.candidateSha256 !== manifest.candidate?.sha256)
        fail(`${label}.artifact candidateSha256 与 manifest 不一致`);
      const expectedRunnerHash = computeFileSha256(resolve(HERE, "run-performance.mjs"));
      if (artifact.runnerSha256 !== expectedRunnerHash)
        fail(`${label}.artifact runnerSha256 与当前 source runner 不一致`);
      for (const metric of [
        "coldStartP95Ms",
        "warmStartP95Ms",
        "rssStableMb",
        "canvasFrameP95Ms",
        "editCommandP95Ms",
        "saveP95Ms",
        "pngExportP95Ms",
        "installerBytes",
      ]) {
        if (!Number.isFinite(artifact.results?.[metric]))
          fail(`${label}.artifact results.${metric} 缺失或不是有效数值`);
      }
      for (const [resultKey, acceptedBudget] of Object.entries(RELEASE_BUDGETS)) {
        const result = artifact.results?.[resultKey];
        const recordedBudget = artifact.budgets?.[resultKey];
        if (recordedBudget !== acceptedBudget)
          fail(
            `${label}.artifact budgets.${resultKey} 与 Accepted ADR 不一致（记录 ${recordedBudget}, 应为 ${acceptedBudget}）`,
          );
        if (Number.isFinite(result) && result > acceptedBudget)
          fail(`${label}.artifact ${resultKey}=${result} 超过预算 ${acceptedBudget}`);
      }

      const rawPath = resolve(dirname(artifactPath), "release-performance-raw.json");
      if (!existsSync(rawPath)) {
        fail(`${label}.artifact 缺少 release-performance-raw.json`);
      } else {
        const raw = readJsonArtifact(rawPath, `${label}.raw`);
        validateEvidenceTimestamp(raw, `${label}.raw`, true);
        validateArtifactIntegrity(rawPath, artifact.rawSha256, `${label}.raw`, "rawSha256");
        if (raw?.measurementSource !== "native-candidate")
          fail(`${label}.raw measurementSource 必须为 native-candidate`);
        if (raw?.measurementMode !== "release")
          fail(
            `${label}.raw measurementMode 必须为 release（diagnostic-preflight 不能作为发布证据）`,
          );
        if (raw?.sourceCommit !== source.commit)
          fail(`${label}.raw sourceCommit 与 manifest 不一致`);
        if (raw?.candidateSha256 !== manifest.candidate?.sha256)
          fail(`${label}.raw candidateSha256 与 manifest 不一致`);
        if (raw?.runnerSha256 !== artifact.runnerSha256)
          fail(`${label}.raw runnerSha256 与 summary 不一致`);

        const coldValid = validatePositiveSamples(raw?.coldSamples, 20, `${label}.raw coldSamples`);
        const warmValid = validatePositiveSamples(raw?.warmSamples, 20, `${label}.raw warmSamples`);
        const rssValid = validatePositiveSamples(raw?.rssSamples, 5, `${label}.raw rssSamples`);
        const editValid = validatePositiveSamples(raw?.editSamples, 20, `${label}.raw editSamples`);
        const saveValid = validatePositiveSamples(raw?.saveSamples, 20, `${label}.raw saveSamples`);
        const pngValid = validatePositiveSamples(
          raw?.pngExportSamples,
          20,
          `${label}.raw pngExportSamples`,
        );

        for (const [runs, runLabel] of [
          [raw?.coldRuns, "coldRuns"],
          [raw?.warmRuns, "warmRuns"],
        ]) {
          if (
            !Array.isArray(runs) ||
            runs.length < 20 ||
            runs.some(
              (run) =>
                run?.markerFound !== true ||
                run?.exited !== true ||
                typeof run?.runId !== "string" ||
                run.runId.length === 0 ||
                run?.readyEvent?.runId !== run.runId ||
                run?.readyEvent?.milestone !== "renderer-ready" ||
                !Number.isInteger(run?.readyEvent?.windowGeneration),
            )
          ) {
            fail(`${label}.raw ${runLabel} 缺少可验证的 runId/generation/renderer-ready/exit 链`);
          }
        }

        if (
          typeof raw?.samplingProtocol?.coldDefinition !== "string" ||
          raw.samplingProtocol.coldDefinition.length === 0 ||
          typeof raw?.samplingProtocol?.warmDefinition !== "string" ||
          raw.samplingProtocol.warmDefinition.length === 0
        ) {
          fail(`${label}.raw samplingProtocol 缺少可复现的 cold/warm 定义`);
        }
        if (
          raw?.rssResult?.measurementSource !== "native-candidate" ||
          raw?.rssResult?.readyEvent?.milestone !== "renderer-ready"
        ) {
          fail(`${label}.raw RSS 不是 renderer-ready 后的 native candidate 采样`);
        }
        // PRR-066：30 秒稳定窗协议——rss 证据必须声明 ≥30000 的 settleMs，
        // 不足或缺失不得作为 "stable RSS" 发布证据。
        if (!Number.isInteger(raw?.rssResult?.settleMs) || raw.rssResult.settleMs < 30_000) {
          fail(`${label}.raw rssResult.settleMs 缺失或不足 30000（30 秒稳定窗协议）`);
        }
        if (raw?.canvasResult?.measurementSource !== "native-candidate")
          fail(`${label}.raw canvasResult 不是 native candidate 数据`);
        const canvasGroups = [
          raw?.canvasResult?.panFrameSamples,
          raw?.canvasResult?.nodeDragFrameSamples,
          raw?.canvasResult?.zoomFrameSamples,
        ];
        const canvasValid =
          Number.isInteger(raw?.canvasResult?.rounds) &&
          raw.canvasResult.rounds >= 20 &&
          raw?.canvasResult?.fixtureNodes >= 300 &&
          raw?.canvasResult?.fixtureEdges >= 450 &&
          canvasGroups.every((samples) =>
            validatePositiveSamples(samples, 20, `${label}.raw canvas frame samples`),
          );

        if (
          coldValid &&
          !sameMetric(percentile(raw.coldSamples, 0.95), artifact.results?.coldStartP95Ms)
        )
          fail(`${label}.artifact coldStartP95Ms 不能由 raw coldSamples 复算`);
        if (
          warmValid &&
          !sameMetric(percentile(raw.warmSamples, 0.95), artifact.results?.warmStartP95Ms)
        )
          fail(`${label}.artifact warmStartP95Ms 不能由 raw warmSamples 复算`);
        if (rssValid && !sameMetric(percentile(raw.rssSamples, 0.5), artifact.results?.rssStableMb))
          fail(`${label}.artifact rssStableMb 不能由 raw rssSamples 复算`);
        if (
          editValid &&
          !sameMetric(percentile(raw.editSamples, 0.95), artifact.results?.editCommandP95Ms)
        )
          fail(`${label}.artifact editCommandP95Ms 不能由 raw editSamples 复算`);
        if (
          saveValid &&
          !sameMetric(percentile(raw.saveSamples, 0.95), artifact.results?.saveP95Ms)
        )
          fail(`${label}.artifact saveP95Ms 不能由 raw saveSamples 复算`);
        if (
          pngValid &&
          !sameMetric(percentile(raw.pngExportSamples, 0.95), artifact.results?.pngExportP95Ms)
        )
          fail(`${label}.artifact pngExportP95Ms 不能由 raw pngExportSamples 复算`);
        const canvasP95 = canvasValid
          ? Math.max(...canvasGroups.map((samples) => percentile(samples, 0.95)))
          : Number.NaN;
        if (canvasValid && !sameMetric(canvasP95, raw?.canvasResult?.frameP95Ms))
          fail(`${label}.raw canvasResult.frameP95Ms 不能由 raw frame samples 复算`);
        if (!sameMetric(canvasP95, artifact.results?.canvasFrameP95Ms))
          fail(`${label}.artifact canvasFrameP95Ms 不能由 raw canvasResult 复算`);
        if (Array.isArray(raw?.incompleteReasons) && raw.incompleteReasons.length > 0)
          fail(`${label}.raw 仍包含 incompleteReasons`);
      }
    }
  }
}

for (const requiredCommand of ["cmd-bundle", "cmd-install-gate", "cmd-release-performance"]) {
  if (!commandIds.has(requiredCommand)) fail(`commands 缺少发布必需步骤 ${requiredCommand}`);
}

const reports = manifest.platformReports ?? {};
const KNOWN_PLATFORMS = new Set(["macos", "windows"]);

if (manifest.releaseScope) {
  const scope = manifest.releaseScope;
  if (typeof scope.productVersion !== "string" || scope.productVersion.length === 0) {
    fail("releaseScope.productVersion 缺失或为空");
  }

  const g2Approval = manifest.approvals?.g2;
  if (typeof g2Approval !== "object" || g2Approval === null) {
    fail("approvals.g2 缺失（readiness 必须复算精确 packaging Gate）");
  } else {
    if (g2Approval.status !== "APPROVED")
      fail(`approvals.g2.status 必须为 APPROVED（实际 ${g2Approval.status ?? "missing"}）`);
    const decisionPath = artifactExists(g2Approval.artifact, "approvals.g2");
    validateArtifactIntegrity(decisionPath, g2Approval.artifactSha256, "approvals.g2");
    if (decisionPath && !decisionPath.endsWith(".json")) {
      fail("approvals.g2.artifact 必须是 decision register JSON");
    } else if (decisionPath) {
      try {
        const validatedG2 = loadAndValidateG2Scope({
          scopeFrom: g2Approval.artifact,
          host: "tauri",
          candidate: manifest.candidate?.path,
          evidenceDir: relative(ROOT, dirname(manifestPath)),
          repoRoot: ROOT,
        });
        const registeredG2 = validatedG2.g2;
        if (g2Approval.approvedBy !== registeredG2.approvedBy)
          fail("approvals.g2.approvedBy 与 decision register 不一致");
        if (g2Approval.approvedAt !== registeredG2.approvedAt)
          fail("approvals.g2.approvedAt 与 decision register 不一致");
        const g2ApprovedAt = Date.parse(registeredG2.approvedAt);
        if (Number.isFinite(manifestTime) && g2ApprovedAt > manifestTime)
          fail("approvals.g2.approvedAt 晚于 manifest.generatedAt");
        if (
          typeof g2Approval.userRecord !== "string" ||
          !g2Approval.userRecord.startsWith("[from-user]") ||
          !registeredG2.evidence.includes(g2Approval.userRecord)
        ) {
          fail("approvals.g2.userRecord 必须逐字匹配 decision register 的 [from-user] 记录");
        }
        const installerDmg = validateSafePath(
          manifest.candidate?.installerDmg,
          ROOT,
          "candidate.installerDmg",
        );
        if (!validatedG2.normalized.candidateOutputPaths.includes(installerDmg)) {
          fail("candidate.installerDmg 不在 G2 批准 candidateOutputPaths 中");
        }
        for (const action of [
          "build",
          "launch",
          "install",
          "uninstall",
          "measure-performance",
          "permission-probe",
        ]) {
          if (!validatedG2.scope.allowedActions.includes(action))
            fail(`G2.approvedScope.allowedActions 缺少 ${action}`);
        }
      } catch (error) {
        fail(`approvals.g2 packaging scope 无效：${error.message}`);
      }
    }
  }

  const candidate = manifest.candidate;
  if (typeof candidate !== "object" || candidate === null) {
    fail("candidate 缺失或无效");
  } else {
    const candidatePath = artifactExists(candidate.path, "candidate");
    if (!/^[a-f0-9]{64}$/i.test(candidate.sha256 ?? "")) {
      fail("candidate.sha256 缺失或无效");
    } else if (candidatePath) {
      if (lstatSync(candidatePath).isSymbolicLink()) fail("candidate 不能是符号链接");
      const actual = computeArtifactSha256(candidatePath);
      if (actual !== candidate.sha256) fail(`candidate.sha256 与当前产物不一致`);
      if (Number.isFinite(manifestTime) && latestMtimeMs(candidatePath) > manifestTime + 1_000)
        fail("candidate 产物晚于 manifest.generatedAt");
    }

    const dmgPath = artifactExists(candidate.installerDmg, "candidate.installerDmg");
    if (!/^[a-f0-9]{64}$/i.test(candidate.dmgSha256 ?? "")) {
      fail("candidate.dmgSha256 缺失或无效");
    } else if (dmgPath) {
      if (lstatSync(dmgPath).isSymbolicLink()) fail("candidate installer 不能是符号链接");
      const actual = computeArtifactSha256(dmgPath);
      if (actual !== candidate.dmgSha256) fail("candidate.dmgSha256 与当前产物不一致");
      if (Number.isFinite(manifestTime) && latestMtimeMs(dmgPath) > manifestTime + 1_000)
        fail("candidate installer 产物晚于 manifest.generatedAt");
    }
    if (candidate.unsignedConfirmed !== true) fail("candidate.unsignedConfirmed 必须为 true");
  }

  const gFinal = manifest.approvals?.gFinal;
  if (typeof gFinal !== "object" || gFinal === null) {
    fail("approvals.gFinal 缺失（视觉 runner 不能自行授予项目负责人 Gate）");
  } else {
    if (gFinal.status !== "APPROVED")
      fail(`approvals.gFinal.status 必须为 APPROVED（实际 ${gFinal.status ?? "missing"}）`);
    const approvedBy = typeof gFinal.approvedBy === "string" ? gFinal.approvedBy.trim() : "";
    if (!approvedBy || /^(project[- ]?owner|owner|tbd|unknown)$/i.test(approvedBy)) {
      fail("approvals.gFinal.approvedBy 必须记录真实批准人，不能使用占位符");
    }
    const approvedAt = Date.parse(gFinal.approvedAt);
    if (!Number.isFinite(approvedAt)) fail("approvals.gFinal.approvedAt 必须是合法时间");
    else if (Number.isFinite(manifestTime) && approvedAt > manifestTime)
      fail("approvals.gFinal.approvedAt 晚于 manifest.generatedAt");
    if (typeof gFinal.userRecord !== "string" || !gFinal.userRecord.startsWith("[from-user]")) {
      fail("approvals.gFinal.userRecord 必须包含明确的 [from-user] 验收记录");
    }
    if (gFinal.candidateSha256 !== candidate?.sha256)
      fail("approvals.gFinal.candidateSha256 与 manifest candidate 不一致");
    const approvalArtifactPath = artifactExists(gFinal.artifact, "approvals.gFinal");
    const approvalArtifact = readJsonArtifact(approvalArtifactPath, "approvals.gFinal");
    validateArtifactIntegrity(approvalArtifactPath, gFinal.artifactSha256, "approvals.gFinal");
    if (!approvalArtifact) {
      fail("approvals.gFinal.artifact 必须是独立的 JSON 批准记录");
    } else {
      if (approvalArtifact.approvalKind !== "g-final")
        fail("approvals.gFinal.artifact approvalKind 必须为 g-final");
      for (const key of ["status", "approvedBy", "approvedAt", "userRecord", "candidateSha256"]) {
        if (approvalArtifact[key] !== gFinal[key])
          fail(`approvals.gFinal.artifact ${key} 与 manifest 不一致`);
      }
      if (approvalArtifact.sourceCommit !== source.commit)
        fail("approvals.gFinal.artifact sourceCommit 与 manifest 不一致");
    }
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
        if (deferredSet.has(item.platform)) fail(`${dLabel}.platform 重复: ${item.platform}`);
        deferredSet.add(item.platform);

        if (typeof item.reason !== "string" || item.reason.length === 0) {
          fail(`${dLabel}.reason 缺失或为空`);
        }
        if (typeof item.decisionRef !== "string" || item.decisionRef.length === 0) {
          fail(`${dLabel}.decisionRef 缺失或为空`);
        } else {
          try {
            const decisionRef = validateSafePath(item.decisionRef, ROOT, `${dLabel}.decisionRef`);
            if (!existsSync(resolve(ROOT, decisionRef)))
              fail(`${dLabel}.decisionRef 不存在: ${item.decisionRef}`);
          } catch (error) {
            fail(error.message);
          }
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
    if (report.platform !== platform)
      fail(`${label}.platform 与键名不一致（实际 ${report.platform ?? "missing"}）`);
    if (report.status !== "verified") {
      fail(`${label} 必须为 verified（当前 ${report.status ?? "missing"}）`);
    }
    if (!Number.isInteger(report.exitCode) || report.exitCode !== 0) {
      fail(`${label}.exitCode 必须为 0（当前 ${report.exitCode}）`);
    }
    const reportArtifactPath = artifactExists(report.artifact, label);
    const reportArtifact = readJsonArtifact(reportArtifactPath, label);
    validateEvidenceTimestamp(reportArtifact, label, true);
    validateArtifactIntegrity(reportArtifactPath, report.artifactSha256, label);
    if (!reportArtifact) {
      fail(`${label}.artifact 必须是候选原生报告 JSON，不能直接指向 .app`);
    } else {
      if (reportArtifact.evidenceKind !== "native-candidate")
        fail(`${label}.artifact evidenceKind 必须为 native-candidate`);
      if (reportArtifact.sourceCommit !== source.commit)
        fail(`${label}.artifact sourceCommit 与 manifest 不一致`);
      if (reportArtifact.candidateSha256 !== manifest.candidate?.sha256)
        fail(`${label}.artifact candidateSha256 与 manifest 不一致`);
      if (reportArtifact.platform !== platform)
        fail(`${label}.artifact platform 与 releaseScope 不一致`);
      if (reportArtifact.overall !== "PASS" && reportArtifact.status !== "PASS")
        fail(`${label}.artifact 没有 PASS 结论`);
    }
  }

  // 校验 deferredPlatforms
  for (const platform of deferredSet) {
    const report = reports[platform];
    if (report) {
      const label = `platformReports.${platform}`;
      if (report.platform !== platform)
        fail(`${label}.platform 与键名不一致（实际 ${report.platform ?? "missing"}）`);
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
        fail(
          `${label} deferred 平台状态必须为 deferred、not-run 或 verified（实际 ${report.status}）`,
        );
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
  fail("releaseScope 缺失；历史 manifest 只可审计，不能获得发布 PASS");
}

if (manifest.overall !== "READY")
  fail(`overall 必须为 READY（实际 ${manifest.overall ?? "missing"}）`);

if (errors.length) {
  console.error(`verify-evidence: BLOCKED/FAIL (${errors.length})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`verify-evidence: PASS (${manifest.caseId})`);
