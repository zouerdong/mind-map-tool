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
  installerBytes: 25_000_000,
});
