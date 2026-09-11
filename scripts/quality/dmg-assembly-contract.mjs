// dmg-assembly-contract.mjs — DMG 装配专用契约模块（PRR-069C-R2）。
//
// 只服务两个 DMG 装配入口：`bundle-gate.mjs` 与 `assemble-dmg.mjs`。三块内容：
//   1. 固定系统工具清单（正式证据逐项绑定系统绝对路径与重算 hash）；
//   2. 测试注入路径与注入工具集合的完整校验：fixture 专用，缺一项即拒绝，
//      绝不在缺项后回退真实系统工具；
//   3. work-dir 路径分量与实际落点校验：拒绝中间层/末级/悬空 symlink、
//      越界落点与借用历史 attempt 树。
//
// 通用 G2 授权、签名检测与路径通用策略仍归 g2-scope.mjs；本模块不复制也不放宽其逻辑，
// 只消费其 isSameOrDescendant 做落点比较，避免两套边界判断分叉。

import { lstatSync, realpathSync, readlinkSync, existsSync, readdirSync } from "node:fs";
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
 * 覆盖：白名单前缀、任一分量（中间层/末级/悬空）symlink、越界落点、历史 attempt 借用。
 * 正式模式额外要求 `.tmp/prr-069c-<非空>` 白名单与 attempt 树新用合同。
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
    // fixture 模式只做结构检查，白名单与 attempt 新鲜度合同不适用。
    return { rel: normalizedRel, abs: workDirAbs, landing };
  }

  // 正式模式先判白名单（早于通用 .tmp/ 检查，保证 .tmp 根也被同一白名单拒绝）。
  if (!/^\.tmp\/prr-069c-.+/.test(normalizedRel)) {
    throw new Error(
      `正式 work-dir 必须位于 .tmp/prr-069c-<非空> 任务目录内（不得使用 .tmp 根、普通工作目录或历史 candidate/evidence 目录）: ${normalizedRel}`,
    );
  }

  // 第 3 层：attempt 新鲜度合同。
  const segments = normalizedRel.split("/").filter((s) => s.length > 0);
  const attemptAbs = resolve(rootAbs, segments[0], segments[1]);
  const attemptExists = existsSync(attemptAbs);
  if (attemptExists) {
    const attemptStat = lstatSync(attemptAbs);
    if (!attemptStat.isDirectory()) {
      throw new Error(`正式 attempt 目录不是常规目录: ${segments[0]}/${segments[1]}`);
    }
    // 本轮 work-dir 相对 attempt 目录的首个分量；同级只允许日志目录 logs。
    const localFirst = segments[2];
    const allowedSiblings = new Set(localFirst ? [localFirst, "logs"] : ["logs"]);
    const foreignDirs = [];
    for (const entry of readdirSync(attemptAbs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!allowedSiblings.has(entry.name)) foreignDirs.push(entry.name);
    }
    if (foreignDirs.length > 0) {
      throw new Error(
        `正式 work-dir 不得借用历史 attempt 树（该 attempt 目录已含其他运行目录 ${foreignDirs.join(", ")}，` +
          `本轮必须使用全新 attempt 目录）: ${normalizedRel}`,
      );
    }
  }

  return { rel: normalizedRel, abs: workDirAbs, landing };
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
