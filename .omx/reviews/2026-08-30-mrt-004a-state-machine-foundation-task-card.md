# MRT-004A 状态机基础任务卡

## 1. 定位

**优先级：P0**

**状态：NEEDS-REMEDIATION（转 MRT-004A1）**

**上游：MRT-003V ACCEPTED**

**下游：MRT-004B host registry 与 file identity 接线**

本卡只建立可脱离 Tauri 窗口运行的 WindowRegistry、LaunchCoordinator 和 per-window bootstrap 契约，并用失败注入锁定状态转换。它不创建真实多窗口、不接 Finder/Dock、不修改 capability，也不改最终 UI。

项目负责人未明确批准 `docs/decisions/0008-window-launch-lifecycle.md` 前，Agent 只能做只读预检并回报，不得把 ADR 改成 Accepted，不得写生产实现。

2026-08-30 验收更新：MRT-004G 已通过，但本卡实现发现多锁反序死锁、非原子 completion 和 bootstrap report 失败丢失三类基础问题。现有 R/Q/F/P 正常路径测试通过，不足以证明可生产接线；MRT-004A 转入 MRT-004A1 修复，MRT-004B 暂不解锁。

获得用户批准后先执行 MRT-004G：

1. 将 ADR 0008 更新为 `Status: Accepted`、`ADR-Version: 1.0.0`，并记录 `Approved-By`、`Approved-At`。
2. 对最终 ADR bytes 计算 SHA-256。
3. 新增 `.omx/reviews/2026-08-30-mrt-004g-approval.json`，至少记录 `decisionId`、`approvedBy`、`approvedAt`、`userStatement`、`adrPath`、`adrVersion`、`adrSha256`。
4. 先验证 JSON/ADR hash 一致，再开始 A1。现有 G1 四轨 `decision-register.json` 不承载本决定，不得改坏其 bootstrap validator。

## 2. 目标

1. 把“一文档一窗口、同文件聚焦、activation 新空白窗、失败不丢 intent”变成纯状态机。
2. 把窗口副作用抽象成可注入 port，使 create/focus/bootstrap/complete 的失败可测试。
3. 把 renderer bootstrap 改为 awaitable terminal outcome 契约，禁止 event 发出即 ack。
4. 为 MRT-004B～D 留下稳定接口，不提前接 Tauri 或扩大权限。

## 3. 允许修改

- `apps/desktop/src-tauri/src/lifecycle/`：纯 Rust registry/coordinator 模块和测试。
- `packages/platform/src/lifecycle/`：纯 bootstrap 协议、adapter 和测试。
- `packages/platform/src/ipc/types.ts`、`packages/platform/src/index.ts`：仅新增本卡契约。
- `docs/architecture/window-launch-lifecycle.md`：只记录本卡已经实现的纯状态机事实。
- 本卡 evidence/回报文档。

除非用户另行授权，禁止修改：

- `apps/desktop/src-tauri/capabilities/`、`tauri.conf.json`、CI/CD、发布配置。
- `lib.rs` 的真实窗口创建/原生事件 wiring。
- `MindMapApp` 生产 UI、画布、保存队列、MRT-003 close handshake。
- core schema、export、onboarding 与视觉样式。

## 4. 先读文件

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`。
3. `.omx/reviews/2026-08-30-mrt-004-development-guide-and-task-card.md`。
4. `apps/desktop/src-tauri/src/lifecycle/launch.rs` 与 `close.rs`。
5. `packages/platform/src/lifecycle/`、`packages/platform/test/launch-router.test.ts`。
6. `apps/desktop/src/app/mindmap-app.tsx` 中现有 launch adapter 的装配方式，只读理解，不在本卡重写 UI。

## 5. 生产契约

### 5.1 WindowRecord

至少表达：

```text
label
state: booting | blank | loading | open | failed | closing
fileIdentity?: host-owned opaque value
activeIntentId?: string
bootstrapDeliveryId?: string
readyGeneration: integer
```

必须由显式 transition 方法修改；禁止调用方直接拼装无效组合。

### 5.2 LaunchIntentState

至少表达：

```text
queued -> routing -> assigned -> terminal
                         -> retryable-error
retryable-error -> routing | dismissed
```

terminal 只允许：`opened`、`focused-existing`、`blank-created`、`dismissed`。`retryable-error` 不是 ack 条件。

### 5.3 Coordinator effects

纯状态机只生成 effect，不直接调用 Tauri：

```text
CreateWindow
FocusWindow
DeliverBootstrap
AckIntent
ShowRetryableError
```

每个 effect 必须带 intentId；窗口相关 effect 同时带 label；bootstrap 同时带 deliveryId。effect completion 必须经过 correlation 校验。

### 5.4 Bootstrap adapter

固定顺序：

```text
install targeted listener
-> read own pending snapshot
-> dedupe deliveryId
-> await renderer action
-> report terminal/retryable outcome
```

action callback 类型必须返回 Promise/terminal outcome；禁止 fire-and-forget，禁止 adapter 自己提前 ack。

## 6. TDD 顺序

### A1：红灯证据

先增加最小失败测试并保存命令输出摘要，证明旧实现存在：

- action Promise 未完成时旧 router 已 ack。
- event 与 snapshot 双达会重复执行或依赖不安全时序。
- 同 identity 在 loading 中再次到达时缺 reservation。
- create/focus/bootstrap completion 重放或跨窗无法稳定拒绝。

不要把失败测试长期留在最终工作树；完成实现后必须全绿。

### A2：WindowRegistry

实现：

- label 唯一登记。
- 合法状态转换表。
- identity reservation 覆盖 loading/open。
- Destroyed 幂等清理 reservation/bootstrap。
- stale generation、跨 label delivery、重放 completion 稳定拒绝。

本卡可使用合成 `FileIdentity` 值测试；真实 canonicalize/device/inode 计算留给 MRT-004B。

### A3：LaunchCoordinator

实现：

- `receivedAt + intentId` 稳定排序。
- 队首串行路由，同一时刻最多一个 routing intent。
- cold 首文件可分配默认 main；warm 不同文件生成 CreateWindow。
- open/loading 同 identity 生成 FocusWindow，不创建重复窗口。
- activation 生成新 blank window effect。
- effect 失败进入 retryable-error，不 ack、不自动自旋。
- terminal completion 恰好生成一次 AckIntent。

### A4：Per-window bootstrap

实现 TS 纯 adapter：

- listener-first。
- snapshot/event 双达按 deliveryId 恰好执行一次。
- action resolve 前不 report terminal。
- action reject 转 retryable-error，不吞异常、不无限重试。
- dispose 后忽略新 delivery；已开始 action 的 completion 仍按明确策略处理并测试。

### A5：架构同步

新增或更新 `docs/architecture/window-launch-lifecycle.md`，只描述已经落地的纯状态机、effect 边界和仍未接线的事项。不得把后续 Tauri wiring 写成已完成事实。

## 7. 必测矩阵

| ID | 场景 | 断言 |
| --- | --- | --- |
| R1 | register duplicate label | 稳定拒绝，不覆盖旧 record |
| R2 | loading reservation | 同 identity 只占一个 label |
| R3 | destroyed | 清 record/reservation/bootstrap，重复清理无副作用 |
| R4 | invalid transition | 稳定错误，状态不变 |
| Q1 | A/B 同时 queued | 严格按序；A 未终态前 B 不执行副作用 |
| Q2 | loading A + duplicate A | 只生成 focus，不 create |
| Q3 | warm B | 生成新窗口 effect，不复用 occupied 窗 |
| Q4 | activation | 每个 intent 各生成一个 blank window effect |
| F1 | create/focus 失败 | retryable、不 ack、无幽灵 reservation |
| F2 | retry | 同 intent 重新 routing；不产生新 intentId |
| F3 | dismiss | 用户明确 dismiss 后恰好 ack 一次 |
| P1 | listener/snapshot 双达 | deliveryId 恰好执行一次 |
| P2 | action pending | action 未终态时零 ack/report-success |
| P3 | stale/replay/cross-window completion | 稳定拒绝，当前状态不变 |
| P4 | action reject | retryable error 可见契约，不自旋 |

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

本卡不要求真实 Finder/Dock 多窗口证据，因为尚未接原生窗口；不得用本卡通过冒充 MRT-004 整体通过。

## 9. 停止条件

遇到以下任一情况，停止扩张并回报审查者：

- 需要修改 Tauri capability、`tauri.conf.json`、CI/CD 或发布配置。
- 发现 ADR 0008 与已 Accepted ADR/产品验收标准冲突。
- 需要改变 MRT-001 保存队列、MRT-003 close permit 或文件格式语义。
- 无法在不依赖 renderer `displayPath` 的前提下表达 identity reservation。
- 纯状态机接口无法覆盖 Windows，必须写死 Unix 类型。

## 10. 完成定义

- ADR 0008 有用户明确批准依据，已转为 Accepted 1.0.0，并有绑定用户原文与 ADR SHA-256 的 MRT-004G 独立审计记录。
- R1～R4、Q1～Q4、F1～F3、P1～P4 全绿。
- coordinator/effect/bootstrap 不依赖 Tauri、React 或 OS API。
- terminal 后 ack once；失败不 ack、不自旋；retry/dismiss 可区分。
- 未接真实窗口、Finder/Dock，未改 capability、UI、保存/关闭/格式语义。
- 完整门禁通过，工作树差异清晰，无构建产物进入 Git。

## 11. Agent 回报格式

1. ADR 0008 的用户批准原文、最终状态、版本、hash 与 MRT-004G 批准记录路径。
2. 旧行为红灯证据及根因。
3. WindowRecord、LaunchIntentState、effect、bootstrap 状态图。
4. 修改文件和每个文件的单一职责。
5. R/Q/F/P 测试逐项映射。
6. ack 在成功、失败、retry、dismiss 下的证据。
7. 完整命令与结果。
8. `git diff --check`、`git status --short`。
9. 明确声明没有开始 MRT-004B～E，没有修改 capability/CI/CD/发布配置或最终 UI。
