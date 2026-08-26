// Bootstrap profile 漂移负向测试（MM-020 步骤⑧）：
// 证明 verify-decision --phase bootstrap 对"推荐替换 / evidence digest 变化 /
// Spike snapshot 变化 / ADR version/hash 变化 / approved value 不匹配"都会失败。
// 方法：复制 register 到临时目录做篡改，断言验证器非零退出。

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const VERIFY = resolve(ROOT, "scripts/runtime-spike/verify-decision.mjs");
const REGISTER = resolve(ROOT, "docs/decisions/decision-register.json");
const TMP = resolve(ROOT, ".tmp/negative-drift-test");

function runVerify(registerPath: string): { status: number; stderr: string } {
  try {
    const out = execFileSync(
      process.execPath,
      [VERIFY, "--phase", "bootstrap", registerPath, "--root", ROOT],
      {
        encoding: "utf8",
      },
    );
    return { status: 0, stderr: out };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? 1, stderr: err.stderr ?? "" };
  }
}

function tamper(mutate: (reg: Record<string, unknown>) => void): string {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const reg = JSON.parse(readFileSync(REGISTER, "utf8"));
  mutate(reg);
  const p = resolve(TMP, "register.json");
  writeFileSync(p, JSON.stringify(reg, null, 2));
  return p;
}

describe("verify-decision bootstrap drift (negative)", () => {
  it("未篡改的 register 应通过 bootstrap", () => {
    const { status } = runVerify(REGISTER);
    expect(status).toBe(0);
  });

  it("替换获选推荐（tauri→electron）必须失败", () => {
    const p = tamper((reg) => {
      (reg as any).gates.G1.approvedTracks.desktopHost.value = "electron";
    });
    expect(runVerify(p).status).not.toBe(0);
  });

  it("篡改 candidate evidence digest 必须失败", () => {
    const p = tamper((reg) => {
      (reg as any).gates.G1.approvedTracks.canvasView.candidateEvidenceSha256 = "0".repeat(64);
    });
    expect(runVerify(p).status).not.toBe(0);
  });

  it("篡改 source snapshot sha256 必须失败", () => {
    const p = tamper((reg) => {
      (reg as any).gates.G1.sourceSpikeResult.sha256 = "f".repeat(64);
    });
    expect(runVerify(p).status).not.toBe(0);
  });

  it("篡改 acceptedAdr sha256（ADR bytes 漂移绑定）必须失败", () => {
    const p = tamper((reg) => {
      (reg as any).gates.G1.approvedTracks.font.acceptedAdr.sha256 = "a".repeat(64);
      (reg as any).gates.G1.acceptedAdrVersions.find((e: any) => e.track === "font").sha256 =
        "a".repeat(64);
    });
    expect(runVerify(p).status).not.toBe(0);
  });

  it("G1 退回 pending 必须失败", () => {
    const p = tamper((reg) => {
      (reg as any).gates.G1.status = "pending";
    });
    expect(runVerify(p).status).not.toBe(0);
  });

  it("任意一轨退回 blocked 必须失败", () => {
    const p = tamper((reg) => {
      (reg as any).tracks.exportRenderer.status = "blocked";
    });
    expect(runVerify(p).status).not.toBe(0);
  });
});

// keep imports referenced
void cpSync;
void mkdirSync;
void createHash;
