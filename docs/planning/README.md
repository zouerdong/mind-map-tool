# Planning

2026-09-16 OFR 收口：`还原形态被第二跳投影覆盖已修复（d6dc8cc）/ test:unit 733/733 全绿 / 新候选已安装待负责人目视`。根因为还原 commit 与 app 侧 revision bump 拆成两次投影：第二跳把 reverseTo（morph→0）覆盖回 start（morph→1）；修复为同一文档对象的运行中动画不重启。详见[报告 §十二末条](../quality/dogfood-repair-report-2026-09-13.md)。新候选 DMG sha256 `53105e742705d34a…`；待负责人做整理/还原循环目视确认，G-FINAL 未申请。

2026-09-15 出口合并轮：`保存/另存为/导出已合并为统一「存储为…」面板 / 原生全路径 32/32 PASS / 候选已安装待体验`。保存仅 .mindmap；统一面板五格式分组；未保存文档选导出格式自动补写同名源文件。Graph JSON 导出改用纯 .json 扩展名。详见[报告 §十二](../quality/dogfood-repair-report-2026-09-13.md)。verify-decision 证据已按方案 B 迁入版本库并重冻结，test:unit 726/726 全绿。

2026-09-15 第三轮：`OFR-2026-09-15 两项反馈已修复（5c0b947）/ 原生速验通过 / 清理事故待决定`。长文本软换行（卡宽回归 G-VIS 120–260 上限、纵向生长）与引导"下一步/计步/末步错接"已修复并实机验证。同日清理误删 `.tmp/runtime-spike/` 冻结证据致 verify-decision 3 项红灯，重冻结方案（A 补跑重冻结 / B 证据入库）待负责人批准，见[报告 §十一](../quality/dogfood-repair-report-2026-09-13.md)。

2026-09-15 OFR 收口：`OFR-2026-09-14 #1～#7 全部修复 / R2 原生全路径 26 项断言 PASS / STOP_FOR_INDEPENDENT_REVIEW`。负责人第二次实用反馈七项全部修复；R1 原生验证暴露 #3 初修无效（rfd 在 macOS 合并 filter 进 allowedFileTypes，系统不显示格式 popup），`bd1fdae` 改为自承载 NSSavePanel accessory 格式选择后全绿。新候选 source `bd1fdae`，DMG sha256 `570e10b2f7864abb…`。详见[报告 §十](../quality/dogfood-repair-report-2026-09-13.md)。旧 DMG 继续作废；G-FINAL 未申请。

2026-09-14 R2 复审收口：`DFR-090 R2-F1/F2/F3 REVISE 收口完成 / STOP_FOR_INDEPENDENT_REVIEW`。四个独立反例入库先红后绿；新候选 source `5c46547`，DMG sha256 `567b4f0974e06e22…`，原生短路径 51 项断言全过（B→A+ 逆序、文楷描边模拟、编辑保存重开、四格式导出），导出 PNG 视觉对照通过。详见[报告 §八](../quality/dogfood-repair-report-2026-09-13.md)。上轮"43 项"勘误为 49。停等独立审阅；G-FINAL 未申请。

2026-09-14 返修回报：`DFR-090 F1/F2 REVISE 收口完成 / STOP_FOR_INDEPENDENT_REVIEW`。新候选 source `4b5d054`，DMG sha256 `c181429c2a2e47c9…`，原生短路径 43 项断言全过（含 F2 续写/编辑中格式/保存重开/四格式导出）。审阅提出的 F1（ready 失败丢意图）与 F2（编辑丢样式/草稿被旧文本覆盖）均已按先红灯后修复收口，另修复原生实测暴露的格式叠加丢字号（toggleWhole）。详见[报告 §七](../quality/dogfood-repair-report-2026-09-13.md)。停等独立审阅；G-FINAL 未申请。

2026-09-14 执行回报：`DFR-010～040 EXECUTED / STOP_FOR_INDEPENDENT_REVIEW`。新候选 source `b1f04f4`（clean worktree），DMG sha256 `00f353a259917228…`，原生 38 项断言全过，四张要求截图齐全。报告：[dogfood-repair-report-2026-09-13.md](../quality/dogfood-repair-report-2026-09-13.md)。停等 DFR-090 独立审阅；旧 DMG 继续作废；G-FINAL 未申请。

2026-09-13 规划交付：[首次试用修复开发指南](./dogfood-repair-development-guide-2026-09-13.md)与[完整任务卡 DFR-010～090](./dogfood-repair-task-cards-2026-09-13.md)。负责人转发整卡并要求执行后，Coding Agent 顺序完成 DFR-010～040，停等独立审阅；界面方案采用、既有补丁复核、允许路径、风险与 STOP 规则以整卡为准。下方为上一轮状态历史，旧 DMG 继续作废。

2026-09-12 当前派发更新：`PRR-070-R2_ACCEPTED / LOCAL_DOGFOOD_REJECTED / RUNTIME_FIX_READY / UX_DECISION_REQUIRED / G-FINAL_NOT_REQUESTED`。负责人实用复现字体切换后的 `projection drift` 整页崩溃，并指出整理入口不可发现、实际画面偏离既定感觉。运行时根因已由审阅者在 `9483634` / `f6d4e6d` 修复；`12f8f92` 进一步恢复 G-VIS 卡片几何和双击直接输入，90 项定向测试、typecheck、lint 通过。旧 DMG 作废。下一步先修订 ADR 0012 的命令面方案，经负责人确认后再实现和生成新试用件。

本目录是经过规划审阅的开发交付入口，保存架构提案、开发指导和任务卡。每个批次分别记录审阅方式、用户批准状态和可派发条件。

## 2026-09-07 发布前终审整改批次

PRC-000～PRC-090 已由执行 Agent 回报完成，但 2026-09-07 的独立复算结论为 `REJECT / NOT_READY_TO_RELEASE`。旧候选、旧 MM-110 `ACCEPT` 与旧 `READY_TO_RELEASE` 交接包只保留审计用途，不得作为签名、公证或公开发布输入。

- [全面代码审阅](../quality/pre-release-code-review-2026-09-07.md)：候选、实现、runner 和证据链的独立结论及已完成的小修。
- [PRR-000～050 实现审阅](../quality/prr-000-050-implementation-review-2026-09-07.md)：执行 Agent 本轮代码 diff 的独立复核、审阅修复和剩余 Gate。
- [终审整改开发指南](./pre-release-remediation-development-guide-2026-09-07.md)：新候选的完成定义、技术路线与验收协议。
- [终审整改任务卡](./pre-release-remediation-task-cards-2026-09-07.md)：PRR-000～PRR-090；PRR-000～080 供执行 Agent，PRR-090 保留给独立验收；涉及生产配置、许可证、删除或发布动作时仍受负责人 Gate 约束。

当前整改批次状态为 `IN_PROGRESS / PRR-070-R2_ACCEPTED / LOCAL_DOGFOOD_REJECTED / UX_DECISION_REQUIRED / G-FINAL_NOT_REQUESTED`。PRR-067 协议、PRR-068 C 方案图标和 ULMO 确定性装配方向保持不变；原 PRR-070/R1/R2 候选与证据只读保留且不得作为发布输入。

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
