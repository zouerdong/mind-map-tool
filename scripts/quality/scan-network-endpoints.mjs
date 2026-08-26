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

// 产品代码零网络端点；此清单保留为显式豁免通道（当前为空）。
const ALLOWLIST = []; // e.g. /^https:\/\/example\.com\/ok/

const PATTERNS = [
  { re: /fetch\s*\(/, label: "fetch(" },
  { re: /XMLHttpRequest/, label: "XMLHttpRequest" },
  { re: /new\s+WebSocket/, label: "WebSocket" },
  { re: /https?:\/\/(?!localhost|127\.0\.0\.1|schema\.tauri\.app)/, label: "http(s) URL" },
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
      if (m && !ALLOWLIST.some((a) => a.test(text))) {
        violations.push(`${file.replace(ROOT + "/", "")}: ${label}`);
      }
    }
  }
}

if (violations.length) {
  console.error(`scan-network-endpoints: FAIL (${scanned} files scanned)`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`scan-network-endpoints: PASS (${scanned} files, 0 endpoints)`);
