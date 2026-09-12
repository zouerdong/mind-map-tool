// assemble-dmg.mjs — 无 Finder 依赖的确定性 macOS DMG 装配（PRR-069C / ADR 0013 v1.1.0）。
//
// 职责单一：把本轮刚构建的 unsigned `.app` 用 macOS 自带系统工具装配成最终 ULMO DMG。
// 装配链（全部为参数数组调用，不经过 shell）：
//   ditto  → staging（同源 .app + Applications -> /Applications + .VolumeIcon.icns）
//   hdiutil create UDRW（HFS+，-nospotlight）→ attach RW → SetFile -a C（卷图标属性）
//   → 受控清除 .fseventsd → detach → hdiutil convert ULMO
//   → hdiutil udifrez 注入根 LICENSE 生成的挂载前 EULA resource
//   → verify/imageinfo/只读挂载复核 → rename 到批准输出路径
//
// 正式路径不启动 Finder，不调用 AppleScript/osascript，不使用 --ci/--skip-jenkins，
// 不读取、生成、复制或等待 .DS_Store；`.app` 内含 .DS_Store 时直接失败。
// 每个子进程有显式超时，整轮有 deadline；失败只清理由本轮创建且位于本运行目录内的资源。
//
// PRR-069C-R2-F1 加固：
//   - 进程结果与业务语义分离：超时/信号/spawn error/无退出码都是执行失败，绝不是
//     "用户拒绝 EULA"；挂载前 EULA 探针只接受「正常结束 + 非零 + 无挂载 + 目录空 +
//     marker 匹配」，marker 已输出也不能挽救进程异常。
//   - 单一清理截止时间：装配预算与失败清理宽限各只持有一个单调时钟截止时间，
//     mount 查询 / detach / 清理后复核共享同一个 context；预算耗尽即不启动子进程，
//     耗时按单调时钟真实记录（清理未开始才是 0）。
//   - 任务根由本轮原子创建：正式工作树固定为 `.tmp/prr-069c-<run-id>/work`，
//     `.tmp/` 下这一直接子目录必须不存在并由本进程非递归 mkdir 建立（EEXIST 即失败），
//     不复用历史任务树、日志与工作树分离。
//
// PRR-069C-R2 加固：
//   - attach 生命周期：子进程启动前登记 pending exact mountpoint；正常/非零/超时/
//     signal/spawn error 一律先按 mount table 复核真实挂载状态，已挂载立即接管，
//     已挂载但 attach 失败先受控卸载再失败；清理用独立有界宽限，不占用装配预算。
//   - 工具注入闭合：提供 --tool-dir 时先校验七项工具完整合法，缺项绝不回退真实工具。
//   - work-dir 逐分量校验：拒绝中间层/末级/悬空 symlink、越界落点与历史 attempt 借用。
//   - 固定工具常量与注入/work-dir 契约移入 dmg-assembly-contract.mjs。
//
// PRR-069C-R1 加固：
//   - 正式模式（--root 即 runner 所在 canonical 仓库）拒绝 --tool-dir 与显式
//     timeout/deadline 覆盖；任何模式的阈值都不得超过 120000/180000ms。
//   - 正式 work-dir 只允许 .tmp/prr-069c-<非空> 任务目录；任何模式都拒绝
//     evidence 输出目录、符号链接与预存外来目标。
//   - attach 生命周期统一状态机：attach 返回 0 后先登记（stdout 可解析，否则从
//     mount table 精确恢复；都无法确认即 STOP），卸载只有 detach 退出 0 且表内
//     无 exact 挂载点/设备时才清空登记；mount table 查询失败 fail-closed 并输出
//     结构化证据，残留时明确 RESIDUAL_MOUNT 并保留现场。
//   - 报告绑定固定工具清单（path+sha256），供 bundle gate 在正式模式逐项复核。
//
// 用法：node assemble-dmg.mjs --app <repo-rel .app> --output <repo-rel .dmg>
//           --work-dir <repo-rel .tmp/...> --after <UTC ISO> --format ULMO
//           [--scope-from <register>] [--icon <repo-rel .icns>] [--license <repo-rel file>]
//           [--volume-name <name>] [--timeout-ms <n>] [--deadline-ms <n>]
//           [--root <repo>] [--tool-dir <dir>] [--report <repo-rel .json>]
// --root/--tool-dir 是复算与测试注入入口，只在非 canonical 的合成 fixture root 内合法。

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeArtifactSha256,
  computeFileSha256,
  isSameOrDescendant,
  loadAndValidateG2Scope,
  validateSafePath,
} from "./g2-scope.mjs";
import {
  SYSTEM_TOOL_PATHS,
  DMG_TOOL_NAMES,
  DMG_CLEANUP_GRACE_MS,
  DMG_CLEANUP_GRACE_ENV,
  validateInjectionPath,
  validateInjectedToolSet,
  validateDmgWorkDir,
  assertWorkDirLandingOutside,
  assertWorkDirNotPreExisting,
  assertTaskRootAbsent,
  createTaskRootAtomically,
  classifyProcessResult,
} from "./dmg-assembly-contract.mjs";
import { createBudgetContext, splitRunTimings, timeoutFor, remainingMs } from "./dmg-budget.mjs";
import { RELEASE_BUDGETS } from "./release-budgets.mjs";
import {
  buildLicenseResourceXmlFromFile,
  extractEulaTextFromRezXml,
  imageInfoDeclaresLicenseAgreement,
  sha256,
} from "./eula-resource.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const FORMAT = "ULMO";
const DS_STORE = ".DS_Store";
const VOLUME_ICON = ".VolumeIcon.icns";
const APPLICATIONS_LINK = "Applications";
const APPLICATIONS_TARGET = "/Applications";
// .fseventsd 是系统在可写卷挂载期间创建的日志目录。Apple 文档的 no_log 开关让 fseventsd
// 不在本卷写日志；随后在挂载中删除该目录（与 Tauri bundle_dmg.sh 同意图，但改为确定性等待），
// 保证镜像卷根只包含预期条目。等待是有界固定值，不是重试到成功。
const FSEVENTSD = ".fseventsd";
const FSEVENTSD_SETTLE_MS = 1_000;
const FSEVENTSD_CONFIRM_MS = 400;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_DEADLINE_MS = 180_000;
// PRR-069C-R1：单命令超时与整轮 deadline 的不可放宽上限（正式值即默认值）。
const MAX_TIMEOUT_MS = 120_000;
const MAX_DEADLINE_MS = 180_000;
// PRR-069C-R2-F1：fixture 专用的清理宽限缩短入口（正式模式设置即 fail-closed）。

const TOOLS = SYSTEM_TOOL_PATHS;

/** 规范化到真实路径（无符号链接别名），用于正式/fixture 模式判定。 */
function toRealPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}

const ROOT = flag("root") ? resolve(flag("root")) : resolve(HERE, "../..");
// PRR-069C-R1：canonical source root 由 runner 文件自身位置决定（与 --root 无关）。
// 正式模式 = ROOT 与 canonical root 为同一真实目录；--root 指向合成 fixture root
// 时才允许测试注入（--tool-dir / 显式阈值覆盖）。
const CANONICAL_ROOT = resolve(HERE, "../..");
const IS_PRODUCTION = toRealPath(ROOT) === toRealPath(CANONICAL_ROOT);
const appRelFlag = flag("app");
const outputRelFlag = flag("output");
const workDirFlag = flag("work-dir");
const afterFlag = flag("after");
const format = flag("format");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const iconRelFlag = flag("icon") ?? "apps/desktop/src-tauri/icons/icon.icns";
const licenseRelFlag = flag("license") ?? "LICENSE";
const volumeNameFlag = flag("volume-name");
const timeoutMs = Number(flag("timeout-ms") ?? DEFAULT_TIMEOUT_MS);
const deadlineMs = Number(flag("deadline-ms") ?? DEFAULT_DEADLINE_MS);
const timeoutFlagExplicit = args.includes("--timeout-ms");
const deadlineFlagExplicit = args.includes("--deadline-ms");
const reportOutput = flag("report");
const toolDirFlag = flag("tool-dir");

const commandLog = [];
const assemblyStartedMs = Date.now();
let activeRunDir = null;
let runDirRel = null;
let mountedDevice = null;
let mountedAt = null;
let cleaningUp = false;
let currentStage = "args";
// PRR-069C-R1：卸载无法被证明干净时保留的结构化残留记录（进入失败报告）。
let residualMount = null;
// PRR-069C-R2：本轮 attach 的挂载点责任登记。在任何 attach 子进程启动前写入，
// 不等待 exit 0 —— 系统工具可能已经建立挂载之后才超时/失败/被杀。
let pendingMount = null;
// 挂载状态分类：CLEAN（可证明无残留）/ RESIDUAL（已确认残留）/ UNKNOWN（无法确认）。
let mountState = "CLEAN";
// PRR-069C-R2-F1：两段预算各只有一个单调时钟截止时间。
//   assemblyCtx —— 装配流程（含正常路径的 mount 查询与 detach），上限 deadlineMs；
//   cleanupCtx  —— 首次失败清理时惰性创建，此后永不重置，上限清理宽限。
// 两者不得混用：正常流程不会"借用"清理宽限，清理也不会重新拿到完整的装配预算。
const assemblyCtx = createBudgetContext({
  budgetMs: deadlineMs,
  label: "assembly",
});
let cleanupCtx = null;
let cleanupStatus = "CLEAN";
let cleanupAttempts = [];

// 清理宽限（毫秒）：正式固定 DMG_CLEANUP_GRACE_MS。先落默认值再应用 fixture 覆盖，
// 这样即使覆盖值非法、fail() 在覆盖校验阶段被触发，失败记录仍能完整序列化。
let cleanupGraceMs = DMG_CLEANUP_GRACE_MS;
cleanupGraceMs = resolveCleanupGraceMs();

/**
 * 失败清理上下文：首次进入清理时创建，包含它的第一次 mount 查询；
 * 同一轮内不得重建或重置（否则"再次 detach / 复核失败"会变成新的 60 秒）。
 */
function cleanupBudget() {
  if (cleanupCtx === null) {
    cleanupCtx = createBudgetContext({ budgetMs: cleanupGraceMs, label: "cleanup" });
  }
  return cleanupCtx;
}

/** 清理阶段可用的预算上下文：失败接管与清理一律用 cleanup，正常流程用 assembly。 */
function budgetContext(kind) {
  return kind === "cleanup" ? cleanupBudget() : assemblyCtx;
}

/**
 * 正式装配的清理宽限是固定预算，不得放宽。fixture（合成 root）允许用环境变量缩短，
 * 以便在不真实等待 60 秒的前提下验证"预算耗尽即不启动子进程"；正式模式设置即失败。
 */
function resolveCleanupGraceMs() {
  const raw = process.env[DMG_CLEANUP_GRACE_ENV];
  if (!raw) return DMG_CLEANUP_GRACE_MS;
  if (IS_PRODUCTION) {
    fail(
      `正式模式禁止覆盖清理宽限（固定 ${DMG_CLEANUP_GRACE_MS}ms，不得放大或调小）: ${DMG_CLEANUP_GRACE_ENV}`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value >= DMG_CLEANUP_GRACE_MS) {
    fail(`${DMG_CLEANUP_GRACE_ENV} 必须是小于 ${DMG_CLEANUP_GRACE_MS} 的正整数：${raw}`);
  }
  return value;
}
// 校验通过的注入工具集合（fixture 模式）；非空时 resolveTool 只认注入目录，绝不回退。
let injectedTools = null;

/**
 * fail-closed：解除本轮挂载（仅在设备匹配时）、保留本轮运行目录供复算，
 * 并输出单行结构化失败记录（含命令日志与超时标记）。
 */
function fail(message) {
  console.error(`assemble-dmg: FAIL — ${message}`);
  if (!cleaningUp) {
    cleaningUp = true;
    cleanupOnFailure();
  }
  // 序列化时才取真实终值：清理未开始才是 0，UNKNOWN 也必须记录已花费时间。
  const timings = splitRunTimings(assemblyCtx, cleanupCtx);
  const record = {
    status: "failed",
    runner: "assemble-dmg.mjs",
    runnerSha256: safeRunnerSha(),
    stage: currentStage,
    error: message,
    startedAt: new Date(assemblyStartedMs).toISOString(),
    finishedAt: new Date().toISOString(),
    // 总耗时 = 装配段 + 清理段（同一单调时钟基准），由两段现算得出。
    elapsedMs: timings.totalElapsedMs,
    // 装配预算固定值：失败记录同样声明，证明清理宽限没有放宽或顶替装配预算。
    timeoutMs,
    deadlineMs,
    timings: {
      ...timings,
      cleanupGraceMs,
      cleanupStarted: cleanupCtx !== null,
      cleanupStatus,
    },
    gitHead: safeGitHead(),
    workDir: runDirRel,
    preservedWorkDir: activeRunDir ? true : false,
    // PRR-069C-R1/R2：失败时刻的挂载责任登记、残留判定与清理结论（供独立复算）。
    pendingMount,
    activeMount: mountedAt ? { device: mountedDevice, mountpoint: mountedAt } : null,
    residualMount,
    mountState,
    cleanup: {
      graceMs: cleanupGraceMs,
      elapsedMs: timings.cleanupMs,
      status: cleanupStatus,
      attempts: cleanupAttempts,
    },
    commands: commandLog,
  };
  console.error(`assemble-dmg: FAILURE ${JSON.stringify(record)}`);
  process.exit(1);
}

function safeRunnerSha() {
  try {
    return computeFileSha256(RUNNER_PATH);
  } catch {
    return null;
  }
}

function safeGitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * 失败清理：只处理本运行目录内的资源；无法安全解除挂载时保留登记与现场并 STOP。
 * 登记只有在「detach 退出 0 且 mount table 复核不再包含 exact 挂载点/设备」后才清空；
 * detach 失败、设备不匹配或无法复核时输出 RESIDUAL_MOUNT 并保留结构化记录。
 */
function cleanupOnFailure() {
  cleaningUp = true;
  const mountpoint = mountedAt ?? pendingMount?.mountpoint ?? null;
  const device = mountedDevice ?? pendingMount?.device ?? null;
  if (mountedAt && mountedDevice) {
    // 已确认归属的挂载：在同一个有界清理宽限内受控卸载并复核，不占用装配 deadline。
    const outcome = detachAndVerify({
      mountpoint,
      device,
      stage: "cleanup-on-failure",
      budget: "cleanup",
    });
    if (outcome === "CLEAN") {
      mountState = "CLEAN";
      cleanupStatus = "CLEAN";
      pendingMount = null;
      // 已证明无残留：此前因装配预算耗尽/复核失败留下的残留记录不再成立。
      residualMount = null;
    } else {
      mountState = outcome;
      cleanupStatus = outcome;
      residualMount = residualMount ?? {
        device,
        mountpoint,
        reason: `cleanup: 无法证明无残留（${outcome}）`,
      };
      console.error(
        `assemble-dmg: ${outcome === "UNKNOWN" ? "STOP" : "RESIDUAL_MOUNT"} — 失败清理未能证明挂载已解除` +
          `（${outcome}），保留 pending/active/residual 结构化证据与现场，等待人工检查: ` +
          `${device ?? "unknown-device"} ${mountpoint}`,
      );
    }
  } else if (mountpoint) {
    // attach 可能恰好用尽装配预算：此时正常对账无法启动，但清理宽限仍必须用于
    // exact mountpoint 的归属确认。确认属于本轮才接管并卸载；查不到则证明该挂载点
    // 当前不存在；表不可用时保持 UNKNOWN，绝不盲目卸载。
    const outcome = reconcilePendingMountDuringCleanup(mountpoint);
    mountState = outcome;
    cleanupStatus = outcome;
    if (outcome === "CLEAN") {
      residualMount = null;
    } else {
      residualMount = residualMount ?? {
        device,
        mountpoint,
        reason: `cleanup: pending 挂载归属确认/回收未能证明无残留（${outcome}）`,
      };
    }
  }
  // 失败时保留本轮运行目录（staging/临时镜像/命令日志现场），供独立复算；
  // 该目录只位于本卡授权的任务临时范围内，不会成为下一次装配的输入。
  if (activeRunDir) {
    console.error(`assemble-dmg: 失败现场保留在 ${relative(ROOT, activeRunDir)}（仅本轮创建）`);
  }
}

/**
 * 用唯一 cleanup context 接管尚未完成正常对账的 pending mount。
 * 该路径只负责确认与回收，不会把原装配失败转换为成功。
 */
function reconcilePendingMountDuringCleanup(mountpoint) {
  const ctx = cleanupBudget();
  const attempt = {
    stage: "cleanup-reconcile-pending",
    mountpoint,
    device: null,
    budget: ctx.label,
    startedAt: new Date().toISOString(),
  };
  let table;
  try {
    table = mountTable(ctx, "cleanup-reconcile-pending");
  } catch (err) {
    const exhausted =
      err instanceof MountTableUnavailable && err.evidence?.budgetExhausted === true;
    attempt.result = exhausted ? "RESIDUAL" : "UNKNOWN";
    attempt.reason = exhausted
      ? "清理预算耗尽，未能确认 pending 挂载归属"
      : "mount table 不可用，未能确认 pending 挂载归属";
    cleanupAttempts.push(attempt);
    console.error(
      `assemble-dmg: ${exhausted ? "RESIDUAL_MOUNT" : "STOP"} — ${attempt.reason}，` +
        `保留 pending 与现场等待人工检查: ${mountpoint}`,
    );
    return attempt.result;
  }

  const entry = findExactMountInLines(table, mountpoint);
  if (!entry) {
    attempt.result = "CLEAN";
    attempt.reason = "清理宽限内确认 exact mountpoint 不存在";
    cleanupAttempts.push(attempt);
    pendingMount = null;
    return "CLEAN";
  }

  mountedDevice = entry.device;
  mountedAt = mountpoint;
  pendingMount = null;
  attempt.device = entry.device;
  attempt.result = "ACTIVE_CONFIRMED";
  attempt.reason = "清理宽限内确认 pending 挂载属于本轮，转 active 后受控卸载";
  cleanupAttempts.push(attempt);
  return detachAndVerify({
    mountpoint,
    device: entry.device,
    stage: "cleanup-pending-detach",
    budget: "cleanup",
  });
}

/** mount table 查询不可用（spawn 异常/超时/非零退出）时的结构化证据。 */
class MountTableUnavailable extends Error {
  constructor(evidence) {
    super("mount table unavailable");
    this.evidence = evidence;
  }
}

/**
 * 读取 mount table。任何失败（timeout、spawn error、非零退出）都抛出携带结构化
 * 证据的 MountTableUnavailable，绝不把空输出解释为“没有挂载”。
 * 超时由传入的预算上下文决定：命令上限 30s 与「该上下文剩余预算」取较小者，
 * 因此失败清理里的前查询/后查询会共享同一个 60 秒宽限，而不是各自拿满 30 秒。
 * 剩余预算 ≤0 时不启动子进程（Node 的 timeout=0 表示不设超时，绝不能传 0）。
 */
function mountTable(ctx, stage = "mount-table") {
  const tool = resolveTool("mount");
  const timeout = timeoutFor(ctx, Math.min(30_000, timeoutMs));
  const baseLog = { tool: "mount", path: tool, args: [], note: stage, budget: ctx.label };
  if (timeout <= 0) {
    const now = new Date().toISOString();
    commandLog.push({
      ...baseLog,
      startedAt: now,
      finishedAt: now,
      timeoutMs: 0,
      status: null,
      signal: null,
      timedOut: false,
      spawnError: null,
      skipped: `${ctx.label}-budget-exhausted`,
    });
    throw new MountTableUnavailable({
      tool: "mount",
      path: tool,
      startedAt: now,
      finishedAt: now,
      timeoutMs: 0,
      status: null,
      signal: null,
      timedOut: false,
      spawnError: null,
      budgetExhausted: true,
      budget: ctx.label,
      remainingMs: remainingMs(ctx),
      stdout: "",
      stderr: "",
    });
  }
  const startedAt = new Date().toISOString();
  const r = spawnSync(tool, [], {
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timedOut = Boolean(r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL");
  const spawnError = r.error ? String(r.error.message) : null;
  commandLog.push({
    ...baseLog,
    startedAt,
    finishedAt: new Date().toISOString(),
    timeoutMs: timeout,
    status: r.status ?? null,
    signal: r.signal ?? null,
    timedOut,
    spawnError,
  });
  if (r.error || (r.status ?? 1) !== 0) {
    throw new MountTableUnavailable({
      tool: "mount",
      path: tool,
      startedAt,
      finishedAt: new Date().toISOString(),
      timeoutMs: timeout,
      status: r.status ?? null,
      signal: r.signal ?? null,
      timedOut,
      spawnError,
      budgetExhausted: false,
      budget: ctx.label,
      remainingMs: remainingMs(ctx),
      stdout: (r.stdout ?? "").slice(0, 400),
      stderr: (r.stderr ?? "").slice(0, 400),
    });
  }
  return (r.stdout ?? "").split("\n").filter((l) => l.trim().length > 0);
}

/** 在主流程中使用 mount table（装配预算）：不可用时以结构化证据 fail（STOP 语义）。 */
function requireMountTable(stage) {
  try {
    return mountTable(assemblyCtx, stage);
  } catch (err) {
    const evidence =
      err instanceof MountTableUnavailable ? JSON.stringify(err.evidence) : String(err);
    const cause =
      err instanceof MountTableUnavailable && err.evidence?.budgetExhausted
        ? `装配预算（${assemblyCtx.label}）已耗尽，不得启动子进程`
        : "退出码/超时/spawn 异常";
    fail(
      `${stage}: mount table 不可用（${cause}），不得把空输出解释为无挂载，STOP 保留真实现场: ${evidence}`,
    );
  }
}

/**
 * PRR-069C-R2：统一 attach 生命周期。启动子进程之前先登记本轮拥有的 pending exact
 * mountpoint（不等 exit 0 才记责任），随后无论正常 / 非零 / timeout / signal / spawn error，
 * 都以 mount table 复核真实挂载状态，再决定语义。
 *
 * PRR-069C-R2-F1：把「进程结果」与「业务语义」彻底分开，顺序固定为
 *   1. 接管——只要 mount table 里出现本挂载点，立即登记为 active mount（先管资源）；
 *   2. 探针意外挂载——EULA 拒绝探针建立挂载即失败，无论退出码，先受控回收再失败；
 *   3. 进程异常——超时/信号/spawn error/无退出码一律失败，marker 已输出也不能挽救；
 *   4. 正常结束才谈语义——mount 意图要求 exit 0 且已挂载；EULA 探针要求 exit 非零
 *      且无挂载（目录空与 marker 匹配由调用点继续校验）。
 * mount table 不可用时由 requireMountTable fail-closed，转入有界清理宽限。
 * intent 只有两种取值："mount"（必须挂载成功）与 "eula-probe"（必须是正常拒绝）。
 */
function attachVolume({ mountpoint, cmdArgs, input, note, stage, intent = "mount" }) {
  const probing = intent === "eula-probe";
  const requireSuccess = !probing;
  pendingMount = { mountpoint, stage, startedAt: new Date().toISOString() };
  const result = runTool("hdiutil", cmdArgs, { must: false, input, note });
  const table = requireMountTable(`${stage}-mount-table-check`);
  const parsed = parseAttachOutput(result.stdout, mountpoint);
  const entry = findExactMountInLines(table, mountpoint);
  const execution = classifyProcessResult(result);

  // 1. 接管：先按 mount table 复核真实挂载状态，再谈退出码。
  if (entry) {
    mountedDevice = entry.device;
    mountedAt = mountpoint;
    pendingMount = null;
    if (!parsed) {
      const lastCommand = commandLog[commandLog.length - 1];
      if (lastCommand) lastCommand.recoveredFromMountTable = true;
      console.error(
        `assemble-dmg: attach stdout 不可解析，已从 mount table 恢复挂载登记: ${entry.device} ${mountpoint}`,
      );
    }
  } else {
    pendingMount = null;
  }

  // 2. EULA 拒绝探针意外建立挂载：无论退出码如何，先受控回收再失败。
  if (probing && mountedAt) {
    const outcome = detachAndVerify({
      mountpoint,
      device: mountedDevice,
      stage: `${stage}-recovery`,
      budget: "cleanup",
    });
    recordCleanupOutcome(outcome, mountedDevice, mountpoint, `${stage}: 探针意外挂载后卸载`);
    fail(
      "未同意 EULA 时 hdiutil attach 仍然成功挂载" +
        (outcome === "CLEAN"
          ? "（已受控卸载并复核 mount table 无残留）"
          : `（尝试卸载但未能证明无残留：${outcome}，见上方 RESIDUAL_MOUNT/STOP 记录）`) +
        "，挂载前 EULA 未生效",
    );
  }

  // 3. 进程异常：不是"用户拒绝"，也不是"没有挂载"，必须失败。
  if (execution) {
    if (mountedAt) {
      const outcome = detachAndVerify({
        mountpoint,
        device: mountedDevice,
        stage: `${stage}-failed-attach-recovery`,
        budget: "cleanup",
      });
      recordCleanupOutcome(outcome, mountedDevice, mountpoint, `${stage}: attach 异常后卸载`);
      fail(
        `${stage}: ${describeAttachFailure(result)}（${execution.code}），但挂载已建立；` +
          (outcome === "CLEAN"
            ? "已受控卸载并复核 mount table 无残留"
            : `尝试卸载但未能证明无残留（${outcome}，见上方 RESIDUAL_MOUNT/STOP 记录）`) +
          "，整体判定失败（不得把超时或非零退出转成成功）",
      );
    }
    fail(
      `${stage}: attach 进程异常（${execution.reason}），未建立挂载；` +
        "进程异常不接受作为 EULA 拒绝证据，也不得进入最终挂载，整体判定失败",
    );
  }

  // 4. 正常结束才谈业务语义。
  // 挂载意图：必须 exit 0 且已挂载；"已挂载但退出码非零"同样不是成功，先回收再失败。
  if (!probing && mountedAt && result.status !== 0) {
    const outcome = detachAndVerify({
      mountpoint,
      device: mountedDevice,
      stage: `${stage}-failed-attach-recovery`,
      budget: "cleanup",
    });
    recordCleanupOutcome(outcome, mountedDevice, mountpoint, `${stage}: attach 非零退出后卸载`);
    fail(
      `${stage}: ${describeAttachFailure(result)}，但挂载已建立；` +
        (outcome === "CLEAN"
          ? "已受控卸载并复核 mount table 无残留"
          : `尝试卸载但未能证明无残留（${outcome}，见上方 RESIDUAL_MOUNT/STOP 记录）`) +
        "，整体判定失败（不得把超时或非零退出转成成功）",
    );
  }
  // 未挂载却声称成功是状态矛盾，绝不能被当成"没有挂载"。
  if (!mountedAt && result.status === 0) {
    fail(
      `${stage}: attach 返回 0 但 stdout ${parsed ? "声称挂载而 mount table 无该挂载点" : "不可解析且 mount table 无该挂载点"}，` +
        "无法确认挂载状态，STOP 保留真实现场",
    );
  }
  if (probing) {
    // 到这里必然 正常结束 + 非零退出 + 无挂载（挂载与异常分支已在前面处理）。
    return { ...result, ok: true, mounted: false, device: null, mountpoint, refused: true };
  }
  if (mountedAt) {
    return { ...result, ok: true, mounted: true, device: mountedDevice, mountpoint };
  }
  fail(`${stage}: ${describeAttachFailure(result)}`);
}

/** 记录一次受控卸载的结论（CLEAN 视为已回收；其余保留残留证据，绝不写成已清理）。 */
function recordCleanupOutcome(outcome, device, mountpoint, reason) {
  if (outcome === "CLEAN") {
    mountState = "CLEAN";
    cleanupStatus = "CLEAN";
    return;
  }
  mountState = outcome;
  cleanupStatus = outcome;
  residualMount = residualMount ?? {
    device,
    mountpoint,
    reason: `${reason}未证明无残留（${outcome}）`,
  };
}

/** attach 结果的结构化失败分类（spawn error / 超时 / signal / 非零退出）。 */
function describeAttachFailure(result) {
  if (result.spawnError) return `attach 无法启动（spawn error ${result.spawnError}）`;
  if (result.timedOut) return `attach 超时（${result.timeoutMs ?? timeoutMs}ms）`;
  if (result.signal) return `attach 被信号终止 (${result.signal})`;
  return `attach 退出码非零 (${result.status})：${String(result.out ?? "")
    .trim()
    .slice(0, 300)}`;
}

/** 从 mount table 行集合中精确解析 expectedMountpoint 的设备条目（严格 `on <mp> (` 匹配）。 */
function findExactMountInLines(table, expectedMountpoint) {
  for (const rawLine of table) {
    const line = rawLine.trim();
    const device = line.split(/\s+/)[0];
    if (!/^\/dev\/disk\d*(s\d+)?$/.test(device)) continue;
    const rest = line.slice(device.length).trimStart();
    if (rest.startsWith(`on ${expectedMountpoint} (`)) {
      return { device, mountpoint: expectedMountpoint, line };
    }
  }
  return null;
}

/**
 * 受控卸载并复核：只有 detach 退出 0 且 mount table 复核不再包含 exact 挂载点/设备时才返回
 * CLEAN。返回 CLEAN / RESIDUAL / UNKNOWN，不抛异常、不递归 fail，正常路径与失败清理共用。
 * 不使用 force / sudo / 批量卸载。
 */
function detachAndVerify({ mountpoint, device, stage, budget = "assembly" }) {
  if (!mountpoint) return "CLEAN";
  const ctx = budgetContext(budget);
  const attempt = {
    stage,
    mountpoint,
    device: device ?? null,
    budget: ctx.label,
    startedAt: new Date().toISOString(),
  };

  // 卸载前置身份核对：只有能证明该挂载点/设备属于本轮时才执行 detach。
  // 归属无法证明（表不可读）或设备不匹配时一律不卸载，保留 pending/active/residual 证据。
  // 预算耗尽与"表不可读"必须区分：前者责任明确（本轮登记仍在），后者才是状态未知。
  if (device) {
    let pre;
    try {
      pre = mountTable(ctx, `${stage}-pre-detach`);
    } catch (err) {
      const exhausted =
        err instanceof MountTableUnavailable && err.evidence?.budgetExhausted === true;
      const evidence =
        err instanceof MountTableUnavailable ? JSON.stringify(err.evidence) : String(err);
      attempt.result = exhausted ? "RESIDUAL" : "UNKNOWN";
      attempt.reason = exhausted
        ? `卸载前预算（${ctx.label}）已耗尽，未启动 mount 查询`
        : "卸载前 mount table 不可用，无法证明归属";
      cleanupAttempts.push(attempt);
      console.error(
        `assemble-dmg: ${exhausted ? "RESIDUAL_MOUNT" : "STOP"} — ${stage}: ` +
          (exhausted
            ? `清理预算（${ctx.label}）已耗尽，未执行归属复核与卸载，挂载登记保留: ${mountpoint}`
            : `卸载前 mount table 不可读，无法证明 ${mountpoint} 归属本轮，拒绝卸载并保留现场等待人工检查: ${evidence}`),
      );
      return attempt.result;
    }
    const preEntry = findExactMountInLines(pre, mountpoint);
    const preDeviceEntry = pre.find((line) => line.startsWith(`${device} `));
    if (!preEntry && !preDeviceEntry) {
      attempt.result = "CLEAN";
      attempt.reason = "卸载前 mount table 已无该挂载点/设备（无资源需要回收）";
      cleanupAttempts.push(attempt);
      mountedDevice = null;
      mountedAt = null;
      return "CLEAN";
    }
    if (preEntry && preEntry.device !== device) {
      attempt.result = "RESIDUAL";
      attempt.reason = `设备不匹配（预期 ${device}，实际 ${preEntry.device}）`;
      cleanupAttempts.push(attempt);
      console.error(
        `assemble-dmg: STOP — ${stage}: 挂载设备与预期不一致（预期 ${device}，实际 ${preEntry.device}），` +
          "拒绝卸载并保留现场等待人工检查",
      );
      return "RESIDUAL";
    }
  }

  const r = spawnDetach(mountpoint, { stage, budget });
  attempt.status = r.status;
  attempt.signal = r.signal;
  attempt.timedOut = r.timedOut;
  attempt.spawnError = r.spawnError;
  if (!r.spawned) {
    // 预算耗尽时责任是明确的（登记仍在、未被回收），不是状态未知。
    attempt.result = r.budgetExhausted ? "RESIDUAL" : "UNKNOWN";
    attempt.reason = r.reason ?? "detach 未能启动";
    cleanupAttempts.push(attempt);
    console.error(
      `assemble-dmg: ${r.budgetExhausted ? "RESIDUAL_MOUNT" : "STOP"} — ${stage}: detach 未启动（${attempt.reason}），` +
        `无法证明无残留，登记保留: ${mountpoint}`,
    );
    return attempt.result;
  }
  if ((r.status ?? 1) !== 0) {
    attempt.result = "RESIDUAL";
    attempt.reason = `detach 退出码 ${r.status}`;
    cleanupAttempts.push(attempt);
    console.error(
      `assemble-dmg: RESIDUAL_MOUNT — ${stage}: hdiutil detach ${mountpoint} 退出码 ${r.status}，active mount 登记保留（${device ?? "unknown-device"}）`,
    );
    return "RESIDUAL";
  }
  let table;
  try {
    table = mountTable(ctx, `${stage}-post-detach`);
  } catch (err) {
    const exhausted =
      err instanceof MountTableUnavailable && err.evidence?.budgetExhausted === true;
    const evidence =
      err instanceof MountTableUnavailable ? JSON.stringify(err.evidence) : String(err);
    attempt.result = "UNKNOWN";
    attempt.reason = exhausted
      ? `detach 后预算（${ctx.label}）已耗尽，未启动复核查询`
      : "detach 后 mount table 不可用";
    cleanupAttempts.push(attempt);
    console.error(
      `assemble-dmg: RESIDUAL_MOUNT — ${stage}: detach ${exhausted ? "后预算耗尽" : "成功但 mount table 不可读"}，` +
        `无法证明无残留，登记保留: ${exhausted ? attempt.reason : evidence}`,
    );
    return "UNKNOWN";
  }
  const entry = table.find(
    (line) =>
      line.includes(` on ${mountpoint} (`) || (device ? line.startsWith(`${device} `) : false),
  );
  if (entry) {
    attempt.result = "RESIDUAL";
    attempt.reason = `detach 后仍有残留 ${entry.trim()}`;
    cleanupAttempts.push(attempt);
    console.error(
      `assemble-dmg: RESIDUAL_MOUNT — ${stage}: detach 返回 0 但 mount table 仍有条目，登记保留: ${entry.trim()}`,
    );
    return "RESIDUAL";
  }
  attempt.result = "CLEAN";
  cleanupAttempts.push(attempt);
  mountedDevice = null;
  mountedAt = null;
  return "CLEAN";
}

/**
 * 有界 detach 子进程：参数数组、显式超时、按所选预算收紧。
 * 两个预算都只持有一个单调时钟截止时间：assembly 受整轮 deadline 约束
 * （用尽则转失败清理宽限），cleanup 受独立宽限约束且被同一段清理内的
 * 前查询/后查询共同消耗。任一预算耗尽都不启动子进程（绝不把 0 当成"不设超时"）。
 */
function spawnDetach(mountpoint, { stage, budget }) {
  const ctx = budgetContext(budget);
  const tool = resolveTool("hdiutil");
  const detachArgs = ["detach", mountpoint];
  const baseLog = { tool: "hdiutil", path: tool, args: detachArgs, note: stage, budget: ctx.label };
  const perCommandTimeout = timeoutFor(ctx, timeoutMs);
  if (perCommandTimeout <= 0) {
    commandLog.push({
      ...baseLog,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      timeoutMs: 0,
      status: null,
      signal: null,
      timedOut: false,
      spawnError: null,
      skipped: `${ctx.label}-budget-exhausted`,
    });
    return {
      spawned: false,
      status: null,
      signal: null,
      timedOut: false,
      spawnError: null,
      budgetExhausted: true,
      reason:
        ctx.label === "cleanup"
          ? `清理宽限 ${cleanupGraceMs}ms 已用尽，不再启动 detach`
          : `装配 deadline ${deadlineMs}ms 已用尽（转失败清理宽限）`,
    };
  }
  const startedAt = new Date().toISOString();
  const r = spawnSync(tool, detachArgs, {
    encoding: "utf8",
    timeout: perCommandTimeout,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timedOut = r.error?.code === "ETIMEDOUT";
  const spawnError =
    r.error && !timedOut ? `${r.error.code ?? ""}: ${r.error.message}`.trim() : null;
  commandLog.push({
    ...baseLog,
    startedAt,
    finishedAt: new Date().toISOString(),
    timeoutMs: perCommandTimeout,
    status: r.status ?? null,
    signal: r.signal ?? null,
    timedOut: Boolean(timedOut),
    spawnError,
  });
  return {
    spawned: true,
    status: r.status ?? null,
    signal: r.signal ?? null,
    timedOut: Boolean(timedOut),
    spawnError,
  };
}

/**
 * 正常路径的受控卸载入口：先在装配预算内尝试，未证明干净时登记残留并返回 false。
 */
function controlledDetach(stage, budget = "assembly") {
  const mountpoint = mountedAt;
  const device = mountedDevice;
  if (!mountpoint) return true;
  const outcome = detachAndVerify({ mountpoint, device, stage, budget });
  if (outcome === "CLEAN") return true;
  mountState = outcome;
  cleanupStatus = outcome;
  residualMount = residualMount ?? {
    device,
    mountpoint,
    reason: `${stage}: 无法证明无残留（${outcome}）`,
  };
  return false;
}

/**
 * R2-02：工具解析。提供 --tool-dir 时只认校验通过的注入集合，缺项即拒绝，
 * 绝不回退 /usr/bin 等真实系统工具。
 */
function resolveTool(name) {
  if (toolDirFlag) {
    const injected = injectedTools?.[name];
    if (!injected) {
      fail(`工具注入缺少 ${name}：注入模式下回退真实系统工具被禁止（fail-closed）`);
    }
    return injected;
  }
  return TOOLS[name];
}

/**
 * 单次受控子进程调用：参数数组、显式超时、按装配预算剩余收紧、记录起止与结果。
 * 超时与非零退出由调用点决定语义（must=false 时只回报）。
 * status 一律保留原值（可能是 null）：分类信息不能被提前压成"普通非零码"。
 */
function runTool(name, cmdArgs, opts = {}) {
  const { must = true, input, note } = opts;
  const tool = resolveTool(name);
  const perCommandTimeout = timeoutFor(assemblyCtx, timeoutMs);
  if (perCommandTimeout <= 0) {
    fail(
      `超出装配 deadline（${deadlineMs}ms，剩余 ${Math.round(remainingMs(assemblyCtx))}ms），不得启动新子进程`,
    );
  }
  const startedAt = new Date().toISOString();
  const r = spawnSync(tool, cmdArgs, {
    encoding: "utf8",
    timeout: perCommandTimeout,
    killSignal: "SIGKILL",
    input,
    maxBuffer: 1 << 28,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const finishedAt = new Date().toISOString();
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  const spawnError =
    r.error && r.error.code !== "ETIMEDOUT"
      ? `${r.error.code ?? ""}: ${r.error.message}`.trim()
      : null;
  commandLog.push({
    tool: name,
    path: tool,
    args: cmdArgs,
    ...(note ? { note } : {}),
    startedAt,
    finishedAt,
    timeoutMs: perCommandTimeout,
    status: r.status ?? null,
    signal: r.signal ?? null,
    timedOut: Boolean(timedOut),
    spawnError,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (spawnError && must) {
    fail(`${name} 无法启动（spawn error ${spawnError}）`);
  }
  if (timedOut && must) {
    fail(`子进程超时（${name} ${cmdArgs.slice(0, 2).join(" ")}，${perCommandTimeout}ms）`);
  }
  if ((r.status ?? 1) !== 0 && must) {
    fail(
      `${name} ${cmdArgs.slice(0, 2).join(" ")} 退出码非零 (${r.status})：${out.trim().slice(0, 400)}`,
    );
  }
  return {
    // 保留 null：调用点需要据此区分"正常结束但退出码非零"与"进程从未正常结束"。
    status: r.status ?? null,
    signal: r.signal ?? null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    timedOut,
    spawnError,
    timeoutMs: perCommandTimeout,
    out,
  };
}

// ---------------------------------------------------------------- 1. 参数契约
if (!appRelFlag) fail("缺少 --app <repo-relative .app>");
if (!outputRelFlag) fail("缺少 --output <repo-relative .dmg>");
if (!workDirFlag) fail("缺少 --work-dir <repo-relative .tmp/... 工作目录>");
if (!afterFlag) fail("缺少 --after <UTC ISO>（本轮构建开始时间）");
if (!format) fail("缺少 --format（正式装配必须显式声明目标容器格式）");
if (format !== FORMAT) fail(`不允许的 DMG 目标格式: ${format}（受支持: ${FORMAT}）`);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(afterFlag)) {
  fail(`--after 必须是 UTC ISO（以 Z 结尾），不得把本地时间冒充 UTC: ${afterFlag}`);
}
const afterMs = Date.parse(afterFlag);
if (!Number.isFinite(afterMs)) fail(`--after 不是可解析的 UTC ISO 时间: ${afterFlag}`);
// PRR-069C-R1：正式模式（canonical source root）拒绝一切测试注入与阈值覆盖；
// 任何模式（含 fixture）都不得超出固定上限，防止把时间预算放大后继续产出证据。
if (IS_PRODUCTION && toolDirFlag) {
  fail("--tool-dir 是测试注入入口，正式仓库（canonical source root）禁止使用");
}
if (IS_PRODUCTION && (timeoutFlagExplicit || deadlineFlagExplicit)) {
  fail(
    "正式装配禁止覆盖 timeout/deadline（固定 timeout=120000ms / deadline=180000ms，不得放宽或调小）",
  );
}
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
  fail(`--timeout-ms 必须是不超过 ${MAX_TIMEOUT_MS} 的正整数（正式固定值 120000）`);
}
if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_DEADLINE_MS) {
  fail(`--deadline-ms 必须是不超过 ${MAX_DEADLINE_MS} 的正整数（正式固定值 180000）`);
}
if (deadlineMs < timeoutMs) fail("--deadline-ms 不得小于单命令 --timeout-ms");

// PRR-069C-R2：工具注入校验必须先于任何工具调用、工作目录写入与挂载。
// 正式模式已在上面拒绝 --tool-dir；fixture 模式下注入目录与其七项工具必须完整合法，
// 缺项 / 断链 / symlink / 类型错误 / 不可执行一律 fail-closed，绝不回退真实系统工具。
if (toolDirFlag) {
  try {
    const injection = validateInjectionPath({
      value: toolDirFlag,
      fieldName: "tool-dir",
      root: ROOT,
      canonicalRoot: CANONICAL_ROOT,
    });
    injectedTools = validateInjectedToolSet({
      toolDirAbs: injection.abs,
      root: ROOT,
      canonicalRoot: CANONICAL_ROOT,
    }).tools;
  } catch (err) {
    fail(`工具注入校验未通过: ${err.message}`);
  }
}

// ---------------------------------------------------------------- 2. 路径与 G2 授权
let appRel;
let outputRel;
let workDirRel;
let iconRel;
let licenseRel;
try {
  appRel = validateSafePath(appRelFlag, ROOT, "app");
  outputRel = validateSafePath(outputRelFlag, ROOT, "output");
  workDirRel = validateSafePath(workDirFlag, ROOT, "work-dir");
  iconRel = validateSafePath(iconRelFlag, ROOT, "icon");
  licenseRel = validateSafePath(licenseRelFlag, ROOT, "license");
} catch (err) {
  fail(err.message);
}
if (!appRel.endsWith(".app")) fail(`--app 必须是 .app 目录: ${appRel}`);
if (!outputRel.endsWith(".dmg")) fail(`--output 必须是 .dmg 文件: ${outputRel}`);
// PRR-069C-R2：work-dir 结构校验（正式白名单、任一分量 symlink、实际落点、
// 历史 attempt 借用）必须在任何 mkdir / 工具调用 / 挂载之前完成。
// R1 的「已存在但为空」不再接受：那正是借用历史 attempt 树复跑同一 work-dir 的入口。
let workDirPreAbs;
let workDirInfo;
try {
  workDirInfo = validateDmgWorkDir({
    workDir: workDirRel,
    root: ROOT,
    isProduction: IS_PRODUCTION,
  });
  workDirRel = workDirInfo.rel;
  workDirPreAbs = workDirInfo.abs;
  // R2-F1：正式任务根必须全新——这是"本轮拥有该工作树"的证明，必须在任何
  // G2 校验、mkdir、工具调用与挂载之前判定（创建动作在后面，且只由本进程执行）。
  // 先判任务根：它比"末级 work 是否已存在"更根本（历史上成功过、或只写过日志的
  // 任务根同样不能被这一轮接管）。
  assertTaskRootAbsent(workDirInfo.taskRootAbs, workDirInfo.taskRootRel);
  assertWorkDirNotPreExisting(workDirInfo.abs, workDirInfo.rel);
} catch (err) {
  fail(err.message);
}
if (isSameOrDescendant(dirname(outputRel), workDirRel)) {
  fail(`work-dir 不得位于候选产物目录内: ${workDirRel}`);
}

const appAbs = resolve(ROOT, appRel);
const outputAbs = resolve(ROOT, outputRel);
const iconAbs = resolve(ROOT, iconRel);
const licenseAbs = resolve(ROOT, licenseRel);

let validated;
try {
  validated = loadAndValidateG2Scope({
    scopeFrom,
    host: "tauri",
    action: "build",
    candidate: outputRel,
    repoRoot: ROOT,
  });
} catch (err) {
  fail(`G2 scope 校验未通过: ${err.message}`);
}
const approvedCandidates = validated.normalized.candidateOutputPaths;
if (!approvedCandidates.includes(outputRel)) {
  fail(`输出 .dmg 不在 G2 批准的 candidateOutputPaths 内: ${outputRel}`);
}
if (!approvedCandidates.includes(appRel)) {
  fail(`输入 .app 不在 G2 批准的 candidateOutputPaths 内: ${appRel}`);
}
// PRR-069C-R1：evidence 输出目录只读，work-dir 不得落入其任何子树。
if (
  validated.normalized.evidenceOutputPaths.some((evidencePath) =>
    isSameOrDescendant(resolve(ROOT, evidencePath), workDirPreAbs),
  )
) {
  fail(`work-dir 不得位于 G2 evidence 输出目录内（证据目录只读，不得成为工作区）: ${workDirRel}`);
}

// PRR-069C-R2：再用实际落点（最近已存在祖先的 realpath）核对一次，避免仅靠词法前缀。
try {
  assertWorkDirLandingOutside({
    workDirAbs: workDirPreAbs,
    label: "G2 evidence 输出目录",
    forbiddenAbsPaths: validated.normalized.evidenceOutputPaths.map((p) => resolve(ROOT, p)),
  });
  assertWorkDirLandingOutside({
    workDirAbs: workDirPreAbs,
    label: "候选产物目录",
    forbiddenAbsPaths: approvedCandidates
      .filter((p) => p.endsWith(".dmg"))
      .map((p) => dirname(resolve(ROOT, p))),
  });
} catch (err) {
  fail(err.message);
}

let reportRel = null;
let reportAbs = null;
if (reportOutput) {
  try {
    reportRel = validateSafePath(reportOutput, ROOT, "report");
  } catch (err) {
    fail(err.message);
  }
  reportAbs = resolve(ROOT, reportRel);
  const approved = validated.normalized.evidenceOutputPaths.some((evidencePath) =>
    isSameOrDescendant(resolve(ROOT, evidencePath), reportAbs),
  );
  if (!approved) fail(`report 路径不在 G2 批准的 evidenceOutputPaths 内: ${reportRel}`);
  // 证据不可覆盖：同一路径已有报告时拒绝重写，避免失败轮被后一轮覆盖。
  if (existsSync(reportAbs)) {
    fail(`report 已存在，拒绝覆盖既有证据: ${reportRel}`);
  }
}

// ---------------------------------------------------------------- 3. 输入判定
if (!existsSync(appAbs)) fail(`输入 .app 不存在: ${appRel}`);
if (lstatSync(appAbs).isSymbolicLink()) fail(`输入 .app 不能是符号链接: ${appRel}`);
if (!lstatSync(appAbs).isDirectory()) fail(`输入 .app 不是目录: ${appRel}`);
if (!existsSync(iconAbs) || !lstatSync(iconAbs).isFile()) fail(`卷图标不是常规文件: ${iconRel}`);
if (!existsSync(licenseAbs) || !lstatSync(licenseAbs).isFile()) {
  fail(`LICENSE 不是常规文件: ${licenseRel}`);
}
// “本轮刷新”按 .app 树内最新 mtime 判定（与 bundle-gate 的候选新鲜度口径一致）：
// 目录自身 mtime 只在增删条目时变化，不能代表本轮重写了 bundle 内容。
if (latestMtimeMs(appAbs) < afterMs) {
  fail(`.app 不是本轮构建刷新（最新 mtime 早于 --after），拒绝装配陈旧产物: ${appRel}`);
}
for (const rel of walkRelative(appAbs)) {
  if (basename(rel) === DS_STORE) {
    fail(`输入 .app 内含 ${DS_STORE}，拒绝读取/复制：${rel}`);
  }
}

const volumeName = volumeNameFlag ?? basename(appRel).replace(/\.app$/, "");
if (!volumeName || /[ -/]/.test(volumeName)) fail(`非法的卷名: ${volumeName}`);

// ---------------------------------------------------------------- 4. 运行目录
// PRR-069C-R2-F1：正式模式下任务根本轮由本进程独占创建（非递归 mkdir，EEXIST 即失败）——
// 这是"本轮拥有该工作树"的唯一证明，不依据已有目录内容或年龄推测归属。
// 创建发生在全部校验通过之后：被拒绝的运行不会留下任何任务根。
if (IS_PRODUCTION) {
  try {
    createTaskRootAtomically({
      taskRootAbs: workDirInfo.taskRootAbs,
      taskRootRel: workDirInfo.taskRootRel,
      parentAbs: resolve(ROOT, ".tmp"),
      parentRel: ".tmp",
    });
  } catch (err) {
    fail(err.message);
  }
}
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
runDirRel = `${workDirRel}/assemble-${runStamp}-${process.pid}`;
const runDirAbs = resolve(ROOT, runDirRel);
if (existsSync(runDirAbs)) fail(`本轮运行目录已存在（拒绝复用/覆盖）: ${runDirRel}`);
mkdirSync(runDirAbs, { recursive: true });
activeRunDir = runDirAbs;
const stagingAbs = join(runDirAbs, "staging");
const mntRwAbs = join(runDirAbs, "mnt-rw");
const mntFinalAbs = join(runDirAbs, "mnt-final");
const rwImageAbs = join(runDirAbs, "rw.dmg");
const tempDmgAbs = join(runDirAbs, `${basename(outputRel).replace(/\.dmg$/, "")}.assembly.tmp.dmg`);
const eulaXmlAbs = join(runDirAbs, "eula-resources.xml");
for (const dir of [stagingAbs, mntRwAbs, mntFinalAbs]) mkdirSync(dir, { recursive: true });

// PRR-069C-R1：固定工具清单绑定。正式模式下 TOOLS 即系统绝对路径；fixture 模式下
// 为注入目录内的替身。每个工具的 path+sha256 写入报告，供 bundle gate 复核归因。
const toolsManifest = {};
for (const toolName of DMG_TOOL_NAMES) {
  const toolPath = resolveTool(toolName);
  let toolSha;
  try {
    toolSha = computeFileSha256(toolPath);
  } catch (err) {
    fail(
      `无法计算装配工具 hash（工具缺失即 fail-closed）: ${toolName} -> ${toolPath}: ${err.message}`,
    );
  }
  toolsManifest[toolName] = { path: toolPath, sha256: toolSha };
}

const gitBefore = readGitState();
if (gitBefore.status.length > 0) fail("装配开始前 worktree 非 clean，拒绝修改候选产物");

const sourceAppSha = computeArtifactSha256(appAbs);
const sourceAppBytes = dirBytes(appAbs);
const iconSha = computeFileSha256(iconAbs);
const licenseBytes = readFileSync(licenseAbs);
const licenseSha = sha256(licenseBytes);

// ---------------------------------------------------------------- 5. staging
currentStage = "staging";
console.log(
  `assemble-dmg: 装配 ${appRel} → ${outputRel}（volname=${volumeName}，format=${FORMAT}）`,
);
const appName = basename(appRel);
runTool("ditto", [appAbs, join(stagingAbs, appName)]);
const stagedAppSha = computeArtifactSha256(join(stagingAbs, appName));
if (stagedAppSha !== sourceAppSha) {
  fail("staging 后的 .app 目录级 hash 与 app-only build 不一致，拒绝继续");
}
copyFileSync(iconAbs, join(stagingAbs, VOLUME_ICON));
if (computeFileSha256(join(stagingAbs, VOLUME_ICON)) !== iconSha) {
  fail(`staging 后的 ${VOLUME_ICON} 与仓库固定 ICNS 不一致`);
}
symlinkSync(APPLICATIONS_TARGET, join(stagingAbs, APPLICATIONS_LINK));
if (!lstatSync(join(stagingAbs, APPLICATIONS_LINK)).isSymbolicLink()) {
  fail(`${APPLICATIONS_LINK} 未建立为符号链接`);
}
// Apple 文档的 no_log 开关：fseventsd 不在本卷写日志，卷根的 .fseventsd 只含该标记，
// 使挂载中的确定性删除不留残余。
mkdirSync(join(stagingAbs, FSEVENTSD), { recursive: true });
writeFileSync(join(stagingAbs, FSEVENTSD, "no_log"), "");
for (const rel of walkRelative(stagingAbs)) {
  if (basename(rel) === DS_STORE) fail(`staging 出现 ${DS_STORE}，拒绝继续：${rel}`);
}

// ---------------------------------------------------------------- 6. UDRW + 卷图标
currentStage = "create-udrw";
runTool("hdiutil", [
  "create",
  "-srcfolder",
  stagingAbs,
  "-volname",
  volumeName,
  "-fs",
  "Journaled HFS+",
  "-format",
  "UDRW",
  "-nospotlight",
  "-ov",
  rwImageAbs,
]);

currentStage = "attach-rw";
// PRR-069C-R2：统一 attach 生命周期——启动前登记 pending exact mountpoint，
// 返回后先按 mount table 核对真实挂载状态，已挂载则立即接管，未确认状态即 STOP。
const rwMount = attachVolume({
  mountpoint: mntRwAbs,
  cmdArgs: ["attach", "-nobrowse", "-noautoopen", "-mountpoint", mntRwAbs, rwImageAbs],
  stage: "attach-rw",
});

currentStage = "volume-icon";
runTool("SetFile", ["-a", "C", rwMount.mountpoint]);
if (!finderInfoHasCustomIcon(readFinderInfoHex(rwMount.mountpoint))) {
  fail("可写卷卷图标属性未设置（FinderInfo kHasCustomIcon 缺失）");
}

currentStage = "fseventsd-cleanup";
runSettle(FSEVENTSD_SETTLE_MS);
const fsEventsPath = join(rwMount.mountpoint, FSEVENTSD);
if (existsSync(fsEventsPath)) {
  const st = lstatSync(fsEventsPath);
  if (!st.isDirectory() || st.isSymbolicLink()) {
    fail(`${FSEVENTSD} 不是常规目录，拒绝删除: ${fsEventsPath}`);
  }
  rmSync(fsEventsPath, { recursive: true, force: true });
}
runSettle(FSEVENTSD_CONFIRM_MS);
if (existsSync(fsEventsPath)) {
  fail(`${FSEVENTSD} 在受控删除后重新出现，拒绝把系统日志目录带进镜像`);
}

currentStage = "detach-rw";
// PRR-069C-R1：清空登记前必须证明 detach 成功且 mount table 无残留。
if (!controlledDetach("detach-rw")) {
  fail("RESIDUAL_MOUNT — 可写卷卸载后无法证明无残留（见上方 RESIDUAL_MOUNT 结构化记录），保留现场");
}

// ---------------------------------------------------------------- 7. ULMO + EULA
currentStage = "convert-ulmo";
runTool("hdiutil", ["convert", rwImageAbs, "-format", FORMAT, "-o", tempDmgAbs]);
const eula = buildLicenseResourceXmlFromFile(licenseAbs);
writeFileSync(eulaXmlAbs, eula.xml);
// udifrez 需要 "选项、空资源占位参数、镜像" 的顺序（与 bundle_dmg.sh 的实际调用一致）。
currentStage = "eula-inject";
runTool("hdiutil", ["udifrez", "-xml", eulaXmlAbs, "", "-quiet", tempDmgAbs]);

// ---------------------------------------------------------------- 8. 只读复核
currentStage = "inspect";
assertImageInfo(runTool("hdiutil", ["imageinfo", tempDmgAbs]).stdout);
assertCrc32Valid(runTool("hdiutil", ["verify", tempDmgAbs]).stdout);

const tempDmgBytes = statSync(tempDmgAbs).size;
if (tempDmgBytes > RELEASE_BUDGETS.installerBytes) {
  fail(`DMG 字节数 ${tempDmgBytes} 超过 installer 预算 ${RELEASE_BUDGETS.installerBytes}`);
}

// 挂载前 EULA：未同意时 attach 必须打印许可证正文并拒绝挂载（该镜像因此不可静默挂载）。
// PRR-069C-R2-F1：探针语义只由「正常结束 + 非零退出 + 无挂载」构成；进程异常（超时/信号/
// spawn error）与意外挂载都在 attachVolume 内部先受控回收再失败，不会走到这里。
currentStage = "pre-mount-eula";
const refusal = attachVolume({
  mountpoint: mntFinalAbs,
  cmdArgs: [
    "attach",
    "-readonly",
    "-nobrowse",
    "-noverify",
    "-noautoopen",
    "-mountpoint",
    mntFinalAbs,
    tempDmgAbs,
  ],
  input: "",
  note: "pre-mount-eula-refusal",
  stage: "pre-mount-eula",
  intent: "eula-probe",
});
if (readdirSync(mntFinalAbs).length !== 0) {
  fail("EULA 拒绝路径留下了挂载内容，现场不干净");
}
const licenseMarker = firstAsciiMarker(licenseBytes);
if (!refusal.out.includes(licenseMarker)) {
  fail(`挂载前 EULA 展示内容与根 LICENSE 不匹配（未找到标记: ${licenseMarker}）`);
}

currentStage = "verify-mount";
const finalMount = attachVolume({
  mountpoint: mntFinalAbs,
  cmdArgs: [
    "attach",
    "-readonly",
    "-nobrowse",
    "-noverify",
    "-noautoopen",
    "-mountpoint",
    mntFinalAbs,
    tempDmgAbs,
  ],
  input: "Y\n",
  stage: "verify-mount",
});

currentStage = "payload-verify";
const payload = verifyMountedPayload(finalMount.mountpoint, { appName, sourceAppSha });

// PRR-069C-R1：正常成功路径同样在清空登记前证明 detach 成功且无残留。
if (!controlledDetach("verify-mount")) {
  fail("RESIDUAL_MOUNT — 只读卷卸载后无法证明无残留（见上方 RESIDUAL_MOUNT 结构化记录），保留现场");
}

// EULA 内容绑定：从最终镜像提取 TEXT 资源与根 LICENSE 逐字节比对。
// 进程异常（spawn error / 超时 / 无退出码）同样不是"非零退出"，必须先分类再报错。
currentStage = "eula-binding";
const rezXml = runTool("hdiutil", ["udifderez", "-xml", tempDmgAbs], { must: false });
const rezXmlFault = classifyProcessResult(rezXml);
if (rezXmlFault) {
  fail(`hdiutil udifderez 进程异常（${rezXmlFault.reason}），无法复算 EULA 内容`);
}
if (rezXml.status !== 0) {
  fail(`hdiutil udifderez 失败，无法复算 EULA 内容：${rezXml.out.trim().slice(0, 200)}`);
}
const eulaBytes = extractEulaTextFromRezXml(rezXml.stdout);
const eulaSha = sha256(eulaBytes);
if (eulaSha !== licenseSha) {
  fail(`EULA 内容 hash ${eulaSha} 与根 LICENSE ${licenseSha} 不一致`);
}

// ---------------------------------------------------------------- 9. 发布 + 复核
currentStage = "publish";
const gitBeforePublish = readGitState();
if (gitBeforePublish.head !== gitBefore.head || gitBeforePublish.status.length > 0) {
  fail("装配期间 source commit/worktree 发生变化，候选不可归因");
}
mkdirSync(dirname(outputAbs), { recursive: true });
try {
  renameSync(tempDmgAbs, outputAbs);
} catch (err) {
  fail(`最终 DMG 无法落到批准路径（拒绝跨设备复制回退）: ${err.message}`);
}
assertImageInfo(runTool("hdiutil", ["imageinfo", outputAbs]).stdout, { stage: "published" });

const finalSha = computeFileSha256(outputAbs);
const finalBytes = statSync(outputAbs).size;
const gitAfter = readGitState();
if (gitAfter.head !== gitBefore.head || gitAfter.status.length > 0) {
  fail("发布期间 source commit/worktree 发生变化，候选不可归因");
}

const finishedMs = Date.now();
// PRR-069C-R2-F1：耗时一律由单调时钟上下文给出，墙钟只用于审计时间戳。
// 成功路径没有清理动作，因此 cleanupMs 恒为 0，assemblyMs 即总耗时。
const successTimings = splitRunTimings(assemblyCtx, cleanupCtx);
if (successTimings.assemblyMs > deadlineMs) {
  fail(`装配阶段耗时 ${successTimings.assemblyMs}ms 超过 deadline ${deadlineMs}ms`);
}

currentStage = "report";
const report = {
  runner: "assemble-dmg.mjs",
  runnerSha256: computeFileSha256(RUNNER_PATH),
  schemaVersion: 1,
  gitHead: gitAfter.head,
  sourceWorktree: "clean",
  startedAt: new Date(assemblyStartedMs).toISOString(),
  finishedAt: new Date(finishedMs).toISOString(),
  elapsedMs: successTimings.totalElapsedMs,
  timeoutMs,
  deadlineMs,
  workDir: runDirRel,
  workTree: workDirInfo.taskRootRel
    ? { taskRoot: workDirInfo.taskRootRel, workDir: workDirInfo.rel }
    : null,
  volumeName,
  dmgFormat: FORMAT,
  tools: toolsManifest,
  inputs: {
    app: { path: appRel, sha256: sourceAppSha, bytes: sourceAppBytes },
    icon: { path: iconRel, sha256: iconSha },
    license: { path: licenseRel, sha256: licenseSha, bytes: licenseBytes.length },
  },
  output: { path: outputRel, sha256: finalSha, bytes: finalBytes },
  eula: {
    licenseSha256: licenseSha,
    resourceSha256: eulaSha,
    resourceType: "TEXT",
    resourceId: "5000",
    displayMarker: licenseMarker,
    preMountDisplayVerified: true,
    imageInfoDeclaresAgreement: true,
  },
  payload,
  // R2-01 / R2-F1：装配段与清理段分开声明（同一单调时钟基准）；
  // 成功路径没有清理动作，cleanupMs 恒为 0，totalElapsedMs 即 assemblyMs。
  timings: {
    assemblyMs: successTimings.assemblyMs,
    cleanupGraceMs,
    cleanupMs: successTimings.cleanupMs,
    totalElapsedMs: successTimings.totalElapsedMs,
    cleanupStarted: cleanupCtx !== null,
    cleanupStatus,
  },
  checks: {
    format: FORMAT,
    crc32: "VALID",
    installerBudgetBytes: RELEASE_BUDGETS.installerBytes,
    applicationsTarget: APPLICATIONS_TARGET,
    volumeIconSha256: iconSha,
    payloadAppSha256: payload.appSha256,
    mountedEntries: payload.entries,
  },
  commands: commandLog,
};

if (reportAbs) {
  mkdirSync(dirname(reportAbs), { recursive: true });
  writeFileSync(reportAbs, `${JSON.stringify(report, null, 2)}\n`);
}

// 成功路径：清掉本轮 staging/临时镜像，只保留报告与最终 DMG。
rmSync(runDirAbs, { recursive: true, force: true });
activeRunDir = null;
// PRR-069C-R2-F1：任务根一律保留（成功的轮次也一样）。任务根的存在本身就是
// "这个任务根已被某一轮用过"的记录，因此同名的下一次调用必然失败；绝不再回收
// 空 work-dir —— 那正是历史目录重入被放行的入口。

console.log(JSON.stringify(report));

// ------------------------------------------------------------------ helpers
function parseAttachOutput(stdout, expectedMountpoint) {
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line.includes(expectedMountpoint)) continue;
    const device = line.split(/\s+/)[0];
    if (!/^\/dev\/disk\d*(s\d+)?$/.test(device)) continue;
    const mountpoint = line.slice(line.indexOf(expectedMountpoint));
    if (mountpoint !== expectedMountpoint) continue;
    return { device, mountpoint };
  }
  return null;
}

function assertImageInfo(imageInfoStdout, { stage = "assembled" } = {}) {
  const match = imageInfoStdout.match(/^\s*Format:\s*(\S+)/m);
  if (!match) fail("imageinfo 未输出 Format 字段，无法证明容器格式");
  if (match[1] !== FORMAT) {
    fail(
      `imageinfo 声明 Format=${match[1]}，与目标 ${FORMAT} 不符（伪造或静默回退，stage=${stage}）`,
    );
  }
  if (
    /^\s*Signed For:/m.test(imageInfoStdout) ||
    /^\s*Encrypt(ed|ion):\s*(yes|true|AES.*)$/im.test(imageInfoStdout)
  ) {
    fail("镜像处于签名或加密状态，发布候选不得如此");
  }
  if (!imageInfoDeclaresLicenseAgreement(imageInfoStdout)) {
    fail(`imageinfo 未声明挂载前 EULA（Software License Agreement: false，stage=${stage}）`);
  }
}

function assertCrc32Valid(verifyStdout) {
  const ok =
    /已验证\s*CRC32/i.test(verifyStdout) ||
    /verified\s*CRC32/i.test(verifyStdout) ||
    /^CRC32\s*\$?[0-9A-Fa-f]+\s*:\s*(valid|已验证)/im.test(verifyStdout);
  if (!ok) fail("hdiutil verify 未报告 CRC32 校验通过，镜像完整性未证明");
}

function verifyMountedPayload(mountpoint, { appName: name, sourceAppSha: expectedSha }) {
  const entries = readdirSync(mountpoint).sort();
  const expected = [name, APPLICATIONS_LINK, VOLUME_ICON].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    fail(`卷根条目与预期不符（得到 ${entries.join(", ")}；预期 ${expected.join(", ")}）`);
  }
  const linkPath = join(mountpoint, APPLICATIONS_LINK);
  if (!lstatSync(linkPath).isSymbolicLink()) fail(`${APPLICATIONS_LINK} 不是符号链接`);
  const linkTarget = readlinkSync(linkPath);
  if (linkTarget !== APPLICATIONS_TARGET) {
    fail(`${APPLICATIONS_LINK} 链接目标不是 ${APPLICATIONS_TARGET}（得到 ${linkTarget}）`);
  }
  const mountedIconSha = computeFileSha256(join(mountpoint, VOLUME_ICON));
  if (mountedIconSha !== iconSha) {
    fail(`卷图标 hash 与仓库固定 ICNS 不一致（${mountedIconSha} != ${iconSha}）`);
  }
  if (!finderInfoHasCustomIcon(readFinderInfoHex(mountpoint))) {
    fail("最终卷图标属性未设置（FinderInfo kHasCustomIcon 缺失）");
  }
  const mountedAppPath = join(mountpoint, name);
  const appSha = computeArtifactSha256(mountedAppPath);
  if (appSha !== expectedSha) {
    fail(`DMG 内 .app 目录级 hash 与 app-only build 不一致（${appSha} != ${expectedSha}）`);
  }
  const sourceIdentity = readAppIdentity(appAbs);
  const mountedIdentity = readAppIdentity(mountedAppPath);
  const mismatched = Object.keys(sourceIdentity).filter(
    (k) => sourceIdentity[k] !== mountedIdentity[k],
  );
  if (mismatched.length > 0) {
    fail(`DMG 内 .app 身份字段与 app-only build 不一致: ${mismatched.join(", ")}`);
  }
  return { appSha256: appSha, entries, identity: mountedIdentity };
}

function readAppIdentity(appPath) {
  const plistPath = join(appPath, "Contents", "Info.plist");
  const json = runTool("plutil", ["-convert", "json", "-o", "-", plistPath]).stdout;
  let plist;
  try {
    plist = JSON.parse(json);
  } catch {
    fail(`Info.plist 无法解析为 JSON: ${relative(ROOT, plistPath)}`);
  }
  const executable = plist.CFBundleExecutable;
  if (typeof executable !== "string" || executable.length === 0)
    fail("Info.plist 缺少 CFBundleExecutable");
  const archs = runTool("lipo", [
    "-archs",
    join(appPath, "Contents", "MacOS", executable),
  ]).stdout.trim();
  return {
    bundleId: String(plist.CFBundleIdentifier ?? ""),
    shortVersion: String(plist.CFBundleShortVersionString ?? ""),
    bundleVersion: String(plist.CFBundleVersion ?? ""),
    minimumSystemVersion: String(plist.LSMinimumSystemVersion ?? ""),
    archs,
  };
}

function readFinderInfoHex(path) {
  const r = runTool("xattr", ["-px", "com.apple.FinderInfo", path], { must: false });
  return r.status === 0 ? r.stdout : "";
}

/** FinderInfo 偏移 8-9 是 fdFlags；kHasCustomIcon = 0x0400。 */
function finderInfoHasCustomIcon(hexText) {
  const bytes = hexText.trim().split(/\s+/).filter(Boolean);
  if (bytes.length < 10) return false;
  const flags = parseInt(`${bytes[8]}${bytes[9]}`, 16);
  return Number.isFinite(flags) && (flags & 0x0400) !== 0;
}

function firstAsciiMarker(bytes) {
  for (const line of bytes.toString("utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length >= 20 && /^[\x20-\x7e]+$/.test(trimmed)) return trimmed;
  }
  fail("根 LICENSE 中没有可用于比对挂载前展示的纯 ASCII 行");
}

function readGitState() {
  try {
    return {
      head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      status: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim(),
    };
  } catch (error) {
    fail(`无法读取 Git source 状态: ${error.message}`);
  }
}

function walkRelative(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}${sep}${entry.name}` : entry.name;
    out.push(rel);
    if (entry.isDirectory()) out.push(...walkRelative(join(dir, entry.name), rel));
  }
  return out;
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

function dirBytes(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += dirBytes(join(path, entry.name));
  }
  return total;
}

/** 有界固定等待：仅用于 fseventsd 的确定性清理，不作为“重试到成功”的手段。 */
function runSettle(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
