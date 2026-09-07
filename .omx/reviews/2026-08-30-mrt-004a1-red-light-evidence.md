# MRT-004A1 红灯证据

日期:2026-08-30。按 A1 子规格 §5(A1.1),红灯用例直接写入最终测试文件
(`window_registry.rs` / `launch_coordinator.rs` 的 `a1_red_tests` 模块与
`window-bootstrap.test.ts` 的 "A1 红灯" describe),先运行记录失败,再修
实现,最终全绿保留。原始输出见执行回报;本文件为可审计摘要。

## Rust 红灯(旧实现 4 失败 / 1 回归通过)

| 测试 | 旧结果 | 根因(A1-F 对应) |
| --- | --- | --- |
| `red_a1_closing_lookup_and_write_disagree` | FAIL:`identity_owner 报 None 而 begin_loading 拒绝` | A1-F4:`holds_identity()` 不含 Closing 但索引未清 → 查询与写入分裂 |
| `red_a1_closing_keeps_reservation_until_destroyed` | PASS(回归保护) | 旧实现恰好保留索引;防止修复时反向破坏 |
| `red_a2_closing_duplicate_open_defers_instead_of_creating` | FAIL:路由产出 `CreateWindow`(期望零 effect + Queued) | A1-F4:coordinator 用 focusable 查询,Closing 窗口的 identity 视为无主 → 错误建窗 |
| `red_a3_window_created_midway_failure_leaves_no_partial_state` | FAIL:回报 Err 但 `record(editor-1)` 残留 Some(Booting + delivery) | A1-F3:register → next_delivery → begin_loading 三步分别提交,中途失败留下幽灵窗口/交付 |
| `red_a4_renderer_outcome_with_invalid_window_state_keeps_delivery` | FAIL:outcome 被拒后 `complete_delivery` 第二次返回 Err(已被消费) | A1-F3:先 complete_delivery 再 mark_open,窗口状态非法时 delivery 已消费、intent 仍 assigned |

## TS 红灯(旧实现 5 失败)

| 测试 | 旧结果 | 根因(A1-F 对应) |
| --- | --- | --- |
| `B2/B3:report 首次失败后,同 delivery 重发必须重报缓存 outcome` | FAIL:`expected 1 to be 2`(report 只调一次) | A1-F2:`seen` 在 action 前写入,重发被去重丢弃,reportOutcome 失败被空 catch 吞 |
| `B2:report 失败必须可观察` | FAIL:`expected +0 to be 1`;`pendingReports is not a function` | A1-F2:无 failure 通道、无 pending 快照 API |
| `B4:retryPendingReports` | FAIL:`adapter.pendingReports is not a function` | A1-F2:协议缺失(processing/report-pending/reported 阶段不存在) |
| `B5:action reject + report 失败` | FAIL:同上 | A1-F2:outcome 未缓存,失败即丢 |
| `B6:start 重复调用 / snapshot 失败` | FAIL:二次 start 未拒绝;snapshot reject 后 listener 残留 | A1 子规格 §4.4 末条:start 无幂等/拒绝语义,snapshot 失败泄漏 listener |

## 修复映射

- A1-F1(锁序):结构性修复——WindowRegistry 改 `&mut self` 纯数据,
  LaunchCoordinator 单 `Mutex<CoordinatorState>`;不再存在多锁。
- A1-F2(交付可靠性):TS per-delivery `processing → report-pending →
  reported` 状态机 + outcome 缓存 + `retryPendingReports()` +
  `onReportError`/`pendingReports()` 可观察通道。
- A1-F3(原子性):所有 completion 走 validate-then-commit,单临界区
  一次提交;失败零状态变化(T1/T2 测试锁定)。
- A1-F4(Closing):`holds_identity` 含 Closing;新增
  `identity_reservation()`(全部持有态)与 `identity_owner()`(仅
  Loading/Open,聚焦用);coordinator 对 Closing/pending 占用返回
  deferred(零 effect,intent 留队列),Destroyed 后恢复。
- A1-F5(类型):TS outcome 收窄为 `opened | blank-created |
  retryable-error`;`WindowBootstrap` 判别联合(open-path 必带
  canonicalPath 与 intentId)。

## Internal Gate A→B(2026-08-30,Agent 自检)

| 命令 | 结果 |
| --- | --- |
| `cargo test --lib`(全量) | PASS 77/77(66→77:+4 红灯转绿,+7 L/T/C 新增) |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `rustfmt --edition 2021 --check --config skip_children=true window_registry.rs launch_coordinator.rs` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS 47/47(42→47:+5 红灯转绿) |
| `pnpm typecheck` | PASS(0 errors) |
| `pnpm lint` | PASS |
| `git diff --check` | PASS |

Gate 条件核对:L/T/C/B/Y 与原 R/Q/F/P 矩阵全部通过;WindowRegistry 无
分散 Mutex(纯 `&mut self` 数据结构),coordinator 仅一把
`Mutex<CoordinatorState>`;completion 失败时 snapshot 零变化(T1/T2
断言锁定);bootstrap reportOutcome 失败后 outcome 可重报且 action 不
重跑(B2/B3/B4/B5)。**Gate 通过,按 Wave 1 卡继续 Phase B。**
