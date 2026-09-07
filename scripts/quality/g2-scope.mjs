// g2-scope.mjs — 共享 G2 scope loader 与校验器（PRC-055 契约）。
// 集中校验 G2 approval、host、allowedActions、candidate/install/evidence/deletion 边界，
// 拒绝空数组、相对逃逸、symlink 越界、宽泛 glob、未授权 action 和签名凭据。

import { readFileSync, lstatSync, realpathSync, existsSync, readdirSync } from "node:fs";
import { resolve, normalize, relative, isAbsolute, join } from "node:path";
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
  if (p.includes("..") || normalize(p).startsWith("..")) {
    throw new Error(`${fieldName} 包含路径穿越 (..): ${p}`);
  }

  const absPath = isAbsolute(p) ? normalized : resolve(repoRoot, p);
  const relToRoot = relative(repoRoot, absPath);
  if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
    throw new Error(`${fieldName} 越界 repo root: ${p}`);
  }

  // 符号链接检查
  if (existsSync(absPath)) {
    const st = lstatSync(absPath);
    if (st.isSymbolicLink()) {
      const real = realpathSync(absPath);
      const relReal = relative(repoRoot, real);
      if (relReal.startsWith("..") || isAbsolute(relReal)) {
        throw new Error(`${fieldName} 为越界符号链接: ${p} -> ${real}`);
      }
    }
  }

  return relToRoot;
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
  const regPath = isAbsolute(scopeFrom) ? scopeFrom : resolve(root, scopeFrom);

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
    const isUnderRoot = safeCandidateOutputPaths.some(
      (cop) => cop.startsWith(safeCandidateRoot) || safeCandidateRoot.startsWith(cop),
    );
    if (!isUnderRoot) {
      throw new Error(`candidateRoot "${candidateRoot}" 与批准 candidateOutputPaths 不匹配`);
    }
  }

  // 校验 candidate
  if (candidate) {
    const safeCandidate = validateSafePath(candidate, root, "candidate");
    const isApprovedCandidate = safeCandidateOutputPaths.some(
      (cop) => cop === safeCandidate || safeCandidate.startsWith(cop),
    );
    if (!isApprovedCandidate) {
      throw new Error(`candidate "${candidate}" 不在批准 candidateOutputPaths 中`);
    }
  }

  // 校验 evidenceDir
  if (evidenceDir) {
    const safeEvidenceDir = validateSafePath(evidenceDir, root, "evidenceDir");
    const isApprovedEvidenceDir =
      safeEvidenceOutputPaths.some(
        (eop) => eop === safeEvidenceDir || safeEvidenceDir.startsWith(eop),
      ) ||
      safeDeletionBoundaries.some((db) => db === safeEvidenceDir || safeEvidenceDir.startsWith(db));
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
      (db) => safeTarget === db || safeTarget.startsWith(db + "/"),
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
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        const rel = relative(artifactPath, full);
        const hash = computeFileSha256(full);
        files.push(`${rel}:${hash}`);
      }
    }
  }
  walk(artifactPath);
  return createHash("sha256").update(files.join("\n")).digest("hex");
}
