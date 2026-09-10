// repack-dmg.mjs — 发布 DMG 容器压缩转换（PRR-069 / ADR 0013）。
// 在 same-run bundle 流程内把本轮唯一 unsigned DMG 转换为受支持的目标格式（ULMO），
// 验证格式/CRC32/非签名加密后原子替换最终路径。任一步失败 fail-closed，
// 不回退原格式、不产出可被当作成功的痕迹。
// 用法：node repack-dmg.mjs --input <repo-relative.dmg> --format ULMO
//           [--scope-from <register>] [--after <ISO>] [--root <repo>]
//           [--hdiutil <path>] [--report <path>]
// --root/--hdiutil 是测试注入入口，生产调用不传（默认本仓库根与系统 hdiutil）。

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAndValidateG2Scope,
  computeFileSha256,
  validateSafePath,
  isSameOrDescendant,
} from "./g2-scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
}

const ROOT = flag("root") ? resolve(flag("root")) : resolve(HERE, "../..");
const inputRelFlag = flag("input");
const format = flag("format");
const scopeFrom = flag("scope-from") ?? "docs/decisions/decision-register.json";
const afterFlag = flag("after");
const hdiutilPath = flag("hdiutil") ?? "hdiutil";
const reportOutput = flag("report");

function fail(message) {
  console.error(`repack-dmg: FAIL — ${message}`);
  process.exit(1);
}

// 1. 参数契约：格式必须显式声明，且只允许受支持的目标格式。
const SUPPORTED_FORMATS = Object.freeze(["ULMO"]);
if (!inputRelFlag) fail("缺少 --input <repo-relative.dmg>");
if (!format) fail("缺少 --format（正式发布命令必须显式声明目标格式，不得依赖隐式默认值）");
if (!SUPPORTED_FORMATS.includes(format)) {
  fail(`不允许的 DMG 目标格式: ${format}（受支持: ${SUPPORTED_FORMATS.join(", ")}）`);
}

// 2. 输入路径：仓库相对、不可逃逸、必须是存在的常规文件。
let inputRel;
try {
  inputRel = validateSafePath(inputRelFlag, ROOT, "input");
} catch (err) {
  fail(err.message);
}
if (!inputRel.endsWith(".dmg")) fail(`输入必须是 .dmg 文件: ${inputRel}`);
const inputAbs = resolve(ROOT, inputRel);
if (!existsSync(inputAbs) || !lstatSync(inputAbs).isFile()) {
  fail(`输入不存在或不是常规文件: ${inputRel}`);
}

// 3. G2 scope：输入必须正好是本轮批准的唯一 DMG 候选（精确路径，不做 glob 猜测）。
let validated;
try {
  validated = loadAndValidateG2Scope({
    scopeFrom,
    host: "tauri",
    action: "build",
    candidate: inputRel,
    repoRoot: ROOT,
  });
} catch (err) {
  fail(`G2 scope 校验未通过: ${err.message}`);
}
const approvedDmgs = validated.normalized.candidateOutputPaths.filter((p) => p.endsWith(".dmg"));
if (approvedDmgs.length !== 1) {
  fail(`G2 批准的 DMG 候选不是恰好一个（得到 ${approvedDmgs.length} 个），拒绝猜测目标`);
}
if (approvedDmgs[0] !== inputRel) {
  fail(`输入不在 G2 批准的 DMG candidateOutputPaths 内: ${inputRel}`);
}

// 报告目标同样必须在任何产物变更前完成授权校验。否则一个无效 --report
// 可能在最后一步才失败，而此时最终 DMG 已经被替换。
let reportRel = null;
let reportAbs = null;
if (reportOutput) {
  try {
    reportRel = validateSafePath(reportOutput, ROOT, "report");
  } catch (err) {
    fail(err.message);
  }
  reportAbs = resolve(ROOT, reportRel);
  const reportApproved = validated.normalized.evidenceOutputPaths.some((evidencePath) =>
    isSameOrDescendant(resolve(ROOT, evidencePath), reportAbs),
  );
  if (!reportApproved) {
    fail(`report 路径不在 G2 批准的 evidenceOutputPaths 内: ${reportRel}`);
  }
}

// 4. same-run 刷新校验：bundle gate 传入构建开始时间，输入 mtime 必须晚于它，
//    防止把旧轮 DMG 当作本轮产物转换。
if (afterFlag) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(afterFlag)) {
    fail(`--after 必须是 UTC ISO（以 Z 结尾），不得把本地时间冒充 UTC: ${afterFlag}`);
  }
  const afterMs = Date.parse(afterFlag);
  if (!Number.isFinite(afterMs)) fail(`--after 不是可解析的 UTC ISO 时间: ${afterFlag}`);
  if (statSync(inputAbs).mtimeMs < afterMs) {
    fail(`输入 DMG 不是本轮构建刷新（mtime 早于 bundle 开始时间），拒绝转换陈旧产物`);
  }
}

// 5. 临时目标：确定性命名于同一批准候选目录内；预存即 fail-closed。
const tmpAbs = inputAbs.replace(/\.dmg$/, `.repack-${format}.tmp.dmg`);
if (existsSync(tmpAbs)) {
  fail(`临时目标已存在（上一轮失败残留或外来文件），请人工检查后处理: ${relative(ROOT, tmpAbs)}`);
}

// 6. 记录转换前状态并执行 hdiutil convert。
const beforeSha256 = computeFileSha256(inputAbs);
const beforeBytes = statSync(inputAbs).size;
const startedAt = new Date().toISOString();
const gitBefore = readGitState();
if (gitBefore.status.length > 0) {
  fail("转换开始前 worktree 非 clean，拒绝修改候选产物");
}

function runHdiUtil(cmdArgs) {
  try {
    const stdout = execFileSync(hdiutilPath, cmdArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

// convert 之后的失败统一走 failAfterTmp：清理本轮创建的临时文件再退出，
// 使"临时目标预存"始终指向外来文件或更早轮次残留，而非本轮失败现场
// （原始输入 DMG 在任何失败路径都保持原样，证据不受影响）。
function failAfterTmp(message) {
  if (existsSync(tmpAbs)) {
    try {
      rmSync(tmpAbs, { force: true });
    } catch {
      console.error(`repack-dmg: WARN — 临时文件清理失败，需人工检查: ${relative(ROOT, tmpAbs)}`);
    }
  }
  fail(message);
}

const convert = runHdiUtil(["convert", inputAbs, "-format", format, "-o", tmpAbs]);
if (convert.status !== 0) {
  failAfterTmp(
    `hdiutil convert 失败 (exit ${convert.status}): ${convert.stderr || convert.stdout}`,
  );
}
if (!existsSync(tmpAbs)) failAfterTmp("hdiutil convert 报告成功但临时目标不存在");

// 7. 格式复核：imageinfo 必须精确声明目标格式（防止伪造/静默回退）。
const imageInfo = runHdiUtil(["imageinfo", tmpAbs]);
if (imageInfo.status !== 0) {
  failAfterTmp(
    `hdiutil imageinfo 失败 (exit ${imageInfo.status}): ${imageInfo.stderr || imageInfo.stdout}`,
  );
}
const formatMatch = imageInfo.stdout.match(/^Format:\s*(\S+)/m);
if (!formatMatch) failAfterTmp("imageinfo 未输出 Format 字段，无法证明目标格式");
if (formatMatch[1] !== format) {
  failAfterTmp(
    `imageinfo 声明 Format=${formatMatch[1]}，与目标格式 ${format} 不符（伪造或静默回退）`,
  );
}
if (
  /^Signed For:/m.test(imageInfo.stdout) ||
  /^Encrypt(ed|ion):\s*(yes|true|AES.*)$/im.test(imageInfo.stdout)
) {
  failAfterTmp("转换输出是签名或加密镜像，发布候选不得进入签名/加密状态");
}

// 8. CRC32 完整性：verify 必须通过。
const verify = runHdiUtil(["verify", tmpAbs]);
if (verify.status !== 0) {
  failAfterTmp(`hdiutil verify 失败 (exit ${verify.status}): ${verify.stderr || verify.stdout}`);
}
const crcOk =
  /已验证\s*CRC32/i.test(verify.stdout) ||
  /verified\s*CRC32/i.test(verify.stdout) ||
  /^CRC32\s*\$?[0-9A-Fa-f]+\s*:\s*(valid|已验证)/im.test(verify.stdout);
if (!crcOk) failAfterTmp("hdiutil verify 未报告 CRC32 校验通过，镜像完整性未证明");

// 9. 原子替换最终路径（同目录 rename），随后对最终路径复核格式。
renameSync(tmpAbs, inputAbs);
const finalInfo = runHdiUtil(["imageinfo", inputAbs]);
if (finalInfo.status !== 0) {
  fail(
    `替换后 imageinfo 复核失败 (exit ${finalInfo.status}): ${finalInfo.stderr || finalInfo.stdout}`,
  );
}
const finalFormat = finalInfo.stdout.match(/^Format:\s*(\S+)/m);
if (!finalFormat || finalFormat[1] !== format) {
  fail(`替换后最终 DMG 的 Format 不是 ${format}，候选不可用`);
}

// 10. source/worktree 复核：转换前后 Git 状态变化即 fail-closed。
function readGitState() {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    return { head, status };
  } catch (error) {
    fail(`无法读取 Git source 状态: ${error.message}`);
  }
}
const gitAfter = readGitState();
if (gitAfter.head !== gitBefore.head || gitAfter.status.length > 0) {
  fail("转换期间 source commit/worktree 发生变化，候选不可归因");
}

const finishedAt = new Date().toISOString();
const afterSha256 = computeFileSha256(inputAbs);
const afterBytes = statSync(inputAbs).size;

const report = {
  runner: "repack-dmg.mjs",
  runnerSha256: computeFileSha256(RUNNER_PATH),
  input: inputRel,
  dmgFormat: format,
  startedAt,
  finishedAt,
  beforeBytes,
  afterBytes,
  beforeSha256,
  afterSha256,
  formatEvidence: finalFormat[0],
  gitHead: gitAfter.head,
};

if (reportAbs) {
  mkdirSync(dirname(reportAbs), { recursive: true });
  writeFileSync(reportAbs, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report));
