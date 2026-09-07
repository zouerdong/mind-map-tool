# MRT-004B1A 实现证据

日期:2026-08-31。红灯记录见
`2026-08-31-mrt-004b1a-red-light-evidence.md`;本文为修复后最终状态。
验收状态：**B / B1 / B1A ACCEPTED（审查者于 2026-08-31 统一验收）**。
审查结果见 `2026-08-31-mrt-004b1a-acceptance.md`。

## 1. commit 前后语义分界(B1A-F1,PC1/PC2)

```text
PreCommit(文件未提交;任何失败 → abort pending,授权可能已消耗)
  plan ──► resolve/bind target ──► prepare ──► redeem/TOCTOU/commit
   │Plan          │ResolveTarget      │Prepare      │Commit
   │TargetBindingMismatch(写前,零 I/O 零 pending)
   └─ 失败统一:SaveAsError::PreCommit(*);commit 失败时显式 abort,
      abort 自身失败 → CommitAndAbortFailed{commit, abort}(不吞错)

PostCommit(receipt 已取得 = 目标 bytes 已落盘;任何失败 → 不得 abort)
  refresh ──► finalize(锁内)
   │RefreshFailed          │FinalizeRejected(code)
   │RefreshedTargetMismatch
   └─ 统一:SaveAsError::CommittedButRebindPending{receipt, cause}
      + fail-closed pending reservation 保留(pending_rebind_count 可观测)
```

三种结果可区分:写前失败(PC1 之前)、写后未换绑(PC1/PC2)、成功
finalize。`CommittedButRebindPending` 携带 receipt,调用方明确知道文件
已写,不得提示为"保存失败、可重试覆盖"。

- PC1 证明:`red_pc1_refresh_failure_after_commit_keeps_fail_closed_reservation`
  —— bytes 已写;错误为 CommittedButRebindPending;同目标 open deferred
  (route_next 零 effect)、同目标第二 prepare `IDENTITY_ALREADY_RESERVED`;
  pending count = 1;旧窗口 identity 不变。
- PC2 证明:`red_pc2_finalize_conflict_after_commit_is_committed_not_rollback`
  —— hard link 注入 finalize 占用冲突;bytes 已写;错误可区分已提交;
  pending 保留;旧 identity 不变;目标未换绑给原窗口。
- PF1 回归:`pf1_pre_commit_failure_cleans_pending_and_keeps_old_identity`
  —— TARGET_APPEARED 写前失败 → pending 清 0、外部内容不覆盖、旧
  identity 归属不变。

## 2. host-only outcome 绑定(B1A-F2,O1/O2)

```rust
OpenHostOutcome    { renderer: OpenOutcome,  identity: FileIdentity }
CommitHostOutcome  { renderer: Receipt,      identity: FileIdentity,
                     canonical_target: CanonicalPathKey }
```

不可移花接木证明:

- **open(O2)**:`open_file_with_identity(provider, label, path)` 内部
  canonicalize **一次**;内容读取、handle 签发、provider 解析共用同一无损
  `PathBuf`。`outcome_display_path_of()`(displayPath → PathBuf 反推)已
  删除,全仓无此路径(grep 佐证)。
  `o2_open_identity_resolved_from_lossless_canonical_path` 用 recording
  provider 断言收到的路径恒为 canonicalize 结果(symlink 已解析),且
  identity/handle/token 同源。
- **ordinary(O1)**:目标只来自 `HandleRegistry::validate()`;公开 loose
  `refreshed_identity_after_commit(&self, path)` 已删除,identity 刷新只
  存在于 `commit_ordinary_with_identity` 同一 service 流程内(私有
  `refresh_identity`),并校验 refreshed canonical == handle 绑定目标。
  registry 侧纵深:`refresh_identity_after_commit` 新增 canonical 连续性
  校验(`IDENTITY_CANONICAL_MISMATCH`)——commit A 后不存在把窗口换绑到 B
  的 API 与状态路径。
- **Save As**:prepare identity、commit target、post-commit identity 的
  canonical 必须都等于 ledger plan canonical;provider 写前返回错 target →
  `TargetBindingMismatch` 零 I/O 零 pending
  (`pre_commit_provider_target_binding_mismatch_rejected_before_write`);
  写后不一致 → `RefreshedTargetMismatch` fail closed。
- IPC DTO 不变(handle/token/displayPath);identity/canonical target/
  rebind token 不进 renderer。

## 3. AuthorizationPlan 私有绑定与 race/replay(B1A.4,AP1/AP2)

- `AuthorizationPlan` 字段私有,仅 `AuthorizationLedger::plan` 构造;
  对外只读 getter(`authorization_ref/window_label/kind/canonical_target`)。
- `commit_save_as_planned` 先校验 `plan.window_label() == window_label`
  (调用方 label 与 plan 绑定不得是两个互不校验的字符串),再经
  `redeem_plan` 在 ledger 锁内复核 ref/window/kind/canonical 与 ledger
  **完全一致** + expiry/未消耗,一次性消耗。
- 模块内负向测试(authorization.rs `b1a_plan_binding_tests`):canonical
  错配与窗口错配的伪造 plan 均写前稳定拒绝、零 commit(证明内部校验在
  私有化后仍存在)。
- race/replay(AP2):同一授权第二窗口 → plan 阶段 `INVALID_TARGET_AUTHORIZATION`,
  零 commit、零 pending 泄漏;redeem 单次消耗保留(A1 replay 用例回归)。
- export authorization DTO 与一次性语义未动。

## 4. token caller 校验(B1A-F3,T3-XW)

- `finalize_rebind(caller_label, token, final_identity)` /
  `abort_rebind(caller_label, token)`(registry 与 coordinator 两层)。
- validate-then-commit:caller 与 pending owner 不符 →
  `INVALID_REBIND_TOKEN` 且零变化(pending 不移除);window generation
  stale 防御保留;T1 canonical 一致、T2 单例、replay 语义不变。
- orchestration 以同一 `window_label` 贯穿 plan → prepare(token owner)
  → commit(plan.window_label 校验)→ finalize/abort。
- 真实 cross-window 测试:`t3_xw_cross_window_caller_rejected_with_zero_change`
  —— W2 对 W1 token 执行 finalize 与 abort 均稳定拒绝;pending、两窗
  record、alias owners、目标 bytes 全部零变化;W1 随后仍可正常 finalize。
- 原冒名用例已改名为 `t3_forged_and_replay_token_rejected`(诚实命名,
  覆盖 forged + replay)。

## 5. 测试矩阵映射(119 → Agent 129 → 审查者 131)

| ID | 测试(最终) | ID | 测试(最终) |
| --- | --- | --- | --- |
| PC1 | `red_pc1_refresh_failure_after_commit…` | O1 | `red_o1_ordinary_refresh_cannot_rebind…` + `o1_orchestration_ordinary_save_refreshes_physical`(绑定 API) |
| PC2 | `red_pc2_finalize_conflict_after_commit…` | O2 | `o2_open_identity_resolved_from_lossless_canonical_path` + `o2_open_outcome_carries_host_identity_same_source` + `o2_open_rejects_provider_identity_for_another_canonical_target` |
| PF1 | `pf1_pre_commit_failure_cleans_pending…` | AP1 | `ap1_plan_canonical_binding_mismatch…` + `ap1_plan_window_binding_mismatch…` |
| AP2 | `ap2_same_authorization_second_window…` | T3-XW | `t3_xw_cross_window_caller_rejected_with_zero_change` + `t3_stale_generation_abort_rejected_without_consuming_pending` |
| 写前绑定 | `pre_commit_provider_target_binding_mismatch…` | T3-S/R | `t3_stale_token…` + `t3_forged_and_replay_token_rejected` |
| U1/U2/U3 | B1 用例回归通过(错误匹配升级为 PreCommit 变体) | X1/X2/X3 | B1 用例回归通过 |
| P1/P2/P3 | B1 用例回归通过(identity.rs 未改) | A1 全矩阵 | R/Q/F/P/L/T/C/B/Y 119 基线保留,零删除零弱化 |

## 6. 门禁结果(2026-08-31,本机 macOS)

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | Agent 自检 PASS 129/129；审查者补齐 open provider target 与 stale abort generation 两条回归后为 131/131 |
| `cargo clippy … --all-targets -- -D warnings` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS 4 files / 47 tests(本批未改 TS) |
| `pnpm test:unit` | PASS 27 files / 271 tests |
| `pnpm typecheck` / `pnpm lint` | PASS |
| `pnpm quality` | PASS(lint/unit/boundaries/licenses/network/golden/performance 全 PASS) |
| `pnpm build` | PASS(仅既有 chunk-size warning) |
| prettier(B1A 变更 MD) | PASS |
| rustfmt changed-scope(4 个 Rust 文件) | PASS |
| `git diff --check` | PASS |
| ADR 0008 SHA-256 | `a88c9606000a8e72e59ee634f02eecc652c0d82c1a336b8f5ad248c70a1c105e` 未变 |

## 7. Windows target 检查(如实记录)

- 主 crate `cargo check --target x86_64-pc-windows-msvc --lib`:**BLOCKED
  by 既有 baseline**——`tauri-build` 阶段 `icons/icon.ico not found;
  required for generating a Windows Resource file`,先于源码编译(与 B1
  验收记录一致;未修改图标/配置绕过红线)。
- 同源探针(可复现):将 `src/file/identity.rs`(561 行,本批未改)
  原样复制进独立 crate(stub `ServiceError::file_io`),`cargo check
  --target x86_64-pc-windows-msvc` **编译通过**——`#[cfg(unix)]` 边界
  (MetadataExt/symlink/OsStringExt)完整。
- B1A 改动的 4 个文件经 grep 审计:生产代码零平台专属 API、零 cfg 分支;
  `std::os::unix` 仅出现在 `#[cfg(all(test, unix))]` 测试模块。

## 8. 变更文件与范围声明

本批修改(均在任务卡允许列表内):

- `apps/desktop/src-tauri/src/file/authorization.rs`(plan 私有化 + getter
  + redeem_plan + AP1 模块内负向测试)
- `apps/desktop/src-tauri/src/file/mod.rs`(OpenHostOutcome/
  CommitHostOutcome、open canonicalize 一次、ordinary 绑定提交、
  commit_save_as_planned 绑定校验、orchestrate PreCommit/PostCommit、
  删除 loose refresh API 与 display 反推、provider canonical 最终校验、
  测试矩阵)
- `apps/desktop/src-tauri/src/lifecycle/window_registry.rs`(caller 校验、
  caller + generation abort 校验、`IDENTITY_CANONICAL_MISMATCH`、T3-XW/
  stale abort 用例、既有用例签名更新)
- `apps/desktop/src-tauri/src/lifecycle/launch_coordinator.rs`(finalize/
  abort caller 参数转发、pending_rebind_count 访问器)
- `docs/architecture/window-launch-lifecycle.md`(B1A candidate 段,未写
  ACCEPTED)
- 新增 `.omx/reviews/2026-08-31-mrt-004b1a-red-light-evidence.md` 与本文

未修改:ADR 0008 及批准 hash、capability、`tauri.conf.json`、CI/CD、发布
配置、最终 UI、onboarding、core schema、export、文件格式、MRT-003 close
handshake、MRT-001 保存队列;`file/identity.rs`、`ipc/mod.rs`、
`lifecycle/mod.rs`、TS 全部未动(工作树中它们的既有未提交变更为前序批次
与审查者所有,原样保留)。无新增依赖(sha2/uuid/tempfile 均既有);
无 sleep/自旋/吞错;未接真实 Tauri 多窗口;未进入 MRT-004C~E。
`.tmp/mrt-004b1a` 探针用后清理(命令已记录于第 7 节)。
