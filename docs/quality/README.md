# Quality

记录可测量的非功能标准，包括启动耗时、空闲内存、安装包体积、大型脑图响应、崩溃恢复、可访问性和 macOS/Windows 兼容矩阵。

指标必须包含测试环境、测量方法、目标值和失败处置；未测量的“轻量”“流畅”不视为验收标准。

当前基线：

- [v1-test-spec.md](./v1-test-spec.md)
- [v1-risk-register.md](./v1-risk-register.md)

## VRA-090 后收口

- [发布前检查清单](./release-checklist.md)：MRT-011/MRT-012 的实现状态、预算与阻塞项。
- [MRT-005～012 实现证据](./evidence/mrt-post-vra-implementation.json)：代码路径、验证命令与未放行原因。
- [MRT-010/MM-110 风险证据](./evidence/mrt-post-vra-risk-evidence.json)：R-001～R-016 的当前状态和残余风险。
- [MRT-010/MM-110 readiness manifest](./evidence/mrt-post-vra-readiness.json)：机器校验的当前证据状态；`BLOCKED` 是预期的 fail-closed 结果，直到 G2、Windows 实机和 clean-source 条件满足。
- [PRC 发布前收口证据目录](./evidence/pre-release/README.md)：PRC-000 源码变更账本及后续收口产物。
- 可复算入口：`pnpm quality`。它会继续执行所有阶段，并在 native release evidence 或 readiness manifest 不满足时返回非零。
