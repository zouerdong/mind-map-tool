// Font track evaluation (MM-010): download candidates, record licenses,
// measure CJK coverage against fixture corpus + common-char sample, report sizes.
// Downloads are regenerable — everything lands in .tmp/runtime-spike/fonts/.

import { mkdirSync, writeFileSync, existsSync, statSync, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openSync as fontkitOpen } from "fontkit";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = resolve(ROOT, ".tmp/runtime-spike/fonts");

// Candidates must have unambiguous redistribution + embedding rights for an
// OFL-compatible pipeline. Non-OFL "free commercial" fonts are recorded but
// flagged pending license review.
const CANDIDATES = [
  {
    id: "noto-sans-sc-regular",
    family: "Noto Sans SC",
    style: "Regular",
    license: "SIL OFL 1.1",
    licenseUrl: "https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE",
    url: "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
    ofl: true,
  },
  {
    id: "source-han-sans-sc-regular",
    family: "Source Han Sans SC",
    style: "Regular",
    license: "SIL OFL 1.1",
    licenseUrl: "https://github.com/adobe-fonts/source-han-sans/blob/release/LICENSE",
    url: "https://github.com/adobe-fonts/source-han-sans/raw/release/SubsetOTF/SC/SourceHanSansSC-Regular.otf",
    ofl: true,
  },
  {
    id: "lxgw-wenkai-regular",
    family: "LXGW WenKai",
    style: "Regular",
    license: "SIL OFL 1.1",
    licenseUrl: "https://github.com/lxgw/LxgwWenKai/blob/main/LICENSE",
    url: "https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf",
    ofl: true,
  },
  {
    id: "misans-regular",
    family: "MiSans",
    style: "Regular",
    license: "Xiaomi MiSans license (free commercial use; redistribution terms require review)",
    licenseUrl: "https://hyperos.mi.com/font/",
    url: "https://hyperos.mi.com/font-download/MiSans.zip",
    ofl: false,
    note: "zip 包含全字重，体积大；license 非 OFL，再分发条款需人工审阅",
  },
];

// Coverage corpus: chars from all fixtures + common CJK sample + ASCII + CJK punct.
const COMMON_SAMPLE =
  "的一是了我不人在他有这上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感";
const FIXTURE_TEXTS = [
  "标题：创意与“结构”\n第二行 <标签> & 引用——",
  "line1: mixed 中英 EN\nline2: 标点，、；：？！",
  "数字 12345 与 3.14159\n负数 -0 与 +9",
  "起点", "目标 & <关联>", "左上", "原点右下", "黑板·起点", "黑板·分支", "缺字",
  "创意灵感结构记忆联想聚焦发散收敛节奏边界张力留白线索锚点回溯",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?-_=+()[]{}#@%&*",
];
// Private-use codepoints: expected MISSING in every candidate (missing-glyph fixture behavior)
const PUA_EXPECTED_MISSING = "\uE003\uE0B4\uE2D5\uF8FF"; // PUA: expect missing in all candidates

function corpusChars() {
  const set = new Set();
  for (const ch of COMMON_SAMPLE + FIXTURE_TEXTS.join("")) {
    if (ch !== "\n") set.add(ch);
  }
  return [...set];
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function evaluate(candidate) {
  const dest = resolve(OUT_DIR, `${candidate.id}.${candidate.url.split(".").pop()}`);
  const record = { ...candidate, file: dest, ok: false };
  try {
    if (!existsSync(dest)) {
      console.log(`downloading ${candidate.id} ...`);
      await download(candidate.url, dest);
    }
    record.sizeBytes = statSync(dest).size;
    const font = fontkitOpen(dest);
    record.fontType = font.type;
    record.numGlyphs = font.numGlyphs;

    const chars = corpusChars();
    let covered = 0;
    const missing = [];
    for (const ch of chars) {
      const cp = ch.codePointAt(0);
      if (font.hasGlyphForCodePoint(cp)) covered++;
      else missing.push(ch);
    }
    record.coverage = {
      corpusSize: chars.length,
      covered,
      ratio: +(covered / chars.length).toFixed(4),
      missingSample: missing.slice(0, 20),
    };
    const puaMissing = [...PUA_EXPECTED_MISSING].every(
      (ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0))
    );
    record.puaCorrectlyMissing = puaMissing;

    record.ok = true;
  } catch (err) {
    record.error = String(err.message ?? err);
  }
  return record;
}

mkdirSync(OUT_DIR, { recursive: true });
const results = [];
for (const c of CANDIDATES) {
  results.push(await evaluate(c));
}

// Summary ordered: OFL first, then coverage desc, then size asc
results.sort((a, b) =>
  (b.ofl - a.ofl) || ((b.coverage?.ratio ?? 0) - (a.coverage?.ratio ?? 0)) || ((a.sizeBytes ?? 1e12) - (b.sizeBytes ?? 1e12))
);

const report = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  corpus: { commonSampleChars: COMMON_SAMPLE.length, fixtureDerived: true, puaExpectedMissing: PUA_EXPECTED_MISSING.length },
  results: results.map(({ url, ...rest }) => rest),
};
const outPath = resolve(OUT_DIR, "font-evaluation.json");
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`\nreport -> ${outPath}`);
for (const r of results) {
  console.log(
    `${r.ok ? "OK " : "ERR"} ${r.id.padEnd(28)} ofl=${r.ofl ? "Y" : "N"} ` +
    `size=${r.sizeBytes ? (r.sizeBytes / 1048576).toFixed(1) + "MB" : "-"} ` +
    `coverage=${r.coverage ? (r.coverage.ratio * 100).toFixed(2) + "%" : "-"} ` +
    `puaMissing=${r.puaCorrectlyMissing ? "Y" : "?"} ${r.error ?? ""}`
  );
}
