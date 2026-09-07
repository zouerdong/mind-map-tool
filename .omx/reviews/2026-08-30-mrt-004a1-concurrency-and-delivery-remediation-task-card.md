# MRT-004A1 并发与交付可靠性修复任务卡

## 1. 定位

**优先级：P0**

**状态：ACCEPTED — 2026-08-30 Wave 1 统一验收通过**

**上游：MRT-004G ACCEPTED；MRT-004A NEEDS-REMEDIATION**

**下游：MRT-004B（A1 内部 Gate 通过后由同一 Agent 继续，不等待人工验收）**

> 派发入口已调整为 `.omx/reviews/2026-08-30-mrt-004-wave-1-host-foundation-task-card.md`。本文件继续作为 A1 技术子规格；其中范围限制适用于 Phase A。Wave 1 Internal Gate 通过后，由合并任务卡授权进入 B。

> 验收结果：A1-F1～F5 与 L/T/C/B/Y、原 R/Q/F/P 矩阵已通过；后续 B1 不得回退本卡已接受的不变量。

本卡修复 MRT-004A 的并发所有权、原子状态推进、Closing identity 和 bootstrap outcome 重报协议。Phase A 不得接真实 Tauri 窗口、真实文件 identity、Finder/Dock 或最终 UI；Internal Gate 通过后可按 Wave 1 卡进入真实文件 identity 基础，仍不得接真实窗口/native source/最终 UI。

## 2. 必读

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`。
3. `.omx/reviews/2026-08-30-mrt-004a-acceptance.md`。
4. `.omx/reviews/2026-08-30-mrt-004a-state-machine-foundation-task-card.md`。
5. `.omx/reviews/2026-08-30-mrt-004-development-guide-and-task-card.md`。
6. 当前 `window_registry.rs`、`launch_coordinator.rs`、`window-bootstrap.ts` 及其测试。

当前工作树包含 MRT-003V 审查小修、ADR 0008、MRT-004G/A 实现和验收文档，全部属于项目现状。不得覆盖、还原、丢弃或用 destructive Git 命令清理。

## 3. 修复目标

1. Host 状态只存在一个并发 owner；消除所有 ABBA 锁序可能。
2. Registry + intent + delivery 的一次逻辑转换要么全部提交，要么零变化。
3. renderer action 只执行一次；终态 outcome 在 host 确认前不得丢失。
4. Closing 窗口的 identity 策略一致，不产生重复窗或卡死 reservation。
5. TS/Rust bootstrap outcome 和 payload 类型一一对应。

## 4. 强制设计

### 4.1 单 owner 状态

推荐且本卡默认采用：

```text
WindowRegistry
  - 纯数据结构，无内部 Mutex/Atomic
  - windows / identityOwners / deliveries / counters
  - 方法使用 &mut self 做验证和转换

CoordinatorState
  - registry: WindowRegistry
  - intents
  - order
  - inFlight
  - intentCounter

LaunchCoordinator
  - state: Mutex<CoordinatorState>   // 唯一状态锁
```

要求：

- 不保留 windows/identity/deliveries/intents/order/in-flight 各自独立 Mutex。
- 不公开可绕过 coordinator 的 `registry()` 可变通道；只提供只读 snapshot 和窄的 host lifecycle 方法。
- 任何 Tauri/文件/窗口副作用都只能作为 effect 返回，必须在 state lock 释放后执行。
- 不在锁内调用未来可能阻塞的 OS API、IPC、文件 I/O 或 renderer 回调。
- 若实现者拒绝单锁方案，必须在写代码前提交等价、可机器验证且不存在反向锁序的替代设计；不得继续沿用“多锁+注释约定”。

### 4.2 原子转换

以下操作必须在一次 state 临界区中完成：

- 创建窗口成功回报：验证 intent/label → register → identity reservation（open-file）→ delivery 生成 → phase 更新。
- bootstrap delivered 回报：correlation 验证 → phase Assigned。
- renderer outcome：验证 intent/label/delivery/current generation/window state/outcome kind → delivery completed → window state → intent terminal/retryable。
- Destroyed：registry/reservation/delivery 清理；相关非终态 intent 转 retryable/deferred；不得丢失。
- retry/dismiss：phase/order/in-flight/错误上下文同步更新。

先验证全部前置条件，再修改任何字段。返回错误时，调用前后的完整 snapshot 必须相等。

### 4.3 Closing identity

采用以下首版语义：

- Open/Loading/Closing 都占用 identity，直到 Destroyed。
- Loading/Open 的重复 open → FocusWindow。
- Closing 的重复 open → 保持原 intent queued/deferred，零 create、零 focus、零 ack。
- Destroyed 清 reservation 后，host 再调用 `route_next()`，该 intent 才能创建/分配窗口。
- 不使用 sleep、轮询或自动自旋等待 Closing。

需要显式查询 API 区分 `focusable owner` 与 `closing reservation`，不能再出现“查询为 None、写入却拒绝”的分裂事实。

### 4.4 Bootstrap outcome 可靠重报

每个 delivery 至少有以下 renderer 本地阶段：

```text
queued -> processing -> report-pending -> reported
```

要求：

- event/snapshot 双达时 action 恰好执行一次。
- action resolve/reject 后缓存标准化 outcome。
- `reportOutcome` 成功后才进入 reported。
- `reportOutcome` 失败时保留 report-pending 和 outcome；不得空 catch、不得重新执行 action。
- 同 delivery 重发时，如果 processing 则去重等待；如果 report-pending，只重报缓存 outcome；如果 reported，忽略。
- 提供显式 `retryPendingReports()`，由后续 transport reconnect/窗口 ready 接线调用；一次调用每个 pending delivery 最多重报一次，不自旋。
- 提供可观察的 report failure 通道，例如构造参数 callback 或稳定 error snapshot；不得把 IPC 失败静默掉。
- `dispose()` 后不接新 delivery；已经 processing/report-pending 的 outcome 仍按明确、测试过的策略保留或完成。
- `start()` 重复调用必须幂等或稳定拒绝；snapshot 读取失败不得泄漏第二个 listener。

### 4.5 TS/Rust 类型对齐

将 renderer 可回报 outcome 收窄为：

```text
opened | blank-created | retryable-error
```

`focused-existing` 与 `dismissed` 只属于 host terminal outcome，不得由 `WindowBootstrapAdapter.action` 返回。

`WindowBootstrap` 使用判别联合：

```ts
type WindowBootstrap =
  | { deliveryId: string; intentId: string; kind: "open-path"; canonicalPath: string }
  | { deliveryId: string; intentId?: string; kind: "blank" };
```

不得用可选字段组合制造 `open-path + undefined canonicalPath` 或 `blank + canonicalPath`。

## 5. TDD 步骤

### A1.1：先补失败测试

直接在最终测试文件中增加用例，先运行并记录失败摘要，再修实现；不创建需要任务结束时删除的临时测试文件。

必须先得到以下红灯：

1. Closing owner 查询与 reservation 写入结论不一致。
2. Closing 同 identity open 会错误 CreateWindow 或卡在部分提交。
3. WindowCreated 中途失败会留下 registry/delivery/phase 差异。
4. renderer outcome 窗口状态无效会先消费 delivery。
5. `reportOutcome` 首次失败后，同 delivery 重发被 seen 丢弃。
6. 重报 outcome 会重复执行 action。
7. `start()` 二次调用泄漏 listener，或 snapshot 失败后 listener 未清理。

红灯摘要新增到 `.omx/reviews/2026-08-30-mrt-004a1-red-light-evidence.md`，包含测试名、旧结果、根因和最终映射。

### A1.2：重构单 owner

- 将 WindowRegistry 改为 `&mut self` 纯数据状态。
- 新建单一 CoordinatorState mutex。
- 迁移现有 R/Q/F/P 测试，不降低断言。
- 添加多线程 smoke test：多个线程并发 enqueue/snapshot/retry-invalid/route 调用必须在有限时间内完成；该测试只作为补充，不能替代结构上的单锁保证。

### A1.3：实现原子 reducer

- 为关键 action 建立 validate-then-commit。
- 为失败注入提供测试 seam，不引入生产环境绕过开关。
- 对每种失败保存 before/after snapshot 并断言完全相等。
- replay/cross-window/stale completion 的稳定错误码保持不变。

### A1.4：修复 Closing policy

- 添加 `identity_reservation(identity)` 返回 label + state。
- coordinator 只对 Loading/Open 生成 FocusWindow。
- Closing 返回 deferred/零 effect，intent 留在 order 中。
- Destroyed 后能继续 route，同 intentId 不变。

### A1.5：修复 bootstrap report

- 用 per-delivery state map 替换单一 `seen`。
- 缓存 outcome，失败只影响 report，不重跑 action。
- 增加 `retryPendingReports()` 与 failure 可观察通道。
- 收紧 TS 判别联合与 renderer outcome。

### A1.6：同步文档

更新 `docs/architecture/window-launch-lifecycle.md`：

- 单 owner/单锁结构。
- 原子 reducer 边界。
- Closing identity 延迟路由语义。
- bootstrap action-once/outcome-at-least-once-report 协议。
- 仍未完成 MRT-004B～E 的事实。

验收通过前不要删除页面顶部 NEEDS-REMEDIATION 提示；由审查者验收时更新状态。

## 6. 必测矩阵

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| L1 | Registry/Coordinator 所有状态 | 单一 state owner；不存在反向多锁结构 |
| L2 | 并发 smoke | 有限时间完成，无死锁；最终 snapshot 自洽 |
| T1 | WindowCreated reservation 失败 | registry/delivery/intent/in-flight 零部分提交 |
| T2 | renderer outcome 状态不匹配 | delivery 未消费；窗口/intent 不变 |
| T3 | replay/cross-window/stale | 稳定拒绝；全 snapshot 不变 |
| T4 | Destroyed during assigned | intent 可恢复，reservation/delivery 无泄漏 |
| C1 | Closing identity lookup | 查询与写入使用同一事实 |
| C2 | Closing 时重复 open | 零 create/focus/ack；intent deferred |
| C3 | Destroyed 后 | 同 intentId 恢复路由并可终结 |
| B1 | action pending + 双达 | action 恰好一次，零提前 report |
| B2 | report 首次失败 | outcome 缓存，failure 可观察，状态 report-pending |
| B3 | delivery 重发 | 只重报缓存 outcome，不重跑 action |
| B4 | `retryPendingReports()` | 每次至多重报一次；成功后 reported；不自旋 |
| B5 | action reject + report 失败 | retryable outcome 不丢，action 不重跑 |
| B6 | start/snapshot failure | 无 listener 泄漏；重复 start 语义稳定 |
| Y1 | open-path 类型 | canonicalPath 和 intentId 编译期必填 |
| Y2 | renderer outcome | TS/Rust 都只有 opened/blank-created/retryable-error |
| R/Q/F/P | MRT-004A 原矩阵 | 全部保留并继续通过，不得删弱测试 |

## 7. 允许修改

- `apps/desktop/src-tauri/src/lifecycle/window_registry.rs`
- `apps/desktop/src-tauri/src/lifecycle/launch_coordinator.rs`
- `apps/desktop/src-tauri/src/lifecycle/mod.rs`（仅必要导出）
- `packages/platform/src/lifecycle/window-bootstrap.ts`
- `packages/platform/test/window-bootstrap.test.ts`
- `packages/platform/src/index.ts`（仅类型导出）
- `docs/architecture/window-launch-lifecycle.md`
- `.omx/reviews/2026-08-30-mrt-004a1-red-light-evidence.md`

Phase A 禁止修改：

- Tauri capability、`tauri.conf.json`、CI/CD、发布配置。
- `lib.rs` 真实窗口/native source 接线。
- 文件 identity 真实 canonicalize/device/inode 实现（Internal Gate 后由 Wave 1 Phase B 解锁）。
- `MindMapApp`、最终 UI、保存队列、MRT-003 close handshake。
- core schema、export、文件格式和 onboarding。
- ADR 0008 与 MRT-004G 批准记录；其 hash 已冻结。

## 8. 验收命令

```bash
pnpm --filter @mindmap/platform test
pnpm test:unit
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
pnpm lint
pnpm quality
pnpm build
pnpm exec prettier --check <本卡 TS/MD 文件>
rustfmt --edition 2021 --check --config skip_children=true <本卡 Rust 文件>
git diff --check
git status --short
```

不得运行或声称 Finder/Dock 多窗口验收；本卡仍是纯状态机修复。

## 9. 完成定义

- A1-F1～F5 全部根因修复。
- L/T/C/B/Y 矩阵和原 R/Q/F/P 矩阵全部通过。
- 状态只有一个并发 owner；无多锁反序结构。
- 所有 completion validate-then-commit，失败零部分变化。
- Closing 同 identity 不重复开窗、不错误 focus，Destroyed 后恢复同 intent。
- action 恰好一次；outcome 在 host 确认前可可靠重报；report 错误可观察。
- TS/Rust outcome 与 bootstrap payload 一致。
- A1 Internal Gate 已通过；随后是否进入 B 以 Wave 1 卡为准，C～E 仍未开始。
- 完整门禁通过，工作树仅含预期差异。

## 10. Agent 回报格式

1. A1-F1～F5 的根因与修复对应。
2. 单 owner 最终数据结构和锁边界。
3. 原子 reducer 的 validate/commit 顺序。
4. Closing identity 状态图。
5. bootstrap processing/report-pending/reported 状态图。
6. L/T/C/B/Y 与原 R/Q/F/P 测试映射。
7. 红灯证据路径和完整命令结果。
8. `git diff --check`、`git status --short`。
9. 声明 Phase A 未修改 ADR 0008/hash、capability、CI/CD、发布配置、真实窗口、file identity、最终 UI、保存/关闭/格式语义。
10. 记录 Internal Gate；通过后按 Wave 1 卡继续 MRT-004B，不单独停工或等待人工验收。
