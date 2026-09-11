# Quality

2026-09-11 当前派发更新：`PRR-069C-R2_EXECUTED / STOP_FOR_INDEPENDENT_REVIEW / PRR-070_BLOCKED`。R2 已关闭 R1 独立审阅的 R2-01～04（attach 异常接管、fixture 工具注入闭合、work-dir 路径隔离、DMG 常量模块归位），从同一 clean source `885d877b660a608604c8dc5921aeabd49fd4131e` 连续三轮正式预检全部通过，详情见 [R2 实施报告](./prr-069c-r2-implementation-report-2026-09-11.md)；执行侧自述不构成独立验收，当前唯一待办是 [R2 完整任务卡](../planning/prr-069c-r2-attach-and-path-safety-task-card-2026-09-11.md) 的交回与独立审阅。下文 R1 实施完成、CLOSED、37/37 等描述仅保留执行侧历史报告。R2 独立审阅接受前，不执行 PRR-070/G-FINAL/080/090；如与下文旧派发状态冲突，以本更新与 R2 卡为准。

记录可测量的非功能标准，包括启动耗时、空闲内存、安装包体积、大型脑图响应、崩溃恢复、可访问性和 macOS/Windows 兼容矩阵。

指标必须包含测试环境、测量方法、目标值和失败处置；未测量的“轻量”“流畅”不视为验收标准。

当前基线：

- [v1-test-spec.md](./v1-test-spec.md)
- [v1-risk-register.md](./v1-risk-register.md)

## 2026-09-07 发布前独立审阅

- [PRC-000～PRC-090 全面代码审阅](./pre-release-code-review-2026-09-07.md)：结论为 `REJECT / NOT_READY_TO_RELEASE`；旧候选、旧 MM-110 和旧交接包已降级为审计材料。
- [终审整改开发指南](../planning/pre-release-remediation-development-guide-2026-09-07.md)与[任务卡](../planning/pre-release-remediation-task-cards-2026-09-07.md)：PRR-000～PRR-090 的实施与验收入口。
- [PRR-000～050 实现审阅](./prr-000-050-implementation-review-2026-09-07.md)：实现层有条件接受；最终放行仍被负责人输入、PRR-030/060、冻结候选与 PRR-070～090 阻塞。
- [PRR-070 阶段 A 性能审阅](./prr-070-stage-a-performance-review-2026-09-08.md)：`0c8a93b` 候选因 PNG/CSP、eager loading、RSS 协议和 warm 预算退回 PRR-066；canvas 实际18ms但旧报告口径不一致。
- [PRR-066 性能整改卡](../planning/prr-066-performance-remediation-task-card-2026-09-08.md)与[独立代码及原生预检审阅](./prr-066-independent-review-2026-09-08.md)：五项根因已在 `f5f8872` 修复并接受；诊断证据隔离 P2 已在 `6302866` 修复。PRR-066 结论仍有效，但后继 PRR-070 因新的 cold start 失败再次阻塞。
- [PRR-070 cold start 失败审阅](./prr-070-stage-a-cold-start-review-2026-09-08.md)：source `ea047e8` 的首个 cold 样本1685.4ms导致固定 p95超过1500ms；报告与 hash 闭合，但缺少启动分段，退回 [PRR-067 归因卡](../planning/prr-067-cold-start-attribution-task-card-2026-09-08.md)，不得删样或重跑挑绿。
- [PRR-070 DMG 体积失败审阅](./prr-070-stage-a-dmg-size-review-2026-09-10.md)：source `58003c0` 在步骤 5 因 DMG 25153239B 超过 25000000B 正确 STOP；独立复算确认双份 ICNS 增量与 UTC 时间拓扑缺口，退回 [PRR-069](../planning/prr-069-dmg-compression-remediation-task-card-2026-09-10.md)。
- [PRR-069 独立审阅](./prr-069-independent-review-2026-09-10.md)：ULMO same-run 转换、最终 artifact 绑定和 UTC/clean fail-closed 已接受；其后第二次独立 bundle 再次复现 Finder `.DS_Store` 挂起，故该代码结论保留但派发关系已由 PRR-069C 取代。
- [PRR-070 `.DS_Store` STOP 独立审阅](./prr-070-stage-a-ds-store-blocked-review-2026-09-10.md)：source `b45dc0c` 的第二次独立 clean build 再次进入 Finder 无上限等待；虽然后来自然完成且 DMG 字节有效，仍因预先 STOP 规则作废，退回 [PRR-069C](../planning/prr-069c-deterministic-dmg-assembly-task-card-2026-09-10.md)。
- [PRR-069C-R2 实施报告](./prr-069c-r2-implementation-report-2026-09-11.md)：R2-01～04 处置、红/绿矩阵与三轮正式预检证据（source `885d877`，DMG 24284033/24284017/24284025B）；执行侧自述，等待 [独立审阅](../planning/prr-069c-r2-attach-and-path-safety-task-card-2026-09-11.md)。
- [发布前检查清单](./release-checklist.md)：当前真实门禁状态；只有新候选的同源原生证据与负责人 G-FINAL 齐备后才能改为可发布。

## VRA-090 后收口（历史证据）

- [MRT-005～012 实现证据](./evidence/mrt-post-vra-implementation.json)：代码路径、验证命令与未放行原因。
- [MRT-010/MM-110 风险证据](./evidence/mrt-post-vra-risk-evidence.json)：R-001～R-016 的当前状态和残余风险。
- [MRT-010/MM-110 readiness manifest](./evidence/mrt-post-vra-readiness.json)：旧阶段的机器证据；不代表当前候选，Windows 也不属于 macOS Apple Silicon v1 的原生发布范围。
- [PRC 发布前收口证据目录](./evidence/pre-release/README.md)：PRC-000 源码变更账本及后续收口产物。
- 可复算入口：`pnpm quality`。native release evidence、许可、预算或 readiness manifest 不满足时必须返回非零。
