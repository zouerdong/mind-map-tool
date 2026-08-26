// Export track measurement (MM-010): canonical SVG determinism, resvg-wasm PNG
// (2x), pdf-lib PDF, size-limit behavior, env-insensitivity, time/memory.
// Modes:
//   node export/measure-export.mjs                # full measurement
//   node export/measure-export.mjs --hash-only <fixture>  # subprocess hash probe

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { buildScene, sceneToSvg, checkExportSize, setTextMeasurement, LAYOUT } from "./scene.mjs";
import { createMeasurement } from "./measureText.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = resolve(HERE, "..");
const ROOT = resolve(SPIKE, "../..");
const TMP = resolve(ROOT, ".tmp/runtime-spike");
const FIXTURES_DIR = resolve(TMP, "fixtures");
const OUT_DIR = resolve(TMP, "export");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function pickFont() {
  const dir = resolve(TMP, "fonts");
  const evalPath = resolve(dir, "font-evaluation.json");
  if (existsSync(evalPath)) {
    const report = JSON.parse(await readFile(evalPath, "utf8"));
    const best = report.results.find((r) => r.ok && r.ofl && r.coverage?.ratio >= 0.99);
    if (best && existsSync(best.file)) return { path: best.file, id: best.id, family: best.family };
  }
  if (existsSync(dir)) {
    for (const id of ["noto-sans-sc-regular", "source-han-sans-sc-regular", "lxgw-wenkai-regular"]) {
      const f = readdirSync(dir).find((n) => n.startsWith(id));
      if (f) return { path: resolve(dir, f), id, family: id };
    }
  }
  return null;
}

// ---------- hash-only probe (subprocess env-sensitivity check) ----------
if (process.argv.includes("--hash-only")) {
  const fixtureName = process.argv[process.argv.indexOf("--hash-only") + 1];
  const font = await pickFont();
  if (font) {
    const m = createMeasurement(font.path, { fontSize: LAYOUT.fontSize });
    setTextMeasurement({ measure: m.measure, missing: m.missing });
  }
  const doc = JSON.parse(await readFile(resolve(FIXTURES_DIR, `${fixtureName}.json`), "utf8"));
  const out = sceneToSvg(buildScene(doc));
  process.stdout.write(out.error ? `ERR:${out.error.code}` : sha256(out.bytes));
  process.exit(0);
}

// ---------- full measurement ----------
const { Resvg, initWasm } = await import("@resvg/resvg-wasm");
const { PDFDocument, rgb } = await import("pdf-lib");
const fontkitForPdf = (await import("@pdf-lib/fontkit")).default;
const wasmPath = resolve(SPIKE, "node_modules/@resvg/resvg-wasm/index_bg.wasm");
await initWasm(await readFile(wasmPath));

mkdirSync(OUT_DIR, { recursive: true });
const font = await pickFont();
if (!font) {
  console.error("no font available — run fonts/evaluate-fonts.mjs first");
  process.exit(1);
}
console.log(`font: ${font.id} (${font.path})`);
const measurement = createMeasurement(font.path, { fontSize: LAYOUT.fontSize });
const fontBuffer = new Uint8Array(await readFile(font.path));
setTextMeasurement({ measure: measurement.measure, missing: measurement.missing });

const fixtureNames = readdirSync(FIXTURES_DIR)
  .filter((n) => n.endsWith(".json"))
  .map((n) => n.replace(/\.json$/, ""));

// Flip SVG path 'M x y C ...' (absolute, y-down) into PDF coords (y-up).
function flipPathD(d, pageH) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  // M x1 y1 C cx1 cy1, cx2 cy2, x2 y2 (8 numbers, all absolute)
  const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = nums;
  const f = (v) => Math.round(pageH - v);
  return `M ${x1} ${f(y1)} C ${cx1} ${f(cy1)} ${cx2} ${f(cy2)} ${x2} ${f(y2)}`;
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

// Decide WHICH font file the PDF leg uses (CFF OTF via pdf-lib may fail; fall
// back to a TTF-flavored CJK font). The embedded font OBJECT is per-document —
// never cached across PDFDocuments (cross-doc reuse corrupts/drifts bytes).
async function resolvePdfFontSource() {
  if (pdfFontSourceCache) return pdfFontSourceCache;
  const dir = resolve(TMP, "fonts");
  const probe = await PDFDocument.create();
  probe.registerFontkit(fontkitForPdf);
  try {
    await probe.embedFont(await readFile(font.path), { subset: true });
    pdfFontSourceCache = { path: font.path, source: font.id };
  } catch {
    const ttf = readdirSync(dir).find((n) => n.endsWith(".ttf"));
    if (!ttf) throw new Error("no TTF fallback font for pdf-lib");
    pdfFontSourceCache = { path: resolve(dir, ttf), source: `${ttf} (fallback: CFF embed failed)` };
  }
  return pdfFontSourceCache;
}
let pdfFontSourceCache = null;

async function buildPdf(scene) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitForPdf);
  pdf.setProducer("runtime-spike");
  pdf.setCreator("runtime-spike");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  globalThis.__pdfDocRef = pdf;
  const page = pdf.addPage([scene.width, scene.height]);
  const { path: fontPath, source } = await resolvePdfFontSource();
  const emb = await pdf.embedFont(await readFile(fontPath), { subset: true });

  const bg = scene.items.find((i) => i.kind === undefined); // none; draw from theme below
  const theme = { light: ["#ffffff"], dark: ["#111318"] }[scene.theme] ?? ["#ffffff"];
  page.drawRectangle({ x: 0, y: 0, width: scene.width, height: scene.height, color: hexToRgb(theme[0]) });

  for (const it of scene.items) {
    if (it.kind === "edge") {
      page.drawSvgPath(flipPathD(it.d, scene.height), {
        x: 0, y: 0,
        borderColor: hexToRgb(it.stroke),
        borderWidth: LAYOUT.strokeWidth,
      });
    } else if (it.kind === "node") {
      page.drawRectangle({
        x: it.x, y: scene.height - it.y - it.h,
        width: it.w, height: it.h,
        color: hexToRgb(it.fill), borderColor: hexToRgb(it.stroke), borderWidth: 1,
      });
    } else if (it.kind === "text") {
      try {
        page.drawText(it.text, {
          x: it.x, y: scene.height - it.y,
          font: emb, size: LAYOUT.fontSize, color: hexToRgb(it.fill),
        });
      } catch (err) {
        (globalThis.__pdfTextErrors ??= []).push({ text: it.text, error: String(err.message).slice(0, 120) });
      }
    }
  }
  return { bytes: await pdf.save(), embeddedName: emb.name };
}

const results = [];
for (const name of fixtureNames) {
  const doc = JSON.parse(await readFile(resolve(FIXTURES_DIR, `${name}.json`), "utf8"));
  const r = { fixture: name };

  // --- scene + SVG ---
  const scene = buildScene(doc);
  r.scene = { empty: !!scene.empty, width: scene.width, height: scene.height };
  const svgOut = sceneToSvg(scene);
  if (svgOut.error) {
    r.svg = { error: svgOut.error.code };
    results.push(r);
    console.log(`${name}: ${svgOut.error.code}`);
    continue;
  }
  await writeFile(resolve(OUT_DIR, `${name}.svg`), svgOut.bytes);
  r.svg = { bytes: svgOut.bytes.length, sha256: sha256(svgOut.bytes) };

  // determinism: rebuild from the same in-memory doc and compare
  const svgOut2 = sceneToSvg(buildScene(doc));
  r.svg.deterministic = sha256(svgOut2.bytes) === r.svg.sha256;

  r.missingGlyphs = scene.missingGlyphs ?? [];

  // --- size limit check ---
  const limit = checkExportSize(scene, 2);
  r.png = { ...limit };
  if (limit.ok) {
    const t0 = performance.now();
    const resvg = new Resvg(svgOut.svg, {
      fitTo: { mode: "zoom", value: 2 },
      font: { fontBuffers: [fontBuffer], loadSystemFonts: false, defaultFontFamily: LAYOUT.fontToken },
      background: "rgba(0,0,0,0)",
    });
    const pngBuffer = resvg.render().asPng();
    const t1 = performance.now();
    const pngBytes = Buffer.from(pngBuffer);
    await writeFile(resolve(OUT_DIR, `${name}-2x.png`), pngBytes);
    // dimension check via PNG IHDR
    const w = pngBytes.readUInt32BE(16), h = pngBytes.readUInt32BE(20);
    r.png = {
      ok: true, w, h,
      dimsExact2x: w === scene.width * 2 && h === scene.height * 2,
      bytes: pngBytes.length, sha256: sha256(pngBytes),
      renderMs: +(t1 - t0).toFixed(1),
    };
    // PNG determinism (second render)
    const png2 = Buffer.from(new Resvg(svgOut.svg, {
      fitTo: { mode: "zoom", value: 2 },
      font: { fontBuffers: [fontBuffer], loadSystemFonts: false, defaultFontFamily: LAYOUT.fontToken },
      background: "rgba(0,0,0,0)",
    }).render().asPng());
    r.png.deterministic = sha256(png2) === r.png.sha256;
  }

  // --- PDF (TS/WASM leg: pdf-lib + fontkit) ---
  if (!scene.empty) {
    globalThis.__pdfTextErrors = [];
    const t0 = performance.now();
    try {
      const { bytes, embeddedName } = await buildPdf(scene);
      const t1 = performance.now();
      const pdfBytes = Buffer.from(bytes);
      await writeFile(resolve(OUT_DIR, `${name}.pdf`), pdfBytes);
      r.pdf = {
        ok: true, bytes: pdfBytes.length, sha256: sha256(pdfBytes),
        buildMs: +(t1 - t0).toFixed(1),
        embeddedFont: embeddedName,
        textErrors: globalThis.__pdfTextErrors,
      };
      const { bytes: bytes2 } = await buildPdf(scene);
      r.pdf.deterministic = sha256(Buffer.from(bytes2)) === r.pdf.sha256;
    } catch (err) {
      r.pdf = { ok: false, error: String(err.message ?? err).slice(0, 200) };
    }
  }

  results.push(r);
  console.log(
    `${name}: svg=${r.svg.bytes}B${r.svg.deterministic ? "✓det" : "✗DET"} ` +
    `png=${r.png.ok ? `${r.png.w}x${r.png.h}${r.png.dimsExact2x ? "✓2x" : "✗DIMS"}${r.png.deterministic ? "✓det" : "✗DET"}` : r.png.code} ` +
    `pdf=${r.pdf?.ok ? `${r.pdf.bytes}B${r.pdf.deterministic ? "✓det" : "✗DET"}` : (r.pdf?.error ?? "n/a").slice(0, 40)} ` +
    `missing=${(scene.missingGlyphs ?? []).length}`
  );
}

// --- env-insensitivity probe: same fixture, different TZ/LANG in subprocess ---
import { execFileSync } from "node:child_process";
const envProbe = {};
for (const [label, env] of [
  ["utc-c", { TZ: "UTC", LANG: "C" }],
  ["shanghai-zh", { TZ: "Asia/Shanghai", LANG: "zh_CN.UTF-8" }],
]) {
  const hash = execFileSync(
    process.execPath,
    [resolve(HERE, "measure-export.mjs"), "--hash-only", "chinese-multiline"],
    { env: { ...process.env, ...env } }
  ).toString().trim();
  envProbe[label] = hash;
}
const baseHash = results.find((r) => r.fixture === "chinese-multiline")?.svg?.sha256;
envProbe.sameAsMain = envProbe["utc-c"] === envProbe["shanghai-zh"] && envProbe["utc-c"] === baseHash;

const report = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  font: { id: font.id, family: font.family },
  envProbe,
  peakRssMb: +(process.memoryUsage().rss / 1048576).toFixed(1),
  results,
};
const outPath = resolve(OUT_DIR, "export-metrics.json");
await writeFile(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(`\nreport -> ${outPath}`);
console.log(`env-insensitivity: ${envProbe.sameAsMain ? "PASS" : "FAIL"}`);
