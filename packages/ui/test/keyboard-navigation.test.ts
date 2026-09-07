// 键盘导航与连线状态机单测（MM-089；AC-17）：方向锥判定、边界（无候选/自
// 身/锥外）、确定性；linking 流的 begin/retarget/confirm/cancel。

import { describe, expect, it } from "vitest";
import {
  linkingReducer,
  nearestNodeInDirection,
  type MindFlowNodeLite,
} from "../src/canvas/keyboard-navigation.js";

type Lite = MindFlowNodeLite;
const n = (id: string, x: number, y: number, w = 100, h = 40): Lite => ({
  id,
  position: { x, y },
  width: w,
  height: h,
});

describe("nearestNodeInDirection", () => {
  const nodes = [
    n("me", 0, 0),
    n("down", 10, 200), // 正下方
    n("downFar", 10, 600),
    n("right", 300, 5),
    n("diag", 260, 180), // 右下 45°（在 right/down 锥内）
    n("behind", 0, -300), // 上方（down 锥外）
  ];

  it("down 取最近的正下方", () => {
    expect(nearestNodeInDirection(nodes, "me", "down")).toBe("down");
  });
  it("right 取正右；反向可达（up 从 me 到 behind）", () => {
    expect(nearestNodeInDirection(nodes, "me", "right")).toBe("right");
    expect(nearestNodeInDirection(nodes, "down", "up")).toBe("me");
    expect(nearestNodeInDirection(nodes, "me", "up")).toBe("behind"); // behind 在 me 正上方
    expect(nearestNodeInDirection([n("solo", 0, 0)], "solo", "up")).toBeNull(); // 无候选
  });
  it("斜 45° 在两个方向的锥内（就近原则）", () => {
    // diag 相对 me 是右下 45°：down 方向它比 down 远（主轴 180 vs 200）——180 更近
    expect(nearestNodeInDirection(nodes, "me", "down")).toBe("down");
    const d = nearestNodeInDirection(
      nodes.map((x) => (x.id === "down" ? n("down", 10, 2000) : x)),
      "me",
      "down",
    );
    expect(d).toBe("diag"); // down 被挪远后斜向胜出
  });
  it("单节点/未知 id：null", () => {
    expect(nearestNodeInDirection([n("only", 0, 0)], "only", "down")).toBeNull();
    expect(nearestNodeInDirection(nodes, "ghost", "down")).toBeNull();
  });
  it("确定性：同输入同输出", () => {
    const a = nearestNodeInDirection(nodes, "me", "down");
    const b = nearestNodeInDirection([...nodes].reverse(), "me", "down");
    expect(a).toBe(b);
  });
});

describe("linkingReducer（键盘连线流）", () => {
  const nodes = [n("a", 0, 0), n("b", 0, 200), n("c", 300, 0)];

  it("begin → retarget → confirm 产出 source/target；cancel 归 idle", () => {
    let s = linkingReducer({ phase: "idle" }, { type: "begin", sourceId: "a" }, nodes);
    expect(s.state.phase).toBe("linking");
    expect(s.state.phase === "linking" && s.state.candidateId).toBeNull();

    s = linkingReducer(s.state, { type: "retarget", direction: "down" }, nodes);
    expect(s.state.phase === "linking" && s.state.candidateId).toBe("b");

    const done = linkingReducer(s.state, { type: "confirm" }, nodes);
    expect(done.confirmed).toEqual({ source: "a", target: "b" });
    expect(done.state.phase).toBe("idle");

    // cancel 路径
    const s2Begin = linkingReducer(
      { phase: "idle" },
      { type: "begin", sourceId: "a" },
      nodes,
    ).state;
    const s2 = linkingReducer(s2Begin, { type: "retarget", direction: "right" }, nodes).state;
    const cancelled = linkingReducer(s2, { type: "cancel" }, nodes);
    expect(cancelled.state.phase).toBe("idle");
    expect(cancelled.confirmed).toBeNull();
  });

  it("confirm 无候选时保持 linking（不产出空连接）", () => {
    const s = linkingReducer({ phase: "idle" }, { type: "begin", sourceId: "a" }, nodes).state;
    const noTarget = linkingReducer(s, { type: "confirm" }, nodes);
    expect(noTarget.confirmed).toBeNull();
    expect(noTarget.state.phase).toBe("linking"); // 仍可继续选
  });
});
