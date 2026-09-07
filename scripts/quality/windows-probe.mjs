// MRT-004W2R Windows 同源 probe（任务卡 §8）——一条命令可重复执行：
//   node scripts/quality/windows-probe.mjs [--out <dir>]
// 步骤：
//   1. 主 crate `cargo check --target x86_64-pc-windows-msvc --lib`（如实
//      记录既有 icons/icon.ico baseline blocker，不修改配置绕过）；
//   2. 把本批生产源码（lifecycle 全量 + file 全量 + ipc 的 serde DTO）复制进
//      独立 crate，在 Windows target 上编译。cfg 边界证明：cfg(unix) 测试与
//      Unix provider 完整，非 Unix 走 CanonicalOnlyProvider。tauri 命令薄壳
//      属 tauri 自身跨平台性，不进 probe。
// 输出：<out>/probe.log（raw 汇总）、<out>/log/*.log（原始命令输出）、
//       <out>/source-sha256.txt（复制源码的 SHA-256 清单）。probe 编译失败退出码非 0。

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const out = path.resolve(
  args.includes("--out") ? args[args.indexOf("--out") + 1] : ".tmp/w2r-winprobe",
);
const TARGET = "x86_64-pc-windows-msvc";
const SRC = path.resolve("apps/desktop/src-tauri/src");
const logLines = [];
const log = (m) => {
  logLines.push(m);
  console.log(`[winprobe] ${m}`);
};
const run = (cmd, cwd) =>
  spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd: cwd ?? process.cwd() });

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "log"), { recursive: true });
mkdirSync(path.join(out, "src", "lifecycle"), { recursive: true });
mkdirSync(path.join(out, "src", "file"), { recursive: true });
log(`== ${new Date().toISOString()} MRT-004W2R Windows 同源 probe ==`);

// ---- 1. 主 crate target check ----
log(`-- 1. 主 crate cargo check --target ${TARGET} --lib`);
const mainCheck = run([
  "cargo",
  "check",
  "--manifest-path",
  "apps/desktop/src-tauri/Cargo.toml",
  "--target",
  TARGET,
  "--lib",
]);
writeFileSync(path.join(out, "log", "main-crate-check.log"), mainCheck.stdout + mainCheck.stderr);
let mainResult = 0;
if (mainCheck.status === 0) {
  log("主 crate check: PASS");
} else {
  mainResult = mainCheck.status ?? 1;
  log(`主 crate check: BLOCKED（exit=${mainResult}）—— 既有 baseline（截选）：`);
  const hits = (mainCheck.stderr + mainCheck.stdout)
    .split("\n")
    .filter((l) => /icon\.ico|error\[/.test(l))
    .slice(0, 3);
  for (const h of hits) log(`   ${h.trim()}`);
}

// ---- 2. 同源 probe crate ----
log("-- 2. 复制生产源码到独立 crate");
const lifecycleFiles = [
  "runtime.rs",
  "launch_coordinator.rs",
  "window_registry.rs",
  "mod.rs",
  "close.rs",
  "launch.rs",
];
const fileFiles = [
  "mod.rs",
  "identity.rs",
  "handle.rs",
  "authorization.rs",
  "commit.rs",
  "error.rs",
  "preferences.rs",
];
for (const f of lifecycleFiles) {
  const p = path.join(SRC, "lifecycle", f);
  if (!existsSync(p)) throw new Error(`缺失 ${p}`);
  cpSync(p, path.join(out, "src", "lifecycle", f));
}
for (const f of fileFiles) {
  const p = path.join(SRC, "file", f);
  if (!existsSync(p)) throw new Error(`缺失 ${p}`);
  cpSync(p, path.join(out, "src", "file", f));
}
// ipc 层：精确提取 runtime.rs 引用的 serde DTO（CommitDocumentPayload /
// CommitReceiptDto）——整文件复制会带入 tauri 依赖，逐行剔除会破坏括号
{
  const src = readFileSync(path.join(SRC, "ipc", "mod.rs"), "utf8");
  const cut = (name) => {
    const start =
      src.indexOf(`pub enum ${name}`) >= 0
        ? src.indexOf(`pub enum ${name}`)
        : src.indexOf(`pub struct ${name}`);
    if (start < 0) throw new Error(`ipc/mod.rs 中未找到 ${name}`);
    // 向前包含 derive/serde 属性
    let head = start;
    for (;;) {
      const prevNl = src.lastIndexOf("\n", head - 2) + 1;
      const prev = src.slice(prevNl, head - 1).trim();
      if (prev.startsWith("#[")) head = prevNl;
      else break;
    }
    // 大括号配平截取
    let depth = 0;
    let i = src.indexOf("{", start);
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return src.slice(head, i + 1);
  };
  const implBlock = src.slice(
    src.indexOf("impl CommitReceiptDto"),
    src.indexOf("fn from_receipt") > 0 ? src.indexOf("fn from_receipt") : src.length,
  );
  const header = `use serde::{Deserialize, Serialize};\n\nuse crate::file::Receipt;\n\n`;
  const body = [cut("CommitDocumentPayload"), cut("CommitReceiptDto")].join("\n\n");
  // CommitReceiptDto 的 impl（finalized/recovery_pending 构造器）
  const implStart = src.indexOf("impl CommitReceiptDto");
  let implText = "";
  if (implStart >= 0) {
    let depth = 0;
    let i = src.indexOf("{", implStart);
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    implText = src.slice(implStart, i + 1);
  }
  writeFileSync(path.join(out, "src", "ipc_dto.rs"), header + body + "\n\n" + implText + "\n");
}
let runtime = readFileSync(path.join(out, "src", "lifecycle", "runtime.rs"), "utf8");
runtime = runtime.replace(/crate::ipc::/g, "crate::ipc_dto::");
writeFileSync(path.join(out, "src", "lifecycle", "runtime.rs"), runtime);

writeFileSync(
  path.join(out, "Cargo.toml"),
  `[package]
name = "w2r-winprobe"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
sha2 = "0.10"
base64 = "0.22"
tempfile = "3"

[workspace]
`,
);
writeFileSync(
  path.join(out, "src", "main.rs"),
  `// 同源 probe 入口：仅承载编译（lifecycle/file 原样编译进 Windows target）
mod file;
mod ipc_dto;
mod lifecycle;
fn main() {
    println!("w2r winprobe: lifecycle + file compiled for windows");
}
`,
);

log("-- 源码 SHA-256 清单");
const shaList = spawnSync(
  "shasum",
  [
    "-a",
    "256",
    ...lifecycleFiles.map((f) => `lifecycle/${f}`),
    ...fileFiles.map((f) => `file/${f}`),
  ],
  { encoding: "utf8", cwd: SRC },
);
writeFileSync(path.join(out, "source-sha256.txt"), shaList.stdout);
for (const l of shaList.stdout.trim().split("\n")) log(`   ${l}`);

log(`-- 3. cargo check --target ${TARGET}（probe crate）`);
const probeCheck = run([
  "cargo",
  "check",
  "--manifest-path",
  path.join(out, "Cargo.toml"),
  "--target",
  TARGET,
]);
writeFileSync(path.join(out, "log", "probe-check.log"), probeCheck.stdout + probeCheck.stderr);
let probeResult = 0;
if (probeCheck.status === 0) {
  log("probe check: PASS（cfg 边界完整：非 Unix 走 CanonicalOnlyProvider）");
} else {
  probeResult = probeCheck.status ?? 1;
  log(`probe check: FAIL（exit=${probeResult}）—— 尾部输出：`);
  for (const l of (probeCheck.stderr + probeCheck.stdout).trim().split("\n").slice(-15))
    log(`   ${l}`);
}

log(
  `== 结果：main-crate=${mainResult} probe=${probeResult}（main 预期被既有 icon.ico baseline 阻断，如实记录；probe=0 为通过）`,
);
writeFileSync(path.join(out, "probe.log"), logLines.join("\n") + "\n");
process.exit(probeResult);
