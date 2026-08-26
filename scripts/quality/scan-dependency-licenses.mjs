// scan-dependency-licenses.mjs — 遍历 pnpm node_modules 的直接依赖许可，
// 与允许清单对照；未知/受限许可 fail-closed。每次新增运行时依赖必须通过本扫描。
// 用法：node scripts/quality/scan-dependency-licenses.mjs

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

// 允许清单：宽松/署名型许可。GPL/AGPL/SSPL/未知 → FAIL（需项目负责人决定）。
const ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "MIT-0",
  "Python-2.0",
  "Unlicense",
  "CC0-1.0",
  "MPL-2.0",
  "OFL-1.1",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "Zlib",
  "BSL-1.0",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "BSD-3-Clause-Clear",
]);

const norm = (s) =>
  String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");

// SPDX 简易求值：仅处理 " OR "（任一允许即通过）与 " AND "（全部允许才通过）。
function licenseAllowed(expr) {
  const andParts = norm(expr).split(/\s+AND\s+/i);
  return andParts.every((andPart) => {
    const orParts = andPart.split(/\s+OR\s+/i);
    return orParts.some((p) => ALLOWED.has(p.replace(/[()]/g, "").trim()));
  });
}

async function collectWorkspaceDeps() {
  const deps = new Map(); // name -> { version, license, path, workspace: true }
  const pkgs = [
    "package.json",
    "apps/desktop/package.json",
    "packages/core/package.json",
    "packages/export/package.json",
    "packages/ui/package.json",
    "packages/platform/package.json",
  ];
  for (const rel of pkgs) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) continue;
    const pkg = JSON.parse(await readFile(abs, "utf8"));
    for (const section of ["dependencies", "devDependencies"]) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        const isWorkspace = String(version).startsWith("workspace:");
        deps.set(name, { version, path: rel, workspace: isWorkspace });
      }
    }
  }
  return deps;
}

async function resolveInstalledLicense(name, fromRel) {
  // pnpm layout: each workspace package has its own node_modules/<name>
  const bases = [];
  if (fromRel && fromRel !== "package.json") bases.push(resolve(ROOT, dirname(fromRel)));
  bases.push(ROOT);
  for (const base of bases) {
    const p = resolve(base, "node_modules", name, "package.json");
    if (existsSync(p)) {
      const pkg = JSON.parse(await readFile(p, "utf8"));
      let license = norm(pkg.license);
      if (!license && Array.isArray(pkg.licenses)) {
        license = pkg.licenses.map((l) => (typeof l === "string" ? l : l.type)).join(" OR ");
      }
      return { license: license || null, version: pkg.version };
    }
  }
  return { missing: true };
}

const workspaceDeps = await collectWorkspaceDeps();
const results = [];
const failures = [];

for (const [name, meta] of workspaceDeps) {
  if (meta.workspace) {
    results.push({ name, license: "workspace" });
    continue; // 仓库内部包，无第三方许可问题
  }
  const info = await resolveInstalledLicense(name, meta.path);
  results.push({ name, license: info.license ?? "UNKNOWN", missing: !!info.missing });
  if (info.missing) failures.push(`${name}: 未安装（先 pnpm install）`);
  else if (info.license === null)
    failures.push(`${name}: package.json 无 license 字段（人工审阅）`);
  else if (!licenseAllowed(info.license))
    failures.push(`${name}: 许可 "${info.license}" 不在允许清单（需项目负责人决定）`);
}

// also scan the full .pnpm store (transitive) for hard-forbidden copyleft
const storeDir = resolve(ROOT, "node_modules/.pnpm");
if (existsSync(storeDir)) {
  const entries = await readdir(storeDir);
  const seen = new Set();
  for (const entry of entries) {
    const name = entry.split("@")[0] || entry; // imperfect but catches prefixes
    void name;
    const pkgJson = resolve(storeDir, entry, "node_modules");
    // full transitive scan is expensive; check only license field of store entries
    try {
      const sub = await readdir(pkgJson);
      const depName = sub[0];
      if (!depName || seen.has(depName)) continue;
      seen.add(depName);
      const pj = resolve(pkgJson, depName, "package.json");
      if (!existsSync(pj)) continue;
      const pkg = JSON.parse(await readFile(pj, "utf8"));
      const lic = norm(pkg.license);
      if (/AGPL|GPL|SSPL|BUSL|commons-clause/i.test(lic)) {
        failures.push(`(transitive) ${depName}: ${lic}`);
      }
    } catch {
      // ignore layout oddities
    }
  }
}

console.log(`scanned ${results.length} direct dependencies (+transitive copyleft scan)`);
for (const r of results) console.log(`  ${r.name.padEnd(32)} ${r.license}`);

if (failures.length) {
  console.error("scan-dependency-licenses: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("scan-dependency-licenses: PASS");
