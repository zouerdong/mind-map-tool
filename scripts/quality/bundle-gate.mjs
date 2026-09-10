// bundle-gate.mjs — 打包 fail-closed 门（PRC-055 契约）。
// 强制校验 G2 scope（build 动作授权与 candidate-root 边界），检测到签名配置/凭据即拒绝。
// 构建完成后盘点批准目录内的新产物，生成 inventory 与 hash。
// --dmg-format ULMO（PRR-069 / ADR 0013）：在盘点前把本轮唯一 DMG 原位转换为
// 目标容器压缩格式；转换失败即整体失败，不回退 UDZO。
// 用法：node bundle-gate.mjs --host tauri [--scope-from <register>] [--candidate-root <path>] [--dmg-format ULMO] -- <tauri-build-command>

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
const REPACK_PATH = resolve(HERE, "repack-dmg.mjs");

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
// PRR-069：DMG 容器格式必须由正式命令显式声明（如 --dmg-format ULMO），
// 不读环境变量、无隐式默认；缺省时不做转换（非发布路径的旧用法保持原语义）。
// --repack-hdiutil 是测试注入入口（透传 repack-dmg 的 --hdiutil），生产调用不传。
const dmgFormat = flag("dmg-format");
const repackHdiutil = flag("repack-hdiutil");
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

// 4b. PRR-069 / ADR 0013：在盘点（inventory hash 计算）之前，把本轮唯一
// 批准的 DMG 原位转换为目标容器压缩格式。转换由 repack-dmg.mjs fail-closed
// 执行；任何失败都让本轮整体失败，绝不回退 UDZO 后写 PASS。
let dmgRepack = null;
if (dmgFormat) {
  const approvedDmgs = validated.normalized.candidateOutputPaths.filter((p) => p.endsWith(".dmg"));
  if (approvedDmgs.length !== 1) {
    console.error(
      `bundle-gate: FAIL — G2 批准的 DMG 候选不是恰好一个（得到 ${approvedDmgs.length} 个），拒绝 glob 猜测转换目标`,
    );
    process.exit(1);
  }
  const repackArgs = [
    REPACK_PATH,
    "--input",
    approvedDmgs[0],
    "--format",
    dmgFormat,
    "--scope-from",
    scopeFrom,
    "--after",
    buildStartedAt,
    "--root",
    ROOT,
  ];
  let repackReportPath = null;
  if (inventoryOutputRel) {
    repackReportPath = join(dirname(inventoryOutputRel), "dmg-repack-report.json");
    repackArgs.push("--report", repackReportPath);
  }
  if (repackHdiutil) repackArgs.push("--hdiutil", repackHdiutil);
  const repackResult = spawnSync(process.execPath, repackArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((repackResult.status ?? 1) !== 0) {
    console.error("bundle-gate: FAIL — DMG 容器格式转换失败，本轮候选作废（不回退原格式）");
    console.error(repackResult.stderr || repackResult.stdout);
    process.exit(repackResult.status ?? 1);
  }
  // 解析 repack stdout 的单行 JSON 报告并嵌入 inventory 证据链。
  const reportLine = (repackResult.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!reportLine) {
    console.error("bundle-gate: FAIL — repack-dmg 未输出可解析的 JSON 报告");
    process.exit(1);
  }
  try {
    dmgRepack = JSON.parse(reportLine);
  } catch {
    console.error("bundle-gate: FAIL — repack-dmg 报告 JSON 解析失败");
    process.exit(1);
  }
  const expectedRepackSha256 = computeFileSha256(REPACK_PATH);
  const repackStartedMs = Date.parse(dmgRepack?.startedAt);
  const repackFinishedMs = Date.parse(dmgRepack?.finishedAt);
  const buildStartedMs = Date.parse(buildStartedAt);
  const reportShapeValid =
    dmgRepack?.runner === "repack-dmg.mjs" &&
    dmgRepack?.runnerSha256 === expectedRepackSha256 &&
    dmgRepack?.input === approvedDmgs[0] &&
    dmgRepack?.dmgFormat === dmgFormat &&
    dmgRepack?.gitHead === gitHead &&
    /^[0-9a-f]{64}$/.test(dmgRepack?.beforeSha256 ?? "") &&
    /^[0-9a-f]{64}$/.test(dmgRepack?.afterSha256 ?? "") &&
    dmgRepack?.beforeSha256 !== dmgRepack?.afterSha256 &&
    Number.isSafeInteger(dmgRepack?.beforeBytes) &&
    dmgRepack.beforeBytes > 0 &&
    Number.isSafeInteger(dmgRepack?.afterBytes) &&
    dmgRepack.afterBytes > 0 &&
    Number.isFinite(repackStartedMs) &&
    Number.isFinite(repackFinishedMs) &&
    repackStartedMs >= buildStartedMs &&
    repackFinishedMs >= repackStartedMs &&
    repackFinishedMs <= Date.now();
  if (!reportShapeValid) {
    console.error("bundle-gate: FAIL — repack-dmg 报告字段、runner hash 或时间拓扑无效");
    process.exit(1);
  }
  // 转换后 source/worktree 再复核：转换期间仓库发生变化即 fail-closed。
  const gitHeadAfterRepack = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const sourceStatusAfterRepack = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  if (gitHeadAfterRepack !== gitHead || sourceStatusAfterRepack.length > 0) {
    console.error("bundle-gate: FAIL — DMG 转换期间 source commit/worktree 发生变化，候选不可归因");
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

if (dmgRepack) {
  const finalDmg = candidateArtifacts.find((artifact) => artifact.path === dmgRepack.input);
  if (
    !finalDmg ||
    finalDmg.sha256 !== dmgRepack.afterSha256 ||
    finalDmg.sizeBytes !== dmgRepack.afterBytes
  ) {
    console.error(
      "bundle-gate: FAIL — 最终 DMG 盘点结果与 repack after hash/bytes 不一致，候选不可归因",
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
const inventoryFinishedAt = dmgRepack ? dmgRepack.finishedAt : buildFinishedAt;
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
  ...(dmgFormat ? { dmgFormat, dmgRepack } : {}),
  newEntries,
  artifacts: candidateArtifacts,
};

if (inventoryOutputRel) {
  const inventoryAbs = resolve(ROOT, inventoryOutputRel);
  mkdirSync(dirname(inventoryAbs), { recursive: true });
  writeFileSync(inventoryAbs, `${JSON.stringify(inventory, null, 2)}\n`);
}

console.log(`bundle-gate: PASS — 成功构建并盘点 ${candidateArtifacts.length} 个候选产物`);
if (dmgFormat) {
  console.log(
    `  dmgFormat=${dmgFormat} (repack ${dmgRepack?.beforeBytes ?? "?"}B -> ${dmgRepack?.afterBytes ?? "?"}B)`,
  );
}
for (const art of candidateArtifacts) {
  console.log(`  - ${art.path} (sha256: ${art.sha256.slice(0, 16)}… size: ${art.sizeBytes}B)`);
}
if (inventoryOutputRel) console.log(`  inventory: ${inventoryOutputRel}`);

process.exit(0);
