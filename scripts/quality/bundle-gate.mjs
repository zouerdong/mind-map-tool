// bundle-gate.mjs — 打包 fail-closed 门（PRC-055 契约）。
// 强制校验 G2 scope（build 动作授权与 candidate-root 边界），检测到签名配置/凭据即拒绝。
// 构建完成后盘点批准目录内的新产物，生成 inventory 与 hash。
// --assemble-dmg（PRR-069C / ADR 0013 v1.1.0）：正式路径只做 app-only build，
// 再由 assemble-dmg.mjs 从本轮 .app 装配 ULMO DMG；装配失败即整体失败，不回退、不复用旧 DMG。
// PRR-069C-R1 加固：
//   - 正式模式（--root 即 runner 所在 canonical 仓库）拒绝全部测试注入参数
//     （--assembler-script/--assembler-tool-dir/--assembler-timeout-ms/--assembler-deadline-ms），
//     并由 gate 自身强制 build command 为精确的 Tauri app-only 合同；
//   - 正式 work-dir 只允许 .tmp/prr-069c-<非空>；任何模式都拒绝 evidence 子树、
//     符号链接与预存外来目标；注入阈值不得超过 120000/180000ms；
//   - 正式报告必须精确 timeoutMs=120000/deadlineMs=180000，且工具清单与
//     SYSTEM_TOOL_PATHS 逐项一致（path + 重算 hash），不采信被注入文件的自身 hash。
// 用法：node bundle-gate.mjs --host tauri [--scope-from <register>] [--candidate-root <path>]
//           [--assemble-dmg --dmg-format ULMO --work-dir <.tmp/...>] -- <app-only-build-command>

import { spawnSync, execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
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
import {
  SYSTEM_TOOL_PATHS,
  DMG_TOOL_NAMES,
  DMG_CLEANUP_GRACE_MS,
  DMG_PRODUCTION_WORK_DIR_SHAPE,
  validateInjectionPath,
  validateInjectedToolSet,
  validateDmgWorkDir,
  assertWorkDirLandingOutside,
  assertWorkDirNotPreExisting,
  assertTaskRootAbsent,
} from "./dmg-assembly-contract.mjs";
import { randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const ASSEMBLER_PATH = resolve(HERE, "assemble-dmg.mjs");

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}

/** 规范化到真实路径（无符号链接别名），用于正式/fixture 模式判定。 */
function toRealPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

// --root 可把 gate 指向另一仓库根（与 verify-decision.mjs 相同的复算/测试入口）；
// 生产调用不传该参数，默认本仓库根，clean-worktree 与 G2 scope 检查口径不变。
const ROOT = flag("root") ? resolve(flag("root")) : resolve(HERE, "../..");
// PRR-069C-R1：canonical source root 由 runner 文件自身位置决定（与 --root 无关），
// 调用者无法通过环境变量或参数伪造“正式”判定。
const CANONICAL_ROOT = resolve(HERE, "../..");
const IS_PRODUCTION = toRealPath(ROOT) === toRealPath(CANONICAL_ROOT);

const host = flag("host");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const candidateRoot = flag("candidate-root") ?? "apps/desktop/src-tauri/target/release/bundle";
const inventoryOutput = flag("inventory");
// PRR-069C / ADR 0013 v1.1.0：正式 DMG 由仓库受控 assembler 从本轮 .app 装配。
// --assemble-dmg 显式开启装配阶段，并强制声明 --dmg-format ULMO；缺省时不做 DMG 处理
// （非发布路径的旧用法保持原语义）。--work-dir 是 assembler 的任务临时工作目录。
const assembleDmg = args.includes("--assemble-dmg");
const dmgFormat = flag("dmg-format");
const workDirFlag = flag("work-dir");
const dashdash = args.indexOf("--");
const command = dashdash === -1 ? [] : args.slice(dashdash + 1);

/**
 * PRR-069C-R2-F1：--work-dir 省略时由 gate 生成一次性唯一任务根
 * （`.tmp/prr-069c-<run-id>/work`），因此默认命令不再指向固定目录，
 * `pnpm bundle:tauri` 可以重复执行且每次都用全新工作树。
 * gate 只做只读校验并把这个路径交给 assembler；任务根本身只由 assembler 创建。
 */
const workDir = workDirFlag ?? (assembleDmg ? defaultDmgWorkDir() : null);

function defaultDmgWorkDir() {
  return `.tmp/prr-069c-${randomUUID()}/work`;
}

// 以下均为测试注入入口，只在非 canonical 的合成 fixture root 内合法；默认使用
// 真实 assembler 与系统工具。
const assemblerScript = flag("assembler-script");
const assemblerToolDir = flag("assembler-tool-dir");
const assemblerTimeoutMs = flag("assembler-timeout-ms");
const assemblerDeadlineMs = flag("assembler-deadline-ms");

// PRR-069C-R1：正式装配的固定时间预算（单命令 120s / 整轮 180s），不得放宽。
const PROD_ASSEMBLER_TIMEOUT_MS = 120000;
const PROD_ASSEMBLER_DEADLINE_MS = 180000;
// 正式 build command 的窄允许合同：与 package.json 的 bundle:tauri 完全一致
// （pnpm --filter @mindmap/desktop tauri build --bundles app），拒绝 wrapper、
// fake command、默认全 bundle、dmg target 与 CI 绕过。
const PRODUCTION_BUILD_COMMANDS = [
  ["pnpm", "--filter", "@mindmap/desktop", "tauri", "build", "--bundles", "app"],
  ["pnpm", "tauri", "build", "--bundles", "app"],
];

function gateBlocked(message) {
  console.error(`bundle-gate: BLOCKED — ${message}`);
  process.exit(1);
}

function commandMatches(candidate, allowed) {
  return candidate.length === allowed.length && allowed.every((token, i) => token === candidate[i]);
}

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
if (assembleDmg && workDirFlag === null) {
  // 默认唯一路径必须让操作者可见：日志单独一行给出本轮实际使用的工作树。
  console.log(`bundle-gate: 省略 --work-dir，本轮自动生成唯一任务根`);
  console.log(`bundle-gate: 默认唯一任务根: ${workDir}`);
}
if (assembleDmg && !workDir) {
  console.error(
    `bundle-gate: BLOCKED — --assemble-dmg 需要 --work-dir <repo-relative ${DMG_PRODUCTION_WORK_DIR_SHAPE}>`,
  );
  process.exit(1);
}

// ---------------- PRR-069C-R1：模式边界与注入隔离（先于 G2/git/build，无副作用） ----------------
if (IS_PRODUCTION) {
  for (const injectFlag of [
    "assembler-script",
    "assembler-tool-dir",
    "assembler-timeout-ms",
    "assembler-deadline-ms",
  ]) {
    if (flag(injectFlag) !== null) {
      gateBlocked(
        `正式仓库（canonical source root）禁止测试注入参数 --${injectFlag}；` +
          "正式装配只能使用 tracked assembler 与固定系统工具",
      );
    }
  }
  if (assembleDmg) {
    let safeWorkDirEarly;
    try {
      safeWorkDirEarly = validateDmgWorkDir({
        workDir,
        root: ROOT,
        isProduction: IS_PRODUCTION,
      });
      // R2-F1：任务根必须全新。gate 只读校验，绝不预先创建（创建归 assembler）。
      assertTaskRootAbsent(safeWorkDirEarly.taskRootAbs, safeWorkDirEarly.taskRootRel);
      assertWorkDirNotPreExisting(safeWorkDirEarly.abs, safeWorkDirEarly.rel);
    } catch (err) {
      gateBlocked(`work-dir 无效: ${err.message}`);
    }
    const commandAllowed = PRODUCTION_BUILD_COMMANDS.some((allowed) =>
      commandMatches(command, allowed),
    );
    if (!commandAllowed) {
      gateBlocked(
        `正式 build command 必须精确为 Tauri app-only（pnpm ... tauri build --bundles app），` +
          `拒绝: ${command.join(" ")}（不允许 dmg target、默认全 bundle、CI 绕过、wrapper 或 fake command）`,
      );
    }
  }
  // PRR-069C-R2：正式模式同样校验注入路径（此分支下注入参数已被上面拒绝，此处仅防御）。
} else {
  // fixture 模式：注入参数本身要做路径、symlink、canonical 与阈值安全检查。
  for (const [injectFlag, value] of [
    ["assembler-script", assemblerScript],
    ["assembler-tool-dir", assemblerToolDir],
  ]) {
    if (value === null) continue;
    try {
      validateInjectionPath({
        value,
        fieldName: `--${injectFlag}`,
        root: ROOT,
        canonicalRoot: CANONICAL_ROOT,
      });
    } catch (err) {
      gateBlocked(`--${injectFlag} 注入路径无效: ${err.message}`);
    }
  }
  // 提供 tool-dir 时，必须在 build 之前验证七项工具完整、合法可执行且位于 fixture 内；
  // 缺项或非法一律 BLOCKED，绝不回退真实系统工具。
  if (assemblerToolDir !== null) {
    try {
      validateInjectedToolSet({
        toolDirAbs: resolve(ROOT, assemblerToolDir),
        root: ROOT,
        canonicalRoot: CANONICAL_ROOT,
      });
    } catch (err) {
      gateBlocked(`--assembler-tool-dir 工具注入校验未通过: ${err.message}`);
    }
  }
  const injectedTimeout = assemblerTimeoutMs === null ? null : Number(assemblerTimeoutMs);
  const injectedDeadline = assemblerDeadlineMs === null ? null : Number(assemblerDeadlineMs);
  if (injectedTimeout !== null) {
    if (
      !Number.isSafeInteger(injectedTimeout) ||
      injectedTimeout <= 0 ||
      injectedTimeout > PROD_ASSEMBLER_TIMEOUT_MS
    ) {
      gateBlocked(`--assembler-timeout-ms 必须是不超过 ${PROD_ASSEMBLER_TIMEOUT_MS} 的正整数`);
    }
  }
  if (injectedDeadline !== null) {
    if (
      !Number.isSafeInteger(injectedDeadline) ||
      injectedDeadline <= 0 ||
      injectedDeadline > PROD_ASSEMBLER_DEADLINE_MS
    ) {
      gateBlocked(`--assembler-deadline-ms 必须是不超过 ${PROD_ASSEMBLER_DEADLINE_MS} 的正整数`);
    }
  }
  if (injectedTimeout !== null && injectedDeadline !== null && injectedDeadline < injectedTimeout) {
    gateBlocked("--assembler-deadline-ms 不得小于 --assembler-timeout-ms");
  }
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

// 2b. PRR-069C-R2：--assemble-dmg 的 work-dir 通用边界（正式白名单与 attempt 新鲜度合同
// 已在参数阶段拒绝；此处为两模式共用的结构性检查，全部先于 build 执行）。
// 拒绝中间层/末级/悬空 symlink、越界落点、候选产物与 G2 evidence 树，以及预存 work-dir。
if (assembleDmg) {
  let workDirEarly;
  try {
    workDirEarly = validateDmgWorkDir({ workDir, root: ROOT, isProduction: IS_PRODUCTION });
    // R2-F1：build 之前只读校验任务根不存在；build 本身不得写该任务树。
    assertTaskRootAbsent(workDirEarly.taskRootAbs, workDirEarly.taskRootRel);
    assertWorkDirNotPreExisting(workDirEarly.abs, workDirEarly.rel);
  } catch (err) {
    gateBlocked(`work-dir 无效: ${err.message}`);
  }
  try {
    assertWorkDirLandingOutside({
      workDirAbs: workDirEarly.abs,
      landing: workDirEarly.landing,
      label: "G2 evidence 输出目录",
      forbiddenAbsPaths: validated.normalized.evidenceOutputPaths.map((p) => resolve(ROOT, p)),
    });
    assertWorkDirLandingOutside({
      workDirAbs: workDirEarly.abs,
      landing: workDirEarly.landing,
      label: "候选产物目录",
      forbiddenAbsPaths: validated.normalized.candidateOutputPaths
        .filter((p) => p.endsWith(".dmg"))
        .map((p) => dirname(resolve(ROOT, p))),
    });
  } catch (err) {
    gateBlocked(err.message);
  }
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
  // PRR-069C-R1：正式模式必须使用 tracked scripts/quality/assemble-dmg.mjs；
  // fixture 注入已在参数阶段做过路径安全检查。正式 inventory 的 source 归因
  // 绑定 canonical tracked 文件，而不是“被注入文件的 hash 与自身一致”。
  if (IS_PRODUCTION && assemblerPath !== ASSEMBLER_PATH) {
    gateBlocked(`正式装配必须使用 tracked assembler: ${relative(ROOT, ASSEMBLER_PATH)}`);
  }
  if (IS_PRODUCTION) {
    const trackedAssembler = execFileSync(
      "git",
      ["ls-files", "--", relative(CANONICAL_ROOT, ASSEMBLER_PATH)],
      { cwd: ROOT, encoding: "utf8" },
    ).trim();
    if (trackedAssembler !== relative(CANONICAL_ROOT, ASSEMBLER_PATH)) {
      gateBlocked("正式 assembler 必须是 git tracked 文件（未被跟踪的实现不可归因）");
    }
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
  const assemblerBudgetMs = Number(assemblerDeadlineMs ?? PROD_ASSEMBLER_DEADLINE_MS);
  // PRR-069C-R2：父进程终止策略必须容纳 assembler 声明的有界清理宽限，否则会在
  // 失败回收挂载的过程中把子进程杀掉，留下无人接管的挂载。
  const assemblerResult = spawnSync(process.execPath, assemblerArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: assemblerBudgetMs + DMG_CLEANUP_GRACE_MS + 30000,
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
  // PRR-069C-R1：时间预算先于其他形状检查——任何模式都不得超过固定上限；
  // 正式模式必须精确等于 120000/180000（防止放宽阈值后继续产出 PASS 证据）。
  if (
    !Number.isSafeInteger(dmgAssembly?.timeoutMs) ||
    !Number.isSafeInteger(dmgAssembly?.deadlineMs) ||
    dmgAssembly.timeoutMs > PROD_ASSEMBLER_TIMEOUT_MS ||
    dmgAssembly.deadlineMs > PROD_ASSEMBLER_DEADLINE_MS ||
    dmgAssembly.deadlineMs < dmgAssembly.timeoutMs
  ) {
    console.error(
      `bundle-gate: FAIL — assemble-dmg 报告时间阈值超出固定预算（timeoutMs/deadlineMs 必须 ≤` +
        `${PROD_ASSEMBLER_TIMEOUT_MS}/${PROD_ASSEMBLER_DEADLINE_MS}，正式必须精确等于这两个值），` +
        `实际 timeoutMs=${dmgAssembly?.timeoutMs}, deadlineMs=${dmgAssembly?.deadlineMs}`,
    );
    process.exit(1);
  }
  if (
    IS_PRODUCTION &&
    (dmgAssembly?.timeoutMs !== PROD_ASSEMBLER_TIMEOUT_MS ||
      dmgAssembly?.deadlineMs !== PROD_ASSEMBLER_DEADLINE_MS)
  ) {
    console.error(
      `bundle-gate: FAIL — 正式装配报告必须精确 timeoutMs=${PROD_ASSEMBLER_TIMEOUT_MS}/deadlineMs=${PROD_ASSEMBLER_DEADLINE_MS}，` +
        `实际 timeoutMs=${dmgAssembly?.timeoutMs}, deadlineMs=${dmgAssembly?.deadlineMs}`,
    );
    process.exit(1);
  }
  // PRR-069C-R1：工具清单绑定。fixture 模式只验形状；正式模式逐项核对
  // SYSTEM_TOOL_PATHS 的路径与 gate 自行重算的文件 hash，不采信报告自述。
  const reportedTools = dmgAssembly?.tools;
  const toolNames = [...DMG_TOOL_NAMES].sort().join(",");
  const toolsShapeValid =
    reportedTools &&
    typeof reportedTools === "object" &&
    Object.keys(reportedTools).sort().join(",") === toolNames &&
    Object.values(reportedTools).every(
      (entry) => typeof entry?.path === "string" && /^[0-9a-f]{64}$/.test(entry?.sha256 ?? ""),
    );
  if (!toolsShapeValid) {
    console.error(
      `bundle-gate: FAIL — assemble-dmg 报告缺少固定工具清单（预期工具: ${toolNames}）`,
    );
    process.exit(1);
  }
  if (IS_PRODUCTION) {
    for (const [toolName, expectedPath] of Object.entries(SYSTEM_TOOL_PATHS)) {
      const entry = reportedTools[toolName];
      if (entry.path !== expectedPath) {
        console.error(
          `bundle-gate: FAIL — 正式装配工具路径与固定清单不符: ${toolName} 报告 ${entry.path}，预期 ${expectedPath}`,
        );
        process.exit(1);
      }
      let recomputedSha;
      try {
        recomputedSha = computeFileSha256(expectedPath);
      } catch (err) {
        console.error(
          `bundle-gate: FAIL — 无法重算系统工具 hash（工具缺失即 fail-closed）: ${expectedPath}: ${err.message}`,
        );
        process.exit(1);
      }
      if (entry.sha256 !== recomputedSha) {
        console.error(
          `bundle-gate: FAIL — 正式装配工具 hash 与 gate 重算不一致: ${toolName} (${expectedPath})`,
        );
        process.exit(1);
      }
    }
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
