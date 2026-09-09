// generate-icons.mjs — PRR-068 确定性图标生成流水线。
// 步骤：1) 用项目锁定的 @tauri-apps/cli `tauri icon` 生成完整平台集到 --out 临时目录；
//       2) 把 ICNS 规范化为稳定容器（icon-utils.canonicalIcns，仅稳定重排 chunk）；
//       3) 计算桌面 7 件的 bytes / SHA-256 / PNG IHDR 尺寸 / ICNS chunk 清单，
//          写出 tracked manifest（不写绝对路径与时间戳）。
// 本脚本只写 --out 目录，不修改仓库 icons/；集成复制与提交由实施回合完成。
// 使用（每轮独立全新目录，用于两轮一致性比对）：
//   node scripts/quality/generate-icons.mjs --out .tmp/prr-068-icon-generation

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MANIFEST_NAME,
  EXPECTED_MASTER_SHA256,
  ICON_FILE_NAMES,
  MASTER_SVG_REL,
  MANIFEST_SCHEMA_VERSION,
} from "./icon-baseline.mjs";
import { canonicalIcns, computeSha256, parseIcns, readPngIhdr } from "./icon-utils.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DESKTOP_DIR = join(ROOT, "apps/desktop");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const svgIdx = args.indexOf("--svg");
const OUT =
  outIdx === -1 ? join(ROOT, ".tmp/prr-068-icon-generation") : resolve(ROOT, args[outIdx + 1]);
const SVG = svgIdx === -1 ? join(ROOT, MASTER_SVG_REL) : resolve(ROOT, args[svgIdx + 1]);

// 母版先决：hash 必须与批准值一致，否则立即停止（fail-closed）。
const MASTER_BYTES = readFileSync(SVG);
const MASTER_SHA = computeSha256(MASTER_BYTES);
if (MASTER_SHA !== EXPECTED_MASTER_SHA256) {
  console.error(
    `generate-icons: BLOCKED — 母版 hash 与批准值不一致（期望 ${EXPECTED_MASTER_SHA256}，实际 ${MASTER_SHA}）`,
  );
  process.exit(1);
}

let CLI_VERSION;
try {
  // pnpm 生命周期回显会前置 "> @mindmap/desktop@0.1.0 tauri ..."，不能用首个 \d+\.\d+\.\d+；
  // 锚定 tauri-cli 行，取 CLI 包实际版本（如 2.11.4）。
  CLI_VERSION =
    execFileSync("pnpm", ["--filter", "@mindmap/desktop", "tauri", "--version"], {
      cwd: ROOT,
      encoding: "utf8",
    }).match(/tauri-cli (\d+\.\d+\.\d+)/)?.[1] ?? "unknown";
} catch {
  CLI_VERSION = "unknown";
}

mkdirSync(OUT, { recursive: true });
const svgRel = relative(DESKTOP_DIR, SVG);
const outRel = relative(DESKTOP_DIR, OUT);
const command = `pnpm --filter @mindmap/desktop tauri icon ${svgRel} --output ${outRel}`;
console.log(`generate-icons: ${command}（cwd: apps/desktop，CLI ${CLI_VERSION}）`);
const result = spawnSync(
  "pnpm",
  ["--filter", "@mindmap/desktop", "tauri", "icon", svgRel, "--output", outRel],
  {
    cwd: DESKTOP_DIR,
    stdio: "inherit",
  },
);
if (result.status !== 0) {
  console.error(`generate-icons: FAIL — tauri icon 退出码 ${result.status}`);
  process.exit(1);
}

// ICNS 规范化：重排为稳定容器并写回（只有 raw chunk 顺序不同时字节才会变）。
const icnsPath = join(OUT, "icon.icns");
const icnsRaw = readFileSync(icnsPath);
const icnsCanon = canonicalIcns(icnsRaw);
if (!icnsCanon.equals(icnsRaw)) {
  console.log(
    `generate-icons: ICNS 原始容器非稳定顺序——已规范化（${icnsRaw.length} → ${icnsCanon.length} 字节）`,
  );
}
writeFileSync(icnsPath, icnsCanon);

const outputs = [];
for (const name of ICON_FILE_NAMES) {
  const abs = join(OUT, name);
  if (!existsSync(abs)) {
    console.error(`generate-icons: FAIL — ${OUT} 缺少桌面输出 ${name}`);
    process.exit(1);
  }
  const bytes = readFileSync(abs);
  const entry = {
    path: name,
    kind: name.endsWith(".png") ? "png" : name.endsWith(".icns") ? "icns" : "ico",
    bytes: bytes.length,
    sha256: computeSha256(bytes),
  };
  if (entry.kind === "png") {
    const ihdr = readPngIhdr(bytes);
    entry.width = ihdr.width;
    entry.height = ihdr.height;
  } else if (entry.kind === "icns") {
    const chunks = parseIcns(bytes).chunks.map((chunk) => ({
      type: chunk.type,
      length: chunk.length,
    }));
    entry.chunks = chunks;
  }
  outputs.push(entry);
}

const manifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  asset: "mind-map-app-icon",
  stage: "desktop-icon-set",
  generator: {
    tool: "@tauri-apps/cli",
    version: CLI_VERSION,
    command,
    cwd: "apps/desktop",
    icnsNormalization:
      "canonical chunk re-order by (type, data bytes); no re-encode, no slot removal",
  },
  source: {
    path: MASTER_SVG_REL,
    width: 1024,
    height: 1024,
    sha256: MASTER_SHA,
  },
  outputs,
};
writeFileSync(join(OUT, DEFAULT_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`generate-icons: PASS — 桌面 7 件 + manifest 已写入 ${OUT}`);
for (const output of outputs)
  console.log(`  ${output.path.padEnd(16)} ${output.bytes} bytes  ${output.sha256}`);
