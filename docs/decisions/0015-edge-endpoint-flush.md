# ADR 0015：边端点贴卡缘（endpointGap 4 → 0）

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-09-17
- Deciders: 项目负责人（2026-09-17 dogfood 定稿：「按 A 建议来」）/ 主会话（工程实现）
- 任务来源: 负责人审阅无头导出 PNG 时发现：「橙色 idea 卡生出的线条，好几条都没有连到卡的边缘上，都断了」

## Context

视觉原型 tokens §1.4 定有「端点 gap 4px 卡边界外留缝」，`EDGE_VISUAL.endpointGap = 4`，
边几何构建时线头沿「源→目标」方向从卡缘推出 4px、箭头尖对称缩回 4px。
GUI 画布与三格式导出消费同一几何（ADR 0004 契约），该留缝因此存在于所有呈现面。

2026-09-17 无头导出 dogfood：静态 2x PNG 下，根卡一出 5 条线时 8px（2x）悬空非常刺眼，
负责人判定视觉上是「断了」。几何探针实测确认非回归、非分栏布局引入（旧布局同样存在）。

## Decision

`EDGE_VISUAL.endpointGap` 由 **4 改为 0**，全局生效（GUI 画布 + PNG/SVG/PDF 导出）：

- 线头从卡边界确切发出；箭头尖贴在目标卡边界上；
- 不引入「仅导出改、GUI 不改」的分叉——同一几何契约（ADR 0004）不可破坏；
- 导出 golden（语义 SVG / 视觉 PNG / PDF 三层）按 REGEN 流程重基线，本 ADR 即变更原因记录；
- 原型 tokens §1.4「端点 gap 4px」自此作废，以本 ADR 为准。

## Consequences

- GUI 画布视觉微调：所有连线端点贴卡缘。属冻结 G-VIS 视觉契约的修订，已获负责人口径；
- golden 基线整体平移（边几何变化），verify-evidence 冻结的旧候选 hash 不受影响（绑定的是 DMG/可执行体，非 golden）；
- 候选重建（开源换证批次）将携带本变更，重跑验收门时以新基线为准。
