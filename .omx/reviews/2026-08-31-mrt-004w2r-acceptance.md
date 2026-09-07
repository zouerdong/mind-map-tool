# MRT-004W2R 统一验收

日期：2026-08-31  
审查范围：MRT-004W2R 生产代码、Rust/TypeScript 回归、macOS native 十场景、Windows 同源 probe、实现证据与当前工作树。

## 1. 结论

**MRT-004W2R：NEEDS-REMEDIATION。MRT-004 尚未 ACCEPTED，MRT-005 继续锁定。**

本批主体实现比上一轮完整：按窗错误可见性、Failed 原窗 retry/dismiss、显式
bootstrap report 重报、单锁 startup barrier、recovery compare-and-remove、
孤立 handle 回收以及 Windows 同源 probe 均已有生产接线和回归。独立自动化
门禁全部通过。

但统一验收仍有三个阻断项：

1. native runner 把明确未执行的 Save As 落盘和 post-commit recovery 标成
   `PASS`，不满足任务卡的 fail-closed 证据规则；
2. commit/recovery 在锁外 I/O 前没有固定 caller window generation，旧窗口
   的提交结果可能被记录到同 label 的新 generation；
3. assigned open 在最终 stale 校验前可能先刷新 registry，不能证明 stale
   旧操作对同名新代窗口零修改。

下一步只执行一张合并收口卡 `MRT-004W2R2`，完成后再做一次统一验收；不再拆
微卡，也不得提前进入 MRT-005。

## 2. 已通过、应保留的部分

| 范围 | 结论 | 证据 |
| --- | --- | --- |
| launch error 可见性 | PASS | snapshot/retry/dismiss 注入真实 caller；按 label + generation 过滤；跨窗测试通过 |
| Failed 原窗恢复 | PASS | retry 复用 Failed 窗，dismiss 收口 Blank；ack once 回归通过 |
| bootstrap report 重报 | PASS（代码） | action once、pending outcome 缓存、显式有限重报通过；错误文案局部缺口已现场修复 |
| startup barrier | PASS | `confirm_startup_blank` 单锁线性化，两种强制交错测试通过 |
| recovery 基本协议 | PARTIAL PASS | resolve 前后 generation 校验、compare-and-remove、同窗 gate 已有；commit 起点 generation 未绑定 |
| assigned handle 回收 | PARTIAL PASS | stale 后精确 revoke、handle 计数归零通过；registry 修改顺序仍需收口 |
| macOS S1～S8 | SUBSTANTIAL PASS | 三次同 bundle 执行，主要窗口/错误/关闭事实和有效截图存在 |
| macOS S9/S10 | NOT ACCEPTED | S9 缺真实 Save As 与 recovery；S10 只以亮度判断他窗未变 |
| Windows | SOURCE-BOUNDARY PASS / APP BLOCKED | probe 日志与当前 13 个生产源文件 SHA 匹配；主 crate 仍被既有 `icons/icon.ico` 缺失阻断，不等同 Windows 实机 |

不得在下一卡中推倒已通过的 single owner、listener-first、deliveryId 去重、
一文档一窗口、host-only identity/capability、保存队列或三分支关闭协议。

## 3. 阻断发现

### W2R2-F1 / P0：S9 结果被错误标绿

任务卡要求真实执行：

- Save As 选址并落盘；
- 随后对同一文档 ordinary Save，不再次弹面板；
- 至少一次可控 post-commit recovery，证明 receipt 保留、同窗保存 gate、
  显式恢复后可继续 ordinary Save。

现有 `mrt-004w2r-macos-e2e-run{1,2,3}.json` 的 S9 均明确写明：Save As
只打开面板，确认未执行；recovery 只由 Rust/fake seam 覆盖。runner
`tests/e2e/macos/wave2-windows.mjs` 的 S9 verdict 却只检查“面板出现 + 另一
个预先打开文档的 ordinary Save + 截图有效”，因此仍产生 `PASS`。这违反
“未执行即 INCOMPLETE”的硬门槛，三次重复不能提升证据等级。

修复要求：verdict 必须逐项读取真实 facts；任一 required fact 缺失即
`INCOMPLETE` 非零。若自动化通道无法确认系统面板，允许同一 runner 暂停并
记录一次真实人工动作，但不能用说明文字替代执行。

### W2R2-F2 / P1：post-commit recovery 可能错绑新 generation

`LifecycleRuntime::commit_document()` 在进入锁外文件提交前未捕获窗口
generation。发生 refresh/finalize 失败后，`record_recovery()` 才调用
`window_generation(label)` 读取“当前”generation。若旧窗口在 I/O 期间
Destroyed、同 label 新窗口已登记，旧 receipt/rebind 事实会被绑定到新代。

这会让新窗口看到不属于自己的 recovery，或被 `RECOVERY_PENDING` 错误阻止
保存。per-window gate 只按 label 串行 commit/recovery，Destroyed/re-register
并不取该 gate，因此不能消除此竞态。

修复要求：commit 入口固定 `(label, generation)`；任何 post-I/O registry
回写和 recovery 插入都必须 compare 当前代与起点代。失配时旧结果不得修改
新 registry、不得产生新代 recovery。文件若已经提交，receipt 事实仍需保留
在调用结果/日志中，但不能冒充新窗口待恢复状态。

### W2R2-F3 / P1：assigned open 在最终 stale 判断前先更新 registry

`open_assigned_document()` 在锁外读取后，若 physical identity 变化，会先
调用 `refresh_identity_after_commit()`，随后才再次检查 delivery 是否仍
assigned。Destroyed + 同 label 新代交错时，旧 open 可能先触碰新代 registry，
再返回 stale 并撤销 handle。

修复要求：coordinator 提供一次原子“校验 delivery label + deliveryId +
window generation，并在仍属于本代时刷新 identity”的窄操作；任何 registry
修改必须发生在最终 stale 校验内部。stale 路径只撤销本次 handle并返回稳定
错误，对新代窗口状态/identity/delivery 为零变化。

### W2R2-F4 / P1：S10 的“其他窗口未变”断言过弱

S10 的 `mainUntouched` 仅判断前后区域平均亮度均大于 150；主窗口内容、dirty
或节点变化只要仍是浅色就会误判通过。任务卡要求目标 editor quick-create，
其他窗文档/dirty 不变。

修复要求：至少保存并比较 main 的稳定区域 SHA、AX 节点计数和 host/session
可观察 dirty 投影；不能只用“仍然较亮”代表零变化。

## 4. 本轮现场修复的小问题

native S9 截图显示 bootstrap report 失败文案仍为 `[object Object]`。根因是
`TauriLaunchPort` 做了 `toPlatformError`，实际 report 则走
`createTauriBootstrapPorts()`，后者直接抛 Tauri object。

已现场最小修复：

- `packages/platform/src/lifecycle/tauri-window-bootstrap.ts`：ready/report invoke
  失败统一经 `toPlatformError`；
- `apps/desktop/src/app/window-bootstrap-integration.test.tsx`：锁定错误信息包含
  `传输中断` 且不含 `[object Object]`。

专项 33 tests、platform/desktop typecheck、Prettier 和 `git diff --check`
均通过。该修复不改变 host 协议或产品范围。

## 5. 独立验证结果

| 命令/检查 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS，168 tests |
| `cargo clippy ... --all-targets -- -D warnings` | PASS |
| `pnpm test:unit` | PASS，29 files / 280 tests |
| `pnpm quality` | PASS，8/8 子门禁 |
| `pnpm typecheck` / `pnpm lint` | PASS |
| `pnpm build` | PASS；保留既有大 chunk warning |
| W2R 小修专项 | PASS，3 files / 33 tests |
| changed-scope Prettier / `git diff --check` | PASS |
| ADR 0008 SHA-256 | `a88c960…1c105e`，与批准记录一致 |
| Windows probe source SHA | 与当前 13 个 lifecycle/file 源文件 bytes 一致（顺序差异不影响 hash） |
| macOS 截图人工抽查 | 图片有效且能辨认真实 app；同时直接观察到旧 bundle 的 `[object Object]` 缺口 |

自动化全绿证明主路径回归稳定，但不能替代缺失的 native required facts，也不能
覆盖上述 generation 竞态。

## 6. 验收状态

- MRT-001～003V：保持 ACCEPTED。
- MRT-004 Wave 1：保持 ACCEPTED。
- MRT-004 Wave 2 / W2R：NEEDS-REMEDIATION。
- MRT-004W2R2：READY，下一张唯一执行卡。
- MRT-005：LOCKED。
- UXD-001：仍可只做设计定义；UXI 生产实现等待 MRT-004 通过和用户方向 Gate。
