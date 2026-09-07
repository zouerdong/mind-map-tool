# VRA-090 后剩余路线独立复核

- **复核日期**：2026-09-07
- **复核范围**：MRT-004W2R2、MRT-005～MRT-012、MM-110
- **源 HEAD**：`dc5402184cd49d9a960d5b303063d6d6e75012b1`
- **源状态**：`dirty`（本次实现与先前用户交付均未提交）
- **复核环境**：macOS 26.6.2 (25G83) / arm64 / Node v26.8.1
- **结论**：**CONDITIONAL / BLOCKED**

## 1. 结论摘要

VRA-090 之后仍可在当前授权范围内实施的代码、测试、质量脚本和发布准备文档
已经完成。核心工程门禁没有发现新的代码失败；总门禁按设计拒绝以下未满足项：

1. G2 仍为 `pending`，不能生成或安装未获批准范围的 unsigned candidate。
2. 工作树不是 clean，不能形成可追溯的 release evidence source。
3. 没有 Windows 实机，缺少 Windows 应用、安装/卸载、性能和视觉报告。
4. 原生 installer size、cold/warm start、稳定 RSS 和 native dense-canvas 未测量。
5. ADR 0007 的最终项目许可证、产品身份和必要法律审阅未完成。
6. G-FINAL 真实 macOS 视觉终态仍需项目负责人确认。

因此当前不能给出 `ACCEPT`、不能进入安装发布动作，也不能把 `pnpm quality` 标记为
全绿。`releasePerformance` 和 `verify-evidence` 的非零退出是正确的 fail-closed
结果。

## 2. MRT 交付矩阵

| 工作包 | 当前判断 | 复核证据 | 残余项 |
| --- | --- | --- | --- |
| MRT-004W2R2 | IMPLEMENTED | `runtime.rs`、`launch_coordinator.rs`；generation 竞态测试 | 当前 source 未提交；原生最终报告需重跑 |
| MRT-005 | IMPLEMENTED | bounded read、schema/core 契约；Rust 179 tests | Windows 文件系统实机证据 |
| MRT-006 | IMPLEMENTED | `font-source.ts`、PNG/PDF resource-limit tests、export golden | 发布候选上的原生查看器抽查 |
| MRT-007 | IMPLEMENTED | Rust preference tests、Tauri adapter、OnboardingFlow warning tests | 法律/发布不影响代码，但需进入最终证据批次 |
| MRT-008 | IMPLEMENTED_WITH_NATIVE_MATRIX_PENDING | shortcut transactional rebind tests；失焦 quick-create 防误建 | macOS 五状态原生实测、Windows 矩阵 |
| MRT-009 | CLEARED_BY_VRA | VRA-050/070 样式操作面与现有视觉测试 | 无新增代码项 |
| MRT-010 | IMPLEMENTED_FAIL_CLOSED | `run-all.mjs`、`verify-evidence.mjs`、本报告 | G2/platform/clean evidence |
| MRT-011 | WEB_BUDGET_PASS_NATIVE_PENDING | entry 495,995 bytes；4 JS chunks；动态 PDF/PNG/WASM | native installer/startup/RSS |
| MRT-012 | ENGINEERING_PREP_COMPLETE_G2_PENDING | license scan、release checklist、licensing draft | final license/identity/G2/candidate/install |

## 3. 质量命令复核

最近一次 `pnpm quality` 的阶段结果：

| 阶段 | 结果 |
| --- | --- |
| format / typecheck / lint | PASS |
| unit | PASS（38 files / 386 tests） |
| integration | PASS（7 files / 57 tests） |
| a11y | PASS（9 tests） |
| build | PASS |
| cargo fmt / cargo test / cargo clippy | PASS（Rust 179 tests） |
| boundaries / licenses / network | PASS（Cargo 487 packages，0 failures；96 files，0 endpoints） |
| export golden | PASS（14 tests） |
| canvas performance | PASS（dense-300-450，p95 约 17ms，预算 32ms） |
| assets | PASS_WITH_NATIVE_MEASUREMENTS_PENDING |
| releasePerformance | BLOCKED（G2、native candidate、Windows） |
| visual | PASS（VRA-080 六层自动化验收） |
| evidence | BLOCKED（dirty source、partial macOS、no Windows） |

最终代码改动后的独立补充复核：

- `pnpm typecheck`：PASS；
- `pnpm lint`：PASS；
- `pnpm test:unit`：PASS（38 files / 386 tests）；
- `pnpm build`：PASS，entry JS `495995` bytes；
- `cargo fmt -- --check`：PASS；
- `cargo check`：PASS；
- `cargo test -- --test-threads=1`：PASS（179 tests）；
- `cargo clippy --all-targets -- -D warnings`：PASS；
- `git diff --check`：PASS；
- `verify-decision --phase bootstrap`：PASS；
- `scan-dependency-licenses`：PASS（29 个直接 JS 依赖 + 487 个 Cargo 包）；
- `measure-release-assets`：PASS_WITH_NATIVE_MEASUREMENTS_PENDING；
- `run-performance --scope release`：BLOCKED（退出码 1，原因真实且已写入 evidence）。

## 4. AC-01～AC-14 复核摘要

| AC | 自动化/静态契约 | 平台证据判断 |
| --- | --- | --- |
| AC-01～AC-09 | 现有平台/组件测试与本次 lifecycle 测试通过 | macOS 既有报告来自历史 source；Windows 缺设备 |
| AC-10～AC-13 | golden、视觉、边界、网络和许可证扫描通过 | 平台无关部分通过；原生/Windows 部分不扩张推断 |
| AC-14 | 未执行 MM-100 安装验证 | G2 未批准，macOS/Windows unsigned candidate 均 BLOCKED |

旧 `evidence-index.json` 与历史 W2R 报告保留追溯，不被本次未提交工作树冒充为
当前 release evidence。当前机器可读状态以
[`mrt-post-vra-readiness.json`](../../docs/quality/evidence/mrt-post-vra-readiness.json)
和 [`mrt-post-vra-risk-evidence.json`](../../docs/quality/evidence/mrt-post-vra-risk-evidence.json)
为准。

## 5. 风险判断

R-001～R-016 的状态和残余风险已登记在
[`mrt-post-vra-risk-evidence.json`](../../docs/quality/evidence/mrt-post-vra-risk-evidence.json)。
当前没有发现需要新增 P0 产品修复的结果；但以下是发布级 P1 阻断，不应降级为提示：

| 严重度 | finding | 处置 |
| --- | --- | --- |
| P1 | 原生发布性能/包体没有 candidate 证据 | G2 批准后执行 unsigned Tauri candidate 测量 |
| P1 | Windows 真机/安装/性能/视觉证据缺失 | 提供设备，或由负责人修订已批准范围与质量门 |
| P1 | 最终许可证、产品身份和安装范围未批准 | 完成法律审阅并写入 G2；不由实现 Agent代填 |

## 6. MM-110 放行条件

后续复核只需围绕真实外部前置条件继续，不需要重复实现已通过的代码路径：

1. 项目负责人决定是否维持“macOS v1、Windows 后续专门版本”与双平台质量门的关系；
   如要放行 macOS 单平台，需要更新相应 Gate/验收规则，而不是用 macOS 推断 Windows。
2. 项目负责人完成 G2 精确 scope：selected host、candidate 输出路径、安装目标、
   允许动作和删除边界。
3. 完成最终许可证、产品身份、扩展名和 notices 法律审阅。
4. 在批准的 scope 内生成 unsigned candidate，重新测量安装器、启动、RSS、文件关联，
   并补齐两平台原始报告（或先完成质量门范围修订）。
5. 在干净、可追溯的 source 上重新运行 `pnpm quality` 和 MM-110。

签名、公证、凭据、系统信任修改、上传和公开发布仍是独立授权事项，本报告不包含这些
动作。
