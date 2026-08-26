// Deterministic synthetic mind-map fixtures for MM-010 spike.
// Seeded PRNG (mulberry32) — identical bytes across machines/runs.
// Output: .tmp/runtime-spike/fixtures/*.json (MindMapDocumentV1 shape, per ADR 0003 draft)

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = resolve(ROOT, ".tmp/runtime-spike/fixtures");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CN_WORDS = ["创意", "灵感", "结构", "记忆", "联想", "聚焦", "发散", "收敛", "节奏", "边界", "张力", "留白", "线索", "锚点", "回溯"];
const EN_WORDS = ["idea", "spark", "structure", "memory", "link", "focus", "expand", "refine", "rhythm", "edge", "tension", "anchor", "trace"];
const PUNCT = ["，", "。", "、", "；", "：", "？", "！", "“”", "‘’"];

function makeNode(id, text, x, y, width, height) {
  return { id, text, position: { x, y }, size: { width, height } };
}

function doc(theme, nodes, edges) {
  return {
    schemaVersion: 1,
    document: {
      theme,
      nodes,
      edges: edges.map(([sourceNodeId, targetNodeId], i) => ({
        id: `edge-${i + 1}`,
        sourceNodeId,
        targetNodeId,
      })),
    },
  };
}

function write(name, data) {
  const path = resolve(OUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`wrote ${path}`);
}

mkdirSync(OUT_DIR, { recursive: true });

// --- empty-document ---
write("empty-document", doc("light", [], []));

// --- two-linked-nodes ---
write("two-linked-nodes", doc("light",
  [makeNode("n-1", "起点", 0, 0, 96, 40), makeNode("n-2", "目标 & <关联>", 220, 80, 128, 40)],
  [["n-1", "n-2"]]));

// --- negative-coordinates ---
write("negative-coordinates", doc("light",
  [makeNode("n-1", "左上", -480, -320, 96, 40), makeNode("n-2", "原点右下", 120, 60, 128, 40)],
  [["n-1", "n-2"]]));

// --- chinese-multiline: CJK + EN + punct + explicit newlines + XML-special chars ---
write("chinese-multiline", doc("light",
  [
    makeNode("n-1", "标题：创意与“结构”\n第二行 <标签> & 引用——", 0, 0, 260, 72),
    makeNode("n-2", "line1: mixed 中英 EN\nline2: 标点，、；：？！", 320, 120, 300, 72),
    makeNode("n-3", "数字 12345 与 3.14159\n负数 -0 与 +9", 680, 0, 220, 72),
  ],
  [["n-1", "n-2"], ["n-2", "n-3"], ["n-1", "n-3"]]));

// --- dark-theme ---
write("dark-theme", doc("dark",
  [makeNode("n-1", "黑板·起点", 0, 0, 120, 40), makeNode("n-2", "黑板·分支", 240, 100, 120, 40)],
  [["n-1", "n-2"]]));

// --- dense-300-450: 300 nodes / 450 edges, seeded layout on a spread grid ---
{
  const rand = mulberry32(300450);
  const NODES = 300, EDGES = 450;
  const COLS = 20;
  const nodes = [];
  for (let i = 1; i <= NODES; i++) {
    const col = (i - 1) % COLS, row = Math.floor((i - 1) / COLS);
    const jitterX = Math.round((rand() - 0.5) * 60);
    const jitterY = Math.round((rand() - 0.5) * 40);
    const zh = CN_WORDS[i % CN_WORDS.length];
    const en = EN_WORDS[(i * 7) % EN_WORDS.length];
    nodes.push(makeNode(`n-${i}`, `${zh}·${en}-${i}`,
      col * 220 + jitterX, row * 140 + jitterY, 140, 44));
  }
  const edges = new Set();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  let guard = 0;
  while (edges.size < EDGES && guard < EDGES * 50) {
    guard++;
    const a = 1 + Math.floor(rand() * NODES);
    let b = 1 + Math.floor(rand() * NODES);
    if (a === b) b = (b % NODES) + 1;
    // prefer near-neighbors for organic structure
    if (rand() < 0.7) {
      const colA = (a - 1) % COLS, rowA = Math.floor((a - 1) / COLS);
      const candidates = [a + 1, a + COLS, a - 1, a + COLS + 1].filter((x) => x >= 1 && x <= NODES);
      b = candidates[Math.floor(rand() * candidates.length)] ?? b;
    }
    if (a !== b) edges.add(key(`n-${a}`, `n-${b}`));
  }
  write("dense-300-450", doc("light", nodes, [...edges].map((k) => k.split("|"))));
}

// --- large-bounds: extreme aspect ratio canvas ---
{
  const nodes = [
    makeNode("n-1", "远左", -20000, -8000, 120, 44),
    makeNode("n-2", "远右", 20000, 8000, 120, 44),
    makeNode("n-3", "中", 0, 0, 120, 44),
  ];
  write("large-bounds", doc("light", nodes, [["n-1", "n-3"], ["n-3", "n-2"]]));
}

// --- missing-glyph: private-use codepoints no CJK font covers ---
write("missing-glyph", doc("light",
  [makeNode("n-1", "缺字测试", 0, 0, 220, 44)],
  []));

console.log("all fixtures generated.");
