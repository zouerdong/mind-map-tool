# MRT-004W2R 实现证据（Phase R→H→P→E→Windows 单批完成）

日期：2026-08-31。红灯记录见 `2026-08-31-mrt-004w2r-red-light-evidence.md`。
任务卡：`2026-08-31-mrt-004w2r-lifecycle-isolation-and-native-evidence-task-card.md`，
单次执行、单次交回统一验收。

## 1. W2R-F1～F7 根因与逐项修复映射

| 发现 | 根因 | 修复（生产代码） |
| --- | --- | --- |
| F1 错误可串窗 | 快照无 caller 绑定；retry/dismiss 不注入 WebviewWindow | `LaunchErrorSnapshot` 增 presentationWindowLabel/Generation + originFailedWindowLabel；`platform_launch_errors/retry/dismiss` 注入 `WebviewWindow`；`launch_errors_snapshot_for(caller)` 按 caller+generation 过滤；`ensure_owned_retryable` 校验呈现所有权；Destroyed 后呈现转移（活窗+generation 更新）或 host-only |
| F2 Failed 僵尸窗 | retry 走 warm 路由建新窗；dismiss 不收口窗口 | `retry_failed_in_place`（coordinator 单锁：origin Failed 窗原位 Failed→Loading→新交付，锁外重新解析目标）；`dismiss` 同临界区执行 registry `failed_to_blank`（清 active intent/交付槽）；host 侧原窗恢复 + dismiss 后 Blank 可首次 Save As 由 r2a/r2b 红转绿锁定 |
| F3 report-pending 不可恢复 | 生产无 retryPendingReports 调用者；单例捕获失效 session closure | MindMapApp：模块级"当前挂载实现"持有者（action/report-error 经它解析，StrictMode 重挂载后指向新实例）；pending-reports UI + 显式一次重报（无自动 timer）；`TauriLaunchPort` 统一 toPlatformError 映射（invoke reject 不再退化为 `[object Object]`） |
| F4 startup barrier 非原子 | 三个独立加锁调用拼接（TOCTOU） | `confirm_startup_blank` 单锁完成读快照+验证+确认 Blank；`mark_blank` 增加 open-intent 守卫（`STARTUP_BARRIER_OPEN_PENDING`）——R4 红灯测试的注入点在修复后直接成为守卫的回归 |
| F5 generation 只记录不校验 | resolve 入口 clone 后不再比较；remove 按 label 无条件 | resolve：入口 generation 校验 → 锁外刷新 → 回写前再校验（记录仍同代）→ **compare-and-remove**；`record_recovery` 不覆盖既有记录（fail closed）+ 窗口不存在不记录；per-window `commit_gates` 串行同窗 commit/recovery；`pending_recovery` 查询同样校验 generation |
| F6 assigned open 孤立 handle | handle 在 revoke_window 之后签发，错过 Destroyed 清理 | 交付校验失败时 `revoke_document_handle`（HandleRegistry 精确撤销）+ `document_handle_count` 只读诊断（R6 零残留断言的观测通道） |
| F7 证据缺口 | 弱断言 + 截图废片 + 不可复现 probe | 见 §4/§5/§6 |

## 2. 红灯 → 绿灯映射（测试名）

| 红灯（先失败） | 修复后 |
| --- | --- |
| `r1_red_error_snapshot_carries_presentation_ownership` | 绿（serde 键集含呈现所有权） |
| `r1_error_visibility_and_actions_bound_to_presentation_window` | 绿（main 空、editor 唯一可见；跨窗 retry/dismiss INVALID_INTENT_ACTION 零变化；editor 原窗恢复） |
| `r1_destroyed_presentation_window_transfers_then_host_only` | 绿（转移到 editor-9 且 dismiss 可达；无活窗 host-only、重建窗口不可见） |
| `r2a_red_retry_reuses_failed_window_without_new_editor` | 绿（retry 零建窗，main Failed→Loading→Open） |
| `r2b_red_dismiss_failed_window_becomes_usable_blank` | 绿（Blank、active intent/delivery 清空、prepare_rebind 通过） |
| `r2_dismiss_replay_zero_side_effects_and_single_ack` | 绿（重放拒绝、不二次 ack） |
| `r4_red_open_enqueued_between_ready_check_and_blank_must_block_blank` | 绿（mark_blank 拒绝 `STARTUP_BARRIER_OPEN_PENDING`） |
| `r4_startup_barrier_linearizes_both_orders_via_real_runtime` | 绿（open 先行→main 承载；ready 先行→open 走新窗） |
| `r5_red_stale_recovery_must_not_touch_new_generation_registry` | 绿（stale Err，新代窗口 registry 不变） |
| `r5_record_insert_never_overwrites_existing` | 绿（第二笔被拒，第一笔保留） |
| `r5_destroyed_during_refresh_does_not_delete_new_generation_record` | 绿（Condvar 闸门无 sleep；旧 resolve 中止，新代记录完整） |
| `r6_red_destroyed_during_open_leaves_no_orphan_handle` | 绿（handle 计数 0） |
| TS `R3 report 传输失败 → pending-reports UI…` | 绿（UI 出现→一次重报→消失；action 恰一次） |
| TS `P4 重挂载后当前 session 承接交付` | 绿（当前挂载实现持有者） |
| TS `H1 {code,message} 映射 PlatformError` | 绿（TauriLaunchPort.call throw toPlatformError） |
| R7 image-stats 对 Wave 2 旧截图 | 全 DARK → 新 runner 截图全 VALID |

既有矩阵回归：Wave 1/2 全部 168 个 Rust 测试与 280 个 TS 单测保持绿
（read_failure 等 3 个用例按 W2R-F2 语义更新为"原窗恢复"期望）。

## 3. 环境探针事实（E2 前置，通道结论的依据）

- **System Events AX 窗口枚举在本 shell 不可用**（osascript 责任进程对
  Chrome/Finder/app 窗口计数恒 0）；**swift 直连 AXUIElement 可用**
  （app 窗口树/aria-label 按钮可读）→ 驱动走 `scripts/quality/ax-driver.swift`。
- **显示器休眠是截图纯黑 + AX 退化的统一根因**（Wave 2 旧 9 图与休眠帧
  同 SHA）；`caffeinate -d` 常驻 + 启动期唤醒确认门后稳定。
- **直接 spawn 二进制的窗口不上屏**（CGWindowList 可见但像素透明/AX 退化）；
  `open -a`（LaunchServices）启动的窗口真实渲染 → 全部场景经
  `open -a --stderr <log>` 启动（host 结构化日志同步可捕获）。
- **WKWebView 的 DOM 按钮对 CGEvent 点击偶发不触发**（clickUntil 模式：
  以可观察效果验证并重试）；**原生 NSSavePanel 面板处于 rfd blocking 冻结态**
  （AX/键盘可读写名称栏——keycode 路径输入实测可见——但 CGEvent 点击、
  Return、AXPress 均无法确认；面板挂起期间主线程被 modal loop 占据，
  红按钮被 sheet 遮挡、AppleEvent quit 的 ExitRequested 不可达）——
  与 MM-090 记录的系统对话框人工矩阵边界一致，如实标注不伪造。
- **字符文本输入不可达**（CGEvent unicode/剪贴板⌘V/keycode 对 WKWebView
  textarea 均无效）；dirty/保存断言改用"节点计数"语义（双击建点 = AddNode
  提交 = dirty + 可持久化内容），节点卡片 aria-label（`节点：<文本>`）
  提供 AX 级计数通道。

## 4. 真实 macOS 十场景（E2）

runner：`tests/e2e/macos/wave2-windows.mjs`（重写；支持 `--only` 调试）。
三连跑（同 bundle SHA-256 `900d20b942a8…2de0`，时间错开，均
**10/10 PASS、overall=PASS、退出码 0**）：

- `docs/quality/evidence/wave2/mrt-004w2r-macos-e2e-run1.json`（13:22:53Z）
- `docs/quality/evidence/wave2/mrt-004w2r-macos-e2e-run2.json`（13:26:29Z）
- `docs/quality/evidence/wave2/mrt-004w2r-macos-e2e-run3.json`（13:29:53Z）

每场景 verdict 仅由结构化 facts 计算；30 张截图/run 全部过 image-stats
（VALID、无跨场景重复；DARK/重复即 FAIL）；缺口在 facts/note 显式记录
（S9 Save As 面板确认与 recovery 注入的环境边界，见 §3 与 runner note）。

| 场景 | 关键 facts（动作断言） |
| --- | --- |
| S1 | 1 窗；decision=BlankConfirmed；零建窗 |
| S2 | 2 窗；main 先交付；ack Opened×2（ack 日志行） |
| S3 | 3 窗；A 浅色(luma≈253)/B 深色(≈9)可区分；main 零再分配且保持空白 |
| S4 | symlink 中文空格入口；FocusWindow 执行；窗口数不变 |
| S5 | A 双击建点（AX 节点 +1）；open C 后 A 区域亮度不变 + docA 未触碰；C 为第 3 个 editor |
| S6 | Reopen(warm)×2；每次一新窗；main 保持空白 |
| S7 | clean 关窗；cancel 保窗（modal 真实关闭）；save=ordinary 落盘 3 节点并关窗；discard 零写盘 + B 窗/docB 未动；pending=面板挂起 + quit 后进程/窗口原样（fail closed，close 协议零日志） |
| S8 | chmod 000 → 错误 UI 可见且稳态不自旋；chmod 644 + 点「重试打开」→ 原窗恢复（零建窗、ack Opened）；二次错误 + 点「放弃」→ ack Dismissed 恰一次；原窗 Blank 可打开 Save 面板 |
| S9 | blank 保存入口真实打开系统面板；已开文档 dirty→⌘S 落盘节点 2 且不弹面板 |
| S10 | 真实 ⌥Space：目标 editor 区域截图变化（quick-create 建点）+ main 区域零变化 |

## 5. Windows

- 主 crate `cargo check --target x86_64-pc-windows-msvc --lib`：BLOCKED
  —— 既有 `icons/icon.ico not found` baseline（raw log 入库，未修改配置绕过）。
- 同源 probe **一条命令**：`node scripts/quality/windows-probe.mjs`
  —— 复制生产 lifecycle 全量 + file 全量 + ipc serde DTO（精确提取）进
  独立 crate，Windows target **编译 PASS（exit 0）**；raw log 与源码
  SHA-256 清单入库 `mrt-004w2r-windows-*`。不声称等同 Windows 实机。

## 6. 门禁（2026-08-31 本机 macOS）

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS 168/168（Wave 2 162 + W2R 新增 6 红灯保留 + 修正） |
| `cargo clippy … --all-targets -- -D warnings` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS 4 files / 46 tests |
| `pnpm test:unit` | PASS 29 files / 280 tests |
| `pnpm typecheck` / `pnpm lint` | PASS |
| `pnpm quality` | PASS（8/8 子门禁） |
| `pnpm build` | PASS（仅既有 chunk-size warning） |
| rustfmt changed-scope（6 Rust 文件） | PASS |
| prettier changed-scope（8 TS/TSX/MJS/MD） | PASS |
| `node tests/e2e/macos/wave2-windows.mjs` ×3 | overall=PASS ×3（退出码 0） |
| `node scripts/quality/windows-probe.mjs` | probe=PASS（main-crate blocker 如实记录） |
| `git diff --check` | clean |
| ADR 0008 SHA-256 | `a88c960…1c105e` 与 MRT-004G 批准记录 `adrSha256` 一致 |

## 7. 变更文件（任务卡允许列表内）

Rust：`lifecycle/{runtime,launch_coordinator,window_registry}.rs`（错误
所有权/原窗恢复/原子 barrier/registry 窄转换）、`ipc/mod.rs`（caller 注入）、
`file/{mod,handle}.rs`（精确撤销 + 计数诊断）。
TS：`packages/platform/src/ipc/types.ts`（快照契约字段）、
`apps/desktop/src/app/{mindmap-app,ports}.tsx|ts`（当前实现持有者/
pending-reports UI/错误映射）、`window-bootstrap-integration.test.tsx`
（R3/P4/H1 红转绿）。
工具/测试：`tests/e2e/macos/wave2-windows.mjs`（重写）、
`scripts/quality/{ax-driver,image-stats,permission-probe}.swift`、
`scripts/quality/windows-probe.mjs`（新增）。
文档/证据：`docs/architecture/window-launch-lifecycle.md`（W2R 段）、
`docs/quality/evidence/wave2/mrt-004w2r-*`（E2×3 + Windows×4）、
`.omx/reviews/2026-08-31-mrt-004w2r-*`（红灯/本文）。

未修改：ADR 0008（hash 比对一致）、capability、`tauri.conf.json`、CI/CD、
发布配置、core schema、export、onboarding 产品内容、文件格式、键位语义；
无新增运行时依赖（swift 工具用系统 Swift/CoreGraphics/AppKit）。
未进入 MRT-005 与最终视觉实现。`.tmp/` 探针目录已清理
（E2 截图与 aggregate 保留于 `.tmp/wave2-e2e-run{1,2,3}` 供验收查看）。
