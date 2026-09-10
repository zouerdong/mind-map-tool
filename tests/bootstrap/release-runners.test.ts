import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname, relative } from "node:path";

const ROOT = resolve(__dirname, "../..");
const BUNDLE_GATE = resolve(ROOT, "scripts/quality/bundle-gate.mjs");
const REPACK_DMG = resolve(ROOT, "scripts/quality/repack-dmg.mjs");
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
function createCleanGitRepo(name: string): string {
  const repoDir = join(FIXTURE_DIR, name);
  rmSync(repoDir, { recursive: true, force: true });
  mkdirSync(join(repoDir, ".tmp/release-runner-fixtures"), { recursive: true });
  writeFileSync(join(repoDir, ".gitignore"), ".tmp/\n");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["add", ".gitignore"], { cwd: repoDir });
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

    it("PRR-069：--dmg-format ULMO 全链成功，inventory 绑定转换后 hash 与 repack 元数据", () => {
      const repoDir = createCleanGitRepo("bundle-ulmo-ok-repo");
      const regPath = createSyntheticRegister("approved", {}, join(repoDir, ".tmp"));
      const mockHdiutil = createMockHdiutil(join(repoDir, ".tmp"));
      const dmgPath = join(repoDir, REPACK_DMG_REL);
      const dmgBeforeSha = (() => {
        createSyntheticDmg(repoDir, "synthetic udzo dmg for ulmo");
        return fileSha256(dmgPath);
      })();
      const bundleDir = join(repoDir, ".tmp/release-runner-fixtures/bundle/macos");
      const inventoryPath = join(
        repoDir,
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
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
        "--dmg-format",
        "ULMO",
        "--repack-hdiutil",
        mockHdiutil,
        "--inventory",
        ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
        "--",
        process.execPath,
        "-e",
        `const fs = require('fs');
           fs.mkdirSync('${bundleDir}', { recursive: true });
           fs.mkdirSync('${join(dmgPath, "..")}', { recursive: true });
           fs.mkdirSync('${join(bundleDir, "Mind Map.app/Contents/MacOS")}', { recursive: true });
           fs.writeFileSync('${join(bundleDir, "Mind Map.app/Contents/Info.plist")}', '<plist></plist>');
           fs.writeFileSync('${join(bundleDir, "Mind Map.app/Contents/MacOS/mind-map")}', '#!/bin/sh\\nexit 0\\n');
           fs.writeFileSync('${dmgPath}', 'synthetic udzo dmg for ulmo');`,
      ]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("dmgFormat=ULMO");
      const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
      expect(inventory.dmgFormat).toBe("ULMO");
      expect(inventory.dmgRepack.runner).toBe("repack-dmg.mjs");
      expect(inventory.dmgRepack.afterSha256).not.toBe(dmgBeforeSha);
      // inventory 的 artifact hash 必须是转换后文件（含 ULMO-CONVERTED 标记）
      const dmgArtifact = inventory.artifacts.find((a: any) => a.path.endsWith(".dmg"));
      expect(dmgArtifact.sha256).toBe(fileSha256(dmgPath));
      expect(dmgArtifact.sha256).not.toBe(dmgBeforeSha);
      expect(dmgArtifact.sha256).toBe(inventory.dmgRepack.afterSha256);
      expect(readFileSync(dmgPath, "utf8")).toContain("ULMO-CONVERTED");
      expect(existsSync(dmgPath.replace(/\.dmg$/, ".repack-ULMO.tmp.dmg"))).toBe(false);
      expect(
        existsSync(join(repoDir, ".tmp/release-runner-fixtures/evidence/dmg-repack-report.json")),
      ).toBe(true);
    });

    it("PRR-069：repack 失败时 bundle gate 整体失败且不写 inventory（不回退 UDZO）", () => {
      const repoDir = createCleanGitRepo("bundle-ulmo-fail-repo");
      const regPath = createSyntheticRegister("approved", {}, join(repoDir, ".tmp"));
      const mockHdiutil = createMockHdiutil(join(repoDir, ".tmp"));
      const dmgPath = join(repoDir, REPACK_DMG_REL);
      const bundleDir = join(repoDir, ".tmp/release-runner-fixtures/bundle/macos");
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
          "--dmg-format",
          "ULMO",
          "--repack-hdiutil",
          mockHdiutil,
          "--inventory",
          ".tmp/release-runner-fixtures/evidence/bundle-inventory.json",
          "--",
          process.execPath,
          "-e",
          `const fs = require('fs');
           fs.mkdirSync('${bundleDir}', { recursive: true });
           fs.mkdirSync('${join(dmgPath, "..")}', { recursive: true });
           fs.mkdirSync('${join(bundleDir, "Mind Map.app/Contents/MacOS")}', { recursive: true });
           fs.writeFileSync('${join(bundleDir, "Mind Map.app/Contents/Info.plist")}', '<plist></plist>');
           fs.writeFileSync('${join(bundleDir, "Mind Map.app/Contents/MacOS/mind-map")}', '#!/bin/sh\\nexit 0\\n');
           fs.writeFileSync('${dmgPath}', 'synthetic udzo dmg');`,
        ],
        { MOCK_CONVERT_FAIL: "1" },
      );

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("DMG 容器格式转换失败");
      expect(existsSync(inventoryPath)).toBe(false);
      // 转换失败后原 DMG 内容保持原样（未被破坏、未被替换）
      expect(readFileSync(dmgPath, "utf8")).toBe("synthetic udzo dmg");
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
      expect(res.stderr).toContain("worktree 非 clean");
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
