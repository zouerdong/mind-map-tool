# MRT-004G / MRT-004A 验收报告

## 结论

- **MRT-004G：ACCEPTED。** ADR 0008 已由项目负责人明确批准并转为 Accepted 1.0.0；独立批准记录中的 SHA-256 与当前 ADR bytes 完全一致。
- **MRT-004A：NEEDS-REMEDIATION。** 正常路径状态机方向正确，现有自动化全部通过，但发现 5 项进入真实多窗口后可导致死锁、intent 永久悬挂、部分状态提交或跨语言契约失配的基础协议问题。
- **MRT-004B：CONDITIONALLY UNLOCKED WITHIN WAVE 1。** 同一执行 Agent 先完成 MRT-004A1 Internal Gate；Gate 通过后直接进入 B，不等待人工验收。真实 Tauri 窗口与 Finder/Dock 仍锁定。

2026-08-30 节奏调整：项目负责人要求减少微任务验收频率。技术判断不变，但派发单位由单独 A1 改为 Wave 1（A1+B）；合并卡见 `.omx/reviews/2026-08-30-mrt-004-wave-1-host-foundation-task-card.md`。

本轮没有直接修改 MRT-004A 生产代码。问题涉及并发所有权和传输语义，局部补丁会继续留下竞态，按既定原则退回独立修复卡。审查者只更新了验收状态与开发文档。

## 已通过部分

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| ADR 0008 批准 | PASS | Accepted 1.0.0；批准人/时间完整 |
| 批准 hash | PASS | 记录值与当前 ADR SHA-256 均为 `a88c9606...a1c105e` |
| 红灯证据 | PASS | 旧同步 ack、snapshot/listener gap、loading identity、无 outcome 通道 4/4 有摘要 |
| Registry 正常路径 | PASS | R1～R4 现有单线程用例通过 |
| Coordinator 正常路径 | PASS | Q1～Q4、F1～F3、P3～P5 现有单线程用例通过 |
| Bootstrap 正常路径 | PASS | listener-first、双达去重、await action、action reject、dispose 用例通过 |
| 范围控制 | PASS | 未修改 capability、`tauri.conf.json`、CI/CD、最终 UI、保存/关闭/格式语义 |
| 架构同步 | PARTIAL | 已明确“纯状态机尚未生产接线”，但对失败可靠性和 Closing identity 的描述需随 A1 修正 |

## 发现的问题

### A1-F1 / P0：Registry 与 Coordinator 都存在反向锁序

`WindowRegistry` 把 windows、identity index、deliveries 分成三把 Mutex：

- `begin_loading()`：windows → identity_owner。
- `identity_owner()`：identity_owner → windows。
- `next_delivery()`：windows → deliveries。
- `complete_delivery()`：deliveries → windows。

`LaunchCoordinator` 同样存在：

- `route_next()`：in_flight → order → intents。
- `retry()`：intents → order → in_flight。
- `dismiss()`、成功/失败 completion：intents → in_flight。

这些是可形成 ABBA 环的真实反向锁序。当前测试全部单线程，所以不会暴露；MRT-004B/C 接入 Tauri command、窗口事件和 renderer completion 后，多线程回调可能永久等待。

修复方向：Registry 改为无内部 Mutex 的纯数据结构；Coordinator 用一把 `Mutex<CoordinatorState>` 统一拥有 registry、intents、order、in-flight 与计数器。所有方法在单次短临界区内验证并提交，effect 返回后在锁外执行。不得靠注释约定多把锁顺序。

### A1-F2 / P0：`reportOutcome` 失败被吞掉，delivery 永久无法确认

`WindowBootstrapAdapter.enqueue()` 在 action 开始前就把 deliveryId 写入 `seen`。随后 `reportOutcome()` 若因 IPC 断连失败，catch 会吞掉错误；host 仍保留 assigned intent，但同一 delivery 的 event/snapshot 重发又会被 `seen` 丢弃。

结果是 renderer 可能已经成功加载文档，host 却永远收不到终态，也没有用户重试入口；intent 和 reservation 会永久悬挂。

修复方向：对 delivery 分开记录 `processing`、`outcome-ready/report-pending` 与 `reported`。action 只执行一次；outcome 必须缓存。report 失败不得丢 outcome，同 delivery 重发或显式 `retryPendingReports()` 只重报缓存 outcome，不能重跑 action。错误需通过可观察通道返回，不得空 catch。

### A1-F3 / P1：renderer completion 与 registry/intent 推进不是原子事务

`on_renderer_outcome()` 先把 delivery 标记 completed，再另行 `mark_open/mark_blank`，最后修改 intent phase。若窗口此时进入 Closing、被销毁或状态不匹配，delivery 已被消费，但 intent 仍 Assigned，后续重放又会被拒绝。

相同问题也存在于 WindowCreated 成功路径：先 register、再 next_delivery、再 begin_loading。中间任一步失败都会留下 booting window、delivery slot、reservation 或 routing intent 的部分组合。

修复方向：所有前置条件先在统一 state 中验证，再一次提交 registry + intent 变化；失败必须零状态变化。需要提供 failure injection 测试验证每一个中间失败点都不会留下幽灵窗口、幽灵 delivery、幽灵 reservation 或卡死 in-flight。

### A1-F4 / P1：Closing identity 查询与实际占用相互矛盾

进入 Closing 时 identity index 没有释放，但 `holds_identity()` 又不承认 Closing。于是：

1. coordinator 查询同文件 owner 得到 None，决定创建新窗口。
2. 新窗口 `begin_loading()` 又被残留 index 以 `IDENTITY_ALREADY_RESERVED` 拒绝。
3. WindowCreated 已成功，coordinator 可能停在部分提交状态。

建议策略：Closing 持续保留 identity reservation 到 Destroyed；同 identity 新 intent 在 Closing 期间保持 queued/deferred，既不 focus 即将关闭的窗口，也不创建新窗。Destroyed 清理后由 host 再次调度。

### A1-F5 / P2：TS bootstrap 类型允许 Rust 不接受的终态

TS `BootstrapActionOutcome` 允许 renderer 返回 `focused-existing` 与 `dismissed`，但 Rust `RendererOutcome` 只接受 opened、blank-created、retryable-error。`WindowBootstrap` 也没有用判别联合强制 open-path 必须携带 canonicalPath。

这是局部契约缺口，可随 MRT-004A1 一并收紧：renderer action outcome 只保留 Rust 可接受的三种；open-path/blank 使用判别联合。

## 自动化复验

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @mindmap/platform test` | PASS：4 files / 42 tests |
| `cargo test ... window_registry` | PASS：8 tests |
| `cargo test ... launch_coordinator` | PASS：12 tests |
| `cargo test --manifest-path ...` | PASS：66 tests |
| `cargo clippy ... -- -D warnings` | PASS |
| `pnpm quality` | PASS：27 files / 266 tests；全部阶段 PASS |
| `pnpm build` | PASS |
| changed-scope Prettier / Rustfmt | PASS |
| `git diff --check` | PASS |

quality 输出中的 `verify-decision ... FAIL` 是负向漂移夹具的预期内容，外层测试和 quality 汇总为 PASS。

自动化全绿只证明当前覆盖的单线程正常路径，不推翻上述并发与失败原子性问题。

## 解锁决定

- MRT-004G：ACCEPTED。
- MRT-004A：NEEDS-REMEDIATION。
- MRT-004A1：READY，Wave 1 Phase A。
- MRT-004B：A1 Internal Gate 通过后由同一 Agent 继续，整波完成后统一验收。
- MRT-004C～E：LOCKED，待 Wave 1 验收。
- UXD-001：仍可作为不改生产 UI 的设计定义并行推进。
