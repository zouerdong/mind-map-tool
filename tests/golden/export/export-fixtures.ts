// 导出 golden 夹具（MM-040 ⑤ / 测试规格 §3.1 + 新特性变体）。
// 确定性生成（固定内容，无随机）；node size 由共享 layout 契约计算。
// REGEN=1 vitest run tests/golden/export → 重写夹具文件与 golden 清单。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDocument, type MindMapDocumentV1, type TextRun } from "@mindmap/core";
import { createExportRenderer } from "@mindmap/export";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const FIXTURE_DIR = resolve(ROOT, "tests/fixtures/export");
const GOLDEN_MANIFEST = resolve(HERE, "golden-manifest.json");

const REGEN = process.env.REGEN === "1";
const sha256 = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

async function loadFonts() {
  const { readFile } = await import("node:fs/promises");
  const dir = resolve(ROOT, "assets/fonts");
  return {
    "noto-sans-sc-regular": new Uint8Array(
      await readFile(resolve(dir, "noto-sans-sc-regular.otf")),
    ),
    "noto-sans-sc-bold": new Uint8Array(await readFile(resolve(dir, "noto-sans-sc-bold.otf"))),
    "lxgw-wenkai-regular": new Uint8Array(await readFile(resolve(dir, "lxgw-wenkai-regular.ttf"))),
  };
}

const wasm = (() => {
  // pnpm 布局：从 packages/export 的依赖上下文解析 resvg-wasm 包根
  const req = createRequire(resolve(ROOT, "packages/export/package.json"));
  const pkgRoot = dirname(req.resolve("@resvg/resvg-wasm"));
  return new Uint8Array(readFileSync(resolve(pkgRoot, "index_bg.wasm")));
})();

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function buildFixtures(): Promise<Record<string, MindMapDocumentV1>> {
  const renderer = await createExportRenderer({ fonts: await loadFonts(), resvgWasm: wasm });
  // 节点权威 size 一律走 VRA-040 共同绘制契约（kicker + runs，16px 正文）。
  const mk = (
    id: string,
    text: string,
    runs?: TextRun[],
    pos: { x: number; y: number } = { x: 0, y: 0 },
    mut?: (doc: MindMapDocumentV1) => void,
    visual?: { kicker?: string; emphasis?: boolean },
  ) => {
    const doc = emptyDocument();
    const node = {
      id,
      text,
      position: { ...pos },
      size: renderer.measureNodeVisual(
        { text, runs, ...(visual?.kicker !== undefined ? { kicker: visual.kicker } : {}) },
        doc.document.font,
      ),
      ...(runs ? { runs } : {}),
      ...(visual?.kicker !== undefined && visual.kicker.length > 0 ? { kicker: visual.kicker } : {}),
      ...(visual?.emphasis ? { emphasis: true } : {}),
    };
    doc.document.nodes.push(node);
    mut?.(doc);
    return doc;
  };

  const fixtures: Record<string, MindMapDocumentV1> = {};

  fixtures["empty-document"] = emptyDocument();

  const two = mk("n-1", "起点", undefined, { x: 0, y: 0 });
  const twoTarget = mk("n-2", "目标 & <关联>", undefined, { x: 220, y: 80 });
  two.document.nodes.push(twoTarget.document.nodes[0]!);
  two.document.edges.push({ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" });
  fixtures["two-linked-nodes"] = two;

  const neg = mk("n-1", "左上", undefined, { x: -480, y: -320 });
  const negB = mk("n-2", "原点右下", undefined, { x: 120, y: 60 });
  neg.document.nodes.push(negB.document.nodes[0]!);
  neg.document.edges.push({ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" });
  fixtures["negative-coordinates"] = neg;

  const richText = "标题：创意与“结构”\n第二行 <标签> & 引用——";
  const richRuns: TextRun[] = [
    { start: 0, end: 2, bold: true },
    { start: 3, end: 5, fontSize: 22 },
    { start: 15, end: 18, underline: true },
  ];
  const rich = mk("n-1", richText, richRuns);
  const richB = mk("n-2", "line1: mixed 中英 EN\nline2: 标点，、；：？！", undefined, {
    x: 340,
    y: 120,
  });
  rich.document.nodes.push(richB.document.nodes[0]!);
  rich.document.edges.push({ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" });
  fixtures["chinese-multiline"] = rich; // 兼具富文本覆盖

  const dark = mk("n-1", "黑板·起点");
  const darkB = mk("n-2", "黑板·分支", undefined, { x: 240, y: 100 });
  dark.document.theme = "dark";
  dark.document.nodes.push(darkB.document.nodes[0]!);
  dark.document.edges.push({ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" });
  fixtures["dark-theme"] = dark;

  const framesHidden = mk("n-1", "无框模式·纯文字", undefined, { x: 0, y: 0 }, (doc) => {
    doc.document.framesVisible = false;
  });
  const fhB = mk("n-2", "第二点", undefined, { x: 260, y: 40 }, (doc) => {
    doc.document.framesVisible = false;
  });
  framesHidden.document.nodes.push(fhB.document.nodes[0]!);
  framesHidden.document.edges.push({ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" });
  fixtures["frames-hidden"] = framesHidden;

  const ellipse = mk("n-1", "椭圆默认", undefined, { x: 0, y: 0 }, (doc) => {
    doc.document.shape = "ellipse";
  });
  ellipse.document.nodes.push({
    id: "n-2",
    text: "单点卡片",
    position: { x: 240, y: 100 },
    size: renderer.measureNodeVisual({ text: "单点卡片" }, "noto-sans-sc"),
    shape: "card", // 单节点覆盖
  });
  ellipse.document.edges.push({ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" });
  fixtures["ellipse-shape"] = ellipse;

  const lxgw = mk("n-1", "文楷手写·文楷手写", undefined, { x: 0, y: 0 }, (doc) => {
    doc.document.font = "lxgw-wenkai";
  });
  const lxgwRuns: TextRun[] = [{ start: 0, end: 4, bold: true }]; // 文楷模拟粗体
  lxgw.document.nodes[0]!.runs = lxgwRuns;
  lxgw.document.nodes[0]!.size = renderer.measureNodeVisual(
    { text: "文楷手写·文楷手写", runs: lxgwRuns },
    "lxgw-wenkai",
  );
  fixtures["lxgw-font"] = lxgw;

  fixtures["missing-glyph"] = mk(
    "n-1",
    `缺字${String.fromCodePoint(0xe003, 0xe0b4, 0xf8ff)}`,
    undefined,
    { x: 0, y: 0 },
  );

  // dense-300-450
  {
    const rand = mulberry32(300450);
    const doc = emptyDocument();
    const NODES = 300,
      EDGES = 450,
      COLS = 20;
    const zh = "创意灵感结构记忆联想聚焦发散收敛节奏边界张力留白线索锚点回溯";
    const en =
      "idea spark structure memory link focus expand refine rhythm edge tension anchor trace";
    for (let i = 1; i <= NODES; i++) {
      const text = `${zh[i % zh.length]}·${en[(i * 7) % en.length]}-${i}`;
      const box = renderer.measureNodeVisual({ text }, "noto-sans-sc");
      const col = (i - 1) % COLS,
        row = Math.floor((i - 1) / COLS);
      doc.document.nodes.push({
        id: `n-${i}`,
        text,
        position: {
          x: col * 220 + Math.round((rand() - 0.5) * 60),
          y: row * 140 + Math.round((rand() - 0.5) * 40),
        },
        size: box,
      });
    }
    const edges = new Set<string>();
    let guard = 0;
    while (edges.size < EDGES && guard < EDGES * 50) {
      guard++;
      const a = 1 + Math.floor(rand() * NODES);
      let b = 1 + Math.floor(rand() * NODES);
      if (a === b) b = (b % NODES) + 1;
      if (rand() < 0.7) {
        const candidates = [a + 1, a + COLS, a - 1, a + COLS + 1].filter(
          (x) => x >= 1 && x <= NODES,
        );
        b = candidates[Math.floor(rand() * candidates.length)] ?? b;
      }
      if (a !== b) edges.add(a < b ? `n-${a} n-${b}` : `n-${b} n-${a}`);
    }
    let ei = 1;
    for (const key of edges) {
      const [a, b] = key.split(" ");
      doc.document.edges.push({ id: `e-${ei++}`, sourceNodeId: a!, targetNodeId: b! });
    }
    fixtures["dense-300-450"] = doc;
  }

  // visual-style-v2（VRA-040）：G-VIS 12 节点参考 DAG 的 canonical 横向终态。
  // 覆盖：kicker（含长中文眉题）、emphasis、dashed/dotted 两种线型、多行正文、
  // 多入边端口、跨层长边（内部直连 + 贴边通道）、孤立节点。
  {
    const doc = emptyDocument();
    // 横向五列（层沿 x 递增，同层沿 y 堆叠）；孤立节点主图下方成行、首项左齐第一列。
    const POS: Record<string, { x: number; y: number }> = {
      "n-capture": { x: 0, y: 0 },
      "n-notes": { x: 0, y: 160 },
      "n-review-loop": { x: 0, y: 320 },
      "n-hooks": { x: 0, y: 480 },
      "n-skills": { x: 320, y: 0 },
      "n-subtasks": { x: 320, y: 160 },
      "n-evals": { x: 320, y: 320 },
      "n-design": { x: 640, y: 0 },
      "n-peer": { x: 640, y: 200 },
      "n-cicd": { x: 960, y: 200 },
      "n-close": { x: 1240, y: 200 },
      "n-inbox": { x: 0, y: 640 }, // 孤立节点
    };
    const TEXT: Record<string, string> = {
      "n-inbox": "收件箱 Inbox",
      "n-capture": "捕捉灵感 Capture",
      "n-notes": "知识库 Notes",
      "n-review-loop": "反馈环 Review loop",
      "n-hooks": "自动化 Hooks",
      "n-skills": "技能 Skills",
      "n-subtasks": "子任务 Subtasks",
      "n-evals": "评估 Evals",
      "n-design": "需求与设计\nRequirements & design",
      "n-peer": "同伴审阅 Peer review",
      "n-cicd": "持续集成 CI/CD",
      "n-close": "闭环收尾\nClosing the loop",
    };
    const KICKER: Record<string, string> = {
      "n-inbox": "入口 INBOX",
      "n-capture": "灵感 IDEA",
      "n-notes": "知识库长期沉淀 KNOWLEDGE BASE", // 长中文眉题（≤40 字符，ADR 0010）
      "n-review-loop": "验证 TEST",
      "n-hooks": "工具 TOOL",
      "n-skills": "工具 TOOL",
      "n-subtasks": "结构 STRUCT",
      "n-evals": "验证 TEST",
      "n-design": "设计 DESIGN",
      "n-peer": "发布 SHIP",
      "n-cicd": "发布 SHIP",
      "n-close": "回顾 RETRO",
    };
    const EMPHASIS = new Set(["n-capture", "n-notes", "n-review-loop", "n-hooks", "n-inbox"]);
    for (const [id, pos] of Object.entries(POS)) {
      const text = TEXT[id]!;
      doc.document.nodes.push({
        id,
        text,
        position: { ...pos },
        size: renderer.measureNodeVisual({ text, kicker: KICKER[id] }, doc.document.font),
        kicker: KICKER[id]!,
        ...(EMPHASIS.has(id) ? { emphasis: true } : {}),
      });
    }
    const EDGES: Array<[string, string, string, "solid" | "dashed" | "dotted"]> = [
      ["e-1", "n-capture", "n-design", "solid"],
      ["e-2", "n-capture", "n-close", "solid"], // 跨层长边
      ["e-3", "n-notes", "n-skills", "solid"],
      ["e-4", "n-notes", "n-subtasks", "solid"],
      ["e-5", "n-notes", "n-evals", "solid"],
      ["e-6", "n-review-loop", "n-subtasks", "dotted"],
      ["e-7", "n-review-loop", "n-evals", "solid"],
      ["e-8", "n-hooks", "n-cicd", "solid"], // 跨层长边
      ["e-9", "n-skills", "n-design", "solid"],
      ["e-10", "n-skills", "n-peer", "dashed"],
      ["e-11", "n-evals", "n-peer", "solid"],
      ["e-12", "n-peer", "n-cicd", "solid"],
      ["e-13", "n-cicd", "n-close", "solid"],
    ];
    for (const [id, s, t, lineStyle] of EDGES)
      doc.document.edges.push({
        id,
        sourceNodeId: s,
        targetNodeId: t,
        ...(lineStyle === "solid" ? {} : { lineStyle }),
      });
    doc.document.nodes.push({
      id: "n-mixed-runs",
      text: "强调加粗与下划线\n第二行",
      position: { x: 640, y: 420 },
      size: renderer.measureNodeVisual(
        {
          text: "强调加粗与下划线\n第二行",
          runs: [
            { start: 0, end: 4, bold: true },
            { start: 6, end: 9, underline: true },
          ],
        },
        doc.document.font,
      ),
      runs: [
        { start: 0, end: 4, bold: true },
        { start: 6, end: 9, underline: true },
      ],
    });
    doc.document.edges.push({
      id: "e-14",
      sourceNodeId: "n-peer",
      targetNodeId: "n-mixed-runs",
    });
    fixtures["visual-style-v2"] = doc;
  }

  fixtures["large-bounds"] = (() => {
    const doc = emptyDocument();
    doc.document.nodes.push(
      {
        id: "n-1",
        text: "远左",
        position: { x: -20000, y: -8000 },
        size: { width: 120, height: 44 },
      },
      {
        id: "n-2",
        text: "远右",
        position: { x: 20000, y: 8000 },
        size: { width: 120, height: 44 },
      },
      { id: "n-3", text: "中", position: { x: 0, y: 0 }, size: { width: 120, height: 44 } },
    );
    doc.document.edges.push(
      { id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-3" },
      { id: "e-2", sourceNodeId: "n-3", targetNodeId: "n-2" },
    );
    return doc;
  })();

  return fixtures;
}

export async function renderAll() {
  const renderer = await createExportRenderer({ fonts: await loadFonts(), resvgWasm: wasm });
  const fixtures = await buildFixtures();
  const results: Record<string, Record<string, unknown>> = {};
  for (const [name, doc] of Object.entries(fixtures)) {
    const t0 = Date.now();
    const entry: Record<string, unknown> = {};
    const sceneRes = renderer.buildScene(doc);
    if (!sceneRes.ok) {
      entry.error = sceneRes.error.code;
      results[name] = entry;
      continue;
    }
    const scene = sceneRes.scene;
    const svg = renderer.renderSvg(scene);
    entry.svgSha256 = sha256(svg);
    entry.width = scene.width;
    entry.height = scene.height;
    const png = await renderer.renderPng(svg, scene, 2);
    if (png.ok) {
      entry.pngSha256 = sha256(png.bytes);
      entry.pngWidth = png.width;
      entry.pngHeight = png.height;
    } else {
      entry.pngError = png.error.code;
    }
    const pdf = await renderer.renderPdf(scene);
    if (pdf.ok) entry.pdfSha256 = sha256(pdf.bytes);
    else entry.pdfError = pdf.error.code;
    console.log(`[golden] ${name}: ${Date.now() - t0}ms`);
    results[name] = entry;
  }
  return { fixtures, results, renderer };
}

export { FIXTURE_DIR, GOLDEN_MANIFEST, REGEN, sha256 };

export function writeFixturesAndManifest(
  fixtures: Record<string, MindMapDocumentV1>,
  results: Record<string, Record<string, unknown>>,
) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, doc] of Object.entries(fixtures)) {
    writeFileSync(resolve(FIXTURE_DIR, `${name}.json`), JSON.stringify(doc, null, 2) + "\n");
  }
  writeFileSync(
    GOLDEN_MANIFEST,
    JSON.stringify({ generatedAt: "2026-08-26", results }, null, 2) + "\n",
  );
}

export function manifestExists(): boolean {
  return existsSync(GOLDEN_MANIFEST);
}

export function loadManifest(): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(GOLDEN_MANIFEST, "utf8")).results;
}
