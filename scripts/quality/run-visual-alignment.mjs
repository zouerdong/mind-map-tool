// scripts/quality/run-visual-alignment.mjs — VRA-080 视觉与动效真实验收 Runner
// 运行 6 层验收体系：静态外观、自动布局、800ms 连续动效、三格式真实导出、交互安全态与性能基线。

import { spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { isSameOrDescendant } from "./g2-scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const isCapture = process.argv.includes("--capture");
const EVIDENCE_DIR = isCapture
  ? resolve(ROOT, "docs/quality/evidence/visual-alignment")
  : resolve(ROOT, ".tmp/quality/visual-alignment");
const HARNESS = resolve(ROOT, "tests/visual/harness");

mkdirSync(EVIDENCE_DIR, { recursive: true });

function staticServer(rootDir, port) {
  const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".otf": "font/otf",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".svg": "image/svg+xml",
  };
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = resolve(rootDir, "." + urlPath);
      if (extname(filePath) === "") filePath = resolve(rootDir, "index.html");
      if (!isSameOrDescendant(rootDir, filePath)) throw new Error("path outside harness root");
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

function assertHarnessAsset(source, target) {
  if (!existsSync(source) || !existsSync(target)) {
    throw new Error(
      `visual harness 资产缺失: ${relative(ROOT, source)} / ${relative(ROOT, target)}`,
    );
  }
  if (!readFileSync(source).equals(readFileSync(target))) {
    throw new Error(
      `visual harness 资产漂移: ${relative(ROOT, target)} 必须与 ${relative(ROOT, source)} 一致`,
    );
  }
}

async function main() {
  console.log("\n================================================================================");
  console.log("  VRA-080: 视觉与动效真实验收 (Visual Alignment & Motion Verification)");
  console.log("================================================================================\n");

  // -------------------------------------------------------------
  // 1. 执行 Vitest 视觉不变量与三格式导出契约测试
  // -------------------------------------------------------------
  console.log("=== 1. 执行核心视觉不变量与三格式导出契约测试 (Vitest) ===");
  const vitestRes = spawnSync("pnpm", ["exec", "vitest", "run", "tests/visual", "--root", "."], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, MINDMAP_VISUAL_EVIDENCE_DIR: EVIDENCE_DIR },
  });
  if (vitestRes.status !== 0) {
    console.error("tests/visual 自动化不变量测试失败");
    process.exit(1);
  }
  console.log("  ✓ Vitest 视觉与动效契约测试全部通过\n");

  // -------------------------------------------------------------
  // 2. 准备并构建 React Flow 视觉测量宿主 (Harness)
  // -------------------------------------------------------------
  console.log("=== 2. 构建真实 React Flow 视觉测量宿主 (Vite) ===");
  const pub = resolve(HARNESS, "public");
  for (const f of [
    "noto-sans-sc-regular.woff2",
    "noto-sans-sc-bold.woff2",
    "lxgw-wenkai-regular.woff2",
  ]) {
    assertHarnessAsset(resolve(ROOT, "assets/fonts", f), resolve(pub, "fonts", f));
  }
  for (const f of [
    "reference-dag-12.json",
    "reference-dag-12-scattered.json",
    "motion-tree-17.json",
  ]) {
    assertHarnessAsset(resolve(ROOT, "tests/fixtures/visual", f), resolve(pub, "fixtures", f));
  }

  execFileSync("pnpm", ["--dir", resolve(ROOT, "apps/desktop"), "exec", "vite", "build", HARNESS], {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log("  ✓ Harness 构建完成\n");

  // -------------------------------------------------------------
  // 3. 真实浏览器采样视觉帧与全景截图
  // -------------------------------------------------------------
  console.log("=== 3. 采样真实 React Flow 画布与动效截图 (Playwright) ===");
  let browserCaptured = false;
  let browserNotice = "capture completed";

  let server = null;
  let browser = null;
  const captureStartedAt = Date.now();
  const browserEvidenceFiles = [
    "layer1-static-reference-1080x864.png",
    "layer1-static-dark-1080x864.png",
    "layer2-layout-horizontal.png",
    "layer2-layout-vertical.png",
    "layer3-motion-000ms.png",
    "layer3-motion-200ms.png",
    "layer3-motion-400ms.png",
    "layer3-motion-600ms.png",
    "layer3-motion-800ms.png",
    "layer3-motion-tree-17.png",
    "layer5-interaction-editing.png",
  ];
  try {
    const PORT = 5298;
    server = await staticServer(resolve(HARNESS, "dist"), PORT);
    browser = await chromium.launch();
    console.log("  ✓ Headless Chromium 启动成功，开始自动化采样...");

    // Layer 1: 1080x864 静态外观（暖白 & 黑板）
    console.log("  -> [Layer 1] 采样 1080x864 静态参考外观...");
    const p1 = await browser.newPage({ viewport: { width: 1080, height: 864 } });
    await p1.goto(`http://localhost:${PORT}/?fixture=reference-dag-12&theme=light`);
    await p1.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await p1.waitForTimeout(600);
    await p1.screenshot({ path: resolve(EVIDENCE_DIR, "layer1-static-reference-1080x864.png") });

    await p1.goto(`http://localhost:${PORT}/?fixture=reference-dag-12&theme=dark`);
    await p1.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await p1.waitForTimeout(600);
    await p1.screenshot({ path: resolve(EVIDENCE_DIR, "layer1-static-dark-1080x864.png") });
    await p1.close();
    console.log("     ✓ 静态暖白与黑板截图已生成");

    // Layer 2: 散乱自动整理终态
    console.log("  -> [Layer 2] 截取散乱自动整理终态 (横向 & 纵向)...");
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p2.goto(`http://localhost:${PORT}/?fixture=reference-dag-12-scattered&theme=light`);
    await p2.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await p2.waitForTimeout(400);

    await p2.evaluate(() => window.__organize && window.__organize("horizontal"));
    await p2.waitForTimeout(900);
    await p2.screenshot({ path: resolve(EVIDENCE_DIR, "layer2-layout-horizontal.png") });

    await p2.evaluate(() => window.__organize && window.__organize("vertical"));
    await p2.waitForTimeout(900);
    await p2.screenshot({ path: resolve(EVIDENCE_DIR, "layer2-layout-vertical.png") });
    await p2.close();
    console.log("     ✓ 横向与纵向整理终态截图已生成");

    // Layer 3: 800ms 动效关键帧序列与 17 节点树收束
    console.log("  -> [Layer 3] 采样 800ms 整理动效关键帧序列...");
    const p3 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p3.goto(`http://localhost:${PORT}/?fixture=reference-dag-12-scattered&theme=light`);
    await p3.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await p3.waitForTimeout(300);

    // 0ms
    await p3.screenshot({ path: resolve(EVIDENCE_DIR, "layer3-motion-000ms.png") });
    await p3.evaluate(() => window.__organize && window.__organize("horizontal"));

    // 200ms
    await p3.waitForTimeout(200);
    await p3.screenshot({ path: resolve(EVIDENCE_DIR, "layer3-motion-200ms.png") });

    // 400ms
    await p3.waitForTimeout(200);
    await p3.screenshot({ path: resolve(EVIDENCE_DIR, "layer3-motion-400ms.png") });

    // 600ms
    await p3.waitForTimeout(200);
    await p3.screenshot({ path: resolve(EVIDENCE_DIR, "layer3-motion-600ms.png") });

    // 800ms (稳定终态)
    await p3.waitForTimeout(300);
    await p3.screenshot({ path: resolve(EVIDENCE_DIR, "layer3-motion-800ms.png") });

    // 17 节点树收束
    await p3.goto(`http://localhost:${PORT}/?fixture=motion-tree-17&theme=light`);
    await p3.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await p3.waitForTimeout(300);
    await p3.evaluate(() => window.__organize && window.__organize("horizontal"));
    await p3.waitForTimeout(900);
    await p3.screenshot({ path: resolve(EVIDENCE_DIR, "layer3-motion-tree-17.png") });
    await p3.close();
    console.log("     ✓ 动效关键帧 (0/200/400/600/800ms) 及 17 节点树截图已生成");

    // Layer 5: 交互编辑操作态
    console.log("  -> [Layer 5] 截取节点富文本与交互编辑态...");
    const p5 = await browser.newPage({ viewport: { width: 1080, height: 864 } });
    await p5.goto(`http://localhost:${PORT}/?fixture=reference-dag-12&theme=light`);
    await p5.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await p5.waitForTimeout(400);
    const firstNode = p5.locator(".react-flow__node").first();
    await firstNode.dblclick();
    await p5.waitForTimeout(200);
    await p5.screenshot({ path: resolve(EVIDENCE_DIR, "layer5-interaction-editing.png") });
    await p5.close();
    console.log("     ✓ 交互编辑态截图已生成");

    for (const file of browserEvidenceFiles) {
      const evidencePath = resolve(EVIDENCE_DIR, file);
      if (!existsSync(evidencePath) || statSync(evidencePath).mtimeMs < captureStartedAt) {
        throw new Error(`本轮未生成视觉证据: ${relative(ROOT, evidencePath)}`);
      }
    }
    browserCaptured = true;
  } catch (err) {
    browserCaptured = false;
    browserNotice = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ 浏览器证据采集失败: ${browserNotice}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) {
      await new Promise((done) => server.close(done));
    }
  }

  // -------------------------------------------------------------
  // 4. 生成机器可读证据汇总
  // -------------------------------------------------------------
  const summaryReport = {
    batch: "VRA-080",
    title: "参考静态、动态与跨格式真实验收报告",
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    evidenceKind: "web-harness",
    environment: {
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      browserCapture: browserCaptured ? "PASS" : "DEFERRED_SANDBOX",
      notice: browserNotice,
    },
    verificationLayers: {
      layer1_static: {
        name: "1080×864 参考静态外观",
        status: browserCaptured ? "CAPTURED" : "INCOMPLETE",
        files: ["layer1-static-reference-1080x864.png", "layer1-static-dark-1080x864.png"],
        paletteTokens: {
          lightCanvas: "#F9F8F4",
          lightCard: "#141412",
          darkCanvas: "#16140F",
          darkCard: "#EFEAE0",
        },
      },
      layer2_layout: {
        name: "散乱坐标自动规整布局",
        status: browserCaptured ? "CAPTURED" : "INCOMPLETE",
        files: ["layer2-layout-horizontal.png", "layer2-layout-vertical.png"],
        checks: {
          nonOverlapping: true,
          finiteCoordinates: true,
          dagOrderingHorizontal: true,
          dagOrderingVertical: true,
          idempotentSecondRun: true,
        },
      },
      layer3_motion: {
        name: "800ms 动态整理与连续插值",
        status: browserCaptured ? "CAPTURED" : "INCOMPLETE",
        files: [
          "layer3-motion-000ms.png",
          "layer3-motion-200ms.png",
          "layer3-motion-400ms.png",
          "layer3-motion-600ms.png",
          "layer3-motion-800ms.png",
          "layer3-motion-tree-17.png",
        ],
        timeline: {
          durationMs: 800,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          leafFirstDelayMaxMs: 120,
          reducedMotionBypass: "0ms",
        },
      },
      layer4_export: {
        name: "三格式跨格式内容链导出",
        status: "PASS",
        files: [
          "reference-dag-12-export.svg",
          "reference-dag-12-export.png",
          "reference-dag-12-export.pdf",
        ],
        checks: {
          svgSemanticText: true,
          noForeignObject: true,
          png2xDimensions: true,
          pdfVectorHeader: true,
          canonicalJsonRoundtrip: true,
        },
      },
      layer5_interaction: {
        name: "交互编辑与异常安全态",
        status: browserCaptured ? "CAPTURED" : "INCOMPLETE",
        files: ["layer5-interaction-editing.png"],
        checks: {
          imeCompositionProtected: true,
          sessionUndoRedoSafe: true,
          noticeBannerNonDisruptive: true,
        },
      },
      layer6_performance: {
        name: "规模与性能基线",
        status: "NOT_MEASURED_HERE",
        budgetMs: 32,
        attribution: "React Flow",
        evidenceRequired: "run-performance.mjs 的独立原始样本；发布候选另需 native evidence",
      },
    },
    conclusion: browserCaptured ? "EVIDENCE_CAPTURED_OWNER_REVIEW_REQUIRED" : "INCOMPLETE",
    gFinal: "NOT_GRANTED_BY_THIS_RUNNER",
  };

  writeFileSync(
    resolve(EVIDENCE_DIR, "visual-evidence-summary.json"),
    JSON.stringify(summaryReport, null, 2),
    "utf-8",
  );

  console.log("\n================================================================================");
  console.log(`  VRA-080 证据采集总结: ${summaryReport.conclusion}`);
  console.log(`  证据与汇总已保存至: ${relative(ROOT, EVIDENCE_DIR)}`);
  console.log("  本 runner 不授予 G-FINAL；需项目负责人基于候选应用另行验收。");
  console.log("================================================================================\n");
  process.exit(browserCaptured ? 0 : 1);
}

main().catch((e) => {
  console.error("VRA-080 Runner 遇到异常:", e);
  process.exit(1);
});
