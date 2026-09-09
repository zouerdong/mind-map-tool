// run-performance.mjs — 性能预算采样（MM-050/MM-090/PRC-055 消费）。
// --fixture dense-300-450 --scope canvas|save|export|release --platform macos|windows
// --candidate <path> --evidence-dir <path> --output <evidence.json>
// fail-closed：无证据即失败，不用假数据填充。

import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, extname, join, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  loadAndValidateG2Scope,
  checkSigningHints,
  computeFileSha256,
  computeArtifactSha256,
  isSameOrDescendant,
  validateSafePath,
} from "./g2-scope.mjs";
import { RELEASE_BUDGETS as BUDGETS } from "./release-budgets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
// --root 可把路径解析指向另一仓库根（与 bundle-gate/verify-decision 相同的
// 复算/测试入口，供 attribution 的 clean-worktree 前置在测试中用独立
// fixture 仓库验证）；生产调用不传该参数，默认本仓库根。RUNNER_PATH 始终
// 是真实脚本自身——runnerSha256 与 --root 无关。
const ROOT = flag("root") ? resolve(flag("root")) : resolve(HERE, "../..");

const fixture = flag("fixture") ?? "dense-300-450";
const scope = flag("scope") ?? "canvas";
const platform = flag("platform") ?? "macos";
const output = flag("output");
const candidate = flag("candidate");
const evidenceDir = flag("evidence-dir");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const samplesCount = Number(flag("samples") ?? "20");
const skipCanvas = args.includes("--skip-canvas");
const diagnosticPreflightRequested = args.includes("--diagnostic-preflight");

if (!/^[a-z0-9-]+$/i.test(fixture)) {
  console.error("run-performance: FAIL — --fixture 只能使用字母、数字和连字符");
  process.exit(2);
}
if (!["canvas", "save", "export", "release", "attribution"].includes(scope)) {
  console.error(`run-performance: FAIL — 未知 --scope ${scope}`);
  process.exit(2);
}
if (!["macos", "windows"].includes(platform)) {
  console.error(`run-performance: FAIL — 未知 --platform ${platform}`);
  process.exit(2);
}

let outputRel = null;
if (output) {
  try {
    outputRel = validateSafePath(output, ROOT, "output");
  } catch (error) {
    console.error(`run-performance: FAIL — output 路径无效: ${error.message}`);
    process.exit(2);
  }
}

if (!Number.isInteger(samplesCount) || samplesCount < 1) {
  console.error("run-performance: FAIL — --samples 必须为正整数");
  process.exit(2);
}

if (platform === "windows") {
  console.error(
    "run-performance: BLOCKED — Windows 采样需 Windows 设备（R-013；v1 macOS 先行，ADR 0001 G1 平台范围决定）。raw evidence 不填充。",
  );
  process.exit(1);
}

// ==================== CANVAS HARNESS 与帧采样 ====================

const HARNESS = resolve(ROOT, "packages/ui/perf/canvas-perf-app");
const FIXTURE_SRC = resolve(ROOT, `tests/fixtures/export/${fixture}.json`);
const HARNESS_FIXTURE = resolve(HARNESS, `public/${fixture}.json`);

function staticServer(rootDir, port) {
  const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".ttf": "font/ttf",
    ".woff2": "font/woff2",
  };
  const server = createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = resolve(rootDir, `.${pathname}`);
    if (!isSameOrDescendant(rootDir, filePath) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ct = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": ct,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolveListening) => {
    server.listen(port, "127.0.0.1", () => resolveListening(server));
  });
}

async function frameStats(page, action) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    function tick(now) {
      window.__frames.push(now - last);
      last = now;
      if (window.__tracking) requestAnimationFrame(tick);
    }
    window.__tracking = true;
    requestAnimationFrame(tick);
  });
  await action();
  return page.evaluate(() => {
    window.__tracking = false;
    const f = window.__frames.slice(2);
    if (f.length === 0) return { p50: 0, p95: 0, max: 0, count: 0 };
    const sorted = [...f].sort((a, b) => a - b);
    return {
      count: f.length,
      p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 10) / 10,
      p95:
        Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 10) / 10,
      max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    };
  });
}

async function measureCanvas() {
  if (!existsSync(FIXTURE_SRC)) throw new Error(`fixture 不存在：${FIXTURE_SRC}`);
  if (!existsSync(HARNESS_FIXTURE)) throw new Error(`harness fixture 不存在：${HARNESS_FIXTURE}`);
  if (!readFileSync(FIXTURE_SRC).equals(readFileSync(HARNESS_FIXTURE))) {
    throw new Error("harness fixture 与权威 tests/fixtures/export 输入不一致");
  }

  execFileSync("pnpm", ["--filter", "@mindmap/desktop", "exec", "vite", "build"], {
    cwd: HARNESS,
    stdio: "inherit",
  });
  const distDir = resolve(HARNESS, "dist");
  let bundleBytes = 0;
  for (const f of readdirSync(resolve(distDir, "assets"))) {
    if (f.endsWith(".js")) bundleBytes += statSync(resolve(distDir, "assets", f)).size;
  }

  const PORT = 4173;
  const server = await staticServer(distDir, PORT);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    server.close();
    throw new Error(`Chromium 无法启动，不能生成 canvas 性能证据: ${err.message}`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__READY === true, { timeout: 30000 });
    await page.waitForTimeout(500);

    const nodeBox = await page.locator(".react-flow__node").first().boundingBox();
    if (!nodeBox) throw new Error("harness 未渲染出节点");

    const results = { bundleBytes, measurementSource: "web-harness" };
    results.pan = await frameStats(page, async () => {
      await page.mouse.move(640, 400);
      await page.mouse.down();
      for (let i = 0; i <= 30; i++) {
        await page.mouse.move(640 + i * 18, 400 + i * 6);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    });
    results.nodeDrag = await frameStats(page, async () => {
      await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
      await page.mouse.down();
      for (let i = 0; i <= 30; i++) {
        await page.mouse.move(
          nodeBox.x + nodeBox.width / 2 + i * 12,
          nodeBox.y + nodeBox.height / 2 + i * 5,
        );
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    });
    results.zoom = await frameStats(page, async () => {
      await page.mouse.move(640, 400);
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(0, -80);
        await page.waitForTimeout(16);
      }
    });
    results.probes = await page.evaluate(() => {
      return {
        nodeCount: document.querySelectorAll(".react-flow__node").length,
        attribution:
          document.querySelector(".react-flow__attribution")?.textContent?.trim() ?? null,
        ariaLabel:
          document.querySelector('[role="application"]')?.getAttribute("aria-label") ?? null,
      };
    });

    await page.close();
    return results;
  } finally {
    await browser.close();
    server.close();
  }
}

// ==================== 辅助计算与原生探针 ====================

function findCandidateExecutable(candidateAbs) {
  if (!existsSync(candidateAbs)) return null;
  const st = statSync(candidateAbs);
  if (st.isFile()) return candidateAbs;
  const macosDir = join(candidateAbs, "Contents/MacOS");
  if (existsSync(macosDir)) {
    const entries = readdirSync(macosDir);
    if (entries.includes("mindmap-desktop")) return join(macosDir, "mindmap-desktop");
    if (entries.includes("mind-map")) return join(macosDir, "mind-map");
    if (entries.includes("Mind Map")) return join(macosDir, "Mind Map");
    if (entries.length > 0) return join(macosDir, entries[0]);
  }
  return null;
}

function calcStats(samples) {
  if (!samples || samples.length === 0)
    return { min: null, max: null, p50: null, p95: null, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { min, max, p50, p95, count: samples.length };
}

function getTreeSizeBytes(dirPath) {
  let total = 0;
  function walk(p) {
    const st = lstatSync(p);
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) walk(join(p, f));
    } else {
      total += st.size;
    }
  }
  walk(dirPath);
  return total;
}

async function runLaunchSample(
  binPath,
  { timeoutMs = 15000, homeDir = null, captureRaw = false, rawCapBytesPerStream = 262_144 } = {},
) {
  return new Promise((resolveRun) => {
    const runId = randomUUID();
    const t0 = performance.now();
    let recordedTime = null;
    let readyEvent = null;
    let markerError = null;
    let timedOut = false;
    let forcedTermination = false;
    let settled = false;
    let child;
    let timeoutTimer;
    let postReadyTimer;
    let killWaitTimer;
    const buffers = { stdout: "", stderr: "" };
    // PRR-067 启动分段：sampler 侧记录 spawn 前后与每条 perf 行的接收
    // 时刻（sampler 本进程 monotonic）；host 事件自带 hostElapsedMs。
    // 跨进程 monotonic 不相减，只各自分段 + 接收时刻形成端到端界限。
    let tSpawnRequested = null;
    let tSpawned = null;
    const traceEvents = [];
    // PRR-067 审阅修正 6：有界原始输出捕获——每 chunk 记录 stream、
    // 全局 sequence、receivedAt（sampler monotonic，相对 t0）与原文文本；
    // 超过每流上限后停止保存文本但继续计数（truncated 标记）。
    const rawChunks = captureRaw ? [] : null;
    const rawCounters = captureRaw ? { stdout: 0, stderr: 0, sequence: 0 } : null;
    const rawSaved = captureRaw ? { stdout: 0, stderr: 0 } : null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(postReadyTimer);
      clearTimeout(killWaitTimer);
      resolveRun(captureRaw ? { ...result, rawOutput: rawOutputPayload() } : result);
    };

    const captureRawChunk = (stream, data) => {
      if (!captureRaw) return;
      const text = String(data);
      rawCounters[stream] += text.length;
      rawCounters.sequence += 1;
      const saved = rawSaved[stream] < rawCapBytesPerStream;
      if (saved) rawSaved[stream] += text.length;
      rawChunks.push({
        stream,
        sequence: rawCounters.sequence,
        receivedAt: Math.round((performance.now() - t0) * 10) / 10,
        bytes: Buffer.byteLength(text),
        ...(saved ? { text } : { truncated: true }),
      });
    };

    const acceptLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (typeof event?.milestone !== "string") return;
      // PRR-067：凡带 runId 的 perf JSON 行都进 trace（含 host 分段与
      // renderer-ready）；foreign runId 的事件不计入本样本 trace。
      if (event.runId === runId) {
        traceEvents.push({
          milestone: event.milestone,
          receivedAt: Math.round((performance.now() - t0) * 10) / 10,
          ...(Number.isFinite(event.hostElapsedMs) ? { hostElapsedMs: event.hostElapsedMs } : {}),
          ...(Number.isFinite(event.wallClockMs) ? { wallClockMs: event.wallClockMs } : {}),
          ...(Number.isFinite(event.pid) ? { pid: event.pid } : {}),
          ...(Number.isInteger(event.windowGeneration)
            ? { windowGeneration: event.windowGeneration }
            : {}),
          ...(event.milestone === "renderer-ready" && event.data ? { data: event.data } : {}),
        });
      }
      if (event?.milestone !== "renderer-ready") return;
      if (event.runId !== runId) {
        markerError = "renderer-ready 的 runId 与本次采样不匹配";
        return;
      }
      if (!Number.isInteger(event.windowGeneration) || event.windowGeneration <= 0) {
        markerError = "renderer-ready 缺少有效 windowGeneration";
        return;
      }
      if (readyEvent) return;

      readyEvent = event;
      recordedTime = Math.round((performance.now() - t0) * 10) / 10;
      clearTimeout(timeoutTimer);
      // launch 场景的 host 在输出 renderer-ready 后必须自行 app.exit(0)。
      // sampler 不主动 SIGTERM 制造“已退出”假象；超时只用于回收进程，
      // 且该样本明确判失败。
      postReadyTimer = setTimeout(() => {
        forcedTermination = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        killWaitTimer = setTimeout(
          () =>
            finish({
              elapsedMs: null,
              markerFound: false,
              exited: false,
              code: -1,
              runId,
              readyEvent,
              startupTrace: buildStartupTrace(tSpawnRequested, tSpawned, traceEvents),
              error: "renderer-ready 后候选未自行退出",
            }),
          3000,
        );
      }, 3000);
    };

    const onOutput = (stream, data) => {
      captureRawChunk(stream, data);
      buffers[stream] += String(data);
      const lines = buffers[stream].split(/\r?\n/);
      buffers[stream] = lines.pop() ?? "";
      for (const line of lines) acceptLine(line);
    };

    /** 附上原始输出摘要（captureRaw 启用时）。 */
    const rawOutputPayload = () =>
      captureRaw
        ? {
            capBytesPerStream: rawCapBytesPerStream,
            savedBytes: { ...rawSaved },
            totalChars: { stdout: rawCounters.stdout, stderr: rawCounters.stderr },
            chunkCount: rawChunks.length,
            truncatedChunks: rawChunks.filter((chunk) => chunk.truncated).length,
            chunks: rawChunks,
          }
        : undefined;

    const env = {
      ...process.env,
      MINDMAP_PERF_SAMPLE: "1",
      MINDMAP_PERF_RUN_ID: runId,
    };
    // HOME 隔离：cold 每样本全新目录、warm 共享目录（可复现缓存条件，
    // 不触碰真实用户数据；目录位于 G2 批准的 evidence 边界内）。
    if (homeDir) env.HOME = homeDir;

    try {
      tSpawnRequested = Math.round((performance.now() - t0) * 10) / 10;
      child = spawn(binPath, [], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      tSpawned = Math.round((performance.now() - t0) * 10) / 10;
    } catch (e) {
      return resolveRun({
        elapsedMs: null,
        markerFound: false,
        exited: false,
        code: 1,
        runId,
        readyEvent: null,
        startupTrace: buildStartupTrace(tSpawnRequested, tSpawned, traceEvents),
        ...(captureRaw ? { rawOutput: rawOutputPayload() } : {}),
        error: e.message,
      });
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      killWaitTimer = setTimeout(
        () =>
          finish({
            elapsedMs: null,
            markerFound: false,
            exited: false,
            code: -1,
            runId,
            readyEvent,
            startupTrace: buildStartupTrace(tSpawnRequested, tSpawned, traceEvents),
            error: `等待 renderer-ready 超时且候选未退出 (${timeoutMs}ms)`,
          }),
        3000,
      );
    }, timeoutMs);

    child.stdout.on("data", (data) => onOutput("stdout", data));
    child.stderr.on("data", (data) => onOutput("stderr", data));
    child.on("error", (error) => {
      finish({
        elapsedMs: null,
        markerFound: false,
        exited: false,
        code: 1,
        runId,
        readyEvent,
        startupTrace: buildStartupTrace(tSpawnRequested, tSpawned, traceEvents),
        error: error.message,
      });
    });

    child.on("exit", (code, signal) => {
      acceptLine(buffers.stdout);
      acceptLine(buffers.stderr);
      const valid =
        readyEvent !== null && !timedOut && !forcedTermination && code === 0 && signal === null;
      finish({
        elapsedMs: valid ? recordedTime : null,
        markerFound: valid,
        exited: true,
        code,
        signal: signal ?? null,
        runId,
        readyEvent,
        startupTrace: buildStartupTrace(tSpawnRequested, tSpawned, traceEvents),
        ...(valid
          ? {}
          : {
              error:
                markerError ??
                (timedOut
                  ? `等待 renderer-ready 超时 (${timeoutMs}ms)`
                  : forcedTermination
                    ? "renderer-ready 后候选未在 3 秒内退出"
                    : readyEvent
                      ? `候选在 renderer-ready 后未正常退出（code=${code}, signal=${signal ?? "none"}）`
                      : "候选进程退出前未报告精确 renderer-ready JSON"),
            }),
      });
    });
  });
}

// ==================== PRR-067 启动分段解析（fail-closed） ====================
//
// 从单个 launch 样本的 sampler/host 事件构造可复算的 startupTrace：
// - 必备里程碑 main-entered → setup-started → setup-complete → renderer-ready
//   （接收顺序）；缺任一、逆序、hostElapsedMs 负值都判 traceInvalid，
//   不伪造、不补默认值。旧候选（无埋点）自然得到 traceInvalid + missing
//   说明——这是事实而非错误。
// - 差值只在同一 origin 内计算：sampler（spawnRequested→spawned 与各
//   接收时刻）、host（main→setup 区间）。跨进程只给端到端界限差
//   （receivedAt 差值），并在字段名里显式声明 boundaries 语义。

const STARTUP_MILESTONES = ["main-entered", "setup-started", "setup-complete", "renderer-ready"];

function buildStartupTrace(spawnRequestedAt, spawnedAt, events) {
  const issues = [];
  const present = events.map((event) => event.milestone);
  for (const name of STARTUP_MILESTONES) {
    if (!present.includes(name)) issues.push(`missing:${name}`);
  }
  // 顺序校验：必备里程碑的接收顺序必须与协议一致（允许穿插其他事件）。
  const indices = STARTUP_MILESTONES.map((name) => present.indexOf(name)).filter((i) => i >= 0);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] <= indices[i - 1]) {
      issues.push(`out-of-order:${STARTUP_MILESTONES[i]}`);
    }
  }
  for (const event of events) {
    if (Number.isFinite(event.hostElapsedMs) && event.hostElapsedMs < 0) {
      issues.push(`negative-host-elapsed:${event.milestone}`);
    }
  }
  const byMilestone = Object.create(null);
  for (const event of events) {
    if (!byMilestone[event.milestone]) byMilestone[event.milestone] = event;
  }
  const hostDurations = {};
  const main = byMilestone["main-entered"];
  const setupStarted = byMilestone["setup-started"];
  const setupComplete = byMilestone["setup-complete"];
  const ready = byMilestone["renderer-ready"];
  if (main && setupStarted && Number.isFinite(main.hostElapsedMs)) {
    hostDurations.mainToSetupStartedMs =
      Math.round((setupStarted.hostElapsedMs - main.hostElapsedMs) * 10) / 10;
    if (hostDurations.mainToSetupStartedMs < 0)
      issues.push("negative-host-elapsed:mainToSetupStarted");
  }
  if (setupStarted && setupComplete) {
    hostDurations.setupDurationMs =
      Math.round((setupComplete.hostElapsedMs - setupStarted.hostElapsedMs) * 10) / 10;
    if (hostDurations.setupDurationMs < 0) issues.push("negative-host-elapsed:setupDuration");
  }
  // 端到端界限（sampler 接收时刻差；跨进程，仅作界限不作分段归因）。
  const boundaries = {};
  if (spawnedAt !== null && main) {
    boundaries.spawnedToMainEnteredReceivedMs = Math.round((main.receivedAt - spawnedAt) * 10) / 10;
  }
  if (spawnRequestedAt !== null && spawnedAt !== null) {
    boundaries.spawnCallMs = Math.round((spawnedAt - spawnRequestedAt) * 10) / 10;
  }
  if (setupComplete && ready) {
    boundaries.setupCompleteToReadyReceivedMs =
      Math.round((ready.receivedAt - setupComplete.receivedAt) * 10) / 10;
  }
  return {
    spawnRequestedAt,
    spawnedAt,
    events,
    boundaries,
    hostDurations,
    rendererEarlyTiming: ready?.data?.earlyTiming ?? null,
    traceValid: issues.length === 0,
    traceIssues: issues,
  };
}

// ==================== PRR-010 原生场景探针 ====================

const SCENARIO_TIMEOUTS_MS = {
  // PRR-066：RSS 稳定窗 30s（质量规范 v1-quality-gates）+ 采样（最多
  // 32×250ms）+ 启动，超时必须覆盖完整协议时长（不得超时后写 PASS）。
  rss: 90_000,
  canvas: 180_000,
  edit: 120_000,
  save: 120_000,
  "png-export": 240_000,
};

/** RSS 稳定窗声明值下限（与 host perf/mod.rs 的 RSS_MIN_SETTLE_MS 同源）。 */
const RSS_MIN_SETTLE_MS = 30_000;

/**
 * 单次场景采样：以指定 env 启动候选，收集全部 perf 事件直到进程真实退出。
 * 返回 {runId, events, readyEvent, exited, code, error?}——事件缺 renderer-ready
 * 或 scenario-result 由调用方判 INCOMPLETE，不填默认值。
 */
async function runScenarioSample(binPath, scenario, options = {}) {
  const {
    timeoutMs = SCENARIO_TIMEOUTS_MS[scenario] ?? 60_000,
    homeDir = null,
    fixturePath = null,
    saveTarget = null,
    exportTarget = null,
    samples = 20,
  } = options;
  return new Promise((resolveRun) => {
    const runId = randomUUID();
    const startedAtMs = performance.now();
    const events = [];
    let readyEvent = null;
    let timedOut = false;
    let settled = false;
    let child;
    let timeoutTimer;
    let killWaitTimer;
    const buffers = { stdout: "", stderr: "" };

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killWaitTimer);
      resolveRun({
        runId,
        events,
        readyEvent,
        exited: extra?.exited ?? false,
        code: extra?.code ?? null,
        durationMs: Math.round(performance.now() - startedAtMs),
        ...(extra?.error ? { error: extra.error } : {}),
      });
    };

    const acceptLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (typeof event?.runId !== "string" || typeof event?.milestone !== "string") return;
      if (event.runId !== runId) return;
      if (!Number.isInteger(event.windowGeneration) || event.windowGeneration <= 0) return;
      events.push(event);
      if (event.milestone === "renderer-ready" && !readyEvent) readyEvent = event;
    };

    const onOutput = (stream, data) => {
      buffers[stream] += String(data);
      const lines = buffers[stream].split(/\r?\n/);
      buffers[stream] = lines.pop() ?? "";
      for (const line of lines) acceptLine(line);
    };

    const env = {
      ...process.env,
      MINDMAP_PERF_SAMPLE: "1",
      MINDMAP_PERF_RUN_ID: runId,
      MINDMAP_PERF_SCENARIO: scenario,
      MINDMAP_PERF_SAMPLES: String(samples),
    };
    if (homeDir) env.HOME = homeDir;
    if (fixturePath) env.MINDMAP_PERF_FIXTURE = fixturePath;
    if (saveTarget) env.MINDMAP_PERF_SAVE_TARGET = saveTarget;
    if (exportTarget) env.MINDMAP_PERF_EXPORT_TARGET = exportTarget;

    try {
      child = spawn(binPath, [], { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return resolveRun({
        runId,
        events,
        readyEvent: null,
        exited: false,
        code: 1,
        durationMs: Math.round(performance.now() - startedAtMs),
        error: e.message,
      });
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      killWaitTimer = setTimeout(
        () => finish({ code: -1, error: `场景 ${scenario} 超时且候选未退出 (${timeoutMs}ms)` }),
        3000,
      );
    }, timeoutMs);

    child.stdout.on("data", (data) => onOutput("stdout", data));
    child.stderr.on("data", (data) => onOutput("stderr", data));
    child.on("error", (error) => finish({ code: 1, error: error.message }));
    child.on("exit", (code, signal) => {
      acceptLine(buffers.stdout);
      acceptLine(buffers.stderr);
      if (timedOut) return; // 超时路径由 killWaitTimer 收尾
      finish({
        exited: true,
        code,
        ...(readyEvent ? {} : { error: "场景退出前未报告 renderer-ready" }),
      });
    });
  });
}

/** 从场景事件提取 scenario-result 的 data；缺失/失败返回 null。 */
function scenarioResultData(run, scenario) {
  if (!run.exited || run.code !== 0 || !run.readyEvent) return null;
  const readyIndex = run.events.findIndex((event) => event.milestone === "renderer-ready");
  const resultIndex = run.events.findIndex(
    (event) => event.milestone === "scenario-result" && event.scenario === scenario && event.data,
  );
  if (readyIndex < 0 || resultIndex <= readyIndex) return null;
  return run.events[resultIndex]?.data ?? null;
}

function scenarioFailureReason(run, scenario) {
  const failed = run.events.find(
    (event) => event.milestone === "scenario-failed" && event.scenario === scenario,
  );
  if (failed) return failed.reason ?? "unknown";
  return run.error ?? "场景未产出 scenario-result";
}

// ==================== PRR-067 ATTRIBUTION 诊断管线 ====================
//
// 冷启动归因专用（诊断证据，绝不进入发布 manifest）：candidate 与
// evidence-dir 必须同属 `.tmp/prr-067-*`；measurementMode 固定为
// attribution-diagnostic。不做预算判定、不改 release 语义；fail-closed
// 只针对采样完整性（样本失败即停，不跳样、不挑样）。

function isPrr067DiagnosticPath(absPath) {
  const rel = relative(ROOT, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  const segments = rel.split(sep);
  return segments[0] === ".tmp" && (segments[1] ?? "").startsWith("prr-067-");
}

function safeExecText(command, args) {
  try {
    const r = execFileSync(command, args, { encoding: "utf8", timeout: 10_000 });
    return r.trim();
  } catch {
    return null;
  }
}

function captureSystemSnapshot() {
  const loadavg = safeExecText("sysctl", ["-n", "vm.loadavg"]);
  let totalCpuPercent = null;
  const psOut = safeExecText("ps", ["-axo", "pcpu="]);
  if (psOut !== null) {
    const sum = psOut
      .split("\n")
      .map((line) => Number.parseFloat(line.trim()))
      .filter((value) => Number.isFinite(value))
      .reduce((a, b) => a + b, 0);
    totalCpuPercent = Math.round(sum * 10) / 10;
  }
  const vmStat = safeExecText("vm_stat", []);
  const pagesFree = vmStat ? ((vmStat.match(/Pages free\s+(\d+)/) ?? [])[1] ?? null) : null;
  const thermal = safeExecText("pmset", ["-g", "therm"]);
  return {
    capturedAt: new Date().toISOString(),
    loadavg,
    totalCpuPercent,
    pagesFree,
    thermal,
  };
}

if (scope === "attribution") {
  if (!candidate || !evidenceDir) {
    console.error(
      "run-performance: FAIL — attribution scope 必须指定 --candidate <path> 与 --evidence-dir <path>",
    );
    process.exit(1);
  }
  const homeMode = flag("home-mode") ?? "fresh";
  const conditioningFirst = args.includes("--conditioning-first");
  const label = flag("label") ?? "attribution";
  // PRR-067 审阅修正 5：legacy-timing-only——仅对无分段埋点的旧候选测时间
  // 分布；该模式不校验 startupTrace，报告声明 segmentationEvidence=false，
  // 不得用作分段归因证据。
  const legacyTimingOnly = args.includes("--legacy-timing-only");
  if (!["fresh", "shared"].includes(homeMode)) {
    console.error("run-performance: FAIL — --home-mode 只支持 fresh|shared");
    process.exit(1);
  }
  if (conditioningFirst && homeMode !== "shared") {
    console.error("run-performance: FAIL — --conditioning-first 只允许与 --home-mode shared 搭配");
    process.exit(1);
  }
  if (!Number.isInteger(samplesCount) || samplesCount < 1) {
    console.error("run-performance: FAIL — --samples 必须为正整数");
    process.exit(1);
  }
  const candidateAbs = resolve(ROOT, candidate);
  const evidenceDirAbs = resolve(ROOT, evidenceDir);
  // PRR-067 审阅修正 1：attribution 必须从 clean worktree 运行——报告的
  // sourceCommit/runnerSha256 要对应可重建的真实快照；先形成 clean commit
  //（诊断实现与测试），再构建诊断候选并采样。
  let attributionGitHead;
  let attributionStatus;
  try {
    attributionGitHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    attributionStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    console.error(`run-performance: BLOCKED — 无法读取 git 状态: ${error.message}`);
    process.exit(1);
  }
  if (attributionStatus.length > 0) {
    console.error(
      "run-performance: BLOCKED — attribution 必须从 clean worktree 运行（先把诊断实现与测试形成 clean commit）",
    );
    process.exit(1);
  }
  let validatedScope;
  try {
    validatedScope = loadAndValidateG2Scope({
      scopeFrom,
      host: "tauri",
      action: "measure-performance",
      repoRoot: ROOT,
    });
  } catch (err) {
    console.error(`run-performance: BLOCKED — G2 scope 校验失败: ${err.message}`);
    process.exit(1);
  }
  // candidate 边界：只允许 (a) .tmp/prr-067-* 内的诊断副本/诊断构建，或
  // (b) G2 批准的正式 candidate 原路径（B0 组只读 spawn，不写不删）；
  // evidence-dir 必须在 .tmp/prr-067-* 诊断边界内（诊断证据不进发布树）。
  const relCandidate = relative(ROOT, candidateAbs);
  const candidateInDiagnostic = isPrr067DiagnosticPath(candidateAbs);
  const candidateIsG2Approved =
    validatedScope.scope?.candidateOutputPaths?.includes(relCandidate) ?? false;
  if (!candidateInDiagnostic && !candidateIsG2Approved) {
    console.error(
      "run-performance: FAIL — attribution 的 --candidate 必须位于 .tmp/prr-067-* 诊断边界或 G2 批准的正式 candidate 原路径（只读）",
    );
    process.exit(1);
  }
  if (!isPrr067DiagnosticPath(evidenceDirAbs)) {
    console.error(
      "run-performance: FAIL — attribution 的 --evidence-dir 必须位于 .tmp/prr-067-* 诊断边界",
    );
    process.exit(1);
  }
  const hits = checkSigningHints("tauri", ROOT);
  if (hits.length) {
    console.error(`run-performance: FAIL — 检测到签名凭据（${hits.join(", ")}）`);
    process.exit(1);
  }
  if (!existsSync(candidateAbs) || lstatSync(candidateAbs).isSymbolicLink()) {
    console.error(`run-performance: FAIL — 候选产物不存在或为符号链接: ${candidate}`);
    process.exit(1);
  }
  const binPath = findCandidateExecutable(candidateAbs);
  if (!binPath) {
    console.error(`run-performance: FAIL — 无法在候选产物中找到可执行文件: ${candidate}`);
    process.exit(1);
  }
  mkdirSync(evidenceDirAbs, { recursive: true });
  const logsDir = join(evidenceDirAbs, "logs", label);
  mkdirSync(logsDir, { recursive: true });

  const candidateSha256 = computeArtifactSha256(candidateAbs);
  const binarySha256 = computeFileSha256(binPath);
  const xattrNames = safeExecText("xattr", [binPath]);
  const systemBefore = captureSystemSnapshot();

  const samples = [];
  const runs = [];
  let conditioningRun = null;
  const homeRoot = join(evidenceDirAbs, "homes", label);
  const samplingStartedAt = new Date().toISOString();

  // 复用 runLaunchSample（同一 spawn/renderer-ready 协议），外层补三件
  // 归因必需：逐样本保存结果（含有界原始 stdout/stderr chunk 与 trace）、
  // HOME 生命周期由 homeMode 决定、失败即停（不跳样不挑样）。
  const runOne = async (homeDir, index, kind) => {
    mkdirSync(homeDir, { recursive: true });
    const startedAt = new Date().toISOString();
    const result = await runLaunchSample(binPath, { homeDir, captureRaw: true });
    const logFile = join(logsDir, `${kind}-${String(index).padStart(3, "0")}.json`);
    writeFileSync(
      logFile,
      JSON.stringify(
        {
          index,
          kind,
          startedAt,
          finishedAt: new Date().toISOString(),
          homeDir: relative(ROOT, homeDir),
          result,
        },
        null,
        2,
      ) + "\n",
    );
    return result;
  };

  if (homeMode === "fresh") {
    for (let i = 0; i < samplesCount; i++) {
      const homeDir = join(homeRoot, `fresh-${i}`);
      const res = await runOne(homeDir, i, "fresh");
      runs.push(res);
      if (!res.markerFound || !Number.isFinite(res.elapsedMs)) break; // 失败即停：不跳样
      samples.push(res.elapsedMs);
      rmSync(homeDir, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 80));
    }
  } else {
    const sharedHome = join(homeRoot, "shared");
    if (conditioningFirst) {
      conditioningRun = await runOne(sharedHome, 0, "conditioning");
      if (!conditioningRun.markerFound) {
        console.error("run-performance: FAIL — conditioning 启动失败，后续样本无意义");
        process.exit(1);
      }
    }
    for (let i = 0; i < samplesCount; i++) {
      const res = await runOne(sharedHome, i + 1, "shared");
      runs.push(res);
      if (!res.markerFound || !Number.isFinite(res.elapsedMs)) break;
      samples.push(res.elapsedMs);
      await new Promise((r) => setTimeout(r, 40));
    }
    rmSync(sharedHome, { recursive: true, force: true });
  }
  const samplingFinishedAt = new Date().toISOString();
  const systemAfter = captureSystemSnapshot();
  const stats = calcStats(samples);
  const gitHead = attributionGitHead;
  // PRR-067 审阅修正 4：非 legacy 模式下，任一有效样本的 startupTrace 缺失
  // 必备里程碑、逆序、负 duration 或必要字段缺失 → 整轮 fail-closed。
  const traceFailureSamples = runs.filter(
    (run) => run.markerFound && run.startupTrace && !run.startupTrace.traceValid,
  );
  if (!legacyTimingOnly && traceFailureSamples.length > 0) {
    const issues = traceFailureSamples.flatMap((run) =>
      run.startupTrace.traceIssues.map((issue) => `${run.runId.slice(0, 8)}:${issue}`),
    );
    console.error(
      `run-performance: FAIL — ${traceFailureSamples.length} 个样本的 startupTrace 无效：` +
        `${issues.join(", ")}（分段证据不完整；旧候选请显式使用 --legacy-timing-only，该模式不得用作分段归因证据）`,
    );
  }

  const report = {
    schemaVersion: 2,
    task: "PRR-067",
    scope: "attribution",
    platform: "macOS",
    arch: process.arch,
    measurementMode: legacyTimingOnly
      ? "attribution-diagnostic-legacy-timing-only"
      : "attribution-diagnostic",
    segmentationEvidence: !legacyTimingOnly,
    legacyTimingOnlyDeclaration: legacyTimingOnly
      ? "timing-distribution only; startupTrace is NOT validated in this mode and must never be cited as segmentation/attribution evidence"
      : null,
    note: "diagnostic evidence only; must never enter release manifest or be re-labeled as release",
    sourceCommit: gitHead,
    sourceWorktree: "clean",
    runnerPath: RUNNER_PATH,
    runnerSha256: computeFileSha256(RUNNER_PATH),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    candidate,
    candidateSha256,
    executable: relative(ROOT, binPath),
    executableSha256: binarySha256,
    executableXattrNames: xattrNames,
    homeMode,
    conditioningFirst,
    conditioningRun,
    requestedSamples: samplesCount,
    validSamples: samples.length,
    samples,
    stats,
    runs,
    traceFailureCount: traceFailureSamples.length,
    systemBefore,
    systemAfter,
    startedAt: samplingStartedAt,
    finishedAt: samplingFinishedAt,
    samplingComplete: samples.length === samplesCount,
  };
  const reportPath = join(evidenceDirAbs, `cold-attribution-report-${label}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `run-performance: attribution[${label}] valid=${samples.length}/${samplesCount} ` +
      `p50=${stats.p50} max=${stats.max} → ${reportPath}`,
  );
  const pass = report.samplingComplete && (legacyTimingOnly || traceFailureSamples.length === 0);
  process.exit(pass ? 0 : 1);
}

// ==================== RELEASE 测量管线 ====================

if (scope === "release") {
  if (!candidate || !evidenceDir) {
    console.error(
      "run-performance: FAIL — release scope 必须指定 --candidate <path> 与 --evidence-dir <path>",
    );
    process.exit(1);
  }
  if (samplesCount < 20) {
    console.error("run-performance: FAIL — release scope 每组 cold/warm 至少需要 20 个样本");
    process.exit(1);
  }
  if (platform !== "macos" || process.platform !== "darwin" || process.arch !== "arm64") {
    console.error(
      `run-performance: BLOCKED — v1 原生证据必须在 macOS Apple Silicon 上采集（requested=${platform}, actual=${process.platform}/${process.arch}）`,
    );
    process.exit(1);
  }
  if (!candidate.endsWith(".app")) {
    console.error("run-performance: FAIL — macOS release candidate 必须是 G2 批准的 .app");
    process.exit(1);
  }

  // PRR-066 诊断预检模式：候选与证据都在 PRR-066 卡批准的 .tmp/prr-066-*
  // 边界内（独立 CARGO_TARGET_DIR 构建，不触碰 G2 正式 candidateOutputPaths
  // 与旧 PRR-070 证据）。该模式产物只作 PRR-066 预检证据，不进入发布验收
  // （PRR-070 从新 clean commit 以正式路径完整重做）；测量协议、样本数与
  // 预算门与正式模式完全一致，exit code 语义不变。
  const DIAGNOSTIC_PREFIX = "prr-066-";
  const isDiagnosticPath = (absPath) => {
    const rel = relative(ROOT, absPath);
    if (rel.startsWith("..") || isAbsolute(rel)) return false;
    const segments = rel.split(sep);
    return segments[0] === ".tmp" && (segments[1] ?? "").startsWith(DIAGNOSTIC_PREFIX);
  };
  const candidateAbs = resolve(ROOT, candidate);
  const evidenceDirAbs = resolve(ROOT, evidenceDir);
  const candidateDiagnostic = isDiagnosticPath(candidateAbs);
  const evidenceDiagnostic = isDiagnosticPath(evidenceDirAbs);
  if (candidateDiagnostic !== evidenceDiagnostic) {
    console.error(
      "run-performance: FAIL — --candidate 与 --evidence-dir 必须同属 PRR-066 诊断边界或 G2 正式批准边界",
    );
    process.exit(1);
  }
  if (candidateDiagnostic && !diagnosticPreflightRequested) {
    console.error(
      "run-performance: FAIL — .tmp/prr-066-* 诊断边界必须显式传入 --diagnostic-preflight",
    );
    process.exit(1);
  }
  if (diagnosticPreflightRequested && (!candidateDiagnostic || !evidenceDiagnostic)) {
    console.error(
      "run-performance: FAIL — --diagnostic-preflight 只允许 candidate/evidence 同属 .tmp/prr-066-* 边界",
    );
    process.exit(1);
  }
  const diagnostic = diagnosticPreflightRequested;

  // 1. G2 scope 校验（诊断模式只绑定 host/action；正式模式绑定 candidate/
  //    evidence 边界）
  let validated;
  try {
    validated = loadAndValidateG2Scope({
      scopeFrom,
      host: "tauri",
      action: "measure-performance",
      ...(diagnostic ? {} : { candidate, evidenceDir }),
      repoRoot: ROOT,
    });
  } catch (err) {
    console.error(`run-performance: BLOCKED — G2 scope 校验失败: ${err.message}`);
    process.exit(1);
  }

  // 2. 签名检测
  const hits = checkSigningHints("tauri", ROOT);
  if (hits.length) {
    console.error(`run-performance: FAIL — 检测到签名凭据（${hits.join(", ")}）`);
    process.exit(1);
  }

  if (!existsSync(candidateAbs)) {
    console.error(`run-performance: FAIL — 候选产物不存在: ${candidate}`);
    process.exit(1);
  }
  if (lstatSync(candidateAbs).isSymbolicLink()) {
    console.error("run-performance: FAIL — 候选产物不能是符号链接");
    process.exit(1);
  }

  if (outputRel && !isSameOrDescendant(evidenceDirAbs, resolve(ROOT, outputRel))) {
    console.error("run-performance: FAIL — release output 必须位于指定的 evidence-dir 内");
    process.exit(1);
  }

  const binPath = findCandidateExecutable(candidateAbs);
  if (!binPath) {
    console.error(`run-performance: FAIL — 无法在候选产物中找到可执行文件: ${candidate}`);
    process.exit(1);
  }

  const candidateSha256 = computeArtifactSha256(candidateAbs);
  const bundleBytes = lstatSync(candidateAbs).isDirectory()
    ? getTreeSizeBytes(candidateAbs)
    : statSync(candidateAbs).size;

  let installerBytes = null;
  if (diagnostic) {
    // 诊断候选与 DMG 同一 bundle 结构：.../bundle/macos/*.app + .../bundle/dmg/*.dmg
    const dmgDir = resolve(dirname(candidateAbs), "..", "dmg");
    const dmgFiles = existsSync(dmgDir)
      ? readdirSync(dmgDir).filter((f) => f.endsWith(".dmg"))
      : [];
    if (dmgFiles.length === 1) {
      const dmgAbs = join(dmgDir, dmgFiles[0]);
      if (lstatSync(dmgAbs).isFile()) installerBytes = statSync(dmgAbs).size;
    }
  } else {
    for (const cop of validated.scope.candidateOutputPaths) {
      if (cop.endsWith(".dmg")) {
        const dmgAbs = resolve(ROOT, cop);
        if (
          existsSync(dmgAbs) &&
          !lstatSync(dmgAbs).isSymbolicLink() &&
          lstatSync(dmgAbs).isFile()
        ) {
          installerBytes = statSync(dmgAbs).size;
        }
      }
    }
  }

  console.log(
    `run-performance: 开始原生候选性能采样 (${samplesCount} 次启动，可执行=${binPath})...`,
  );

  const skipScenarios = (flag("skip-scenarios") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const isScenarioSkipped = (name) =>
    (name === "canvas" && skipCanvas) || skipScenarios.includes(name);

  const fixtureSha256 = computeFileSha256(FIXTURE_SRC);
  const homeRoot = join(evidenceDirAbs, "perf-homes");
  mkdirSync(homeRoot, { recursive: true });
  const saveTarget = join(evidenceDirAbs, "perf-sample-save.mindmap");
  const exportTarget = join(evidenceDirAbs, "perf-sample-export.png");
  const samplingStartedAt = new Date().toISOString();
  // sourceCommit 在采样开始前固定（conditioning/cold-cond 证据与 raw/summary
  // 引用同一个 HEAD；采样期间本进程不提交任何 commit）。
  let gitHead = "unknown";
  try {
    gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    gitHead = "unknown";
  }

  // 3.0 协议先导 conditioning（ADR 0006 1.1.0 / G-PERF-PROTOCOL 2026-09-09）：
  // release cold 采样开始前，对同一候选路径执行恰好一次 conditioning 启动——
  // 一次性隔离 HOME（采样后删除）、完整 renderer-ready + 进程真实退出（与
  // measured 样本相同校验）。成功则单独保存 cold-conditioning.json（绑定完整
  // source/candidate/runner SHA-256）；失败则整轮 INCOMPLETE——不补跑、不挑样、
  // 不与旧轮混样（重试=新一轮，旧轮保留作废）。conditioning 不计入 20 个
  // cold 样本。注意：attribution 诊断区的 --conditioning-first（shared-HOME
  // 预热）与 release conditioning 语义不同，后者是协议先导成功记录。
  const samplingProtocolConditioningDefinition =
    "release cold 采样前对同一候选路径执行恰好一次 conditioning：一次性隔离 HOME（采样后删除），完整 renderer-ready + 真实退出（与 measured 样本相同校验）；成功保存 cold-conditioning.json（绑定 source/candidate/runner SHA-256），失败整轮 INCOMPLETE；不计入 20 个 cold 样本";
  const conditioningHome = join(homeRoot, "conditioning");
  mkdirSync(conditioningHome, { recursive: true });
  const conditioningStartedAt = new Date().toISOString();
  const conditioningRun = await runLaunchSample(binPath, { homeDir: conditioningHome });
  rmSync(conditioningHome, { recursive: true, force: true });
  const conditioningFinishedAt = new Date().toISOString();
  const conditioningOk =
    conditioningRun.markerFound === true && Number.isFinite(conditioningRun.elapsedMs);
  const conditioningEvidence = {
    schemaVersion: 3,
    evidenceKind: "cold-conditioning",
    task: "MRT-011",
    scope: "release",
    platform: "macOS",
    arch: process.arch,
    sourceCommit: gitHead,
    runnerSha256: computeFileSha256(RUNNER_PATH),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    candidate,
    candidateSha256,
    generatedAt: conditioningFinishedAt,
    startedAt: conditioningStartedAt,
    finishedAt: conditioningFinishedAt,
    // 指标一 sessionFirstLaunchMs（记录型，无硬预算）：conditioning 启动耗时
    // （renderer-ready 完成点，与 measured 样本同一计时口径）；必须完整记录与
    // 展示（本 artifact + performance summary + native report + G-FINAL request）。
    sessionFirstLaunchMs: conditioningOk ? conditioningRun.elapsedMs : null,
    conditioning: {
      success: conditioningOk,
      elapsedMs: conditioningOk ? conditioningRun.elapsedMs : null,
      runId: conditioningRun.runId,
      markerFound: conditioningRun.markerFound,
      exited: conditioningRun.exited,
      code: conditioningRun.code ?? null,
      signal: conditioningRun.signal ?? null,
      readyEvent: conditioningRun.readyEvent ?? null,
      ...(conditioningRun.error ? { error: conditioningRun.error } : {}),
      startupTrace: conditioningRun.startupTrace,
    },
    homeIsolation:
      "conditioning 使用一次性隔离 HOME（采样后删除），与 measured cold 样本相同全新隔离语义",
    description: samplingProtocolConditioningDefinition,
    note: "conditioning 不计入任何样本与 percentile；失败则整轮 INCOMPLETE（证据保留，重试=新一轮）",
  };
  writeFileSync(
    join(evidenceDirAbs, "cold-conditioning.json"),
    JSON.stringify(conditioningEvidence, null, 2) + "\n",
  );
  if (!conditioningOk) {
    console.error(
      `run-performance: FAIL — release cold conditioning 未达成有效 renderer-ready+真实退出：` +
        `${conditioningRun.error ?? "unknown"}（整轮 INCOMPLETE；不得补跑/挑样/混样）`,
    );
  } else {
    console.log(
      `run-performance: cold conditioning 成功 sessionFirstLaunchMs=${conditioningRun.elapsedMs}ms → ` +
        `${join(evidenceDirAbs, "cold-conditioning.json")}`,
    );
  }

  // 3. 冷启动采样（conditioned cold 定义：一次成功 conditioning 之后的
  // candidate 路径启动，每样本全新隔离 HOME——WebView 缓存与应用支持目录在
  // 样本内首次创建；目录位于 G2 批准 evidence 边界内，样本后删除）
  const coldSamples = [];
  const coldRuns = [];
  for (let i = 0; conditioningOk && i < samplesCount; i++) {
    const homeDir = join(homeRoot, `cold-${i}`);
    mkdirSync(homeDir, { recursive: true });
    const res = await runLaunchSample(binPath, { homeDir });
    rmSync(homeDir, { recursive: true, force: true });
    coldRuns.push(res);
    if (!res.markerFound || !Number.isFinite(res.elapsedMs)) break;
    coldSamples.push(res.elapsedMs);
    await new Promise((r) => setTimeout(r, 80));
  }

  // 4. 热启动采样（warm 定义：同一隔离 HOME，一次不计入的预热启动后连续采样）
  const warmSamples = [];
  const warmRuns = [];
  if (coldSamples.length === samplesCount) {
    const warmHome = join(homeRoot, "warm");
    mkdirSync(warmHome, { recursive: true });
    await runLaunchSample(binPath, { homeDir: warmHome }); // 预热，不计入
    for (let i = 0; i < samplesCount; i++) {
      const res = await runLaunchSample(binPath, { homeDir: warmHome });
      warmRuns.push(res);
      if (!res.markerFound || !Number.isFinite(res.elapsedMs)) break;
      warmSamples.push(res.elapsedMs);
      await new Promise((r) => setTimeout(r, 40));
    }
    rmSync(warmHome, { recursive: true, force: true });
  }
  rmSync(homeRoot, { recursive: true, force: true });

  const coldStats = calcStats(coldSamples);
  const warmStats = calcStats(warmSamples);

  // 5. 原生场景探针（PRR-010）：rss / canvas / edit / save / png-export 全部
  // 在真实候选 WebView 内驱动；跳过或无 scenario-result 即 INCOMPLETE。
  const scenarioRunSummaries = [];
  let rssSamples = [];
  let rssResult = {
    measurementSource: "not-measured",
    status: "SKIPPED",
    readyEvent: null,
    reason: "rss probe skipped",
  };
  let canvasResult = null;
  let canvasError = null;
  let editSamples = [];
  let saveSamples = [];
  let pngExportSamples = [];
  // PRR-066：PNG 首次导出资源加载耗时（诊断值，不计入 2x PNG render p95）
  let pngResourceLoadMs = null;
  const editResult = { status: "SKIPPED", reason: "edit probe skipped" };
  const saveResult = { status: "SKIPPED", reason: "save probe skipped" };
  const pngResult = { status: "SKIPPED", reason: "png-export probe skipped" };

  const recordScenarioRun = (name, run) => {
    scenarioRunSummaries.push({
      scenario: name,
      runId: run.runId,
      readyEvent: run.readyEvent,
      eventMilestones: run.events.map((event) => event.milestone),
      exited: run.exited,
      code: run.code,
      durationMs: run.durationMs ?? null,
      ...(run.error ? { error: run.error } : {}),
    });
  };

  if (!isScenarioSkipped("rss")) {
    const homeDir = join(evidenceDirAbs, "perf-scenario-home", "rss");
    mkdirSync(homeDir, { recursive: true });
    const run = await runScenarioSample(binPath, "rss", {
      homeDir,
      samples: Math.max(5, Math.min(samplesCount, 32)),
    });
    recordScenarioRun("rss", run);
    const rssEvents = run.events.filter((event) => event.milestone === "rss-sample");
    const rssKbValues = rssEvents.map((event) => event.rssKb);
    const hasInvalid = rssKbValues.some((value) => !Number.isFinite(value) || value <= 0);
    const completed = run.events.some((event) => event.milestone === "rss-complete");
    // PRR-066：RSS 稳定窗协议——全部 rss 事件必须声明 ≥30s 的 settleMs
    // 且一致；缺失/不足/矛盾都判 INCOMPLETE，不得用 2s 窗口的样本充当
    // "30 秒 stable RSS" 发布证据。
    const settleDeclarations = run.events
      .filter((event) => event.milestone === "rss-sample" || event.milestone === "rss-complete")
      .map((event) => event.settleMs);
    const settleMsConsistent =
      settleDeclarations.length > 0 &&
      settleDeclarations.every((value) => Number.isInteger(value) && value >= RSS_MIN_SETTLE_MS) &&
      new Set(settleDeclarations).size === 1;
    const settledSettleMs = settleMsConsistent ? settleDeclarations[0] : null;
    if (
      run.exited &&
      run.code === 0 &&
      run.readyEvent &&
      completed &&
      !hasInvalid &&
      settleMsConsistent &&
      rssKbValues.length > 0
    ) {
      rssSamples = rssKbValues.map((kb) => Math.round((kb / 1024) * 10) / 10);
      rssResult = {
        measurementSource: "native-candidate",
        status: "OK",
        readyEvent: run.readyEvent,
        sampleCount: rssSamples.length,
        settleMs: settledSettleMs,
      };
    } else {
      rssResult = {
        measurementSource: "not-measured",
        status: "INCOMPLETE",
        readyEvent: run.readyEvent,
        reason: !settleMsConsistent
          ? `rss 事件缺少一致的 ≥${RSS_MIN_SETTLE_MS}ms settleMs（30 秒稳定窗协议不满足）`
          : hasInvalid
            ? "rss-sample 含非有限、零或负样本"
            : scenarioFailureReason(run, "rss"),
      };
    }
  }

  if (!isScenarioSkipped("canvas")) {
    const homeDir = join(evidenceDirAbs, "perf-scenario-home", "canvas");
    mkdirSync(homeDir, { recursive: true });
    const run = await runScenarioSample(binPath, "canvas", {
      homeDir,
      fixturePath: FIXTURE_SRC,
      samples: samplesCount,
    });
    recordScenarioRun("canvas", run);
    const data = scenarioResultData(run, "canvas");
    if (data) {
      canvasResult = { ...data, runId: run.runId };
    } else {
      canvasError = scenarioFailureReason(run, "canvas");
    }
  }

  if (!isScenarioSkipped("edit")) {
    const homeDir = join(evidenceDirAbs, "perf-scenario-home", "edit");
    mkdirSync(homeDir, { recursive: true });
    const run = await runScenarioSample(binPath, "edit", {
      homeDir,
      fixturePath: FIXTURE_SRC,
      samples: samplesCount,
    });
    recordScenarioRun("edit", run);
    const data = scenarioResultData(run, "edit");
    if (Array.isArray(data?.editSamples)) {
      editSamples = data.editSamples;
      editResult.status = "OK";
      editResult.reason = undefined;
    } else {
      editResult.status = "INCOMPLETE";
      editResult.reason = scenarioFailureReason(run, "edit");
    }
  }

  if (!isScenarioSkipped("save")) {
    const homeDir = join(evidenceDirAbs, "perf-scenario-home", "save");
    mkdirSync(homeDir, { recursive: true });
    const run = await runScenarioSample(binPath, "save", {
      homeDir,
      fixturePath: FIXTURE_SRC,
      saveTarget,
      samples: samplesCount,
    });
    recordScenarioRun("save", run);
    const data = scenarioResultData(run, "save");
    if (Array.isArray(data?.saveSamples)) {
      saveSamples = data.saveSamples;
      saveResult.status = "OK";
      saveResult.reason = undefined;
    } else {
      saveResult.status = "INCOMPLETE";
      saveResult.reason = scenarioFailureReason(run, "save");
    }
  }

  if (!isScenarioSkipped("png-export")) {
    const homeDir = join(evidenceDirAbs, "perf-scenario-home", "png-export");
    mkdirSync(homeDir, { recursive: true });
    const run = await runScenarioSample(binPath, "png-export", {
      homeDir,
      fixturePath: FIXTURE_SRC,
      exportTarget,
      samples: samplesCount,
    });
    recordScenarioRun("png-export", run);
    const data = scenarioResultData(run, "png-export");
    if (Array.isArray(data?.pngExportSamples)) {
      pngExportSamples = data.pngExportSamples;
      pngResourceLoadMs = Number.isFinite(data?.resourceLoadMs) ? data.resourceLoadMs : null;
      pngResult.status = "OK";
      pngResult.reason = undefined;
    } else {
      pngResult.status = "INCOMPLETE";
      pngResult.reason = scenarioFailureReason(run, "png-export");
    }
  }

  const rssStats = calcStats(rssSamples);
  const rssStableMb = Number.isFinite(rssStats.p50) && rssStats.p50 > 0 ? rssStats.p50 : null;
  const editStats = calcStats(editSamples);
  const saveStats = calcStats(saveSamples);
  const pngStats = calcStats(pngExportSamples);
  const canvasSampleGroups = canvasResult
    ? [
        canvasResult.panFrameSamples,
        canvasResult.nodeDragFrameSamples,
        canvasResult.zoomFrameSamples,
      ]
    : [];
  const canvasSamplesValid =
    canvasResult !== null &&
    canvasResult.rounds === samplesCount &&
    canvasResult.fixtureNodes >= 300 &&
    canvasResult.fixtureEdges >= 450 &&
    canvasSampleGroups.every(
      (samples) =>
        Array.isArray(samples) &&
        samples.length >= samplesCount &&
        samples.every((value) => Number.isFinite(value) && value > 0),
    );
  const canvasFrameP95 = canvasSamplesValid
    ? Math.max(...canvasSampleGroups.map((samples) => calcStats(samples).p95))
    : null;
  const canvasReportedMatches =
    canvasSamplesValid &&
    Number.isFinite(canvasResult.frameP95Ms) &&
    Math.abs(canvasResult.frameP95Ms - canvasFrameP95) < 0.001;

  // 6. 测算 web 静态资产
  const assetRun = spawn(
    process.execPath,
    [
      resolve(HERE, "measure-release-assets.mjs"),
      "--output",
      resolve(ROOT, evidenceDir, "release-assets.json"),
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const assetExitCode = await new Promise((resolveExit) => {
    assetRun.on("close", (code) => resolveExit(code ?? 1));
  });

  // 7. 评估门禁预算
  const incompleteReasons = [];
  if (!conditioningOk)
    incompleteReasons.push(
      `cold conditioning 未达成有效 renderer-ready+真实退出: ${conditioningRun.error ?? "unknown"}（整轮 INCOMPLETE；不得补跑/挑样/混样）`,
    );
  if (coldSamples.length !== samplesCount)
    incompleteReasons.push(
      `cold launch 缺少 renderer-ready 样本 (${coldSamples.length}/${samplesCount})`,
    );
  if (warmSamples.length !== samplesCount)
    incompleteReasons.push(
      `warm launch 缺少 renderer-ready 样本 (${warmSamples.length}/${samplesCount})`,
    );
  if (isScenarioSkipped("rss")) incompleteReasons.push("rss probe 被跳过");
  else if (rssResult.status !== "OK")
    incompleteReasons.push(`stable RSS 未采集到有效样本: ${rssResult.reason}`);
  if (rssSamples.length > 0 && rssSamples.length < 5)
    incompleteReasons.push(`rssSamples 少于 5 个 (${rssSamples.length})`);
  if (installerBytes === null) incompleteReasons.push("未找到 G2 批准的 installer 产物");
  if (isScenarioSkipped("canvas")) incompleteReasons.push("canvas probe 被跳过");
  else if (!canvasResult)
    incompleteReasons.push(`canvas probe 无证据${canvasError ? `: ${canvasError}` : ""}`);
  if (canvasResult?.measurementSource !== "native-candidate")
    incompleteReasons.push("canvas 数据并非来自 native candidate");
  if (canvasResult && !canvasSamplesValid)
    incompleteReasons.push("canvas raw frame samples/rounds/fixture 不完整或无效");
  else if (canvasResult && !canvasReportedMatches)
    incompleteReasons.push("canvas frameP95Ms 不能由 raw frame samples 复算");
  for (const [name, result, samples, minimum] of [
    ["edit", editResult, editSamples, 20],
    ["save", saveResult, saveSamples, 20],
    ["png-export", pngResult, pngExportSamples, 20],
  ]) {
    if (result.status === "SKIPPED") incompleteReasons.push(`${name} probe 被跳过`);
    else if (result.status !== "OK") incompleteReasons.push(`${name} probe 失败: ${result.reason}`);
    else if (samples.length < minimum)
      incompleteReasons.push(`${name} raw samples 少于 ${minimum} 个 (${samples.length})`);
  }
  for (const [name, samples] of [
    ["cold", coldSamples],
    ["warm", warmSamples],
    ["edit", editSamples],
    ["save", saveSamples],
    ["png-export", pngExportSamples],
  ]) {
    if (samples.some((value) => !Number.isFinite(value) || value <= 0))
      incompleteReasons.push(`${name} samples 含非有限、零或负数`);
  }
  if (assetExitCode !== 0) incompleteReasons.push(`release asset probe 退出码 ${assetExitCode}`);

  const coldPass =
    Number.isFinite(coldStats.p95) && coldStats.p95 <= BUDGETS.conditionedColdStartP95Ms;
  const warmPass = Number.isFinite(warmStats.p95) && warmStats.p95 <= BUDGETS.warmStartP95Ms;
  const rssPass = Number.isFinite(rssStableMb) && rssStableMb <= BUDGETS.rssStableMb;
  const installerPass = Number.isFinite(installerBytes) && installerBytes <= BUDGETS.installerBytes;
  const canvasPass =
    canvasResult?.measurementSource === "native-candidate" &&
    canvasReportedMatches &&
    Number.isFinite(canvasFrameP95) &&
    canvasFrameP95 <= BUDGETS.canvasFrameP95Ms;
  const editPass = Number.isFinite(editStats.p95) && editStats.p95 <= BUDGETS.editCommandP95Ms;
  const savePass = Number.isFinite(saveStats.p95) && saveStats.p95 <= BUDGETS.saveP95Ms;
  const pngPass = Number.isFinite(pngStats.p95) && pngStats.p95 <= BUDGETS.pngExportP95Ms;
  const complete = incompleteReasons.length === 0;
  const pass =
    complete &&
    coldPass &&
    warmPass &&
    rssPass &&
    installerPass &&
    canvasPass &&
    editPass &&
    savePass &&
    pngPass;

  const samplingFinishedAt = new Date().toISOString();
  const coldDefinition =
    "一次成功 conditioning（记录在 cold-conditioning.json，绑定 source/candidate/runner SHA-256）之后的 candidate 路径启动；每样本在 G2 批准 evidence 边界内创建全新隔离 HOME（WebView 缓存与应用支持目录首次创建），采样后删除；renderer-ready 由 host 校验 runId/windowGeneration 后输出唯一 JSON，sampler 等待进程真实退出";
  const warmDefinition =
    "全部样本共享同一隔离 HOME，先执行一次不计入的预热启动再连续采样；renderer-ready 判定与 cold 相同";
  // PRR-066：RSS 30 秒稳定窗协议（docs/quality/v1-quality-gates.md）；host
  // 在 renderer-ready 后等待至少 30s 才开始采样，事件声明 settleMs 供复核。
  const rssSettleDefinition = `renderer-ready 后等待至少 ${RSS_MIN_SETTLE_MS}ms 稳定窗再采样自身 RSS；全部 rss 事件声明一致且 ≥${RSS_MIN_SETTLE_MS} 的 settleMs，runner 与 verify-evidence 均校验`;

  const rawEvidence = {
    schemaVersion: 3,
    task: "MRT-011",
    scope: "release",
    platform: "macOS",
    arch: process.arch,
    sourceCommit: gitHead,
    runnerSha256: computeFileSha256(RUNNER_PATH),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    candidate,
    candidateSha256,
    generatedAt: samplingFinishedAt,
    startedAt: samplingStartedAt,
    finishedAt: samplingFinishedAt,
    measurementSource: complete ? "native-candidate" : "incomplete-candidate-probe",
    measurementMode: diagnostic ? "diagnostic-preflight" : "release",
    samplingProtocol: {
      coldDefinition,
      warmDefinition,
      rssSettleDefinition,
      conditioningDefinition: samplingProtocolConditioningDefinition,
    },
    // 双指标协议（ADR 0006 1.1.0）：conditioning 启动耗时（记录型）与
    // conditioned cold p95 判定指标；conditioningRun 保留原始 run 供复算。
    conditioningRun,
    conditioning: {
      success: conditioningOk,
      durationMs: conditioningOk ? conditioningRun.elapsedMs : null,
      sessionFirstLaunchMs: conditioningOk ? conditioningRun.elapsedMs : null,
      artifact: relative(ROOT, join(evidenceDirAbs, "cold-conditioning.json")),
    },
    fixture: {
      path: relative(ROOT, FIXTURE_SRC),
      sha256: fixtureSha256,
    },
    coldSamples,
    coldRuns,
    warmSamples,
    warmRuns,
    rssSamples,
    rssResult,
    editSamples,
    saveSamples,
    pngExportSamples,
    pngResourceLoadMs,
    editResult,
    saveResult,
    pngResult,
    canvasResult,
    scenarioRuns: scenarioRunSummaries,
    incompleteReasons,
  };

  const summaryEvidence = {
    schemaVersion: 3,
    task: "MRT-011",
    scope: "release",
    platform: "macOS",
    arch: process.arch,
    sourceCommit: gitHead,
    runnerSha256: computeFileSha256(RUNNER_PATH),
    command: [process.execPath, ...process.argv.slice(1)].join(" "),
    candidate,
    candidateSha256,
    generatedAt: samplingFinishedAt,
    startedAt: samplingStartedAt,
    finishedAt: samplingFinishedAt,
    overall: complete ? (pass ? "PASS" : "FAIL") : "INCOMPLETE",
    measurementMode: diagnostic ? "diagnostic-preflight" : "release",
    budgets: BUDGETS,
    results: {
      // ADR 0006 1.1.0（G-PERF-PROTOCOL 2026-09-09）：判定指标名
      // conditionedColdStartP95Ms；sessionFirstLaunchMs 记录型（v0.1.0 无预算）。
      conditionedColdStartP95Ms: coldStats.p95,
      sessionFirstLaunchMs: conditioningOk ? conditioningRun.elapsedMs : null,
      coldStartMinMs: coldStats.min,
      coldStartMaxMs: coldStats.max,
      warmStartP95Ms: warmStats.p95,
      rssStableMb,
      bundleBytes,
      installerBytes,
      canvasFrameP95Ms: canvasFrameP95,
      editCommandP95Ms: editStats.p95,
      saveP95Ms: saveStats.p95,
      pngExportP95Ms: pngStats.p95,
    },
    incompleteReasons,
  };

  mkdirSync(evidenceDirAbs, { recursive: true });
  const rawEvidencePath = join(evidenceDirAbs, "release-performance-raw.json");
  writeFileSync(rawEvidencePath, JSON.stringify(rawEvidence, null, 2) + "\n");
  summaryEvidence.rawSha256 = computeFileSha256(rawEvidencePath);
  writeFileSync(
    join(evidenceDirAbs, "release-performance-summary.json"),
    JSON.stringify(summaryEvidence, null, 2) + "\n",
  );

  if (outputRel) {
    const outAbs = resolve(ROOT, outputRel);
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, JSON.stringify(summaryEvidence, null, 2) + "\n");
  }

  console.log(
    `run-performance: release summary: conditionedColdStart(p95)=${coldStats.p95}ms (budget<=${BUDGETS.conditionedColdStartP95Ms}ms) ` +
      `sessionFirstLaunch=${conditioningOk ? conditioningRun.elapsedMs : "INCOMPLETE"}ms ` +
      `warmStart(p95)=${warmStats.p95}ms rss=${rssStableMb}MB (budget<=${BUDGETS.rssStableMb}MB) ` +
      `canvasFrame(p95)=${canvasFrameP95}ms (budget<=${BUDGETS.canvasFrameP95Ms}ms) ` +
      `installer=${installerBytes}B (budget<=${BUDGETS.installerBytes}B) ` +
      `bundle=${(bundleBytes / 1024 / 1024).toFixed(2)}MB → ${summaryEvidence.overall}`,
  );

  process.exit(pass ? 0 : 1);
}

// ==================== CANVAS HARNESS CLI ====================

if (scope === "canvas" && fixture === "dense-300-450") {
  const results = await measureCanvas();
  const frameP95 = Math.max(results.pan.p95, results.nodeDrag.p95, results.zoom.p95);
  const pass = frameP95 <= BUDGETS.canvasFrameP95Ms && results.probes.nodeCount >= 300;

  console.log(
    `canvas(dense-300-450): bundle=${(results.bundleBytes / 1024).toFixed(0)}KB ` +
      `pan(p95)=${results.pan.p95}ms nodeDrag(p95)=${results.nodeDrag.p95}ms zoom(p95)=${results.zoom.p95}ms ` +
      `预算(canvasFrameP95Ms)=${BUDGETS.canvasFrameP95Ms}ms → ${pass ? "PASS" : "FAIL"} ` +
      `attribution=${JSON.stringify(results.probes.attribution)} nodes=${results.probes.nodeCount}`,
  );

  if (outputRel) {
    const evidence = {
      task: "MM-050",
      platform: platform === "macos" ? "macOS" : platform,
      scope: "canvas",
      fixture,
      budget: { canvasFrameP95Ms: BUDGETS.canvasFrameP95Ms },
      overall: pass ? "PASS" : "FAIL",
      results,
      platformNotes: [
        "headless Chromium（playwright）与 MM-010 Spike 同口径：pan/nodeDrag/zoom rAF 帧间隔",
        "harness 使用真实 EditorCanvas + 共享 layout + 真字体 FontResolver（比 Spike 裸 React Flow 更重）",
        "Windows 采样缺失：无设备（R-013；v1 macOS 先行，ADR 0001 G1 平台范围决定）",
      ],
    };
    await writeFile(
      resolve(ROOT, outputRel),
      JSON.stringify(
        {
          ...evidence,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`evidence -> ${outputRel}`);
  }
  process.exit(pass ? 0 : 1);
}

console.error(
  `run-performance: FAIL — scope=${scope}/fixture=${fixture} 采样管线未落地（save/export 归 MM-090）。`,
);
process.exit(1);
