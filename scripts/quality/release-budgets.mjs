// Accepted ADR 0006 / PRD §9 release budgets.
// Keep the sampler and evidence verifier on the same immutable thresholds.
// ADR 0006 1.1.0 (G-PERF-PROTOCOL 2026-09-09): cold 判定指标改名为
// conditionedColdStartP95Ms（一次成功 conditioning 之后的 20 个全新隔离 HOME
// cold 样本，estimator/阈值不变）；sessionFirstLaunchMs 为记录型、无预算。
export const RELEASE_BUDGETS = Object.freeze({
  canvasFrameP95Ms: 32,
  editCommandP95Ms: 50,
  saveP95Ms: 200,
  pngExportP95Ms: 3_000,
  conditionedColdStartP95Ms: 1_500,
  warmStartP95Ms: 800,
  rssStableMb: 120,
  // ADR uses decimal MB for the distribution/download artifact.
  // ADR 0006 v1.2.0（2026-09-18 负责人批准）：ADR 0018 MCP 独立运行时进安装包，
  // 实测 ULMO DMG 75,268,912B（v0.3.0 候选 f611a1e）→ 预算 25MB 抬升至 100MB。
  installerBytes: 100_000_000,
});
