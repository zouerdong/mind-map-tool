# ADR 0021：初始 entry JS 预算重基线（500,000 → 550,000 bytes）

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-09-21
- Deciders: 项目负责人（2026-09-21 v1.0.0 窄门重验中批准路线 1：ADR 重定基线）/ 主会话（成分分析与工程实现）
- 任务来源: v1.0.0 发布流程第 1 步窄门重验，`pnpm quality` 的 assets 门实测 initial entry JS = 514,016B，超过既有 500,000B 预算 14,016B（2.8%）。

## Context

1. **预算起源**：500,000B 预算定于 RLS-013/PRR-020 时代（v0.3.0 之前）。当时实测
   495,995B，仅余 4,005B；规划文档同时写明「不能抬阈值掩盖回归」「预算不可由实现者
   修改」的反棘轮条款——该条款约束的是实现者用抬阈值掩盖失控回归，不约束负责人
   基于证据的正式重基线（先例：ADR 0006 v1.2.0 安装包预算 25MB → 100MB）。
2. **暴露路径**：v0.3.0～v0.3.2 三个批次的功能增长（整理三方向与零交叉布线、层级
   调色板、来路脉冲、框选、边缘选中、MCP 枚举等）正常累积推进入口体积；这三批的
   验收记录只跑了 unit/golden/typecheck/lint/format，未跑 assets 门，故越线直到
   v1.0.0 窄门重验才被发现。版本号 bump（0.3.2 → 1.0.0）只改 `tauri.conf.json`，
   前端不引用该文件，与本次越线无关。
3. **成分证据**（2026-09-21 sourcemap 聚合分析，源字节）：react-dom 545K、
   @xyflow/react + @xyflow/system 386K、一方代码（packages/ui·core·export·platform
   + app 层）约 390K、d3-*（xyflow 传递依赖）约 90K。**无误打包**：PDF/PNG 渲染器
   已是独立懒加载 chunk（render-pdf 1.1MB 不进 entry）；terser 双 pass +
   drop_console 已在用。entry 即「react-dom + xyflow + 一方代码」的启动硬底线。
4. **影响评估**：本地优先 Tauri 应用从磁盘加载 entry，不经网络；14KB minified 对
   启动体感无实质影响。真实启动性能由 ADR 0006 的冷/热启动实测门兜底
   （`conditionedColdStartP95Ms ≤ 1500ms` 等），entry 预算只是早期预警代理指标。

## Decision

1. **预算重基线**：`scripts/quality/measure-release-assets.mjs` 的
   `initialEntryJsBytes` 由 500,000 调整为 **550,000 bytes**，为后续功能保留约
   6.5% 余量（对当前实测 514,016B）。
2. **反棘轮条款保留并强化**：实现者仍不得为通过门禁而抬阈值；今后任何 entry 预算
   调整必须（a）附 sourcemap 成分分析证据、（b）负责人书面批准、（c）登记为本
   ADR 的修订版本。拆 manualChunks 把启动必需模块挪出 entry 文件属于「假达标」，
   明确禁止作为达标手段（初始加载量不变，只改变门禁口径）。
3. **同步点**：`apps/desktop/vite.config.ts` 注释、`docs/quality/release-checklist.md`
   门禁表随本 ADR 更新；规划历史文档（2026-09-07 PRR 批次）中的 500,000B 记述为
   历史快照，不回改。
4. **不改变**任何功能、依赖、拆包策略与 ADR 0006 的性能实测预算；本 ADR 只调整
   entry 文件体积阈值。

## Consequences

- assets 门对当前候选恢复 PASS；`releasePerformance`/`evidence` 门仍按 fail-closed
  设计等待 v1.0.0 真实候选产物与 `--release-evidence` manifest。
- v1.0.0 发布流程可继续进入双平台重打包。
- 后续版本 entry 接近 550,000B 时，应优先做成分分析排查误打包，再考虑是否申请
  新一轮重基线。
