// run-performance.mjs — 性能预算采样（MM-050/MM-090 消费）。
// --fixture dense-300-450 --scope canvas|save|export --platform macos|windows
// --output <evidence.json>；预算见 ADR 0006（批准后不得放宽）。
// fail-closed：无证据即失败，不用假数据填充。

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const fixture = flag("fixture") ?? "dense-300-450";
const scope = flag("scope") ?? "canvas";
const platform = flag("platform") ?? "macos";
const output = flag("output");

const BUDGETS = {
  // ADR 0006（G1 批准；macOS 实测校准）
  canvasFrameP95Ms: 32,
  editCommandP95Ms: 50,
  saveP95Ms: 200,
  pngExportP95Ms: 3000,
  coldStartP95Ms: 1500,
  rssStableMb: 120,
};

console.error(
  `run-performance: FAIL — 尚无 ${platform}/${scope}/${fixture} 证据管线。` +
    "MM-050（canvas）与 MM-090（全量）建立采样与 evidence 输出；" +
    `预算（不可放宽）：${JSON.stringify(BUDGETS)}` +
    (output ? `；输出目标 ${output}` : ""),
);
process.exit(1);
