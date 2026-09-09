import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(__dirname, "../..");
const VERIFIER = resolve(ROOT, "scripts/quality/verify-icons.mjs");
const CASES = resolve(ROOT, ".tmp/prr-068-test-fixtures/cases");
const MASTER_REAL = resolve(ROOT, "assets/app-icon/source/mind-map-app-icon.svg");
const EXPORT_DIR = resolve(ROOT, "assets/app-icon/exports");

const EXPECTED_MASTER_SHA256 = "01c7ad41cefbe8f75439bc6ddab48e51fb81b8026f2e923132a411385d11b72e";
const LEGACY_PLACEHOLDER_SHA256 =
  "8bcf350362516f983e05a6e34c0f7917351b444ca7d76889bbf4861cb9051b27";
// 旧纯蓝占位 1024x1024 RGBA PNG（base64），SHA-256 即 LEGACY_PLACEHOLDER_SHA256。
const LEGACY_PLACEHOLDER_B64 =
  "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";

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runVerify(args: string[]) {
  try {
    const stdout = execFileSync(process.execPath, [VERIFIER, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
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

// ---- 独立实现的二进制 helpers（与 verify-icons 的实现互为交叉检查，不 import 被测模块）----

function pngIhdr(bytes: Buffer) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33) throw new Error("png too small");
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("png signature");
  if (bytes.toString("latin1", 12, 16) !== "IHDR") throw new Error("no IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

function icnsChunkList(bytes: Buffer) {
  if (bytes.toString("latin1", 0, 4) !== "icns") throw new Error("not icns");
  const total = bytes.readUInt32BE(4);
  if (total !== bytes.length) throw new Error("icns total mismatch");
  const chunks: { type: string; length: number }[] = [];
  let off = 8;
  while (off < bytes.length) {
    const type = bytes.toString("latin1", off, off + 4);
    const length = bytes.readUInt32BE(off + 4);
    chunks.push({ type, length });
    off += length;
  }
  return chunks;
}

function icnsFromChunks(chunks: { type: string; data: Buffer }[], sort: boolean): Buffer {
  const ordered = sort
    ? [...chunks].sort((a, b) =>
        a.type < b.type ? -1 : a.type > b.type ? 1 : Buffer.compare(a.data, b.data),
      )
    : chunks;
  const total = 8 + ordered.reduce((sum, c) => sum + 8 + c.data.length, 0);
  const buf = Buffer.alloc(total);
  buf.write("icns", 0, "latin1");
  buf.writeUInt32BE(total, 4);
  let off = 8;
  for (const c of ordered) {
    buf.write(c.type, off, "latin1");
    buf.writeUInt32BE(8 + c.data.length, off + 4);
    c.data.copy(buf, off + 8);
    off += 8 + c.data.length;
  }
  return buf;
}

function buildIco(png: Buffer): Buffer {
  const count = 1;
  const dataOff = 6 + count * 16;
  const buf = Buffer.alloc(dataOff + png.length);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(count, 4);
  const ihdr = pngIhdr(png);
  buf.writeUInt8(ihdr.width >= 256 ? 0 : ihdr.width, 6);
  buf.writeUInt8(ihdr.height >= 256 ? 0 : ihdr.height, 7);
  buf.writeUInt16LE(0, 8);
  buf.writeUInt16LE(32, 10);
  buf.writeUInt32LE(png.length, 14);
  buf.writeUInt32LE(dataOff, 18);
  png.copy(buf, dataOff);
  return buf;
}

function manifestEntry(name: string, bytes: Buffer) {
  const kind = name.endsWith(".png")
    ? "png"
    : name.endsWith(".icns")
      ? "icns"
      : name.endsWith(".ico")
        ? "ico"
        : null;
  const entry: any = { path: name, kind, bytes: bytes.length, sha256: sha256(bytes) };
  if (kind === "png") Object.assign(entry, pngIhdr(bytes));
  if (kind === "icns") entry.chunks = icnsChunkList(bytes);
  return entry;
}

function validIconSet() {
  const png = (size: string) => readFileSync(join(EXPORT_DIR, `mind-map-app-icon-${size}.png`));
  const files = new Map<string, Buffer>([
    ["32x32.png", png("32")],
    ["64x64.png", png("64")],
    ["128x128.png", png("128")],
    ["128x128@2x.png", png("256")],
    ["icon.png", png("1024")],
    [
      "icon.icns",
      icnsFromChunks(
        [
          { type: "ic11", data: png("32") },
          { type: "ic12", data: png("64") },
          { type: "ic07", data: png("128") },
          { type: "ic08", data: png("256") },
          { type: "ic09", data: png("512") },
          { type: "ic10", data: png("1024") },
        ],
        true,
      ),
    ],
    ["icon.ico", buildIco(png("32"))],
  ]);
  return files;
}

const ALL_CONFIG_REFS = [
  "icons/32x32.png",
  "icons/64x64.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.png",
  "icons/icon.icns",
  "icons/icon.ico",
];

function writeConfig(configPath: string, iconRefs: string[] | null) {
  const cfg: any = { $schema: "test", productName: "Mind Map", version: "0.0.0", bundle: {} };
  if (iconRefs !== null) cfg.bundle.icon = iconRefs;
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

function writeManifest(
  manifestPath: string,
  masterSha: string,
  entries: any[],
  patch?: (m: any) => void,
) {
  const manifest: any = {
    schemaVersion: 1,
    asset: "mind-map-app-icon",
    stage: "desktop-icon-set",
    generator: {
      tool: "@tauri-apps/cli",
      version: "test-fixture",
      command: "pnpm tauri icon",
      cwd: "apps/desktop",
      icnsNormalization: "test",
    },
    source: { path: "master.svg", width: 1024, height: 1024, sha256: masterSha },
    outputs: entries,
  };
  if (patch) patch(manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

interface CasePaths {
  dir: string;
  master: string;
  icons: string;
  config: string;
  manifest: string;
  manifestRel: string;
  masterRel: string;
  iconsRel: string;
  configRel: string;
}

function setupCase(name: string): CasePaths {
  const dir = join(CASES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "icons"), { recursive: true });
  const master = join(dir, "master.svg");
  copyFileSync(MASTER_REAL, master);
  const rel = (p: string) => `.tmp/prr-068-test-fixtures/cases/${name}/${p}`;
  return {
    dir,
    master,
    icons: join(dir, "icons"),
    config: join(dir, "tauri.conf.json"),
    manifest: join(dir, "icons", "icon-set-manifest.json"),
    manifestRel: rel("icons/icon-set-manifest.json"),
    masterRel: rel("master.svg"),
    iconsRel: rel("icons"),
    configRel: rel("tauri.conf.json"),
  };
}

/**
 * 构造一个完整 fixture 并跑校验；options 允许在写盘前更换文件（files 已重算 entry）、
 * 写盘时跳过文件、写完后修补 manifest、替换 config refs 与 master。
 */
function runCase(
  name: string,
  opts: {
    files?: (files: Map<string, Buffer>) => void;
    skipWrite?: string[];
    skipManifest?: boolean;
    manifestRaw?: string;
    patchManifest?: (manifest: any, entries: any[]) => void;
    patchEntries?: (entries: any[]) => void;
    configRefs?: string[] | null;
    mutateMaster?: (bytes: Buffer) => Buffer;
  } = {},
) {
  const p = setupCase(name);
  const files = validIconSet();
  if (opts.files) opts.files(files);
  const entries: any[] = [];
  for (const [name, bytes] of files) {
    let entry: any;
    try {
      entry = manifestEntry(name, bytes);
    } catch {
      // 结构已破坏（如 ICNS header 被改）时仍登记基础字段，
      // 让校验器在二进制解析步骤给出明确失败，而非测试基建崩掉。
      const kind = name.endsWith(".png") ? "png" : name.endsWith(".icns") ? "icns" : "ico";
      entry = { path: name, kind, bytes: bytes.length, sha256: sha256(bytes) };
    }
    entries.push(entry);
  }
  if (opts.patchEntries) opts.patchEntries(entries);
  const masterBytes = opts.mutateMaster
    ? opts.mutateMaster(readFileSync(p.master))
    : readFileSync(p.master);
  writeFileSync(p.master, masterBytes);
  const masterSha = sha256(readFileSync(p.master));
  for (const [name, bytes] of files) {
    if (opts.skipWrite?.includes(name)) continue;
    writeFileSync(join(p.icons, name), bytes);
  }
  if (!opts.skipManifest) {
    writeManifest(p.manifest, masterSha, entries, opts.patchManifest);
    if (opts.manifestRaw !== undefined) writeFileSync(p.manifest, opts.manifestRaw);
  }
  writeConfig(p.config, opts.configRefs === undefined ? ALL_CONFIG_REFS : opts.configRefs);
  return {
    paths: p,
    files,
    entries,
    run: () =>
      runVerify([
        "--root",
        p.dir,
        "--master",
        p.master,
        "--icons",
        p.icons,
        "--config",
        p.config,
        "--manifest",
        p.manifest,
      ]),
  };
}

describe("verify-icons.mjs（黑盒：execFileSync 子进程）", () => {
  it("合法桌面 7 件 + manifest + 完整 config 引用通过", () => {
    const res = runCase("valid").run();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("PASS");
  });

  it("母版 hash 漂移时失败（fail-closed）", () => {
    const res = runCase("master-drift", {
      mutateMaster: (b) => Buffer.concat([b, Buffer.from("\n<!-- drift -->")]),
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("母版 hash 漂移");
  });

  it("manifest 缺失时失败", () => {
    const res = runCase("manifest-missing", { skipManifest: true }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("图标 manifest 不存在");
  });

  it("manifest 非法 JSON 时失败", () => {
    const res = runCase("bad-json", { manifestRaw: "not json{{" }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("不是合法 JSON");
  });

  it("manifest schemaVersion 错误时失败", () => {
    const res = runCase("bad-schema", { patchManifest: (m) => (m.schemaVersion = 999) }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("schemaVersion");
  });

  it("manifest source.sha256 与批准值不一致时失败", () => {
    const res = runCase("bad-source-sha", {
      patchManifest: (m) => (m.source.sha256 = "0".repeat(64)),
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("manifest 记录母版 hash");
  });

  it("manifest.outputs 为空时失败", () => {
    const res = runCase("empty-outputs", { patchManifest: (m) => (m.outputs = []) }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("manifest.outputs 缺失或为空");
  });

  it("PNG IHDR 尺寸与 manifest 不一致时失败", () => {
    const res = runCase("png-dim-mismatch", {
      patchEntries: (entries) => {
        const e = entries.find((x) => x.path === "32x32.png");
        e.width += 1;
      },
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("IHDR 尺寸");
  });

  it("PNG 缺 alpha 通道时失败", () => {
    const res = runCase("png-no-alpha", {
      files: (files) => {
        const b = Buffer.from(files.get("icon.png")!);
        b[25] = 2; // colorType=RGB（无 alpha），CRC 未修也无碍：校验器不检查 CRC
        files.set("icon.png", b);
      },
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("缺 alpha 通道");
  });

  it("PNG 非方形时失败", () => {
    const res = runCase("png-non-square", {
      files: (files) => {
        const b = Buffer.from(files.get("128x128.png")!);
        b.writeUInt32BE(64, 20); // 声称 128x64
        files.set("128x128.png", b);
      },
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("不是方形");
  });

  it("文件与 manifest 记录 SHA-256 不一致时失败（生成物过期/篡改）", () => {
    const res = runCase("sha-mismatch", {
      patchEntries: (entries) => {
        entries.find((x) => x.path === "icon.png")!.sha256 = "0".repeat(64);
      },
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("SHA-256 与 manifest 不一致");
  });

  it("manifest 声明但磁盘缺文件时失败", () => {
    const res = runCase("declared-missing", { skipWrite: ["icon.ico"] }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("但文件不存在");
  });

  it("ICNS 魔数错误时失败", () => {
    const res = runCase("icns-bad-magic", {
      files: (files) =>
        files.set("icon.icns", Buffer.concat([Buffer.from("xxcs"), Buffer.alloc(4)])),
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("不是合法 ICNS");
  });

  it("ICNS 总长度字段与文件长度不一致时失败", () => {
    const res = runCase("icns-bad-total", {
      files: (files) => {
        const b = Buffer.from(files.get("icon.icns")!);
        b.writeUInt32BE(b.length + 1, 4);
        files.set("icon.icns", b);
      },
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("总长度字段");
  });

  it("ICNS 非规范化 chunk 顺序时失败", () => {
    const res = runCase("icns-unsorted", {
      files: (files) => {
        const png = (size: string) =>
          readFileSync(join(EXPORT_DIR, `mind-map-app-icon-${size}.png`));
        files.set(
          "icon.icns",
          icnsFromChunks(
            [
              { type: "ic10", data: png("1024") },
              { type: "ic07", data: png("128") },
              { type: "ic12", data: png("64") },
            ],
            false,
          ),
        );
      },
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("不是规范化容器");
  });

  it("旧纯蓝占位图标混入时失败（含 SHA-256 校验）", () => {
    // 内嵌 base64 与基线 SHA-256 的一致性不变量：常量漂移时直接红，不留隐性错位
    expect(sha256(Buffer.from(LEGACY_PLACEHOLDER_B64, "base64"))).toBe(LEGACY_PLACEHOLDER_SHA256);
    const res = runCase("legacy-placeholder", {
      files: (files) => files.set("icon.png", Buffer.from(LEGACY_PLACEHOLDER_B64, "base64")),
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("旧纯蓝占位图标");
    expect(res.stderr).toContain(LEGACY_PLACEHOLDER_SHA256);
  });

  it("StoreLogo 等桌面外派生物混入时失败", () => {
    const res = runCase("storelogo-mixed", {
      files: (files) => files.set("StoreLogo.png", files.get("64x64.png")!),
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("StoreLogo.png");
  });

  it("bundle.icon 引用不存在文件时失败", () => {
    const res = runCase("config-ref-missing", {
      configRefs: ["icons/icon.png", "icons/icon.icns", "icons/icon.ico", "icons/nope.png"],
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("引用文件不存在");
  });

  it("bundle.icon 缺 ICNS 时失败", () => {
    const res = runCase("config-no-icns", {
      configRefs: ["icons/icon.png", "icons/icon.ico"],
    }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("缺少桌面必需 ICNS");
  });

  it("bundle.icon 缺失时失败", () => {
    const res = runCase("config-empty", { configRefs: null }).run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("缺失或为空");
  });

  it("真实仓库自适应用例：icons 目录含旧纯蓝占位/无 manifest ⇒ 必须 FAIL；集成后 ⇒ 必须 PASS", () => {
    const iconsDir = resolve(ROOT, "apps/desktop/src-tauri/icons");
    const manifestPath = join(iconsDir, "icon-set-manifest.json");
    const legacyOnDisk =
      existsSync(join(iconsDir, "icon.png")) &&
      sha256(readFileSync(join(iconsDir, "icon.png"))) === LEGACY_PLACEHOLDER_SHA256;
    const expectFail = !existsSync(manifestPath) || legacyOnDisk;
    const res = runVerify([]);
    expect(res.status).toBe(expectFail ? 1 : 0);
    if (expectFail) {
      expect(res.stderr).toContain("verify-icons: FAIL");
      if (legacyOnDisk) expect(res.stderr).toContain("旧纯蓝占位图标");
    } else {
      expect(res.stdout).toContain("PASS");
    }
  });
});
