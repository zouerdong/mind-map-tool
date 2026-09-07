# MRT-004 开发指导与任务卡

## 1. 任务定位

**优先级：P0**

**状态：WAVE-2 NEEDS-REMEDIATION；MRT-004W2R2 READY（Wave 1 已通过）**

**已完成前置：MRT-003V 原生证据于 2026-08-30 验收通过**

**已完成决策：ADR 0008 已获项目负责人批准并转为 Accepted 1.0.0**

**当前边界：A1 + B/B1/B1A 已通过统一验收，不重做；C～E 与 W2R 主体已
实现，但 W2R 统一验收发现 generation 线性化和 native S9/S10 假绿，下一步
只执行 MRT-004W2R2。MRT-005 继续锁定。**

**对应问题：CR-004、CR-005**  
**后续：MRT-005**

本卡实现真实多窗口和可靠 launch intent：一文档一窗口；不同文件新窗；同文件聚焦；Dock/图标激活新空白窗；intent 不丢、不重复、不提前 ack；任一 dirty 窗都不被外部入口替换。

本卡不负责最终视觉换肤。UXD-001 可以并行产出体验规格，但生产 UI 结构调整应等本卡窗口拓扑稳定后进入 UXI 实现。

### 1.1 调整后的审阅节奏

不再每张微任务卡都回来验收，改为按可独立证明的工程边界分两波：

1. **Wave 1：A1 + B**——host 状态正确性、交付可靠性、真实 file identity 与保存换绑基础；执行 Agent 自行完成 A→B Internal Gate，整波完成后审查一次。
2. **Wave 2：C + D + E**——真实 Tauri 窗口、native source、bootstrap/ack 生产接线与真实 macOS 验收；只在 Wave 1 验收通过且确认无需越过 capability/config 红线后派发，整波完成后审查一次。

这样 MRT-004 从原计划的多个微验收点收敛为里程碑验收。内部 Gate 仍保留，
由执行 Agent 自证，不需要审查者逐卡放行。Wave 1 已完成；Wave 2 首轮入口
保留作审计。当前唯一派发入口为
`.omx/reviews/2026-08-31-mrt-004w2r2-final-generation-and-native-proof-task-card.md`。

## 2. 当前错误

- `MindMapApp` 永远报告 `main`，`open-new-window` 仍加载同一个 session。
- 每个 WebView 都会实例化 app 级 `TauriLifecycleAdapter`，真实多窗口后会重复消费同一 event。
- adapter 先 `appReady` snapshot、后 listen，间隙事件可能丢失。
- `LaunchRouter.dispatch()` 同步调用 action 后立即 ack，读取/建窗/聚焦尚未完成。
- launch action 以 fire-and-forget 异步执行，连续 A/B 读取存在后完成覆盖先完成的竞态。
- `RunEvent::Reopen` 只在无可见窗口时摄入 activation，不符合 warm Dock 每次新建空白窗的规格。
- single-instance 无文件 argv 没有转 activation。
- 同文件判定依赖前端 `displayPath` 字符串，不是 host file identity。

## 3. 不变量

1. **一窗口一 session**：每个 WebView 自己创建 DocumentSession；任何 session 不跨窗口共享。
2. **Host 单 owner**：WindowRegistry、file identity、launch queue 与窗口创建/聚焦只有一个 Rust owner。
3. **不覆盖**：外部 open/activation 永不调用现有 occupied/dirty 窗的 `load()`。
4. **同文件唯一 reservation**：open 和 loading 两态均占用 file identity；重复入口只聚焦同窗。
5. **严格顺序**：队列按 `receivedAt + intentId` 的稳定顺序派发；异步读取不能改变窗口归属。
6. **先订阅后快照**：每窗 bootstrap listener 先安装，再读自身 snapshot；按 delivery id 去重。
7. **ack 在终态后**：event emitted、window created、read started 都不是完成。
8. **错误不丢 intent**：瞬时失败保留 retryable 状态；禁止自动无限重试。
9. **按 label 隔离**：registry、bootstrap、file capability、MRT-003 close state 使用同一真实 window label。
10. **关闭清理完整**：Destroyed 清 registry/reservation/bootstrap/capability；未终态 intent 可重试。
11. **activation 新空白**：warm Dock/icon activation 总是创建新空白窗口，不聚焦或替换 dirty 窗。
12. **最小权限**：窗口创建/聚焦由自定义 host API 完成，不给 renderer 通用 create/destroy 权限。

## 4. 采用架构

以 `docs/decisions/0008-window-launch-lifecycle.md` 为准。Agent 不得自行把 Proposed 改成 Accepted；需要项目负责人批准。

建议新增：

```text
apps/desktop/src-tauri/src/lifecycle/window_registry.rs
apps/desktop/src-tauri/src/lifecycle/launch_coordinator.rs
packages/platform/src/lifecycle/window-bootstrap.ts
packages/platform/src/lifecycle/tauri-window-bootstrap-adapter.ts
docs/architecture/window-launch-lifecycle.md
```

### 4.1 WindowRegistry

每条记录至少包含：

```text
windowLabel
state: booting | blank | loading | open | failed | closing
fileIdentity: optional host-owned identity/reservation
canonicalPath: host-only or display-safe projection
activeIntentId: optional
readyGeneration
```

dirty 可作为 renderer 上报的诊断字段，但路由安全不能依赖它：warm 不同文件直接新窗，避免任何 occupied/dirty 复用。仅 cold boot 的默认 main 可接受首个文件 assignment。

### 4.2 FileIdentity

- path 首先 canonicalize，解决相对段和 symlink。
- macOS/Unix 首版增加稳定 metadata identity（device + inode 或等价封装），canonical path 是逻辑路径锚点，不是 UI 自报值。
- registry 分别索引 canonical alias 与 physical alias；任一 alias 重合即已有 owner，不用非传递的“path OR inode”对象判等充当单个 HashMap key。
- identity 的计算和比较只在 host。
- 文件 loading 时立即 reservation，防止并发重复开窗。
- ordinary Save 的原子替换可能轮换 inode，成功后需保持 canonical owner 并刷新 physical alias。
- Save As 必须先预占目标 aliases，再在 coordinator lock 外写文件；成功后原子换绑，失败时释放 pending reservation 并保持旧 identity。
- 文件被替换后 identity 变化的策略必须测试并写入 architecture；不得退回 displayPath 比较。

### 4.3 Per-window bootstrap

每个 renderer 只消费定向给自己的 bootstrap：

```text
WindowBootstrap {
  deliveryId,
  intentId?,
  kind: open-path | blank,
  canonicalPath?
}
```

adapter 流程：listen targeted event → invoke pending snapshot → 去重 deliveryId → await App action → report outcome。

不得让 editor 窗口订阅 app 全局 launch intent。

### 4.4 Terminal report 与 ack

建议命令：

- `platform_window_ready()`：注册调用窗口并返回 bootstrap snapshot。
- `platform_complete_window_bootstrap(deliveryId, outcome)`：调用者 label 由 Tauri 注入。
- `platform_retry_launch_intent(intentId)`：只重试 failed/retryable intent。
- `platform_dismiss_launch_intent(intentId)`：用户明确放弃后才 ack。

outcome 使用 ADR 0008 的稳定枚举。host 校验 deliveryId、window label、intentId 与当前 registry state；重放/跨窗/过期 completion 必须拒绝。

### 4.5 Native source

- cold argv files：入队；main ready 后把首个分配给 main，其余按序建 editor。
- `RunEvent::Opened`：每个 URL 独立 intent，保序。
- single-instance argv：有效文件入队；无文件参数视为 activation。
- `RunEvent::Reopen`：不论 `has_visible_windows`，按已确认产品语义摄入 activation；真实 macOS 验证事件是否覆盖所有 Dock 情况。
- 同 identity 已 open/loading：show + focus existing，终态后 ack。

## 5. 开发波次与内部门禁

### MRT-004G：决策 Gate

- 阅读 ADR 0008。
- 项目负责人批准后更新 ADR 的 Status/版本/批准人/批准时间，并生成独立 MRT-004G 批准记录，绑定用户批准原文与 ADR SHA-256；未批准不得写生产实现。
- 现有 `decision-register.json` 是 G1 四轨 Spike 登记，不得把 windowLifecycle 强塞进 `approvedTracks` 或 `acceptedAdrVersions`；若未来要扩展其 schema，必须另立规划并同步 validator。
- 如果实现必须修改 Tauri capability、`tauri.conf.json`、CI/CD 或发布配置，先单独请求授权。

### MRT-004A：纯状态机红灯

- 为 WindowRegistry 和 LaunchCoordinator 写纯 Rust 测试。
- 为 bootstrap adapter 写 listener-before-snapshot、双达去重、stale/cross-window completion 测试。
- 将 action callback 改为 awaitable terminal result；测试旧同步 ack 行为失败。
- 先记录红灯，再实现。

### MRT-004A1：可靠性修复（Wave 1 / Phase A）

- 修复单 owner、原子转换、Closing reservation、bootstrap outcome 重报与 TS/Rust 类型对齐。
- 技术子规格见 `.omx/reviews/2026-08-30-mrt-004a1-concurrency-and-delivery-remediation-task-card.md`。
- 由执行 Agent 完成 Internal Gate；通过后直接进入 B，不等待人工验收。

### MRT-004B：Host registry 与 file identity（Wave 1 / Phase B）

- 实现 per-label registry、状态转换和 identity reservation。
- open、Save As、Destroyed 与 registry 生命周期接线。
- 同 identity open/loading 聚焦现有窗口。
- 不修改 MRT-003 close store 语义，只在 Destroyed 组合清理。
- 与 A1 合并任务的完整 identity alias、Save As prepare/finalize/abort 和失败矩阵，以 `.omx/reviews/2026-08-30-mrt-004-wave-1-host-foundation-task-card.md` 为准。

2026-08-30 统一验收更新：B 的 identity alias 方向正确，但 reservation/token/untitled 首存/跨平台边界未通过，转入单张 `.omx/reviews/2026-08-30-mrt-004b1-reservation-and-rebind-remediation-task-card.md`；A1 保持 Accepted。

2026-08-31 统一验收更新：B1A 已补齐 commit 前后语义、host-only outcome
同源绑定、AuthorizationPlan 和 token caller/generation 校验；MRT-004
Wave 1 正式 Accepted。历史修复卡保留作审计，不再作为派发入口。

### MRT-004C：窗口创建与 bootstrap（Wave 2）

- host 创建 `editor-*` Webview，label 唯一且匹配既有窄 capability 范围。
- 每窗 listener-first + snapshot bootstrap。
- main/editor 都运行独立 MindMapApp/DocumentSession。
- 新窗读取失败显示可见错误和 retry/dismiss；不 ack、不自旋。

### MRT-004D：native source 与可靠 ack（Wave 2）

- cold/warm、Opened、single-instance、Reopen 全部进入唯一 coordinator。
- 队列串行派发。
- opened/focused/blank-created/dismissed 后 ack；retryable-error 保留。
- 移除每个 MindMapApp 对全局 `TauriLifecycleAdapter` 的重复订阅。

### MRT-004E：真实 macOS 验收与架构同步（Wave 2）

- Finder 连续打开 A/B、重复 A、等价路径 A。
- A dirty 时 Finder 打开 C，A 不变、C 新窗。
- app 运行时 Dock/icon activation 新空白窗。
- 关闭任一窗口，其他窗口 session/dirty/handle 不变。
- 新增 `docs/architecture/window-launch-lifecycle.md` 描述实际事实。

Wave 2 按 `.omx/reviews/2026-08-31-mrt-004-wave-2-production-integration-task-card.md` 一次派发 C + D + E，中间由执行 Agent 自跑自动化 Gate。若必须修改 capability、`tauri.conf.json`、CI/CD、发布配置或新增依赖，则命中项目红线，Agent 必须停止并请求项目负责人授权；不得把红线动作夹在批量任务中自行执行。

2026-08-31 统一验收更新：C/D 主体已接线，但按窗错误 ownership、Failed
窗口恢复、bootstrap report 重报、原子 startup barrier、recovery/capability
失效竞态和真实 native 证据仍未通过。Wave 2 状态为 NEEDS-REMEDIATION；
只派发 MRT-004W2R，完成后再统一验收，不进入 MRT-005。

## 6. 允许修改范围

- `apps/desktop/src-tauri/src/lifecycle/`
- `apps/desktop/src-tauri/src/ipc/`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/file/` 中只限 registry identity 接线
- `packages/platform/src/lifecycle/`、IPC types 与 tests
- `apps/desktop/src/app/` 的 bootstrap/窗口装配与错误 UI
- `tests/e2e/macos/` 和本卡 evidence
- `docs/architecture/window-launch-lifecycle.md`
- 经项目负责人批准后的 ADR 0008 状态与 `.omx/reviews/*-mrt-004g-approval.json` 审计记录

禁止：

- 改 MRT-001/002 的保存与 dirty 契约。
- 重写 MRT-003 close handshake。
- 实现最终视觉换肤、画布操作面或 onboarding redesign。
- 修改 canonical schema/export。
- 默认扩大 Tauri capability、CI/CD、发布配置。
- 用 query string/displayPath 充当安全 file identity。
- 创建窗口后立即 ack，或 catch 后吞掉 intent。

## 7. 必测矩阵

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| W1 | 每窗启动 | 不同 WebView 拥有不同 session，编辑互不影响 |
| W2 | Destroyed | registry/reservation/bootstrap/capability 清理，其他窗不变 |
| I1 | cold A/B | main=A、editor=B，无多余空窗，顺序稳定 |
| I2 | A loading 时重复 A | 只保留一个 reservation/窗口，聚焦目标 |
| I3 | warm 打开 B | 新 editor，不替换现有 A |
| I4 | A dirty 时打开 C | A 文档/dirty/handle 不变，C 新窗 |
| I5 | symlink/相对段/Unicode 等价路径 | 同 identity 聚焦，不建重复窗口 |
| A1 | warm Dock/icon activation | 每次新建一个空白窗，不碰其他窗 |
| A2 | single-instance 无文件 argv | 解释为 activation |
| P1 | listener/snapshot 间注入 bootstrap | 不丢、只处理一次 |
| P2 | stale/replay/cross-window completion | 稳定拒绝，不 ack |
| P3 | read 失败 | intent retryable、不 ack、不自旋、错误可见 |
| P4 | create/focus 失败 | intent 保留，registry 无幽灵窗口/reservation |
| P5 | 成功终态 | action 完成后恰好 ack 一次 |
| C1 | 多窗分别关闭 | 每窗独立 MRT-003 流程，Cancel 只阻止对应窗口 |

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
pnpm exec prettier --check <本卡变更文件>
rustfmt --edition 2021 --check --config skip_children=true <本卡变更 Rust 文件>
git diff --check
git status --short
```

最后必须执行真实 Finder/Dock/macOS 多窗口矩阵；platform fake、jsdom 和单窗口截图不能替代。

## 9. 完成定义

- ADR 0008 已获项目负责人批准并登记。
- W1/W2、I1～I5、A1/A2、P1～P5、C1 全覆盖。
- 不同文件真实新窗，同 identity 真实聚焦，dirty 窗零替换。
- 每个 renderer 只消费自己的 bootstrap，不重复消费全局 intent。
- listener-first、await terminal、ack once 均有失败注入。
- native error 保留 intent，可见且可重试，不自旋。
- MRT-003 多窗口关闭回归通过。
- 自动化、构建、changed-scope format、真实 macOS evidence 全通过。

## 10. Agent 回报格式

1. ADR 批准依据与最终 hash。
2. 旧行为红灯与根因。
3. registry/coordinator/bootstrap 完整状态图。
4. 修改文件及职责。
5. W/I/A/P/C 测试映射。
6. intent 在成功、失败、retry、dismiss 下的 ack 证据。
7. 真实 Finder/Dock 多窗口证据与 bundle hash。
8. 完整命令结果。
9. `git diff --check`、`git status --short`。
10. 声明未扩大范围到 MRT-005、最终 UI、capability/CI/CD/发布配置；若有例外附负责人授权。
