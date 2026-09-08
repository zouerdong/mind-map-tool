// Accepted ADR 0006 / PRD §9 release budgets.
// Keep the sampler and evidence verifier on the same immutable thresholds.
export const RELEASE_BUDGETS = Object.freeze({
  canvasFrameP95Ms: 32,
  editCommandP95Ms: 50,
  saveP95Ms: 200,
  pngExportP95Ms: 3_000,
  coldStartP95Ms: 1_500,
  warmStartP95Ms: 800,
  rssStableMb: 120,
  // ADR uses decimal MB for the distribution/download artifact.
  installerBytes: 25_000_000,
});
