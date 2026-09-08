# Quality

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
- [PRR-066 性能整改卡](../planning/prr-066-performance-remediation-task-card-2026-09-08.md)：五项根因已修复（clean commit `f5f8872`）；预检证据 `.tmp/prr-066-f5f8872/`（release-performance-raw/summary.json），`--scope release --samples 20` 全部预算 PASS；状态 `PRR-066 COMPLETE / READY_FOR_INDEPENDENT_REVIEW`，不构成发布放行（G-FINAL 与 PRR-070/080/090 保持阻塞）。
- [发布前检查清单](./release-checklist.md)：当前真实门禁状态；只有新候选的同源原生证据与负责人 G-FINAL 齐备后才能改为可发布。

## VRA-090 后收口（历史证据）

- [MRT-005～012 实现证据](./evidence/mrt-post-vra-implementation.json)：代码路径、验证命令与未放行原因。
- [MRT-010/MM-110 风险证据](./evidence/mrt-post-vra-risk-evidence.json)：R-001～R-016 的当前状态和残余风险。
- [MRT-010/MM-110 readiness manifest](./evidence/mrt-post-vra-readiness.json)：旧阶段的机器证据；不代表当前候选，Windows 也不属于 macOS Apple Silicon v1 的原生发布范围。
- [PRC 发布前收口证据目录](./evidence/pre-release/README.md)：PRC-000 源码变更账本及后续收口产物。
- 可复算入口：`pnpm quality`。native release evidence、许可、预算或 readiness manifest 不满足时必须返回非零。
