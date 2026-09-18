// fetch-node-standalone.mjs — 下载 pinned Node 独立运行时并放入打包资源目录
//（ADR 0018：安装包内随附 mindmap-mcp(.exe)，Agent 无需本机 Node）。
// 完整性：对照 nodejs.org 官方 SHASUMS256.txt 校验（版本在此文件内写死）。
// 用法：node scripts/fetch-node-standalone.mjs --platform darwin-arm64|win-x64 --out <dir>

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
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

// 纯 Node 解压 zip 单条目（解析中央目录，不依赖外部 tar/unzip——Windows
// runner 的 Git Bash tar 不能解 zip，2026-09-18 CI 失败教训）。
function unzipEntry(buf, wantedName) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip EOCD 未找到");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("zip 中央目录损坏");
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (name === wantedName) {
      const lhNameLen = buf.readUInt16LE(localOff + 26);
      const lhExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return comp;
      if (method === 8) return inflateRawSync(comp);
      throw new Error(`不支持的 zip 压缩方式 ${method}`);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip 中未找到 ${wantedName}`);
}

// 解包（.tar.gz 走 bsdtar；.zip 走上面的纯 Node 解压）。
const work = mkdtempSync(join(tmpdir(), "node-standalone-"));
try {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, spec.outName);
  if (spec.archive.endsWith(".zip")) {
    writeFileSync(outPath, unzipEntry(archiveBuf, spec.inner));
  } else {
    const archivePath = join(work, spec.archive);
    writeFileSync(archivePath, archiveBuf);
    execFileSync("tar", ["-xf", archivePath, "-C", work], { stdio: "inherit" });
    copyFileSync(join(work, spec.inner), outPath);
  }
  if (platform !== "win-x64") chmodSync(outPath, 0o755);
  console.log(`fetch-node-standalone: OK ${NODE_VERSION} ${platform} → ${outPath}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
