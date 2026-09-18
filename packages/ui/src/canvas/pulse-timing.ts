// 能量脉冲时序（2026-09-18 内测批次④）：跨边传导的周期窗口与闪烁关键帧。
// 纯函数、确定性；长度由画布层实测（getTotalLength）或回退估算传入。

/** 传导速度（px/ms ≈ 260px/s：「微微」可读不刺眼）。 */
export const PULSE_SPEED_PX_PER_MS = 0.26;
/** 一轮传导完成后的停顿（「一路不停」= 循环，轮间微停顿让周期可辨）。 */
export const PULSE_PAUSE_MS = 700;
/** 周期下限：路径很短时也保持可感知的节奏。 */
export const PULSE_MIN_CYCLE_MS = 1200;

export interface PulseWindow {
  /** 窗口起点占周期份额 [0,1)。 */
  beginFrac: number;
  /** 窗口终点占周期份额 (0,1]。 */
  endFrac: number;
}

/** 按边长比例分配周期窗口（匀速传导）；总长不足时下探停顿补足到周期下限。 */
export function pulseCycleTiming(
  lengths: number[],
  speed: number = PULSE_SPEED_PX_PER_MS,
  pauseMs: number = PULSE_PAUSE_MS,
): { durMs: number; windows: PulseWindow[] } {
  const travel = lengths.map((l) => Math.max(l, 1) / speed);
  const total = travel.reduce((a, b) => a + b, 0);
  const durMs = Math.max(total + pauseMs, PULSE_MIN_CYCLE_MS);
  const windows: PulseWindow[] = [];
  let acc = 0;
  for (const t of travel) {
    const beginFrac = acc / durMs;
    acc += t;
    windows.push({ beginFrac, endFrac: acc / durMs });
  }
  return { durMs, windows };
}

/**
 * 透明度关键帧（SMIL values/keyTimes）：窗口外停泊透明，窗口内快速淡入 +
 * 两次「微微闪烁」（0.9 ↔ 0.55），窗口末淡出。keyTimes 严格非降且在 [0,1]。
 * @param scale 峰值缩放（光晕层用 <1 的峰值，核心层用 1）。
 */
export function pulseOpacityKeyframes(
  beginFrac: number,
  endFrac: number,
  scale = 1,
): { values: string; keyTimes: string } {
  const span = Math.max(endFrac - beginFrac, 1e-6);
  const hi = 0.9 * scale;
  const lo = 0.55 * scale;
  const pts: Array<[number, number]> = [[0, 0]];
  if (beginFrac > 0) pts.push([beginFrac, 0]);
  pts.push([beginFrac + span * 0.08, hi]);
  pts.push([beginFrac + span * 0.3, lo]);
  pts.push([beginFrac + span * 0.52, hi]);
  pts.push([beginFrac + span * 0.74, lo]);
  pts.push([beginFrac + span * 0.92, hi]);
  pts.push([endFrac, hi]);
  const fadeOut = Math.min(endFrac + Math.max(span * 0.06, 0.01), 1);
  pts.push([fadeOut, 0]);
  if (fadeOut < 1) pts.push([1, 0]);

  // 夹紧 + 非降整序（浮点叠加防御）
  const cleaned: Array<[number, number]> = [];
  let lastT = -1;
  for (const [t, v] of pts) {
    const ct = Math.min(Math.max(t, 0), 1);
    if (ct < lastT) continue;
    if (ct === lastT && cleaned.length > 0) cleaned[cleaned.length - 1] = [ct, v];
    else cleaned.push([ct, v]);
    lastT = ct;
  }
  return {
    values: cleaned.map(([, v]) => String(Math.round(v * 1000) / 1000)).join(";"),
    keyTimes: cleaned.map(([t]) => String(Math.round(t * 10000) / 10000)).join(";"),
  };
}
