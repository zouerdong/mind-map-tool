import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SCANNER = resolve(ROOT, "scripts/quality/scan-network-endpoints.mjs");

function runScanner() {
  try {
    const stdout = execFileSync(process.execPath, [SCANNER], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

describe("PRC-040: 生产 CSP 与最小权限 Capability 门禁", () => {
  it("当前配置通过网络扫描与 CSP 门禁", () => {
    const res = runScanner();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("scan-network-endpoints: PASS");
  });
});
