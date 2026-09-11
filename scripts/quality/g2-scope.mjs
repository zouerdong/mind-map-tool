// g2-scope.mjs — 共享 G2 scope loader 与校验器（PRC-055 契约）。
// 集中校验 G2 approval、host、allowedActions、candidate/install/evidence/deletion 边界，
// 拒绝空数组、相对逃逸、symlink 越界、宽泛 glob、未授权 action 和签名凭据。

import {
  readFileSync,
  lstatSync,
  realpathSync,
  existsSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { resolve, normalize, relative, isAbsolute, join, dirname, sep } from "node:path";
import { createHash } from "node:crypto";

export const FORBIDDEN_EXCLUDED_ACTIONS = [
  "test-signing",
  "signing",
  "notarization",
  "credential access",
  "system trust changes",
  "upload",
  "publication",
];

export const SIGNING_ENV_KEYS = [
  "APPLE_CERTIFICATE",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "KEYCHAIN",
  "TAURI_SIGNING_PRIVATE_KEY",
  "CSC_LINK",
  "WIN_CSC_LINK",
];

export const SIGNING_FILES = [
  "apps/desktop/src-tauri/Entitlements.plist",
  "apps/desktop/build/entitlements.mac.plist",
];

/**
 * PRR-069C-R1：DMG 装配固定系统工具清单（macOS 自带绝对路径）。
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

export function checkSigningHints(host, repoRoot) {
  const hits = [];
  // 环境变量检测：仅报告变量名，绝不输出凭据值
  for (const envKey of Object.keys(process.env)) {
    for (const hint of SIGNING_ENV_KEYS) {
      if (envKey.toUpperCase().includes(hint)) {
        hits.push(`env:${envKey}`);
        break;
      }
    }
  }

  // 凭据/授权文件检测
  for (const f of SIGNING_FILES) {
    const p = resolve(repoRoot, f);
    if (existsSync(p)) {
      hits.push(`file:${f}`);
    }
  }

  // Tauri 配置签名段检测
  if (host === "tauri") {
    const tauriConf = resolve(repoRoot, "apps/desktop/src-tauri/tauri.conf.json");
    if (existsSync(tauriConf)) {
      const text = readFileSync(tauriConf, "utf8");
      if (/signingIdentity|providerShortName|publisher/i.test(text)) {
        hits.push("tauri.conf.json signing fields");
      }
    }
  }

  return hits;
}

export function validateSafePath(p, repoRoot, fieldName = "path") {
  if (typeof p !== "string" || p.trim().length === 0) {
    throw new Error(`${fieldName} 必须为非空字符串`);
  }
  // 拒绝通配符
  if (/[*?\[\]]/.test(p)) {
    throw new Error(`${fieldName} 包含通配符，必须为精确路径: ${p}`);
  }
  // 拒绝相对逃逸
  if (p.split(/[\\/]+/).includes("..")) {
    throw new Error(`${fieldName} 包含路径穿越 (..): ${p}`);
  }
  const normalized = normalize(p);

  const absPath = isAbsolute(p) ? normalized : resolve(repoRoot, p);
  const rootAbs = resolve(repoRoot);
  const relToRoot = relative(rootAbs, absPath);
  if (absPath === rootAbs) {
    throw new Error(`${fieldName} 不能指向仓库根目录`);
  }
  if (!isSameOrDescendant(rootAbs, absPath)) {
    throw new Error(`${fieldName} 越界 repo root: ${p}`);
  }

  // 检查目标或最近的已存在父目录，避免通过中间 symlink 越出 repo。
  const rootReal = realpathSync(rootAbs);
  let existingAncestor = absPath;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  if (existsSync(existingAncestor)) {
    const realAncestor = realpathSync(existingAncestor);
    if (!isSameOrDescendant(rootReal, realAncestor)) {
      throw new Error(`${fieldName} 通过符号链接越界: ${p} -> ${realAncestor}`);
    }
  }

  return relToRoot;
}

export function isSameOrDescendant(parentPath, childPath) {
  const rel = relative(resolve(parentPath), resolve(childPath));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function loadAndValidateG2Scope({
  scopeFrom,
  host,
  action,
  candidateRoot,
  candidate,
  evidenceDir,
  target,
  repoRoot,
}) {
  const root = repoRoot ?? resolve(process.cwd());
  const safeScopeFrom = validateSafePath(scopeFrom, root, "scopeFrom");
  const regPath = resolve(root, safeScopeFrom);

  if (!existsSync(regPath)) {
    throw new Error(`decision register 不存在: ${scopeFrom}`);
  }

  let register;
  try {
    register = JSON.parse(readFileSync(regPath, "utf8"));
  } catch (err) {
    throw new Error(`decision register JSON 解析失败: ${err.message}`);
  }

  const g2 = register.gates?.G2;
  if (!g2) {
    throw new Error("G2 门缺失 (register.gates.G2 未定义)");
  }
  if (g2.status !== "approved") {
    throw new Error(`G2 门状态必须为 approved（当前 ${g2.status ?? "missing"}）`);
  }
  const approvedBy = typeof g2.approvedBy === "string" ? g2.approvedBy.trim() : "";
  if (!approvedBy || /^(project[- ]?owner|owner|tbd|unknown)$/i.test(approvedBy)) {
    throw new Error("G2.approvedBy 必须记录真实批准人，不能使用 project-owner/TBD 占位符");
  }
  if (!Number.isFinite(Date.parse(g2.approvedAt))) {
    throw new Error("G2.approvedAt 必须是合法日期");
  }
  if (
    !Array.isArray(g2.evidence) ||
    !g2.evidence.some((entry) => typeof entry === "string" && entry.startsWith("[from-user]"))
  ) {
    throw new Error("G2.evidence 必须包含 [from-user] 批准记录，不能仅有执行者自述");
  }

  const scope = g2.approvedScope;
  if (!scope || typeof scope !== "object") {
    throw new Error("G2.approvedScope 缺失或无效");
  }

  if (host && scope.selectedHost !== host) {
    throw new Error(`G2 approved host mismatch: 请求 ${host}, 批准 ${scope.selectedHost}`);
  }

  const requiredArrays = [
    "candidateOutputPaths",
    "evidenceOutputPaths",
    "installationTargets",
    "allowedActions",
    "deletionBoundaries",
    "explicitlyExcluded",
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(scope[key]) || scope[key].length === 0) {
      throw new Error(`G2.approvedScope.${key} 必须是非空数组`);
    }
  }

  // 检查 explicitlyExcluded 保持封锁
  for (const f of FORBIDDEN_EXCLUDED_ACTIONS) {
    if (!scope.explicitlyExcluded.includes(f)) {
      throw new Error(`G2.approvedScope.explicitlyExcluded 必须包含 "${f}"`);
    }
  }

  // 路径安全校验
  const checkPaths = (list, name) => {
    return list.map((item, idx) => validateSafePath(item, root, `${name}[${idx}]`));
  };

  const safeCandidateOutputPaths = checkPaths(scope.candidateOutputPaths, "candidateOutputPaths");
  const safeEvidenceOutputPaths = checkPaths(scope.evidenceOutputPaths, "evidenceOutputPaths");
  const safeInstallationTargets = checkPaths(scope.installationTargets, "installationTargets");
  const safeDeletionBoundaries = checkPaths(scope.deletionBoundaries, "deletionBoundaries");

  // 校验 action
  if (action) {
    if (scope.explicitlyExcluded.includes(action)) {
      throw new Error(`动作 "${action}" 位于 G2.explicitlyExcluded 禁止列表`);
    }
    if (!scope.allowedActions.includes(action)) {
      throw new Error(`动作 "${action}" 未在 G2.allowedActions 批准列表中`);
    }
  }

  // 校验 candidateRoot
  if (candidateRoot) {
    const safeCandidateRoot = validateSafePath(candidateRoot, root, "candidateRoot");
    let approvedRoot = dirname(resolve(root, safeCandidateOutputPaths[0]));
    while (
      !safeCandidateOutputPaths.every((cop) => isSameOrDescendant(approvedRoot, resolve(root, cop)))
    ) {
      const parent = dirname(approvedRoot);
      if (parent === approvedRoot) break;
      approvedRoot = parent;
    }
    if (resolve(root, safeCandidateRoot) !== approvedRoot) {
      throw new Error(
        `candidateRoot "${candidateRoot}" 必须等于批准产物的唯一共同目录 ${relative(root, approvedRoot)}`,
      );
    }
  }

  // 校验 candidate
  if (candidate) {
    const safeCandidate = validateSafePath(candidate, root, "candidate");
    const isApprovedCandidate = safeCandidateOutputPaths.includes(safeCandidate);
    if (!isApprovedCandidate) {
      throw new Error(`candidate "${candidate}" 不在批准 candidateOutputPaths 中`);
    }
  }

  // 校验 evidenceDir
  if (evidenceDir) {
    const safeEvidenceDir = validateSafePath(evidenceDir, root, "evidenceDir");
    const isApprovedEvidenceDir =
      safeEvidenceOutputPaths.some(
        (eop) =>
          eop === safeEvidenceDir ||
          isSameOrDescendant(resolve(root, eop), resolve(root, safeEvidenceDir)),
      ) ||
      safeDeletionBoundaries.some(
        (db) =>
          db === safeEvidenceDir ||
          isSameOrDescendant(resolve(root, db), resolve(root, safeEvidenceDir)),
      );
    if (!isApprovedEvidenceDir) {
      throw new Error(`evidenceDir "${evidenceDir}" 不在批准 evidenceOutputPaths 中`);
    }
  }

  // 校验 target
  if (target) {
    const safeTarget = validateSafePath(target, root, "target");
    const isApprovedTarget = safeInstallationTargets.some((it) => it === safeTarget);
    if (!isApprovedTarget) {
      throw new Error(`target "${target}" 不在批准 installationTargets 中`);
    }
    const isWithinDeletion = safeDeletionBoundaries.some(
      (db) => safeTarget === db || isSameOrDescendant(resolve(root, db), resolve(root, safeTarget)),
    );
    if (!isWithinDeletion) {
      throw new Error(`target "${target}" 必须位于 deletionBoundaries 范围之内以保证安全卸载`);
    }
  }

  return {
    register,
    g2,
    scope,
    repoRoot: root,
    normalized: {
      candidateOutputPaths: safeCandidateOutputPaths,
      evidenceOutputPaths: safeEvidenceOutputPaths,
      installationTargets: safeInstallationTargets,
      deletionBoundaries: safeDeletionBoundaries,
    },
  };
}

export function computeFileSha256(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export function computeArtifactSha256(artifactPath) {
  const st = lstatSync(artifactPath);
  if (!st.isDirectory()) {
    return computeFileSha256(artifactPath);
  }

  // 递归计算目录内全部文件相对路径与内容哈希
  const files = [];
  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const rel = relative(artifactPath, full);
        const hash = computeFileSha256(full);
        files.push(`${rel}:${hash}`);
      } else if (ent.isSymbolicLink()) {
        const rel = relative(artifactPath, full);
        const real = realpathSync(full);
        if (!isSameOrDescendant(artifactPath, real)) {
          throw new Error(`artifact 内含越界符号链接: ${rel} -> ${real}`);
        }
        const target = readlinkSync(full);
        const hash = createHash("sha256").update(`symlink:${target}`).digest("hex");
        files.push(`${rel}:${hash}`);
      }
    }
  }
  walk(artifactPath);
  return createHash("sha256").update(files.join("\n")).digest("hex");
}
