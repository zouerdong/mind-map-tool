// bundle-gate.mjs — 打包 fail-closed 门（bundle:tauri/bundle:electron 的薄封装）。
// 检测到签名配置/凭据迹象即拒绝执行。--unsigned 显式传递时不放松检查。
// 用法：node bundle-gate.mjs --host tauri -- <原始命令...>

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const args = process.argv.slice(2);
const hostIdx = args.indexOf("--host");
const host = hostIdx === -1 ? null : args[hostIdx + 1];
const dashdash = args.indexOf("--");
const command = dashdash === -1 ? [] : args.slice(dashdash + 1);

if (!host || command.length === 0) {
  console.error("usage: bundle-gate.mjs --host <tauri|electron> -- <command...>");
  process.exit(2);
}

// 签名/凭据检测：环境或配置出现即 fail-closed
const SIGNING_HINTS = {
  env: [
    "APPLE_CERTIFICATE",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "KEYCHAIN",
    "TAURI_SIGNING_PRIVATE_KEY",
    "CSC_LINK",
    "WIN_CSC_LINK",
  ],
  files: ["apps/desktop/src-tauri/Entitlements.plist", "apps/desktop/build/entitlements.mac.plist"],
};

const hits = [];
for (const key of SIGNING_HINTS.env) {
  for (const envVar of Object.keys(process.env)) {
    if (envVar.includes(key)) hits.push(`env:${envVar}`);
  }
}
for (const f of SIGNING_HINTS.files) {
  if (existsSync(resolve(ROOT, f))) hits.push(`file:${f}`);
}
// tauri.conf.json 显式签名段
const tauriConf = resolve(ROOT, "apps/desktop/src-tauri/tauri.conf.json");
if (host === "tauri" && existsSync(tauriConf)) {
  const text = readFileSync(tauriConf, "utf8");
  if (/signingIdentity|providerShortName|publisher/i.test(text))
    hits.push("tauri.conf.json signing fields");
}

if (hits.length) {
  console.error(`bundle-gate: FAIL — 检测到签名配置/凭据迹象（${hits.join(", ")}）。`);
  console.error("签名/公证是独立授权门槛，不能由打包脚本顺带执行（MM-100/G2 规则）。");
  process.exit(1);
}

console.log(`bundle-gate: unsigned 路径放行（host=${host}，未检测到签名配置）`);
const r = spawnSync(command[0], command.slice(1), { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
