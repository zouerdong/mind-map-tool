// scan-dependency-licenses.mjs — 遍历 pnpm node_modules 的直接依赖许可，
// 与允许清单对照；未知/受限许可 fail-closed。每次新增运行时依赖必须通过本扫描。
// 用法：node scripts/quality/scan-dependency-licenses.mjs

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const outputIdx = process.argv.indexOf("--output");
const output = outputIdx === -1 ? null : process.argv[outputIdx + 1];
const PRODUCT_LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"];
const NOTICE_FILES = ["THIRD_PARTY_NOTICES", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.txt"];

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

// SPDX 简易求值：处理 OR/AND、旧式 slash 分隔以及 WITH exception。
function licenseAllowed(expr) {
  const andParts = norm(expr)
    .replaceAll("/", " OR ")
    .split(/\s+AND\s+/i);
  return andParts.every((andPart) => {
    const orParts = andPart.split(/\s+OR\s+/i);
    return orParts.some((p) => {
      const atom = p
        .replace(/[()]/g, "")
        .trim()
        .replace(/\s+WITH\s+[^\s()]+.*$/i, "")
        .trim();
      return ALLOWED.has(atom);
    });
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
      const license = licenseFromPackage(pkg);
      return { license: license || null, version: pkg.version };
    }
  }
  return { missing: true };
}

function licenseFromPackage(pkg) {
  let license = typeof pkg.license === "string" ? norm(pkg.license) : norm(pkg.license?.type ?? "");
  if (!license && Array.isArray(pkg.licenses)) {
    license = pkg.licenses
      .map((item) => (typeof item === "string" ? item : item?.type))
      .filter(Boolean)
      .join(" OR ");
  }
  return license;
}

const workspaceDeps = await collectWorkspaceDeps();
const results = [];
const failures = [];

const productLicenseFile = PRODUCT_LICENSE_FILES.find((path) => existsSync(resolve(ROOT, path)));
const thirdPartyNoticesFile = NOTICE_FILES.find((path) => existsSync(resolve(ROOT, path)));
if (!productLicenseFile) failures.push("项目根目录缺少最终 LICENSE 文件（需项目负责人/法律批准）");
if (!thirdPartyNoticesFile)
  failures.push("项目根目录缺少 THIRD_PARTY_NOTICES 文件（依赖扫描不能替代随包 notices）");

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

// Cargo 的完整解析图也必须参与门禁。仅读 Cargo.lock 不够，因为 lockfile
// 没有许可证字段；cargo metadata 从已锁定解析图返回每个包的 SPDX 声明。
const cargoResults = [];
const cargoManifest = resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml");
if (!existsSync(cargoManifest)) {
  failures.push("Cargo.toml 缺失，无法完成 Rust 依赖许可证审计");
} else {
  try {
    const raw = execFileSync(
      "cargo",
      ["metadata", "--manifest-path", cargoManifest, "--locked", "--format-version", "1"],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const metadata = JSON.parse(raw);
    for (const pkg of metadata.packages ?? []) {
      const item = {
        name: pkg.name,
        version: pkg.version,
        license: norm(pkg.license) || "UNKNOWN",
        source: pkg.source ?? "workspace",
      };
      cargoResults.push(item);
      if (item.source === "workspace") continue;
      if (item.license === "UNKNOWN") {
        failures.push(`(cargo) ${item.name}@${item.version}: package license 缺失（人工审阅）`);
      } else if (!licenseAllowed(item.license)) {
        failures.push(
          `(cargo) ${item.name}@${item.version}: 许可 "${item.license}" 不在允许清单（没有可选的允许许可证）`,
        );
      }
    }
  } catch (error) {
    const detail = error?.stderr ? String(error.stderr).trim().split("\n").at(-1) : String(error);
    failures.push(`(cargo) cargo metadata --locked 失败：${detail}`);
  }
}

// 完整扫描 pnpm virtual store 中每个实际 package.json（含 scoped package）。
// 传递依赖与直接依赖使用同一 fail-closed allowlist；未知许可不能静默跳过。
const storeDir = resolve(ROOT, "node_modules/.pnpm");
const transitiveResults = [];
if (existsSync(storeDir)) {
  const entries = await readdir(storeDir);
  const seen = new Set();
  for (const entry of entries) {
    const nodeModulesDir = resolve(storeDir, entry, "node_modules");
    try {
      const topLevel = await readdir(nodeModulesDir, { withFileTypes: true });
      const packageJsonPaths = [];
      for (const dep of topLevel) {
        if (dep.name.startsWith("@") && dep.isDirectory()) {
          const scopeDir = resolve(nodeModulesDir, dep.name);
          for (const scoped of await readdir(scopeDir, { withFileTypes: true })) {
            if (scoped.isDirectory() || scoped.isSymbolicLink()) {
              packageJsonPaths.push(resolve(scopeDir, scoped.name, "package.json"));
            }
          }
        } else if (dep.isDirectory() || dep.isSymbolicLink()) {
          packageJsonPaths.push(resolve(nodeModulesDir, dep.name, "package.json"));
        }
      }

      for (const packageJson of packageJsonPaths) {
        if (!existsSync(packageJson)) continue;
        const pkg = JSON.parse(await readFile(packageJson, "utf8"));
        const key = `${pkg.name}@${pkg.version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const license = licenseFromPackage(pkg) || "UNKNOWN";
        transitiveResults.push({ name: pkg.name, version: pkg.version, license });
        if (license === "UNKNOWN") {
          failures.push(`(transitive) ${key}: package license 缺失（人工审阅）`);
        } else if (!licenseAllowed(license)) {
          failures.push(`(transitive) ${key}: 许可 "${license}" 不在允许清单`);
        }
      }
    } catch (error) {
      if (existsSync(nodeModulesDir)) {
        failures.push(`(transitive) 无法扫描 ${entry}: ${error.message}`);
      }
    }
  }
} else {
  failures.push("pnpm virtual store 不存在（先 pnpm install）");
}

// THIRD_PARTY_NOTICES 覆盖校验（PRR-060）：每个随包 JS/Cargo/字体条目都必须
// 出现在 notices 中，notices 中也不得有当前解析图之外的陈旧条目；两侧不一致
// 都 fail-closed，提示重新运行 generate-third-party-notices.mjs。
let noticesStats = null;
if (thirdPartyNoticesFile) {
  const noticesText = await readFile(resolve(ROOT, thirdPartyNoticesFile), "utf8");
  const noticed = new Set();
  for (const m of noticesText.matchAll(/^(?:★ )?-\s+`([^`]+@[^`]+)`\s+—\s+License:/gm)) {
    noticed.add(m[1]);
  }
  const fontNoticed = new Set(
    [...noticesText.matchAll(/`(assets\/fonts\/[^`]+)`/g)].map((m) => m[1]),
  );

  const scannedKeys = new Set([
    ...transitiveResults.map((r) => `${r.name}@${r.version}`),
    ...cargoResults.filter((r) => r.source !== "workspace").map((r) => `${r.name}@${r.version}`),
  ]);
  for (const key of scannedKeys) {
    if (!noticed.has(key))
      failures.push(
        `(notices) ${key}: 未出现在 ${thirdPartyNoticesFile}（重跑 generate-third-party-notices.mjs）`,
      );
  }
  for (const key of noticed) {
    if (!scannedKeys.has(key))
      failures.push(
        `(notices) ${key}: notices 条目不在当前依赖解析图中（notices 陈旧，需重新生成）`,
      );
  }

  const fontDir = resolve(ROOT, "assets/fonts");
  const shippedFonts = (await readdir(fontDir)).filter(
    (f) => f.endsWith(".woff2") || f === "OFL-1.1.txt",
  );
  for (const f of shippedFonts) {
    const rel = `assets/fonts/${f}`;
    if (!fontNoticed.has(rel)) failures.push(`(notices) ${rel}: 随包字体未出现在 notices`);
  }
  noticesStats = {
    file: thirdPartyNoticesFile,
    packages: scannedKeys.size,
    staleEntries: [...noticed].filter((k) => !scannedKeys.has(k)).length,
    fonts: shippedFonts.length,
  };
  console.log(
    `notices coverage: ${scannedKeys.size} packages + ${shippedFonts.length} fonts checked against ${thirdPartyNoticesFile}`,
  );
}

console.log(
  `scanned ${results.length} direct JS dependencies + ${transitiveResults.length} transitive JS packages + ${cargoResults.length} Cargo packages`,
);
for (const r of results) console.log(`  ${r.name.padEnd(32)} ${r.license}`);
if (cargoResults.length) {
  const cargoFailures = new Set(failures.filter((f) => f.startsWith("(cargo)")).map((f) => f));
  console.log(`  cargo: ${cargoResults.length} packages (${cargoFailures.size} failures)`);
}

if (output) {
  const outputPath = resolve(ROOT, output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        allowedLicenses: [...ALLOWED].sort(),
        releaseArtifacts: {
          productLicenseFile: productLicenseFile ?? null,
          thirdPartyNoticesFile: thirdPartyNoticesFile ?? null,
        },
        noticesCoverage: noticesStats,
        javascript: results,
        javascriptTransitive: transitiveResults,
        cargo: cargoResults,
        failures,
        overall: failures.length ? "FAIL" : "PASS",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`license evidence -> ${output}`);
}

if (failures.length) {
  console.error("scan-dependency-licenses: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("scan-dependency-licenses: PASS");
