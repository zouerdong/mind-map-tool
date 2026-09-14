// MotionCoordinator 契约测试（VRA-060）：
// 单一协调者驱动节点显示坐标、线形态插值（0 散乱曲线 ↔ 1 规整折线）、
// 错峰（叶子优先、上限 120ms）、拖拽打断、undo 反向接续、reduced-motion 归零、300+ 节点降级。

import { describe, expect, it, vi } from "vitest";
import type { MindMapDocumentV1, Point } from "@mindmap/core";
import {
  computeCoordinatedViewport,
  computeNodeDelays,
  computeNodeDepths,
  easeOutCubic,
  MOTION_TIMELINE,
  MotionCoordinator,
  type MotionFrame,
} from "../src/canvas/motion-coordinator.js";

function makeDoc(nodesCount = 3): MindMapDocumentV1 {
  const nodes = Array.from({ length: nodesCount }, (_, i) => ({
    id: `n${i + 1}`,
    text: `节点 ${i + 1}`,
    position: { x: i * 100, y: i * 50 },
    size: { width: 120, height: 40 },
  }));
  const edges = Array.from({ length: nodesCount - 1 }, (_, i) => ({
    id: `e${i + 1}`,
    sourceNodeId: `n${i + 1}`,
    targetNodeId: `n${i + 2}`,
  }));
  return {
    schemaVersion: 1,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes,
      edges,
    },
  };
}

describe("MotionCoordinator 基础契约与算法", () => {
  it("easeOutCubic：单调递增、零超调、首尾归一", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 5); // 1 - (1-0.5)^3 = 0.875
    // 边界 clamp
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(1.5)).toBe(1);

    // 单调递增
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("computeNodeDepths：正确计算拓扑层级（根=0，深层递增）", () => {
    const doc = makeDoc(4); // n1 -> n2 -> n3 -> n4
    const depths = computeNodeDepths(doc);
    expect(depths.get("n1")).toBe(0);
    expect(depths.get("n2")).toBe(1);
    expect(depths.get("n3")).toBe(2);
    expect(depths.get("n4")).toBe(3);
  });

  it("computeNodeDelays：叶子先动（delay=0）、主干最后归位、上限 120ms", () => {
    const doc = makeDoc(4); // n1 -> n2 -> n3 -> n4 (maxDepth = 3)
    const delays = computeNodeDelays(doc);
    // 叶子 n4 深度最大 (3) -> delay = (3-3)*25 = 0ms
    expect(delays.get("n4")).toBe(0);
    // n3 (2) -> delay = (3-2)*25 = 25ms
    expect(delays.get("n3")).toBe(25);
    // n2 (1) -> delay = (3-1)*25 = 50ms
    expect(delays.get("n2")).toBe(50);
    // 根 n1 (0) -> delay = (3-0)*25 = 75ms
    expect(delays.get("n1")).toBe(75);

    // 深链上限 ≤ 120ms
    const deepDoc = makeDoc(10);
    const deepDelays = computeNodeDelays(deepDoc);
    for (const d of deepDelays.values()) {
      expect(d).toBeLessThanOrEqual(MOTION_TIMELINE.maxDelay);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("规模降级：≥300 节点取消错峰（所有节点 delay=0）", () => {
    const doc = makeDoc(300);
    const delays = computeNodeDelays(doc);
    expect(delays.size).toBe(300);
    for (const d of delays.values()) {
      expect(d).toBe(0);
    }
  });

  it("computeCoordinatedViewport：视口前后边界并集+80px安全留白", () => {
    const doc = makeDoc(2);
    const from = new Map([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 100, y: 100 }],
    ]);
    const to = new Map([
      ["n1", { x: 200, y: 0 }],
      ["n2", { x: 400, y: 200 }],
    ]);

    const { target, needed } = computeCoordinatedViewport(from, to, doc, 1000, 800);
    expect(needed).toBe(true);
    expect(target.zoom).toBeLessThanOrEqual(1.0);
    expect(target.zoom).toBeGreaterThanOrEqual(0.2);

    // 当终态已在视口范围内且有足够留白时，needed=false（不打扰用户）
    const safeVp = { x: 500, y: 500, zoom: 1 };
    const res = computeCoordinatedViewport(from, to, doc, 2000, 2000, safeVp);
    expect(res.needed).toBe(false);
  });
});

describe("MotionCoordinator 运行生命周期与帧驱动", () => {
  it("start -> tick 驱动显示坐标与形态参数平滑演进直至完成", () => {
    const coordinator = new MotionCoordinator();
    const doc = makeDoc(3);
    const from = new Map<string, Point>([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 0, y: 50 }],
      ["n3", { x: 0, y: 100 }],
    ]);
    const to = new Map<string, Point>([
      ["n1", { x: 100, y: 0 }],
      ["n2", { x: 200, y: 50 }],
      ["n3", { x: 300, y: 100 }],
    ]);

    const frames: MotionFrame[] = [];
    const onComplete = vi.fn();

    coordinator.start(doc, from, to, {
      manualTick: true,
      onFrame: (f) => frames.push(f),
      onComplete,
    });

    expect(coordinator.getPhase()).toBe("running");

    // 模拟时间推进：0ms, 200ms, 400ms, 600ms, 800ms
    const t0 = (coordinator as unknown as { t0: number }).t0;
    coordinator.tick(t0 + 200);
    coordinator.tick(t0 + 400);
    coordinator.tick(t0 + 600);
    coordinator.tick(t0 + 800);

    expect(frames.length).toBeGreaterThanOrEqual(4);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(coordinator.getPhase()).toBe("completed");

    // 终态坐标精确到达
    const finalPos = coordinator.getCurrentPositions();
    expect(finalPos.get("n1")).toEqual({ x: 100, y: 0 });
    expect(finalPos.get("n2")).toEqual({ x: 200, y: 50 });
    expect(finalPos.get("n3")).toEqual({ x: 300, y: 100 });
    expect(coordinator.getCurrentLineMorph()).toBe(1);

    // 帧中每条边均生成了有效的 pathD 和 arrowD
    const lastFrame = frames[frames.length - 1]!;
    expect(lastFrame.edgePaths.size).toBe(2);
    expect(lastFrame.edgePaths.get("e1")?.pathD).toContain("M");
    expect(lastFrame.edgePaths.get("e1")?.arrowD).toContain("M");
  });

  it("reduced-motion：直接呈现终态，时长归零", () => {
    const coordinator = new MotionCoordinator();
    const doc = makeDoc(2);
    const from = new Map([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 50, y: 50 }],
    ]);
    const to = new Map([
      ["n1", { x: 200, y: 100 }],
      ["n2", { x: 300, y: 200 }],
    ]);

    let finalFrame = null as MotionFrame | null;
    const onComplete = vi.fn();

    coordinator.start(doc, from, to, {
      reducedMotion: true,
      onFrame: (f) => {
        finalFrame = f;
      },
      onComplete,
    });

    expect(coordinator.getPhase()).toBe("completed");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(coordinator.getCurrentPositions().get("n1")).toEqual({ x: 200, y: 100 });
    expect(coordinator.getCurrentLineMorph()).toBe(1);
    expect((finalFrame as MotionFrame | null)?.positions.get("n2")).toEqual({ x: 300, y: 200 });
  });

  it("拖动打断：被拖节点立即交出控制，其余节点继续整理", () => {
    const coordinator = new MotionCoordinator();
    const doc = makeDoc(3);
    const from = new Map([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 0, y: 50 }],
      ["n3", { x: 0, y: 100 }],
    ]);
    const to = new Map([
      ["n1", { x: 100, y: 0 }],
      ["n2", { x: 200, y: 50 }],
      ["n3", { x: 300, y: 100 }],
    ]);

    coordinator.start(doc, from, to, { manualTick: true });
    const t0 = (coordinator as unknown as { t0: number }).t0;

    // 推进到 400ms
    coordinator.tick(t0 + 400);

    // 用户在 mid-animation 拖动 n2
    coordinator.interruptNode("n2", { x: 999, y: 888 });
    expect(coordinator.getCurrentPositions().get("n2")).toEqual({ x: 999, y: 888 });

    // 走完动画
    coordinator.tick(t0 + 800);
    expect(coordinator.getPhase()).toBe("completed");
    // n1, n3 到达 target，n2 保持被拖拽位置
    expect(coordinator.getCurrentPositions().get("n1")).toEqual({ x: 100, y: 0 });
    expect(coordinator.getCurrentPositions().get("n2")).toEqual({ x: 999, y: 888 });
    expect(coordinator.getCurrentPositions().get("n3")).toEqual({ x: 300, y: 100 });
  });

  it("reverseTo（undo 接续）：从当前显示位置恢复历史态，lineMorph 回退至 0", () => {
    const coordinator = new MotionCoordinator();
    const doc = makeDoc(2);
    const scattered = new Map([
      ["n1", { x: -50, y: 20 }],
      ["n2", { x: 80, y: 300 }],
    ]);
    const organized = new Map([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 150, y: 0 }],
    ]);

    // 先运行整理
    coordinator.start(doc, scattered, organized, { manualTick: true });
    const t0 = (coordinator as unknown as { t0: number }).t0;
    coordinator.tick(t0 + 800);
    expect(coordinator.getCurrentLineMorph()).toBe(1);

    // 用户触发 undo：调用 reverseTo 回到 scattered
    const undoFrames: MotionFrame[] = [];
    const onComplete = vi.fn();
    coordinator.reverseTo(doc, scattered, {
      manualTick: true,
      onFrame: (f) => undoFrames.push(f),
      onComplete,
    });

    expect(coordinator.getPhase()).toBe("running");
    const tUndo = (coordinator as unknown as { t0: number }).t0;
    coordinator.tick(tUndo + 300);
    coordinator.tick(tUndo + 600);

    expect(coordinator.getPhase()).toBe("completed");
    expect(coordinator.getCurrentPositions().get("n1")).toEqual({ x: -50, y: 20 });
    expect(coordinator.getCurrentPositions().get("n2")).toEqual({ x: 80, y: 300 });
    expect(coordinator.getCurrentLineMorph()).toBe(0); // 彻底回退至曲线形态
  });
});

describe("DFR-020 规整态驻留（settledEdgePaths）", () => {
  it("整理完成后：再次编辑/拖动按驻留 lineMorph 重算整态连线；散乱态返回 null", () => {
    const coordinator = new MotionCoordinator();
    const doc = makeDoc(3);
    const from = new Map(doc.document.nodes.map((n) => [n.id, { ...n.position }]));
    const to = new Map([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 300, y: 0 }],
      ["n3", { x: 600, y: 0 }],
    ]);

    // 散乱态（未整理）：无驻留几何
    expect(coordinator.settledEdgePaths(doc)).toBeNull();

    coordinator.start(doc, from, to, { reducedMotion: true });
    expect(coordinator.getLineMorph()).toBe(1);

    // 整理后文档发生普通编辑（节点尺寸变化），驻留几何必须按最新 doc 重算
    const edited = makeDoc(3);
    edited.document.nodes = edited.document.nodes.map((n, i) => ({
      ...n,
      position: to.get(n.id)!,
      size: { width: 120 + i * 40, height: 40 },
    }));
    const paths = coordinator.settledEdgePaths(edited);
    expect(paths).not.toBeNull();
    expect(paths!.size).toBe(2);
    expect(paths!.get("e1")!.pathD.length).toBeGreaterThan(0);
    expect(paths!.get("e1")!.arrowD.length).toBeGreaterThan(0);

    // undo 回散乱态（reverseTo 终态 morph=0）后不再驻留
    coordinator.reverseTo(edited, from, { reducedMotion: true });
    expect(coordinator.getLineMorph()).toBe(0);
    expect(coordinator.settledEdgePaths(edited)).toBeNull();
  });
});

describe("OFR-2026-09-14 #2 驻留期拖动实时连线（settledEdgePathsFor）", () => {
  it("整理后拖动：按显式实时位置重算连线；散乱态返回 null；不污染动画基线", () => {
    const coordinator = new MotionCoordinator();
    const doc = makeDoc(3);
    const from = new Map(doc.document.nodes.map((n) => [n.id, { ...n.position }]));
    const to = new Map([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 300, y: 0 }],
      ["n3", { x: 600, y: 0 }],
    ]);

    // 散乱态：实时接口同样返回 null（走投影默认曲线）
    expect(coordinator.settledEdgePathsFor(doc, from)).toBeNull();

    coordinator.start(doc, from, to, { reducedMotion: true });
    expect(coordinator.getLineMorph()).toBe(1);

    // 驻留静止态基准 = 动画终态位置集
    const settled = coordinator.settledEdgePathsFor(doc, to)!;
    // 拖动 n2 到新位置（doc 未提交，位置来自受控 view-model）
    const dragged = new Map(to);
    dragged.set("n2", { x: 300, y: 220 });
    const live = coordinator.settledEdgePathsFor(doc, dragged);
    expect(live).not.toBeNull();
    expect(live!.size).toBe(2);
    // 连线几何跟随拖动位置（与驻留静止态不同）
    expect(live!.get("e1")!.pathD).not.toBe(settled.get("e1")!.pathD);
    expect(live!.get("e1")!.pathD.length).toBeGreaterThan(0);
    // 动画基线不被拖动中途污染：currentPositions 仍是动画终态
    expect(coordinator.getCurrentPositions().get("n2")).toEqual({ x: 300, y: 0 });
    // 拖回原点：几何与驻留静止态一致
    const back = coordinator.settledEdgePathsFor(doc, to);
    expect(back!.get("e1")!.pathD).toBe(settled.get("e1")!.pathD);
  });
});
