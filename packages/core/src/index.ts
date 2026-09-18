// @mindmap/core — 平台无关脑图领域层。
// 禁止依赖：React / React Flow / Tauri / 文件系统 / DOM（check-boundaries 强制）。
//
// 模块导航：
// - schema.ts          V1 schema、上限与语义校验（theme/font/shape/节点形状覆盖）
// - canonical.ts       canonical UTF-8 JSON 编解码（可 hash/golden）
// - identity.ts        StateIdentity（进程内永不复用）
// - commands.ts        纯函数命令模型 + 逆命令
// - history.ts         undo/redo（原 identity 返回；新命令截断 redo）
// - document-session.ts 保存快照/dirty/串行化保存队列/opaque handle+token
// - organize.ts        一键整理（分层布局纯函数 → 单条 MoveNodes，MM-085）
// - strong-components.ts Tarjan SCC（organize 与 node-depth 共享，ADR 0020 抽取）
// - node-depth.ts      层级深度派生（ADR 0020；缩点 DAG BFS 最短路径，不落 schema）

export const CORE_PACKAGE_VERSION = "0.1.0";

export * from "./schema.js";
export * from "./canonical.js";
export * from "./identity.js";
export * from "./commands.js";
export * from "./history.js";
export * from "./document-session.js";
export * from "./organize.js";
export * from "./node-depth.js";
