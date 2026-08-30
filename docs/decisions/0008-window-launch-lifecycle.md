# ADR 0008: Host 主导的窗口注册与启动意图协议

- Status: Proposed
- ADR-Version: 0.1.0
- Date: 2026-08-30
- Owners: Project maintainers
- Track: windowLifecycle（MRT-004）

## Context

v1 已在 ADR 0001 选择 Tauri 2，并在产品规格 AC-01/AC-07 固定“一文档一窗口、单应用实例、同文件聚焦、不同文件新窗、Dock/图标激活新空白窗、dirty 窗不被替换”。

当前实现仍只有一个 `main` WebView：所有 launch action 最终加载到同一个 DocumentSession；每个 WebView 若都实例化现有 `TauriLifecycleAdapter`，又会同时消费 app 级 launch event。适配器当前还存在 snapshot 先于 listener、action 未完成即 ack 的问题。

窗口创建、原生路径 identity、窗口聚焦与系统事件均天然位于 Rust host。若把全局 coordinator 放在某个 renderer，需要处理该窗口关闭后的重新选主；若让所有 renderer 共同监听，则会重复开窗和 ack。

## Decision Drivers

- dirty 文档绝不因外部 open/activation 被替换。
- 连续多文件必须保持顺序且不受异步读取完成顺序影响。
- 同一文件在任何等价路径入口只对应一个活动窗口或加载 reservation。
- renderer 崩溃、重连和 listener 安装竞态不能丢 intent。
- 新窗口继续复用现有 `MindMapApp`，每个 WebView 自然拥有独立 DocumentSession。
- 不向前端开放通用 create/destroy window 权限。
- MRT-003 的 per-window close/capability 模型无需重写。

## Decision

采用 **Rust host 作为唯一 WindowRegistry 与 LaunchCoordinator owner**：

1. native source 只向 host `LaunchIntentStore` 入队。
2. host 按序为队首 intent 做窗口路由，维护 per-window `blank/loading/open/failed/closing` 状态与 file identity reservation。
3. 同一 identity 已 open 或 loading 时聚焦/显示该窗口，并把 intent 终结为 focused。
4. cold start 的第一个文件可分配给默认 `main` 空白窗口；其余不同文件创建 `editor-*` 窗口。warm open 默认创建新窗口，不复用已承载文档或 dirty 窗。
5. activation 总是创建新空白 `editor-*` 窗口；cold 无文件启动保留默认 `main` 空白窗。
6. 新窗口不监听 app 全局 launch event；它通过“先订阅 targeted bootstrap event，再读取自身 bootstrap snapshot”取得被分配的动作。
7. renderer 完成 `openPathFlow` 后回报 awaitable terminal outcome。只有 opened、focused、blank-created 或用户明确 dismiss 才 ack/remove intent；瞬时 read/create/focus 失败保留为可重试状态，不自动自旋。
8. file identity 由 host 从 canonical path/平台 metadata 生成，前端 displayPath 不参与同文件安全判定。identity 在分配时即 reservation，防止同文件的第二个 intent 在首个读取完成前再建窗口。
9. 窗口创建、聚焦和 bootstrap 分配只通过窄自定义 IPC/targeted event；不开放 frontend 通用 `window.create()`/`destroy()`。
10. `Destroyed` 同时清理 registry、bootstrap reservation、close store 与文件 capability；若被销毁窗口仍拥有未终结 intent，该 intent 保留为 failed/retryable。

## Terminal Outcome

建议稳定结果：

- `opened`：文件已被目标窗口成功 decode/load/adopt。
- `focused-existing`：同 identity 窗口已成功显示并聚焦。
- `blank-created`：activation 的新空白窗口已 ready。
- `dismissed`：用户明确放弃该 intent；可以 ack。
- `retryable-error`：读取、建窗、聚焦或 renderer 初始化的瞬时失败；不 ack，停止自动重试并显示可见错误。

不得用“event 已发出”或“异步动作已开始”代替 terminal outcome。

## Considered Options

### A. 每个 renderer 都运行现有 LaunchRouter

Rejected。app 级 event 会被多个窗口重复消费，必须再引入分布式选主，复杂度和竞态高于问题本身。

### B. 固定 `main` renderer 作为 coordinator

Rejected。`main` 可以被用户关闭；重新选主、状态同步和 host window identity 仍需另一套协议。

### C. 前端获得通用 create-window 权限

Rejected。扩大 capability，窗口 identity/路径 identity/close ledger 分散到两层，不符合最小权限和 host 主导原则。

### D. Host registry + per-window bootstrap

Proposed。所有原生事实和窗口副作用保持单 owner；renderer 只执行自己窗口的文档 load，并返回可等待终态。

## Consequences

### Positive

- 消除多 renderer 重复消费和 coordinator 窗口关闭后的重新选主问题。
- file identity、窗口 label、文件 capability 与 close lifecycle 在同一 host 边界对齐。
- 前端每窗独立 session，无需引入共享全局 store。
- 无需扩大通用 Tauri window 权限。

### Negative

- Rust host 需要维护 registry、bootstrap 与 intent terminal state。
- TS 现有 LaunchRouter/adapter 需要迁移或降级为纯决策/契约测试，不能直接沿用同步 ack 模型。
- renderer load 失败后的 retry/dismiss 需要最小错误 UI。
- Windows file identity 实现仍需后续平台腿验证；macOS 首版先实现 Unix identity，并保留显式平台接口。

## Validation

- 冷启动 A/B 连续文件：main=A、editor=B，顺序稳定，无多余空窗。
- A loading 时再次打开 A：只聚焦/reserve 同一窗口，不创建第二窗。
- warm 打开 B；重复打开 A；A dirty 时打开 C；均不替换 A。
- listener 与 bootstrap snapshot 间注入事件不丢、不重复。
- read/create/focus 失败不 ack、不自旋；用户 retry 后可完成。
- Dock/icon warm activation 每次创建新空白窗。
- 关闭任一窗口不影响其他窗口 session、handle、dirty 或 close request。

## Approval Gate

本 ADR 当前仅为 Proposed。MRT-004 生产实现前，项目负责人必须明确批准；批准时更新为 Accepted，并按仓库决策登记规则记录版本/hash。若不批准，先选择替代 coordinator 方案，不得先写实现。
