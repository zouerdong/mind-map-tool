# Planning

2026-09-12 当前派发更新：`R2-F1_STAGE_A_ACCEPTED / STAGE_B_READY / PRR-070_BLOCKED`。阶段 A 最终 source `0da0d406a3d9b9041921d470363d7db52d5f59f9` 已独立接受，见[独立审阅](../quality/prr-069c-r2-f1-independent-review-2026-09-12.md)。当前唯一执行入口为[阶段 B 三轮原生预检任务卡](./prr-069c-r2-f1-stage-b-native-precheck-task-card-2026-09-12.md)；阶段 B 再次独立审阅接受前，PRR-070/080/090 与 G-FINAL 保持阻塞。旧路线与本更新冲突时，以本更新与阶段 B 卡为准。

本目录是经过规划审阅的开发交付入口，保存架构提案、开发指导和任务卡。每个批次分别记录审阅方式、用户批准状态和可派发条件。

## 2026-09-07 发布前终审整改批次

PRC-000～PRC-090 已由执行 Agent 回报完成，但 2026-09-07 的独立复算结论为 `REJECT / NOT_READY_TO_RELEASE`。旧候选、旧 MM-110 `ACCEPT` 与旧 `READY_TO_RELEASE` 交接包只保留审计用途，不得作为签名、公证或公开发布输入。

- [全面代码审阅](../quality/pre-release-code-review-2026-09-07.md)：候选、实现、runner 和证据链的独立结论及已完成的小修。
- [PRR-000～050 实现审阅](../quality/prr-000-050-implementation-review-2026-09-07.md)：执行 Agent 本轮代码 diff 的独立复核、审阅修复和剩余 Gate。
- [终审整改开发指南](./pre-release-remediation-development-guide-2026-09-07.md)：新候选的完成定义、技术路线与验收协议。
- [终审整改任务卡](./pre-release-remediation-task-cards-2026-09-07.md)：PRR-000～PRR-090；PRR-000～080 供执行 Agent，PRR-090 保留给独立验收；涉及生产配置、许可证、删除或发布动作时仍受负责人 Gate 约束。

当前整改批次状态为 `IN_PROGRESS / R2-F1_STAGE_A_ACCEPTED / STAGE_B_READY / PRR-070_BLOCKED`。PRR-067 协议、PRR-068 C 方案图标和 ULMO 确定性装配方向保持不变；历史候选与证据继续只读保留。

## 2026-09-07 发布前收口批次（历史）

本批次把此前终审中仍未关闭的条件整理为 PRC-000～PRC-090。执行已经回报完成，但最终证据被后续独立审阅推翻；批次状态为 `EXECUTED / FINAL_REVIEW_REJECTED / SUPERSEDED_BY_PRR`。

- [发布前收口开发指南](./pre-release-closure-development-guide-2026-09-07.md)：v1 权威范围、完成层级、Gate、技术路线与最终验收口径。
- [发布前收口任务卡](./pre-release-closure-task-cards-2026-09-07.md)：PRC-000～PRC-090 的允许范围、红灯用例、命令、STOP 条件与交接物。
- [终审输入](../../.omx/reviews/2026-09-07-mrt-post-vra-final-review.md)：当前代码、测试、候选证据和发布治理的事实基线。

本批次明确按已批准 PRD/ADR 执行：v1 的 required platform 是 macOS Apple Silicon；Windows 属于后续专门版本，只保留移植准备与 `deferred/not-run` 记录，不作为本次 v1 原生发布阻塞。由于修订现有 quality/CI 判定仍属于发布门变更，必须先取得任务卡定义的 `G-PRC-SCOPE`。

文件使用 `pre-release-closure-<purpose>-2026-09-07.md`。这些文件现在是历史执行输入；后续不得继续从中派发，也不得通过补写旧证据恢复其发布结论。

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
