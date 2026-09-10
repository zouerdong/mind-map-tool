// verify-icons.mjs — PRR-068 桌面图标集 fail-closed 校验门（pnpm icon:verify）。
// 校验：母版 hash 与批准值一致；tracked manifest（icon-set-manifest.json）与磁盘每个
// 规范化输出一致（hash/bytes/PNG IHDR）；ICNS 严格解析且为规范化容器；ICO 基本结构；
// 旧纯蓝占位 hash 不得出现；tauri.conf.json icon 引用存在且必须含 ICNS/ICO；
// 桌面 icons 目录只允许 7 件输出 + manifest，不允许 mobile/Appx 派生物。
// 任一失败（含缺文件）退出非零；只读校验，不修改任何文件。

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalIcns, computeSha256, parseIcns, parseIco, readPngIhdr } from "./icon-utils.mjs";
import {
  DEFAULT_MANIFEST_NAME,
  EXPECTED_MASTER_SHA256,
  ICON_FILE_NAMES,
  ICONS_DIR_REL,
  LEGACY_PLACEHOLDER_SHA256,
  MANIFEST_SCHEMA_VERSION,
  MASTER_SVG_REL,
  TAURI_CONFIG_REL,
} from "./icon-baseline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/**
 * 校验一组图标集。全部使用绝对或仓库内路径；返回 { ok, errors: string[] }。
 * options（均默认仓库内路径）：root / masterSvg / iconsDir / tauriConfig / manifestPath /
 * expectedMasterSha256 / legacySha256Values。测试可注入临时目录与覆盖值。
 */
export function verifyIconSet(options = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);

  const root = options.root ?? ROOT;
  const masterSvg = options.masterSvg ?? join(root, MASTER_SVG_REL);
  const iconsDir = options.iconsDir ?? join(root, ICONS_DIR_REL);
  const tauriConfig = options.tauriConfig ?? join(root, TAURI_CONFIG_REL);
  const manifestPath = options.manifestPath ?? join(iconsDir, DEFAULT_MANIFEST_NAME);
  const expectedMasterSha256 = options.expectedMasterSha256 ?? EXPECTED_MASTER_SHA256;
  const legacySha256Values = options.legacySha256Values ?? [LEGACY_PLACEHOLDER_SHA256];

  // 1) 母版 hash
  if (!existsSync(masterSvg)) {
    fail(`母版 SVG 不存在：${masterSvg}`);
  } else {
    const masterSha = computeSha256(readFileSync(masterSvg));
    if (masterSha !== expectedMasterSha256)
      fail(`母版 hash 漂移：期望 ${expectedMasterSha256}，实际 ${masterSha}`);
  }

  // 2) manifest（缺文件/非法 JSON 只记录错误，不提前返回：legacy 扫描与配置引用继续执行，
  //    一次运行汇总全部问题，保证 fail-closed 而非掩盖后续缺陷）
  let manifest = null;
  let manifestReadable = false;
  if (!existsSync(manifestPath)) {
    fail(`图标 manifest 不存在：${manifestPath}`);
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifestReadable = true;
    } catch (error) {
      fail(`图标 manifest 不是合法 JSON：${error.message}`);
    }
  }
  if (manifestReadable && manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION)
    fail(
      `manifest schemaVersion 必须为 ${MANIFEST_SCHEMA_VERSION}（实际 ${manifest.schemaVersion}）`,
    );
  if (manifestReadable && typeof manifest.source?.sha256 !== "string")
    fail("manifest.source.sha256 缺失");
  else if (manifestReadable && manifest.source.sha256 !== expectedMasterSha256)
    fail(`manifest 记录母版 hash ${manifest.source.sha256} 与批准值不一致`);
  if (manifestReadable && (!Array.isArray(manifest.outputs) || manifest.outputs.length === 0))
    fail("manifest.outputs 缺失或为空");

  // 3) 磁盘枚举：icons 目录只允许桌面集合 + manifest；无子目录（mobile/Appx 派生物）
  let diskNames = [];
  try {
    diskNames = readdirSync(iconsDir).sort();
  } catch (error) {
    fail(`无法读取 icons 目录 ${iconsDir}：${error.message}`);
  }
  const allowedNames = [...ICON_FILE_NAMES, DEFAULT_MANIFEST_NAME].sort();
  const unexpected = diskNames.filter((name) => !allowedNames.includes(name));
  for (const name of unexpected) {
    fail(`icons 目录存在不允许的文件/目录：${name}（禁止 mobile/Appx 派生物混入桌面集合）`);
  }
  for (const name of diskNames) {
    const abs = join(iconsDir, name);
    let isFile = false;
    try {
      isFile = lstatSync(abs).isFile();
    } catch (error) {
      fail(`无法读取 icons 条目 ${name}：${error.message}`);
      continue;
    }
    if (!isFile) {
      fail(`icons 目录条目必须是普通文件：${name}`);
      continue;
    }
    const legacy = legacySha256Values.find((sha) => sha === computeSha256(readFileSync(abs)));
    if (legacy) fail(`icons 目录存在旧纯蓝占位图标（${name}，SHA-256 ${legacy}）`);
  }

  // 4) manifest 每个输出与磁盘一致
  const manifestPaths = new Map();
  if (manifestReadable)
    for (const output of manifest.outputs ?? []) {
      if (typeof output.path !== "string" || output.path.length === 0) {
        fail("manifest.outputs 存在缺 path 的条目");
        continue;
      }
      if (output.path.includes("/") || output.path.includes("\\")) {
        fail(`manifest 输出路径必须为 icons 目录内的纯文件名：${output.path}`);
        continue;
      }
      if (manifestPaths.has(output.path)) {
        fail(`manifest.outputs 存在重复 path：${output.path}`);
        continue;
      }
      manifestPaths.set(output.path, output);
      const abs = join(iconsDir, output.path);
      if (!existsSync(abs)) {
        fail(`manifest 记录 ${output.path} 但文件不存在`);
        continue;
      }
      const bytes = readFileSync(abs);
      if (typeof output.bytes !== "number" || output.bytes !== bytes.length)
        fail(
          `${output.path} bytes 与 manifest 不一致（期望 ${output.bytes}，实际 ${bytes.length}）`,
        );
      const sha = computeSha256(bytes);
      if (output.sha256 !== sha)
        fail(`${output.path} SHA-256 与 manifest 不一致（生成物过期或篡改）`);
      const kind =
        output.kind ??
        (output.path.endsWith(".png")
          ? "png"
          : output.path.endsWith(".icns")
            ? "icns"
            : output.path.endsWith(".ico")
              ? "ico"
              : null);
      if (
        kind !==
        (output.path.endsWith(".png")
          ? "png"
          : output.path.endsWith(".icns")
            ? "icns"
            : output.path.endsWith(".ico")
              ? "ico"
              : null)
      )
        fail(`${output.path} kind 与扩展名不符（${output.kind}）`);
      if (kind === "png") {
        let ihdr;
        try {
          ihdr = readPngIhdr(bytes);
        } catch (error) {
          fail(`${output.path} 不是合法 PNG：${error.message}`);
          continue;
        }
        if (ihdr.width !== output.width || ihdr.height !== output.height)
          fail(
            `${output.path} IHDR 尺寸 ${ihdr.width}x${ihdr.height} 与 manifest ${output.width}x${output.height} 不一致`,
          );
        if (ihdr.width !== ihdr.height)
          fail(`${output.path} 不是方形（${ihdr.width}x${ihdr.height}）`);
        if (ihdr.colorType !== 6 && ihdr.colorType !== 4)
          fail(
            `${output.path} 缺 alpha 通道（colorType ${ihdr.colorType}，需要 6=RGBA 或 4=grayscale+alpha）`,
          );
      } else if (kind === "icns") {
        try {
          const parsed = parseIcns(bytes);
          const canon = canonicalIcns(bytes);
          if (!canon.equals(bytes))
            fail(`${output.path} 不是规范化容器（chunk 顺序必须按 type、bytes 稳定排序）`);
          const diskChunks = parsed.chunks.map((chunk) => ({
            type: chunk.type,
            length: chunk.length,
          }));
          const manifestChunks = output.chunks;
          if (
            !Array.isArray(manifestChunks) ||
            manifestChunks.length !== diskChunks.length ||
            manifestChunks.some(
              (chunk, index) =>
                chunk.type !== diskChunks[index].type || chunk.length !== diskChunks[index].length,
            )
          )
            fail(`${output.path} chunk 槽位清单与 manifest 不一致`);
        } catch (error) {
          fail(`${output.path} 不是合法 ICNS：${error.message}`);
        }
      } else if (kind === "ico") {
        try {
          parseIco(bytes);
        } catch (error) {
          fail(`${output.path} 不是合法 ICO：${error.message}`);
        }
      } else {
        fail(`${output.path} kind 未知：${output.kind}`);
      }
    }

  // 5) manifest 输出集合 == 磁盘图标文件集合（防止漏登记或多余生成物）
  const diskIconNames = diskNames.filter((name) => name !== DEFAULT_MANIFEST_NAME);
  if (manifestReadable) {
    const declared = [...manifestPaths.keys()].sort();
    for (const p of declared)
      if (!ICON_FILE_NAMES.includes(p)) fail(`manifest 声明了不允许的桌面输出：${p}`);
    for (const p of ICON_FILE_NAMES)
      if (!manifestPaths.has(p)) fail(`manifest 缺少必需桌面输出：${p}`);
    for (const p of declared)
      if (!diskIconNames.includes(p)) fail(`manifest 声明 ${p} 但磁盘集合缺少它`);
    for (const p of diskIconNames.filter((name) => ICON_FILE_NAMES.includes(name)))
      if (!manifestPaths.has(p)) fail(`磁盘图标文件 ${p} 未在 manifest 中登记`);
  }

  // 6) tauri.conf.json 引用
  let config = null;
  try {
    config = JSON.parse(readFileSync(tauriConfig, "utf8"));
  } catch (error) {
    fail(`tauri.conf.json 读取/解析失败：${error.message}`);
  }
  const configDir = dirname(tauriConfig);
  const iconRefs = config?.bundle?.icon;
  if (!Array.isArray(iconRefs) || iconRefs.length === 0)
    fail("tauri.conf.json bundle.icon 缺失或为空");
  else {
    const basenameOf = (ref) => ref.replaceAll("\\", "/").split("/").at(-1);
    const expectedRefs = new Map(
      ICON_FILE_NAMES.map((name) => [
        relative(configDir, join(iconsDir, name)).replaceAll("\\", "/"),
        resolve(iconsDir, name),
      ]),
    );
    const seenRefs = new Set();
    for (const ref of iconRefs) {
      if (typeof ref !== "string" || ref.length === 0) {
        fail("bundle.icon 存在空引用");
        continue;
      }
      const abs = resolve(configDir, ref);
      const normalizedRef = relative(configDir, abs).replaceAll("\\", "/");
      if (seenRefs.has(normalizedRef)) fail(`bundle.icon 存在重复引用：${ref}`);
      seenRefs.add(normalizedRef);
      if (!existsSync(abs)) fail(`bundle.icon 引用文件不存在：${ref}`);
      // manifest 可读且已登记输出时才做登记校验；manifest 缺失时不猜测，只保留存在性检查
      else if (manifestPaths.size > 0 && !manifestPaths.has(basenameOf(ref)))
        fail(`bundle.icon 引用 ${ref} 未在图标 manifest 中登记`);
      const expectedAbs = expectedRefs.get(normalizedRef);
      if (expectedAbs === undefined || expectedAbs !== abs)
        fail(`bundle.icon 必须直接引用受管 icons 目录内的文件：${ref}`);
    }
    for (const expectedRef of expectedRefs.keys())
      if (!seenRefs.has(expectedRef)) fail(`bundle.icon 缺少必需图标引用：${expectedRef}`);
  }

  return { ok: errors.length === 0, errors };
}

// ---- CLI ----
const args = process.argv.slice(2);
const optValue = (name) => {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
};
const override = {};
for (const [flag, key] of [
  ["--root", "root"],
  ["--master", "masterSvg"],
  ["--icons", "iconsDir"],
  ["--config", "tauriConfig"],
  ["--manifest", "manifestPath"],
]) {
  const value = optValue(flag);
  if (value !== undefined) override[key] = resolve(ROOT, value);
}

const { ok, errors } = verifyIconSet(override);
for (const error of errors) console.error(`verify-icons: FAIL — ${error}`);
if (!ok) {
  console.error(`verify-icons: BLOCKED — ${errors.length} 项校验失败`);
  process.exit(1);
}
console.log("verify-icons: PASS — 图标集、manifest 与配置引用一致，母版无漂移。");
