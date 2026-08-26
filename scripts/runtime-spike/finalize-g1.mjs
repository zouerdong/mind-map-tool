// G1 finalization (MM-000 step ④-⑤, 2026-08-26):
// 1. Regenerate the spike snapshot under the G1-amended exit criteria
//    (v1 = macOS-first per PRD §1.1) -> tracks recommendation-ready.
// 2. Bind G1 in docs/decisions/decision-register.json: approvedTracks with
//    candidate evidence digests + accepted ADR id/version/sha256.
// Run: node scripts/runtime-spike/finalize-g1.mjs

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = HERE;
const REPO = resolve(SPIKE, "../..");
const TMP = resolve(REPO, ".tmp/runtime-spike");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const tauriM = await readJson(resolve(TMP, "hosts/tauri-metrics.json"));
const electronM = await readJson(resolve(TMP, "hosts/electron-metrics.json"));
const canvas = await readJson(resolve(TMP, "canvas/canvas-metrics.json"));
const exportM = await readJson(resolve(TMP, "export/export-metrics.json"));
const fontEval = await readJson(resolve(TMP, "fonts/font-evaluation.json"));
const register = await readJson(resolve(REPO, "docs/decisions/decision-register.json"));

const EV_FILES = {
  tauri: [{ path: ".tmp/runtime-spike/hosts/tauri-metrics.json" }],
  electron: [{ path: ".tmp/runtime-spike/hosts/electron-metrics.json" }],
  "react-flow": [{ path: ".tmp/runtime-spike/canvas/canvas-metrics.json" }],
  "custom-react-view": [{ path: ".tmp/runtime-spike/canvas/canvas-metrics.json" }],
  "web-ts-wasm": [{ path: ".tmp/runtime-spike/export/export-metrics.json" }],
  "native-host": [
    { path: ".tmp/runtime-spike/hosts/tauri-metrics.json" },
    { path: ".tmp/runtime-spike/hosts/electron-metrics.json" },
  ],
  "noto-sans-sc-regular": [{ path: ".tmp/runtime-spike/fonts/font-evaluation.json" }],
  "lxgw-wenkai-regular": [{ path: ".tmp/runtime-spike/fonts/font-evaluation.json" }],
};

// candidate evidence digest: canonical JSON {candidate, files:[{path,sha256}]}
function candidateDigest(candidateId) {
  const files = EV_FILES[candidateId].map((f) => ({
    path: f.path,
    sha256: sha256(readFileSyncSafe(resolve(REPO, f.path))),
  }));
  return sha256(Buffer.from(JSON.stringify({ candidate: candidateId, files }, null, 2)));
}
function readFileSyncSafe(p) {
  // small helper to read synchronously
  return readFileSync(p);
}
import { readFileSync } from "node:fs";

const ADR_META = {
  desktopHost: { id: "0001-desktop-host", version: "1.0.0" },
  canvasView: { id: "0002-canvas-view", version: "1.0.0" },
  exportRenderer: { id: "0004-export-renderer", version: "1.0.0" },
  font: { id: "0005-export-font-pdf", version: "1.0.0" },
};
function adrSha(id) {
  return sha256(readFileSync(resolve(REPO, "docs/decisions", `${id}.md`)));
}

// ---------- 1. snapshot v2 ----------
const snapshotPath = resolve(REPO, "docs/quality/runtime-spike-decision.json");
const generatedAt = new Date().toISOString();

const cand = (id, result, note, extra = {}) => ({
  id,
  result,
  exitCriteriaVersion: note.criteria,
  exitEvidence: EV_FILES[id].map((f) => ({ ...f, sha256: sha256(readFileSync(resolve(REPO, f.path))) })),
  blockedReasons: result === "fail" ? [note.reason ?? "EXIT_CRITERIA_FAIL"] : [],
  ...extra,
});

const snapshot = {
  schemaVersion: 1,
  project: "minimal-mind-map-tool",
  status: "recommendation-ready",
  generatedAt,
  exitCriteriaAmendment: "[from-user] 2026-08-26 G1：v1 平台范围变更为 macOS 先行（PRD §1.1）；exit criteria 以 macOS 实测为完整验收基础，Windows 顺延专门版本。快照 v1（全部 blocked）在 git 历史中保留。",
  platforms: {
    macos: { model: "Mac16,12 (Apple M4)", os: "macOS 26.6.2 (25G83)", cpu: "Apple M4 arm64", ram: "24 GB" },
    windows: { status: "deferred-to-dedicated-version", note: "v1 macOS-first per user G1 decision" },
  },
  gates: {
    G0: register.gates.G0,
    G1: { status: "approved", approvedBy: "ErDong Zou", approvedAt: "2026-08-26" },
    G2: { status: "pending" },
  },
  tracks: {
    desktopHost: {
      status: "recommendation-ready",
      recommended: "tauri",
      candidates: [
        cand("tauri", "pass", { criteria: "host-v1" }, {
          macOSLeg: {
            coldStartP50Ms: tauriM.coldStartMs.p50,
            rssMainProcessMb: Math.round(tauriM.rssTreeBytes.stableP50 / 1048576),
            binaryMb: +(tauriM.binaryBytes / 1048576).toFixed(1),
            nativePngExport: tauriM.nativePngExport,
            summary: "macOS exit criteria PASS：启动 362ms（预算 1500）、二进制 8MB（预算 25）、native 导出可用",
          },
        }),
        cand("electron", "pass", { criteria: "host-v1" }, {
          macOSLeg: {
            coldStartP50Ms: electronM.coldStartMs.p50,
            rssTreeMb: Math.round(electronM.rssTreeBytes.stableP50 / 1048576),
            frameworkDiskMb: Math.round(electronM.frameworkDiskKb / 1024),
            nativePdfExport: electronM.nativePdfExport,
            summary: "macOS exit criteria PASS：启动 296ms、RSS 139MB；磁盘 233MB 超出轻量目标（推荐落选原因）",
          },
        }),
      ],
      blockedReasons: [],
      rationale: "Tauri 以 29 倍体积优势胜出；启动/RSS 同级且均优于预算。Electron 保留为降级知识。",
    },
    canvasView: {
      status: "recommendation-ready",
      recommended: "react-flow",
      candidates: [
        cand("react-flow", "pass", { criteria: "canvas-v1" }, {
          macOSLeg: {
            frameP95Ms: { pan: 17.9, nodeDrag: 16.7, zoom: 16.7 },
            bundleKb: 372,
            budget32Ms: true,
            attribution: "visible-by-default（G1 决定保留）",
            proCodeDependency: false,
            summary: "交互完整（拖拽/框选/连线/缩放/键盘内建）、300/450 预算 PASS、MIT",
          },
        }),
        cand("custom-react-view", "not-tested", { criteria: "canvas-v1" }, {
          macOSLeg: {
            frameP95Ms: { pan: 17.4, nodeDrag: 16.7, zoom: 16.7 },
            bundleKb: 193,
            summary: "性能对照达标，但框选/多选/连线/键盘导航未实现（完整 exit criteria 未测）——React Flow 获选后不再评估",
          },
        }),
      ],
      blockedReasons: [],
      rationale: "交互完整性显著优势，性能与体积达标；IME 真实矩阵在 MM-050/MM-090 补。",
    },
    exportRenderer: {
      status: "recommendation-ready",
      recommended: "web-ts-wasm",
      candidates: [
        cand("web-ts-wasm", "pass", { criteria: "export-renderer-v1" }, {
          macOSLeg: {
            svgDeterministic: "8/8",
            pngExact2x: "7/7 (large-bounds 正确拒绝)",
            pdfDeterministic: "8/8",
            envInsensitive: true,
            summary: "三格式确定性/守门全过；无 native IPC 面",
          },
        }),
        cand("native-host", "not-tested", { criteria: "export-renderer-v1" }, {
          macOSLeg: {
            tauriResvgPng: tauriM.nativePngExport,
            electronPrintToPdf: electronM.nativePdfExport,
            summary: "部分腿通过（resvg PNG 21ms、printToPDF 323ms），native PDF Rust 栈未评——默认分支获选后不再激活 MM-045",
          },
        }),
      ],
      blockedReasons: [],
      rationale: "web-ts-wasm 唯一完整拥有三格式且全部确定性验证通过。",
    },
    font: {
      status: "recommendation-ready",
      recommended: "noto-sans-sc-regular",
      candidates: [
        cand("noto-sans-sc-regular", "pass", { criteria: "font-v1" }, {
          macOSLeg: { license: "SIL OFL 1.1", sizeMb: 7.9, coverageRatio: 1.0, corpus: 398, puaCorrectlyMissing: true },
        }),
        cand("lxgw-wenkai-regular", "pass", { criteria: "font-v1" }, {
          macOSLeg: { license: "SIL OFL 1.1", sizeMb: 23.6, coverageRatio: 1.0, role: "[from-user] 手写风格第二字体（v1 字体二选一功能）" },
        }),
      ],
      blockedReasons: [],
      rationale: "Noto Sans SC 为基础字体（体积最优）；LXGW WenKai 因 [from-user] 手写体需求进入 v1 双字体功能。",
    },
  },
  notes: [
    "验证命令：node scripts/runtime-spike/verify-decision.mjs --phase bootstrap docs/decisions/decision-register.json",
  ],
};

await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
const snapshotSha = sha256(await readFile(snapshotPath));
await writeFile(resolve(REPO, "docs/quality/runtime-spike-decision.sha256"), snapshotSha + "  runtime-spike-decision.json\n");

// ---------- 2. register: tracks + G1 ----------
const regTracks = JSON.parse(JSON.stringify(register.tracks));
for (const [track, def] of Object.entries({
  desktopHost: [["tauri", "pass"], ["electron", "pass"]],
  canvasView: [["react-flow", "pass"], ["custom-react-view", "not-tested"]],
  exportRenderer: [["web-ts-wasm", "pass"], ["native-host", "not-tested"]],
  font: [["noto-sans-sc-regular", "pass"], ["lxgw-wenkai-regular", "pass"]],
})) {
  const t = regTracks[track];
  t.status = "recommendation-ready";
  t.blockedReasons = [];
  t.recommended = def[0][0];
  t.candidates = def.map(([id, result]) => ({
    id,
    result,
    exitCriteriaVersion: t.candidates[0]?.exitCriteriaVersion ?? `${track}-v1`,
    exitEvidence: EV_FILES[id].map((f) => ({ ...f, sha256: sha256(readFileSync(resolve(REPO, f.path))) })),
    blockedReasons: [],
  }));
}

const approvedTracks = {};
const acceptedAdrVersions = [];
for (const track of ["desktopHost", "canvasView", "exportRenderer", "font"]) {
  const value = regTracks[track].recommended;
  const meta = ADR_META[track];
  const aSha = adrSha(meta.id);
  approvedTracks[track] = {
    value,
    candidateResult: "pass",
    candidateEvidenceSha256: candidateDigest(value),
    acceptedAdr: { id: meta.id, version: meta.version, sha256: aSha },
  };
  acceptedAdrVersions.push({ track, adrId: meta.id, version: meta.version, sha256: aSha });
}

register.tracks = regTracks;
register.status = "recommendation-ready";
register.updatedAt = "2026-08-26";
register.gates.G1 = {
  ...register.gates.G1,
  status: "approved",
  approvedBy: "ErDong Zou",
  approvedAt: "2026-08-26",
  sourceSpikeResult: {
    path: "docs/quality/runtime-spike-decision.json",
    sha256: snapshotSha,
    generatedAt,
  },
  approvedTracks,
  acceptedAdrVersions,
  evidence: [
    "[from-user] 2026-08-26 会话决策：四轨选型（Tauri 2 / React Flow / web-ts-wasm / Noto Sans SC + LXGW WenKai 手写字体）",
    "[from-user] 2026-08-26 平台范围变更：v1 macOS 先行、Windows 专门版本 + 移植就绪约束（PRD §1.1）",
    "macOS Spike 快照与原始 metrics（.tmp/runtime-spike/**，digest 已绑定）",
    "ADR 0001-0006 转 Accepted 1.0.0",
  ],
};

await writeFile(resolve(REPO, "docs/decisions/decision-register.json"), JSON.stringify(register, null, 2) + "\n");
console.log("snapshot v2 ->", snapshotPath);
console.log("snapshot sha256:", snapshotSha);
console.log("register updated with G1 binding");
