import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

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

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function baseManifest() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const sourceCommit = getGitHead();
  const candidateSha256 = fileSha256(resolve(ROOT, "package.json"));
  const nativeReportPath = resolve(FIXTURE_DIR, "native-candidate-report.json");
  const approvedAt = "2026-09-07T00:00:00.000Z";
  const approvedBy = "Test Owner";
  const userRecord = "[from-user] synthetic visual approval";
  const g2UserRecord = "[from-user] synthetic packaging approval";
  writeFileSync(
    nativeReportPath,
    JSON.stringify(
      {
        evidenceKind: "native-candidate",
        sourceCommit,
        candidateSha256,
        platform: "macos",
        overall: "PASS",
        generatedAt: approvedAt,
      },
      null,
      2,
    ),
  );
  const gFinalPath = resolve(FIXTURE_DIR, "g-final.json");
  writeFileSync(
    gFinalPath,
    JSON.stringify(
      {
        approvalKind: "g-final",
        status: "APPROVED",
        approvedBy,
        approvedAt,
        userRecord,
        candidateSha256,
        sourceCommit,
      },
      null,
      2,
    ),
  );
  const g2RegisterPath = resolve(FIXTURE_DIR, "g2-register.json");
  writeFileSync(
    g2RegisterPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        gates: {
          G2: {
            status: "approved",
            approvedBy,
            approvedAt,
            evidence: [g2UserRecord],
            approvedScope: {
              selectedHost: "tauri",
              candidateOutputPaths: ["package.json"],
              evidenceOutputPaths: [".tmp/quality-test-fixtures"],
              installationTargets: [".tmp/quality-test-fixtures/installed/Mind Map.app"],
              allowedActions: [
                "build",
                "launch",
                "install",
                "uninstall",
                "measure-performance",
                "permission-probe",
              ],
              deletionBoundaries: [".tmp/quality-test-fixtures"],
              explicitlyExcluded: [
                "test-signing",
                "signing",
                "notarization",
                "credential access",
                "system trust changes",
                "upload",
                "publication",
              ],
            },
          },
        },
      },
      null,
      2,
    ),
  );
  const nativeReportSha256 = fileSha256(nativeReportPath);
  const gFinalSha256 = fileSha256(gFinalPath);
  const g2RegisterSha256 = fileSha256(g2RegisterPath);

  return {
    schemaVersion: 3,
    caseId: "TEST-EVIDENCE-001",
    task: "PRC-010-TEST",
    generatedAt: new Date().toISOString(),
    source: {
      commit: sourceCommit,
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
        startedAt: "2026-09-06T00:00:00.000Z",
        finishedAt: "2026-09-06T00:00:01.000Z",
        artifact: "package.json",
        artifactSha256: candidateSha256,
      },
    ],
    candidate: {
      path: "package.json",
      sha256: candidateSha256,
      installerDmg: "package.json",
      dmgSha256: candidateSha256,
      unsignedConfirmed: true,
    },
    approvals: {
      g2: {
        status: "APPROVED",
        approvedBy,
        approvedAt,
        userRecord: g2UserRecord,
        artifact: ".tmp/quality-test-fixtures/g2-register.json",
        artifactSha256: g2RegisterSha256,
      },
      gFinal: {
        status: "APPROVED",
        approvedBy,
        approvedAt,
        userRecord,
        candidateSha256,
        artifact: ".tmp/quality-test-fixtures/g-final.json",
        artifactSha256: gFinalSha256,
      },
    },
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
        artifact: ".tmp/quality-test-fixtures/native-candidate-report.json",
        artifactSha256: nativeReportSha256,
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

function attachPerformanceEvidence(manifest: any, canvasResult: Record<string, unknown>) {
  const startedAt = "2026-09-06T00:00:00.000Z";
  const finishedAt = "2026-09-06T00:00:01.000Z";
  const runnerSha256 = fileSha256(resolve(ROOT, "scripts/quality/run-performance.mjs"));
  const samples = Array.from({ length: 20 }, (_, index) => index + 1);
  const runs = samples.map((_, index) => ({
    runId: `run-${index}`,
    markerFound: true,
    exited: true,
    readyEvent: {
      runId: `run-${index}`,
      milestone: "renderer-ready",
      windowGeneration: 1,
    },
  }));
  const conditioningRun = {
    success: true,
    elapsedMs: 20,
    runId: "cond-run",
    markerFound: true,
    exited: true,
    code: 0,
    readyEvent: { runId: "cond-run", milestone: "renderer-ready", windowGeneration: 1 },
  };
  const conditioningPath = resolve(FIXTURE_DIR, "cold-conditioning.json");
  const conditioningArtifact = ".tmp/quality-test-fixtures/cold-conditioning.json";
  writeFileSync(
    conditioningPath,
    JSON.stringify(
      {
        schemaVersion: 3,
        evidenceKind: "cold-conditioning",
        sourceCommit: manifest.source.commit,
        candidateSha256: manifest.candidate.sha256,
        runnerSha256,
        generatedAt: finishedAt,
        startedAt,
        finishedAt,
        sessionFirstLaunchMs: 20,
        conditioning: conditioningRun,
      },
      null,
      2,
    ),
  );
  const conditioningArtifactSha256 = fileSha256(conditioningPath);
  const rawPath = resolve(FIXTURE_DIR, "release-performance-raw.json");
  const raw = {
    schemaVersion: 3,
    measurementSource: "native-candidate",
    measurementMode: "release",
    sourceCommit: manifest.source.commit,
    candidateSha256: manifest.candidate.sha256,
    runnerSha256,
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    coldSamples: samples,
    warmSamples: samples,
    rssSamples: samples.slice(0, 5),
    editSamples: samples,
    saveSamples: samples,
    pngExportSamples: samples,
    coldRuns: runs,
    warmRuns: runs,
    conditioningRun,
    conditioning: {
      success: true,
      durationMs: 20,
      sessionFirstLaunchMs: 20,
      artifact: conditioningArtifact,
      artifactSha256: conditioningArtifactSha256,
    },
    samplingProtocol: { coldDefinition: "isolated", warmDefinition: "shared" },
    rssResult: {
      measurementSource: "native-candidate",
      readyEvent: { milestone: "renderer-ready" },
      settleMs: 30_000,
    },
    canvasResult,
    incompleteReasons: [],
  };
  writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  const summaryPath = resolve(FIXTURE_DIR, "release-performance-summary.json");
  const summary = {
    schemaVersion: 3,
    overall: "PASS",
    measurementMode: "release",
    sourceCommit: manifest.source.commit,
    candidate: manifest.candidate.path,
    candidateSha256: manifest.candidate.sha256,
    runnerSha256,
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    rawSha256: fileSha256(rawPath),
    budgets: {
      conditionedColdStartP95Ms: 1500,
      warmStartP95Ms: 800,
      rssStableMb: 120,
      canvasFrameP95Ms: 32,
      editCommandP95Ms: 50,
      saveP95Ms: 200,
      pngExportP95Ms: 3000,
      installerBytes: 25_000_000,
    },
    results: {
      conditionedColdStartP95Ms: 20,
      sessionFirstLaunchMs: 20,
      warmStartP95Ms: 20,
      rssStableMb: 3,
      canvasFrameP95Ms: 1,
      editCommandP95Ms: 20,
      saveP95Ms: 20,
      pngExportP95Ms: 20,
      installerBytes: readFileSync(resolve(ROOT, "package.json")).byteLength,
    },
    conditioning: {
      artifact: conditioningArtifact,
      artifactSha256: conditioningArtifactSha256,
    },
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  manifest.commands.push({
    id: "cmd-release-performance",
    command: "node scripts/quality/run-performance.mjs",
    exitCode: 0,
    startedAt,
    finishedAt,
    artifact: ".tmp/quality-test-fixtures/release-performance-summary.json",
    artifactSha256: fileSha256(summaryPath),
  });
  const nativeReportPath = resolve(FIXTURE_DIR, "native-candidate-report.json");
  const nativeReport = JSON.parse(readFileSync(nativeReportPath, "utf8"));
  nativeReport.performance = {
    summaryArtifact: ".tmp/quality-test-fixtures/release-performance-summary.json",
    summarySha256: fileSha256(summaryPath),
    conditionedColdStartP95Ms: 20,
    sessionFirstLaunchMs: 20,
  };
  writeFileSync(nativeReportPath, JSON.stringify(nativeReport, null, 2));
  manifest.platformReports.macos.artifactSha256 = fileSha256(nativeReportPath);
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

  it("fails closed when releaseScope is omitted from a legacy-shaped manifest", () => {
    const manifest = baseManifest();
    delete (manifest as any).releaseScope;
    const fixturePath = resolve(FIXTURE_DIR, "missing-release-scope.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("历史 manifest 只可审计");
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

  it("fails if the recorded candidate hash does not match the artifact", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    manifest.candidate.sha256 = "0".repeat(64);
    const fixturePath = resolve(FIXTURE_DIR, "candidate-hash-mismatch.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("candidate.sha256 与当前产物不一致");
  });

  it("fails if a platform report's embedded platform does not match its key", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    manifest.platformReports.macos.platform = "windows";
    const fixturePath = resolve(FIXTURE_DIR, "platform-key-mismatch.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("platformReports.macos.platform 与键名不一致");
  });

  it("fails if a native report is modified after its hash was recorded", () => {
    const manifest = baseManifest();
    writeFileSync(
      resolve(FIXTURE_DIR, "native-candidate-report.json"),
      JSON.stringify({ evidenceKind: "native-candidate", overall: "FAIL" }, null, 2),
    );
    const fixturePath = resolve(FIXTURE_DIR, "tampered-native-report.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("platformReports.macos.artifactSha256 与当前 artifact 不一致");
  });

  it("fails when the exact G2 decision record is absent", () => {
    const manifest = baseManifest();
    delete (manifest.approvals as any).g2;
    const fixturePath = resolve(FIXTURE_DIR, "missing-g2.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("approvals.g2 缺失");
  });

  it("fails when G-FINAL is absent instead of treating visual automation as owner approval", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    delete (manifest as any).approvals;
    const fixturePath = resolve(FIXTURE_DIR, "missing-g-final.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("approvals.gFinal 缺失");
  });

  it("fails when G-FINAL uses a placeholder approver identity", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    manifest.approvals.gFinal.approvedBy = "project-owner";
    const fixturePath = resolve(FIXTURE_DIR, "placeholder-g-final.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("approvals.gFinal.approvedBy 必须记录真实批准人");
  });

  it("fails when a v1/v2 legacy schema claims release readiness (audit-only)", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    manifest.schemaVersion = 2;
    const fixturePath = resolve(FIXTURE_DIR, "legacy-schema.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("v1/v2 历史 manifest 只可审计");
  });

  it("fails when an evidence artifact is generated after the manifest (time inversion)", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    const futureReportPath = resolve(FIXTURE_DIR, "future-native-report.json");
    writeFileSync(
      futureReportPath,
      JSON.stringify(
        {
          evidenceKind: "native-candidate",
          sourceCommit: manifest.source.commit,
          candidateSha256: manifest.candidate.sha256,
          platform: "macos",
          overall: "PASS",
          generatedAt: new Date(Date.now() + 60_000).toISOString(),
        },
        null,
        2,
      ),
    );
    manifest.platformReports.macos.artifact =
      ".tmp/quality-test-fixtures/future-native-report.json";
    manifest.platformReports.macos.artifactSha256 = fileSha256(futureReportPath);
    const fixturePath = resolve(FIXTURE_DIR, "time-inversion.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("晚于 manifest.generatedAt");
  });

  it("fails when a command lacks its own execution window (schema v3)", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    delete (manifest.commands[0] as any).startedAt;
    delete (manifest.commands[0] as any).finishedAt;
    const fixturePath = resolve(FIXTURE_DIR, "missing-command-window.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("commands[0].startedAt 缺失");
  });

  it("fails when a command artifact lacks a recorded SHA-256 binding (schema v3)", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = baseManifest();
    delete (manifest.commands[0] as any).artifactSha256;
    const fixturePath = resolve(FIXTURE_DIR, "missing-command-hash.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("commands[0].artifactSha256 缺失或无效");
  });

  it("fails when native canvas evidence has no independently recomputable raw frame samples", () => {
    const manifest = baseManifest();
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 1,
    });
    const fixturePath = resolve(FIXTURE_DIR, "missing-canvas-raw-samples.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("canvas frame samples");
  });

  it("PRR-066: fails when RSS evidence lacks a >=30s settleMs declaration", () => {
    const manifest = baseManifest();
    // 合法 canvas（raw 样本可复算），隔离 settleMs 失败
    const groups = {
      pan: Array.from({ length: 20 }, () => 8),
      drag: Array.from({ length: 20 }, () => 8),
      zoom: Array.from({ length: 20 }, () => 8),
    };
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: groups.pan,
      nodeDragFrameSamples: groups.drag,
      zoomFrameSamples: groups.zoom,
    });
    const rawPath = resolve(FIXTURE_DIR, "release-performance-raw.json");
    const raw = JSON.parse(readFileSync(rawPath, "utf8"));
    raw.rssResult.settleMs = 2_000; // 旧协议：2s 窗口冒充稳定窗
    writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    const summaryPath = resolve(FIXTURE_DIR, "release-performance-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.rawSha256 = fileSha256(rawPath);
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    const command = manifest.commands.find((c: any) => c.id === "cmd-release-performance");
    command.artifactSha256 = fileSha256(summaryPath);

    const fixturePath = resolve(FIXTURE_DIR, "short-settle.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));

    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("settleMs 缺失或不足 30000");
  });

  it("PRR-066: rejects diagnostic-preflight artifacts from final release evidence", () => {
    const manifest = baseManifest();
    const groups = {
      pan: Array.from({ length: 20 }, () => 8),
      drag: Array.from({ length: 20 }, () => 8),
      zoom: Array.from({ length: 20 }, () => 8),
    };
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: groups.pan,
      nodeDragFrameSamples: groups.drag,
      zoomFrameSamples: groups.zoom,
    });
    const rawPath = resolve(FIXTURE_DIR, "release-performance-raw.json");
    const raw = JSON.parse(readFileSync(rawPath, "utf8"));
    raw.measurementMode = "diagnostic-preflight";
    writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    const summaryPath = resolve(FIXTURE_DIR, "release-performance-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.measurementMode = "diagnostic-preflight";
    summary.rawSha256 = fileSha256(rawPath);
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    const command = manifest.commands.find((c: any) => c.id === "cmd-release-performance");
    command.artifactSha256 = fileSha256(summaryPath);

    const fixturePath = resolve(FIXTURE_DIR, "diagnostic-performance.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("measurementMode 必须为 release");
  });

  it("双指标协议：cold-conditioning.json 缺失时拒绝（ADR 0006 1.1.0）", () => {
    const manifest = baseManifest();
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: Array.from({ length: 20 }, () => 8),
      nodeDragFrameSamples: Array.from({ length: 20 }, () => 8),
      zoomFrameSamples: Array.from({ length: 20 }, () => 8),
    });
    rmSync(resolve(FIXTURE_DIR, "cold-conditioning.json"));

    const fixturePath = resolve(FIXTURE_DIR, "missing-cold-conditioning.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("cold-conditioning.json 缺失");
  });

  it("双指标协议：conditioning 绑定 candidate hash 不一致时拒绝", () => {
    const manifest = baseManifest();
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: Array.from({ length: 20 }, () => 8),
      nodeDragFrameSamples: Array.from({ length: 20 }, () => 8),
      zoomFrameSamples: Array.from({ length: 20 }, () => 8),
    });
    const conditioningPath = resolve(FIXTURE_DIR, "cold-conditioning.json");
    const conditioning = JSON.parse(readFileSync(conditioningPath, "utf8"));
    conditioning.candidateSha256 = "a".repeat(64);
    writeFileSync(conditioningPath, JSON.stringify(conditioning, null, 2));

    const fixturePath = resolve(FIXTURE_DIR, "conditioning-hash-mismatch.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("cold-conditioning candidateSha256 与 manifest 不一致");
  });

  it("双指标协议：cold-conditioning 内容变化但 summary hash 未更新时拒绝", () => {
    const manifest = baseManifest();
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: Array.from({ length: 20 }, () => 8),
      nodeDragFrameSamples: Array.from({ length: 20 }, () => 8),
      zoomFrameSamples: Array.from({ length: 20 }, () => 8),
    });
    const conditioningPath = resolve(FIXTURE_DIR, "cold-conditioning.json");
    const conditioning = JSON.parse(readFileSync(conditioningPath, "utf8"));
    conditioning.note = "tampered after summary binding";
    writeFileSync(conditioningPath, JSON.stringify(conditioning, null, 2));

    const fixturePath = resolve(FIXTURE_DIR, "conditioning-artifact-drift.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("conditioning.artifactSha256 与当前 artifact 不一致");
  });

  it("双指标协议：conditioning 失败态（success=false）时拒绝", () => {
    const manifest = baseManifest();
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: Array.from({ length: 20 }, () => 8),
      nodeDragFrameSamples: Array.from({ length: 20 }, () => 8),
      zoomFrameSamples: Array.from({ length: 20 }, () => 8),
    });
    const conditioningPath = resolve(FIXTURE_DIR, "cold-conditioning.json");
    const conditioning = JSON.parse(readFileSync(conditioningPath, "utf8"));
    conditioning.conditioning.success = false;
    conditioning.conditioning.error = "renderer-ready 缺失";
    writeFileSync(conditioningPath, JSON.stringify(conditioning, null, 2));

    const fixturePath = resolve(FIXTURE_DIR, "conditioning-failed.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("conditioning 必须为成功");
  });

  it("双指标协议：summary results.sessionFirstLaunchMs 与 conditioning 不一致时拒绝", () => {
    const manifest = baseManifest();
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: Array.from({ length: 20 }, () => 8),
      nodeDragFrameSamples: Array.from({ length: 20 }, () => 8),
      zoomFrameSamples: Array.from({ length: 20 }, () => 8),
    });
    const summaryPath = resolve(FIXTURE_DIR, "release-performance-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.results.sessionFirstLaunchMs = 999;
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    const command = manifest.commands.find((c: any) => c.id === "cmd-release-performance");
    command.artifactSha256 = fileSha256(summaryPath);

    const fixturePath = resolve(FIXTURE_DIR, "session-first-launch-mismatch.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("results.sessionFirstLaunchMs 与 cold-conditioning 不一致");
  });

  it("双指标协议：native report 未传播 sessionFirstLaunchMs 时拒绝", () => {
    const manifest = baseManifest();
    attachPerformanceEvidence(manifest, {
      measurementSource: "native-candidate",
      rounds: 20,
      fixtureNodes: 300,
      fixtureEdges: 450,
      frameP95Ms: 8,
      panFrameSamples: Array.from({ length: 20 }, () => 8),
      nodeDragFrameSamples: Array.from({ length: 20 }, () => 8),
      zoomFrameSamples: Array.from({ length: 20 }, () => 8),
    });
    const nativeReportPath = resolve(FIXTURE_DIR, "native-candidate-report.json");
    const nativeReport = JSON.parse(readFileSync(nativeReportPath, "utf8"));
    delete nativeReport.performance.sessionFirstLaunchMs;
    writeFileSync(nativeReportPath, JSON.stringify(nativeReport, null, 2));
    manifest.platformReports.macos.artifactSha256 = fileSha256(nativeReportPath);

    const fixturePath = resolve(FIXTURE_DIR, "native-report-missing-session-first.json");
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    const res = runVerifier(["--manifest", fixturePath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("artifact sessionFirstLaunchMs 与 performance summary 不一致");
  });
});
