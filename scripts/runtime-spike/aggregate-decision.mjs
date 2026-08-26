// Aggregate macOS-leg metrics into the MM-010 decision snapshot.
// Fail-closed: dual-platform aggregation is required for recommendation-ready;
// Windows leg is missing (R-013) so every required track stays `blocked` with
// WINDOWS_PLATFORM_PENDING, recommendations null. macOS evidence is recorded
// per candidate for the G1 discussion but does NOT flip any candidate to pass.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = HERE;
const TMP = resolve(SPIKE, "../..", ".tmp/runtime-spike");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const register = await readJson(resolve(SPIKE, "../../docs/decisions/decision-register.json"));
const canvas = await readJson(resolve(TMP, "canvas/canvas-metrics.json"));
const fontEval = await readJson(resolve(TMP, "fonts/font-evaluation.json"));
const exportM = await readJson(resolve(TMP, "export/export-metrics.json"));
const tauriM = await readJson(resolve(TMP, "hosts/tauri-metrics.json"));
const electronM = await readJson(resolve(TMP, "hosts/electron-metrics.json"));

const device = {
  model: "Mac16,12 (Apple M4)",
  os: "macOS 26.6.2 (25G83)",
  cpu: "Apple M4 arm64",
  ram: "24 GB",
  measuredAt: new Date().toISOString(),
};

// evidence manifest digest: sha256 of canonical JSON {files:[{path,sha256}]}
function evidenceDigest(files) {
  const manifest = { files: [...files].sort((a, b) => a.path.localeCompare(b.path)) };
  return sha256(Buffer.from(JSON.stringify(manifest, null, 2)));
}

const ev = {
  host: [
    { path: ".tmp/runtime-spike/hosts/tauri-metrics.json", sha256: sha256(await readFile(resolve(TMP, "hosts/tauri-metrics.json"))) },
    { path: ".tmp/runtime-spike/hosts/electron-metrics.json", sha256: sha256(await readFile(resolve(TMP, "hosts/electron-metrics.json"))) },
    { path: "docs/quality/runtime-spike-results.md", sha256: "" }, // doc-level, filled by MM-010 owner
  ],
  canvas: [
    { path: ".tmp/runtime-spike/canvas/canvas-metrics.json", sha256: sha256(await readFile(resolve(TMP, "canvas/canvas-metrics.json"))) },
  ],
  export: [
    { path: ".tmp/runtime-spike/export/export-metrics.json", sha256: sha256(await readFile(resolve(TMP, "export/export-metrics.json"))) },
  ],
  font: [
    { path: ".tmp/runtime-spike/fonts/font-evaluation.json", sha256: sha256(await readFile(resolve(TMP, "fonts/font-evaluation.json"))) },
  ],
};
// drop doc-level placeholder (its hash changes as the doc is finalized)
ev.host = ev.host.filter((f) => f.sha256);

const WP = ["WINDOWS_PLATFORM_PENDING_R013"];

const decision = {
  schemaVersion: 1,
  project: "minimal-mind-map-tool",
  status: "blocked",
  generatedAt: new Date().toISOString(),
  platforms: {
    macos: device,
    windows: null, // pending device registration (G0 register records no-device-currently)
  },
  topBlockedReasons: ["WINDOWS_PLATFORM_MISSING"],
  gates: {
    // gate states mirrored from docs/decisions/decision-register.json at snapshot time
    G0: register.gates.G0,
    G1: { status: "pending" },
    G2: { status: "pending" },
  },
  tracks: {
    desktopHost: {
      status: "blocked",
      recommended: null,
      blockedReasons: WP,
      candidates: [
        {
          id: "tauri",
          result: "not-tested", // final verdict requires dual-platform aggregation
          exitCriteriaVersion: "host-v1",
          macOSLeg: {
            coldStartP50Ms: tauriM.coldStartMs.p50,
            rssMainProcessMb: +(tauriM.rssTreeBytes.stableP50 / 1048576).toFixed(0),
            rssNote: "WKWebView WebContent is a system XPC service outside the app process tree (~+36MB for a trivial page, attribution approximate)",
            binaryMb: +(tauriM.binaryBytes / 1048576).toFixed(1),
            nativePngExport: tauriM.nativePngExport,
            verdictPartial: "macOS exit criteria tested so far: PASS (startup/rss/disk/export); Windows leg untested",
          },
          exitEvidence: ev.host,
          blockedReasons: WP,
        },
        {
          id: "electron",
          result: "not-tested",
          exitCriteriaVersion: "host-v1",
          macOSLeg: {
            coldStartP50Ms: electronM.coldStartMs.p50,
            rssTreeMb: +(electronM.rssTreeBytes.stableP50 / 1048576).toFixed(0),
            frameworkDiskMb: +(electronM.frameworkDiskKb / 1024).toFixed(0),
            nativePdfExport: electronM.nativePdfExport,
            verdictPartial: "macOS exit criteria tested so far: PASS (startup/rss/disk/export); Windows leg untested",
          },
          exitEvidence: ev.host,
          blockedReasons: WP,
        },
      ],
    },
    canvasView: {
      status: "blocked",
      recommended: null,
      blockedReasons: WP,
      candidates: canvas.results.map((r) => ({
        id: r.app === "react-flow" ? "react-flow" : "custom-react-view",
        result: "not-tested",
        exitCriteriaVersion: "canvas-v1",
        macOSLeg: {
          environment: canvas.environment,
          bundleKb: Math.round(r.bundleBytes / 1024),
          frameP95Ms: { pan: r.pan.p95, nodeDrag: r.nodeDrag.p95, zoom: r.zoom.p95 },
          budget32Ms: Math.max(r.pan.p95, r.nodeDrag.p95, r.zoom.p95) <= 32,
          probes: r.probes,
          verdictPartial: "300/450 headless-Chrome budget PASS for both; IME/a11y/WebView behavior pending dual-platform matrix",
        },
        exitEvidence: ev.canvas,
        blockedReasons: WP,
      })),
    },
    exportRenderer: {
      status: "blocked",
      recommended: null,
      blockedReasons: WP,
      candidates: [
        {
          id: "web-ts-wasm",
          result: "not-tested",
          exitCriteriaVersion: "export-renderer-v1",
          macOSLeg: {
            svgDeterministic: exportM.results.filter((r) => r.svg?.deterministic).length + "/" + exportM.results.length,
            pngExact2x: exportM.results.filter((r) => r.png?.dimsExact2x).length,
            pngDeterministic: exportM.results.filter((r) => r.png?.deterministic).length,
            pdfDeterministic: exportM.results.filter((r) => r.pdf?.deterministic).length,
            envInsensitive: exportM.envProbe.sameAsMain,
            sizeLimitRejection: exportM.results.find((r) => r.fixture === "large-bounds")?.png?.code === "EXPORT_SIZE_LIMIT",
            emptyDocRejection: exportM.results.find((r) => r.fixture === "empty-document")?.svg?.error === "EXPORT_EMPTY_DOCUMENT",
            verdictPartial: "all deterministic/guard rails PASS on macOS; WebView2/locale matrix pending Windows leg",
          },
          exitEvidence: ev.export,
          blockedReasons: WP,
        },
        {
          id: "native-host",
          result: "not-tested",
          exitCriteriaVersion: "export-renderer-v1",
          macOSLeg: {
            tauriResvgPng: tauriM.nativePngExport,
            electronPrintToPdf: electronM.nativePdfExport,
            nativePdfRust: "not-tested (requires additional Rust PDF stack; only evaluated if selected)",
            verdictPartial: "Tauri resvg PNG PASS (21ms/89.7KB, deterministic hash); Electron printToPdf PASS (323ms); Windows leg untested",
          },
          exitEvidence: ev.export,
          blockedReasons: WP,
        },
      ],
    },
    font: {
      status: "blocked",
      recommended: null,
      blockedReasons: WP,
      candidates: fontEval.results
        .filter((f) => f.ok && f.ofl && f.coverage?.ratio >= 0.99)
        .map((f) => ({
          id: f.id,
          result: "not-tested",
          exitCriteriaVersion: "font-v1",
          macOSLeg: {
            license: f.license,
            licenseUrl: f.licenseUrl,
            sizeMb: +(f.sizeBytes / 1048576).toFixed(1),
            coverageRatio: f.coverage.ratio,
            corpusSize: f.coverage.corpusSize,
            puaCorrectlyMissing: f.puaCorrectlyMissing,
            verdictPartial: "license/coverage/size PASS on macOS corpus; WebView2 rendering + full CJK corpus pending Windows leg",
          },
          exitEvidence: ev.font,
          blockedReasons: WP,
        })),
    },
  },
  notes: [
    "Fail-closed: 所有必需轨 blocked（R-013 Windows 平台缺失）；候选最终 result 保持 not-tested，macOS 证据仅供建议参考。",
    "macOS 证据文件位于 .tmp/runtime-spike/**（可再生）；此快照冻结其 sha256 以便 G1 讨论引用。",
    "MM-010 验证命令：node scripts/runtime-spike/verify-decision.mjs --phase spike-result docs/quality/runtime-spike-decision.json --sha256-sidecar docs/quality/runtime-spike-decision.sha256",
  ],
};

const outPath = resolve(SPIKE, "../../docs/quality/runtime-spike-decision.json");
await writeFile(outPath, JSON.stringify(decision, null, 2) + "\n");
const sidecar = resolve(SPIKE, "../../docs/quality/runtime-spike-decision.sha256");
await writeFile(sidecar, sha256(await readFile(outPath)) + "  runtime-spike-decision.json\n");
console.log(`decision -> ${outPath}`);
console.log(`sidecar  -> ${sidecar}`);
