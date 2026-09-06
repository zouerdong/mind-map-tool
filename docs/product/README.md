# Product

产品需求的事实来源。这里记录用户问题、目标用户、核心旅程、范围、非目标、约束和可测试验收标准。

当前审定产品规划见 [v1-product-spec.md](./v1-product-spec.md)。探索过程、自动化访谈和共识审查保留在 `.omx/` 以便追溯，但不能与这里的正式结论冲突。

2026-09-06 参考对齐增补见 [visual-target-brief-2026-09-06.md](./visual-target-brief-2026-09-06.md)。它区分用户已指定的视觉目标、媒体观察与待确认的产品语义，不自动替代 PRD 或 Accepted ADR。参考增补使用 `visual-target-brief-YYYY-MM-DD.md` 命名，由规划作者维护；新版本批准后标记旧版状态并保留审计记录，不自动删除。

VRA-010 原型规格（G-VIS 校准材料，未获批不进生产代码）：

- [visual-state-tokens-2026-09-06.md](./visual-state-tokens-2026-09-06.md)：暖白/黑板设计 token、状态矩阵视觉规格、极简 App Shell 提案、D1–D6 决策包与旧文档兼容方向。
- [visual-motion-contract-2026-09-06.md](./visual-motion-contract-2026-09-06.md)：800ms 整理动效时间线、打断/重入状态机、reduced-motion 与原型验收取样。
- 隔离原型 `tests/visual-prototype/reference-prototype.html` 与合成夹具 `tests/fixtures/visual/`；证据 `artifacts/visual-prototype-2026-09-06/`（本地可再生）。
