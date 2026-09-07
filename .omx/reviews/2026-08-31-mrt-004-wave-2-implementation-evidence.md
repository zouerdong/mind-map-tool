# MRT-004 Wave 2 实现证据（C+D+E 单批完成）

> 统一验收更新（2026-08-31）：**NEEDS-REMEDIATION**。本文件保留执行
> Agent 的原始实现回报，不代表 Accepted 状态；最终结论及证据纠偏见
> `2026-08-31-mrt-004-wave-2-acceptance.md`，当前派发入口为 MRT-004W2R。

日期：2026-08-31。红灯记录见 `2026-08-31-mrt-004-wave-2-red-light-evidence.md`。
批次：MRT-004C → Internal Gate C → D → Internal Gate D → E，按任务卡
`2026-08-31-mrt-004-wave-2-production-integration-task-card.md` 单次执行、
单次交回统一验收。

## 1. 最终 runtime / effect executor / IPC / bootstrap 数据流

```text
native source（唯一 ingest，全部经 LifecycleRuntime，锁外解析 identity）
  cold argv ─┐
  RunEvent::Opened ─┤→ provider.resolve_existing（锁外）
  single-instance ──┤    ├─ Ok → coordinator.enqueue(OpenFile{identity}) → drain
  Reopen/菜单/热键 ─┘    └─ Err → runtime source error（可见可 dismiss，不入队）

drain（single-drain gate：Mutex；有限循环至稳定等待点）
  route_next → [effect] → execute_effects（HostEffectSink，锁外）
    CreateWindow   → TauriHostEffectSink.create_editor_window（WebviewUrl::default
                     + main 同款几何）；失败→ release assignment + retryable
    FocusWindow    → show+unminimize+set_focus；任一失败→ reason，不 ack
    DeliverBootstrap → 定向 emit；WindowNotReady（冷启动 main WebView 未就绪）
                     = 交付成功（snapshot 已持久化，PR4）
    AckIntent      → coordinator.complete_ack（一次性移出队列；摘要容量 32）
    ShowRetryableError → launch_errors 快照 + 定向 emit 呈现窗口
  → correlation 回报（on_effect_result）→ 链式 effect → 回到 route_next

renderer（每 WebView 一个 WindowBootstrapAdapter，模块级单例）
  listener-first（platform://window-bootstrap 定向）
  → ready 快照（platform_window_ready）→ deliveryId 去重
  → action 全程 await：platform_open_assigned_document(deliveryId)（host 从
    交付绑定目标读取，renderer 不传路径）→ decode → load/adopt → UI 完成后
    才 platform_complete_window_bootstrap(opened)
  → opened/blank-created 才 ack；reject → retryable-error（reason 完整字符串）

文件生命周期（§4.3，生产唯一 commit 入口 runtime.commit_document）
  ordinary: commit_ordinary_with_identity
    └ bytes 落盘后同流程 refresh 失败 → CommittedButRefreshPending{receipt,
      canonical_target}（不再丢 receipt）
  Save As: orchestrate_save_as（PreCommit/PostCommit 分界）
    └ CommittedButRebindPending{receipt, cause, token, canonical_target}
       （token/canonical 为 host-only）
  两者 → runtime recovery 记录（label+generation 绑定；Destroyed 幂等清理）
    → renderer 收到真实 receipt + rebindState:"recovery-pending"（非保存失败）
    → recovery 未完成时同窗 commit 被 RECOVERY_PENDING 拒绝
    → platform_resolve_pending_recovery：锁外刷新 + 锁内 finalize/refresh；
      成功清记录，失败保持 fail closed（不自动重试）
```

## 2. startup barrier 的真实事件顺序证据（C1 要求）

实测（debug bundle，`open -a` LaunchServices 冷启动打开文件，stderr 经
`open --stderr` 捕获；入库副本
`docs/quality/evidence/wave2/mrt-004-wave2-cold-opened-order.log`）：

```text
[lifecycle] RunEvent::Opened: 1 个 URL
[lifecycle] open-file 入队：…/甲 脑图 v1.json
[lifecycle] effect DeliverBootstrap main delivery-1-…
[lifecycle] setup 完成：cold argv=0 个参数
[lifecycle] window_ready main: 1 个待处理交付
```

事实：macOS LaunchServices 冷启动打开文件时 **argv=0**（文件只经
`RunEvent::Opened` 到达）；Opened 的入队与 main 交付发生在 renderer
`window_ready` **之前**——无竞态窗口，main 承载首文件，全进程恰 1 窗。
barrier 不依赖时序猜测：ready 返回空快照且无 open-file intent 才
mark_blank；ready 先行的竞态降级（文件开新窗、main 保持 Blank）由
`startup_barrier_blank_race_degrades_to_new_window` 锁定。

## 3. native source → terminal/ack 状态矩阵（自动化）

| source | 行为 | 测试 |
| --- | --- | --- |
| cold argv A/B | main=A、editor=B、顺序稳定、无多余空窗 | `n1_cold_argv_ab_main_a_editor_b_no_extra_windows` |
| argv 噪音（flag/不存在） | 忽略（诊断日志） | 同上（intent 计数不变断言） |
| Opened A + duplicate A | 一 owner；第二条 FocusWindow，不建窗 | `n2_opened_a_then_duplicate_a_focuses_existing` |
| single-instance 无文件 | 恰好一个 activation | `n3_second_instance_without_files_single_activation` |
| Reopen warm ×2 | 每次一个新空白窗 | `n4_reopen_warm_blank_cold_ignored` |
| Reopen cold（main 未确认） | 忽略（不多空窗） | 同上 |
| source 解析失败 | 可见可 dismiss 的 source error；retry 重解析 | `source_error_visible_and_dismissable` |
| read 失败（权限/删除） | retryable-error 恰好一次；用户 retry 同 intentId 恢复 | `read_failure_reports_retryable_and_user_retry_recovers` |
| create 失败 | assignment 释放、intent retryable、零 ack | `pr3_create_failure_releases_assignment_intent_retryable_zero_ack` |
| dismiss | dismissed terminal 恰好 ack 一次；仅可见错误可动作 | `dismiss_from_visible_error_acks_once_and_guards_actions` |

## 4. E1 自动化矩阵映射（Rust `runtime::wave2_tests` + TS 集成）

| ID | 测试 | 结果 |
| --- | --- | --- |
| PR1 | `pr1_two_webviews_read_own_snapshot_and_events_are_targeted` | PASS |
| PR2/PR4 | `pr2_pr4_emit_ok_but_renderer_silent_keeps_assigned_zero_ack` | PASS |
| PR3 | `pr3_create_failure_releases_assignment_intent_retryable_zero_ack` | PASS |
| PR5 | `pr5_outcome_replay_rejected_after_terminal_single_ack`（host 幂等）+ TS B2-B5（action 不重跑、有限重报，window-bootstrap.test.ts 既有） | PASS |
| PR6 | `pr6_ack_completion_clears_once_with_bounded_summary`（40 终态 → 摘要 32、队列回落、重复 ack false） | PASS |
| F1 | `f1a_physical_rotation_refreshes_reservation_same_target` / `f1b_canonical_swap_rejects_delivery_without_cross_binding` | PASS |
| F2 | `f2_ordinary_refresh_failure_keeps_receipt_recovery_fail_closed` | PASS |
| F3 | `f3_save_as_committed_pending_hides_token_and_recovers`（DTO 键集断言：token/canonical 不出 host） | PASS |
| N1-N4 | 见上表 | PASS |
| W1 | `w1_open_c_while_a_open_keeps_a_and_new_window_for_c`（A registry 事实与 handle 均不变，C 新窗） | PASS |
| W2 | `w2_destroyed_combined_cleanup_other_windows_untouched`（registry/close/handle/recovery/deferred 五类） | PASS |
| C1 | `c1_close_isolated_by_label_and_closing_only_on_permit`（Hold/Cancel 不 Closing；permit 才 Closing；closing identity deferred） | PASS |
| H1 | `h1_recent_focused_label_drives_target_not_hardcoded_main` + 生产 dispatch 无 `get_webview_window("main")` 硬编码（shortcuts/mod.rs D4 重写） | PASS |
| 并发 | `concurrent_drain_single_create_per_intent`（4 线程并发 activation → 4 窗、标签唯一） | PASS |

renderer 腿（真实装配语义，mock IPC）：`apps/desktop/src/app/
window-bootstrap-integration.test.tsx`（open-path 全链/blank/decode 失败/
事件重发去重/retry UI/recovery UI）与 `window-bootstrap-blank.test.tsx`
（blank 初始空白判定 + StrictMode 双挂载：windowReady 恰好一次）。

## 5. 真实 macOS 矩阵（E2）

runner：`tests/e2e/macos/wave2-windows.mjs`（debug bundle 真实入口；
截图 + host stderr 结构化日志 + CGWindowList 窗口事实）。证据入库：
`docs/quality/evidence/wave2/mrt-004-wave2-macos-e2e.json`
（bundle SHA-256 `ac016f78…05467498`，10 场景，三次连跑 overall=PASS）。

| 场景 | 结果 | 入口 |
| --- | --- | --- |
| S1 cold 无文件 | PASS（1 窗 + barrier 日志） | 二进制直启 |
| S2 cold argv A/B | PASS（2 窗，main 先交付，1 editor） | 二进制 argv |
| S3 warm open A/B | PASS（2 新 editor，main 不替换） | `open -a`（LaunchServices；无文件关联注册，"打开方式"等价入口，未改 tauri.conf） |
| S4 重复打开 A | PASS（FocusWindow、窗口数不变） | symlink + 中文/空格名 |
| S5 打开 C | PASS（既有窗不变、C 新窗；dirty 变体人工矩阵——TCC 键盘边界） | `open -a` |
| S6 activation ×2 | PASS（两次 Reopen(warm) 各一新空白窗） | `open -a` 无文件 |
| S7 多窗关闭 | PASS（AppleEvent quit → ExitRequested 逐窗三分支 → 全部 Destroyed → 进程退出、窗口归零） | `tell app id … to quit` |
| S8 read 错误 | PASS（chmod 000 → retryable 恰一次、不自旋、窗口保持；reason 完整含 os error 13） | cold argv |
| S9 Save As/recovery | MANUAL（系统 rfd 对话框 AX 不可驱动——MM-090 已知边界；状态矩阵由 F2/F3 fake tests 锁定，不 mock 冒充） | — |
| S10 全局热键 | PASS（真实 ⌥Space 链路健康；分流目标语义由 H1 承担） | 系统热键 |

**环境事实（如实记录）**：本机当前 System Events AX 窗口枚举不可用
（MM-090 基线 E2E-01A 复跑亦超时——窗口计数恒 0，与 app 无关）。窗口
断言改用 CGWindowList（`scripts/quality/window-list.swift`，零新依赖，
CoreGraphics 自带）。红关闭按钮点击/⌘W 合成键盘/AX 树断言不可用：单窗
Cancel/Discard 分支由 MRT-003 既有 E2E 与 C1/W2 fake tests 锁定，人工
矩阵承接真实红按钮截图。

截图索引（`.tmp/wave2-e2e/`，不入库）：s1-cold-blank / s2-cold-ab /
s3-warm-ab / s4-duplicate-focus / s5-open-c / s6-activations /
s7-quit-all / s8-read-error / s10-hotkey。

## 6. 门禁结果（2026-08-31 本机 macOS）

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS 156/156（Wave 1 131 + Wave 2 新增 25） |
| `cargo clippy … --all-targets -- -D warnings` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS 4 files / 46 tests |
| `pnpm test:unit` | PASS 29 files / 277 tests |
| `pnpm typecheck` / `pnpm lint` | PASS |
| `pnpm quality` | PASS（8/8 子门禁） |
| `pnpm build` | PASS（仅既有 chunk-size warning） |
| rustfmt changed-scope（7 个 Wave 2 变更 Rust 文件） | PASS（先 `--write` 后 `--check`） |
| prettier changed-scope（14 个 Wave 2 变更 TS/TSX/MD/MJS） | PASS |
| `git diff --check` | clean |
| ADR 0008 SHA-256 | `a88c9606000a8e72e59ee634f02eecc652c0d82c1a336b8f5ad248c70a1c105e` 未变 |

### Windows target（如实记录）

- 主 crate `cargo check --target x86_64-pc-windows-msvc --lib`：**BLOCKED
  by 既有 baseline**——tauri-build 阶段 `icons/icon.ico not found`（与
  B1/B1A 验收记录一致；未修改图标/配置绕过）。
- **Wave 2 同源探针**（不复用 B1 旧探针）：将本批生产 runtime 的
  `lifecycle/{runtime,launch_coordinator,window_registry,mod}.rs` 与
  `file/*` 原样复制进独立 crate（ipc 层仅复制 serde DTO；tauri command
  薄壳属 tauri 自身跨平台性，不进探针），`cargo check --target
  x86_64-pc-windows-msvc` **编译通过**——`cfg(unix)` 边界（测试模块与
  Unix provider）完整，非 Unix 走 `CanonicalOnlyProvider`（identity
  strength 明示）。生产 runtime 尚未在真实 Windows 运行时验证，不声称
  Windows 整包通过。

## 7. 实现中发现并修复的问题

- **reason 退化为 `[object Object]`**：renderer bootstrap action 直接抛出
  invoke reject（`{code,message}` 形状，非 Error 实例），adapter 字符串化
  丢失信息。已在 action 内提取 message（E2E S8 实测日志确证修复后携带
  `Permission denied (os error 13)` 完整原因）。
- **S7 通道稳定性**：合成 ⌘Q 键盘在无 key window 时不稳定（MM-090 已知
  边界）——改用 AppleEvent `quit`（同 ExitRequested 协调链，确定性）。

## 8. 变更文件与范围声明

本批修改（任务卡允许列表内）：

- `apps/desktop/src-tauri/src/lifecycle/runtime.rs`（新增：LifecycleRuntime/
  HostEffectSink/effect executor/recovery/wave2_tests）
- `apps/desktop/src-tauri/src/lifecycle/launch_coordinator.rs`（complete_ack/
  摘要/pending_bootstraps_for/assigned_open_target/window_labels 等 Wave 2
  扩展；A1 语义零改动）
- `apps/desktop/src-tauri/src/lifecycle/mod.rs`、`src/lib.rs`（唯一生产装配）
- `apps/desktop/src-tauri/src/ipc/mod.rs`（新命令集 + TauriHostEffectSink +
  commit DTO rebindState + 退役旧命令）
- `apps/desktop/src-tauri/src/file/mod.rs`（OrdinaryCommitResult/
  CommittedButRefreshPending；CommittedButRebindPending 携带 token+target）
- `apps/desktop/src-tauri/src/shortcuts/mod.rs`（D4 多窗 label 路由）
- `packages/platform/src/ipc/types.ts`、`lifecycle/window-bootstrap.ts`
  （canonicalPath 可选展示投影）、`lifecycle/tauri-window-bootstrap.ts`
  （新增）、`file/tauri-file-adapter.ts`（退役直连打开）、`index.ts`
  （导出更新；删除 `tauri-adapter.ts`——生产消费者已随迁移移除，
  LaunchRouter/launch-router 保留供既有契约测试）
- `apps/desktop/src/app/mindmap-app.tsx`（bootstrap 装配/host intent 工具条/
  retry/dismiss/recovery UI）、`ports.ts`（LaunchPort）、`fake-ports.ts`
  （FakeLaunchPort/rebindState）
- 测试：`packages/platform/test/{window-bootstrap,tauri-adapters}.test.ts`、
  `apps/desktop/src/app/window-bootstrap-{integration,blank}.test.tsx`（新增）、
  4 个既有 app 测试的 ports fixture 更新
- `tests/e2e/macos/wave2-windows.mjs`（新增真实矩阵 runner）、
  `scripts/quality/window-list.swift`（新增 CGWindowList 工具）
- `docs/architecture/window-launch-lifecycle.md`（Wave 2 段）、
  `docs/quality/evidence/wave2/*`（evidence）
- `.omx/reviews/2026-08-31-mrt-004-wave-2-red-light-evidence.md` 与本文

未修改：ADR 0008 及 hash（校验一致）、capability、`tauri.conf.json`、
CI/CD、发布配置、core schema、export、onboarding 产品内容、文件格式、
MRT-001 保存队列语义、MRT-003 close 三分支（复用不改写）、键位与偏好
存储语义。无新增运行时依赖（sha2/uuid/serde/base64 均既有；
window-list.swift 用系统 Swift/CoreGraphics）。未进入 MRT-005 与最终视觉
实现。`.tmp/wave2-winprobe` 探针用后清理（命令已记录于第 6 节）。
