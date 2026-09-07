# MRT-004W2R 红灯证据（Phase R）

日期：2026-08-31。任务卡：`2026-08-31-mrt-004w2r-lifecycle-isolation-and-native-evidence-task-card.md` §4。
全部红灯在当前累计工作树上真实执行（非推演）；命令与失败输出如下。

## 命令与总体结果

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml w2r_red
# → 6 failed; 0 passed（R1/R2a/R2b/R4/R5/R6 全红）

pnpm exec vitest run apps/desktop/src/app/window-bootstrap-integration.test.tsx
# → 3 failed | 5 passed（R3/P4/H1 renderer 腿全红）

swift scripts/quality/image-stats.swift .tmp/wave2-e2e/{s1,s2,s7,s8}-*.png
# → 4 张全 DARK（meanLuma=0.0、nonDarkRatio=0.000），exit=1（R7）
```

## R1 launch error 按窗隔离

`r1_red_error_snapshot_carries_presentation_ownership`：

```text
panicked: R1:错误记录必须绑定呈现窗口(当前键:["intentId", "kind", "reason", "receivedAtMs"])
```

根因：`LaunchErrorSnapshot` 无 presentationWindowLabel/presentationWindowGeneration/
originFailedWindowLabel；`launch_errors_snapshot()`（runtime.rs:658）无 caller 参数，
`platform_launch_errors`（ipc/mod.rs:295）不注入 `WebviewWindow`——错误快照与
retry/dismiss（ipc/mod.rs:275/286 只注入 AppHandle）对所有窗口全局可消费。
签名演进腿（caller 注入）以编译缺口记录：`runtime.launch_errors_snapshot_for(caller)`
不存在。

## R2 Failed 窗口生命周期

`r2a_red_retry_reuses_failed_window_without_new_editor`：

```text
[lifecycle] effect CreateWindow editor-1
panicked: R2:retry 必须复用原 Failed 窗口,不得新建(实际建了 ["editor-1"])
```

根因：read 失败 `mark_failed` 后 retry 走 `coordinator.retry` 重新入队，warm 路由
见 main 非 Booting → 新建 editor；旧 main 停留 Failed（僵尸窗）。

`r2b_red_dismiss_failed_window_becomes_usable_blank`：

```text
panicked: R2:dismiss 后原窗必须进入 Blank 终态(实际 Failed)
```

根因：`dismiss()`（launch_coordinator.rs:525）只置 terminal(Dismissed)+ack，
不触碰 Failed 窗口；`prepare_rebind` 拒绝 Failed（INVALID_WINDOW_TRANSITION）→
「UI 可编辑但 host 拒绝保存」的死窗。

## R3 bootstrap report-pending 生产重报

TS `R3: report 传输失败 → pending-reports UI 出现…`：失败于
`screen.getByTestId("pending-reports")`——生产 `MindMapApp` 没有 pendingReports
状态、没有重报按钮；`retryPendingReports()` 零生产调用者（adapter 能力存在，
装配缺失）。另：`window_ready` 仅在 adapter 首次 `start()` 时经快照读取调用一次。

## R4 startup barrier 原子交错

`r4_red_open_enqueued_between_ready_check_and_blank_must_block_blank`：

```text
panicked: R4:open 已入队后,ready 的 Blank 确认必须被原子决策拒绝
```

根因：`window_ready()`（runtime.rs:499-515）由 `pending_bootstraps_for` →
`has_open_file_intents` → `mark_blank` 三次独立加锁拼接；测试在 lock2（检查通过）
与 lock3（写入）之间注入 `enqueue(OpenFile)`——open 已先获得 coordinator 临界区，
`mark_blank` 仍无条件放行 → main 被标 Blank、首文件被挤去新窗（TOCTOU）。

## R5 recovery generation 与记录替换

`r5_red_stale_recovery_must_not_touch_new_generation_registry`：

```text
[lifecycle] 窗口 editor-1 post-commit recovery 完成
panicked: R5:stale generation 的 recovery 必须 fail closed(旧记录不得作用于新代窗口)
```

根因：`resolve_pending_recovery`（runtime.rs:822-866）入口 clone 旧记录后：
①`PostCommitRecovery.window_generation` 从不比较（记录 gen=0，同名窗口已重建
gen≥2）；②锁外 provider I/O 后直接按 label 修改 registry；
③`recoveries.remove(caller_label)` 无条件按 label 删除（非 compare-and-remove）。
本测试构造的是可公共 API 复现的「stale 记录驱动新代 registry 并被当作成功清理」；
「删除新 generation 的 recovery」与「record 覆盖」两腿经 per-window gate +
compare-and-remove 在绿灯阶段以 `#[cfg(test)]` seam 直测（同 B1 系列先例）。

## R6 assigned open capability 失效竞态

`r6_red_destroyed_during_open_leaves_no_orphan_handle`（观测通道 =
`FileLifecycleService::document_handle_count`，任务卡 R6 明确允许的只读诊断）：

```text
panicked: R6:交付失效后该窗口不得残留孤立 handle(实际 1 个)
```

根因：`open_assigned_document`（runtime.rs:547-597）流程为
校验(锁内) → `open_file_with_identity`（锁外：读+resolve+**签发 handle**）→
再校验(锁内)。Destroyed 若落在 revoke_window 与 handle 签发之间，读取仍签发
新 handle，最终虽返回 stale，但该 capability 错过 Destroyed 清理成为孤立残留。

## R7 native runner 真实性门禁

`scripts/quality/image-stats.swift`（新增，零依赖）对 Wave 2 既有截图：

```text
s1-cold-blank.png   meanLuma 0.0  nonDarkRatio 0.000  DARK
s2-cold-ab.png      meanLuma 0.0  nonDarkRatio 0.000  DARK
s7-quit-all.png     meanLuma 0.0  nonDarkRatio 0.000  DARK   （与 s2 同 SHA）
s8-read-error.png   meanLuma 0.0  nonDarkRatio 0.000  DARK   （与 s1 同 SHA）
exit=1
```

事实：9 张截图只有 2 个 SHA、全部纯黑（连桌面内容都无——Screen Recording
权限缺失的典型症状），与验收报告 W2R-F6 一致。runner 侧弱断言（wave2-windows.mjs）：
S10 以「日志无注册失败」代替动作断言（:507-509）、S5/S7/S8 仅窗口计数或日志计数
（:356/:424/:461）、S9=MANUAL。修复合入 runner：截图有效性硬门禁（DARK/重复 →
FAIL）、每个 PASS 需结构化动作 facts、缺场景 → INCOMPLETE + 非零退出。

## 环境探针事实（Phase E 前置）

截图纯黑 = 本终端进程无 Screen Recording 权限。Phase E 将以
`CGPreflightScreenCaptureAccess`/`AXIsProcessTrusted` 探针确认权限状态并触发
系统授权请求；未获授权的场景按任务卡规则记 INCOMPLETE，不伪造证据。
