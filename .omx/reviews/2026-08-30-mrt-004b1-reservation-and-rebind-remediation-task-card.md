# MRT-004B1：Reservation 与保存换绑基础修复任务卡

## 1. 定位

**优先级：P0**

**状态：READY — 单次完成、单次验收**

**已接受：MRT-004A1**

**待修复：MRT-004B（B1-F1～F6）**

**下游：MRT-004C～E / Wave 2，继续锁定**

本卡只修复 Wave 1 的 FileIdentity/reservation/Save As host-domain 基础，不回退或重构已接受的 A1，也不接真实 Tauri 多窗口。所有问题在一个 Agent 工作周期内完成，最后统一交回验收。

## 2. 必读

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`（Accepted 1.0.0，禁止修改冻结 bytes/hash）。
3. `.omx/reviews/2026-08-30-mrt-004-wave-1-acceptance.md`。
4. `.omx/reviews/2026-08-30-mrt-004-wave-1-host-foundation-task-card.md`。
5. 当前 `file/identity.rs`、`file/authorization.rs`、`file/mod.rs`、`window_registry.rs`、`launch_coordinator.rs` 及测试。

当前工作树是累计现状，包含前序 Agent 和审查文档。不得还原、覆盖、清理或使用 destructive Git 命令。

## 3. 必须恢复的不变量

1. 任一 identity alias 同一时刻最多存在一个有效 reservation，不区分来源是 active window、window assignment 还是 pending Save As。
2. reservation 在产生异步副作用前建立；副作用失败时原子回滚。
3. rebind token 绑定 label、窗口代际、source identity 状态与 authorized canonical target；不能移花接木。
4. 每个 label 同一时刻最多一个 pending document rebind；stale/replay/cross-window token 稳定拒绝且零变化。
5. Blank/untitled 第一次 Save As 是正式支持路径，不能要求预先存在旧 identity。
6. 文件 I/O、provider metadata、IPC 不进入 coordinator lock。
7. 路径 identity 无损；`displayPath`/lossy string 只用于展示和日志。
8. macOS/Unix physical identity 与 Windows canonical-only compile boundary 显式分离。

## 4. 实施要求

### B1.1 先补红灯

先在最终测试文件增加并记录旧实现失败：

- `CreateWindow` effect 已发出后，同 target Save As prepare 插入；WindowCreated completion 不得形成 active+pending 双占用。
- pending target 存在时，所有 `begin_loading`/assignment 入口都不能抢占。
- prepare A 后 finalize B 稳定拒绝、snapshot 零变化。
- 同 label 第二个 pending rebind 稳定拒绝；旧 token 不能覆盖新状态。
- Blank/untitled Save As 成功 adopt identity；失败/取消保持无 identity。
- Closing + 原无 identity 的 close-save 成功后保持 Closing，不复活窗口。
- Windows target 对 Unix-only provider/test 不参与编译。
- 两个不同的非 UTF-8 `PathBuf` 不会因为 lossy 转换得到相同 canonical key（Unix test）。

红灯摘要写入 `.omx/reviews/2026-08-30-mrt-004b1-red-light-evidence.md`。

### B1.2 统一 reservation 事实

采用下列任一结构均可，但必须由测试证明所有入口共享同一事实：

- 在 `CreateWindow` effect 发出前建立显式 `Creating/Assigned` reservation，create 失败时回滚；或
- 建立独立 window-assignment reservation，与 active/pending rebind 一起进入统一 alias index。

要求：

- 不允许“route 检查一次、effect completion 再检查一次”之间出现无 owner 的竞态窗口。
- `identity_reservation`、`pending_rebind_of`、`begin_loading`、window assignment、prepare/finalize/abort/Destroyed 使用同一个 reservation invariant。
- create 失败不得留下幽灵 window/reservation/delivery；create 成功后的状态必须与真实窗口一致。
- Closing owner 和 pending rebind 仍是 deferred，不 focus、不 create、不 ack、不自旋。

### B1.3 绑定且单例化 rebind token

`PendingRebind` 至少保存：

```text
token
windowLabel
windowGeneration 或等价防 stale 字段
source identity / source state snapshot
authorized canonical target
reserved aliases
```

要求：

- 同 label 第二次 prepare 在首个 token 未 finalize/abort 前稳定拒绝。
- finalize 的 canonical target 必须与 token 完全一致；仅 physical alias 允许因 atomic replace 变化。
- finalize 检查所有 active/window-assignment/pending reservation；自己的当前 token 是唯一例外。
- 错 token、跨窗、重放、stale generation、目标错配全部零状态变化。
- commit 后若内部不变量失败，保留 fail-closed reservation并返回明确稳定错误；不得伪装回滚。

### B1.4 支持 untitled 首次 Save As

明确下列转换并写进 architecture：

- `Blank + no identity`：prepare → commit success → adopt final identity，并转换到能够表示已命名文档的稳定状态；不得要求旧 identity。
- `Open + identity`：Save As 成功后保持 Open，只更换 identity aliases。
- `Closing + no identity`：close-save 成功后保持 Closing并可暂时持有新 identity，随后 Destroyed 清理；不得转回 Open。
- 任一失败/取消：source state、identity、handle/token/displayPath、dirty 与 reservation 恢复到调用前语义。

若现有 `WindowState` 无法无歧义表达，允许在不改变 ADR 产品语义的前提下增加窄状态/转换；不得借机重写 MRT-003 close handshake。

### B1.5 建立可接线的 host-domain commit plan

不启用生产 Tauri 多窗口，但必须留下 Wave 2 可以直接组合的窄接口：

- open/ordinary commit 成功 outcome 带 host-only `FileIdentity` 或等价不可伪造结果；IPC DTO 仍只向 renderer 暴露既有 handle/token/displayPath。
- Save As 在写前能从 authorization ledger 取得并校验 window、kind、expiry、未消费状态和 canonical target plan。
- host orchestration 顺序固定为：authorization plan → prepare reservation → 锁外 redeem/TOCTOU/commit → refreshed identity → finalize；任何 commit 失败自动/显式 abort。
- authorization replay/race 不留下 pending token；同一授权不能驱动两个有效 rebind。
- 不得根据 receipt 的 `displayPath` 做 post-hoc identity 判定。

可采用 guard/plan/result 类型防止调用方漏掉 abort；若使用手工 API，必须用失败注入覆盖每一条退出路径。

### B1.6 修复平台与路径边界

- `CanonicalPathKey` 内部保留 `PathBuf`/`OsString` 或语义等价的无损平台路径，不存 `to_string_lossy()` 结果。
- debug/log/display projection 才允许 lossy；projection 不得参与 `Eq/Hash`。
- metadata 从已 canonicalize 的目标读取，避免 canonical/physical 来自两个不同 symlink 瞬间。
- `UnixFileIdentityProvider`、Unix physical variant 构造与 Unix-only 测试全部正确 `#[cfg(unix)]`。
- 非 Unix 提供明确的 platform provider/factory；本轮允许 Windows canonical-only，但必须清楚标注 identity strength，不能声称 hard-link 等价已完成。
- 不新增运行时依赖。若真实 Windows file ID 需要依赖，留到平台专项并报告。

### B1.7 证据与文档

生成：

- `.omx/reviews/2026-08-30-mrt-004b1-red-light-evidence.md`
- `.omx/reviews/2026-08-30-mrt-004-wave-1-implementation-evidence.md`

更新 `docs/architecture/window-launch-lifecycle.md`，但在审查者验收前保持 B 为 candidate/needs-remediation；Agent 不得自行写 ACCEPTED。证据需包含 B1 矩阵、Internal/final Gate、Windows check 的真实结果与已知 baseline blocker。

## 5. 必测矩阵

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| X1 | CreateWindow effect 后插入 pending rebind | 不出现双占用；intent/window 有明确可恢复状态 |
| X2 | pending 时直接/间接 begin_loading | 所有入口一致拒绝或 deferred |
| X3 | create 失败 | planned reservation/record/delivery 全清；intent retryable |
| T1 | prepare A + finalize B | 稳定拒绝；文件外全部状态零变化 |
| T2 | 同 label 双 prepare | 第二次拒绝；只有一个 token/reservation |
| T3 | stale/replay/cross-window token | 稳定拒绝；零变化 |
| U1 | Blank 首次 Save As 成功 | 文件、handle、identity、window state 全部一致 |
| U2 | Blank Save As 取消/失败 | 无 identity；session/dirty 与 registry 不变 |
| U3 | Closing untitled close-save | 保存成功但窗口仍 Closing；Destroyed 清理 |
| O1 | ordinary atomic replace | canonical owner连续；physical alias 刷新 |
| O2 | open outcome | 真实 host identity 与 handle/token 同源，不来自 renderer |
| A1 | authorization race/replay | 至多一次 commit/rebind；pending 不泄漏 |
| P1 | non-UTF8 paths（Unix） | 不同路径键不碰撞 |
| P2 | Unix symlink/hard-link/Unicode | 原 I-B1～I-B5 继续通过 |
| P3 | Windows source boundary | Unix-only source/test 被 cfg；canonical-only limitation 明示 |
| R/Q/F/P/L/T/C/B/Y | 已接受 A1 全矩阵 | 全部继续通过，不删弱断言 |

## 6. 允许与禁止修改

允许：

- `apps/desktop/src-tauri/src/file/identity.rs`
- `apps/desktop/src-tauri/src/file/authorization.rs`
- `apps/desktop/src-tauri/src/file/mod.rs`
- `apps/desktop/src-tauri/src/file/handle.rs`（仅必要的当前目标/失效语义）
- `apps/desktop/src-tauri/src/lifecycle/window_registry.rs`
- `apps/desktop/src-tauri/src/lifecycle/launch_coordinator.rs`
- `apps/desktop/src-tauri/src/lifecycle/mod.rs`（仅必要导出）
- `apps/desktop/src-tauri/src/ipc/mod.rs`（只允许保持 DTO 兼容的 host-only outcome 适配，不启用新多窗口命令）
- 对应 tests、evidence、`docs/architecture/window-launch-lifecycle.md`

禁止：

- 修改 ADR 0008/hash、capability、`tauri.conf.json`、CI/CD、发布配置。
- 在 `lib.rs` 接真实窗口/native source，或进入 Finder/Dock 验收。
- 修改最终 UI、onboarding、core schema、export、文件格式。
- 重写 MRT-003 close handshake、MRT-001 保存队列或 dirty 契约。
- 新增运行时依赖、使用 displayPath/lossy string 判 identity、吞错、自旋、sleep、弱化测试。

## 7. 验收命令

```bash
pnpm --filter @mindmap/platform test
pnpm test:unit
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
pnpm lint
pnpm quality
pnpm build
pnpm exec prettier --check <B1 变更 TS/MD>
rustfmt --edition 2021 --check --config skip_children=true <B1 变更 Rust>
git diff --check
git status --short
```

额外运行 Windows target source check。若仍先被既有 `icons/icon.ico` 缺失阻断，必须如实记录 blocker，并提供能证明本次 Unix-only source 已正确 cfg 的最小编译证据；不得修改图标/配置绕过红线。

## 8. 停止条件

仅在需要修改 capability/配置/CI/CD、安装依赖、改变 Accepted ADR、无法避免改变保存/close 产品语义或会覆盖现有工作树时停止请求项目负责人。其余局部实现选择自主完成，不需要中途微验收。

## 9. 完成回报

一次性报告：

1. B1-F1～F6 根因与修复映射。
2. 统一 reservation 数据结构与 CreateWindow 异步时序。
3. rebind token 绑定字段和 stale/replay 规则。
4. Blank/Open/Closing Save As 状态表。
5. authorization plan → prepare → commit → finalize/abort 的 host-domain 接口。
6. 无损路径与 Unix/Windows cfg 边界。
7. X/T/U/O/A/P 与 A1 回归矩阵。
8. 红灯、Wave 1 evidence 路径及全部命令结果。
9. `git diff --check`、`git status --short` 和范围声明。
10. 完成后停止，不自行进入 Wave 2。
