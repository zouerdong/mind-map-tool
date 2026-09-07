# MRT-004B1 红灯证据

日期:2026-08-30。红灯用例直接写入最终测试文件(`window_registry.rs` 的
`b1_red_tests` / `b1_token_tests`,`launch_coordinator.rs` 的 t1/x3,
`identity.rs` 的 `p1`),先运行记录旧实现失败,修复后全绿保留。

## 旧实现失败记录(修复前,9 failed)

| 测试 | 旧结果 | 根因(B1-F 对应) |
| --- | --- | --- |
| `red_x1_coordinator_create_gap_blocks_pending_prepare` | FAIL:prepare 成功(期望 IDENTITY_ALREADY_RESERVED) | B1-F1:CreateWindow effect 发出后无预留,同 target Save As 可形成 assignment+pending 双占用 |
| `red_x1_active_occupancy_blocks_pending_prepare` | FAIL:INVALID_WINDOW_TRANSITION(旧 prepare 无 source 语义) | B1-F3:prepare 未按窗口状态分类;修后 active 占用拒绝路径需合法 source 才可达 |
| `red_x2_pending_blocks_all_begin_loading_entries` | FAIL:begin_loading 抢占成功 | B1-F1:begin_loading 不检查 pending rebind 占用 |
| `red_t1_prepare_a_finalize_b_rejected_with_zero_change` | FAIL:finalize B 成功(移花接木) | B1-F2:token 未绑定 authorized canonical target |
| `red_t2_second_prepare_same_label_rejected` | FAIL:同 label 第二个 pending 成功 | B1-F2:无 per-label pending 单例 |
| `red_u1_blank_untitled_first_save_as_adopts_identity` | FAIL:finalize 返回 INVALID_WINDOW_TRANSITION | B1-F3:Blank 无旧 identity 无法 finalize("文件已写、registry 未换绑") |
| `red_u3_closing_untitled_close_save_stays_closing` | FAIL:同上(Closing 无 identity 被拒) | B1-F3:close-save 路径未支持 |
| `red_p1_non_utf8_paths_do_not_collide`(×2:registry/identity) | FAIL(旧):lossy 折叠为同一 key;见下方可达性说明 | B1-F5:CanonicalPathKey(String) 有损 |
| `t1/red_a3`(A1 用例) | FAIL(修复中):旧"并发预占"构造被新 assignment 防护拦截 | B1-F1 统一 reservation 的预期效果;用例改写为 B1 语义(见下) |

## P1 可达性说明(如实记录)

macOS 文件系统拒绝创建非法 UTF-8 文件名(实测 `Os { code: 92, Illegal
byte sequence }`),端到端非 UTF-8 文件夹具在本平台不可达。P1 以**内存
`OsString` 构造**验证:两个 lossy 投影相同(`0xff`/`0xfe` 均折叠为
U+FFFD)的路径,修复前经 `to_string_lossy` 产生相同 key,修复后
(`CanonicalPathKey(PathBuf)`)判等不同、可各自 reservation。旧实现的
运行时复现因文件系统限制不可达;以 key 构造层断言锁定。

## T1/red_a3 用例语义演进说明

A1 时代的 T1 断言"create 挂起期间他人预占 → 回报整体失败"依赖旧竞态
窗口存在。B1 统一 reservation 后该窗口**结构性消失**(预占本身被
Assignment 拒绝),两个用例改写为 B1 语义:他人预占一致被拒 + 自带
assignment 的 ok 回报正常升级;零部分提交断言保留在新增的
`x3_create_failure_releases_assignment_reservation`(create 失败原子
回滚,无幽灵窗口/reservation)。

## 修复映射

- B1-F1 → `alias_owners: HashMap<IdentityAlias, Ownership{label,
  kind: Active|Assignment}>`;`reserve_assignment` 在 CreateWindow effect
  发出前预留;`release_assignment` 失败回滚。pending 位于独立表，
  begin_loading/assignment/prepare/finalize/refresh/路由入口同时检查两类
  存储，共同维护单占用不变量(X1/X2)。
- B1-F2 → `PendingRebind{token, window_label, window_generation, source,
  authorized_target, reserved_aliases}`;per-label 单例(T2);finalize
  校验 canonical 完全一致 + generation + source(T1/T3)。
- B1-F3 → prepare 按 source 分类(Identity/Untitled/ClosingUntitled);
  finalize:Blank adopt→Open、Open 保持只换 aliases、Closing 保持
  Closing 暂持;失败/取消零变化(U1/U2/U3)。
- B1-F4 → `AuthorizationLedger::plan`(不消耗)+ `plan_document_save_as`
  / `commit_save_as_planned` / `open_file_with_identity` /
  `refreshed_identity_after_commit` + `orchestrate_save_as` 固定顺序
  (plan→prepare→锁外 commit→refresh→finalize/abort;A1 replay 无泄漏)。
- B1-F5 → `CanonicalPathKey(PathBuf)` 无损;`display_lossy` 仅投影;
  metadata 从 canonicalize 后目标读取;Unix provider/变体/测试完整
  `#[cfg(unix)]`;非 Unix `CanonicalOnlyProvider` + `platform_provider()`
  工厂 + `IdentityStrength` 明示(P3 证明见下)。

## Windows target source check(P3,如实记录)

- `cargo check --target x86_64-pc-windows-msvc`(主 crate):**BLOCKED
  by 既有 baseline**——`tauri-build` 阶段 `icons/icon.ico not found;
  required for generating a Windows Resource file`,先于源码编译失败
  (与 Wave 1 验收记录一致;未修改图标/配置绕过红线)。
- **最小 cfg 证明**:`file/identity.rs` 全量源码(stub 掉 crate 内部
  error 类型后)置于独立探针 crate,`cargo check --target
  x86_64-pc-windows-msvc` **编译通过**——证明 `std::os::unix` 的全部
  使用(MetadataExt/symlink/OsStringExt)已被 `#[cfg(unix)]` 完整包围。
- 仓库其余 `std::os::unix` 使用仅在测试(`#[cfg(all(test, unix))]` 模块)
  ;`window_registry.rs`/`launch_coordinator.rs` 生产代码无平台专属 API
  (grep 审计)。
