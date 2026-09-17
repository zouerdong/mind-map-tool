// cli.ts — mindmap-render 直调通道（ADR 0014：MCP 是主入口，CLI 供调试与脚本化）。
// 用法：node <bridge>/cli.ts --input outline.json --out map.png [--format png]
//        [--font lxgw-wenkai|noto-sans-sc] [--direction horizontal|vertical]
//        [--no-source] [--no-emphasis-root]
// 输出：stdout 单行 JSON 结果；任何失败 stderr 单行 JSON + 非零退出。

import { parseArgs } from "node:util";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { LIMITS, type FontToken, type OrganizeDirection } from "@mindmap/core";
import { createExportRenderer } from "@mindmap/export";
import { renderOutlineToFile } from "./request.js";
import { OUTPUT_FORMATS, type OutputFormat } from "./render.js";
import { loadFontBundle, loadResvgWasm } from "./assets.js";

const fail = (code: string, message: string): never => {
  process.stderr.write(JSON.stringify({ ok: false, error: { code, message } }) + "\n");
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string" },
    format: { type: "string", default: "png" },
    font: { type: "string" },
    direction: { type: "string" },
    // parseArgs 不支持 --no- 前缀否定式，用显式否定旗标
    "no-source": { type: "boolean", default: false },
    "no-emphasis-root": { type: "boolean", default: false },
    "no-wide": { type: "boolean", default: false },
  },
  strict: true,
});

const inputArg: string = values.input ?? fail("BAD_ARGS", "缺少 --input <outline.json>");
const outArg: string = values.out ?? fail("BAD_ARGS", "缺少 --out <输出文件路径>");
if (!OUTPUT_FORMATS.includes(values.format as OutputFormat))
  fail("BAD_ARGS", `format 必须是 ${OUTPUT_FORMATS.join("/")}（实际 ${values.format}）`);
if (values.font !== undefined && !["lxgw-wenkai", "noto-sans-sc"].includes(values.font))
  fail("BAD_ARGS", `font 必须是 lxgw-wenkai/noto-sans-sc（实际 ${values.font}）`);
if (values.direction !== undefined && !["horizontal", "vertical"].includes(values.direction))
  fail("BAD_ARGS", `direction 必须是 horizontal/vertical（实际 ${values.direction}）`);

const inputPath = resolve(inputArg);
if (!existsSync(inputPath) || !statSync(inputPath).isFile())
  fail("BAD_INPUT", `输入文件不存在：${inputPath}`);
if (statSync(inputPath).size > LIMITS.maxInputBytes)
  fail("LIMIT_EXCEEDED", `输入超过 ${LIMITS.maxInputBytes} 字节上限`);

let outline: unknown;
try {
  outline = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (error) {
  fail("BAD_INPUT", `输入不是合法 JSON：${error instanceof Error ? error.message : error}`);
}

const renderer = await createExportRenderer({
  fonts: loadFontBundle(),
  resvgWasm: loadResvgWasm(),
});

const result = await renderOutlineToFile(renderer, {
  outline,
  outPath: outArg,
  format: values.format as OutputFormat,
  ...(values.font !== undefined ? { font: values.font as FontToken } : {}),
  ...(values.direction !== undefined ? { direction: values.direction as OrganizeDirection } : {}),
  saveSource: !values["no-source"],
  emphasisRoot: !values["no-emphasis-root"],
  wide: !values["no-wide"],
});
if (!result.ok) fail(result.error.code, result.error.message);

process.stdout.write(JSON.stringify(result) + "\n");
