// fetch-node-standalone.mjs — 下载 pinned Node 独立运行时并放入打包资源目录
//（ADR 0018：安装包内随附 mindmap-mcp(.exe)，Agent 无需本机 Node）。
// 完整性：对照 nodejs.org 官方 SHASUMS256.txt 校验（版本在此文件内写死）。
// 用法：node scripts/fetch-node-standalone.mjs --platform darwin-arm64|win-x64 --out <dir>

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NODE_VERSION = "v24.21.0";

const PLATFORMS = {
  "darwin-arm64": {
    archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    inner: `node-${NODE_VERSION}-darwin-arm64/bin/node`,
    outName: "mindmap-mcp",
  },
  "win-x64": {
    archive: `node-${NODE_VERSION}-win-x64.zip`,
    inner: `node-${NODE_VERSION}-win-x64/node.exe`,
    outName: "mindmap-mcp.exe",
  },
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const platform = arg("platform");
const outDir = arg("out");
if (!platform || !(platform in PLATFORMS) || !outDir) {
  console.error(
    `用法: node scripts/fetch-node-standalone.mjs --platform ${Object.keys(PLATFORMS).join("|")} --out <dir>`,
  );
  process.exit(1);
}

const spec = PLATFORMS[platform];
const baseUrl = `https://nodejs.org/dist/${NODE_VERSION}`;

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const archiveBuf = await download(`${baseUrl}/${spec.archive}`);
const shasums = (await download(`${baseUrl}/SHASUMS256.txt`)).toString("utf8");
const expected = shasums
  .split("\n")
  .find((l) => l.trim().endsWith(` ${spec.archive}`))
  ?.split(/\s+/)[0];
if (!expected) throw new Error(`SHASUMS256.txt 中未找到 ${spec.archive}`);
const actual = createHash("sha256").update(archiveBuf).digest("hex");
if (actual !== expected) {
  throw new Error(`sha256 不匹配：期望 ${expected}，实际 ${actual}`);
}

// 解包（tar 在 macOS / Windows runner 上均为 bsdtar，可同时处理 .tar.gz 与 .zip）。
const work = mkdtempSync(join(tmpdir(), "node-standalone-"));
try {
  const archivePath = join(work, spec.archive);
  writeFileSync(archivePath, archiveBuf);
  execFileSync("tar", ["-xf", archivePath, "-C", work], { stdio: "inherit" });
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, spec.outName);
  copyFileSync(join(work, spec.inner), outPath);
  if (platform !== "win-x64") chmodSync(outPath, 0o755);
  console.log(`fetch-node-standalone: OK ${NODE_VERSION} ${platform} → ${outPath}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
