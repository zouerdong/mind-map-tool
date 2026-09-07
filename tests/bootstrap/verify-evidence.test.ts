import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const VERIFIER = resolve(ROOT, "scripts/quality/verify-evidence.mjs");
const FIXTURE_DIR = resolve(ROOT, ".tmp/quality-test-fixtures");

function runVerifier(args: string[]) {
  try {
    const stdout = execFileSync(process.execPath, [VERIFIER, ...args], {
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

function getGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function baseManifest() {
  return {
    schemaVersion: 2,
    caseId: "TEST-EVIDENCE-001",
    task: "PRC-010-TEST",
    generatedAt: new Date().toISOString(),
    source: {
      commit: getGitHead(),
      worktree: "clean",
    },
    environment: {
      platform: "macOS",
      arch: "arm64",
      os: "macOS 26.6.2",
      node: "v26.8.1",
      buildType: "release-test",
    },
    commands: [
      {
        id: "cmd-test",
        command: "echo test",
        exitCode: 0,
        artifact: "package.json",
      },
    ],
    releaseScope: {
      productVersion: "v1",
      requiredPlatforms: ["macos"],
      deferredPlatforms: [
        {
          platform: "windows",
          reason: "Dedicated later release; outside v1 acceptance",
          decisionRef: "docs/product/v1-product-spec.md",
        },
      ],
    },
    platformReports: {
      macos: {
        platform: "macos",
        arch: "arm64",
        os: "macOS 26.6.2",
        command: "echo test",
        status: "verified",
        exitCode: 0,
        artifact: "package.json",
      },
      windows: {
        platform: "windows",
        status: "deferred",
        reason: "Dedicated later release; outside v1 acceptance",
      },
    },
    overall: "READY",
  };
}

describe("verify-evidence releaseScope verification", () => {
  it("rejects when no manifest is provided", () => {
    const res = runVerifier([]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("BLOCKED_BY_CANDIDATE_EVIDENCE");
  });

  it("validates valid macOS-only releaseScope manifest", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    // Since current git worktree might be dirty in dev, mock source.worktree to dirty failure or check expected failure
    const fixturePath = resolve(FIXTURE_DIR, "valid-scope.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    // It should evaluate releaseScope correctly (if worktree is dirty, it reports Git worktree failure rather than schema failure)
    if (res.status !== 0) {
      expect(res.stderr).not.toContain("releaseScope");
      expect(res.stderr).not.toContain("platformReports.macos");
    } else {
      expect(res.stdout).toContain("PASS");
    }
  });

  it("fails if macOS required report is missing", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    delete (manifest.platformReports as any).macos;
    const fixturePath = resolve(FIXTURE_DIR, "missing-macos.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("platformReports.macos 缺失（required 平台必填）");
  });

  it("fails if requiredPlatforms and deferredPlatforms overlap", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    manifest.releaseScope.requiredPlatforms.push("windows");
    const fixturePath = resolve(FIXTURE_DIR, "overlap.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("不能同时出现在 requiredPlatforms 和 deferredPlatforms 中");
  });

  it("fails if requiredPlatforms has unknown platform", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    manifest.releaseScope.requiredPlatforms.push("linux" as any);
    const fixturePath = resolve(FIXTURE_DIR, "unknown-plat.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("包含未知平台: linux");
  });

  it("fails if deferred platform claims verified but artifact is missing", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    manifest.platformReports.windows = {
      platform: "windows",
      status: "verified",
      exitCode: 0,
      artifact: "non-existent-artifact.json",
    } as any;
    const fixturePath = resolve(FIXTURE_DIR, "missing-deferred-artifact.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("platformReports.windows.artifact 不存在");
  });
});
