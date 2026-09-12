// dmg-budget.mjs — DMG 装配专用的有界预算辅助（PRR-069C-R2-F1）。
//
// 目的：让「装配预算」（单命令 120000ms / 整轮 180000ms）与「失败清理宽限」（60000ms）
// 各自只持有一个单调时钟截止时间，并被同一段工作内的每一次子进程调用共享：
//   - 装配流程（含正常路径的 mount 查询与 detach）消费装配预算；
//   - 首次失败清理（含它的第一次 mount 查询、detach、清理后复核）消费清理宽限。
// 两者不得混用，也不得因为再次 detach 或复核失败而重置截止时间。
//
// 单调时钟用于计算耗时（墙钟只用于审计时间戳），且可注入，便于用假时钟验证
// 「前查询耗 29 秒后 detach 上限必须 ≤31 秒」这类跨阶段预算消耗，而不需要真实 sleep。
//
// 关键约定：timeoutFor(ctx, cap) 返回 0 表示「预算已耗尽，不得启动子进程」。
// 调用方绝不允许把 0 交给 child_process 的 timeout —— Node 的语义是「不设超时」。

/** 默认单调时钟：performance.now()（Node 内置全局，不受系统时间调整影响）。 */
export const DEFAULT_NOW_MONO = () => performance.now();

/**
 * 建立预算上下文。startMono / deadlineMono 只在创建时确定一次；
 * 同一段工作内必须复用同一个 ctx，不得重建或重置。
 */
export function createBudgetContext({ budgetMs, nowMono = DEFAULT_NOW_MONO, label = "budget" }) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(`${label}: 预算必须是正的毫秒数（得到 ${String(budgetMs)}）`);
  }
  const startMono = nowMono();
  return { label, budgetMs, startMono, deadlineMono: startMono + budgetMs, nowMono };
}

/** 剩余预算（毫秒，非负）。 */
export function remainingMs(ctx) {
  return Math.max(0, ctx.deadlineMono - ctx.nowMono());
}

/**
 * 已消耗时间（非负整数毫秒）：报告中的段耗时一律用它计算，
 * 避免「恒为 0」或「只到 detach 前」。单调时钟本身可能是小数，这里取整后再进报告。
 */
export function elapsedMs(ctx) {
  return Math.max(0, Math.round(ctx.nowMono() - ctx.startMono));
}

/**
 * 把一次运行切成互不重叠的装配段与清理段。cleanupCtx 的起点就是两段边界；
 * 只读取 runCtx 的同一单调时钟一次，避免分别取时造成毫秒级漂移或把清理重复计入总时长。
 */
export function splitRunTimings(runCtx, cleanupCtx = null) {
  const endMono = Math.max(runCtx.startMono, runCtx.nowMono());
  const boundaryMono = cleanupCtx
    ? Math.min(endMono, Math.max(runCtx.startMono, cleanupCtx.startMono))
    : endMono;
  const totalElapsedMs = Math.max(0, Math.round(endMono - runCtx.startMono));
  const assemblyMs = cleanupCtx
    ? Math.min(totalElapsedMs, Math.max(0, Math.round(boundaryMono - runCtx.startMono)))
    : totalElapsedMs;
  // 只对总区间和边界前区间取整，余数归入 cleanup，避免两个子区间分别
  // 四舍五入后出现 assembly + cleanup !== rounded(total) 的 1ms 漂移。
  const cleanupMs = totalElapsedMs - assemblyMs;
  return { assemblyMs, cleanupMs, totalElapsedMs };
}

/** 预算是否已耗尽（启动子进程前的显式判断，语义比 timeout === 0 更清楚）。 */
export function isExhausted(ctx) {
  return remainingMs(ctx) < 1;
}

/**
 * 子进程超时 = floor(min(命令上限, 剩余预算))，至少 1ms（child_process 只接受整数）。
 * 返回 0 表示不足 1ms 可用：调用方必须放弃启动子进程，而不是把 0 传下去。
 */
export function timeoutFor(ctx, commandCapMs) {
  const remaining = remainingMs(ctx);
  if (remaining < 1) return 0;
  const cap = Number.isFinite(commandCapMs) && commandCapMs > 0 ? commandCapMs : remaining;
  return Math.max(1, Math.floor(Math.min(cap, remaining)));
}
