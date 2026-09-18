// stage-mcp-runtime.mjs — 组装安装包内的 MCP 资源目录（ADR 0018）。
// 1) esbuild 打包 mindmap-mcp.mjs（资产内嵌）；
// 2) 下载 pinned Node 独立运行时 → mindmap-mcp(.exe)；
// 3) 两者放进 apps/desktop/src-tauri/resources/mcp/（tauri resources 映射到
//    安装包 mcp/ 目录；gitignored，构建前必须执行本脚本）。
// 用法：node scripts/stage-mcp-runtime.mjs --platform darwin-arm64|win-x64
//       （缺省按当前主机平台；Windows 构建只走 CI，见 release-build.yml）

import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES_DIR = resolve(REPO_ROOT, "apps/desktop/src-tauri/resources/mcp");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const platform =
  arg("platform") ??
  (process.platform === "darwin" && process.arch === "arm64"
    ? "darwin-arm64"
    : process.platform === "win32" && process.arch === "x64"
      ? "win-x64"
      : undefined);
if (!platform) {
  console.error(
    `stage-mcp-runtime: 未支持的主机平台 ${process.platform}/${process.arch}，请显式 --platform darwin-arm64|win-x64`,
  );
  process.exit(1);
}

const run = (script, args) =>
  execFileSync(process.execPath, [resolve(REPO_ROOT, script), ...args], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });

run("scripts/build-mcp-standalone.mjs", []);
// mjs 必须进入安装包资源目录（与运行时同目录），冒烟也打 staging 后的那份。
const STAGED_MJS = resolve(RESOURCES_DIR, "mindmap-mcp.mjs");
copyFileSync(resolve(REPO_ROOT, "apps/mcp-bridge/dist/mindmap-mcp.mjs"), STAGED_MJS);
run("scripts/fetch-node-standalone.mjs", ["--platform", platform, "--out", RESOURCES_DIR]);
run("scripts/smoke-mcp-standalone.mjs", [
  "--node",
  resolve(RESOURCES_DIR, platform === "win-x64" ? "mindmap-mcp.exe" : "mindmap-mcp"),
  "--bundle",
  STAGED_MJS,
]);
console.log(`stage-mcp-runtime: READY（${platform}）→ ${RESOURCES_DIR}`);
