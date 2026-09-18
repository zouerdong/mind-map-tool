// 能量脉冲时序契约测试（2026-09-18 内测批次④）。
import { describe, expect, it } from "vitest";
import {
  PULSE_MIN_CYCLE_MS,
  PULSE_PAUSE_MS,
  PULSE_SPEED_PX_PER_MS,
  pulseCycleTiming,
  pulseOpacityKeyframes,
} from "../src/canvas/pulse-timing.js";

describe("pulseCycleTiming", () => {
  it("匀速分配：窗口宽度与边长成正比、首尾相接", () => {
    const { durMs, windows } = pulseCycleTiming([260, 520], PULSE_SPEED_PX_PER_MS, 0);
    expect(windows).toHaveLength(2);
    expect(windows[0]!.beginFrac).toBe(0);
    expect(windows[0]!.endFrac).toBeCloseTo(windows[1]!.beginFrac, 10);
    // 260px/0.26=1000ms, 520px→2000ms，总长 3000 → 1/3 : 2/3
    expect(windows[0]!.endFrac).toBeCloseTo(1 / 3, 3);
    expect(windows[1]!.endFrac).toBeCloseTo(1, 3);
    expect(durMs).toBe(3000);
  });

  it("周期下限：极短路径不劣化为高频闪烁", () => {
    const { durMs } = pulseCycleTiming([10], PULSE_SPEED_PX_PER_MS, PULSE_PAUSE_MS);
    expect(durMs).toBe(PULSE_MIN_CYCLE_MS);
  });

  it("零/负长度防御：按 1px 计，两窗口等宽", () => {
    const { windows } = pulseCycleTiming([0, -5], PULSE_SPEED_PX_PER_MS, 0);
    const w0 = windows[0]!.endFrac - windows[0]!.beginFrac;
    const w1 = windows[1]!.endFrac - windows[1]!.beginFrac;
    expect(w0).toBeCloseTo(w1, 10);
    expect(w0).toBeGreaterThan(0);
  });

  it("空路径：周期下限，无窗口", () => {
    const { durMs, windows } = pulseCycleTiming([]);
    expect(durMs).toBe(PULSE_MIN_CYCLE_MS);
    expect(windows).toHaveLength(0);
  });
});

describe("pulseOpacityKeyframes", () => {
  it("keyTimes 非降且在 [0,1]，values/keyTimes 等长，首尾停泊透明", () => {
    for (const [b, e] of [
      [0, 1],
      [0.25, 0.6],
      [0.98, 1],
      [0, 0.02],
    ] as const) {
      const { values, keyTimes } = pulseOpacityKeyframes(b, e);
      const vs = values.split(";").map(Number);
      const ts = keyTimes.split(";").map(Number);
      expect(vs.length).toBe(ts.length);
      expect(ts[0]).toBe(0);
      expect(ts[ts.length - 1]).toBe(1);
      for (let i = 1; i < ts.length; i++) expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
      for (const t of ts) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
      expect(vs[0]).toBe(0); // 起点停泊透明
      expect(vs[vs.length - 1]).toBe(0); // 终点停泊透明
      expect(Math.max(...vs)).toBeCloseTo(0.9, 3); // 窗口内达峰值
    }
  });

  it("scale 缩放峰值（光晕层）", () => {
    const { values } = pulseOpacityKeyframes(0, 1, 0.3);
    expect(Math.max(...values.split(";").map(Number))).toBeCloseTo(0.27, 3);
  });
});
