// assemble-dmg.mjs — 无 Finder 依赖的确定性 macOS DMG 装配（PRR-069C / ADR 0013 v1.1.0）。
//
// 职责单一：把本轮刚构建的 unsigned `.app` 用 macOS 自带系统工具装配成最终 ULMO DMG。
// 装配链（全部为参数数组调用，不经过 shell）：
//   ditto  → staging（同源 .app + Applications -> /Applications + .VolumeIcon.icns）
//   hdiutil create UDRW（HFS+，-nospotlight）→ attach RW → SetFile -a C（卷图标属性）
//   → 受控清除 .fseventsd → detach → hdiutil convert ULMO
//   → hdiutil udifrez 注入根 LICENSE 生成的挂载前 EULA resource
//   → verify/imageinfo/只读挂载复核 → rename 到批准输出路径
//
// 正式路径不启动 Finder，不调用 AppleScript/osascript，不使用 --ci/--skip-jenkins，
// 不读取、生成、复制或等待 .DS_Store；`.app` 内含 .DS_Store 时直接失败。
// 每个子进程有显式超时，整轮有 deadline；失败只清理由本轮创建且位于本运行目录内的资源。
//
// 用法：node assemble-dmg.mjs --app <repo-rel .app> --output <repo-rel .dmg>
//           --work-dir <repo-rel .tmp/...> --after <UTC ISO> --format ULMO
//           [--scope-from <register>] [--icon <repo-rel .icns>] [--license <repo-rel file>]
//           [--volume-name <name>] [--timeout-ms <n>] [--deadline-ms <n>]
//           [--root <repo>] [--tool-dir <dir>] [--report <repo-rel .json>]
// --root/--tool-dir 是复算与测试注入入口，生产调用不传。

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeArtifactSha256,
  computeFileSha256,
  isSameOrDescendant,
  loadAndValidateG2Scope,
  validateSafePath,
} from "./g2-scope.mjs";
import { RELEASE_BUDGETS } from "./release-budgets.mjs";
import {
  buildLicenseResourceXmlFromFile,
  extractEulaTextFromRezXml,
  imageInfoDeclaresLicenseAgreement,
  sha256,
} from "./eula-resource.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const FORMAT = "ULMO";
const DS_STORE = ".DS_Store";
const VOLUME_ICON = ".VolumeIcon.icns";
const APPLICATIONS_LINK = "Applications";
const APPLICATIONS_TARGET = "/Applications";
// .fseventsd 是系统在可写卷挂载期间创建的日志目录。Apple 文档的 no_log 开关让 fseventsd
// 不在本卷写日志；随后在挂载中删除该目录（与 Tauri bundle_dmg.sh 同意图，但改为确定性等待），
// 保证镜像卷根只包含预期条目。等待是有界固定值，不是重试到成功。
const FSEVENTSD = ".fseventsd";
const FSEVENTSD_SETTLE_MS = 1_000;
const FSEVENTSD_CONFIRM_MS = 400;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_DEADLINE_MS = 180_000;

const TOOLS = Object.freeze({
  hdiutil: "/usr/bin/hdiutil",
  ditto: "/usr/bin/ditto",
  SetFile: "/usr/bin/SetFile",
  mount: "/sbin/mount",
  plutil: "/usr/bin/plutil",
  lipo: "/usr/bin/lipo",
  xattr: "/usr/bin/xattr",
});

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}

const ROOT = flag("root") ? resolve(flag("root")) : resolve(HERE, "../..");
const appRelFlag = flag("app");
const outputRelFlag = flag("output");
const workDirFlag = flag("work-dir");
const afterFlag = flag("after");
const format = flag("format");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const iconRelFlag = flag("icon") ?? "apps/desktop/src-tauri/icons/icon.icns";
const licenseRelFlag = flag("license") ?? "LICENSE";
const volumeNameFlag = flag("volume-name");
const timeoutMs = Number(flag("timeout-ms") ?? DEFAULT_TIMEOUT_MS);
const deadlineMs = Number(flag("deadline-ms") ?? DEFAULT_DEADLINE_MS);
const reportOutput = flag("report");
const toolDirFlag = flag("tool-dir");

const commandLog = [];
const assemblyStartedMs = Date.now();
let activeRunDir = null;
let runDirRel = null;
let mountedDevice = null;
let mountedAt = null;
let cleaningUp = false;
let currentStage = "args";

/**
 * fail-closed：解除本轮挂载（仅在设备匹配时）、保留本轮运行目录供复算，
 * 并输出单行结构化失败记录（含命令日志与超时标记）。
 */
function fail(message) {
  console.error(`assemble-dmg: FAIL — ${message}`);
  if (!cleaningUp) {
    cleaningUp = true;
    cleanupOnFailure();
  }
  const record = {
    status: "failed",
    runner: "assemble-dmg.mjs",
    runnerSha256: safeRunnerSha(),
    stage: currentStage,
    error: message,
    startedAt: new Date(assemblyStartedMs).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - assemblyStartedMs,
    gitHead: safeGitHead(),
    workDir: runDirRel,
    preservedWorkDir: activeRunDir ? true : false,
    commands: commandLog,
  };
  console.error(`assemble-dmg: FAILURE ${JSON.stringify(record)}`);
  process.exit(1);
}

function safeRunnerSha() {
  try {
    return computeFileSha256(RUNNER_PATH);
  } catch {
    return null;
  }
}

function safeGitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** 失败清理：只处理本运行目录内的资源；无法安全解除挂载时保留现场并 STOP。 */
function cleanupOnFailure() {
  try {
    if (mountedDevice && mountedAt) {
      const table = mountTable();
      const entry = table.find((line) => line.includes(` on ${mountedAt} (`));
      if (!entry) {
        mountedDevice = null;
        mountedAt = null;
      } else if (!entry.startsWith(mountedDevice)) {
        console.error(
          `assemble-dmg: STOP — 挂载设备与预期不一致（预期 ${mountedDevice}，实际 ${entry}），保留现场等待人工检查`,
        );
        return;
      } else {
        spawnSync(resolveTool("hdiutil"), ["detach", mountedAt], {
          encoding: "utf8",
          timeout: 60_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        mountedDevice = null;
        mountedAt = null;
      }
    }
  } catch {
    console.error("assemble-dmg: STOP — 失败清理期间无法确认挂载状态，保留现场等待人工检查");
    return;
  }
  // 失败时保留本轮运行目录（staging/临时镜像/命令日志现场），供独立复算；
  // 该目录只位于本卡授权的任务临时范围内，不会成为下一次装配的输入。
  if (activeRunDir) {
    console.error(`assemble-dmg: 失败现场保留在 ${relative(ROOT, activeRunDir)}（仅本轮创建）`);
  }
}

function mountTable() {
  const r = spawnSync(resolveTool("mount"), [], {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return (r.stdout ?? "").split("\n").filter((l) => l.trim().length > 0);
}

function resolveTool(name) {
  if (toolDirFlag) {
    const candidate = resolve(ROOT, toolDirFlag, name);
    if (existsSync(candidate)) return candidate;
  }
  return TOOLS[name];
}

/**
 * 单次受控子进程调用：参数数组、显式超时、按剩余 deadline 收紧、记录起止与结果。
 * 超时与非零退出由调用点决定语义（must=false 时只回报）。
 */
function runTool(name, cmdArgs, opts = {}) {
  const { must = true, input, note } = opts;
  const tool = resolveTool(name);
  const remaining = deadlineMs - (Date.now() - assemblyStartedMs);
  if (remaining <= 0) fail(`超出装配 deadline（${deadlineMs}ms）`);
  const perCommandTimeout = Math.min(timeoutMs, remaining);
  const startedAt = new Date().toISOString();
  const r = spawnSync(tool, cmdArgs, {
    encoding: "utf8",
    timeout: perCommandTimeout,
    killSignal: "SIGKILL",
    input,
    maxBuffer: 1 << 28,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const finishedAt = new Date().toISOString();
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  commandLog.push({
    tool: name,
    path: tool,
    args: cmdArgs,
    ...(note ? { note } : {}),
    startedAt,
    finishedAt,
    timeoutMs: perCommandTimeout,
    status: r.status ?? null,
    signal: r.signal ?? null,
    timedOut: Boolean(timedOut),
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (timedOut && must) {
    fail(`子进程超时（${name} ${cmdArgs.slice(0, 2).join(" ")}，${perCommandTimeout}ms）`);
  }
  if ((r.status ?? 1) !== 0 && must) {
    fail(
      `${name} ${cmdArgs.slice(0, 2).join(" ")} 退出码非零 (${r.status})：${out.trim().slice(0, 400)}`,
    );
  }
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut, out };
}

// ---------------------------------------------------------------- 1. 参数契约
if (!appRelFlag) fail("缺少 --app <repo-relative .app>");
if (!outputRelFlag) fail("缺少 --output <repo-relative .dmg>");
if (!workDirFlag) fail("缺少 --work-dir <repo-relative .tmp/... 工作目录>");
if (!afterFlag) fail("缺少 --after <UTC ISO>（本轮构建开始时间）");
if (!format) fail("缺少 --format（正式装配必须显式声明目标容器格式）");
if (format !== FORMAT) fail(`不允许的 DMG 目标格式: ${format}（受支持: ${FORMAT}）`);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(afterFlag)) {
  fail(`--after 必须是 UTC ISO（以 Z 结尾），不得把本地时间冒充 UTC: ${afterFlag}`);
}
const afterMs = Date.parse(afterFlag);
if (!Number.isFinite(afterMs)) fail(`--after 不是可解析的 UTC ISO 时间: ${afterFlag}`);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("--timeout-ms 必须是正整数");
if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) fail("--deadline-ms 必须是正整数");
if (deadlineMs < timeoutMs) fail("--deadline-ms 不得小于单命令 --timeout-ms");

// ---------------------------------------------------------------- 2. 路径与 G2 授权
let appRel;
let outputRel;
let workDirRel;
let iconRel;
let licenseRel;
try {
  appRel = validateSafePath(appRelFlag, ROOT, "app");
  outputRel = validateSafePath(outputRelFlag, ROOT, "output");
  workDirRel = validateSafePath(workDirFlag, ROOT, "work-dir");
  iconRel = validateSafePath(iconRelFlag, ROOT, "icon");
  licenseRel = validateSafePath(licenseRelFlag, ROOT, "license");
} catch (err) {
  fail(err.message);
}
if (!appRel.endsWith(".app")) fail(`--app 必须是 .app 目录: ${appRel}`);
if (!outputRel.endsWith(".dmg")) fail(`--output 必须是 .dmg 文件: ${outputRel}`);
if (!workDirRel.startsWith(`.tmp${sep}`)) {
  fail(
    `work-dir 必须位于仓库内被忽略的 .tmp/ 下（临时 staging/镜像只允许进入任务临时范围）: ${workDirRel}`,
  );
}
if (isSameOrDescendant(dirname(outputRel), workDirRel)) {
  fail(`work-dir 不得位于候选产物目录内: ${workDirRel}`);
}

const appAbs = resolve(ROOT, appRel);
const outputAbs = resolve(ROOT, outputRel);
const iconAbs = resolve(ROOT, iconRel);
const licenseAbs = resolve(ROOT, licenseRel);

let validated;
try {
  validated = loadAndValidateG2Scope({
    scopeFrom,
    host: "tauri",
    action: "build",
    candidate: outputRel,
    repoRoot: ROOT,
  });
} catch (err) {
  fail(`G2 scope 校验未通过: ${err.message}`);
}
const approvedCandidates = validated.normalized.candidateOutputPaths;
if (!approvedCandidates.includes(outputRel)) {
  fail(`输出 .dmg 不在 G2 批准的 candidateOutputPaths 内: ${outputRel}`);
}
if (!approvedCandidates.includes(appRel)) {
  fail(`输入 .app 不在 G2 批准的 candidateOutputPaths 内: ${appRel}`);
}

let reportRel = null;
let reportAbs = null;
if (reportOutput) {
  try {
    reportRel = validateSafePath(reportOutput, ROOT, "report");
  } catch (err) {
    fail(err.message);
  }
  reportAbs = resolve(ROOT, reportRel);
  const approved = validated.normalized.evidenceOutputPaths.some((evidencePath) =>
    isSameOrDescendant(resolve(ROOT, evidencePath), reportAbs),
  );
  if (!approved) fail(`report 路径不在 G2 批准的 evidenceOutputPaths 内: ${reportRel}`);
  // 证据不可覆盖：同一路径已有报告时拒绝重写，避免失败轮被后一轮覆盖。
  if (existsSync(reportAbs)) {
    fail(`report 已存在，拒绝覆盖既有证据: ${reportRel}`);
  }
}

// ---------------------------------------------------------------- 3. 输入判定
if (!existsSync(appAbs)) fail(`输入 .app 不存在: ${appRel}`);
if (lstatSync(appAbs).isSymbolicLink()) fail(`输入 .app 不能是符号链接: ${appRel}`);
if (!lstatSync(appAbs).isDirectory()) fail(`输入 .app 不是目录: ${appRel}`);
if (!existsSync(iconAbs) || !lstatSync(iconAbs).isFile()) fail(`卷图标不是常规文件: ${iconRel}`);
if (!existsSync(licenseAbs) || !lstatSync(licenseAbs).isFile()) {
  fail(`LICENSE 不是常规文件: ${licenseRel}`);
}
// “本轮刷新”按 .app 树内最新 mtime 判定（与 bundle-gate 的候选新鲜度口径一致）：
// 目录自身 mtime 只在增删条目时变化，不能代表本轮重写了 bundle 内容。
if (latestMtimeMs(appAbs) < afterMs) {
  fail(`.app 不是本轮构建刷新（最新 mtime 早于 --after），拒绝装配陈旧产物: ${appRel}`);
}
for (const rel of walkRelative(appAbs)) {
  if (basename(rel) === DS_STORE) {
    fail(`输入 .app 内含 ${DS_STORE}，拒绝读取/复制：${rel}`);
  }
}

const volumeName = volumeNameFlag ?? basename(appRel).replace(/\.app$/, "");
if (!volumeName || /[ -/]/.test(volumeName)) fail(`非法的卷名: ${volumeName}`);

// ---------------------------------------------------------------- 4. 运行目录
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
runDirRel = `${workDirRel}/assemble-${runStamp}-${process.pid}`;
const runDirAbs = resolve(ROOT, runDirRel);
if (existsSync(runDirAbs)) fail(`本轮运行目录已存在（拒绝复用/覆盖）: ${runDirRel}`);
mkdirSync(runDirAbs, { recursive: true });
activeRunDir = runDirAbs;
const stagingAbs = join(runDirAbs, "staging");
const mntRwAbs = join(runDirAbs, "mnt-rw");
const mntFinalAbs = join(runDirAbs, "mnt-final");
const rwImageAbs = join(runDirAbs, "rw.dmg");
const tempDmgAbs = join(runDirAbs, `${basename(outputRel).replace(/\.dmg$/, "")}.assembly.tmp.dmg`);
const eulaXmlAbs = join(runDirAbs, "eula-resources.xml");
for (const dir of [stagingAbs, mntRwAbs, mntFinalAbs]) mkdirSync(dir, { recursive: true });

const gitBefore = readGitState();
if (gitBefore.status.length > 0) fail("装配开始前 worktree 非 clean，拒绝修改候选产物");

const sourceAppSha = computeArtifactSha256(appAbs);
const sourceAppBytes = dirBytes(appAbs);
const iconSha = computeFileSha256(iconAbs);
const licenseBytes = readFileSync(licenseAbs);
const licenseSha = sha256(licenseBytes);

// ---------------------------------------------------------------- 5. staging
currentStage = "staging";
console.log(
  `assemble-dmg: 装配 ${appRel} → ${outputRel}（volname=${volumeName}，format=${FORMAT}）`,
);
const appName = basename(appRel);
runTool("ditto", [appAbs, join(stagingAbs, appName)]);
const stagedAppSha = computeArtifactSha256(join(stagingAbs, appName));
if (stagedAppSha !== sourceAppSha) {
  fail("staging 后的 .app 目录级 hash 与 app-only build 不一致，拒绝继续");
}
copyFileSync(iconAbs, join(stagingAbs, VOLUME_ICON));
if (computeFileSha256(join(stagingAbs, VOLUME_ICON)) !== iconSha) {
  fail(`staging 后的 ${VOLUME_ICON} 与仓库固定 ICNS 不一致`);
}
symlinkSync(APPLICATIONS_TARGET, join(stagingAbs, APPLICATIONS_LINK));
if (!lstatSync(join(stagingAbs, APPLICATIONS_LINK)).isSymbolicLink()) {
  fail(`${APPLICATIONS_LINK} 未建立为符号链接`);
}
// Apple 文档的 no_log 开关：fseventsd 不在本卷写日志，卷根的 .fseventsd 只含该标记，
// 使挂载中的确定性删除不留残余。
mkdirSync(join(stagingAbs, FSEVENTSD), { recursive: true });
writeFileSync(join(stagingAbs, FSEVENTSD, "no_log"), "");
for (const rel of walkRelative(stagingAbs)) {
  if (basename(rel) === DS_STORE) fail(`staging 出现 ${DS_STORE}，拒绝继续：${rel}`);
}

// ---------------------------------------------------------------- 6. UDRW + 卷图标
currentStage = "create-udrw";
runTool("hdiutil", [
  "create",
  "-srcfolder",
  stagingAbs,
  "-volname",
  volumeName,
  "-fs",
  "Journaled HFS+",
  "-format",
  "UDRW",
  "-nospotlight",
  "-ov",
  rwImageAbs,
]);

currentStage = "attach-rw";
const rwAttach = runTool("hdiutil", [
  "attach",
  "-nobrowse",
  "-noautoopen",
  "-mountpoint",
  mntRwAbs,
  rwImageAbs,
]);
const rwMount = parseAttachOutput(rwAttach.stdout, mntRwAbs);
if (!rwMount) fail("无法从 hdiutil attach 输出确认可写卷设备与挂载点");
if (rwMount.mountpoint !== mntRwAbs) fail(`可写卷挂载点与预期不一致: ${rwMount.mountpoint}`);
mountedDevice = rwMount.device;
mountedAt = rwMount.mountpoint;

currentStage = "volume-icon";
runTool("SetFile", ["-a", "C", rwMount.mountpoint]);
if (!finderInfoHasCustomIcon(readFinderInfoHex(rwMount.mountpoint))) {
  fail("可写卷卷图标属性未设置（FinderInfo kHasCustomIcon 缺失）");
}

currentStage = "fseventsd-cleanup";
runSettle(FSEVENTSD_SETTLE_MS);
const fsEventsPath = join(rwMount.mountpoint, FSEVENTSD);
if (existsSync(fsEventsPath)) {
  const st = lstatSync(fsEventsPath);
  if (!st.isDirectory() || st.isSymbolicLink()) {
    fail(`${FSEVENTSD} 不是常规目录，拒绝删除: ${fsEventsPath}`);
  }
  rmSync(fsEventsPath, { recursive: true, force: true });
}
runSettle(FSEVENTSD_CONFIRM_MS);
if (existsSync(fsEventsPath)) {
  fail(`${FSEVENTSD} 在受控删除后重新出现，拒绝把系统日志目录带进镜像`);
}

currentStage = "detach-rw";
runTool("hdiutil", ["detach", rwMount.mountpoint]);
mountedDevice = null;
mountedAt = null;
assertNoResidualMount(rwMount.mountpoint);

// ---------------------------------------------------------------- 7. ULMO + EULA
currentStage = "convert-ulmo";
runTool("hdiutil", ["convert", rwImageAbs, "-format", FORMAT, "-o", tempDmgAbs]);
const eula = buildLicenseResourceXmlFromFile(licenseAbs);
writeFileSync(eulaXmlAbs, eula.xml);
// udifrez 需要 "选项、空资源占位参数、镜像" 的顺序（与 bundle_dmg.sh 的实际调用一致）。
currentStage = "eula-inject";
runTool("hdiutil", ["udifrez", "-xml", eulaXmlAbs, "", "-quiet", tempDmgAbs]);

// ---------------------------------------------------------------- 8. 只读复核
currentStage = "inspect";
assertImageInfo(runTool("hdiutil", ["imageinfo", tempDmgAbs]).stdout);
assertCrc32Valid(runTool("hdiutil", ["verify", tempDmgAbs]).stdout);

const tempDmgBytes = statSync(tempDmgAbs).size;
if (tempDmgBytes > RELEASE_BUDGETS.installerBytes) {
  fail(`DMG 字节数 ${tempDmgBytes} 超过 installer 预算 ${RELEASE_BUDGETS.installerBytes}`);
}

// 挂载前 EULA：未同意时 attach 必须打印许可证正文并拒绝挂载（该镜像因此不可静默挂载）。
currentStage = "pre-mount-eula";
const refusal = runTool(
  "hdiutil",
  [
    "attach",
    "-readonly",
    "-nobrowse",
    "-noverify",
    "-noautoopen",
    "-mountpoint",
    mntFinalAbs,
    tempDmgAbs,
  ],
  { must: false, input: "", note: "pre-mount-eula-refusal" },
);
if (refusal.status === 0) {
  fail("未同意 EULA 时 hdiutil attach 仍然成功挂载，挂载前 EULA 未生效");
}
if (readdirSync(mntFinalAbs).length !== 0) {
  fail("EULA 拒绝路径留下了挂载内容，现场不干净");
}
const licenseMarker = firstAsciiMarker(licenseBytes);
if (!refusal.out.includes(licenseMarker)) {
  fail(`挂载前 EULA 展示内容与根 LICENSE 不匹配（未找到标记: ${licenseMarker}）`);
}

currentStage = "verify-mount";
const finalAttach = runTool(
  "hdiutil",
  [
    "attach",
    "-readonly",
    "-nobrowse",
    "-noverify",
    "-noautoopen",
    "-mountpoint",
    mntFinalAbs,
    tempDmgAbs,
  ],
  { input: "Y\n" },
);
const finalMount = parseAttachOutput(finalAttach.stdout, mntFinalAbs);
if (!finalMount) fail("无法从 hdiutil attach 输出确认只读卷设备与挂载点");
if (finalMount.mountpoint !== mntFinalAbs)
  fail(`只读卷挂载点与预期不一致: ${finalMount.mountpoint}`);
mountedDevice = finalMount.device;
mountedAt = finalMount.mountpoint;

currentStage = "payload-verify";
const payload = verifyMountedPayload(finalMount.mountpoint, { appName, sourceAppSha });

runTool("hdiutil", ["detach", finalMount.mountpoint]);
mountedDevice = null;
mountedAt = null;
assertNoResidualMount(finalMount.mountpoint);

// EULA 内容绑定：从最终镜像提取 TEXT 资源与根 LICENSE 逐字节比对。
currentStage = "eula-binding";
const rezXml = runTool("hdiutil", ["udifderez", "-xml", tempDmgAbs], { must: false });
if (rezXml.status !== 0) {
  fail(`hdiutil udifderez 失败，无法复算 EULA 内容：${rezXml.out.trim().slice(0, 200)}`);
}
const eulaBytes = extractEulaTextFromRezXml(rezXml.stdout);
const eulaSha = sha256(eulaBytes);
if (eulaSha !== licenseSha) {
  fail(`EULA 内容 hash ${eulaSha} 与根 LICENSE ${licenseSha} 不一致`);
}

// ---------------------------------------------------------------- 9. 发布 + 复核
currentStage = "publish";
const gitBeforePublish = readGitState();
if (gitBeforePublish.head !== gitBefore.head || gitBeforePublish.status.length > 0) {
  fail("装配期间 source commit/worktree 发生变化，候选不可归因");
}
mkdirSync(dirname(outputAbs), { recursive: true });
try {
  renameSync(tempDmgAbs, outputAbs);
} catch (err) {
  fail(`最终 DMG 无法落到批准路径（拒绝跨设备复制回退）: ${err.message}`);
}
assertImageInfo(runTool("hdiutil", ["imageinfo", outputAbs]).stdout, { stage: "published" });

const finalSha = computeFileSha256(outputAbs);
const finalBytes = statSync(outputAbs).size;
const gitAfter = readGitState();
if (gitAfter.head !== gitBefore.head || gitAfter.status.length > 0) {
  fail("发布期间 source commit/worktree 发生变化，候选不可归因");
}

const finishedMs = Date.now();
const elapsedMs = finishedMs - assemblyStartedMs;
if (elapsedMs > deadlineMs) fail(`装配阶段耗时 ${elapsedMs}ms 超过 deadline ${deadlineMs}ms`);

currentStage = "report";
const report = {
  runner: "assemble-dmg.mjs",
  runnerSha256: computeFileSha256(RUNNER_PATH),
  schemaVersion: 1,
  gitHead: gitAfter.head,
  sourceWorktree: "clean",
  startedAt: new Date(assemblyStartedMs).toISOString(),
  finishedAt: new Date(finishedMs).toISOString(),
  elapsedMs,
  timeoutMs,
  deadlineMs,
  workDir: runDirRel,
  volumeName,
  dmgFormat: FORMAT,
  inputs: {
    app: { path: appRel, sha256: sourceAppSha, bytes: sourceAppBytes },
    icon: { path: iconRel, sha256: iconSha },
    license: { path: licenseRel, sha256: licenseSha, bytes: licenseBytes.length },
  },
  output: { path: outputRel, sha256: finalSha, bytes: finalBytes },
  eula: {
    licenseSha256: licenseSha,
    resourceSha256: eulaSha,
    resourceType: "TEXT",
    resourceId: "5000",
    displayMarker: licenseMarker,
    preMountDisplayVerified: true,
    imageInfoDeclaresAgreement: true,
  },
  payload,
  checks: {
    format: FORMAT,
    crc32: "VALID",
    installerBudgetBytes: RELEASE_BUDGETS.installerBytes,
    applicationsTarget: APPLICATIONS_TARGET,
    volumeIconSha256: iconSha,
    payloadAppSha256: payload.appSha256,
    mountedEntries: payload.entries,
  },
  commands: commandLog,
};

if (reportAbs) {
  mkdirSync(dirname(reportAbs), { recursive: true });
  writeFileSync(reportAbs, `${JSON.stringify(report, null, 2)}\n`);
}

// 成功路径：清掉本轮 staging/临时镜像，只保留报告与最终 DMG。
rmSync(runDirAbs, { recursive: true, force: true });
activeRunDir = null;

console.log(JSON.stringify(report));

// ------------------------------------------------------------------ helpers
function parseAttachOutput(stdout, expectedMountpoint) {
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line.includes(expectedMountpoint)) continue;
    const device = line.split(/\s+/)[0];
    if (!/^\/dev\/disk\d*(s\d+)?$/.test(device)) continue;
    const mountpoint = line.slice(line.indexOf(expectedMountpoint));
    if (mountpoint !== expectedMountpoint) continue;
    return { device, mountpoint };
  }
  return null;
}

function assertNoResidualMount(mountpoint) {
  if (mountTable().some((line) => line.includes(` on ${mountpoint} (`))) {
    fail(`检测到残留挂载: ${mountpoint}`);
  }
}

function assertImageInfo(imageInfoStdout, { stage = "assembled" } = {}) {
  const match = imageInfoStdout.match(/^\s*Format:\s*(\S+)/m);
  if (!match) fail("imageinfo 未输出 Format 字段，无法证明容器格式");
  if (match[1] !== FORMAT) {
    fail(
      `imageinfo 声明 Format=${match[1]}，与目标 ${FORMAT} 不符（伪造或静默回退，stage=${stage}）`,
    );
  }
  if (
    /^\s*Signed For:/m.test(imageInfoStdout) ||
    /^\s*Encrypt(ed|ion):\s*(yes|true|AES.*)$/im.test(imageInfoStdout)
  ) {
    fail("镜像处于签名或加密状态，发布候选不得如此");
  }
  if (!imageInfoDeclaresLicenseAgreement(imageInfoStdout)) {
    fail(`imageinfo 未声明挂载前 EULA（Software License Agreement: false，stage=${stage}）`);
  }
}

function assertCrc32Valid(verifyStdout) {
  const ok =
    /已验证\s*CRC32/i.test(verifyStdout) ||
    /verified\s*CRC32/i.test(verifyStdout) ||
    /^CRC32\s*\$?[0-9A-Fa-f]+\s*:\s*(valid|已验证)/im.test(verifyStdout);
  if (!ok) fail("hdiutil verify 未报告 CRC32 校验通过，镜像完整性未证明");
}

function verifyMountedPayload(mountpoint, { appName: name, sourceAppSha: expectedSha }) {
  const entries = readdirSync(mountpoint).sort();
  const expected = [name, APPLICATIONS_LINK, VOLUME_ICON].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    fail(`卷根条目与预期不符（得到 ${entries.join(", ")}；预期 ${expected.join(", ")}）`);
  }
  const linkPath = join(mountpoint, APPLICATIONS_LINK);
  if (!lstatSync(linkPath).isSymbolicLink()) fail(`${APPLICATIONS_LINK} 不是符号链接`);
  const linkTarget = readlinkSync(linkPath);
  if (linkTarget !== APPLICATIONS_TARGET) {
    fail(`${APPLICATIONS_LINK} 链接目标不是 ${APPLICATIONS_TARGET}（得到 ${linkTarget}）`);
  }
  const mountedIconSha = computeFileSha256(join(mountpoint, VOLUME_ICON));
  if (mountedIconSha !== iconSha) {
    fail(`卷图标 hash 与仓库固定 ICNS 不一致（${mountedIconSha} != ${iconSha}）`);
  }
  if (!finderInfoHasCustomIcon(readFinderInfoHex(mountpoint))) {
    fail("最终卷图标属性未设置（FinderInfo kHasCustomIcon 缺失）");
  }
  const mountedAppPath = join(mountpoint, name);
  const appSha = computeArtifactSha256(mountedAppPath);
  if (appSha !== expectedSha) {
    fail(`DMG 内 .app 目录级 hash 与 app-only build 不一致（${appSha} != ${expectedSha}）`);
  }
  const sourceIdentity = readAppIdentity(appAbs);
  const mountedIdentity = readAppIdentity(mountedAppPath);
  const mismatched = Object.keys(sourceIdentity).filter(
    (k) => sourceIdentity[k] !== mountedIdentity[k],
  );
  if (mismatched.length > 0) {
    fail(`DMG 内 .app 身份字段与 app-only build 不一致: ${mismatched.join(", ")}`);
  }
  return { appSha256: appSha, entries, identity: mountedIdentity };
}

function readAppIdentity(appPath) {
  const plistPath = join(appPath, "Contents", "Info.plist");
  const json = runTool("plutil", ["-convert", "json", "-o", "-", plistPath]).stdout;
  let plist;
  try {
    plist = JSON.parse(json);
  } catch {
    fail(`Info.plist 无法解析为 JSON: ${relative(ROOT, plistPath)}`);
  }
  const executable = plist.CFBundleExecutable;
  if (typeof executable !== "string" || executable.length === 0)
    fail("Info.plist 缺少 CFBundleExecutable");
  const archs = runTool("lipo", [
    "-archs",
    join(appPath, "Contents", "MacOS", executable),
  ]).stdout.trim();
  return {
    bundleId: String(plist.CFBundleIdentifier ?? ""),
    shortVersion: String(plist.CFBundleShortVersionString ?? ""),
    bundleVersion: String(plist.CFBundleVersion ?? ""),
    minimumSystemVersion: String(plist.LSMinimumSystemVersion ?? ""),
    archs,
  };
}

function readFinderInfoHex(path) {
  const r = runTool("xattr", ["-px", "com.apple.FinderInfo", path], { must: false });
  return r.status === 0 ? r.stdout : "";
}

/** FinderInfo 偏移 8-9 是 fdFlags；kHasCustomIcon = 0x0400。 */
function finderInfoHasCustomIcon(hexText) {
  const bytes = hexText.trim().split(/\s+/).filter(Boolean);
  if (bytes.length < 10) return false;
  const flags = parseInt(`${bytes[8]}${bytes[9]}`, 16);
  return Number.isFinite(flags) && (flags & 0x0400) !== 0;
}

function firstAsciiMarker(bytes) {
  for (const line of bytes.toString("utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length >= 20 && /^[\x20-\x7e]+$/.test(trimmed)) return trimmed;
  }
  fail("根 LICENSE 中没有可用于比对挂载前展示的纯 ASCII 行");
}

function readGitState() {
  try {
    return {
      head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      status: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim(),
    };
  } catch (error) {
    fail(`无法读取 Git source 状态: ${error.message}`);
  }
}

function walkRelative(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}${sep}${entry.name}` : entry.name;
    out.push(rel);
    if (entry.isDirectory()) out.push(...walkRelative(join(dir, entry.name), rel));
  }
  return out;
}

function latestMtimeMs(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let latest = st.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    latest = Math.max(latest, latestMtimeMs(join(path, entry.name)));
  }
  return latest;
}

function dirBytes(path) {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += dirBytes(join(path, entry.name));
  }
  return total;
}

/** 有界固定等待：仅用于 fseventsd 的确定性清理，不作为“重试到成功”的手段。 */
function runSettle(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
