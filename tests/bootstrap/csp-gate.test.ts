import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SCANNER = resolve(ROOT, "scripts/quality/scan-network-endpoints.mjs");

function runScanner(tauriConf?: string) {
  const args = tauriConf ? [SCANNER, "--tauri-conf", tauriConf] : [SCANNER];
  try {
    const stdout = execFileSync(process.execPath, args, {
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

  it("当前生产 CSP 的 script-src 恰好包含 'wasm-unsafe-eval'（PRR-066 PNG WASM 编译）", async () => {
    const { readFileSync } = await import("node:fs");
    const conf = JSON.parse(
      readFileSync(resolve(ROOT, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
    );
    const csp: string = conf.app.security.csp;
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    const tokens = scriptSrc?.split(/\s+/).slice(1) ?? [];
    expect(tokens).toContain("'wasm-unsafe-eval'");
    expect(tokens).not.toContain("'unsafe-eval'");
    expect(tokens).not.toContain("unsafe-eval");
    expect(tokens).not.toContain("*");
  });
});

describe("PRR-066 红灯 1：CSP token 门禁（scanner 精确判定）", () => {
  const fixture = (name: string) => `tests/bootstrap/fixtures/${name}.json`;

  it("script-src 只加 'wasm-unsafe-eval' 时通过", () => {
    const res = runScanner(fixture("csp-wasm-unsafe-eval"));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("scan-network-endpoints: PASS");
  });

  it("普通 'unsafe-eval'（带引号）仍被拒绝，即使伴随 'wasm-unsafe-eval'", () => {
    const res = runScanner(fixture("csp-plain-unsafe-eval"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("CSP 禁止包含 unsafe-eval");
  });

  it("script-src 通配符 * 仍被拒绝", () => {
    const res = runScanner(fixture("csp-script-wildcard"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("CSP 包含未受限通配符");
  });

  it("远程 http/https endpoint 仍被拒绝，即使 wasm token 存在", () => {
    const res = runScanner(fixture("csp-remote-endpoint"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("CSP 包含远程 http/https endpoint");
  });

  it("CSP 缺失/为空仍被拒绝", () => {
    const res = runScanner(fixture("csp-missing"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("csp 为空或为 null");
  });
});
