// 键盘几何导航（MM-089；AC-17）：方向键在节点间移动焦点的纯函数。
// 判定：目标节点中心相对当前焦点中心的方向须落在按键方向的 60° 锥内
// （主轴位移为正且横向偏角 < 60°），按「主轴距离 + 角度惩罚」取最近；
// 无候选返回 null。纯函数、确定性（同集合同输入同输出）。

/** 结构化最小节点（投影 view-model 的子集；测试可轻量构造）。 */
export interface MindFlowNodeLite {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

export type NavDirection = "up" | "down" | "left" | "right";

/** 节点中心（投影 view-model 的 position + size）。 */
function centerOf(node: MindFlowNodeLite): { x: number; y: number } {
  return {
    x: node.position.x + (node.width ?? 0) / 2,
    y: node.position.y + (node.height ?? 0) / 2,
  };
}

const AXIS: Record<NavDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** 锥形半角（弧度）：60° 锥 = ±60°，覆盖略偏的目标（更符合直觉）。 */
const CONE_HALF_ANGLE = Math.PI / 3;

export function nearestNodeInDirection(
  nodes: MindFlowNodeLite[],
  fromId: string,
  direction: NavDirection,
): string | null {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const origin = centerOf(from);
  const axis = AXIS[direction];

  let bestId: string | null = null;
  let bestScore = Infinity;

  for (const n of nodes) {
    if (n.id === fromId) continue;
    const c = centerOf(n);
    const vx = c.x - origin.x;
    const vy = c.y - origin.y;
    const mainAxis = vx * axis.dx + vy * axis.dy; // 主轴投影（须为正）
    if (mainAxis <= 0) continue;
    const len = Math.hypot(vx, vy);
    const angle = Math.acos(Math.min(1, mainAxis / len)); // 与按键方向夹角
    if (angle > CONE_HALF_ANGLE) continue;
    const score = mainAxis + angle * len * 0.5; // 距离为主，偏角惩罚
    if (score < bestScore) {
      bestScore = score;
      bestId = n.id;
    }
  }
  return bestId;
}

/**
 * 键盘连线状态机（纯）：⌘L 从 source 发起 → 方向键换候选 → Enter 确认 / Esc 取消。
 * 候选 = 全部其他节点中可被方向键到达的第一个（复用导航判定）；
 * 确认产出 {source, target}，由调用方走 InteractionController.connect。
 */
export type LinkingState =
  | { phase: "idle" }
  | { phase: "linking"; sourceId: string; candidateId: string | null };

export type LinkingAction =
  | { type: "begin"; sourceId: string }
  | { type: "retarget"; direction: NavDirection }
  | { type: "confirm" }
  | { type: "cancel" };

export function linkingReducer(
  state: LinkingState,
  action: LinkingAction,
  nodes: MindFlowNodeLite[],
): { state: LinkingState; confirmed: { source: string; target: string } | null } {
  switch (action.type) {
    case "begin": {
      if (nodes.every((n) => n.id === action.sourceId)) return { state, confirmed: null };
      return {
        state: { phase: "linking", sourceId: action.sourceId, candidateId: null },
        confirmed: null,
      };
    }
    case "retarget": {
      if (state.phase !== "linking") return { state, confirmed: null };
      const from = state.candidateId ?? state.sourceId;
      const next = nearestNodeInDirection(nodes, from, action.direction);
      return { state: { ...state, candidateId: next }, confirmed: null };
    }
    case "confirm": {
      if (state.phase !== "linking" || state.candidateId === null) return { state, confirmed: null };
      return {
        state: { phase: "idle" },
        confirmed: { source: state.sourceId, target: state.candidateId },
      };
    }
    case "cancel":
      return { state: { phase: "idle" }, confirmed: null };
  }
}
