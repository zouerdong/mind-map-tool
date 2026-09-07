# MRT-004B1A 红灯证据

日期:2026-08-31。红灯用例写入最终测试文件后分两阶段记录旧实现失败;
禁止先改断言迎合实现。

- 阶段 1(行为红灯,旧签名可编译):PC1、PC2、O1(registry 腿)、AP1。
- 阶段 2(签名演进红灯,编译期拒绝):O2(open 注入 provider)、T3-XW
  (finalize/abort caller 参数)——旧 API 没有该调用边界的表达通道,
  编译错误即为旧实现"无此校验"的忠实记录(下文附审计)。

类型面说明:红灯断言引用的新错误变体(`SaveAsError::PreCommit` /
`CommittedButRebindPending`)与 `AuthorizationPlan` getter 先行加入类型
声明,但**编排行为保持旧路径**(commit 后 refresh 失败仍 abort、
commit_save_as_planned 仍只消费 authorization_ref),因此阶段 1 失败
全部是运行期行为失败,不是编译失败。

## 阶段 1:行为失败记录(修复前,124 tests:120 passed / 4 failed)

| 测试 | 旧结果 | 根因(B1A-F 对应) |
| --- | --- | --- |
| `red_pc1_refresh_failure_after_commit_keeps_fail_closed_reservation`(file/mod.rs) | FAIL:`PC1:应为 CommittedButRebindPending,实际 Service(FILE_IO_ERROR "injected refresh failure")`;且旧实现已 `abort_rebind` 释放 pending(同目标 open/prepare 抢占断言随后亦红) | B1A-F1:commit 成功后 refresh 失败被当作 pre-commit 失败 abort;目标 bytes 已落盘却释放 fail-closed reservation |
| `red_pc2_finalize_conflict_after_commit_is_committed_not_rollback`(file/mod.rs) | FAIL:`PC2:应为 CommittedButRebindPending,实际 Reservation("IDENTITY_ALREADY_RESERVED")` | B1A-F1:finalize 拒绝虽未 abort(fail closed 保留 pending),但错误类型不可区分"已提交、换绑未完成",调用方可误判为可重试覆盖 |
| `red_o1_ordinary_refresh_cannot_rebind_to_foreign_canonical`(file/mod.rs) | FAIL:`called unwrap_err() on an Ok value: ()` | B1A-F2:loose `refreshed_identity_after_commit(path)` 允许 commit A 后把窗口换绑到 B;registry 亦无 canonical 连续性校验 |
| `ap1_plan_canonical_binding_mismatch_rejected_before_write`(authorization.rs) | FAIL:`unwrap_err() on Ok value: Receipt{…a.mm}`——旧实现对 ledger 目标 A 正常写盘 | B1A-F2:plan 的 canonical/window/kind 绑定被忽略,只消费 authorization_ref |

注:`ap1_plan_window_binding_mismatch_rejected_before_write` 在旧实现即
通过(旧 redeem 的跨窗校验兜住);保留为矩阵回归,证明 B1A 后该拒绝
来自 plan 绑定校验而非仅 redeem 窗口参数。

## 阶段 2:签名演进红灯(编译期,8 errors)

对旧代码加入最终形态用例后 `cargo test --lib` 编译失败摘要:

```text
error[E0061]: this method takes 2 arguments but 3 arguments were supplied
  --> file/mod.rs  open_file_with_identity(&provider, MAIN, &link)   // O2:注入 provider
  --> window_registry.rs  finalize_rebind("editor-9", &token, &final_id)  // T3-XW
error[E0061]: this method takes 1 argument but 2 arguments were supplied
  --> window_registry.rs  abort_rebind("editor-9", &token)           // T3-XW
error[E0609]: no field `identity`/`renderer` on type `(OpenOutcome, FileIdentity)`  // O2:OpenHostOutcome
```

### O2 旧行为审计(编译红灯的事实依据)

旧 `open_file_with_identity`(file/mod.rs)实现:

```rust
let outcome = self.open_file(window_label, raw_path)?;
let identity = resolve_existing_identity(&outcome_display_path_of(&outcome))?;
// fn outcome_display_path_of(outcome) -> PathBuf { PathBuf::from(&outcome.display_path) }
```

identity 判定路径确实经过 `displayPath → PathBuf` 反推,且无 provider
注入点。与 B1 P1 同因:macOS 文件系统拒绝创建非 UTF-8 文件名
(code 92),display 依赖的运行期后果在本平台不可达,故 O2 以签名级
(编译期)+ 行审计记录;修复后同用例全绿(含 symlink → canonical、
recording provider 收到的路径断言)。

### T3-XW 旧行为审计

旧 `finalize_rebind(token, identity)` / `abort_rebind(token)` 无 caller
参数:token 一旦泄露/误传,API 层无法区分调用窗口,任何持有 token 字符串
的调用方都能代替 owner 终结 pending。原名
`t3_cross_window_and_forged_token_rejected` 的用例实际只覆盖 forged +
replay,已按 B1A-F3 要求改名为 `t3_forged_and_replay_token_rejected`,
真实 cross-window 用例为新增 `t3_xw_cross_window_caller_rejected_with_zero_change`。

## 修复映射

- B1A-F1 → `orchestrate_save_as` 重构为 PreCommit/PostCommit 两段:
  commit 成功后删除 abort 路径;refresh 失败 → `CommittedButRebindPending
  { receipt, RefreshFailed }`;refresh canonical 与 plan 不一致 →
  `RefreshedTargetMismatch`;finalize 拒绝 → `FinalizeRejected(code)`;
  三者均保留 pending(fail closed)。pre-commit abort 自身失败 →
  `CommitAndAbortFailed` 组合错误,不吞错。
- B1A-F2 →
  - open:`OpenHostOutcome{renderer, identity}`,canonicalize 一次后
    内容读取/handle 签发/provider 解析共用同一无损 `PathBuf`;删除
    `outcome_display_path_of`;
  - ordinary:`CommitHostOutcome{renderer, identity, canonical_target}`,
    目标只来自 `HandleRegistry::validate`,提交成功后同一 service 流程
    刷新 identity 并校验 canonical 与 handle 绑定一致;删除公开 loose
    `refreshed_identity_after_commit(&self, path)`;
  - registry:`refresh_identity_after_commit` 新增 canonical 连续性校验
    (`IDENTITY_CANONICAL_MISMATCH`),ordinary 不得换绑 canonical;
  - plan:`AuthorizationPlan` 字段私有 + 只读 getter;`redeem_plan`
    复核 ref/window/kind/canonical 与 ledger 完全一致(AP1 模块内负向
    测试证明内部校验存在)。
- B1A-F3 → `finalize_rebind(caller_label, token, final_identity)` /
  `abort_rebind(caller_label, token)`:validate-then-commit,caller 与
  pending owner 不符 → `INVALID_REBIND_TOKEN` 且零变化;generation
  stale 防御保留;orchestration 以同一 `window_label` 贯穿 plan→prepare
  →commit(校验 plan.window_label)==token owner→finalize/abort。
