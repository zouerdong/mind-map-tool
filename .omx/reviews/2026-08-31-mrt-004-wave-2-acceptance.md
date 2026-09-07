# MRT-004 Wave 2 统一验收报告

日期：2026-08-31  
验收范围：MRT-004C + MRT-004D + MRT-004E  
审查对象：当前累计工作树、Wave 2 implementation evidence、macOS E2
结构化日志与 `.tmp/wave2-e2e/` 截图

## 1. 结论

- **MRT-004C：NEEDS-REMEDIATION。** 单一 Rust host owner、真实
  `editor-*` 创建、按窗 bootstrap、host-bound open 和 B1A commit 接线主体
  已成立，但错误状态仍可串窗，bootstrap report 失败在生产 UI 中没有恢复
  入口，startup barrier 也不是原子判定。
- **MRT-004D：NEEDS-REMEDIATION。** native source、ack/retry/dismiss
  状态机主干和 Destroyed 组合清理已接线，但 read/decode 失败会留下不可正常
  保存的 `Failed` 僵尸窗口；retry/dismiss 没有完成窗口生命周期收口。
- **MRT-004E：NOT ACCEPTED。** 自动化 runner 只覆盖了真实矩阵的部分腿，
  9 张截图实质上只有两组重复的近全黑画面，不能证明窗口内容、dirty 隔离、
  错误 UI、关闭三分支、保存恢复或多窗热键目标。
- **Wave 2：NOT ACCEPTED。MRT-005 继续锁定。** 下一步只执行一张合并
  修复卡 `MRT-004W2R`，完成后再做一次统一验收；不拆回微验收节奏。

本轮没有改动上述生命周期生产协议。按项目约定，只顺手修复了两个局部且
不改变产品语义的问题：

1. `packages/ui/test/onboarding-flow.test.tsx` 等待偏好持久化的真实异步终态，
   消除全量门禁负载下的测试抖动。
2. `tests/e2e/macos/wave2-windows.mjs` 不再把含 `MANUAL` 的矩阵汇总为
   `PASS`；现有聚合证据同步更正为 `INCOMPLETE`。

## 2. 已确认可保留的实现

以下方向通过代码审查与独立自动化，不应在修复卡中推倒重写：

1. 生产 `lib.rs` 只 manage 一个 `LifecycleRuntime`，其中唯一持有
   `LaunchCoordinator`；旧 `LaunchIntentStore` / renderer 全局 launch adapter
   已退出生产消费链。
2. `CreateWindow`、`FocusWindow`、targeted bootstrap emit、terminal ack 的
   effect 执行发生在 coordinator 状态锁外；156 个 Rust 测试覆盖了 Wave 1
   基线和主要 Wave 2 reducer 路径。
3. renderer open 不再回传任意 path，而是用 `deliveryId` 请求 host 读取已
   分配目标；内容、handle、token 与 identity 来自同一 host 流程。
4. ordinary Save / Save As 已切到 B1A host outcome，bytes 已提交但换绑/刷新
   未完成时会返回真实 receipt 和 `recovery-pending`，而不是普通保存失败。
5. cold argv、`RunEvent::Opened`、single-instance、Reopen、菜单 New 和无窗
   热键 activation 已进入同一 runtime ingest；Destroyed 组合清理与最近聚焦
   label 跟踪方向正确。
6. ADR 0008 当前 SHA-256 为
   `a88c9606000a8e72e59ee634f02eecc652c0d82c1a336b8f5ad248c70a1c105e`，
   与批准记录一致；capability、`tauri.conf.json`、CI/CD 与发布配置未被本批修改。

## 3. 阻断问题

### W2R-F1 / P1：retryable error 的“定向呈现”只做了事件腿，快照和动作仍是全局的

证据：

- `LifecycleRuntime::launch_errors_snapshot()` 无 caller label，返回整个进程的
  `launch_errors`。
- `platform_launch_errors` 不注入 `WebviewWindow`；retry/dismiss 也只注入
  `AppHandle`，没有校验调用窗口。
- 每个 `MindMapApp` mount 时都会主动调用 `refreshLaunchErrors()`，因此即使
  event 是 targeted emit，其他窗口仍会从全局 snapshot 拉到同一错误，并可
  retry/dismiss 它。

影响：多窗口会显示不属于自己的错误；任意 renderer 可以消费其他窗口的
错误动作，违反任务卡 §5C2/§5C3 的按窗隔离和 caller-bound action。

### W2R-F2 / P1：read/decode 失败后的窗口停在不可用 `Failed` 状态

`mark_failed` 释放 identity 后保留窗口。用户点击 retry 时，coordinator
重新排队该 intent，但 warm routing 会创建另一个 `editor-*`；旧窗口仍为
`Failed`。用户点击 dismiss 只清错误/ack，不改变旧窗口状态。与此同时
renderer 仍呈现可编辑白纸，而 `prepare_rebind` 明确拒绝 `Failed`，所以该窗
编辑后无法 Save As。

影响：retry 留下多余僵尸窗；dismiss 留下“看起来可用、实际不能保存”的窗口，
存在用户数据无法正常落盘的风险。`WindowState` 注释称 `Failed` 可同窗 retry，
当前 coordinator 实现并未做到。

### W2R-F3 / P1：bootstrap outcome report 失败在生产路径中不可恢复

纯 TS adapter 已提供 `retryPendingReports()`，但生产代码没有任何调用者。
`MindMapApp` 只显示“启动动作回报失败”通知，没有重报按钮；`window_ready` 也只
在 adapter 首次 `start()` 时调用一次。

影响：一次瞬时 IPC report 失败就会让 adapter 永久停在 `report-pending`，host
intent 永久 `assigned`、零 ack。现有纯 adapter 单测证明“能力存在”，不能
替代生产装配确实可触发它。

### W2R-F4 / P1：startup barrier 的“无 open → Blank”不是单锁原子决策

`window_ready()` 依次调用 `pending_bootstraps_for()`、
`has_open_file_intents()`、`mark_blank()`，三次分别获取 coordinator 锁。native
open 可以在第二次检查后、第三次写入前入队，形成“open 已存在但 main 仍被
标 Blank”的 TOCTOU。

现有测试只覆盖 ready 完整先行后的降级，没有强制这个中间交错。单次 macOS
日志能证明本机一次观察顺序，不能把非原子实现变成无竞态 barrier。

### W2R-F5 / P1：generation/capability 只被记录，没有封闭 I/O 期间的失效竞态

1. `PostCommitRecovery.window_generation` 只在写记录时赋值，pending 查询、
   resolve 前后和成功 remove 时从不比较。resolve 会先 clone 旧记录、锁外做
   provider I/O，再按 label 修改 registry并无条件 remove；同名新代窗口不能
   受旧 recovery 影响这一约束没有落地。
2. assigned open 在第二次 delivery 校验前已经签发 handle。若窗口在文件 I/O
   期间 Destroyed，`revoke_window` 可先执行，随后旧读取再签发一个新 handle，
   最终虽然返回 stale error，但 ledger 中会留下错过 Destroyed 清理的孤立
   capability。

影响：当前 label 分配策略降低了日常触发概率，但实现没有兑现任务卡明确要求的
window generation 绑定和 Destroyed 后 capability 零残留，不能作为长期维护
契约接受。

### W2R-F6 / P0 验收阻断：真实 macOS 矩阵没有按任务卡完成

现有 runner/证据的真实覆盖是：

- S5 只执行 clean 窗口计数，未执行 dirty 内容、dirty 标记和 handle 不变。
- S7 只执行 clean 全部退出，未执行逐窗 dirty Save/Discard/Cancel、pending
  save 与“其他窗口不变”。
- S8 只观察到 retryable 日志，未真实点击 retry/dismiss，也未证明 UI 可见和
  ack 结果。
- S9 明确为 `MANUAL`，没有真实 Save As → ordinary Save 或 recovery 证据。
- S10 只有一个窗口，只断言日志中没有“注册失败”；即使热键完全没触发也会
  PASS，没有证明最近 focused 窗口收到 quick-create、其他窗口零变化。

截图复核进一步发现：9 张 3420×2224 PNG 只有两个 SHA-256，画面近全黑；
它们不能承担任何可见结果证明。原 evidence 所称“三次连跑”也没有三份可追溯
scenario log/hash。

### W2R-F7 / P2：Windows 同源 probe 不能按证据复现

主 crate 的 Windows target check 独立复跑确实仍被既有
`icons/icon.ico not found` 阻断；这一点记录真实。可是 implementation evidence
只用文字描述复制源码到 `.tmp/wave2-winprobe`，没有保存可复制命令、脚本或
raw log，临时目录又已清理，无法独立重跑其“同源 probe PASS”。证据中“命令
已记录于第 6 节”的说法与实际内容不符。

## 4. 独立门禁结果

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS，156/156 |
| `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS，46/46 |
| `pnpm test:unit` | PASS，277/277 |
| `pnpm typecheck` / `pnpm lint` | PASS |
| `pnpm build` | PASS，仅既有 chunk-size warning |
| `pnpm quality` | 首次暴露 onboarding 偏好异步断言抖动；小修后最终 PASS 8/8 |
| `git diff --check` | PASS |
| Windows 主 crate target check | BLOCKED，既有 `icons/icon.ico` 缺失 |

自动化全绿说明当前测试覆盖到的路径稳定，不会抵消上述未覆盖的按窗协议、
失效竞态和 native evidence 缺口。

## 5. 下一步

唯一派发入口：

`2026-08-31-mrt-004w2r-lifecycle-isolation-and-native-evidence-task-card.md`

执行 Agent 连续完成整卡后停止，等待一次统一验收。修复期间不进入 MRT-005、
最终视觉、MRT-008 快捷键重设计，也不修改 capability/config/CI/CD/发布配置。
