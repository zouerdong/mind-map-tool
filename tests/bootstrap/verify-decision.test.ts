// PRR-000 红灯：verify-decision --phase packaging 必须对占位批准人 / 缺 [from-user]
// 记录 fail-closed；只有真实批准人 + 可引用 [from-user] 原文的 G2 才能通过。
// PRR-000 已把 2026-09-08 负责人 [from-user] 原文与真实批准人写入生产
// decision-register，因此真实记录必须 PASS；占位/缺原文的失败路径仍由
// 从真实 register 派生的合成注入覆盖，不回写生产 decision-register。

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const VERIFY = resolve(ROOT, "scripts/runtime-spike/verify-decision.mjs");
const REGISTER = resolve(ROOT, "docs/decisions/decision-register.json");
const TMP = resolve(ROOT, ".tmp/verify-decision-test");

function runPackaging(registerPath: string): { status: number; stderr: string } {
  try {
    const out = execFileSync(
      process.execPath,
      [VERIFY, "--phase", "packaging", registerPath, "--root", ROOT],
      { encoding: "utf8" },
    );
    return { status: 0, stderr: out };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? 1, stderr: err.stderr ?? "" };
  }
}

function injectApprovedG2(mutate?: (g2: Record<string, unknown>) => void): string {
  mkdirSync(TMP, { recursive: true });
  const reg = JSON.parse(readFileSync(REGISTER, "utf8"));
  reg.gates.G2 = {
    status: "approved",
    approvedBy: "ErDong Zou (synthetic fixture)",
    approvedAt: "2026-09-07T02:00:00.000Z",
    evidence: [
      "PRC-050 产品身份、命名统一与 G2 决策包",
      "[from-user] synthetic packaging approval for fixture only",
    ],
    approvedScope: reg.gates.G2.approvedScope,
  };
  if (mutate) mutate(reg.gates.G2);
  const p = resolve(TMP, `register-${randomUUID()}.json`);
  writeFileSync(p, JSON.stringify(reg, null, 2));
  return p;
}

describe("verify-decision packaging (PRR-000 redlines)", () => {
  it("真实 register 已含负责人 [from-user] 原文，packaging 必须通过", () => {
    const { status, stderr } = runPackaging(REGISTER);
    if (status !== 0) throw new Error(stderr);
    expect(status).toBe(0);
    const g2 = JSON.parse(readFileSync(REGISTER, "utf8")).gates.G2;
    expect(g2.approvedBy).toBe("ErDong Zou");
    expect(g2.evidence.some((entry: string) => entry.startsWith("[from-user]"))).toBe(true);
  });

  it("真实批准人 + [from-user] 原文的合成 G2 能通过 packaging", () => {
    const p = injectApprovedG2();
    const { status, stderr } = runPackaging(p);
    if (status !== 0) throw new Error(stderr);
    expect(status).toBe(0);
  });

  it("占位批准人（project-owner）必须失败", () => {
    const p = injectApprovedG2((g2) => {
      g2.approvedBy = "project-owner";
    });
    const { status, stderr } = runPackaging(p);
    expect(status).not.toBe(0);
    expect(stderr).toContain("project-owner/TBD");
  });

  it("缺少 [from-user] 原始批准记录必须失败", () => {
    const p = injectApprovedG2((g2) => {
      g2.evidence = ["执行者摘要，无用户原文"];
    });
    const { status, stderr } = runPackaging(p);
    expect(status).not.toBe(0);
    expect(stderr).toContain("[from-user]");
  });

  it("approvedScope 缺少禁运动作必须失败", () => {
    const p = injectApprovedG2((g2) => {
      (g2.approvedScope as any).explicitlyExcluded = ["signing"];
    });
    const { status, stderr } = runPackaging(p);
    expect(status).not.toBe(0);
    expect(stderr).toContain("explicitlyExcluded");
  });

  it("G2 仍为 pending 必须失败", () => {
    const p = injectApprovedG2((g2) => {
      g2.status = "pending";
    });
    const { status, stderr } = runPackaging(p);
    expect(status).not.toBe(0);
    expect(stderr).toContain("G2.status must be approved");
  });

  it("G1 source snapshot 缺字段时结构化失败，不抛 TypeError", () => {
    const p = injectApprovedG2();
    const reg = JSON.parse(readFileSync(p, "utf8"));
    delete reg.gates.G1.sourceSpikeResult;
    writeFileSync(p, JSON.stringify(reg, null, 2));

    const { status, stderr } = runPackaging(p);
    expect(status).not.toBe(0);
    expect(stderr).toContain("G1.sourceSpikeResult path/sha256 required");
    expect(stderr).not.toContain("TypeError");
  });
});
