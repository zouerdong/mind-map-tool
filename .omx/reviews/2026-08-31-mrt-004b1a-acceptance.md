# MRT-004B1A 统一验收报告

## 结论

- **MRT-004B1A：ACCEPTED。** commit 前后语义、host outcome 同源绑定、
  AuthorizationPlan 防移花接木、caller label + window generation token
  校验全部通过。
- **MRT-004B / B1：随 B1A 收口为 ACCEPTED。** B1 先前已经通过的
  assignment、untitled、无损路径和平台 identity 基础没有回归。
- **MRT-004 Wave 1：ACCEPTED。** MRT-004C～E / Wave 2 已解锁；下一批
  按一张合并任务卡执行，整批完成后再统一验收，不恢复微任务审阅。
- 本轮审查发现的两项局部遗漏已由审查者直接修复，没有遗留需要退回执行
  Agent 的 B1A 阻断问题。

下一批唯一派发入口：
`2026-08-31-mrt-004-wave-2-production-integration-task-card.md`。

## 审查者直接修复

### R1 / P1：open provider 返回值缺少最终 canonical 绑定检查

原实现把无损 canonical path 传给 provider，但默认相信 provider 返回值。
若 provider 错误返回另一文件的有效 identity，内容/handle 与 identity 仍可
错绑。现已在签发 handle 前校验
`identity.canonical() == actual_open_canonical`；失败返回 `FILE_IO_ERROR`，
且不留下无法交付的孤立 handle。

新增回归：
`o2_open_rejects_provider_identity_for_another_canonical_target`。

### R2 / P1：abort 只校验 caller label，未复核 window generation

任务卡要求 finalize 与 abort 均验证 caller label + generation。原
`abort_rebind` 已校验 caller，却没有像 finalize 一样复核当前窗口代际。
现已补齐 window 存在性与 generation 校验；stale abort 返回
`INVALID_REBIND_TOKEN`，pending 不被消费。

新增回归：
`t3_stale_generation_abort_rejected_without_consuming_pending`。

同时修正稳定错误常量拼写：
`IDENTITY_CANONAL_MISMATCH` → `IDENTITY_CANONICAL_MISMATCH`。旧拼写尚未
进入生产 IPC 或公开版本，因此本次按局部命名缺陷直接修正。

## B1A 必测矩阵

| ID | 结果 | 独立验收事实 |
| --- | --- | --- |
| PC1 | PASS | commit 后 refresh 失败：bytes 已提交，返回 `CommittedButRebindPending`，pending 保留，同目标 open/prepare 不抢占 |
| PC2 | PASS | commit 后 finalize 冲突：不伪装 rollback，旧 identity 不变，pending fail closed |
| PF1 | PASS | commit 前 TOCTOU 失败：文件未提交，pending 清理，旧 identity 不变 |
| O1 | PASS | ordinary target 只来自 handle ledger；registry 拒绝 canonical 跳变 |
| O2 | PASS | open 不经 displayPath 反推；provider 收到无损 canonical；错 target identity 在签发 handle 前拒绝 |
| AP1 | PASS | plan canonical/window 与 ledger 错配均写前拒绝，零 commit |
| AP2 | PASS | 同一 authorization 至多一次 commit；跨窗/重放无 pending 泄漏 |
| T3-XW | PASS | W2 finalize/abort W1 token 均稳定拒绝，状态零变化 |
| T3-S/R | PASS | stale generation、forged、replay 均拒绝；stale abort 不消费 pending |
| U/X/P/A1 | PASS | untitled、close-save、assignment、路径和 A1 全矩阵无回归 |

## 关键边界判定

1. `orchestrate_save_as` 已明确分为 PreCommit 与 PostCommit。只有尚未提交
   bytes 的失败才 abort；提交后的 refresh/finalize 失败保留 reservation。
2. `OpenHostOutcome`、`CommitHostOutcome` 和 Save As 编排均携带 host-only
   identity；renderer DTO 仍只有 handle/token/displayPath。
3. `AuthorizationPlan` 字段私有，redeem 时重新核对 ref/window/kind/
   canonical target；不能只拿 authorization ref 拼装另一目标。
4. finalize/abort 都验证 caller label 和 window generation；错误路径遵守
   validate-then-commit。
5. 文件 I/O 与 provider metadata 都在 coordinator lock 外。

## 独立门禁

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS：131/131；doc tests 0 |
| `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS：4 files / 47 tests |
| `pnpm quality` | PASS：27 files / 271 tests；全部质量子门禁通过 |
| `pnpm build` | PASS；仅既有 chunk-size warning |
| B1A changed-scope Rustfmt / Prettier | PASS |
| `git diff --check` | PASS |
| ADR 0008 SHA-256 | PASS：`a88c9606000a8e72e59ee634f02eecc652c0d82c1a336b8f5ad248c70a1c105e` |

Windows 整 crate 的 `cargo check --target x86_64-pc-windows-msvc --lib`
仍在 `tauri-build` 阶段被既有 `icons/icon.ico` 缺失阻断，尚未进入本批 Rust
源码编译。B1A 改动的生产代码没有新增平台专属 API；Unix 引用只存在于
`cfg(test)` 测试。本验收不把 Windows 整包构建冒充为已通过。

## Wave 2 前置提醒（不阻断 B1A）

以下不是 B1A 范围内的回归，而是尚未生产接线的事实，已进入下一批任务卡：

- `lib.rs` / IPC 仍使用旧 `LaunchIntentStore`、全局 broadcast 与普通
  `commit_ordinary` / `commit_save_as`；尚未消费本波 host-only outcome。
- `CommittedButRebindPending` 需要 host-side 恢复记录与 renderer 可理解的
  “已保存、换绑待恢复”结果，不能在 Wave 2 映射成普通保存失败。
- `AckIntent` 当前只证明终态时机；生产 executor 还需完成一次性清理，避免
  terminal intent 常驻。
- 真实 `editor-*`、targeted bootstrap、native source、retry/dismiss UI 和
  Finder/Dock 证据仍未实现。

这些项目集中由 Wave 2 完成后再统一验收。
