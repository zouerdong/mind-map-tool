# Planning

本目录是经过规划审阅的开发交付入口，保存架构提案、开发指导和任务卡。每个批次分别记录审阅方式、用户批准状态和可派发条件。

## 2026-09-06 参考对齐批次

以下是独立同伴审阅的新增规划，不冒充旧 Ralplan 共识或用户实施批准。审阅与精确哈希见 `.omx/plans/visual-alignment-review-manifest-2026-09-06.json`。

- [审查报告](./visual-alignment-audit-2026-09-06.md)：现有实现、参考差距、复现结果与证据边界。
- [开发行动指南](./visual-alignment-development-guide-2026-09-06.md)：推荐路线、依赖、旧卡映射与验收门。
- [任务卡](./visual-alignment-task-cards-2026-09-06.md)：VRA-000～VRA-090，按前置条件派发。
- [视觉目标增补](../product/visual-target-brief-2026-09-06.md)：用户参考、设计基线建议与状态矩阵。

本轮发现旧 PRD/架构/测试/任务/风险五份镜像与旧共识快照不同；旧快照本身哈希有效。**VRA-000 对账已于 2026-09-06 完成**：全部登记 hash 复验通过；五项 drift 逐项结论、旧问题 → VRA/保留 MRT 卡的 owner 映射、旧「全部 UI 等 MRT-004」规则的显式替代与待用户决策项，见对账报告 [`.omx/reviews/2026-09-06-vra-000-baseline-reconciliation.md`](../../.omx/reviews/2026-09-06-vra-000-baseline-reconciliation.md) 与基线 manifest [`.omx/plans/visual-alignment-baseline-manifest-2026-09-06.json`](../../.omx/plans/visual-alignment-baseline-manifest-2026-09-06.json)。G-BASE 达成后新任务从本批次任务卡派发，旧 v1 镜像不再直接派发；已批准 ADR 与已有验收不因镜像漂移自动失效，旧卡未完成项也未删除。

本批次文件使用 `visual-alignment-<purpose>-YYYY-MM-DD.md`；镜像来自 `.omx/plans/` 审阅快照，由规划作者维护。变更正文后必须重新审阅并更新 manifest；旧版本保留追溯，不自动删除。生产实现授权、产品/schema Gate 和发布授权分别记录。

## 历史规划入口

以下为旧 Ralplan 共识批次的历史镜像；当前已发现漂移，未经 VRA-000 对账不得直接派发。

- [v1-development-guide.md](./v1-development-guide.md)：项目阶段、决策门、执行顺序和派发规则。
- [v1-architecture-proposal.md](./v1-architecture-proposal.md)：可执行架构提案；在 G1 Accepted ADR 前不是既定技术事实。
- [v1-task-cards.md](./v1-task-cards.md)：历史 MM 任务卡；冻结直接派发，范围承接见新指南。

正式产品事实见 `docs/product/`，测试与风险基线见 `docs/quality/`，已采纳技术决定只能写入 `docs/decisions/` 的 Accepted ADR。`.omx/` 保存访谈、规划快照、审查意见和哈希，用于审计，不替代用户 Gate 批准。
