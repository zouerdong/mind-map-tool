// bundle-gate.mjs — 打包 fail-closed 门（PRC-055 契约）。
// 强制校验 G2 scope（build 动作授权与 candidate-root 边界），检测到签名配置/凭据即拒绝。
// 构建完成后盘点批准目录内的新产物，生成 inventory 与 hash。
// --assemble-dmg（PRR-069C / ADR 0013 v1.1.0）：正式路径只做 app-only build，
// 再由 assemble-dmg.mjs 从本轮 .app 装配 ULMO DMG；装配失败即整体失败，不回退、不复用旧 DMG。
// 用法：node bundle-gate.mjs --host tauri [--scope-from <register>] [--candidate-root <path>]
//           [--assemble-dmg --dmg-format ULMO --work-dir <.tmp/...>] -- <app-only-build-command>

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAndValidateG2Scope,
  checkSigningHints,
  computeFileSha256,
  computeArtifactSha256,
  validateSafePath,
  isSameOrDescendant,
} from "./g2-scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const ASSEMBLER_PATH = resolve(HERE, "assemble-dmg.mjs");

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}

// --root 可把 gate 指向另一仓库根（与 verify-decision.mjs 相同的复算/测试入口）；
// 生产调用不传该参数，默认本仓库根，clean-worktree 与 G2 scope 检查口径不变。
const ROOT = flag("root") ? resolve(flag("root")) : resolve(HERE, "../..");

const host = flag("host");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const candidateRoot = flag("candidate-root") ?? "apps/desktop/src-tauri/target/release/bundle";
const inventoryOutput = flag("inventory");
// PRR-069C / ADR 0013 v1.1.0：正式 DMG 由仓库受控 assembler 从本轮 .app 装配。
// --assemble-dmg 显式开启装配阶段，并强制声明 --dmg-format ULMO；缺省时不做 DMG 处理
// （非发布路径的旧用法保持原语义）。--work-dir 是 assembler 的任务临时工作目录。
const assembleDmg = args.includes("--assemble-dmg");
const dmgFormat = flag("dmg-format");
const workDir = flag("work-dir");
const dashdash = args.indexOf("--");
const command = dashdash === -1 ? [] : args.slice(dashdash + 1);

// 以下均为测试注入入口，生产调用不传；默认使用真实 assembler 与系统工具。
const assemblerScript = flag("assembler-script");
const assemblerToolDir = flag("assembler-tool-dir");
const assemblerTimeoutMs = flag("assembler-timeout-ms");
const assemblerDeadlineMs = flag("assembler-deadline-ms");

if (!host || command.length === 0) {
  console.error(
    "usage: bundle-gate.mjs --host <tauri|electron> [--scope-from <register>] [--candidate-root <path>] " +
      "[--assemble-dmg --dmg-format ULMO --work-dir <.tmp/...>] -- <command...>",
  );
  process.exit(2);
}
if (assembleDmg && dmgFormat !== "ULMO") {
  console.error("bundle-gate: BLOCKED — --assemble-dmg 必须与 --dmg-format ULMO 同时声明");
  process.exit(1);
}
if (assembleDmg && !workDir) {
  console.error(
    "bundle-gate: BLOCKED — --assemble-dmg 必须声明 --work-dir <repo-relative .tmp/...>",
  );
  process.exit(1);
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

let inventoryOutputRel = null;
if (inventoryOutput) {
  try {
    inventoryOutputRel = validateSafePath(inventoryOutput, ROOT, "inventory");
  } catch (err) {
    console.error(`bundle-gate: BLOCKED — inventory 路径无效: ${err.message}`);
    process.exit(1);
  }
  const inventoryAbs = resolve(ROOT, inventoryOutputRel);
  const approved = validated.normalized.evidenceOutputPaths.some((evidencePath) =>
    isSameOrDescendant(resolve(ROOT, evidencePath), inventoryAbs),
  );
  if (!approved) {
    console.error(`bundle-gate: BLOCKED — inventory 不在 G2 批准的 evidenceOutputPaths 内`);
    process.exit(1);
  }
}

// 2. 签名与凭据检测：任何签名配置/凭据迹象直接 fail-closed
const hits = checkSigningHints(host, ROOT);
if (hits.length) {
  console.error(`bundle-gate: FAIL — 检测到签名配置/凭据迹象（${hits.join(", ")}）。`);
  console.error("签名/公证是独立授权门槛，不能由打包脚本顺带执行（MM-100/G2 规则）。");
  process.exit(1);
}

// 3. 记录构建前 candidateRoot 状态（若存在）
let gitHead;
let sourceStatus;
try {
  gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  sourceStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
} catch (error) {
  console.error(`bundle-gate: BLOCKED — 无法读取 Git source 状态: ${error.message}`);
  process.exit(1);
}
if (sourceStatus.length > 0) {
  console.error("bundle-gate: BLOCKED — release candidate 必须从 clean worktree 构建");
  process.exit(1);
}

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
const preArtifactState = new Map();
for (const approvedPath of validated.normalized.candidateOutputPaths) {
  const absolute = resolve(ROOT, approvedPath);
  if (existsSync(absolute)) {
    preArtifactState.set(approvedPath, {
      sha256: computeArtifactSha256(absolute),
      latestMtimeMs: artifactLatestMtimeMs(absolute),
    });
  }
}

// 4. 执行原始构建命令
console.log(
  `bundle-gate: unsigned 候选构建放行（host=${host}, candidateRoot=${candidateRoot}, 未检测到签名凭据）`,
);

const buildStartedAt = new Date().toISOString();
const r = spawnSync(command[0], command.slice(1), { cwd: ROOT, stdio: "inherit" });
const buildFinishedAt = new Date().toISOString();
if ((r.status ?? 1) !== 0) {
  console.error(`bundle-gate: 子进程退出码非零 (${r.status})`);
  process.exit(r.status ?? 1);
}

const gitHeadAfter = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
}).trim();
const sourceStatusAfter = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all"],
  { cwd: ROOT, encoding: "utf8" },
).trim();
if (gitHeadAfter !== gitHead || sourceStatusAfter.length > 0) {
  console.error("bundle-gate: FAIL — 构建期间 source commit/worktree 发生变化，候选不可归因");
  process.exit(1);
}

// 4b. PRR-069C / ADR 0013 v1.1.0：app-only build 成功后，由仓库受控 assembler
// 从本轮刷新的 .app 装配最终 ULMO DMG（不调用 Tauri dmg target、Finder、AppleScript）。
// assembler 的任何失败都让本轮整体失败，不回退、不复用旧 DMG。
let dmgAssembly = null;
if (assembleDmg) {
  const approvedDmgs = validated.normalized.candidateOutputPaths.filter((p) => p.endsWith(".dmg"));
  const approvedApps = validated.normalized.candidateOutputPaths.filter((p) => p.endsWith(".app"));
  if (approvedDmgs.length !== 1 || approvedApps.length !== 1) {
    console.error(
      `bundle-gate: FAIL — G2 批准的 .app/.dmg 候选必须各恰好一个（得到 app=${approvedApps.length}, dmg=${approvedDmgs.length}），拒绝 glob 猜测装配目标`,
    );
    process.exit(1);
  }
  let safeWorkDir;
  try {
    safeWorkDir = validateSafePath(workDir, ROOT, "work-dir");
  } catch (err) {
    console.error(`bundle-gate: BLOCKED — work-dir 无效: ${err.message}`);
    process.exit(1);
  }
  const assemblerPath = assemblerScript ? resolve(ROOT, assemblerScript) : ASSEMBLER_PATH;
  if (!existsSync(assemblerPath)) {
    console.error(`bundle-gate: BLOCKED — assembler 不存在: ${relative(ROOT, assemblerPath)}`);
    process.exit(1);
  }
  const assemblyReportRel = inventoryOutputRel
    ? join(dirname(inventoryOutputRel), "dmg-assembly-report.json")
    : null;
  const assemblerArgs = [
    assemblerPath,
    "--app",
    approvedApps[0],
    "--output",
    approvedDmgs[0],
    "--work-dir",
    safeWorkDir,
    "--format",
    dmgFormat,
    "--scope-from",
    scopeFrom,
    "--after",
    buildStartedAt,
    "--root",
    ROOT,
  ];
  if (assemblyReportRel) assemblerArgs.push("--report", assemblyReportRel);
  if (assemblerToolDir) assemblerArgs.push("--tool-dir", assemblerToolDir);
  if (assemblerTimeoutMs) assemblerArgs.push("--timeout-ms", assemblerTimeoutMs);
  if (assemblerDeadlineMs) assemblerArgs.push("--deadline-ms", assemblerDeadlineMs);
  const assemblerBudgetMs = Number(assemblerDeadlineMs ?? 180000);
  const assemblerResult = spawnSync(process.execPath, assemblerArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: assemblerBudgetMs + 30000,
    killSignal: "SIGKILL",
  });
  if ((assemblerResult.status ?? 1) !== 0) {
    console.error("bundle-gate: FAIL — DMG 装配失败，本轮候选作废（不回退、不复用旧 DMG）");
    console.error((assemblerResult.stderr || assemblerResult.stdout || "").trim());
    process.exit(assemblerResult.status ?? 1);
  }
  const reportLine = (assemblerResult.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!reportLine) {
    console.error("bundle-gate: FAIL — assemble-dmg 未输出可解析的 JSON 报告");
    process.exit(1);
  }
  try {
    dmgAssembly = JSON.parse(reportLine);
  } catch {
    console.error("bundle-gate: FAIL — assemble-dmg 报告 JSON 解析失败");
    process.exit(1);
  }
  const expectedAssemblerSha256 = computeFileSha256(assemblerPath);
  const assemblyStartedMs = Date.parse(dmgAssembly?.startedAt);
  const assemblyFinishedMs = Date.parse(dmgAssembly?.finishedAt);
  const buildStartedMs = Date.parse(buildStartedAt);
  const licenseSha256 = computeFileSha256(resolve(ROOT, "LICENSE"));
  const reportShapeValid =
    dmgAssembly?.runner === "assemble-dmg.mjs" &&
    dmgAssembly?.runnerSha256 === expectedAssemblerSha256 &&
    dmgAssembly?.gitHead === gitHead &&
    dmgAssembly?.sourceWorktree === "clean" &&
    dmgAssembly?.dmgFormat === dmgFormat &&
    dmgAssembly?.output?.path === approvedDmgs[0] &&
    /^[0-9a-f]{64}$/.test(dmgAssembly?.output?.sha256 ?? "") &&
    Number.isSafeInteger(dmgAssembly?.output?.bytes) &&
    dmgAssembly.output.bytes > 0 &&
    dmgAssembly?.inputs?.app?.path === approvedApps[0] &&
    /^[0-9a-f]{64}$/.test(dmgAssembly?.inputs?.app?.sha256 ?? "") &&
    dmgAssembly?.inputs?.license?.path === "LICENSE" &&
    dmgAssembly?.inputs?.license?.sha256 === licenseSha256 &&
    /^[0-9a-f]{64}$/.test(dmgAssembly?.inputs?.icon?.sha256 ?? "") &&
    dmgAssembly?.eula?.preMountDisplayVerified === true &&
    dmgAssembly?.eula?.imageInfoDeclaresAgreement === true &&
    dmgAssembly?.eula?.licenseSha256 === licenseSha256 &&
    dmgAssembly?.eula?.resourceSha256 === licenseSha256 &&
    dmgAssembly?.checks?.format === dmgFormat &&
    dmgAssembly?.checks?.crc32 === "VALID" &&
    dmgAssembly?.checks?.payloadAppSha256 === dmgAssembly?.inputs?.app?.sha256 &&
    dmgAssembly?.checks?.volumeIconSha256 === dmgAssembly?.inputs?.icon?.sha256 &&
    Number.isSafeInteger(dmgAssembly?.timeoutMs) &&
    Number.isSafeInteger(dmgAssembly?.deadlineMs) &&
    Array.isArray(dmgAssembly?.commands) &&
    dmgAssembly.commands.length > 0 &&
    dmgAssembly.commands.every(
      (c) => typeof c?.tool === "string" && Array.isArray(c?.args) && c?.timedOut === false,
    ) &&
    Number.isFinite(assemblyStartedMs) &&
    Number.isFinite(assemblyFinishedMs) &&
    assemblyStartedMs >= buildStartedMs &&
    assemblyFinishedMs >= assemblyStartedMs &&
    assemblyFinishedMs <= Date.now();
  if (!reportShapeValid) {
    console.error(
      "bundle-gate: FAIL — assemble-dmg 报告字段、runner hash、EULA/LICENSE 绑定或时间拓扑无效",
    );
    process.exit(1);
  }
  // 装配后 source/worktree 再复核：装配期间仓库发生变化即 fail-closed。
  const gitHeadAfterAssembly = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const sourceStatusAfterAssembly = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  if (gitHeadAfterAssembly !== gitHead || sourceStatusAfterAssembly.length > 0) {
    console.error("bundle-gate: FAIL — DMG 装配期间 source commit/worktree 发生变化，候选不可归因");
    process.exit(1);
  }
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
    if (lstatSync(full).isSymbolicLink()) {
      console.error(`bundle-gate: FAIL — 候选产物不能是符号链接: ${relToRepo}`);
      process.exit(1);
    }
    // 必须在 G2 批准的 candidateOutputPaths 中
    const isApproved = validated.normalized.candidateOutputPaths.includes(relToRepo);
    if (!isApproved) {
      console.error(
        `bundle-gate: FAIL — 发现越界产物: ${relToRepo}（未在 G2 批准 candidateOutputPaths 内）`,
      );
      process.exit(1);
    }
    const sha256 = computeArtifactSha256(full);
    const sizeBytes = artifactSizeBytes(full);
    const latestMtimeMs = artifactLatestMtimeMs(full);
    const before = preArtifactState.get(relToRepo);
    if (before && before.sha256 === sha256 && before.latestMtimeMs === latestMtimeMs) {
      console.error(`bundle-gate: FAIL — 候选产物并非本次构建产生或刷新: ${relToRepo}`);
      process.exit(1);
    }
    candidateArtifacts.push({
      path: relToRepo,
      sha256,
      sizeBytes,
      latestMtime: new Date(latestMtimeMs).toISOString(),
    });
  }
}

for (const approvedPath of validated.normalized.candidateOutputPaths) {
  if (!candidateArtifacts.some((artifact) => artifact.path === approvedPath)) {
    console.error(`bundle-gate: FAIL — 本次构建缺少 G2 批准的候选产物: ${approvedPath}`);
    process.exit(1);
  }
}

if (dmgAssembly) {
  const finalDmg = candidateArtifacts.find((artifact) => artifact.path === dmgAssembly.output.path);
  if (
    !finalDmg ||
    finalDmg.sha256 !== dmgAssembly.output.sha256 ||
    finalDmg.sizeBytes !== dmgAssembly.output.bytes
  ) {
    console.error(
      "bundle-gate: FAIL — 最终 DMG 盘点结果与 assemble-dmg 输出 hash/bytes 不一致，候选不可归因",
    );
    process.exit(1);
  }
}

function artifactSizeBytes(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += artifactSizeBytes(join(path, entry.name));
  }
  return total;
}

function artifactLatestMtimeMs(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let latest = st.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    latest = Math.max(latest, artifactLatestMtimeMs(join(path, entry.name)));
  }
  return latest;
}

// 时间拓扑：inventory 的时间必须覆盖 repack 完成点（PRR-069 要求
// bundle start <= bundle finish 对含转换的完整流程成立）。
const inventoryFinishedAt = dmgAssembly ? dmgAssembly.finishedAt : buildFinishedAt;
const inventory = {
  sourceCommit: gitHead,
  sourceWorktree: "clean",
  runner: "bundle-gate.mjs",
  runnerSha256: computeFileSha256(RUNNER_PATH),
  os: process.platform,
  arch: process.arch,
  command: command.join(" "),
  generatedAt: inventoryFinishedAt,
  startedAt: buildStartedAt,
  finishedAt: inventoryFinishedAt,
  ...(dmgAssembly ? { dmgFormat, dmgAssembly } : {}),
  newEntries,
  artifacts: candidateArtifacts,
};

if (inventoryOutputRel) {
  const inventoryAbs = resolve(ROOT, inventoryOutputRel);
  mkdirSync(dirname(inventoryAbs), { recursive: true });
  writeFileSync(inventoryAbs, `${JSON.stringify(inventory, null, 2)}\n`);
}

console.log(`bundle-gate: PASS — 成功构建并盘点 ${candidateArtifacts.length} 个候选产物`);
if (dmgAssembly) {
  console.log(
    `  dmgAssembly: dmgFormat=${dmgFormat} runner=${dmgAssembly.runner} ` +
      `(${dmgAssembly.output.bytes}B, elapsed ${dmgAssembly.elapsedMs}ms, eula=${
        dmgAssembly.eula.licenseSha256 === dmgAssembly.eula.resourceSha256 ? "bound" : "?"
      })`,
  );
}
for (const art of candidateArtifacts) {
  console.log(`  - ${art.path} (sha256: ${art.sha256.slice(0, 16)}… size: ${art.sizeBytes}B)`);
}
if (inventoryOutputRel) console.log(`  inventory: ${inventoryOutputRel}`);

process.exit(0);
