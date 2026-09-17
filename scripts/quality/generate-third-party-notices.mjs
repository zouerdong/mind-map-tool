// generate-third-party-notices.mjs — 生成 THIRD_PARTY_NOTICES.md（PRR-060）。
// 数据来源与 scan-dependency-licenses.mjs 同口径：
//   1. workspace 直接 JS 依赖（node_modules 解析）
//   2. pnpm virtual store 全量传递 JS package.json
//   3. cargo metadata --locked 全量 Cargo 解析图
//   4. assets/fonts 随包字体清单（.woff2 + OFL-1.1.txt）
// 每行包含 name@version | license | source | 本地许可文本路径；
// 附录嵌入出现过的每个不同许可的代表性全文。
// 生成是确定性的（按 name@version 排序）；重跑产生字节一致的输出。
// 用法：node scripts/quality/generate-third-party-notices.mjs [--output THIRD_PARTY_NOTICES.md]

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const outputIdx = process.argv.indexOf("--output");
const OUTPUT =
  outputIdx === -1
    ? resolve(ROOT, "THIRD_PARTY_NOTICES.md")
    : resolve(ROOT, process.argv[outputIdx + 1]);

const WORKSPACE_PKGS = [
  "package.json",
  "apps/desktop/package.json",
  "packages/core/package.json",
  "packages/export/package.json",
  "packages/ui/package.json",
  "packages/platform/package.json",
];

const norm = (s) =>
  String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");

function licenseFromPackage(pkg) {
  let license = typeof pkg.license === "string" ? norm(pkg.license) : norm(pkg.license?.type ?? "");
  if (!license && Array.isArray(pkg.licenses)) {
    license = pkg.licenses
      .map((item) => (typeof item === "string" ? item : item?.type))
      .filter(Boolean)
      .join(" OR ");
  }
  return license || null;
}

function licenseAtoms(expr) {
  return norm(expr)
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND)\s+/i)
    .flatMap((part) => part.split("/"))
    .map((atom) => atom.replace(/\s+WITH\s+[^\s()]+.*$/i, "").trim())
    .filter(Boolean);
}

function findLicenseFile(dir) {
  if (!dir || !existsSync(dir)) return null;
  const candidates = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENCE",
    "LICENCE.md",
    "COPYING",
    "COPYING.txt",
    "LICENSE-MIT",
    "LICENSE-MIT.txt",
    "LICENSE-APACHE",
    "LICENSE-APACHE.txt",
    "LICENSE.BSD",
  ];
  for (const name of candidates) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  // 大小写不敏感兜底（npm 生态常见 License/license 变体）
  try {
    for (const ent of readdirSync(dir)) {
      if (/^(licen[cs]e|copying|notice)/i.test(ent) && !ent.includes("#")) {
        return join(dir, ent);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function repoUrl(pkg) {
  const repo = pkg?.repository;
  let url = null;
  if (typeof repo === "string") url = repo;
  else if (repo?.url) url = repo.url;
  if (!url && pkg?.homepage && /^https?:\/\//.test(pkg.homepage)) url = pkg.homepage;
  if (url) {
    url = url
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@/, "https://")
      .replace(/\.git$/, "")
      .replace(/^github:/, "https://github.com/");
    if (!/^https?:\/\//.test(url) && !url.includes("/")) return null;
  }
  return url;
}

// ---------- 1. JS：workspace 直接依赖 ----------
const directJs = [];
const seenDirect = new Set();
for (const rel of WORKSPACE_PKGS) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) continue;
  const pkg = JSON.parse(await readFile(abs, "utf8"));
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      if (String(version).startsWith("workspace:")) continue;
      if (seenDirect.has(name)) continue;
      seenDirect.add(name);
      directJs.push({ name, versionRange: version, from: rel });
    }
  }
}

for (const dep of directJs) {
  const bases = [resolve(ROOT, dirname(dep.from)), ROOT];
  let found = false;
  for (const base of bases) {
    const p = join(base, "node_modules", dep.name, "package.json");
    if (existsSync(p)) {
      const pkg = JSON.parse(await readFile(p, "utf8"));
      dep.version = pkg.version;
      dep.license = licenseFromPackage(pkg) ?? "UNKNOWN";
      dep.source = repoUrl(pkg);
      dep.licenseTextPath = findLicenseFile(dirname(p));
      found = true;
      break;
    }
  }
  if (!found) {
    dep.version = "missing";
    dep.license = "UNKNOWN";
  }
}

// ---------- 2. JS：pnpm virtual store 全量传递依赖 ----------
const transitiveJs = [];
{
  const storeDir = resolve(ROOT, "node_modules/.pnpm");
  const seen = new Set();
  for (const entry of await readdir(storeDir)) {
    const nodeModulesDir = join(storeDir, entry, "node_modules");
    if (!existsSync(nodeModulesDir)) continue;
    const topLevel = await readdir(nodeModulesDir, { withFileTypes: true });
    const packageJsonPaths = [];
    for (const dep of topLevel) {
      if (dep.name.startsWith("@") && dep.isDirectory()) {
        const scopeDir = join(nodeModulesDir, dep.name);
        for (const scoped of await readdir(scopeDir, { withFileTypes: true })) {
          if (scoped.isDirectory() || scoped.isSymbolicLink()) {
            packageJsonPaths.push(join(scopeDir, scoped.name, "package.json"));
          }
        }
      } else if (dep.isDirectory() || dep.isSymbolicLink()) {
        packageJsonPaths.push(join(nodeModulesDir, dep.name, "package.json"));
      }
    }
    for (const packageJson of packageJsonPaths) {
      if (!existsSync(packageJson)) continue;
      const pkg = JSON.parse(await readFile(packageJson, "utf8"));
      const key = `${pkg.name}@${pkg.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transitiveJs.push({
        name: pkg.name,
        version: pkg.version,
        license: licenseFromPackage(pkg) || "UNKNOWN",
        source: repoUrl(pkg),
        licenseTextPath: findLicenseFile(dirname(packageJson)),
      });
    }
  }
}

// 直接依赖以 store 版本为准去重合并（直接依赖必在 store 中）
const jsByKey = new Map();
for (const item of transitiveJs) jsByKey.set(`${item.name}@${item.version}`, item);
const jsEntries = [];
const directNames = new Set(directJs.map((d) => d.name));
for (const item of transitiveJs) {
  jsEntries.push({ ...item, direct: directNames.has(item.name) });
}

// ---------- 3. Cargo ----------
const cargoEntries = [];
{
  const raw = execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml"),
      "--locked",
      "--format-version",
      "1",
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  const metadata = JSON.parse(raw);
  for (const pkg of metadata.packages ?? []) {
    if (pkg.source === null || pkg.source === undefined) continue; // workspace 自身
    const registrySrc = pkg.manifest_path ? resolve(dirname(pkg.manifest_path)) : null;
    cargoEntries.push({
      name: pkg.name,
      version: pkg.version,
      license: norm(pkg.license) || "UNKNOWN",
      source:
        pkg.repository ??
        (pkg.source?.startsWith("registry+crates.io")
          ? "https://crates.io/crates/" + pkg.name
          : null),
      licenseTextPath: findLicenseFile(registrySrc),
    });
  }
}

// ---------- 4. 字体 ----------
const fontEntries = [
  {
    name: "Noto Sans SC Regular (WOFF2)",
    version: "SubsetOTF converted via fontTools ttLib.woff2 (lossless)",
    license: "OFL-1.1",
    source: "https://github.com/notofonts/noto-cjk (Sans/SubsetOTF/SC)",
    file: "assets/fonts/noto-sans-sc-regular.woff2",
  },
  {
    name: "Noto Sans SC Bold (WOFF2)",
    version: "SubsetOTF converted via fontTools ttLib.woff2 (lossless)",
    license: "OFL-1.1",
    source: "https://github.com/notofonts/noto-cjk (Sans/SubsetOTF/SC)",
    file: "assets/fonts/noto-sans-sc-bold.woff2",
  },
  {
    name: "LXGW WenKai Regular (WOFF2)",
    version: "v1.520 converted via fontTools ttLib.woff2 (lossless)",
    license: "OFL-1.1",
    source: "https://github.com/lxgw/LxgwWenKai",
    file: "assets/fonts/lxgw-wenkai-regular.woff2",
  },
  {
    name: "SIL Open Font License 1.1 text",
    version: "1.1",
    license: "OFL-1.1 (license text)",
    source: "notofonts/noto-cjk repository",
    file: "assets/fonts/OFL-1.1.txt",
  },
];
for (const font of fontEntries) {
  const abs = resolve(ROOT, font.file);
  if (!existsSync(abs)) throw new Error(`字体资产缺失：${font.file}`);
  font.licenseTextPath = resolve(ROOT, "assets/fonts/OFL-1.1.txt");
}

// ---------- 5. 不同许可的代表性全文 ----------
const canonicalByAtom = new Map();
const allEntries = [...jsEntries, ...cargoEntries, ...fontEntries];
for (const entry of allEntries) {
  for (const atom of licenseAtoms(entry.license)) {
    if (canonicalByAtom.has(atom)) continue;
    if (entry.licenseTextPath && existsSync(entry.licenseTextPath)) {
      canonicalByAtom.set(atom, entry.licenseTextPath);
    }
  }
}

const relPath = (p) => (p ? relative(ROOT, p) : null);
const byNameVersion = (a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`);
jsEntries.sort(byNameVersion);
cargoEntries.sort(byNameVersion);

function row(entry) {
  const source = entry.source ?? "(见上游发布渠道)";
  const text = relPath(entry.licenseTextPath) ?? "(包内未随附独立文本文件)";
  return `- \`${entry.name}@${entry.version}\` — License: ${entry.license} — Source: ${source} — Text: ${text}`;
}

const lines = [];
lines.push("# Third-Party Notices");
lines.push("");
lines.push("Mind Map Tool（© 2026 ErDong Zou，MIT License，见根 LICENSE）");
lines.push("包含以下第三方组件与资产。各条目按其原始许可分发，权利归各自权利人所有；");
lines.push("本文件完整枚举实际分发的 JavaScript、Cargo 与字体资产及其许可（生成于 PRR-060，");
lines.push(
  "由 `scripts/quality/generate-third-party-notices.mjs` 从 pnpm store、`cargo metadata --locked`",
);
lines.push("与 `assets/fonts/` 登记确定性生成；`pnpm license:scan` 校验每个条目均被覆盖）。");
lines.push("");
lines.push(`- JavaScript packages（direct + transitive）：${jsEntries.length}`);
lines.push(`- Cargo packages：${cargoEntries.length}`);
lines.push(`- Fonts / license texts：${fontEntries.length}`);
lines.push("");
lines.push("## Fonts（随应用分发的字体）");
lines.push("");
lines.push("| 资产 | 版本/形态 | 许可 | 来源 | 分发文件 |");
lines.push("| --- | --- | --- | --- | --- |");
for (const font of fontEntries) {
  lines.push(
    `| ${font.name} | ${font.version} | ${font.license} | ${font.source} | \`${font.file}\` |`,
  );
}
lines.push("");
lines.push("OFL 1.1 全文见 `assets/fonts/OFL-1.1.txt`（随包分发保留；附录亦嵌入）。");
lines.push("WOFF2 为无损格式转换（名称表未改、无字形修改），Reserved Font Name 义务不变；");
lines.push("禁止单独出售字体本体。");
lines.push("");
lines.push("## JavaScript packages");
lines.push("");
lines.push("格式：`name@version` — License — Source — 本地许可文本路径（构建环境）。");
lines.push("标 ★ 的为 workspace 直接声明依赖。");
lines.push("");
for (const entry of jsEntries) {
  lines.push((entry.direct ? "★ " : "") + row(entry));
}
lines.push("");
lines.push("## Cargo packages");
lines.push("");
for (const entry of cargoEntries) {
  lines.push(row(entry));
}
lines.push("");
lines.push("## License texts（出现的每个不同许可的代表性全文）");
lines.push("");
const atoms = [...canonicalByAtom.keys()].sort();
for (const atom of atoms) {
  const textPath = canonicalByAtom.get(atom);
  lines.push(`### ${atom}`);
  lines.push("");
  lines.push(`代表性全文来源：\`${relPath(textPath)}\``);
  lines.push("");
  lines.push("```text");
  // 上游 LICENSE 可能是 CRLF；统一输出 LF，保证重跑与版本库内容字节一致。
  const text = readFileSync(textPath, "utf8").replaceAll("\r\n", "\n").trimEnd();
  lines.push(text);
  lines.push("```");
  lines.push("");
}
lines.push("## Notes");
lines.push("");
lines.push(
  "- `Text:` 路径指构建环境中该依赖自带的许可文本文件（node_modules / cargo registry src）。",
);
lines.push("- 本候选为本地验收构建（unsigned / not published）；正式公开发布前的法律复核");
lines.push("  属于独立授权的发布执行任务范围。");
lines.push("");

await writeFile(OUTPUT, lines.join("\n") + "\n");
console.log(
  `generate-third-party-notices: OK -> ${relative(ROOT, OUTPUT)} ` +
    `(JS ${jsEntries.length} [direct ${directJs.length}], Cargo ${cargoEntries.length}, fonts ${fontEntries.length}, license atoms ${atoms.length})`,
);
