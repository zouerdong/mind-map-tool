// scan-network-endpoints.mjs — 断言源码中不存在网络端点（本地优先产品，
// AC-13：无服务器、云、遥测、未审阅网络调用）。允许清单之外的任何
// fetch/http/ws/axios 等即 FAIL。
// 用法：node scripts/quality/scan-network-endpoints.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const SCAN_DIRS = [
  "packages/core/src",
  "packages/export/src",
  "packages/ui/src",
  "packages/platform/src",
  "apps/desktop/src",
  "apps/desktop/src-tauri/src",
];

// 产品代码零网络端点；此清单保留为显式豁免通道。
// 结构：{ file, pattern, reason } —— 窄豁免（单文件单模式），
// 每条必须有 reason；审查可见，fail-closed（其余文件全禁）。
const ALLOWLIST = [
  {
    file: "apps/desktop/src/app/ports.ts",
    label: "fetch(",
    pattern: /fetch\s*\(/,
    reason:
      "MM-080：加载 vite ?url 打包的同源 dist 资产（字体 OTF/TTF 与 resvg wasm，相对路径资源 URL），非网络端点（AC-13）",
  },
];

const PATTERNS = [
  { re: /fetch\s*\(/, label: "fetch(" },
  { re: /XMLHttpRequest/, label: "XMLHttpRequest" },
  { re: /new\s+WebSocket/, label: "WebSocket" },
  {
    re: /https?:\/\/(?!localhost|127\.0\.0\.1|schema\.tauri\.app|www\.w3\.org)/,
    label: "http(s) URL",
  }, // w3.org = SVG/XML 命名空间 URI，非网络请求
  { re: /reqwest::/, label: "reqwest (rust)" },
  { re: /TcpListener|UdpSocket/, label: "network listener (rust)" },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|rs)$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
let scanned = 0;
for (const dir of SCAN_DIRS) {
  for (const file of walk(resolve(ROOT, dir))) {
    scanned++;
    const text = readFileSync(file, "utf8");
    for (const { re, label } of PATTERNS) {
      const m = text.match(re);
      const rel = file.replace(ROOT + "/", "");
      const exempted = ALLOWLIST.some(
        (a) => a.file === rel && a.label === label && a.pattern.test(text),
      );
      if (m && !exempted) {
        violations.push(`${rel}: ${label}`);
      }
    }
  }
}

// PRC-040: 生产 CSP 与最小权限 Capability 审计
const tauriConfPath = resolve(ROOT, "apps/desktop/src-tauri/tauri.conf.json");
if (existsSync(tauriConfPath)) {
  try {
    const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
    const csp = tauriConf?.app?.security?.csp;
    if (!csp || typeof csp !== "string" || csp.trim() === "") {
      violations.push(
        "tauri.conf.json: app.security.csp 为空或为 null（生产发布必须配置最小 CSP）",
      );
    } else {
      if (csp.includes("default-src *") || csp.includes("script-src *")) {
        violations.push("tauri.conf.json: CSP 包含未受限通配符 (*)");
      }
      if (csp.includes("unsafe-eval")) {
        violations.push("tauri.conf.json: CSP 禁止包含 unsafe-eval");
      }
      if (/https?:\/\/(?!localhost|127\.0\.0\.1)/.test(csp)) {
        violations.push("tauri.conf.json: CSP 包含远程 http/https endpoint");
      }
    }
  } catch (e) {
    violations.push(`tauri.conf.json 解析失败：${e.message}`);
  }
}

// 审计 capabilities/*.json
const capDir = resolve(ROOT, "apps/desktop/src-tauri/capabilities");
const APPROVED_PERMISSIONS = new Set([
  "core:default",
  "core:event:allow-listen",
  "core:event:allow-unlisten",
]);
if (existsSync(capDir)) {
  for (const name of readdirSync(capDir)) {
    if (!name.endsWith(".json")) continue;
    const capPath = resolve(capDir, name);
    try {
      const cap = JSON.parse(readFileSync(capPath, "utf8"));
      const permissions = cap.permissions ?? [];
      for (const p of permissions) {
        if (!APPROVED_PERMISSIONS.has(p)) {
          violations.push(`capabilities/${name}: 未批准的权限条目 '${p}'`);
        }
      }
    } catch (e) {
      violations.push(`capabilities/${name} 解析失败：${e.message}`);
    }
  }
}

if (violations.length) {
  console.error(`scan-network-endpoints: FAIL (${scanned} files scanned)`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`scan-network-endpoints: PASS (${scanned} files, 0 endpoints)`);
