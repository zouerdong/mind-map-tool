# MRT-004 Wave 1 实现证据(A1 + B + B1)

日期:2026-08-30。本文件为任务卡 B1.7 要求的统一 implementation
evidence,覆盖 Wave 1(A1 + B)与 B1 修复批次的最终状态。

> 验收状态:**B / B1 NEEDS-REMEDIATION**。2026-08-31 统一验收见
> `.omx/reviews/2026-08-31-mrt-004b1-acceptance.md`;本文件保留为 Agent
> 自检证据，不等同于审查通过。

## 最终数据结构(host,Rust)

```text
FileIdentity                       (file/identity.rs)
  canonical: CanonicalPathKey(PathBuf)   // 无损;lossy 仅 display_lossy 投影
  physical?:  PlatformPhysicalFileKey{Unix{dev,ino}}   // cfg(unix)
  strength:   CanonicalAndPhysical | CanonicalOnly     // 不冒充等价性

IdentityAlias = Canonical(key) | Physical(key)          // 独立成键

WindowRegistry(纯数据,&mut self)
  windows:       HashMap<label, WindowRecord{state, file_identity?, …, generation}>
  alias_owners:  HashMap<IdentityAlias, Ownership{label, kind: Active|Assignment}>
  pending_rebinds: HashMap<token, PendingRebind{token, window_label,
                     window_generation, source, authorized_target,
                     reserved_aliases}>                   // per-label 单例
  deliveries / counters

LaunchCoordinator: Mutex<CoordinatorState{registry, intents, order, in_flight}>  // 唯一锁
```

## 统一 reservation invariant(B1-F1)

任一 identity alias 同一时刻最多一个有效 reservation。Active 与
Assignment 共用 `alias_owners`；Pending rebind 保存在独立表，但所有
写入口都必须同时检查两者:

1. **Active**(已登记窗口 Loading/Open/Closing 持有);
2. **Assignment**(`reserve_assignment`:CreateWindow effect 发出**前**
   为将建窗口预留;`release_assignment` 在 create 失败时原子回滚);
3. **Pending rebind**(Save As 写前预占,per-label 单例)。

`begin_loading` / `reserve_assignment` / `prepare_rebind` /
`finalize_rebind` / `refresh_identity_after_commit` / 路由判定全部走同一
索引,无"route 检查一次、completion 再检查一次"的竞态窗口。

## CreateWindow 异步时序(B1.2)

```text
decide_route(锁内): allocate label → reserve_assignment(label, identity)
  → [锁外] CreateWindow effect
     ├─ ok 回报(锁内): assignment_of==target 校验 → register
     │   → begin_loading(升级 Active)→ next_delivery
     └─ fail 回报(锁内): release_assignment(原子回滚,无幽灵)
```

## rebind token 绑定与 stale/replay 规则(B1-F2)

`PendingRebind` 绑定 windowLabel + windowGeneration(register 递增)+
source 状态快照 + authorized canonical target + reserved aliases。

- 同 label 第二次 prepare 在首个未终结前 `IDENTITY_ALREADY_RESERVED`(T2);
- finalize 的 canonical 必须与 token 完全一致,仅 physical 允许因原子
  替换轮换(T1 移花接木拒绝);
- 错 token/重放/stale generation(同名窗口重建)`INVALID_REBIND_TOKEN`
  且零状态变化(T3);跨窗调用因 API 无 caller label 尚未实现，也没有被
  当前名为 `t3_cross_window…` 的测试实际覆盖;
- finalize 占用检查覆盖 active/assignment/pending,owner 为本 label 的
  Active 与本 token 自身为唯一例外;
- `finalize_rebind` 自身校验失败会保留 reservation；但 orchestration 在
  commit 成功、identity refresh 失败时仍会 abort，写后 fail-closed 尚未完成。

## Blank/Open/Closing Save As 状态表(B1-F3)

| prepare 时窗口状态 | commit 成功后 | 失败/取消 |
| --- | --- | --- |
| Open + identity | 保持 Open,只换 aliases | 全部恢复(source state/identity/ reservation 零变化) |
| Loading + identity | 保持 Loading,换 aliases | 同上 |
| Closing + identity | 保持 Closing,换 aliases | 同上 |
| Blank 无 identity(untitled 首存) | **adopt → Open**(窄转换,仅 finalize 路径) | 保持 Blank 无 identity |
| Closing 无 identity(close-save) | 保持 Closing 暂持新 identity(不复活),Destroyed 清理 | 保持 Closing 无 identity |

## host-domain 编排接口(B1-F4)

```text
FileLifecycleService:
  open_file_with_identity(...) -> (OpenOutcome, FileIdentity)   // O2:host identity 与 handle/token 同源
  refreshed_identity_after_commit(path) -> FileIdentity   // 当前 path 未与 handle 绑定
  plan_document_save_as(label, authRef) -> AuthorizationPlan     // 不消耗
  commit_save_as_planned(label, plan, content) -> Receipt

orchestrate_save_as(coordinator, service, provider, label, authRef, content)
  = plan(锁外)→ resolve target(锁外)→ prepare(锁内)
    → redeem/TOCTOU/commit(锁外;失败→显式 abort,不泄漏 token)
    → refreshed(锁外)→ finalize(锁内;fail closed)
```

- plan 不消耗授权(redeem 单次消耗);authorization replay 在 plan 阶段
  拒绝且无 pending 泄漏(A1);
- IPC DTO 不变(handle/token/displayPath);identity 不出 host。当前
  `open_file_with_identity` 仍从 `displayPath` 反建 `PathBuf`，ordinary
  identity 刷新也由调用方另传 path；B1A 必须消除这两个移花接木入口。

## 测试矩阵(B1 + 回归)

| ID | 测试 | ID | 测试 |
| --- | --- | --- | --- |
| X1 | `red_x1_active_occupancy…` + `red_x1_coordinator_create_gap…` | T3 | stale/forged/replay 已覆盖；cross-window 缺失 |
| X2 | `red_x2_pending_blocks_all…` | U1 | `red_u1…` + `u1_untitled_first_save_as_full_orchestration` |
| X3 | `x3_create_failure_releases_assignment…` | U2 | `red_u2…` + `u2_authorization_expired…` |
| T1 | `red_t1_prepare_a_finalize_b…` | U3 | `red_u3_closing_untitled…` |
| T2 | `red_t2_second_prepare…` | O1/O2 | `o1_orchestration_ordinary…` / `o2_open_outcome_carries…` |
| A1 | `a1_authorization_replay_cannot_drive_two_rebinds` | P1 | `p1_non_utf8…`×2(内存构造,见红灯证据可达性说明) |
| P2 | I-B1~B5 全部保留通过 | P3 | Windows probe 编译通过(见红灯证据) |
| S-B1~B5 | registry + 编排(`s_b3_orchestration…`) | R/Q/F/P/L/T/C/B/Y | A1 全矩阵保留通过(119/119) |

## 门禁结果(2026-08-30,本机 macOS)

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | PASS 119/119(100→119) |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS 47/47(本批未改 TS) |
| `pnpm test:unit` / `pnpm quality` / `pnpm build` / typecheck / lint | PASS（审查者 2026-08-31 独立复验：27 files / 271 tests） |
| rustfmt / prettier(changed-scope) | PASS |
| `git diff --check` | PASS |
| Windows target check | **BLOCKED by 既有 `icons/icon.ico` 缺失**(tauri-build 阶段,baseline blocker,非本批引入);identity 源码经独立探针在 `x86_64-pc-windows-msvc` 编译通过(cfg 证明) |

## 已知 baseline blocker(如实记录)

- Windows 整 crate 编译被 `icons/icon.ico` 缺失阻断(先于源码编译);
  本批以探针证明 Unix-only 源码 cfg 正确,未修改图标/配置绕过红线。
- 非 UTF-8 文件名的端到端夹具在 macOS 文件系统不可创建(code 92);
  P1 以内存构造锁定(见红灯证据)。
