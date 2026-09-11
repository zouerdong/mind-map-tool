// dmg-assembly-contract.mjs — DMG 装配专用契约模块（PRR-069C-R2 / R2-F1）。
//
// 只服务两个 DMG 装配入口：`bundle-gate.mjs` 与 `assemble-dmg.mjs`。四块内容：
//   1. 固定系统工具清单（正式证据逐项绑定系统绝对路径与重算 hash）；
//   2. 测试注入路径与注入工具集合的完整校验：fixture 专用，缺一项即拒绝，
//      绝不在缺项后回退真实系统工具；
//   3. work-dir 路径分量与实际落点校验：拒绝中间层/末级/悬空 symlink 与越界落点；
//   4. R2-F1：正式工作树形状与任务根归属 —— 正式 work-dir 固定为
//      `.tmp/prr-069c-<run-id>/work`，任务根（`.tmp/` 下这一直接子目录）必须由
//      assembler 在本轮原子创建；已存在的任务根一律拒绝，不复用历史现场。
//
// 通用 G2 授权、签名检测与路径通用策略仍归 g2-scope.mjs；本模块不复制也不放宽其逻辑，
// 只消费其 isSameOrDescendant 做落点比较，避免两套边界判断分叉。

import { lstatSync, realpathSync, readlinkSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, relative, join, isAbsolute, dirname, sep } from "node:path";
import { isSameOrDescendant } from "./g2-scope.mjs";

/**
 * PRR-069C-R1 引入、R2 迁入本模块：DMG 装配固定系统工具清单（macOS 自带绝对路径）。
 * assemble-dmg 按它解析工具并把每个工具的 path+sha256 写进装配报告；
 * bundle-gate 在正式模式下复核报告工具与该清单逐项一致（path 与重算 hash），
 * 使正式证据绑定冻结的系统工具，而不是被注入目录里的替身。
 */
export const SYSTEM_TOOL_PATHS = Object.freeze({
  hdiutil: "/usr/bin/hdiutil",
  ditto: "/usr/bin/ditto",
  SetFile: "/usr/bin/SetFile",
  mount: "/sbin/mount",
  plutil: "/usr/bin/plutil",
  lipo: "/usr/bin/lipo",
  xattr: "/usr/bin/xattr",
});

/** 七项工具的固定名单（顺序稳定，供逐项校验与差集报错）。 */
export const DMG_TOOL_NAMES = Object.freeze(Object.keys(SYSTEM_TOOL_PATHS));

/**
 * PRR-069C-R2：失败后的清理宽限（仅用于回收本轮挂载，单独计时）。
 * 它不计入装配预算（单命令 120000ms / 整轮 180000ms 保持不变），也不得用于完成装配
 * 或通过预算；父 gate 的终止策略必须容纳这段有界清理，避免在清理中途杀掉 assembler。
 */
export const DMG_CLEANUP_GRACE_MS = 60_000;

/** 正式工作树的任务根前缀：`.tmp/prr-069c-<run-id>`（`.tmp/` 的直接子目录）。 */
export const DMG_TASK_ROOT_PREFIX = "prr-069c-";
/** 正式工作树的末级目录名。 */
export const DMG_WORK_DIR_NAME = "work";
/** 正式 work-dir 的完整形状。 */
export const DMG_PRODUCTION_WORK_DIR_SHAPE = ".tmp/prr-069c-<run-id>/work";

/**
 * R2-F1：进程结果分类（纯函数，可离线单测）。
 * 返回 null 表示「正常结束」（退出码可能是 0 也可能是非零，语义由调用点决定）；
 * 否则返回 { code, reason } 描述这一类执行失败。
 * 超时、被信号终止、spawn 失败、缺失或非法退出码都属于执行失败，
 * 不得被当成「用户拒绝」这类正常业务结果。
 */
export function classifyProcessResult(result) {
  if (!result) return { code: "missing-result", reason: "没有可判定的进程结果" };
  if (result.spawnError) {
    return { code: "spawn-error", reason: `无法启动（spawn error ${result.spawnError}）` };
  }
  if (result.timedOut) {
    return { code: "timeout", reason: `超时（${String(result.timeoutMs ?? "?")}ms）` };
  }
  if (result.signal) {
    return { code: "signal", reason: `被信号终止 (${result.signal})` };
  }
  if (result.status === null || result.status === undefined) {
    return { code: "no-status", reason: "既无退出码又无异常标记，无法判定为正常结束" };
  }
  if (!Number.isInteger(result.status)) {
    return { code: "invalid-status", reason: `退出码不是整数 (${String(result.status)})` };
  }
  return null;
}

/**
 * 正式工作树的形状解析：必须精确为 `.tmp/prr-069c-<run-id>/work`。
 * 任务根 = `.tmp/` 下的这一直接子目录，是本轮的创建单元与归属证明。
 */
export function parseProductionWorkTree(normalizedRel) {
  const segments = normalizedRel.split("/").filter((s) => s.length > 0);
  const runId = segments[1] ?? "";
  const shapeOk =
    segments.length === 3 &&
    segments[0] === ".tmp" &&
    runId.startsWith(DMG_TASK_ROOT_PREFIX) &&
    runId.length > DMG_TASK_ROOT_PREFIX.length &&
    segments[2] === DMG_WORK_DIR_NAME;
  if (!shapeOk) {
    throw new Error(
      `work-dir 必须精确为 ${DMG_PRODUCTION_WORK_DIR_SHAPE}（任务根由本轮唯一创建；` +
        "省略 --work-dir 时 gate 会生成默认唯一路径，也可显式给出完整的新 <任务根>/work；" +
        "不接受旧的固定目录、普通 .tmp 子目录或历史任务根下的子目录）: " +
        normalizedRel,
    );
  }
  return {
    taskRootRel: `${segments[0]}/${segments[1]}`,
    workDirRel: normalizedRel,
  };
}

/**
 * gate 与 assembler 共用：断言任务根此刻不存在（只读检查）。
 * 创建动作只由 assembler 负责（见 createTaskRootAtomically），gate 绝不预先创建。
 */
export function assertTaskRootAbsent(taskRootAbs, taskRootRel) {
  // fixture（合成 root）没有正式任务根合同，work-dir 自身的新鲜度另行校验。
  if (!taskRootAbs) return;
  if (!existsSync(taskRootAbs)) return;
  const st = lstatSync(taskRootAbs);
  if (st.isSymbolicLink()) {
    throw new Error(`work-dir 的任务根是符号链接（含悬空链接），拒绝借道: ${taskRootRel}`);
  }
  const kind = st.isDirectory() ? "目录" : "非目录条目";
  throw new Error(
    `work-dir 的任务根已存在（${kind}；历史任务树、空目录、仅含日志或已回收过 work 的任务根` +
      `都不得复用，本轮必须换一个全新的唯一任务根）: ${taskRootRel}`,
  );
}

/**
 * R2-F1：由 assembler 独占的任务根原子创建。
 * 末级用非递归 mkdir：EEXIST 即失败，不删除重试、不另找目录、不猜测归属。
 * `.tmp/` 是共享父目录，缺失时单独创建（EEXIST 视为并发创建者已建立，可继续）。
 * 调用方必须先跑过 validateDmgWorkDir：到仓库根为止每个分量的 symlink 校验在那里完成，
 * 本函数只负责"从这一层起由本轮独占创建"，不重复也不放宽路径判定。
 */
export function createTaskRootAtomically({ taskRootAbs, taskRootRel, parentAbs, parentRel }) {
  if (!existsSync(parentAbs)) {
    try {
      mkdirSync(parentAbs, { recursive: false });
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw new Error(`无法创建 ${parentRel}（任务根父目录）: ${err.message}`);
      }
    }
  }
  try {
    mkdirSync(taskRootAbs, { recursive: false });
  } catch (err) {
    if (err.code === "EEXIST") {
      throw new Error(
        `任务根已存在（拒绝复用历史任务树；不删除重试、不另找替代目录，并发创建者一律失败）: ` +
          `${taskRootRel}`,
      );
    }
    throw new Error(`任务根无法原子创建: ${taskRootRel}: ${err.message}`);
  }
  return { taskRootRel, taskRootAbs };
}

function readlinkQuiet(p) {
  try {
    return readlinkSync(p);
  } catch {
    return "?";
  }
}

/**
 * 拒绝注入路径中的符号链接借道：从仓库根逐段 lstat，任一分量（含末级与悬空链接）
 * 是符号链接即拒绝。只看最终节点不足以阻止中间层借道。
 */
export function assertNoSymlinkComponents(relPath, rootAbs, fieldName) {
  const parts = relPath.split(/[\\/]+/).filter((p) => p.length > 0 && p !== ".");
  let current = rootAbs;
  for (const part of parts) {
    current = join(current, part);
    let st;
    try {
      st = lstatSync(current);
    } catch {
      // 该分量不存在：更深分量必然也不存在，无需继续。
      return;
    }
    if (st.isSymbolicLink()) {
      throw new Error(
        `${fieldName} 的路径分量是符号链接（含悬空链接），拒绝借道: ` +
          `${relative(rootAbs, current)} -> ${readlinkQuiet(current)}`,
      );
    }
  }
}

/** 目标落点：最近已存在祖先的真实路径（用实际落点而非词法前缀核对）。 */
export function landingPointRealPath(absPath) {
  let existing = absPath;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return null;
    existing = parent;
  }
  return realpathSync(existing);
}

/**
 * 测试注入路径校验（gate 与直接 assembler 两个入口共用）。
 * 拒绝绝对路径、路径穿越、通配符、symlink 借道、越界与指向 canonical source 的注入。
 * 返回仓库相对路径。fixture root 与 canonical root 的身份判定一律 realpath 归一化，
 * 调用者无法用别名目录伪装 fixture。
 */
export function validateInjectionPath({ value, fieldName, root, canonicalRoot }) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} 必须为非空字符串`);
  }
  if (isAbsolute(value)) {
    throw new Error(
      `${fieldName} 是测试注入参数，只接受 fixture root 内的相对路径（拒绝绝对路径）: ${value}`,
    );
  }
  if (/[*?\[\]]/.test(value)) {
    throw new Error(`${fieldName} 包含通配符，必须为精确路径: ${value}`);
  }
  if (value.split(/[\\/]+/).includes("..")) {
    throw new Error(`${fieldName} 包含路径穿越 (..): ${value}`);
  }

  const rootAbs = resolve(root);
  const absValue = resolve(rootAbs, value);
  if (absValue === rootAbs) {
    throw new Error(`${fieldName} 不能指向 fixture 根目录本身: ${value}`);
  }
  if (!isSameOrDescendant(rootAbs, absValue)) {
    throw new Error(`${fieldName} 越界 fixture root: ${value}`);
  }

  const safeRel = relative(rootAbs, absValue);
  assertNoSymlinkComponents(safeRel, rootAbs, fieldName);

  // 真实落点必须仍在 fixture 内，且不得落在 canonical 仓库的非 .tmp 源码区。
  const landing = landingPointRealPath(absValue);
  if (landing === null || !isSameOrDescendant(realpathSync(rootAbs), landing)) {
    throw new Error(`${fieldName} 的实际落点越界 fixture root: ${value} -> ${landing}`);
  }
  if (canonicalRoot) {
    const canonicalReal = realpathSync(resolve(canonicalRoot));
    const canonicalTmpReal = join(canonicalReal, ".tmp");
    if (
      isSameOrDescendant(canonicalReal, landing) &&
      !isSameOrDescendant(canonicalTmpReal, landing)
    ) {
      throw new Error(
        `${fieldName} 指向 canonical 仓库源码区（fixture 注入只允许位于 canonical .tmp/ 下的隔离目录）: ` +
          `${value} -> ${relative(canonicalReal, landing)}`,
      );
    }
  }
  return { rel: safeRel.split(sep).join("/"), abs: absValue, landing };
}

/**
 * 注入工具集合的完整性校验（提供 tool-dir 时必须先于任何工具调用与工作目录写入执行）。
 * 七项工具必须：存在、为常规文件（非 symlink/目录/断链）、可执行、且真实落点位于注入目录内。
 * 任一项不满足即抛错——绝不回退 /usr/bin 等真实系统工具。
 */
export function validateInjectedToolSet({ toolDirAbs, root, canonicalRoot }) {
  const toolDirReal = realpathSync(toolDirAbs);
  const rootReal = realpathSync(resolve(root));
  const st = lstatSync(toolDirAbs);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`--tool-dir 必须是 fixture 内的常规目录（拒绝符号链接）: ${toolDirAbs}`);
  }
  if (!isSameOrDescendant(rootReal, toolDirReal)) {
    throw new Error(`--tool-dir 的实际落点越界 fixture root: ${toolDirAbs} -> ${toolDirReal}`);
  }
  if (canonicalRoot) {
    const canonicalReal = realpathSync(resolve(canonicalRoot));
    const canonicalTmpReal = join(canonicalReal, ".tmp");
    if (
      isSameOrDescendant(canonicalReal, toolDirReal) &&
      !isSameOrDescendant(canonicalTmpReal, toolDirReal)
    ) {
      throw new Error(
        `--tool-dir 指向 canonical 仓库源码区（只允许 canonical .tmp/ 下的隔离注入目录）: ${toolDirAbs}`,
      );
    }
  }

  const missing = [];
  const invalid = [];
  const manifest = {};
  for (const name of DMG_TOOL_NAMES) {
    const toolPath = join(toolDirAbs, name);
    let toolStat = null;
    try {
      toolStat = lstatSync(toolPath);
    } catch {
      missing.push(name);
      continue;
    }
    if (toolStat.isSymbolicLink()) {
      invalid.push(`${name}: 符号链接（含悬空断链）`);
      continue;
    }
    if (!toolStat.isFile()) {
      invalid.push(`${name}: 不是常规文件`);
      continue;
    }
    if ((toolStat.mode & 0o111) === 0) {
      invalid.push(`${name}: 不可执行`);
      continue;
    }
    let toolReal;
    try {
      toolReal = realpathSync(toolPath);
    } catch {
      invalid.push(`${name}: 无法解析真实路径`);
      continue;
    }
    if (!isSameOrDescendant(toolDirReal, toolReal)) {
      invalid.push(`${name}: 真实落点越出注入目录`);
      continue;
    }
    manifest[name] = toolPath;
  }

  const problems = [];
  if (missing.length > 0) problems.push(`缺失工具: ${missing.join(", ")}`);
  if (invalid.length > 0) problems.push(`非法工具: ${invalid.join("; ")}`);
  if (problems.length > 0) {
    throw new Error(
      `工具注入不完整，拒绝在任何工具调用前继续（不回退真实系统工具）: ${problems.join("；")}`,
    );
  }
  return { toolDir: toolDirAbs, toolDirReal, tools: manifest };
}

/**
 * work-dir 结构校验（两入口共用，先于 build/mkdir/工具/挂载）。
 * 覆盖：仓库内相对路径、任一分量（中间层/末级/悬空）symlink、越界落点；
 * 正式模式额外要求精确形状 `.tmp/prr-069c-<run-id>/work` 并回报任务根。
 * 这里只做结构与「任务根是否已存在」的只读判断，创建动作归 assembler。
 */
export function validateDmgWorkDir({ workDir, root, isProduction }) {
  if (typeof workDir !== "string" || workDir.trim().length === 0) {
    throw new Error("work-dir 必须为非空字符串");
  }
  if (isAbsolute(workDir)) {
    throw new Error(`work-dir 必须是仓库相对路径: ${workDir}`);
  }
  if (/[*?\[\]]/.test(workDir)) {
    throw new Error(`work-dir 包含通配符，必须为精确路径: ${workDir}`);
  }
  if (workDir.split(/[\\/]+/).includes("..")) {
    throw new Error(`work-dir 包含路径穿越 (..): ${workDir}`);
  }

  const rootAbs = resolve(root);
  const rootReal = realpathSync(rootAbs);
  const workDirAbs = resolve(rootAbs, workDir);
  if (workDirAbs === rootAbs) {
    throw new Error(`work-dir 不能指向仓库根目录: ${workDir}`);
  }
  if (!isSameOrDescendant(rootAbs, workDirAbs)) {
    throw new Error(`work-dir 越界 repo root: ${workDir}`);
  }
  const rel = relative(rootAbs, workDirAbs);
  const normalizedRel = rel.split(sep).join("/");

  // 第 1 层：任一分量（含中间层与悬空链接）都不得是符号链接。
  assertNoSymlinkComponents(rel, rootAbs, "work-dir");
  // 第 2 层：实际落点必须在仓库内（用真实路径而非词法前缀）。
  const landing = landingPointRealPath(workDirAbs);
  if (landing === null || !isSameOrDescendant(rootReal, landing)) {
    throw new Error(`work-dir 的实际落点越界 repo root: ${workDir} -> ${landing}`);
  }

  if (!isProduction) {
    if (!normalizedRel.startsWith(".tmp/")) {
      throw new Error(
        `work-dir 必须位于仓库内被忽略的 .tmp/ 下（临时 staging/镜像只允许进入任务临时范围）: ${normalizedRel}`,
      );
    }
    // fixture 模式（合成 root）只做结构检查：任务根合同只约束正式工作树。
    return { rel: normalizedRel, abs: workDirAbs, landing, taskRootRel: null, taskRootAbs: null };
  }

  // 正式模式：形状固定为 .tmp/prr-069c-<run-id>/work（先于通用 .tmp/ 检查，保证
  // .tmp 根、普通工作目录、历史 candidate/evidence 目录与旧固定目录都被同一规则拒绝）。
  const { taskRootRel } = parseProductionWorkTree(normalizedRel);
  const taskRootAbs = resolve(rootAbs, taskRootRel);

  return { rel: normalizedRel, abs: workDirAbs, landing, taskRootRel, taskRootAbs };
}

/**
 * work-dir 落点不得落入候选产物目录、G2 evidence 输出目录或其他只读证据树。
 * 用真实落点比较，避免仅靠词法前缀防护。
 */
export function assertWorkDirLandingOutside({ workDirAbs, landing, forbiddenAbsPaths, label }) {
  const landingReal = landing ?? landingPointRealPath(workDirAbs);
  for (const forbidden of forbiddenAbsPaths) {
    if (!existsSync(forbidden)) continue;
    const forbiddenReal = realpathSync(forbidden);
    if (isSameOrDescendant(forbiddenReal, landingReal)) {
      throw new Error(
        `work-dir 不得位于${label}内（该目录只读，不得成为工作区）: ` +
          `${relative(dirname(forbiddenReal), landingReal)} 落在 ${forbiddenReal}`,
      );
    }
  }
}

/**
 * work-dir 必须在本轮由装配创建：已存在（含空目录）即拒绝，防止复用历史现场。
 */
export function assertWorkDirNotPreExisting(workDirAbs, workDirRel) {
  if (!existsSync(workDirAbs)) return;
  const st = lstatSync(workDirAbs);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`work-dir 已存在且不是常规目录（拒绝符号链接）: ${workDirRel}`);
  }
  throw new Error(
    `work-dir 已存在（拒绝复用历史 attempt 树或预存外来目标，不覆盖）: ${workDirRel}`,
  );
}
