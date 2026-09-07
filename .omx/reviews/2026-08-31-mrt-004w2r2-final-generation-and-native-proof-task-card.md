# MRT-004W2R2：generation 线性化与最终 native 证据收口卡

## 1. 定位

**优先级：P0**  
**状态：READY — 一次性完成、一次统一验收**  
**依赖：MRT-004 Wave 1 ACCEPTED；W2R 主体实现已完成但统一验收未通过**  
**阻断：MRT-005、UXI 生产实现和最终视觉换肤**

本卡只收口 W2R2-F1～F4，不重写已通过的窗口生命周期。执行 Agent 应完成
红灯、generation 修复、runner fail-closed 和最终 native 事实后一次性交回；
中途 Internal Gate 自证，不回来做微验收。

## 2. 必读与基线

开始前完整阅读：

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`。
3. `docs/architecture/window-launch-lifecycle.md`。
4. `2026-08-31-mrt-004w2r-lifecycle-isolation-and-native-evidence-task-card.md`。
5. `2026-08-31-mrt-004w2r-implementation-evidence.md`。
6. `2026-08-31-mrt-004w2r-acceptance.md`。
7. MRT-003V 的真实 Save 面板证据和 `tests/e2e/macos/ax-bridge.mjs`，用于解释
   为什么同一主机过去可通过 System Events 驱动真实 Save As。

先记录 `git status --short` 和 `git diff --name-status`。当前是多轮累计工作树，
不得还原其他作者修改，不得清理 `.omx`、`docs/quality/evidence` 或未提交源码。

必须保留审查者已做的小修：bootstrap ready/report 的 `toPlatformError` 映射
及 `[object Object]` 回归测试。

## 3. Phase R：先补红灯

### R1. commit 起点 generation

用 latch/Condvar 构造普通保存与 Save As 的确定性交错：

1. generation N 窗口进入 commit；
2. 文件 I/O 或 refresh 在锁外暂停；
3. Destroyed N，并登记同 label generation N+1；
4. 放行旧 commit，强制进入 post-commit recovery 分支。

断言：

- N+1 registry/identity/delivery 零变化；
- N+1 `pending_recovery()` 为空，保存不被旧 `RECOVERY_PENDING` gate；
- 旧 receipt 不被记录为 N+1 recovery；
- 已落盘事实不伪装成普通 pre-commit 失败。

普通保存和 Save As 至少各一条生产 runtime 测试；不得用 sleep 当正确性条件。

### R2. assigned open 最终校验顺序

构造 provider 在 open identity resolve 期间阻塞；随后 Destroyed old generation，
同 label 新代进入可观测状态并持有独立 identity/delivery。放行旧 open，断言：

- 返回 `STALE_BOOTSTRAP_COMPLETION`；
- 本次签发 handle 被精确 revoke，窗口 handle 数为零；
- 新代 registry state、identity、active intent、delivery 全部逐字段不变；
- `refresh_identity_after_commit` 或等价修改没有发生在 stale 校验之前。

### R3. runner 缺项必须 INCOMPLETE

把 S9 facts 拆成机器可判断字段：

```text
saveAsPanelShown
saveAsConfirmed
saveAsFileExists
saveAsFileNodeCount
ordinarySaveOnSameTarget
ordinaryDidNotReopenPanel
recoveryReceiptVisible
recoverySecondSaveBlocked
recoveryResolvedExplicitly
ordinarySaveAfterRecovery
```

任一 required field 不是 `true`，S9 必须 `INCOMPLETE`，overall 非零。增加 runner
自测或纯 verdict helper 测试，明确证明“只有说明文字/只有 unit coverage/只打开
面板”不能 PASS。

`--only` 调试运行不得产生可冒充正式十场景的 `overall=PASS`：要么输出
`scope=partial` + `overall=INCOMPLETE`，要么使用与正式 aggregate 不同的结果
字段和文件名。

### R4. S10 他窗零变化

先制造“main 节点发生变化但仍为浅色”的负例，证明旧 luma 断言会假绿；再要求
稳定区域 SHA、AX 节点数、host/session dirty 投影至少三者中的两个完全相等，
且目标 editor 节点数明确 +1。

## 4. Phase H：generation 线性化修复

### H1. commit operation binding

为每次 commit 在任何锁外 I/O 前取得 host-only operation binding：

```text
windowLabel
windowGeneration
operationId?  // 若用于 compare-and-remove，必须 host-only
```

要求：

- ordinary/Save As 共用相同 caller-generation 验证原则；
- post-I/O 的 registry refresh、rebind finalize、recovery insert 前都比较起点代；
- recovery record 使用起点 generation，不得事后读取“当前 generation”后绑定；
- generation 失配时不得写入新代 recovery；
- 不向 renderer 暴露 generation、token、canonical、identity 或 operationId；
- 不把已提交 bytes 误报为可安全重试覆盖的普通保存失败。

优先增加 coordinator 的窄操作，而不是在 runtime 中拼多个只读检查造成新 TOCTOU。

### H2. assigned open atomic finalize

把“delivery 仍属于 caller 当前代”与“必要的 identity refresh”放进 coordinator
同一临界区：

1. 锁外 read/identity；
2. 回锁后一次原子 validate-and-refresh；
3. 成功才返回 handle/content；stale 则只 revoke 本次 handle。

禁止先修改 registry，再做第二次 `assigned_open_target()` 只读判断。

### H3. 生命周期清理

检查 `commit_gates` 的长期生命周期。若安全移除 gate 必须以 operation binding
保证旧 in-flight 不与新代共享/并发；若不移除，记录为何 label 单调分配使其仅
为有限 P2 内存项。不要为了这项做无边界重构。

Internal Gate H：R1/R2 全绿，完整 Rust suite + clippy 通过后才进入 native。

## 5. Phase E：真实 native 最终事实

### E1. 先修 runner 语义

- S9 未完成真实 Save As 或 recovery 时只允许 `INCOMPLETE`；
- S10 使用强零变化事实；
- aggregate 必须恰好包含 S1～S10 各一次；缺号、重复、partial scope 非零；
- 每个 required screenshot 存在、可读、非 DARK，引用路径可解析；
- 新 bundle 必须包含审查者的 report error 映射修复，错误 UI 不再出现
  `[object Object]`。

### E2. 真实 Save As → ordinary Save

不要重复发明已经失败的 CGEvent-only 面板方案。优先复用/修复 MRT-003V 已成功
的 System Events + `ax-bridge.mjs` 通道：⌘⇧G 导航、设置名称、精确 AX click
“存储/Save”。如当前权限/会话确实不同，先产出可复现的权限诊断。

允许的兜底是同一 runner 明确暂停，由真实操作者完成一次系统面板确认，随后
runner 继续自动验证文件 bytes/node count/hash。必须记录时间、操作者、bundle
hash、目标路径、动作前后文件事实和截图。没有实际点击与落盘就是
`INCOMPLETE`。

随后在刚 Save As 的同一窗口：

- 再次 dirty；
- ⌘S ordinary Save；
- 文件节点/bytes 确实更新；
- 不再次弹系统面板；
- handle/token 仍由 host 绑定，不从 UI 路径推断。

### E3. 可控 post-commit recovery

真实链路需要确定性注入，不等待亚毫秒自然故障。可在 debug/test bundle 中使用
最窄的 fail-once provider seam，例如仅 `debug_assertions` 且仅本地环境变量
启用；release build 不包含可触发入口，不新增 IPC/capability/网络端点。

必须真实观察：

1. bytes 已落盘、receipt 进入 `recovery-pending`；
2. 同窗再次保存被 `RECOVERY_PENDING` 阻止且文件不被二次写；
3. UI 显示显式恢复动作；
4. 点击恢复后 pending 消失；
5. 再次 ordinary Save 成功。

若实现确定性 seam 需要修改 capability、`tauri.conf.json`、CI/CD、发布配置或
release 行为，立即 STOP，向项目负责人申请，不得擅自放宽安全边界。

### E4. 执行次数

先做一次完整 10/10 有效运行。只有第一次真正 PASS 后才追加第二、第三次稳定性
复跑；不要在已知缺项时重复三遍制造假确定性。最终 aggregate 与关键截图进入
持久证据目录；`.tmp` 只留可再生 raw 工作区。

## 6. Windows 与全量回归

- 保留 `node scripts/quality/windows-probe.mjs` 一条命令；修掉脚本中的重复
  `implText` 赋值等局部噪声；
- 主 crate blocker如实记录，不改 icon/capability/config 绕过；
- probe source SHA 清单必须覆盖实际复制的 lifecycle/file 和生成的 ipc DTO
  来源说明；不得把 source probe 宣称为 Windows app 已可运行；
- 运行全部 Rust/TS/quality/build/format/diff 门禁。

## 7. 允许修改范围

- `apps/desktop/src-tauri/src/lifecycle/{runtime,launch_coordinator,window_registry}.rs`
- `apps/desktop/src-tauri/src/file/`（仅 generation/capability/recovery 直接需要）
- `packages/platform/src/lifecycle/` 及对应测试
- `apps/desktop/src/app/`（仅 report/recovery 功能 UI 与测试）
- `tests/e2e/macos/wave2-windows.mjs`、必要的既有 AX bridge/quality helper
- `scripts/quality/windows-probe.mjs`
- `docs/architecture/window-launch-lifecycle.md`
- `docs/quality/evidence/wave2/`
- `.omx/reviews/2026-08-31-mrt-004w2r2-*`

## 8. 禁止与 STOP 条件

禁止：

- 进入 MRT-005～012 或 UXI 最终视觉实现；
- 修改 ADR 0008 决策 bytes、capability、Tauri 配置、CI/CD、发布配置；
- 新增运行时依赖、账号、网络、遥测或云能力；
- 以 unit/fake 覆盖替代任务卡明确要求的 native facts；
- 修改 verdict 期望来迁就缺失动作；
- 清理其他作者未提交变更或 `.omx` 审计文件。

若必须扩大产品范围、改变“一文档一窗口/activation 新空白”、加入 release 可触发
故障注入或修改红线配置，立即停止请求授权。

## 9. 验收标准

1. commit 起点 generation 绑定，Destroyed/recreate 下旧提交对新代零影响。
2. assigned open validate-and-refresh 单临界区；stale 路径零 registry 修改、零
   handle 残留。
3. S9 真实完成 Save As 落盘、同窗 ordinary Save、可控 recovery 全链。
4. S10 同时证明目标窗 +1 与其他窗内容/dirty 零变化。
5. partial/缺事实/缺截图稳定返回 `INCOMPLETE` 非零。
6. 新 native bundle 中所有 `{code,message}` 错误均为可读文案，无
   `[object Object]`。
7. Windows probe 可复现且不夸大；主 crate blocker如实记录。
8. 全量门禁通过；未越过 ADR/config/CI/CD/依赖/产品范围。

## 10. 验证命令

```bash
pnpm --filter @mindmap/platform test
pnpm test:unit
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
pnpm lint
pnpm quality
pnpm build
pnpm exec prettier --check <本卡变更 TS/TSX/MJS/MD/JSON>
rustfmt --edition 2021 --check --config skip_children=true <本卡变更 Rust>
git diff --check
git status --short
```

另记录真实 macOS runner 的准确命令、退出码、bundle SHA、10 场景 aggregate、
关键截图索引；运行 Windows 主 target check 与同源 probe。

## 11. 一次性交回内容

1. W2R2-F1～F4 根因/修复映射。
2. 每条先红后绿测试名与强制交错方法。
3. commit binding 与 assigned-open atomic finalize 数据流。
4. S1～S10 facts 表，重点列 S9/S10 required fields。
5. Save As 与 recovery 真实动作、文件 bytes/hash、截图、bundle hash。
6. Windows blocker/probe 与 source SHA。
7. 全部门禁、变更文件、`git diff --check`、`git status --short`。
8. 明确声明未进入 MRT-005/UXI，未改 ADR/config/CI/CD/依赖/发布。

完成后停止，等待一次统一验收。

