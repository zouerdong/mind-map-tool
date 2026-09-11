import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname, relative } from "node:path";

const ROOT = resolve(__dirname, "../..");
const BUNDLE_GATE = resolve(ROOT, "scripts/quality/bundle-gate.mjs");
const REPACK_DMG = resolve(ROOT, "scripts/quality/repack-dmg.mjs");
const ASSEMBLE_DMG = resolve(ROOT, "scripts/quality/assemble-dmg.mjs");
const EULA_RESOURCE = resolve(ROOT, "scripts/quality/eula-resource.mjs");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const INSTALL_GATE = resolve(ROOT, "scripts/quality/install-gate.mjs");
const PERF_RUNNER = resolve(ROOT, "scripts/quality/run-performance.mjs");
const FIXTURE_DIR = resolve(ROOT, ".tmp/release-runner-fixtures");

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runNode(script: string, args: string[], env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

function createSyntheticRegister(
  g2Status: "approved" | "pending" | "blocked" = "approved",
  overrides: any = {},
  dir: string = FIXTURE_DIR,
) {
  mkdirSync(dir, { recursive: true });
  const regPath = join(
    dir,
    `register-${g2Status}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const relFixtureDir = ".tmp/release-runner-fixtures";
  const content = {
    schemaVersion: 1,
    gates: {
      G0: { status: "approved", approvedBy: "test", approvedAt: "2026-09-07" },
      G1: { status: "approved", approvedBy: "test", approvedAt: "2026-09-07" },
      G2: {
        status: g2Status,
        owner: "test-owner",
        approvedBy: "test-owner",
        approvedAt: "2026-09-07",
        evidence: ["[from-user] synthetic test approval"],
        approvedScope: {
          productName: "Mind Map",
          bundleIdentifier: "com.mindmap.desktop",
          version: "0.1.0",
          selectedHost: "tauri",
          candidateOutputPaths: [
            `${relFixtureDir}/bundle/macos/Mind Map.app`,
            `${relFixtureDir}/bundle/dmg/Mind Map_0.1.0_aarch64.dmg`,
          ],
          evidenceOutputPaths: [`${relFixtureDir}/evidence`],
          installationTargets: [`${relFixtureDir}/installed/Mind Map.app`],
          allowedActions: [
            "build",
            "launch",
            "install",
            "uninstall",
            "measure-performance",
            "permission-probe",
          ],
          deletionBoundaries: [
            `${relFixtureDir}/bundle`,
            `${relFixtureDir}/evidence`,
            `${relFixtureDir}/installed`,
          ],
          explicitlyExcluded: [
            "test-signing",
            "signing",
            "notarization",
            "credential access",
            "system trust changes",
            "upload",
            "publication",
          ],
          ...overrides,
        },
      },
    },
  };
  writeFileSync(regPath, JSON.stringify(content, null, 2));
  return regPath;
}

function createMockAppBundle(appPath: string, binScript?: string) {
  mkdirSync(join(appPath, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(appPath, "Contents/Resources"), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.mindmap.desktop</string>
  <key>CFBundleName</key>
  <string>Mind Map</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
</dict>
</plist>`;
  writeFileSync(join(appPath, "Contents/Info.plist"), plist);

  const script =
    binScript ??
    `#!/bin/sh
echo "[lifecycle] setup 完成：cold argv=0 个参数"
exit 0
`;
  const binPath = join(appPath, "Contents/MacOS/mind-map");
  writeFileSync(binPath, script);
  chmodSync(binPath, 0o755);
}

/**
 * 构造一个独立的 clean git 仓库（.gitignore 忽略 .tmp/ 产物），供 bundle-gate
 * 通过 --root 复算 clean-worktree 前置；真实仓库工作树不要求 clean。
 */
function createCleanGitRepo(name: string, extraFiles: Record<string, string> = {}): string {
  const repoDir = join(FIXTURE_DIR, name);
  rmSync(repoDir, { recursive: true, force: true });
  mkdirSync(join(repoDir, ".tmp/release-runner-fixtures"), { recursive: true });
  writeFileSync(join(repoDir, ".gitignore"), ".tmp/\n");
  for (const [rel, content] of Object.entries(extraFiles)) {
    const target = join(repoDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "fixture init", "--allow-empty"], {
    cwd: repoDir,
    env: gitEnv,
  });
  return repoDir;
}

/**
 * PRR-069 mock hdiutil：按 env 控制行为，供 repack-dmg 红灯注入。
 * MOCK_CONVERT_FAIL / MOCK_INFO_FAIL / MOCK_VERIFY_FAIL 使对应子命令非零退出；
 * MOCK_FORMAT 覆盖 imageinfo 声明的格式（伪造 Format 红灯）；
 * MOCK_SIGNED / MOCK_ENCRYPTED 使 imageinfo 声明签名/加密镜像；
 * MOCK_TOUCH_DIRTY 让 convert 在执行期间向仓库写入 untracked 文件。
 * convert 成功时把输入复制到 -o 目标并追加 ULMO-CONVERTED 标记，
 * 使转换后 hash 与转换前必然不同（供 inventory 绑定断言）。
 */
function createMockHdiutil(dir: string): string {
  const script = `#!/bin/sh
cmd="$1"; shift
case "$cmd" in
  convert)
    [ -n "$MOCK_CONVERT_FAIL" ] && { echo "mock convert failure" >&2; exit 3; }
    [ -n "$MOCK_TOUCH_DIRTY" ] && echo dirty > "$MOCK_TOUCH_DIRTY"
    in=""; out=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -format) shift 2 ;;
        -o) out="$2"; shift 2 ;;
        *) in="$1"; shift ;;
      esac
    done
    cp "$in" "$out" || exit 4
    printf 'ULMO-CONVERTED\\n' >> "$out"
    ;;
  imageinfo)
    [ -n "$MOCK_INFO_FAIL" ] && exit 5
    printf 'Format: %s\\n' "\${MOCK_FORMAT:-ULMO}"
    [ -n "$MOCK_SIGNED" ] && printf 'Signed For: mock-signer\\n'
    [ -n "$MOCK_ENCRYPTED" ] && printf 'Encrypted: Yes\\n'
    ;;
  verify)
    [ -n "$MOCK_VERIFY_FAIL" ] && { echo "CRC32 mismatch" >&2; exit 6; }
    printf '已验证CRC32 $DEADBEEF\\n'
    ;;
  *) echo "unknown subcommand: $cmd" >&2; exit 9 ;;
esac
exit 0
`;
  const p = join(dir, "mock-hdiutil.sh");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return p;
}

/** PRR-069 fixture：在 clean git repo 的批准 DMG 路径写入合成 UDZO 内容。 */
function createSyntheticDmg(repoDir: string, content = "synthetic udzo dmg"): string {
  const dmgDir = join(repoDir, ".tmp/release-runner-fixtures/bundle/dmg");
  mkdirSync(dmgDir, { recursive: true });
  const dmgPath = join(dmgDir, "Mind Map_0.1.0_aarch64.dmg");
  writeFileSync(dmgPath, content);
  return dmgPath;
}

const REPACK_DMG_REL = ".tmp/release-runner-fixtures/bundle/dmg/Mind Map_0.1.0_aarch64.dmg";

// ==================== PRR-069C 合成工具链 ====================
// 用仓库内合成脚本替身模拟 hdiutil/ditto/SetFile/mount/plutil/lipo/xattr，
// 让 assemble-dmg 的编排、超时与 fail-closed 分支可以在不真实挂载的前提下被验证。
// 真实挂载链路由三轮正式预检在真机上证明。
const MOCK_CORE_SOURCE = `
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 合成工具链：镜像是自描述的（内容即 JSON 状态文件），因此 rename/移动后仍可复核，
// 与 "hdiutil 只认镜像本身" 的真实语义一致。挂载表另存于 state 文件。
const DIR = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(DIR, "mock-state.json");
const tool = process.argv[2];
const args = process.argv.slice(3);
const env = process.env;

function loadState() {
  if (!existsSync(STATE_PATH)) return { mounts: {}, calls: [] };
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}
function saveState(state) { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }
function readImage(path) {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
function writeImage(path, image) {
  const json = JSON.stringify(image);
  writeFileSync(path, env.MOCK_BLOATED ? json + " ".repeat(Math.max(0, 25000001 - json.length)) : json);
}
function flagValue(name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? ""; }
function last() { return args[args.length - 1]; }
function die(code, msg) { process.stderr.write(msg + "\\n"); process.exit(code); }
function sleepForever() { const end = Date.now() + 3600000; while (Date.now() < end) { /* hang */ } }
function copyTree(from, to) {
  if (!from) throw new Error("mock: image has no contents");
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}
// 从 udifrez XML 中取出 TEXT 5000 正文，供 attach 的挂载前许可展示使用。
function licenseTextFromXml(xml) {
  const section = /<key>TEXT<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>/.exec(xml);
  if (!section) return null;
  for (const dict of section[1].matchAll(/<dict>([\\s\\S]*?)<\\/dict>/g)) {
    const id = /<key>ID<\\/key>\\s*<string>([^<]*)</.exec(dict[1]);
    const data = /<data>\\s*([A-Za-z0-9+/=\\s]+?)\\s*<\\/data>/.exec(dict[1]);
    if (id && id[1] === "5000" && data) {
      return Buffer.from(data[1].replace(/\\s+/g, ""), "base64").toString("utf8");
    }
  }
  return null;
}

const state = loadState();
state.calls.push({ tool, args });
// PRR-069C-R2：调用轨迹必须落盘，否则“没有真实系统工具调用”无法从证据侧复核。
saveState(state);

if (tool === "hdiutil") {
  const cmd = args[0];
  if (cmd === "create") {
    if (env.MOCK_CREATE_FAIL) die(3, "mock create failure");
    if (env.MOCK_CREATE_HANG) sleepForever();
    writeImage(last(), {
      format: flagValue("-format"),
      contents: resolve(flagValue("-srcfolder")),
      eulaText: null,
    });
    saveState(state);
    // PRR-069C-R2：create 成功后撤掉 hdiutil 替身，模拟系统工具在下次调用时不可用
    // （spawn error / ENOENT）。只作用于本次运行的替身副本，不触碰真实系统工具。
    if (env.MOCK_HIDE_TOOL_AFTER_CREATE) rmSync(join(DIR, "hdiutil"), { force: true });
    process.exit(0);
  }
  if (cmd === "attach") {
    if (env.MOCK_ATTACH_FAIL) die(4, "mock attach failure");
    if (env.MOCK_ATTACH_HANG) sleepForever();
    const imagePath = resolve(last());
    const image = readImage(imagePath);
    if (!image) die(7, "mock attach: not a mock image");
    const stdin = readFileSync(0, "utf8");
    if (image.eulaText && !env.MOCK_NO_EULA_GATE && !/Y/i.test(stdin)) {
      process.stdout.write(image.eulaText + "\\nAgree Y/N?\\n");
      process.exit(1);
    }
    const mp = flagValue("-mountpoint");
    const earlyStage = !args.includes("-readonly") ? "rw" : (/Y/i.test(stdin) ? "final" : "probe");
    const earlyHits = (name) => {
      const v = env[name];
      return Boolean(v) && (v === "all" || v === earlyStage);
    };
    if (earlyHits("MOCK_ATTACH_FAKE_SUCCESS")) process.exit(0);
    if (env.MOCK_ATTACH_WRONG_MOUNTPOINT) {
      process.stdout.write("/dev/disk9s1\\tApple_HFS\\t/tmp/somewhere-else\\n");
      process.exit(0);
    }
    copyTree(image.contents, mp);
    if (env.MOCK_ATTACH_EXTRA) writeFileSync(join(mp, env.MOCK_ATTACH_EXTRA), "extra");
    if (env.MOCK_ATTACH_BAD_LINK) {
      rmSync(join(mp, "Applications"), { force: true });
      writeFileSync(join(mp, "Applications"), "");
    }
    if (env.MOCK_ATTACH_BAD_ICON) writeFileSync(join(mp, ".VolumeIcon.icns"), "tampered");
    if (env.MOCK_ATTACH_TAMPER) {
      writeFileSync(join(mp, "Mind Map.app/Contents/Info.plist"), '{"CFBundleIdentifier":"evil"}');
    }
    state.mounts[mp] = { device: "/dev/disk9s1", image: imagePath, readOnly: args.includes("-readonly") };
    saveState(state);
    // PRR-069C-R2：挂载已真实登记之后的阶段化异常注入（三个 attach 阶段各可命中）。
    // 阶段判定：无 -readonly 为可写卷 rw；只读时 stdin 带 Y 为最终复核卷 final，
    // 否则为挂载前 EULA 拒绝探针 probe。取值 "all" 命全部阶段。
    const attachStage = !args.includes("-readonly") ? "rw" : (/Y/i.test(stdin) ? "final" : "probe");
    const hitsStage = (name) => {
      const v = env[name];
      return Boolean(v) && (v === "all" || v === attachStage);
    };
    if (hitsStage("MOCK_ATTACH_HANG_AFTER_MOUNT")) sleepForever();
    if (hitsStage("MOCK_ATTACH_FAIL_AFTER_MOUNT")) {
      die(21, "mock attach failure after mount (" + attachStage + ")");
    }
    if (hitsStage("MOCK_ATTACH_SILENT_AFTER_MOUNT")) process.exit(0);
    // MOCK_ATTACH_FAKE_SUCCESS：未建立挂载却返回 0（状态矛盾，不得被当成没有挂载）。
    if (hitsStage("MOCK_ATTACH_FAKE_SUCCESS")) process.exit(0);
    // MOCK_ATTACH_UNPARSABLE：挂载真实登记后输出不含 mountpoint 的内容（登记恢复红灯）。
    if (env.MOCK_ATTACH_UNPARSABLE) {
      process.stdout.write("attach: handle allocated, details omitted\\n");
      process.exit(0);
    }
    process.stdout.write("/dev/disk9\\tGUID_partition_scheme\\t\\n");
    process.stdout.write("/dev/disk9s1\\tApple_HFS\\t" + mp + "\\n");
    process.exit(0);
  }
  if (cmd === "detach") {
    if (env.MOCK_DETACH_FAIL) die(5, "mock detach failure");
    // MOCK_DETACH_FAIL_ON：第 N 次 detach 起失败（区分 rw 与只读卷的清理路径）。
    state.detachCount = (state.detachCount || 0) + 1;
    if (env.MOCK_DETACH_FAIL_ON && state.detachCount >= Number(env.MOCK_DETACH_FAIL_ON)) {
      saveState(state);
      die(5, "mock detach failure (on #" + state.detachCount + ")");
    }
    const mount = state.mounts[args[1]];
    if (mount && !mount.readOnly) {
      // 可写卷卸载后镜像内容即挂载期间状态（含被删除的 .fseventsd）。
      const image = readImage(mount.image);
      if (image) writeImage(mount.image, { ...image, contents: args[1] });
    }
    // MOCK_DETACH_LIE：detach 返回 0 但 mount table 条目保留（复核红灯）。
    if (!env.MOCK_DETACH_LIE) delete state.mounts[args[1]];
    saveState(state);
    process.exit(0);
  }
  if (cmd === "convert") {
    if (env.MOCK_CONVERT_FAIL) die(6, "mock convert failure");
    const source = readImage(resolve(args[1]));
    if (!source) die(6, "mock convert: not a mock image");
    const out = resolve(flagValue("-o"));
    writeImage(out, { ...source, format: flagValue("-format") });
    process.exit(0);
  }
  if (cmd === "imageinfo") {
    if (env.MOCK_INFO_FAIL) die(8, "mock imageinfo failure");
    const image = readImage(resolve(last()));
    process.stdout.write("Format: " + (env.MOCK_FORMAT || (image && image.format) || "UDZO") + "\\n");
    // 真实 hdiutil 的该字段带前导制表符，mock 必须复刻该格式，否则会漏检行首空白缺陷。
    process.stdout.write("\\tSoftware License Agreement: " + (image && image.eulaText ? "true" : "false") + "\\n");
    if (env.MOCK_SIGNED) process.stdout.write("Signed For: mock\\n");
    process.exit(0);
  }
  if (cmd === "verify") {
    if (env.MOCK_VERIFY_FAIL) die(9, "CRC32 mismatch");
    if (!readImage(resolve(last()))) die(9, "mock verify: not a mock image");
    process.stdout.write("已验证CRC32 $DEADBEEF\\n");
    process.exit(0);
  }
  if (cmd === "udifrez") {
    if (env.MOCK_UDIFREZ_FAIL) die(10, "mock udifrez failure");
    const imagePath = resolve(last());
    const image = readImage(imagePath);
    if (!image) die(10, "mock udifrez: not a mock image");
    if (!env.MOCK_UDIFREZ_NOOP) {
      const xml = readFileSync(flagValue("-xml"), "utf8");
      writeImage(imagePath, { ...image, eulaText: licenseTextFromXml(xml) });
    }
    process.exit(0);
  }
  if (cmd === "udifderez") {
    const image = readImage(resolve(last()));
    const text = (image && image.eulaText) || "";
    const b64 = Buffer.from(env.MOCK_EULA_TAMPER ? "tampered license text" : text, "utf8").toString("base64");
    process.stdout.write("<plist><dict><key>TEXT</key><array><dict>");
    process.stdout.write("<key>Data</key><data>" + b64 + "</data>");
    process.stdout.write("<key>ID</key><string>5000</string>");
    process.stdout.write("</dict></array></dict></plist>\\n");
    process.exit(0);
  }
  die(11, "mock hdiutil: unknown subcommand " + cmd);
}

if (tool === "ditto") {
  if (env.MOCK_DITTO_FAIL) die(12, "mock ditto failure");
  cpSync(args[0], args[1], { recursive: true, verbatimSymlinks: true });
  process.exit(0);
}
if (tool === "SetFile") {
  if (env.MOCK_SETFILE_FAIL) die(13, "mock SetFile failure");
  // MOCK_SETFILE_SWAP_DEVICE：可写卷挂载之后，让 mount table 报告成另一个设备，
  // 供“卸载前置身份核对”红灯使用（SetFile 恰好位于 rw attach 与 rw detach 之间）。
  if (env.MOCK_SETFILE_SWAP_DEVICE) { state.deviceSwapped = true; saveState(state); }
  process.exit(0);
}
if (tool === "mount") {
  // MOCK_MOUNT_FAIL/HANG：mount table 不可用（fail-closed 红灯）。
  if (env.MOCK_MOUNT_FAIL) die(15, "mock mount failure");
  if (env.MOCK_MOUNT_HANG) sleepForever();
  for (const mp of Object.keys(state.mounts)) {
    const dev = state.deviceSwapped ? "/dev/disk7s1" : state.mounts[mp].device;
    process.stdout.write(dev + " on " + mp + " (hfs, local, read-only)\\n");
  }
  process.exit(0);
}
if (tool === "xattr") {
  process.stdout.write(
    env.MOCK_NO_ICON_FLAG
      ? "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00\\n00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00\\n"
      : "00 00 00 00 00 00 00 00 04 00 00 00 00 00 00 00\\n00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00\\n",
  );
  process.exit(0);
}
if (tool === "plutil") {
  process.stdout.write(readFileSync(last(), "utf8"));
  process.exit(0);
}
if (tool === "lipo") {
  process.stdout.write("arm64\\n");
  process.exit(0);
}
die(14, "mock: unknown tool " + tool);
`;

function createMockToolchain(dir: string): string {
  const toolDir = join(dir, "mock-tools");
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    join(toolDir, "mock-state.json"),
    JSON.stringify({ images: {}, mounts: {}, calls: [] }),
  );
  writeFileSync(join(toolDir, "mock-core.mjs"), MOCK_CORE_SOURCE);
  for (const tool of ["hdiutil", "ditto", "SetFile", "mount", "plutil", "lipo", "xattr"]) {
    const p = join(toolDir, tool);
    writeFileSync(
      p,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(toolDir, "mock-core.mjs"))} ${tool} "$@"\n`,
    );
    chmodSync(p, 0o755);
  }
  return toolDir;
}

const ASSEMBLY_APP_REL = ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app";
const ASSEMBLY_DMG_REL = REPACK_DMG_REL;
const ASSEMBLY_WORK_REL = ".tmp/release-runner-fixtures/work";

/** 合成 .app：Info.plist 用 JSON 文本，供 mock plutil 直接回显后由 assembler 解析。 */
function createAssemblyApp(appAbs: string, overrides: Record<string, string> = {}) {
  mkdirSync(join(appAbs, "Contents/MacOS"), { recursive: true });
  const plist = {
    CFBundleIdentifier: "com.mindmap.desktop",
    CFBundleExecutable: "mind-map",
    CFBundleShortVersionString: "0.1.0",
    CFBundleVersion: "0.1.0",
    LSMinimumSystemVersion: "11.0",
    ...overrides,
  };
  writeFileSync(join(appAbs, "Contents/Info.plist"), JSON.stringify(plist, null, 2));
  const bin = join(appAbs, "Contents/MacOS/mind-map");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
}

const ASSEMBLY_LICENSE_TEXT =
  "Synthetic Assembly License\nCopyright (c) 2026 Example. All rights reserved.\nNo warranty of any kind is provided.\n";

function createAssemblyFixture(name: string) {
  const repoDir = createCleanGitRepo(name, {
    LICENSE: ASSEMBLY_LICENSE_TEXT,
    "apps/desktop/src-tauri/icons/icon.icns": "synthetic-icns-bytes",
  });
  const regPath = createSyntheticRegister("approved", {}, join(repoDir, ".tmp"));
  const toolDir = createMockToolchain(join(repoDir, ".tmp"));
  createAssemblyApp(join(repoDir, ASSEMBLY_APP_REL));
  return { repoDir, regPath, toolDir };
}

function assemblerArgs(
  repoDir: string,
  regPath: string,
  toolDir: string,
  overrides: Record<string, string | null> = {},
) {
  const merged: Record<string, string | null> = {
    app: ASSEMBLY_APP_REL,
    output: ASSEMBLY_DMG_REL,
    "work-dir": ASSEMBLY_WORK_REL,
    format: "ULMO",
    after: "2020-01-01T00:00:00Z",
    "scope-from": regPath,
    root: repoDir,
    "tool-dir": relative(repoDir, toolDir),
    "timeout-ms": "5000",
    "deadline-ms": "20000",
    ...overrides,
  };
  const argv: string[] = [];
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null) argv.push(`--${key}`, value);
  }
  return argv;
}

function runAssembler(
  repoDir: string,
  regPath: string,
  toolDir: string,
  overrides: Record<string, string | null> = {},
  env: Record<string, string> = {},
) {
  return runNode(ASSEMBLE_DMG, assemblerArgs(repoDir, regPath, toolDir, overrides), env);
}

function readAssemblyReport(
  repoDir: string,
  rel = ".tmp/release-runner-fixtures/evidence/assembly-report.json",
) {
  return JSON.parse(readFileSync(join(repoDir, rel), "utf8"));
}

/** PRR-010 协议 mock：按 env 输出带 runId/generation 的 perf JSON 行。 */
const PERF_PROTOCOL_BIN = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
SC="\${MINDMAP_PERF_SCENARIO:-launch}"
emit() { printf '%s\\n' "$1"; }
if [ "$SC" = "rss" ]; then
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"rss-sample\\",\\"rssKb\\":51200,\\"settleMs\\":30000}"
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"rss-sample\\",\\"rssKb\\":52224,\\"settleMs\\":30000}"
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"rss-complete\\",\\"settleMs\\":30000}"
else
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
fi
exit 0
`;

/** PRR-066 反例 mock：rss 事件只声明 2s 稳定窗（旧协议），必须判 INCOMPLETE。 */
const PERF_PROTOCOL_BIN_SHORT_SETTLE = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
SC="\${MINDMAP_PERF_SCENARIO:-launch}"
emit() { printf '%s\\n' "$1"; }
if [ "$SC" = "rss" ]; then
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"rss-sample\\",\\"rssKb\\":51200,\\"settleMs\\":2000}"
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"rss-complete\\",\\"settleMs\\":2000}"
else
  emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
fi
exit 0
`;

describe("release-runners (PRC-055 CLI & 安全门契约)", () => {
  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
    } catch {}
  });

  // ==================== 1. bundle-gate 测试 ====================
  describe("bundle-gate", () => {
    it("G2 pending/missing 时直接 fail-closed，且不启动子进程", () => {
      const regPath = createSyntheticRegister("pending");
      const sentinel = join(FIXTURE_DIR, "should-not-create.txt");
      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--",
        process.execPath,
        "-e",
        `require('fs').writeFileSync('${sentinel}', 'fail')`,
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("G2 scope 校验未通过");
      expect(existsSync(sentinel)).toBe(false);
    });

    it("G2 使用批准人占位符时直接 fail-closed", () => {
      const regPath = createSyntheticRegister("approved");
      const register = JSON.parse(readFileSync(regPath, "utf8"));
      register.gates.G2.approvedBy = "project-owner";
      writeFileSync(regPath, JSON.stringify(register, null, 2));

      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("必须记录真实批准人");
    });

    it("host 与 G2 selectedHost 不匹配时失败", () => {
      const regPath = createSyntheticRegister("approved");
      const res = runNode(BUNDLE_GATE, [
        "--host",
        "electron",
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("G2 approved host mismatch");
    });

    it("candidate-root 发生路径逃逸 (..) 时直接失败", () => {
      const regPath = createSyntheticRegister("approved");
      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/../../",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("路径穿越");
    });

    it("candidate-root 只是批准目录的字符串前缀时仍拒绝", () => {
      const regPath = createSyntheticRegister("approved");
      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle-escape",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("唯一共同目录");
    });

    it("环境变量命中签名/凭据提示时 fail-closed，且绝不泄漏凭据值", () => {
      const regPath = createSyntheticRegister("approved");
      const secretValue = "SUPER_SECRET_KEY_NEVER_LOG";
      const res = runNode(
        BUNDLE_GATE,
        [
          "--host",
          "tauri",
          "--scope-from",
          regPath,
          "--candidate-root",
          ".tmp/release-runner-fixtures/bundle",
          "--",
          process.execPath,
          "-e",
          "process.exit(0)",
        ],
        { APPLE_ID: secretValue },
      );

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("FAIL — 检测到签名配置/凭据迹象");
      expect(res.stderr).toContain("env:APPLE_ID");
      expect(res.stderr).not.toContain(secretValue);
      expect(res.stdout).not.toContain(secretValue);
    });

    it("approved 契约下假执行能够成功构建并输出 inventory/hash", () => {
      const repoDir = createCleanGitRepo("bundle-ok-repo");
      const regPath = createSyntheticRegister("approved", {}, join(repoDir, ".tmp"));
      const bundleDir = join(repoDir, ".tmp/release-runner-fixtures/bundle/macos");
      const dmgDir = join(repoDir, ".tmp/release-runner-fixtures/bundle/dmg");
      const mockApp = join(bundleDir, "Mind Map.app");
      const mockDmg = join(dmgDir, "Mind Map_0.1.0_aarch64.dmg");

      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--root",
        repoDir,
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--inventory",
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
        "--",
        process.execPath,
        "-e",
        `const fs = require('fs');
         fs.mkdirSync('${bundleDir}', { recursive: true });
         fs.mkdirSync('${dmgDir}', { recursive: true });
         fs.mkdirSync('${mockApp}/Contents/MacOS', { recursive: true });
         fs.writeFileSync('${mockApp}/Contents/MacOS/mind-map', '#!/bin/sh\\nexit 0\\n');
         fs.writeFileSync('${mockApp}/Contents/Info.plist', '<plist></plist>');
         fs.writeFileSync('${mockDmg}', 'synthetic dmg');`,
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("PASS — 成功构建并盘点");
      expect(res.stdout).toContain("Mind Map.app");
      expect(
        existsSync(join(repoDir, ".tmp/release-runner-fixtures/evidence/bundle-inventory.json")),
      ).toBe(true);
    });

    it("子进程未刷新预存候选时拒绝把陈旧产物报成新构建", () => {
      const repoDir = createCleanGitRepo("bundle-stale-repo");
      const regPath = createSyntheticRegister("approved", {}, join(repoDir, ".tmp"));
      const candidateApp = join(repoDir, ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app");
      const candidateDmg = join(
        repoDir,
        ".tmp/release-runner-fixtures/bundle/dmg/Mind Map_0.1.0_aarch64.dmg",
      );
      createMockAppBundle(candidateApp);
      mkdirSync(dirname(candidateDmg), { recursive: true });
      writeFileSync(candidateDmg, "stale dmg");

      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--root",
        repoDir,
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("并非本次构建产生或刷新");
    });

    it("PRR-069C：--assemble-dmg 全链成功，inventory 绑定 assembler 报告与 ULMO 输出", () => {
      const { repoDir, regPath } = createAssemblyFixture("bundle-assemble-ok-repo");
      const inventoryPath = join(
        repoDir,
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
      );
      const dmgPath = join(repoDir, ASSEMBLY_DMG_REL);

      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--root",
        repoDir,
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--assemble-dmg",
        "--dmg-format",
        "ULMO",
        "--work-dir",
        ASSEMBLY_WORK_REL,
        "--assembler-tool-dir",
        ".tmp/mock-tools",
        "--inventory",
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
        "--",
        process.execPath,
        "-e",
        appBuildScript(repoDir),
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("dmgAssembly");
      const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
      expect(inventory.dmgFormat).toBe("ULMO");
      expect(inventory.dmgAssembly.runner).toBe("assemble-dmg.mjs");
      expect(inventory.dmgAssembly.output.path).toBe(ASSEMBLY_DMG_REL);
      expect(inventory.dmgAssembly.output.sha256).toBe(fileSha256(dmgPath));
      expect(inventory.dmgAssembly.inputs.app.path).toBe(ASSEMBLY_APP_REL);
      expect(inventory.dmgAssembly.inputs.license.path).toBe("LICENSE");
      expect(inventory.dmgAssembly.checks.format).toBe("ULMO");
      const dmgArtifact = inventory.artifacts.find((a: any) => a.path.endsWith(".dmg"));
      expect(dmgArtifact.sha256).toBe(inventory.dmgAssembly.output.sha256);
      expect(
        existsSync(join(repoDir, ".tmp/release-runner-fixtures/evidence/dmg-assembly-report.json")),
      ).toBe(true);
    });

    it("PRR-069C：assembler 失败时 bundle gate 整体失败且不写 inventory", () => {
      const { repoDir, regPath } = createAssemblyFixture("bundle-assemble-fail-repo");
      const inventoryPath = join(
        repoDir,
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
      );

      const res = runNode(
        BUNDLE_GATE,
        [
          "--host",
          "tauri",
          "--root",
          repoDir,
          "--scope-from",
          regPath,
          "--candidate-root",
          ".tmp/release-runner-fixtures/bundle",
          "--assemble-dmg",
          "--dmg-format",
          "ULMO",
          "--work-dir",
          ASSEMBLY_WORK_REL,
          "--assembler-tool-dir",
          ".tmp/mock-tools",
          "--inventory",
          ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
          "--",
          process.execPath,
          "-e",
          appBuildScript(repoDir),
        ],
        { MOCK_CONVERT_FAIL: "1" },
      );

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("DMG 装配失败");
      expect(existsSync(inventoryPath)).toBe(false);
      expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
    });

    it("PRR-069C：assembler 报告形状无效时 gate fail-closed，不写 inventory", () => {
      const { repoDir, regPath } = createAssemblyFixture("bundle-assemble-bad-report-repo");
      const inventoryPath = join(
        repoDir,
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
      );
      const fakeAssembler = join(repoDir, ".tmp/fake-assembler.mjs");
      writeFileSync(
        fakeAssembler,
        `import { mkdirSync, writeFileSync } from "node:fs";
         import { dirname } from "node:path";
         const out = process.argv[process.argv.indexOf("--output") + 1];
         mkdirSync(dirname(out), { recursive: true });
         writeFileSync(out, "fake dmg");
         console.log(JSON.stringify({ runner: "assemble-dmg.mjs", dmgFormat: "UDZO" }));\n`,
      );

      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--root",
        repoDir,
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--assemble-dmg",
        "--dmg-format",
        "ULMO",
        "--work-dir",
        ASSEMBLY_WORK_REL,
        "--assembler-script",
        ".tmp/fake-assembler.mjs",
        "--inventory",
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
        "--",
        process.execPath,
        "-e",
        appBuildScript(repoDir),
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("assemble-dmg 报告");
      expect(existsSync(inventoryPath)).toBe(false);
    });

    it("PRR-069C：--assemble-dmg 缺 --dmg-format ULMO 或 --work-dir 时拒绝", () => {
      const { repoDir, regPath } = createAssemblyFixture("bundle-assemble-args-repo");
      for (const extra of [
        ["--assemble-dmg", "--work-dir", ASSEMBLY_WORK_REL],
        ["--assemble-dmg", "--dmg-format", "ULMO"],
      ]) {
        const res = runNode(BUNDLE_GATE, [
          "--host",
          "tauri",
          "--root",
          repoDir,
          "--scope-from",
          regPath,
          "--candidate-root",
          ".tmp/release-runner-fixtures/bundle",
          ...extra,
          "--",
          process.execPath,
          "-e",
          "process.exit(0)",
        ]);
        expect(res.status).toBe(1);
      }
    });
  });

  // ==================== 1b. repack-dmg 测试（PRR-069） ====================
  describe("repack-dmg (PRR-069 DMG 容器格式转换)", () => {
    function setup(name: string, content = "synthetic udzo dmg") {
      const repoDir = createCleanGitRepo(name);
      const regPath = createSyntheticRegister("approved", {}, join(repoDir, ".tmp"));
      const mockHdiutil = createMockHdiutil(join(repoDir, ".tmp"));
      const dmgPath = createSyntheticDmg(repoDir, content);
      return { repoDir, regPath, mockHdiutil, dmgPath };
    }

    function runRepack(
      repoDir: string,
      regPath: string,
      mockHdiutil: string,
      extra: string[] = [],
      env: Record<string, string> = {},
    ) {
      return runNode(
        REPACK_DMG,
        [
          "--input",
          REPACK_DMG_REL,
          "--format",
          "ULMO",
          "--scope-from",
          regPath,
          "--root",
          repoDir,
          "--after",
          "2020-01-01T00:00:00Z",
          "--hdiutil",
          mockHdiutil,
          ...extra,
        ],
        env,
      );
    }

    it("缺 --format 时直接 fail-closed", () => {
      const { repoDir, regPath, mockHdiutil } = setup("repack-no-format-repo");
      const res = runNode(REPACK_DMG, [
        "--input",
        REPACK_DMG_REL,
        "--scope-from",
        regPath,
        "--root",
        repoDir,
        "--hdiutil",
        mockHdiutil,
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("缺少 --format");
    });

    it("不允许的格式（UDZO/UDBZ）被拒绝", () => {
      const { repoDir, regPath, mockHdiutil } = setup("repack-bad-format-repo");
      for (const bad of ["UDZO", "UDBZ", "ulmo"]) {
        const res = runNode(REPACK_DMG, [
          "--input",
          REPACK_DMG_REL,
          "--format",
          bad,
          "--scope-from",
          regPath,
          "--root",
          repoDir,
          "--hdiutil",
          mockHdiutil,
        ]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("不允许的 DMG 目标格式");
      }
    });

    it("输入路径穿越 (..) 或越出 repo root 时直接失败", () => {
      const { repoDir, regPath, mockHdiutil } = setup("repack-escape-repo");
      const escaping: string[] = ["../../evil.dmg", join("/tmp", "evil-repack.dmg")];
      for (const bad of escaping) {
        const res = runNode(REPACK_DMG, [
          "--input",
          bad,
          "--format",
          "ULMO",
          "--scope-from",
          regPath,
          "--root",
          repoDir,
          "--hdiutil",
          mockHdiutil,
        ]);
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/路径穿越|越界 repo root|不能指向仓库根目录/);
      }
    });

    it("输入不在 G2 批准的 DMG candidateOutputPaths 内时拒绝", () => {
      const { repoDir, regPath, mockHdiutil } = setup("repack-unapproved-repo");
      mkdirSync(join(repoDir, ".tmp/release-runner-fixtures/bundle/dmg/other"), {
        recursive: true,
      });
      writeFileSync(
        join(repoDir, ".tmp/release-runner-fixtures/bundle/dmg/other/Other.dmg"),
        "unapproved",
      );
      const res = runNode(REPACK_DMG, [
        "--input",
        ".tmp/release-runner-fixtures/bundle/dmg/other/Other.dmg",
        "--format",
        "ULMO",
        "--scope-from",
        regPath,
        "--root",
        repoDir,
        "--hdiutil",
        mockHdiutil,
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("candidate");
    });

    it("输入 DMG 不是本轮构建刷新（mtime 早于 --after）时拒绝", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-stale-repo");
      const res = runNode(REPACK_DMG, [
        "--input",
        REPACK_DMG_REL,
        "--format",
        "ULMO",
        "--scope-from",
        regPath,
        "--root",
        repoDir,
        "--after",
        "2999-01-01T00:00:00Z",
        "--hdiutil",
        mockHdiutil,
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("不是本轮构建刷新");
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
    });

    it("--after 不是明确 UTC ISO 时拒绝，不把本地时间冒充 Z", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-local-time-repo");
      const res = runNode(REPACK_DMG, [
        "--input",
        REPACK_DMG_REL,
        "--format",
        "ULMO",
        "--scope-from",
        regPath,
        "--root",
        repoDir,
        "--after",
        "2026-09-10T03:14:01+08:00",
        "--hdiutil",
        mockHdiutil,
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("必须是 UTC ISO");
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
    });

    it("未批准的 report 路径在转换前拒绝，原 DMG 不变", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-report-scope-repo");
      const res = runRepack(repoDir, regPath, mockHdiutil, [
        "--report",
        "docs/unapproved-repack-report.json",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("report 路径不在 G2 批准");
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
    });

    it("转换开始前 worktree 非 clean 时拒绝，原 DMG 不变", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-pre-dirty-repo");
      writeFileSync(join(repoDir, "untracked-before-repack.txt"), "dirty");
      const res = runRepack(repoDir, regPath, mockHdiutil);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("转换开始前 worktree 非 clean");
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
    });

    it("临时目标预存时 fail-closed", () => {
      const { repoDir, regPath, mockHdiutil } = setup("repack-tmp-exists-repo");
      const tmpPath = join(repoDir, REPACK_DMG_REL).replace(/\.dmg$/, ".repack-ULMO.tmp.dmg");
      writeFileSync(tmpPath, "leftover from failed prior run");
      const res = runRepack(repoDir, regPath, mockHdiutil);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("临时目标已存在");
      expect(readFileSync(tmpPath, "utf8")).toBe("leftover from failed prior run");
    });

    it("hdiutil convert 失败时 fail-closed，原 DMG 与临时现场保持原样语义", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-convert-fail-repo");
      const res = runRepack(repoDir, regPath, mockHdiutil, [], { MOCK_CONVERT_FAIL: "1" });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("hdiutil convert 失败");
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
    });

    it("imageinfo 声明的 Format 与目标不符（伪造/静默回退）时失败", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-fake-format-repo");
      const res = runRepack(repoDir, regPath, mockHdiutil, [], { MOCK_FORMAT: "UDZO" });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Format=UDZO");
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
    });

    it("输出是签名或加密镜像时失败", () => {
      const { repoDir, regPath, mockHdiutil } = setup("repack-signed-repo");
      const signed = runRepack(repoDir, regPath, mockHdiutil, [], { MOCK_SIGNED: "1" });
      expect(signed.status).toBe(1);
      expect(signed.stderr).toContain("签名或加密镜像");
      const encrypted = runRepack(repoDir, regPath, mockHdiutil, [], { MOCK_ENCRYPTED: "1" });
      expect(encrypted.status).toBe(1);
      expect(encrypted.stderr).toContain("签名或加密镜像");
    });

    it("CRC32 校验失败时 fail-closed", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-crc-fail-repo");
      const res = runRepack(repoDir, regPath, mockHdiutil, [], { MOCK_VERIFY_FAIL: "1" });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("CRC32");
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
    });

    it("转换期间 worktree 被 touch 脏时 fail-closed（source 不可归因）", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-dirty-repo");
      const res = runRepack(repoDir, regPath, mockHdiutil, [], {
        MOCK_TOUCH_DIRTY: join(repoDir, "untracked-dirty.txt"),
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("source commit/worktree 发生变化");
      // 原 DMG 已被替换（rename 先于 git 复核），但流程报 FAIL，候选不得被采信；
      // 残留的 untracked 文件证明检测生效。
      expect(existsSync(join(repoDir, "untracked-dirty.txt"))).toBe(true);
      expect(readFileSync(dmgPath, "utf8")).toContain("ULMO-CONVERTED");
    });

    it("成功路径：转换后文件为 ULMO 标记、临时文件消失、stdout 输出绑定 hash 的 JSON 报告", () => {
      const { repoDir, regPath, mockHdiutil, dmgPath } = setup("repack-ok-repo", "udzo payload v1");
      const res = runRepack(repoDir, regPath, mockHdiutil);
      expect(res.status).toBe(0);
      const reportLine = res.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"))
        .pop()!;
      const report = JSON.parse(reportLine);
      expect(report.dmgFormat).toBe("ULMO");
      expect(report.beforeSha256).not.toBe(report.afterSha256);
      expect(report.afterSha256).toBe(fileSha256(dmgPath));
      expect(report.formatEvidence).toBe("Format: ULMO");
      expect(readFileSync(dmgPath, "utf8")).toContain("ULMO-CONVERTED");
      expect(existsSync(dmgPath.replace(/\.dmg$/, ".repack-ULMO.tmp.dmg"))).toBe(false);
    });
  });

  // ==================== 2. install-gate 测试 ====================
  describe("install-gate", () => {
    it("G2 pending 时直接退出 1", () => {
      const regPath = createSyntheticRegister("pending");
      const res = runNode(INSTALL_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--plan",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("G2 scope 校验未通过");
    });

    it("--plan 模式是幂等的且实现零文件系统变更", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      const targetDir = join(FIXTURE_DIR, "installed");
      expect(existsSync(targetDir)).toBe(false);

      const res1 = runNode(INSTALL_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--plan",
      ]);

      expect(res1.status).toBe(0);
      expect(res1.stdout).toContain("PLAN SUCCESS");
      expect(existsSync(targetDir)).toBe(false);

      // 第二次运行验证幂等性
      const res2 = runNode(INSTALL_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
      ]);

      expect(res2.status).toBe(0);
      expect(res2.stdout).toContain("PLAN SUCCESS");
      expect(existsSync(targetDir)).toBe(false);
    });

    it("repo 内绝对 candidate/evidence 路径可以规范化并通过 plan", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      const res = runNode(INSTALL_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate",
        candidateApp,
        "--evidence-dir",
        join(FIXTURE_DIR, "evidence"),
        "--plan",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("PLAN SUCCESS");
    });

    it("evidence 目录只是批准目录的字符串前缀时仍拒绝", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      const res = runNode(INSTALL_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence-escape",
        "--plan",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("不在批准 evidenceOutputPaths 中");
    });

    it("--execute 遇到非本 candidate 的预存同名 app 时拒绝覆盖或清理", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      // 预先建立一个 alien 目录
      const targetApp = join(FIXTURE_DIR, "installed/Mind Map.app");
      mkdirSync(targetApp, { recursive: true });
      writeFileSync(join(targetApp, "alien-secret.txt"), "DO_NOT_DELETE");

      const res = runNode(INSTALL_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--execute",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("目标位置已存在预存应用且不属于本 candidate");
      // 确认未误删预存文件
      expect(existsSync(join(targetApp, "alien-secret.txt"))).toBe(true);
    });

    it("--execute 在 approved 范围内完成安装、身份核验、干净卸载并写入证据", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      const targetApp = join(FIXTURE_DIR, "installed/Mind Map.app");

      const res = runNode(INSTALL_GATE, [
        "--host",
        "tauri",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--execute",
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("PASS — 安装与干净卸载验证完成");
      // 目标已干净卸载
      expect(existsSync(targetApp)).toBe(false);

      // 证据文件已生成
      const evidencePath = join(FIXTURE_DIR, "evidence/install-gate-evidence.json");
      expect(existsSync(evidencePath)).toBe(true);
    });
  });

  // ==================== 3. run-performance 测试 ====================
  describe("run-performance --scope release", () => {
    it("未提供 candidate 或 evidence-dir 时直接退出 1", () => {
      const res = runNode(PERF_RUNNER, ["--scope", "release"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("必须指定 --candidate");
    });

    it("G2 pending 时拒绝采样原生指标并退出 1", () => {
      const regPath = createSyntheticRegister("pending");
      const res = runNode(PERF_RUNNER, [
        "--scope",
        "release",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("G2 scope 校验失败");
    });

    it("candidate 不存在时 fail-closed", () => {
      const regPath = createSyntheticRegister("approved");
      const res = runNode(PERF_RUNNER, [
        "--scope",
        "release",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("候选产物不存在");
    });

    it("已有性能轮次证据时拒绝覆盖，失败轮次原文保持不变", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp, PERF_PROTOCOL_BIN);
      const priorPath = join(FIXTURE_DIR, "evidence/cold-conditioning.json");
      mkdirSync(dirname(priorPath), { recursive: true });
      const prior = '{"sentinel":"prior-failed-round"}\n';
      writeFileSync(priorPath, prior);

      const res = runNode(PERF_RUNNER, [
        "--scope",
        "release",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--samples",
        "20",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("禁止覆盖或混样");
      expect(readFileSync(priorPath, "utf8")).toBe(prior);
    });

    it("少于 20 个 release 样本时 fail-closed", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      const res = runNode(PERF_RUNNER, [
        "--scope",
        "release",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--samples",
        "2",
        "--skip-canvas",
      ]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain("至少需要 20 个样本");
    });

    it("缺少 renderer-ready、RSS 或 native canvas 时生成 INCOMPLETE 证据并返回非零", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      const res = runNode(PERF_RUNNER, [
        "--scope",
        "release",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--samples",
        "20",
        "--skip-canvas",
        "--skip-scenarios",
        "rss,edit,save,png-export",
      ]);

      expect(res.status).toBe(1);
      expect(res.stdout).toContain("INCOMPLETE");

      const rawPath = join(FIXTURE_DIR, "evidence/release-performance-raw.json");
      const summaryPath = join(FIXTURE_DIR, "evidence/release-performance-summary.json");
      expect(existsSync(rawPath)).toBe(true);
      expect(existsSync(summaryPath)).toBe(true);
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      expect(summary.overall).toBe("INCOMPLETE");
      expect(
        summary.incompleteReasons.some((reason: string) => reason.includes("renderer-ready")),
      ).toBe(true);
      // ADR 0006 1.1.0：conditioning 失败 → 整轮 INCOMPLETE，measured cold 不补跑；
      // 失败态也落盘为 cold-conditioning.json 证据。
      expect(
        summary.incompleteReasons.some((reason: string) => reason.includes("cold conditioning")),
      ).toBe(true);
      const raw = JSON.parse(readFileSync(rawPath, "utf8"));
      expect(raw.coldSamples).toHaveLength(0);
      expect(raw.conditioning.success).toBe(false);
      const conditioning = JSON.parse(
        readFileSync(join(FIXTURE_DIR, "evidence/cold-conditioning.json"), "utf8"),
      );
      expect(conditioning.conditioning.success).toBe(false);
      expect(conditioning.conditioning.error).toContain("renderer-ready");
    });

    it("PRR-010 协议 mock：stdout perf 事件被采入 raw 并记录 runId/generation 链", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp, PERF_PROTOCOL_BIN);

      const res = runNode(PERF_RUNNER, [
        "--scope",
        "release",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--samples",
        "20",
        "--skip-canvas",
        "--skip-scenarios",
        "canvas,edit,save,png-export",
      ]);

      // canvas/edit/save/png 跳过 → INCOMPLETE；但 cold/warm/rss 必须已采满。
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("INCOMPLETE");

      const raw = JSON.parse(
        readFileSync(join(FIXTURE_DIR, "evidence/release-performance-raw.json"), "utf8"),
      );
      expect(raw.coldSamples).toHaveLength(20);
      expect(raw.warmSamples).toHaveLength(20);
      expect(
        raw.coldRuns.every((run: any) => run.markerFound === true && run.exited === true),
      ).toBe(true);
      expect(raw.coldRuns.every((run: any) => run.readyEvent?.milestone === "renderer-ready")).toBe(
        true,
      );
      // rss 来自 stdout 事件（51200/52224 KiB → 50/51 MB，p50 = 50）
      expect(raw.rssSamples).toEqual([50, 51]);
      expect(raw.rssResult.measurementSource).toBe("native-candidate");
      expect(raw.rssResult.readyEvent.milestone).toBe("renderer-ready");
      expect(raw.rssResult.settleMs).toBe(30000);
      expect(raw.measurementMode).toBe("release");
      expect(raw.samplingProtocol.coldDefinition.length).toBeGreaterThan(0);
      expect(raw.samplingProtocol.warmDefinition.length).toBeGreaterThan(0);
      expect(raw.samplingProtocol.rssSettleDefinition).toContain("30000");
      expect(raw.fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof raw.startedAt).toBe("string");
      expect(typeof raw.finishedAt).toBe("string");
      const summary = JSON.parse(
        readFileSync(join(FIXTURE_DIR, "evidence/release-performance-summary.json"), "utf8"),
      );
      expect(summary.results.rssStableMb).toBe(51);
      expect(summary.results.conditionedColdStartP95Ms).toBeGreaterThan(0);
      // ADR 0006 1.1.0 双指标协议：sessionFirstLaunchMs 记录型指标与
      // cold-conditioning.json 独立 artifact（绑定完整 source/candidate/runner hash）。
      expect(summary.results.sessionFirstLaunchMs).toBeGreaterThan(0);
      const conditioning = JSON.parse(
        readFileSync(join(FIXTURE_DIR, "evidence/cold-conditioning.json"), "utf8"),
      );
      expect(conditioning.evidenceKind).toBe("cold-conditioning");
      expect(conditioning.conditioning.success).toBe(true);
      expect(conditioning.conditioning.markerFound).toBe(true);
      expect(conditioning.conditioning.readyEvent?.milestone).toBe("renderer-ready");
      expect(conditioning.sessionFirstLaunchMs).toBe(summary.results.sessionFirstLaunchMs);
      expect(conditioning.sourceCommit).toBe(raw.sourceCommit);
      expect(conditioning.candidateSha256).toBe(raw.candidateSha256);
      expect(conditioning.runnerSha256).toBe(raw.runnerSha256);
      expect(raw.conditioning.artifactSha256).toBe(
        fileSha256(join(FIXTURE_DIR, "evidence/cold-conditioning.json")),
      );
      expect(raw.conditioning.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(summary.conditioning.artifactSha256).toBe(raw.conditioning.artifactSha256);
      // HOME 隔离目录在采样后清理
      expect(existsSync(join(FIXTURE_DIR, "evidence/perf-homes"))).toBe(false);
    });

    it("PRR-066：rss 事件只声明 2s settleMs 时判 INCOMPLETE（30 秒稳定窗协议）", () => {
      const regPath = createSyntheticRegister("approved");
      const candidateApp = join(FIXTURE_DIR, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp, PERF_PROTOCOL_BIN_SHORT_SETTLE);

      const res = runNode(PERF_RUNNER, [
        "--scope",
        "release",
        "--scope-from",
        regPath,
        "--candidate",
        ".tmp/release-runner-fixtures/bundle/macos/Mind Map.app",
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--samples",
        "20",
        "--skip-canvas",
        "--skip-scenarios",
        "canvas,edit,save,png-export",
      ]);

      expect(res.status).toBe(1);
      expect(res.stdout).toContain("INCOMPLETE");
      const raw = JSON.parse(
        readFileSync(join(FIXTURE_DIR, "evidence/release-performance-raw.json"), "utf8"),
      );
      expect(raw.rssSamples).toEqual([]);
      expect(raw.rssResult.status).toBe("INCOMPLETE");
      expect(raw.rssResult.reason).toContain("settleMs");
      expect(raw.incompleteReasons.some((r: string) => r.includes("settleMs"))).toBe(true);
    });

    it("PRR-066：候选与证据同属 .tmp/prr-066-* 诊断边界时以 diagnostic 模式采样", () => {
      const regPath = createSyntheticRegister("approved");
      const diagDir = join(ROOT, ".tmp/prr-066-runner-test");
      rmSync(diagDir, { recursive: true, force: true });
      const candidateApp = join(diagDir, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp, PERF_PROTOCOL_BIN);

      try {
        const res = runNode(PERF_RUNNER, [
          "--scope",
          "release",
          "--scope-from",
          regPath,
          "--candidate",
          ".tmp/prr-066-runner-test/bundle/macos/Mind Map.app",
          "--evidence-dir",
          ".tmp/prr-066-runner-test/evidence",
          "--diagnostic-preflight",
          "--samples",
          "20",
          "--skip-canvas",
          "--skip-scenarios",
          "canvas,edit,save,png-export",
        ]);

        // canvas 等跳过 → INCOMPLETE，但诊断边界被接受（未因 candidate 不在
        // G2 candidateOutputPaths 而拒绝），rss 正常采集并标记诊断模式
        expect(res.stdout).toContain("INCOMPLETE");
        const raw = JSON.parse(
          readFileSync(join(diagDir, "evidence/release-performance-raw.json"), "utf8"),
        );
        expect(raw.measurementMode).toBe("diagnostic-preflight");
        expect(raw.rssSamples).toEqual([50, 51]);
        expect(raw.rssResult.settleMs).toBe(30000);
        const summary = JSON.parse(
          readFileSync(join(diagDir, "evidence/release-performance-summary.json"), "utf8"),
        );
        expect(summary.measurementMode).toBe("diagnostic-preflight");
      } finally {
        rmSync(diagDir, { recursive: true, force: true });
      }
    });

    it("PRR-066：诊断目录未显式声明 --diagnostic-preflight 时拒绝", () => {
      const regPath = createSyntheticRegister("approved");
      const diagDir = join(ROOT, ".tmp/prr-066-runner-test-no-flag");
      rmSync(diagDir, { recursive: true, force: true });
      const candidateApp = join(diagDir, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      try {
        const res = runNode(PERF_RUNNER, [
          "--scope",
          "release",
          "--scope-from",
          regPath,
          "--candidate",
          ".tmp/prr-066-runner-test-no-flag/bundle/macos/Mind Map.app",
          "--evidence-dir",
          ".tmp/prr-066-runner-test-no-flag/evidence",
          "--samples",
          "20",
        ]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("必须显式传入 --diagnostic-preflight");
      } finally {
        rmSync(diagDir, { recursive: true, force: true });
      }
    });

    it("PRR-066：candidate 在诊断边界而 evidence 在边界外时拒绝（不得混用边界）", () => {
      const regPath = createSyntheticRegister("approved");
      const diagDir = join(ROOT, ".tmp/prr-066-runner-test-mixed");
      rmSync(diagDir, { recursive: true, force: true });
      const candidateApp = join(diagDir, "bundle/macos/Mind Map.app");
      createMockAppBundle(candidateApp);

      try {
        const res = runNode(PERF_RUNNER, [
          "--scope",
          "release",
          "--scope-from",
          regPath,
          "--candidate",
          ".tmp/prr-066-runner-test-mixed/bundle/macos/Mind Map.app",
          "--evidence-dir",
          ".tmp/release-runner-fixtures/evidence",
          "--samples",
          "20",
        ]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("同属 PRR-066 诊断边界");
      } finally {
        rmSync(diagDir, { recursive: true, force: true });
      }
    });
  });

  // ==================== 4. PRR-067 attribution 诊断管线测试 ====================

  /** 完整启动分段 mock：main-entered → setup → renderer-ready（带早期分段）。 */
  const ATTR_FULL_TRACE_BIN = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
emit() { printf '%s\\n' "$1"; }
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"main-entered\\",\\"pid\\":4242,\\"hostElapsedMs\\":1.5,\\"wallClockMs\\":1769000000000}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-started\\",\\"pid\\":4242,\\"hostElapsedMs\\":2.5,\\"wallClockMs\\":1769000000001}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-complete\\",\\"pid\\":4242,\\"hostElapsedMs\\":8.0,\\"wallClockMs\\":1769000000005}"
emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\",\\"data\\":{\\"earlyTiming\\":{\\"jsStartedSinceNavigationMs\\":120.5,\\"loadEventSinceNavigationMs\\":180.2}}}"
exit 0
`;

  describe("run-performance --scope attribution（PRR-067 审阅修正版）", () => {
    const FIXTURE_REPO_DIR = join(FIXTURE_DIR, "prr-067-attribution-repo");

    afterEach(() => {
      try {
        rmSync(FIXTURE_REPO_DIR, { recursive: true, force: true });
      } catch {}
    });

    /** 独立 clean git 仓库 + 诊断候选 + 合成 register（register 在被忽略的 .tmp 内）。 */
    function buildAttributionFixture(binScript: string) {
      const repoDir = createCleanGitRepo("prr-067-attribution-repo");
      const appPath = join(repoDir, ".tmp/prr-067-runner-test/candidate/Mind Map.app");
      createMockAppBundle(appPath, binScript);
      const regPath = createSyntheticRegister("approved", {}, join(repoDir, ".tmp"));
      return {
        repoDir,
        candidateRel: ".tmp/prr-067-runner-test/candidate/Mind Map.app",
        evidenceRel: ".tmp/prr-067-runner-test/evidence",
        regRel: relative(repoDir, regPath),
        repoDirAbs: repoDir,
      };
    }

    function runAttribution(fixture: ReturnType<typeof buildAttributionFixture>, extra: string[]) {
      return runNode(PERF_RUNNER, [
        "--scope",
        "attribution",
        "--root",
        fixture.repoDir,
        "--scope-from",
        fixture.regRel,
        "--candidate",
        fixture.candidateRel,
        "--evidence-dir",
        fixture.evidenceRel,
        ...extra,
      ]);
    }

    function readReport(fixture: ReturnType<typeof buildAttributionFixture>, label: string) {
      return JSON.parse(
        readFileSync(
          join(fixture.repoDir, fixture.evidenceRel, `cold-attribution-report-${label}.json`),
          "utf8",
        ),
      );
    }

    it("worktree 不 clean 时拒绝（必须先形成 clean commit）", () => {
      const fixture = buildAttributionFixture(ATTR_FULL_TRACE_BIN);
      // fixture repo 的 .gitignore 只忽略 .tmp/；根下一个 untracked 文件即可致 dirty
      writeFileSync(join(fixture.repoDir, "zz-dirty-marker.txt"), "dirty");
      const res = runAttribution(fixture, ["--samples", "1"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("clean worktree");
    });

    it("candidate 在边界外且非 G2 正式路径时拒绝；evidence 在边界外也拒绝", () => {
      const fixture = buildAttributionFixture(ATTR_FULL_TRACE_BIN);
      // candidate 合法（prr-067 内）但 evidence 边界外（fixture repo .tmp 下非 prr-067 前缀目录）
      const resEvidence = runNode(PERF_RUNNER, [
        "--scope",
        "attribution",
        "--root",
        fixture.repoDir,
        "--scope-from",
        fixture.regRel,
        "--candidate",
        fixture.candidateRel,
        "--evidence-dir",
        ".tmp/release-runner-fixtures/evidence",
        "--samples",
        "1",
      ]);
      expect(resEvidence.status).toBe(1);
      expect(resEvidence.stderr).toContain("--evidence-dir 必须位于 .tmp/prr-067-*");
      // candidate 既不在 prr-067 内也不是 G2 批准路径 → 拒绝
      const foreignApp = join(fixture.repoDir, ".tmp/other-place/bundle/macos/Mind Map.app");
      createMockAppBundle(foreignApp, ATTR_FULL_TRACE_BIN);
      const resCandidate = runNode(PERF_RUNNER, [
        "--scope",
        "attribution",
        "--root",
        fixture.repoDir,
        "--scope-from",
        fixture.regRel,
        "--candidate",
        ".tmp/other-place/bundle/macos/Mind Map.app",
        "--evidence-dir",
        fixture.evidenceRel,
        "--samples",
        "1",
      ]);
      expect(resCandidate.status).toBe(1);
      expect(resCandidate.stderr).toContain(
        "必须位于 .tmp/prr-067-* 诊断边界或 G2 批准的正式 candidate 原路径",
      );
    });

    it("--conditioning-first 只允许搭配 --home-mode shared", () => {
      const fixture = buildAttributionFixture(ATTR_FULL_TRACE_BIN);
      const res = runAttribution(fixture, [
        "--samples",
        "1",
        "--home-mode",
        "fresh",
        "--conditioning-first",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("--conditioning-first 只允许");
    });

    it("完整分段被采入报告且 exit 0；原始 stdout chunk 带 stream/sequence/receivedAt/text", () => {
      const fixture = buildAttributionFixture(ATTR_FULL_TRACE_BIN);
      const res = runAttribution(fixture, [
        "--samples",
        "3",
        "--home-mode",
        "fresh",
        "--label",
        "full",
      ]);
      expect(res.status).toBe(0);

      const report = readReport(fixture, "full");
      expect(report.measurementMode).toBe("attribution-diagnostic");
      expect(report.segmentationEvidence).toBe(true);
      expect(report.sourceWorktree).toBe("clean");
      expect(report.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(report.runnerSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(report.candidateSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(report.samplingComplete).toBe(true);
      expect(report.validSamples).toBe(3);
      for (const run of report.runs) {
        expect(run.markerFound).toBe(true);
        const trace = run.startupTrace;
        expect(trace.traceValid).toBe(true);
        expect(trace.hostDurations.mainToSetupStartedMs).toBeCloseTo(1.0, 5);
        expect(trace.hostDurations.setupDurationMs).toBeCloseTo(5.5, 5);
        expect(trace.rendererEarlyTiming.jsStartedSinceNavigationMs).toBeCloseTo(120.5, 5);
        // 审阅修正 6：有界原始输出——stdout chunk 必须含协议 JSON 原文与元数据
        const raw = run.rawOutput;
        expect(raw).toBeTruthy();
        expect(raw.capBytesPerStream).toBeGreaterThan(0);
        const stdoutChunks = raw.chunks.filter((chunk: any) => chunk.stream === "stdout");
        expect(stdoutChunks.length).toBeGreaterThan(0);
        let seen = 0;
        for (const chunk of stdoutChunks) {
          expect(Number.isInteger(chunk.sequence)).toBe(true);
          expect(chunk.sequence).toBeGreaterThan(seen);
          seen = chunk.sequence;
          expect(typeof chunk.receivedAt).toBe("number");
          expect(chunk.receivedAt).toBeGreaterThanOrEqual(0);
        }
        const joinedText = stdoutChunks.map((chunk: any) => chunk.text ?? "").join("");
        expect(joinedText).toContain('"milestone":"main-entered"');
        expect(joinedText).toContain('"milestone":"renderer-ready"');
      }
    });

    it("红灯：缺 main-entered 时 exit 1 并提示 --legacy-timing-only（不伪造分段）", () => {
      const partialBin = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
emit() { printf '%s\\n' "$1"; }
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-started\\",\\"pid\\":1,\\"hostElapsedMs\\":1.0,\\"wallClockMs\\":1}"
emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
exit 0
`;
      const fixture = buildAttributionFixture(partialBin);
      const res = runAttribution(fixture, ["--samples", "1", "--label", "missing"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("startupTrace 无效");
      expect(res.stderr).toContain("--legacy-timing-only");
      const report = readReport(fixture, "missing");
      expect(report.runs[0].startupTrace.traceValid).toBe(false);
      expect(report.runs[0].startupTrace.traceIssues).toContain("missing:main-entered");
      expect(report.traceFailureCount).toBe(1);
    });

    it("红灯：里程碑逆序时 exit 1（out-of-order）", () => {
      const reversedBin = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
emit() { printf '%s\\n' "$1"; }
emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"main-entered\\",\\"pid\\":1,\\"hostElapsedMs\\":1.0,\\"wallClockMs\\":1}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-started\\",\\"pid\\":1,\\"hostElapsedMs\\":2.0,\\"wallClockMs\\":2}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-complete\\",\\"pid\\":1,\\"hostElapsedMs\\":3.0,\\"wallClockMs\\":3}"
exit 0
`;
      const fixture = buildAttributionFixture(reversedBin);
      const res = runAttribution(fixture, ["--samples", "1", "--label", "reversed"]);
      expect(res.status).toBe(1);
      const report = readReport(fixture, "reversed");
      expect(report.runs[0].startupTrace.traceValid).toBe(false);
      expect(report.runs[0].startupTrace.traceIssues).toContain("out-of-order:renderer-ready");
    });

    it("红灯：负 hostElapsedMs 时 exit 1（negative-host-elapsed）", () => {
      const negativeBin = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
emit() { printf '%s\\n' "$1"; }
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"main-entered\\",\\"pid\\":1,\\"hostElapsedMs\\":-5.0,\\"wallClockMs\\":1}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-started\\",\\"pid\\":1,\\"hostElapsedMs\\":2.0,\\"wallClockMs\\":2}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-complete\\",\\"pid\\":1,\\"hostElapsedMs\\":3.0,\\"wallClockMs\\":3}"
emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
exit 0
`;
      const fixture = buildAttributionFixture(negativeBin);
      const res = runAttribution(fixture, ["--samples", "1", "--label", "negative"]);
      expect(res.status).toBe(1);
      const report = readReport(fixture, "negative");
      expect(report.runs[0].startupTrace.traceValid).toBe(false);
      expect(report.runs[0].startupTrace.traceIssues).toContain(
        "negative-host-elapsed:main-entered",
      );
    });

    it("foreign runId 的分段事件不计入本样本 trace；本 runId 完整时仍 exit 0", () => {
      const foreignBin = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
emit() { printf '%s\\n' "$1"; }
emit "{\\"runId\\":\\"not-this-run\\",\\"milestone\\":\\"main-entered\\",\\"pid\\":1,\\"hostElapsedMs\\":1.0,\\"wallClockMs\\":1}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"main-entered\\",\\"pid\\":2,\\"hostElapsedMs\\":1.0,\\"wallClockMs\\":10}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-started\\",\\"pid\\":2,\\"hostElapsedMs\\":2.0,\\"wallClockMs\\":11}"
emit "{\\"runId\\":\\"$RID\\",\\"milestone\\":\\"setup-complete\\",\\"pid\\":2,\\"hostElapsedMs\\":3.0,\\"wallClockMs\\":12}"
emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
exit 0
`;
      const fixture = buildAttributionFixture(foreignBin);
      const res = runAttribution(fixture, ["--samples", "1", "--label", "foreign"]);
      expect(res.status).toBe(0);
      const report = readReport(fixture, "foreign");
      const events = report.runs[0].startupTrace.events;
      expect(events).toHaveLength(4);
      const hostEvents = events.filter((event: any) => event.pid !== undefined);
      expect(hostEvents.map((event: any) => event.milestone)).toEqual([
        "main-entered",
        "setup-started",
        "setup-complete",
      ]);
      expect(hostEvents.every((event: any) => event.pid === 2)).toBe(true);
    });

    it("红灯：样本失败时即停并 exit 1（samplingComplete=false，不跳样）", () => {
      const brokenBin = `#!/bin/sh
exit 3
`;
      const fixture = buildAttributionFixture(brokenBin);
      const res = runAttribution(fixture, ["--samples", "3", "--label", "broken"]);
      expect(res.status).toBe(1);
      const report = readReport(fixture, "broken");
      expect(report.samplingComplete).toBe(false);
      expect(report.validSamples).toBe(0);
      expect(report.runs).toHaveLength(1);
    });

    it("红灯：conditioning 失败时立即 exit 1，不产生 measured 样本", () => {
      const brokenBin = `#!/bin/sh
exit 3
`;
      const fixture = buildAttributionFixture(brokenBin);
      const res = runAttribution(fixture, [
        "--samples",
        "2",
        "--home-mode",
        "shared",
        "--conditioning-first",
        "--label",
        "cond-broken",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("conditioning 启动失败");
    });

    it("审阅修正 5：--legacy-timing-only 允许无埋点候选，声明不得用作分段归因证据", () => {
      const legacyBin = `#!/bin/sh
RID="$MINDMAP_PERF_RUN_ID"
emit() { printf '%s\\n' "$1"; }
emit "{\\"runId\\":\\"$RID\\",\\"windowGeneration\\":1,\\"milestone\\":\\"renderer-ready\\"}"
exit 0
`;
      const fixture = buildAttributionFixture(legacyBin);
      const res = runAttribution(fixture, [
        "--samples",
        "2",
        "--home-mode",
        "fresh",
        "--legacy-timing-only",
        "--label",
        "legacy",
      ]);
      expect(res.status).toBe(0);
      const report = readReport(fixture, "legacy");
      expect(report.measurementMode).toBe("attribution-diagnostic-legacy-timing-only");
      expect(report.segmentationEvidence).toBe(false);
      expect(report.legacyTimingOnlyDeclaration).toContain("must never be cited");
      // legacy 模式下 trace 仍如实记录 invalid（missing 里程碑），但不影响 exit
      expect(report.runs[0].startupTrace.traceValid).toBe(false);
      expect(report.traceFailureCount).toBe(2);
      expect(report.samplingComplete).toBe(true);
    });
  });
});

/** PRR-069C：合成 app-only build —— 只写 .app，不产生 DMG（DMG 由 assembler 装配）。 */
function appBuildScript(repoDir: string, extra = "") {
  const app = join(repoDir, ASSEMBLY_APP_REL);
  const plist = JSON.stringify(
    {
      CFBundleIdentifier: "com.mindmap.desktop",
      CFBundleExecutable: "mind-map",
      CFBundleShortVersionString: "0.1.0",
      CFBundleVersion: "0.1.0",
      LSMinimumSystemVersion: "11.0",
    },
    null,
    2,
  );
  return `const fs = require('fs');
    fs.mkdirSync('${join(app, "Contents/MacOS")}', { recursive: true });
    fs.writeFileSync('${join(app, "Contents/Info.plist")}', ${JSON.stringify(plist)});
    fs.writeFileSync('${join(app, "Contents/MacOS/mind-map")}', '#!/bin/sh\\nexit 0\\n');
    ${extra}`;
}

// ==================== 1c. assemble-dmg 测试（PRR-069C） ====================
describe("assemble-dmg (PRR-069C 无 Finder 确定性 DMG 装配)", () => {
  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
    } catch {}
  });

  function setup(name: string) {
    const fixture = createAssemblyFixture(name);
    return fixture;
  }

  const REPORT_REL = ".tmp/release-runner-fixtures/evidence/assembly-report.json";

  it("参数契约：缺 --app/--output/--work-dir/--after/--format 时 fail-closed", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-args-repo");
    const base = [
      "--root",
      repoDir,
      "--scope-from",
      regPath,
      "--tool-dir",
      relative(repoDir, toolDir),
    ];
    const cases: Array<[string[], RegExp]> = [
      [
        [
          "--output",
          ASSEMBLY_DMG_REL,
          "--work-dir",
          ASSEMBLY_WORK_REL,
          "--after",
          "2020-01-01T00:00:00Z",
          "--format",
          "ULMO",
        ],
        /缺少 --app/,
      ],
      [
        [
          "--app",
          ASSEMBLY_APP_REL,
          "--work-dir",
          ASSEMBLY_WORK_REL,
          "--after",
          "2020-01-01T00:00:00Z",
          "--format",
          "ULMO",
        ],
        /缺少 --output/,
      ],
      [
        [
          "--app",
          ASSEMBLY_APP_REL,
          "--output",
          ASSEMBLY_DMG_REL,
          "--after",
          "2020-01-01T00:00:00Z",
          "--format",
          "ULMO",
        ],
        /缺少 --work-dir/,
      ],
      [
        [
          "--app",
          ASSEMBLY_APP_REL,
          "--output",
          ASSEMBLY_DMG_REL,
          "--work-dir",
          ASSEMBLY_WORK_REL,
          "--format",
          "ULMO",
        ],
        /缺少 --after/,
      ],
      [
        [
          "--app",
          ASSEMBLY_APP_REL,
          "--output",
          ASSEMBLY_DMG_REL,
          "--work-dir",
          ASSEMBLY_WORK_REL,
          "--after",
          "2020-01-01T00:00:00Z",
        ],
        /缺少 --format/,
      ],
    ];
    for (const [extra, pattern] of cases) {
      const res = runNode(ASSEMBLE_DMG, [...extra, ...base]);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(pattern);
    }
  });

  it("非 ULMO 目标格式与本地时间冒充 UTC 的 --after 都被拒绝", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-format-repo");
    for (const format of ["UDZO", "udmo", "ulmo"]) {
      const res = runAssembler(repoDir, regPath, toolDir, { format });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("不允许的 DMG 目标格式");
    }
    const res = runAssembler(repoDir, regPath, toolDir, { after: "2026-09-10 12:00:00" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("必须是 UTC ISO");
  });

  it("路径逃逸、work-dir 不在 .tmp/、work-dir 落入候选目录都被拒绝", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-path-repo");
    const escaping = runAssembler(repoDir, regPath, toolDir, { app: "../../evil.app" });
    expect(escaping.status).toBe(1);
    expect(escaping.stderr).toMatch(/路径穿越|越界 repo root/);
    const notTmp = runAssembler(repoDir, regPath, toolDir, { "work-dir": "docs/work" });
    expect(notTmp.status).toBe(1);
    expect(notTmp.stderr).toContain("必须位于仓库内被忽略的 .tmp/ 下");
    const insideCandidate = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/bundle/dmg/work",
    });
    expect(insideCandidate.status).toBe(1);
    expect(insideCandidate.stderr).toContain("不得位于候选产物目录内");
  });

  it("--output/--app 不在 G2 candidateOutputPaths 内时拒绝", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-scope-repo");
    const outOfScope = runAssembler(repoDir, regPath, toolDir, {
      output: ".tmp/release-runner-fixtures/bundle/dmg/Other.dmg",
    });
    expect(outOfScope.status).toBe(1);
    expect(outOfScope.stderr).toMatch(/candidateOutputPaths/);
  });

  it("app 是符号链接 / 内含 .DS_Store / 早于 --after 时 fail-closed", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-app-repo");
    const appAbs = join(repoDir, ASSEMBLY_APP_REL);

    // symlink
    const realApp = join(repoDir, ".tmp/real-app");
    rmSync(appAbs, { recursive: true, force: true });
    createAssemblyApp(realApp);
    mkdirSync(dirname(appAbs), { recursive: true });
    execFileSync("ln", ["-s", realApp, appAbs]);
    const symlinkRes = runAssembler(repoDir, regPath, toolDir);
    expect(symlinkRes.status).toBe(1);
    expect(symlinkRes.stderr).toContain("不能是符号链接");
    rmSync(appAbs, { force: true });

    // .DS_Store inside app
    createAssemblyApp(appAbs);
    writeFileSync(join(appAbs, "Contents/.DS_Store"), "junk");
    const dsRes = runAssembler(repoDir, regPath, toolDir);
    expect(dsRes.status).toBe(1);
    expect(dsRes.stderr).toContain(".DS_Store");
    rmSync(join(appAbs, "Contents/.DS_Store"), { force: true });

    // stale mtime
    const stale = runAssembler(repoDir, regPath, toolDir, { after: "2099-01-01T00:00:00Z" });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("不是本轮构建刷新");
  });

  it("成功路径：输出 ULMO DMG，报告绑定 app/LICENSE/ICNS 与装配命令链", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-ok-repo");
    const res = runAssembler(repoDir, regPath, toolDir, { report: REPORT_REL });
    if (res.status !== 0) console.log("DEBUG-OK>>>", res.stderr.slice(0, 900));
    expect(res.status).toBe(0);
    const report = readAssemblyReport(repoDir);
    expect(report.runner).toBe("assemble-dmg.mjs");
    expect(report.dmgFormat).toBe("ULMO");
    expect(report.output.path).toBe(ASSEMBLY_DMG_REL);
    expect(report.output.sha256).toBe(fileSha256(join(repoDir, ASSEMBLY_DMG_REL)));
    expect(report.inputs.app.path).toBe(ASSEMBLY_APP_REL);
    expect(report.inputs.license.path).toBe("LICENSE");
    expect(report.inputs.license.sha256).toBe(fileSha256(join(repoDir, "LICENSE")));
    expect(report.inputs.icon.path).toBe("apps/desktop/src-tauri/icons/icon.icns");
    expect(report.eula.resourceSha256).toBe(report.eula.licenseSha256);
    expect(report.eula.preMountDisplayVerified).toBe(true);
    expect(report.checks.applicationsTarget).toBe("/Applications");
    expect(report.checks.payloadAppSha256).toBe(report.inputs.app.sha256);
    expect(report.checks.volumeIconSha256).toBe(report.inputs.icon.sha256);
    // 每个命令都有参数数组与显式超时；没有 shell 拼接痕迹
    expect(report.commands.length).toBeGreaterThan(5);
    for (const c of report.commands) {
      expect(Array.isArray(c.args)).toBe(true);
      expect(c.timedOut).toBe(false);
      expect(Number.isSafeInteger(c.timeoutMs)).toBe(true);
    }
    expect(report.commands.some((c: any) => c.tool === "hdiutil" && c.args[0] === "udifrez")).toBe(
      true,
    );
    expect(report.commands.some((c: any) => c.args.includes("Journaled HFS+"))).toBe(true);
    expect(Date.parse(report.finishedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt));
    // 成功路径清理掉本轮 staging
    expect(res.stdout).toContain("assemble-dmg.mjs");
    const workRoot = join(repoDir, ASSEMBLY_WORK_REL);
    expect(!existsSync(workRoot) || readdirSync(workRoot).length === 0).toBe(true);
  });

  it("EULA：未同意时不得挂载；内容 hash 与根 LICENSE 不一致时失败", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-eula-repo");
    // 失败轮会保留 runDir 现场，后续 case 使用独立 work-dir（不复用失败现场目录）。
    const noGate = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "work-dir": `${ASSEMBLY_WORK_REL}-a` },
      { MOCK_NO_EULA_GATE: "1" },
    );
    expect(noGate.status).toBe(1);
    expect(noGate.stderr).toContain("挂载前 EULA 未生效");

    const tampered = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "work-dir": `${ASSEMBLY_WORK_REL}-b` },
      { MOCK_EULA_TAMPER: "1" },
    );
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain("EULA 内容 hash");

    const noEula = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "work-dir": `${ASSEMBLY_WORK_REL}-c` },
      { MOCK_UDIFREZ_NOOP: "1" },
    );
    expect(noEula.status).toBe(1);
    expect(noEula.stderr).toMatch(/未声明挂载前 EULA|挂载前 EULA 未生效/);
  });

  it("卷内容红灯：多余条目 / Applications 非链接 / 卷图标 hash / app payload / 身份字段", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-payload-repo");
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ MOCK_ATTACH_EXTRA: ".DS_Store" }, /卷根条目与预期不符/],
      [{ MOCK_ATTACH_BAD_LINK: "1" }, /Applications (不是符号链接|链接目标不是)/],
      [{ MOCK_ATTACH_BAD_ICON: "1" }, /卷图标 hash 与仓库固定 ICNS 不一致/],
      [{ MOCK_NO_ICON_FLAG: "1" }, /卷图标属性未设置/],
      [
        { MOCK_ATTACH_TAMPER: "1" },
        /身份字段与 app-only build 不一致|目录级 hash 与 app-only build 不一致/,
      ],
    ];
    for (const [idx, [env, pattern]] of cases.entries()) {
      const res = runAssembler(
        repoDir,
        regPath,
        toolDir,
        { "work-dir": `${ASSEMBLY_WORK_REL}-p${idx}` },
        env,
      );
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(pattern);
      // 失败不得把半成品落到批准输出路径
      expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
    }
  });

  it("工具红灯：create/convert/verify/imageinfo/Format/签名 都 fail-closed", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-tool-repo");
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ MOCK_CREATE_FAIL: "1" }, /退出码非零/],
      [{ MOCK_CONVERT_FAIL: "1" }, /退出码非零/],
      [{ MOCK_VERIFY_FAIL: "1" }, /CRC32/],
      [{ MOCK_INFO_FAIL: "1" }, /退出码非零/],
      [{ MOCK_FORMAT: "UDZO" }, /imageinfo 声明 Format=UDZO/],
      [{ MOCK_SIGNED: "1" }, /签名或加密/],
      [{ MOCK_UDIFREZ_FAIL: "1" }, /退出码非零/],
    ];
    for (const [idx, [env, pattern]] of cases.entries()) {
      const res = runAssembler(
        repoDir,
        regPath,
        toolDir,
        { "work-dir": `${ASSEMBLY_WORK_REL}-t${idx}` },
        env,
      );
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(pattern);
    }
  });

  it("detach 失败留下残留挂载时返回非零并保留现场", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-residual-repo");
    const res = runAssembler(repoDir, regPath, toolDir, [], { MOCK_DETACH_FAIL: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/RESIDUAL_MOUNT|挂载未安全解除|退出码|STOP/);
    expect(res.stderr).toContain("assemble-dmg: FAILURE");
    // PRR-069C-R1：detach 非零时登记不被静默清空，mock mount table 保持非空供复算
    expect(
      Object.keys(JSON.parse(readFileSync(join(toolDir, "mock-state.json"), "utf8")).mounts).length,
    ).toBeGreaterThan(0);
  });

  it("体积超预算（>25,000,000B）时 fail-closed", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-budget-repo");
    const res = runAssembler(repoDir, regPath, toolDir, [], { MOCK_BLOATED: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("超过 installer 预算 25000000");
  });

  it("合成 hanging tool 在约定超时内被终止，并输出可复算失败证据", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-timeout-repo");
    const startedMs = Date.now();
    const res = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "timeout-ms": "1500" },
      {
        MOCK_CREATE_HANG: "1",
      },
    );
    const elapsedMs = Date.now() - startedMs;
    expect(res.status).toBe(1);
    expect(elapsedMs).toBeLessThan(30_000);
    expect(res.stderr).toContain("子进程超时");
    const failure = JSON.parse(res.stderr.split("assemble-dmg: FAILURE ")[1].split("\n")[0]);
    expect(failure.status).toBe("failed");
    expect(failure.commands.some((c: any) => c.timedOut === true)).toBe(true);
    expect(failure.commands.find((c: any) => c.timedOut === true).args).toContain("-srcfolder");
    expect(failure.preservedWorkDir).toBe(true);
  });

  it("report 已存在时拒绝覆盖既有证据；report 越出 evidenceOutputPaths 被拒绝", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-report-repo");
    const first = runAssembler(repoDir, regPath, toolDir, { report: REPORT_REL });
    expect(first.status).toBe(0);
    const second = runAssembler(repoDir, regPath, toolDir, { report: REPORT_REL });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("拒绝覆盖既有证据");

    const outside = runAssembler(repoDir, regPath, toolDir, {
      report: "docs/assembly-report.json",
    });
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("不在 G2 批准的 evidenceOutputPaths 内");
  });

  it("worktree 非 clean 时拒绝装配", () => {
    const { repoDir, regPath, toolDir } = setup("assemble-dirty-repo");
    writeFileSync(join(repoDir, "zz-dirty-marker.txt"), "dirty");
    const res = runAssembler(repoDir, regPath, toolDir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("worktree 非 clean");
  });
});

// ==================== 1d. PRR-069C 正式发布路径禁区 ====================
describe("PRR-069C 正式发布路径命令禁区", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  const bundleCommand: string = pkg.scripts["bundle:tauri"];

  /** 去掉注释后扫描，避免把“禁止 Finder”这类说明文字当成真实调用。 */
  function stripComments(source: string) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("bundle:tauri 显式 app-only，并使用受控 assembler 而非 Tauri dmg target", () => {
    expect(bundleCommand).toContain("--bundles app");
    expect(bundleCommand).toContain("--assemble-dmg");
    expect(bundleCommand).toContain("--dmg-format ULMO");
    expect(bundleCommand).toContain("--work-dir");
    expect(bundleCommand).not.toContain("repack");
    const tauriSegment = bundleCommand.split(" -- ").pop() ?? "";
    expect(tauriSegment).toContain("tauri build --bundles app");
    expect(tauriSegment).not.toMatch(/--bundles[= ]+\S*dmg/);
    expect(tauriSegment).not.toMatch(/(^|\s)dmg(\s|$)/);
  });

  it("正式 bundle 命令不含 Finder/AppleScript/CI 绕过与 .DS_Store", () => {
    for (const forbidden of [
      "osascript",
      "AppleScript",
      "--skip-jenkins",
      "--ci",
      ".DS_Store",
      "Finder",
      "skip-jenkins",
    ]) {
      expect(bundleCommand).not.toContain(forbidden);
    }
  });

  it("装配与打包 runner 的代码中不出现 Finder/AppleScript/osascript/CI 绕过调用", () => {
    for (const file of [ASSEMBLE_DMG, BUNDLE_GATE]) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const forbidden of ["osascript", "AppleScript", "--skip-jenkins", "--ci"]) {
        expect(code).not.toContain(forbidden);
      }
      // Finder 只允许作为 FinderInfo（kHasCustomIcon）出现，不允许作为应用程序被调用。
      expect(code).not.toMatch(/(^|[^A-Za-z])Finder([^A-Za-z]|$)/);
      // 不调用 Tauri 的 DMG 美化脚本或 dmg target
      expect(code).not.toContain("bundle_dmg");
      expect(code).not.toMatch(/tauri[^\n]*--bundles[^\n]*dmg/);
    }
  });

  it("禁止读取/复制 .DS_Store：字面量只作为 fail-closed 守卫常量存在", () => {
    const assembler = readFileSync(ASSEMBLE_DMG, "utf8");
    expect(assembler.split('".DS_Store"').length - 1).toBe(1);
    expect(assembler).toContain('const DS_STORE = ".DS_Store"');
    const gate = readFileSync(BUNDLE_GATE, "utf8");
    expect(gate).not.toContain(".DS_Store");
  });

  it("repack-dmg.mjs 保留但标记 superseded，且不再被正式 gate 引用", () => {
    const repack = readFileSync(REPACK_DMG, "utf8");
    expect(repack).toContain("SUPERSEDED");
    expect(readFileSync(BUNDLE_GATE, "utf8")).not.toContain("repack-dmg.mjs");
  });
});

// ==================== 1e. PRR-069C-R1 发布门边界与挂载清理 ====================
// 独立审阅（2026-09-11）四项阻断：测试注入未与正式模式隔离、attach 后未登记/未卸载
// 路径、时间预算可被参数放大、work-dir 越过任务授权范围。以下红灯先于实现建立。
const R1_REPORT_REL = ".tmp/release-runner-fixtures/evidence/assembly-report.json";

describe("PRR-069C-R1 发布门边界与挂载清理加固", () => {
  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
    } catch {}
  });

  /** canonical root（真实仓库）下的 gate 调用：参数契约检查必须先于 G2/git/build。 */
  function runCanonicalGate(extra: string[], command: string[]) {
    return runNode(BUNDLE_GATE, [
      "--host",
      "tauri",
      "--assemble-dmg",
      "--dmg-format",
      "ULMO",
      "--work-dir",
      ".tmp/prr-069c-r1-canary",
      ...extra,
      "--",
      ...command,
    ]);
  }

  const APP_ONLY_COMMAND = [
    "pnpm",
    "--filter",
    "@mindmap/desktop",
    "tauri",
    "build",
    "--bundles",
    "app",
  ];

  it("R1-1 canonical root 传 --assembler-script/--assembler-tool-dir 被拒绝（测试注入不得进入正式模式）", () => {
    for (const extra of [
      ["--assembler-script", ".tmp/fake-assembler.mjs"],
      ["--assembler-tool-dir", ".tmp/mock-tools"],
    ]) {
      const res = runCanonicalGate(extra, APP_ONLY_COMMAND);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("测试注入");
    }
  });

  it("R1-2 canonical root 覆盖 timeout/deadline 被拒绝，即使值更小", () => {
    for (const extra of [
      ["--assembler-timeout-ms", "60000"],
      ["--assembler-deadline-ms", "90000"],
    ]) {
      const res = runCanonicalGate(extra, APP_ONLY_COMMAND);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("测试注入");
    }
  });

  it("R1-3 超过 120000/180000 上限在任何模式都被拒绝（gate 与 assembler 双侧）", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-cap-repo");
    // fixture gate 注入超上限
    for (const extra of [
      ["--assembler-timeout-ms", "200000"],
      ["--assembler-deadline-ms", "200000"],
    ]) {
      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--root",
        repoDir,
        "--scope-from",
        regPath,
        "--candidate-root",
        ".tmp/release-runner-fixtures/bundle",
        "--assemble-dmg",
        "--dmg-format",
        "ULMO",
        "--work-dir",
        ASSEMBLY_WORK_REL,
        "--assembler-tool-dir",
        ".tmp/mock-tools",
        ...extra,
        "--",
        process.execPath,
        "-e",
        appBuildScript(repoDir),
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/120000|180000/);
    }
    // assembler 直接超上限 / 非正数
    for (const overrides of [
      { "timeout-ms": "200000" },
      { "deadline-ms": "999000" },
      { "timeout-ms": "0" },
      { "timeout-ms": "-5" },
      { "timeout-ms": "abc" },
    ]) {
      const res = runAssembler(repoDir, regPath, toolDir, overrides);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/120000|正整数/);
    }
  }, 30000);

  it("R1-4 fixture 注入路径逃逸、绝对路径或指向 canonical 仓库被拒绝", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-inject-repo");
    const gateArgs = (inject: string[]) => [
      "--host",
      "tauri",
      "--root",
      repoDir,
      "--scope-from",
      regPath,
      "--candidate-root",
      ".tmp/release-runner-fixtures/bundle",
      "--assemble-dmg",
      "--dmg-format",
      "ULMO",
      "--work-dir",
      ASSEMBLY_WORK_REL,
      ...inject,
      "--",
      process.execPath,
      "-e",
      appBuildScript(repoDir),
    ];
    // 绝对路径（即使位于 canonical 仓库内）
    const absolute = runNode(
      BUNDLE_GATE,
      gateArgs(["--assembler-tool-dir", join(ROOT, ".tmp/release-runner-fixtures")]),
    );
    expect(absolute.status).toBe(1);
    expect(absolute.stderr).toContain("绝对路径");
    // 路径逃逸
    const escape = runNode(BUNDLE_GATE, gateArgs(["--assembler-tool-dir", "../../evil-tools"]));
    expect(escape.status).toBe(1);
    expect(escape.stderr).toMatch(/路径穿越|越界 repo root/);
    // 指向 canonical 仓库的 tracked source（相对 fixture root 穿越到真实仓库）
    const canonicalRel = relative(repoDir, ROOT);
    const intoCanonical = runNode(
      BUNDLE_GATE,
      gateArgs(["--assembler-tool-dir", `${canonicalRel}/scripts/quality`.split("/").join("/")]),
    );
    expect(intoCanonical.status).toBe(1);
    expect(intoCanonical.stderr).toMatch(/路径穿越|越界 repo root|canonical/);
  });

  it("R1-5 正式 build command 必须精确为 Tauri app-only：fake/默认/dmg/app,dmg/--ci/--skip-jenkins 逐项拒绝", () => {
    for (const command of [
      ["node", "-e", "process.exit(0)"],
      ["sh", "-c", "pnpm --filter @mindmap/desktop tauri build --bundles app"],
      ["pnpm", "--filter", "@mindmap/desktop", "tauri", "build"],
      ["pnpm", "--filter", "@mindmap/desktop", "tauri", "build", "--bundles", "dmg"],
      ["pnpm", "--filter", "@mindmap/desktop", "tauri", "build", "--bundles", "app,dmg"],
      ["pnpm", "--filter", "@mindmap/desktop", "tauri", "build", "--bundles", "app", "--ci"],
      [
        "pnpm",
        "--filter",
        "@mindmap/desktop",
        "tauri",
        "build",
        "--bundles",
        "app",
        "--skip-jenkins",
      ],
    ]) {
      const res = runCanonicalGate([], command);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("app-only");
    }
  });

  it("R1-6 work-dir 白名单：.tmp 根、普通 .tmp/work、release-candidate、空后缀、evidence 子树、symlink、预存非空逐项拒绝", () => {
    // canonical（正式白名单）
    for (const bad of [
      ".tmp/work",
      ".tmp/release-candidate/prr-069c-r1-x",
      ".tmp/prr-069c-",
      ".tmp",
    ]) {
      const res = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--assemble-dmg",
        "--dmg-format",
        "ULMO",
        "--work-dir",
        bad,
        "--",
        ...APP_ONLY_COMMAND,
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("prr-069c");
    }
    // fixture（通用规则：evidence 子树 / symlink / 预存非空）
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-workdir-repo");
    const inEvidence = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/evidence/work",
    });
    expect(inEvidence.status).toBe(1);
    expect(inEvidence.stderr).toContain("evidence");

    const realDir = join(repoDir, ".tmp/real-work-target");
    mkdirSync(realDir, { recursive: true });
    const linkPath = join(repoDir, ".tmp/release-runner-fixtures/work-link");
    execFileSync("ln", ["-s", realDir, linkPath]);
    const symlink = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/work-link",
    });
    expect(symlink.status).toBe(1);
    expect(symlink.stderr).toMatch(/symlink|符号链接|不是常规空目录/);

    const presetDir = join(repoDir, ".tmp/release-runner-fixtures/work-preset");
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(join(presetDir, "foreign.txt"), "pre-existing alien content");
    const preset = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/work-preset",
    });
    expect(preset.status).toBe(1);
    expect(preset.stderr).toMatch(/非空|预存外来目标/);
    expect(readFileSync(join(presetDir, "foreign.txt"), "utf8")).toBe("pre-existing alien content");
  });

  it("R1-7 EULA 拒绝探针意外挂载成功：先登记、受控卸载、复核表空，然后整体失败", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-eula-mount-repo");
    const res = runAssembler(repoDir, regPath, toolDir, [], { MOCK_NO_EULA_GATE: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("挂载前 EULA 未生效");
    expect(res.stderr).toContain("已受控卸载");
    expect(readMockMounts(toolDir)).toEqual({});
  });

  it("R1-8 attach 返回 0 但 stdout 不可解析：从 mount table 恢复登记并完成整轮清理", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-unparsable-repo");
    const res = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { report: R1_REPORT_REL },
      {
        MOCK_ATTACH_UNPARSABLE: "1",
      },
    );
    expect(res.status).toBe(0);
    const report = readAssemblyReport(repoDir, R1_REPORT_REL);
    // 恢复事实进入命令日志（可审计），最终 mount table 为空
    expect(report.commands.some((c: any) => c.recoveredFromMountTable === true)).toBe(true);
    expect(readMockMounts(toolDir)).toEqual({});
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(true);
  });

  it("R1-9 attach 不可解析且 mount table 查询失败：STOP，不得报告已清理", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-unparsable-stop-repo");
    const res = runAssembler(repoDir, regPath, toolDir, [], {
      MOCK_ATTACH_UNPARSABLE: "1",
      MOCK_MOUNT_FAIL: "1",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("mount table 不可用");
    expect(res.stderr).toContain("STOP");
    // 未登记也未清理，mock 表保留真实状态供复算
    expect(Object.keys(readMockMounts(toolDir) ?? {}).length).toBeGreaterThan(0);
  });

  it("R1-10 cleanup detach 非零：RESIDUAL_MOUNT，登记不被静默清空，mock 表保持非空供复算", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-residual-repo");
    // 第 2 次 detach 起失败：rw 卸载正常完成，只读复核卷在 payload 失败后的
    // 清理 detach 中失败（覆盖"成功 attach 后失败清理"路径）。
    const res = runAssembler(repoDir, regPath, toolDir, [], {
      MOCK_ATTACH_BAD_ICON: "1",
      MOCK_DETACH_FAIL_ON: "2",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("RESIDUAL_MOUNT");
    const failure = JSON.parse(res.stderr.split("assemble-dmg: FAILURE ")[1].split("\n")[0]);
    expect(failure.residualMount).toBeTruthy();
    expect(failure.activeMount?.mountpoint).toContain("mnt-final");
    expect(Object.keys(readMockMounts(toolDir)).length).toBeGreaterThan(0);
  });

  it("R1-11 detach 返回 0 但 mount table 仍有条目：失败并保留残留证据", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-detach-lie-repo");
    const res = runAssembler(repoDir, regPath, toolDir, [], { MOCK_DETACH_LIE: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("RESIDUAL_MOUNT");
    const failure = JSON.parse(res.stderr.split("assemble-dmg: FAILURE ")[1].split("\n")[0]);
    expect(failure.residualMount).toBeTruthy();
    expect(Object.keys(readMockMounts(toolDir)).length).toBeGreaterThan(0);
  });

  it("R1-12 mount 查询非零/超时：不得把空 stdout 解释为无残留", () => {
    const failRepo = createAssemblyFixture("r1-mount-fail-repo");
    const failed = runAssembler(failRepo.repoDir, failRepo.regPath, failRepo.toolDir, [], {
      MOCK_MOUNT_FAIL: "1",
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("mount table 不可用");

    const hangRepo = createAssemblyFixture("r1-mount-hang-repo");
    const startedMs = Date.now();
    const hung = runAssembler(
      hangRepo.repoDir,
      hangRepo.regPath,
      hangRepo.toolDir,
      { "timeout-ms": "1500" },
      { MOCK_MOUNT_HANG: "1" },
    );
    expect(hung.status).toBe(1);
    expect(Date.now() - startedMs).toBeLessThan(20_000);
    expect(hung.stderr).toContain("mount table 不可用");
  }, 30000);

  it("R1-13 正常路径 detach 后 mount table 为空，报告绑定固定工具清单与阈值", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r1-normal-tools-repo");
    const res = runAssembler(repoDir, regPath, toolDir, { report: R1_REPORT_REL });
    expect(res.status).toBe(0);
    expect(readMockMounts(toolDir)).toEqual({});
    const report = readAssemblyReport(repoDir);
    expect(Object.keys(report.tools).sort()).toEqual(
      ["SetFile", "ditto", "hdiutil", "lipo", "mount", "plutil", "xattr"].sort(),
    );
    for (const entry of Object.values<any>(report.tools)) {
      expect(typeof entry.path).toBe("string");
      expect(entry.path).toContain("mock-tools");
      expect(/^[a-f0-9]{64}$/.test(entry.sha256)).toBe(true);
    }
    expect(report.timeoutMs).toBeLessThanOrEqual(120000);
    expect(report.deadlineMs).toBeLessThanOrEqual(180000);
  });

  it("R1-14 canonical assembler：--tool-dir、显式阈值覆盖与非白名单 work-dir 被拒绝", () => {
    const base = [
      "--app",
      ASSEMBLY_APP_REL,
      "--output",
      ASSEMBLY_DMG_REL,
      "--after",
      "2020-01-01T00:00:00Z",
      "--format",
      "ULMO",
    ];
    const toolDirRes = runNode(ASSEMBLE_DMG, [
      ...base,
      "--work-dir",
      ".tmp/prr-069c-r1-canary",
      "--tool-dir",
      ".tmp/x",
    ]);
    expect(toolDirRes.status).toBe(1);
    expect(toolDirRes.stderr).toContain("测试注入");

    const timeoutRes = runNode(ASSEMBLE_DMG, [
      ...base,
      "--work-dir",
      ".tmp/prr-069c-r1-canary",
      "--timeout-ms",
      "60000",
    ]);
    expect(timeoutRes.status).toBe(1);
    expect(timeoutRes.stderr).toMatch(/禁止覆盖|固定/);

    const workDirRes = runNode(ASSEMBLE_DMG, [...base, "--work-dir", ".tmp/work"]);
    expect(workDirRes.status).toBe(1);
    expect(workDirRes.stderr).toContain(".tmp/prr-069c-");
  });

  it("R1-15 gate 拒绝报告中超上限的时间阈值（fixture 伪造报告也拦下）", () => {
    const { repoDir, regPath } = createAssemblyFixture("r1-fake-threshold-repo");
    const fakeAssembler = join(repoDir, ".tmp/fake-threshold-assembler.mjs");
    writeFileSync(
      fakeAssembler,
      `import { mkdirSync, writeFileSync } from "node:fs";
       console.log(JSON.stringify({
         runner: "assemble-dmg.mjs",
         runnerSha256: "${"a".repeat(64)}",
         startedAt: new Date().toISOString(),
         finishedAt: new Date().toISOString(),
         timeoutMs: 200000,
         deadlineMs: 200000,
         commands: [{ tool: "hdiutil", args: [], timedOut: false }],
       }));\n`,
    );
    const res = runNode(BUNDLE_GATE, [
      "--host",
      "tauri",
      "--root",
      repoDir,
      "--scope-from",
      regPath,
      "--candidate-root",
      ".tmp/release-runner-fixtures/bundle",
      "--assemble-dmg",
      "--dmg-format",
      "ULMO",
      "--work-dir",
      ASSEMBLY_WORK_REL,
      "--assembler-script",
      ".tmp/fake-threshold-assembler.mjs",
      "--",
      process.execPath,
      "-e",
      appBuildScript(repoDir),
    ]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/120000|时间阈值/);
  });

  /** 读取 mock 工具链的 mount table 状态（残留断言用）。 */
  function readMockMounts(toolDir: string): Record<string, any> | null {
    const p = join(toolDir, "mock-state.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")).mounts ?? {};
  }
});

// ==================== 1f. PRR-069C-R2 attach 接管与路径隔离 ====================
// R1 独立审阅（2026-09-11）四项阻断：attach 已挂载后超时/非零无人接管、
// 直接 assembler 绕过 fixture 工具合同并回退真实系统工具、中间层 symlink
// 绕过 work-dir 隔离、DMG 常量进入通用授权模块。以下红灯先于实现建立。
const DMG_ASSEMBLY_CONTRACT = resolve(ROOT, "scripts/quality/dmg-assembly-contract.mjs");
const G2_SCOPE = resolve(ROOT, "scripts/quality/g2-scope.mjs");
const CANONICAL_ASM_BASE = [
  "--app",
  ASSEMBLY_APP_REL,
  "--output",
  ASSEMBLY_DMG_REL,
  "--after",
  "2020-01-01T00:00:00Z",
  "--format",
  "ULMO",
];
/** 正式 app-only 窄命令（canonical root 的 gate 调用需要精确匹配）。 */
const R2_APP_ONLY_COMMAND = [
  "pnpm",
  "--filter",
  "@mindmap/desktop",
  "tauri",
  "build",
  "--bundles",
  "app",
];

describe("PRR-069C-R2 attach 接管、注入闭合与路径隔离", () => {
  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
    } catch {}
  });

  function mockState(toolDir: string): any {
    const p = join(toolDir, "mock-state.json");
    if (!existsSync(p)) return { mounts: {}, calls: [] };
    return JSON.parse(readFileSync(p, "utf8"));
  }
  function readMockMounts(toolDir: string): Record<string, any> {
    return mockState(toolDir).mounts ?? {};
  }
  function readMockCalls(toolDir: string): Array<{ tool: string; args: string[] }> {
    return mockState(toolDir).calls ?? [];
  }
  /** 解析失败记录：断言结构化字段而不只看日志字符串。 */
  function readFailure(stderr: string): any {
    const marker = "assemble-dmg: FAILURE ";
    expect(stderr).toContain(marker);
    return JSON.parse(stderr.split(marker)[1].split("\n")[0]);
  }

  // ---------------------------------------------------------------- R2-01
  it("R2-01a 可写卷 attach 已挂载后超时：接管为 active mount、受控卸载、表内无残留、整体失败", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-attach-hang-rw");
    const res = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "timeout-ms": "1500" },
      {
        MOCK_ATTACH_HANG_AFTER_MOUNT: "rw",
      },
    );
    expect(res.status).toBe(1);
    // 缺陷证据优先：未接管时本轮挂载会留在 mock mount table 中
    expect(readMockMounts(toolDir)).toEqual({});
    const failure = readFailure(res.stderr);
    // 先接管再卸载：不得把超时转成成功，也不得把未登记挂载留在表内
    expect(failure.mountState).toBe("CLEAN");
    expect(failure.residualMount).toBeFalsy();
    expect(failure.activeMount).toBeFalsy();
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
    // 卸载动作在失败清理宽限预算内完成（不占用装配 deadline）
    expect(failure.cleanup?.status).toBe("CLEAN");
  }, 30000);

  it("R2-01b 可写卷 attach 已挂载后非零退出：受控卸载后整体失败", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-attach-fail-rw");
    const res = runAssembler(repoDir, regPath, toolDir, [], {
      MOCK_ATTACH_FAIL_AFTER_MOUNT: "rw",
    });
    expect(res.status).toBe(1);
    expect(readMockMounts(toolDir)).toEqual({});
    const failure = readFailure(res.stderr);
    expect(failure.mountState).toBe("CLEAN");
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
  }, 30000);

  it("R2-01c 最终只读卷 attach 已挂载后超时：不得转成成功，卸载后失败", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-attach-hang-final");
    const res = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "timeout-ms": "1500" },
      {
        MOCK_ATTACH_HANG_AFTER_MOUNT: "final",
      },
    );
    expect(res.status).toBe(1);
    expect(readMockMounts(toolDir)).toEqual({});
    const failure = readFailure(res.stderr);
    expect(failure.mountState).toBe("CLEAN");
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
  }, 30000);

  it("R2-01d 最终只读卷 attach 已挂载后非零退出：受控卸载后失败", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-attach-fail-final");
    const res = runAssembler(repoDir, regPath, toolDir, [], {
      MOCK_ATTACH_FAIL_AFTER_MOUNT: "final",
    });
    expect(res.status).toBe(1);
    expect(readMockMounts(toolDir)).toEqual({});
    const failure = readFailure(res.stderr);
    expect(failure.mountState).toBe("CLEAN");
  }, 30000);

  it("R2-01e attach spawn error：受控失败、错误分类进命令日志、无残留无成功产物", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-attach-spawn-error");
    const res = runAssembler(repoDir, regPath, toolDir, [], {
      MOCK_HIDE_TOOL_AFTER_CREATE: "1",
    });
    expect(res.status).toBe(1);
    const failure = readFailure(res.stderr);
    const attachCall = failure.commands.find(
      (c: any) => c.tool === "hdiutil" && c.args[0] === "attach",
    );
    expect(attachCall).toBeTruthy();
    expect(String(attachCall.spawnError ?? "")).toMatch(/ENOENT|no such file/i);
    expect(attachCall.status).toBeNull();
    expect(readMockMounts(toolDir)).toEqual({});
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
  }, 30000);

  it("R2-01f EULA 拒绝探针已挂载但错误返回：清理后失败，不得留下挂载", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-eula-fail-after-mount");
    const res = runAssembler(repoDir, regPath, toolDir, [], {
      MOCK_NO_EULA_GATE: "1",
      MOCK_ATTACH_FAIL_AFTER_MOUNT: "probe",
    });
    expect(res.status).toBe(1);
    expect(readMockMounts(toolDir)).toEqual({});
    expect(res.stderr).toContain("挂载前 EULA 未生效");
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
  }, 30000);

  it("R2-01g EULA 拒绝探针已挂载后超时：清理后失败", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-eula-hang-after-mount");
    const res = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "timeout-ms": "1500" },
      {
        MOCK_NO_EULA_GATE: "1",
        MOCK_ATTACH_HANG_AFTER_MOUNT: "probe",
      },
    );
    expect(res.status).toBe(1);
    expect(readMockMounts(toolDir)).toEqual({});
    expect(res.stderr).toContain("挂载前 EULA 未生效");
  }, 30000);

  it("R2-01h attach 失败且 mount table 不可用：UNKNOWN + 保留 pending，不宣称已清理", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-attach-unknown");
    const res = runAssembler(repoDir, regPath, toolDir, [], {
      MOCK_ATTACH_FAIL_AFTER_MOUNT: "rw",
      MOCK_MOUNT_FAIL: "1",
    });
    expect(res.status).toBe(1);
    const failure = readFailure(res.stderr);
    expect(failure.mountState).toBe("UNKNOWN");
    expect(failure.pendingMount?.mountpoint).toBeTruthy();
    expect(failure.residualMount).toBeTruthy();
    expect(failure.cleanup?.status).not.toBe("CLEAN");
    // 不得输出成功 inventory / 已清理结论
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
    expect(res.stderr).toContain("STOP");
  }, 30000);

  it("R2-01i 成功但 stdout 无法解析：从 mount table 恢复登记并完成整轮（保留 R1 断言）", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-attach-unparsable");
    const res = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { report: R1_REPORT_REL },
      {
        MOCK_ATTACH_UNPARSABLE: "1",
      },
    );
    expect(res.status).toBe(0);
    expect(readMockMounts(toolDir)).toEqual({});
    const report = JSON.parse(readFileSync(join(repoDir, R1_REPORT_REL), "utf8"));
    expect(report.commands.some((c: any) => c.recoveredFromMountTable === true)).toBe(true);
  }, 30000);

  it("R2-01j 清理宽限独立计时且有界：不参与装配预算，失败轮不产出成功 inventory", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-cleanup-grace");
    const hung = runAssembler(
      repoDir,
      regPath,
      toolDir,
      { "timeout-ms": "1500" },
      {
        MOCK_ATTACH_HANG_AFTER_MOUNT: "rw",
      },
    );
    expect(hung.status).toBe(1);
    const failure = readFailure(hung.stderr);
    expect(Number.isSafeInteger(failure.cleanup?.graceMs)).toBe(true);
    expect(failure.cleanup.graceMs).toBeGreaterThan(0);
    expect(failure.cleanup.graceMs).toBeLessThanOrEqual(120000);
    expect(Number.isSafeInteger(failure.cleanup?.elapsedMs)).toBe(true);
    // 清理宽限不顶替也不放宽装配预算：失败记录仍声明本轮有效的装配阈值
    expect(failure.timeoutMs).toBe(1500);
    expect(failure.deadlineMs).toBe(20000);
    expect(failure.cleanup.graceMs).not.toBe(failure.timeoutMs);
    // 成功路径报告同样声明清理宽限与两段耗时，装配耗时不包含清理
    const ok = createAssemblyFixture("r2-cleanup-grace-ok");
    const res = runAssembler(ok.repoDir, ok.regPath, ok.toolDir, { report: R1_REPORT_REL });
    expect(res.status).toBe(0);
    const report = JSON.parse(readFileSync(join(ok.repoDir, R1_REPORT_REL), "utf8"));
    expect(report.timings?.cleanupGraceMs).toBeGreaterThan(0);
    expect(report.timings?.assemblyMs).toBe(report.elapsedMs);
    // 成功路径没有清理动作，清理段耗时恒为 0
    expect(report.timings?.cleanupMs).toBe(0);
    expect(report.cleanupGraceMs ?? report.timings.cleanupGraceMs).toBeLessThanOrEqual(180000);
  }, 60000);

  it("R2-01l 卸载前设备身份不符：拒绝卸载、保留 RESIDUAL 与挂载现场", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-detach-identity");
    const res = runAssembler(repoDir, regPath, toolDir, [], { MOCK_SETFILE_SWAP_DEVICE: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("设备与预期不一致");
    const failure = readFailure(res.stderr);
    expect(failure.mountState).toBe("RESIDUAL");
    expect(failure.residualMount).toBeTruthy();
    // 身份不符时不得执行卸载：mock mount table 保留原挂载供人工复核
    expect(Object.keys(readMockMounts(toolDir)).length).toBeGreaterThan(0);
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
  }, 30000);

  it("R2-01k attach 返回 0 却没有挂载：三个阶段的矛盾状态都必须失败并保留现场", () => {
    for (const stage of ["rw", "probe", "final"]) {
      const { repoDir, regPath, toolDir } = createAssemblyFixture(`r2-attach-fake-ok-${stage}`);
      // probe 阶段必须先绕过挂载前 EULA 门，否则会被正常拒绝而不是命中矛盾注入。
      const env =
        stage === "probe"
          ? { MOCK_NO_EULA_GATE: "1", MOCK_ATTACH_FAKE_SUCCESS: stage }
          : { MOCK_ATTACH_FAKE_SUCCESS: stage };
      const res = runAssembler(repoDir, regPath, toolDir, {}, env);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("无法确认挂载状态");
      expect(readMockMounts(toolDir)).toEqual({});
      expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
    }
  }, 60000);

  // ---------------------------------------------------------------- R2-02
  it("R2-02a 直接 assembler 拒绝绝对 --tool-dir（不得绕过 fixture 工具合同）", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-inject-absolute");
    const res = runAssembler(repoDir, regPath, toolDir, { "tool-dir": toolDir });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/绝对|注入/);
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
  }, 30000);

  it("R2-02b tool-dir 缺项：任何工具调用前失败，绝不回退真实系统工具", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-inject-missing");
    rmSync(join(toolDir, "ditto"), { force: true });
    const res = runAssembler(repoDir, regPath, toolDir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/ditto/);
    // 无任何工具被调用（既没有注入替身，也没有真实 /usr/bin/ditto）
    expect(readMockCalls(toolDir)).toEqual([]);
    expect(existsSync(join(repoDir, ASSEMBLY_DMG_REL))).toBe(false);
  }, 30000);

  it("R2-02c 注入工具为 symlink 或悬空断链：拒绝", () => {
    const sym = createAssemblyFixture("r2-inject-symlink");
    const realTool = join(sym.toolDir, "plutil");
    execFileSync("mv", [realTool, join(sym.toolDir, "plutil.real")]);
    execFileSync("ln", ["-s", join(sym.toolDir, "plutil.real"), realTool]);
    const symRes = runAssembler(sym.repoDir, sym.regPath, sym.toolDir);
    expect(symRes.status).toBe(1);
    expect(symRes.stderr).toMatch(/symlink|符号链接|工具注入/);
    expect(readMockCalls(sym.toolDir)).toEqual([]);

    const dangling = createAssemblyFixture("r2-inject-dangling");
    rmSync(join(dangling.toolDir, "lipo"), { force: true });
    execFileSync("ln", [
      "-s",
      join(dangling.toolDir, "missing-lipo"),
      join(dangling.toolDir, "lipo"),
    ]);
    const danglingRes = runAssembler(dangling.repoDir, dangling.regPath, dangling.toolDir);
    expect(danglingRes.status).toBe(1);
    expect(danglingRes.stderr).toMatch(/symlink|符号链接|工具注入/);
    expect(readMockCalls(dangling.toolDir)).toEqual([]);
  }, 30000);

  it("R2-02d 注入工具非可执行或类型错误：拒绝且无任何工具调用", () => {
    const nonExec = createAssemblyFixture("r2-inject-nonexec");
    chmodSync(join(nonExec.toolDir, "xattr"), 0o644);
    const nonExecRes = runAssembler(nonExec.repoDir, nonExec.regPath, nonExec.toolDir);
    expect(nonExecRes.status).toBe(1);
    expect(nonExecRes.stderr).toMatch(/可执行|工具注入/);
    expect(readMockCalls(nonExec.toolDir)).toEqual([]);

    const wrongType = createAssemblyFixture("r2-inject-dirtype");
    rmSync(join(wrongType.toolDir, "mount"), { force: true });
    mkdirSync(join(wrongType.toolDir, "mount"), { recursive: true });
    const wrongTypeRes = runAssembler(wrongType.repoDir, wrongType.regPath, wrongType.toolDir);
    expect(wrongTypeRes.status).toBe(1);
    expect(wrongTypeRes.stderr).toMatch(/常规文件|工具注入/);
    expect(readMockCalls(wrongType.toolDir)).toEqual([]);
  }, 30000);

  it("R2-02e gate 入口同样验证 tool-dir 完整：build 之前 BLOCKED", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-gate-inject-missing");
    rmSync(join(toolDir, "ditto"), { force: true });
    const buildMarker = join(repoDir, ".tmp/build-ran.txt");
    const res = runNode(BUNDLE_GATE, [
      "--host",
      "tauri",
      "--root",
      repoDir,
      "--scope-from",
      regPath,
      "--candidate-root",
      ".tmp/release-runner-fixtures/bundle",
      "--assemble-dmg",
      "--dmg-format",
      "ULMO",
      "--work-dir",
      ASSEMBLY_WORK_REL,
      "--assembler-tool-dir",
      ".tmp/mock-tools",
      "--",
      process.execPath,
      "-e",
      appBuildScript(repoDir, `fs.writeFileSync('${buildMarker}', 'ran');`),
    ]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/工具|ditto|注入/);
    expect(existsSync(buildMarker)).toBe(false);
  }, 30000);

  it("R2-02f 合法完整 fixture 仍通过，且七项工具全部来自注入目录", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-inject-complete");
    const res = runAssembler(repoDir, regPath, toolDir, { report: R1_REPORT_REL });
    expect(res.status).toBe(0);
    const calls = readMockCalls(toolDir).map((c) => c.tool);
    for (const tool of ["hdiutil", "ditto", "SetFile", "mount", "plutil", "lipo", "xattr"]) {
      expect(calls).toContain(tool);
    }
    const report = JSON.parse(readFileSync(join(repoDir, R1_REPORT_REL), "utf8"));
    for (const entry of Object.values<any>(report.tools)) {
      expect(entry.path).toContain("mock-tools");
    }
  }, 30000);

  // ---------------------------------------------------------------- R2-03
  it("R2-03a work-dir 中间层 symlink 指向 evidence/candidate/其他任务目录：全部拒绝", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-workdir-alias");
    const links: Array<[string, string]> = [
      [".tmp/release-runner-fixtures/evidence", "alias-evidence"],
      [".tmp/release-runner-fixtures/bundle", "alias-candidate"],
      [".tmp/other-task-dir", "alias-other-task"],
    ];
    for (const [target, linkName] of links) {
      mkdirSync(join(repoDir, target), { recursive: true });
      const linkPath = join(repoDir, ".tmp/release-runner-fixtures", linkName);
      rmSync(linkPath, { force: true });
      execFileSync("ln", ["-s", join(repoDir, target), linkPath]);
      const res = runAssembler(repoDir, regPath, toolDir, {
        "work-dir": `.tmp/release-runner-fixtures/${linkName}/work`,
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/符号链接|symlink/);
      expect(readMockCalls(toolDir)).toEqual([]);
      // 借道目录不得被写入
      expect(existsSync(join(repoDir, target, "work"))).toBe(false);
    }
  }, 30000);

  it("R2-03b work-dir 末级与悬空 symlink：拒绝", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-workdir-symlink");
    const realDir = join(repoDir, ".tmp/real-work-target");
    mkdirSync(realDir, { recursive: true });
    const finalLink = join(repoDir, ".tmp/release-runner-fixtures/work-final-link");
    execFileSync("ln", ["-s", realDir, finalLink]);
    const finalRes = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/work-final-link",
    });
    expect(finalRes.status).toBe(1);
    expect(finalRes.stderr).toMatch(/符号链接|symlink/);

    const danglingLink = join(repoDir, ".tmp/release-runner-fixtures/work-dangling-link");
    execFileSync("ln", ["-s", join(repoDir, ".tmp/never-created"), danglingLink]);
    const danglingRes = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/work-dangling-link/work",
    });
    expect(danglingRes.status).toBe(1);
    expect(danglingRes.stderr).toMatch(/符号链接|symlink/);
    expect(readMockCalls(toolDir)).toEqual([]);
  }, 30000);

  it("R2-03c work-dir 指向仓库外：拒绝", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-workdir-escape");
    const escapeLink = join(repoDir, ".tmp/release-runner-fixtures/work-escape-link");
    execFileSync("ln", ["-s", "/tmp", escapeLink]);
    const res = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/work-escape-link/work",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/符号链接|symlink|越界/);
    expect(readMockCalls(toolDir)).toEqual([]);
  }, 30000);

  it("R2-03d 历史 attempt 的新子目录与既有空 work：双侧拒绝，历史文件不变", () => {
    const attempt = `.tmp/prr-069c-r2-test-historical-${process.pid.toString(36)}`;
    const attemptAbs = join(ROOT, attempt);
    rmSync(attemptAbs, { recursive: true, force: true });
    mkdirSync(join(attemptAbs, "work"), { recursive: true });
    const logPath = join(attemptAbs, "bundle-gate.log");
    writeFileSync(logPath, "historical attempt evidence\n");
    const logShaBefore = fileSha256(logPath);
    try {
      // 直接 assembler（canonical root）
      for (const workDir of [`${attempt}/borrowed-work`, `${attempt}/work`]) {
        const res = runNode(ASSEMBLE_DMG, [...CANONICAL_ASM_BASE, "--work-dir", workDir]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("work-dir");
      }
      // gate（canonical root）
      const gateRes = runNode(BUNDLE_GATE, [
        "--host",
        "tauri",
        "--assemble-dmg",
        "--dmg-format",
        "ULMO",
        "--work-dir",
        `${attempt}/borrowed-work`,
        "--",
        ...R2_APP_ONLY_COMMAND,
      ]);
      expect(gateRes.status).toBe(1);
      expect(gateRes.stderr).toContain("work-dir");
      // 历史现场未被写入
      expect(fileSha256(logPath)).toBe(logShaBefore);
      expect(readdirSync(attemptAbs).sort()).toEqual(["bundle-gate.log", "work"]);
    } finally {
      rmSync(attemptAbs, { recursive: true, force: true });
    }
  }, 30000);

  it("R2-03e work-dir 拒绝发生在任何 mkdir/tool/build 之前", () => {
    const { repoDir, regPath, toolDir } = createAssemblyFixture("r2-workdir-early");
    execFileSync("ln", [
      "-s",
      join(repoDir, ".tmp/release-runner-fixtures/evidence"),
      join(repoDir, ".tmp/release-runner-fixtures/alias-early"),
    ]);
    const res = runAssembler(repoDir, regPath, toolDir, {
      "work-dir": ".tmp/release-runner-fixtures/alias-early/work",
    });
    expect(res.status).toBe(1);
    expect(readMockCalls(toolDir)).toEqual([]);
    expect(existsSync(join(repoDir, ".tmp/release-runner-fixtures/evidence/work"))).toBe(false);
    // gate 侧同样在任何 build 之前失败
    const buildMarker = join(repoDir, ".tmp/build-ran-early.txt");
    const gateRes = runNode(BUNDLE_GATE, [
      "--host",
      "tauri",
      "--root",
      repoDir,
      "--scope-from",
      regPath,
      "--candidate-root",
      ".tmp/release-runner-fixtures/bundle",
      "--assemble-dmg",
      "--dmg-format",
      "ULMO",
      "--work-dir",
      ".tmp/release-runner-fixtures/alias-early/work",
      "--",
      process.execPath,
      "-e",
      appBuildScript(repoDir, `fs.writeFileSync('${buildMarker}', 'ran');`),
    ]);
    expect(gateRes.status).toBe(1);
    expect(existsSync(buildMarker)).toBe(false);
  }, 30000);

  // ---------------------------------------------------------------- R2-04
  it("R2-04 固定工具常量移出通用授权模块，两入口改从 DMG 专用模块引用", () => {
    const g2 = readFileSync(G2_SCOPE, "utf8");
    expect(g2).not.toContain("SYSTEM_TOOL_PATHS");
    // 授权与路径通用契约保持原样
    expect(g2).toContain("export function loadAndValidateG2Scope");
    expect(g2).toContain("export function validateSafePath");
    expect(g2).toContain("export const FORBIDDEN_EXCLUDED_ACTIONS");
    expect(g2).toContain("export const SIGNING_ENV_KEYS");

    const contract = readFileSync(DMG_ASSEMBLY_CONTRACT, "utf8");
    expect(contract).toContain("SYSTEM_TOOL_PATHS");
    for (const tool of ["hdiutil", "ditto", "SetFile", "mount", "plutil", "lipo", "xattr"]) {
      expect(contract).toContain(tool);
    }
    for (const entry of [ASSEMBLE_DMG, BUNDLE_GATE]) {
      const src = readFileSync(entry, "utf8");
      expect(src).toContain('from "./dmg-assembly-contract.mjs"');
      expect(src).not.toMatch(/SYSTEM_TOOL_PATHS[^;]*from "\.\/g2-scope\.mjs"/);
    }
  });
});
