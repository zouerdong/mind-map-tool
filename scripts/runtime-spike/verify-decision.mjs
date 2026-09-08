// Fail-closed decision-register validator (MM-010/MM-020/MM-100 consumer gate).
// Profiles:
//   --phase spike-result  : G0 approved + internal consistency; G1/G2 may be pending
//   --phase bootstrap     : spike-result + all required tracks recommendation-ready
//                           + G1 approved + snapshot/ADR digest binding, no drift
//   --phase packaging     : bootstrap + G2 approved for the exact local scope
// Usage:
//   node verify-decision.mjs --phase <p> <register.json> [--sha256-sidecar <file>] [--root <repo>]

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}
const phase = arg("phase");
const registerPath = args.find((a) => !a.startsWith("--") && a !== phase);
const sidecarPath = arg("sha256-sidecar");
const REPO_ROOT = arg("root") ?? resolve(HERE, "../..");

if (!phase || !registerPath) {
  console.error("usage: verify-decision.mjs --phase <spike-result|bootstrap|packaging> <register.json> [--sha256-sidecar <file>]");
  process.exit(2);
}

const errors = [];
const fail = (msg) => errors.push(msg);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const reg = JSON.parse(await readFile(registerPath, "utf8"));
const REQUIRED_TRACKS = ["desktopHost", "canvasView", "exportRenderer", "font"];

// ---------- shared: spike-result profile ----------
function checkSpikeResult() {
  if (reg.gates?.G0?.status !== "approved") fail("G0.status must be approved (spike-result)");
  else if (!reg.gates.G0.approvedBy || !reg.gates.G0.approvedAt) fail("G0 approval must name approver and time");

  for (const track of REQUIRED_TRACKS) {
    const t = reg.tracks?.[track];
    if (!t) { fail(`missing track ${track}`); continue; }

    const candidates = t.candidates ?? [];
    const passCandidates = candidates.filter((c) => c.result === "pass" && (c.exitEvidence?.length ?? 0) > 0);

    if (t.status === "recommendation-ready") {
      if (!t.recommended || !passCandidates.some((c) => c.id === t.recommended)) {
        fail(`${track}: recommendation-ready but recommended is not a PASS candidate with evidence`);
      }
      if (t.blockedReasons?.length) fail(`${track}: recommendation-ready must not carry blockedReasons`);
    } else if (t.status === "blocked") {
      if (t.recommended !== null) fail(`${track}: blocked track must have recommended=null`);
      const anyPass = candidates.some((c) => c.result === "pass");
      if (anyPass && (t.blockedReasons ?? []).length === 0) fail(`${track}: blocked with PASS candidate but no reason`);
      if (track === "font" && candidates.length === 0 && (t.blockedReasons ?? []).length === 0) {
        fail("font: blocked without candidates requires blockedReasons");
      }
    } else {
      fail(`${track}: status must be recommendation-ready or blocked (got ${t.status})`);
    }

    for (const c of candidates) {
      if (!["pass", "fail", "not-tested"].includes(c.result)) fail(`${track}/${c.id}: invalid result ${c.result}`);
      if (c.result === "pass" && (c.exitEvidence?.length ?? 0) === 0) fail(`${track}/${c.id}: PASS without evidence`);
      if (c.result !== "pass" && c.result !== "not-tested" && !c.blockedReasons?.length) {
        fail(`${track}/${c.id}: FAIL requires blockedReasons`);
      }
    }
  }

  const allReady = REQUIRED_TRACKS.every((tr) => reg.tracks[tr]?.status === "recommendation-ready");
  if (reg.status === "recommendation-ready" && !allReady) fail("top-level recommendation-ready requires all required tracks ready");
  if (reg.status === "blocked" && !REQUIRED_TRACKS.some((tr) => reg.tracks[tr]?.status === "blocked")) {
    fail("top-level blocked requires at least one blocked required track");
  }
}

// ---------- bootstrap additions ----------
function checkBootstrap() {
  checkSpikeResult();

  const g1 = reg.gates?.G1;
  if (g1?.status !== "approved") { fail("G1.status must be approved (bootstrap)"); return; }
  if (!g1.approvedBy || !g1.approvedAt) fail("G1 approval must name approver and time");

  const snap = g1.sourceSpikeResult;
  if (!snap?.path || !snap.sha256) {
    fail("G1.sourceSpikeResult path/sha256 required");
  } else {
    const snapAbs = resolve(REPO_ROOT, snap.path);
    if (!existsSync(snapAbs)) fail(`source spike snapshot missing: ${snap.path}`);
    else {
      const actual = sha256(readFileSync(snapAbs));
      if (actual !== snap.sha256) fail(`source spike snapshot drift: recorded ${snap.sha256.slice(0, 12)}… actual ${actual.slice(0, 12)}…`);
      if (snap.generatedAt) {
        const snapJson = JSON.parse(readFileSync(snapAbs, "utf8"));
        if (snapJson.generatedAt !== snap.generatedAt) fail("source snapshot generatedAt mismatch");
      }
    }
  }

  for (const track of REQUIRED_TRACKS) {
    const approved = g1.approvedTracks?.[track];
    const t = reg.tracks[track];
    if (!approved?.value) { fail(`G1.approvedTracks.${track}.value missing`); continue; }
    if (t?.recommended !== approved.value) fail(`G1 approved value for ${track} (${approved.value}) != current recommendation (${t?.recommended})`);
    if (approved.candidateResult !== "pass") fail(`G1.approvedTracks.${track}.candidateResult must be pass`);
    if (!approved.candidateEvidenceSha256) fail(`G1.approvedTracks.${track}.candidateEvidenceSha256 missing`);
    else {
      // recompute the candidate evidence digest from disk truth:
      // manifest = canonical JSON {candidate, files:[{path, sha256(disk)}]}
      const cand = t?.candidates?.find((c) => c.id === approved.value);
      if (!cand || !Array.isArray(cand.exitEvidence) || cand.exitEvidence.length === 0) {
        fail(`${track}: approved candidate has no exitEvidence list`);
      } else {
        const files = [];
        let missing = false;
        for (const ev of cand.exitEvidence) {
          const abs = resolve(REPO_ROOT, ev.path);
          if (!existsSync(abs)) { fail(`${track}: evidence file missing on disk: ${ev.path}`); missing = true; continue; }
          files.push({ path: ev.path, sha256: sha256(readFileSync(abs)) });
        }
        if (!missing) {
          const manifest = { candidate: approved.value, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
          const recomputed = sha256(Buffer.from(JSON.stringify(manifest, null, 2)));
          if (recomputed !== approved.candidateEvidenceSha256) {
            fail(`${track}: candidateEvidenceSha256 drift (recorded ${approved.candidateEvidenceSha256.slice(0, 12)}… recomputed ${recomputed.slice(0, 12)}…)`);
          }
        }
      }
    }

    const adrRef = approved.acceptedAdr;
    if (!adrRef?.id || !adrRef.version || !adrRef.sha256) fail(`G1.approvedTracks.${track}.acceptedAdr incomplete`);
    else {
      const adrPath = resolve(REPO_ROOT, "docs/decisions", `${adrRef.id}.md`);
      if (!existsSync(adrPath)) fail(`accepted ADR file missing: ${adrRef.id}.md`);
      else {
        const bytes = readFileSync(adrPath);
        const actual = sha256(bytes);
        if (actual !== adrRef.sha256) fail(`ADR ${adrRef.id} bytes drifted from G1 binding`);
        const text = bytes.toString("utf8");
        if (!new RegExp(`^- Status: Accepted`, "m").test(text)) fail(`ADR ${adrRef.id} is not Accepted`);
        const verMatch = text.match(/^- ADR-Version: (.+)$/m);
        if (verMatch?.[1] !== adrRef.version) fail(`ADR ${adrRef.id} version mismatch (bound ${adrRef.version}, actual ${verMatch?.[1]})`);
      }
    }
    const structured = (g1.acceptedAdrVersions ?? []).find((e) => e.track === track);
    if (!structured || structured.adrId !== adrRef.id || structured.sha256 !== adrRef.sha256) {
      fail(`acceptedAdrVersions entry for ${track} inconsistent with approvedTracks`);
    }
  }
}

// ---------- packaging additions ----------
function checkPackaging() {
  checkBootstrap();
  const g2 = reg.gates?.G2;
  if (g2?.status !== "approved") { fail("G2.status must be approved (packaging)"); return; }
  const approvedBy = typeof g2.approvedBy === "string" ? g2.approvedBy.trim() : "";
  if (!approvedBy || /^(project[- ]?owner|owner|tbd|unknown)$/i.test(approvedBy)) {
    fail("G2.approvedBy must name the real approver, not a project-owner/TBD placeholder");
  }
  if (!Number.isFinite(Date.parse(g2.approvedAt))) fail("G2.approvedAt must be a valid date");
  if (!Array.isArray(g2.evidence) || !g2.evidence.some((e) => typeof e === "string" && e.startsWith("[from-user]"))) {
    fail("G2.evidence must include an explicit [from-user] approval record");
  }
  const scope = g2.approvedScope ?? {};
  if (!scope.selectedHost) fail("G2.approvedScope.selectedHost required");
  for (const key of ["candidateOutputPaths", "installationTargets", "allowedActions", "deletionBoundaries"]) {
    if (!Array.isArray(scope[key]) || scope[key].length === 0) fail(`G2.approvedScope.${key} must be a non-empty list`);
  }
  const forbidden = ["test-signing", "signing", "notarization", "credential access", "system trust changes", "upload", "publication"];
  const excluded = scope.explicitlyExcluded ?? [];
  for (const f of forbidden) if (!excluded.includes(f)) fail(`G2.explicitlyExcluded must retain "${f}"`);
}

// ---------- run ----------
if (phase === "spike-result") checkSpikeResult();
else if (phase === "bootstrap") checkBootstrap();
else if (phase === "packaging") checkPackaging();
else { console.error(`unknown phase ${phase}`); process.exit(2); }

// sidecar check (when provided): sidecar must equal sha256(register bytes)
if (sidecarPath) {
  if (!existsSync(sidecarPath)) fail(`sidecar missing: ${sidecarPath}`);
  else {
    const recorded = readFileSync(sidecarPath, "utf8").trim().split(/\s+/)[0];
    const actual = sha256(readFileSync(registerPath));
    if (recorded !== actual) fail(`sidecar sha256 mismatch (recorded ${recorded.slice(0, 12)}… actual ${actual.slice(0, 12)}…)`);
  }
}

if (errors.length) {
  console.error(`verify-decision [${phase}]: FAIL`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`verify-decision [${phase}]: PASS (${registerPath}${sidecarPath ? " + sidecar" : ""})`);
