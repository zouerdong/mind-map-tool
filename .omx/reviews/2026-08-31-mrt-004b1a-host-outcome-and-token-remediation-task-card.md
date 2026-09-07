# MRT-004B1A：Host Outcome、写后 Fail-Closed 与 Token 调用边界修复任务卡

## 1. 定位

**优先级：P0**

**状态：READY — 单次完成、单次统一验收**

**保留：MRT-004A1 与 B1 已通过部分**

**修复：B1A-F1～F3**

**下游：MRT-004C～E / Wave 2，继续锁定**

本卡只收口 Wave 1 的 host-domain 文件 outcome 与 rebind 调用边界。不要
接真实 Tauri 多窗口，不改 UI，不重写已通过的 assignment、untitled、
bootstrap 或 close handshake。所有要求在一个 Agent 工作周期内完成，
最后统一交回验收。

## 2. 必读与工作树规则

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`（Accepted 1.0.0；冻结
   hash 不得修改）。
3. `.omx/reviews/2026-08-31-mrt-004b1-acceptance.md`。
4. `.omx/reviews/2026-08-30-mrt-004b1-reservation-and-rebind-remediation-task-card.md`。
5. 当前 `file/identity.rs`、`file/authorization.rs`、`file/handle.rs`、
   `file/mod.rs`、`window_registry.rs`、`launch_coordinator.rs` 及对应测试。

当前工作树是累计现状。不得还原、覆盖、清理前序 Agent/审查者变更，不得
使用 destructive Git 命令。

## 3. 必须恢复的不变量

1. **commit 前后语义分界明确**：commit 未成功可 abort；commit 已成功后
   refresh/finalize 失败必须 fail closed，目标 reservation 不得释放。
2. **host identity 与文件能力同源**：open identity 来自实际打开目标；
   ordinary identity 来自 handle 所绑定目标；Save As identity 来自已 redeem
   的 authorization target。不得从 `displayPath` 或调用方另传 path 反推。
3. **plan 不可移花接木**：authorization ref、window、kind、canonical
   target 必须作为一个不可伪造/不可随意改写的 host plan 被 redeem。
4. **token 调用者可验证**：finalize/abort 必须验证 caller label 与 window
   generation；错窗、stale、forged、replay 全部稳定拒绝且状态零变化。
5. 文件 I/O、provider metadata 与 IPC 均保持在 coordinator lock 外。
6. renderer DTO 不新增 `FileIdentity`、canonical target 或 rebind token。

## 4. 实施步骤

### B1A.1 先补红灯，禁止先改断言迎合实现

在最终测试文件加入并记录旧实现失败：

- **PC1**：Save As commit 成功后注入 `refresh_after_commit` 失败；断言文件
  bytes 已更新、旧窗口 identity 未伪装完成换绑、pending/fail-closed target
  reservation 仍存在，同目标 open/assignment 被 deferred 或拒绝。
- **PC2**：commit 成功后注入 finalize canonical/alias 冲突；断言与 PC1
  相同，且错误可区分“已提交但换绑未完成”。
- **O1**：ordinary commit A 后，不存在传入 B path 并把窗口换绑到 B 的
  API；host outcome 的 identity canonical 必须等于 handle ledger 的 A。
- **O2**：open host outcome 不经过 `displayPath -> PathBuf`；测试 provider
  收到的必须是原始/已 canonicalize 的无损 `Path`，identity、handle、token
  属于同一打开目标。
- **AP1**：plan canonical target 与 redeem 结果错配时，在写前稳定拒绝，
  不产生 commit，不泄漏 pending；若采用私有字段/不可构造 plan，应以模块
  内负向测试证明内部校验仍存在。
- **T3-XW**：W2 对 W1 token 执行 finalize 和 abort，均返回稳定错误；
  pending、两窗 record、alias owners、目标 bytes 全部零变化。

红灯摘要写入
`.omx/reviews/2026-08-31-mrt-004b1a-red-light-evidence.md`。

### B1A.2 建立不可混淆的 commit phase

把 Save As 编排的退出路径分成两类：

```text
PreCommit
  plan → resolve/bind target → prepare → redeem/TOCTOU/commit
  任何失败：abort pending，文件未提交

PostCommit
  committed receipt + bound canonical target
    → refresh identity → finalize
  任何失败：不得 abort；保留 fail-closed reservation并返回明确状态
```

要求：

- 删除 `orchestrate_save_as()` 中 commit 成功后 refresh 失败调用
  `abort_rebind()` 的路径。
- 引入明确的错误/结果类型，例如
  `CommittedButRebindPending { receipt, cause }` 或语义等价类型；名字可调整，
  但调用方必须知道文件已写，不能提示成普通“保存失败、可重试覆盖”。
- fail-closed reservation 必须可诊断、可在后续恢复或 Destroyed 时清理；
  本卡不要求做 UI 恢复流程，但不能静默释放。
- 不吞掉 abort/finalize 错误。pre-commit abort 若自身失败，返回组合错误或
  明确内部错误，不能 `let _ = ...` 后只报告首个错误。

### B1A.3 让 open/ordinary/Save As 返回绑定的 host-only outcome

允许调整具体类型名，但边界必须满足：

```text
OpenHostOutcome {
  renderer: OpenOutcome,       // 现有 DTO 所需字段
  identity: FileIdentity       // host-only
}

CommitHostOutcome {
  renderer: Receipt,
  identity: FileIdentity,
  canonical_target: CanonicalPathKey  // 或由 identity 提供
}
```

要求：

- 移除 `outcome_display_path_of()` 及任何 `PathBuf::from(displayPath)` 的
  identity 判定路径。
- open 至少 canonicalize 一次后，内容读取、handle 签发和 identity 解析都
  使用该无损 `PathBuf`。若为保证“同一打开对象”需要扩展 provider 接受
  `File`/metadata，可做窄扩展；不要把 OS 细节泄漏给 renderer。
- ordinary commit 的 target 只能来自 `HandleRegistry::validate()`，提交成功
  后在同一 host service 流程产生 refreshed identity；不得再公开一个接受
  任意 `path` 的 loose refresh API 供调用方拼接。
- Save As prepare identity、commit target 与 post-commit identity 的
  canonical 必须都等于 ledger plan 的 canonical target；provider 返回
  错 target 时写前拒绝或写后 fail closed。
- IPC DTO 保持现有 handle/token/displayPath；Wave 2 只需把 host-only
  identity 交给 coordinator，不向前端序列化。

### B1A.4 收紧 AuthorizationPlan

- `AuthorizationPlan` 字段改为私有，向 orchestration 只提供必要只读 getter；
  不允许任意构造或改写 window/kind/canonical target。
- commit 必须 redeem **该 plan**，并再次校验 ledger 中的 authorization
  ref、window、kind、canonical target 与 plan 完全一致；不能只取
  `plan.authorization_ref` 后忽略其他绑定字段。
- plan/redeem race 仍保证一次性：至多一个 commit 成功，失败路径按
  pre-commit 规则清理 pending。
- 不改变 export authorization 的既有 DTO 与一次性语义。

### B1A.5 让 token 真正绑定调用窗口

采用以下任一方案：

1. `finalize_rebind(caller_label, token, final_identity)` 与
   `abort_rebind(caller_label, token)`；或
2. 返回不可复制、内部携带 label/generation 的 scoped guard，由
   coordinator 校验 guard owner。

无论选择哪种：

- 校验顺序必须 validate-then-commit；caller label 不符时 pending 不移除。
- `window_generation` 继续防止同名窗口销毁重建后的 stale token。
- orchestration 必须把 authorization plan 的 window 与 token owner 绑定；
  不能由调用方传两个互不校验的字符串。
- 把当前伪造+重放测试改名为诚实名称，另加真实 cross-window 测试；不得用
  名称冒充覆盖。

### B1A.6 证据与文档

- 生成 B1A 红灯证据和最终 implementation evidence。
- 更新 `docs/architecture/window-launch-lifecycle.md` 的 candidate 段落，
  但 Agent 不得自行写 ACCEPTED；交回审查者前保持 candidate。
- 证据区分：commit 前失败、commit 后未 finalize、成功 finalize 三种结果；
  不得用“所有失败都 abort”概括。
- Windows 整 crate 若仍被 `icon.ico`/本机 `llvm-rc` 阻断，如实记录；附
  可复现的同源文件 Windows target probe 命令与结果，不修改配置绕过。

## 5. 必测矩阵

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| PC1 | commit 成功 + refresh 失败 | bytes 已提交；target reservation 保留；同目标 open 不抢占 |
| PC2 | commit 成功 + finalize 失败 | fail-closed；错误明确；不伪装 rollback |
| PF1 | redeem/TOCTOU/commit 失败 | 文件未提交；pending 清理；旧 identity 不变 |
| O1 | ordinary handle A commit | outcome identity 只能是 A；无法传 B path |
| O2 | open path | identity 不经 display string；与 handle/token 同源 |
| AP1 | plan/redeem canonical mismatch | 写前拒绝；零 commit；pending 不泄漏 |
| AP2 | authorization race/replay | 至多一个 commit；第二条路径清理正确 |
| T3-XW | W2 finalize/abort W1 token | 稳定拒绝；全部状态零变化 |
| T3-S/R | stale/replay/forged | 原 B1 测试继续通过 |
| U1/U2/U3 | untitled/close-save | B1 已通过行为不回归 |
| X1/X2/X3 | create assignment | B1 已通过行为不回归 |
| P1/P2/P3 | 无损路径与平台边界 | B1 已通过行为不回归 |
| A1 全矩阵 | coordinator/bootstrap | 119 基线不删、不弱化 |

## 6. 允许与禁止修改

允许：

- `apps/desktop/src-tauri/src/file/authorization.rs`
- `apps/desktop/src-tauri/src/file/handle.rs`
- `apps/desktop/src-tauri/src/file/identity.rs`
- `apps/desktop/src-tauri/src/file/mod.rs`
- `apps/desktop/src-tauri/src/lifecycle/window_registry.rs`
- `apps/desktop/src-tauri/src/lifecycle/launch_coordinator.rs`
- `apps/desktop/src-tauri/src/lifecycle/mod.rs`（仅必要导出）
- `apps/desktop/src-tauri/src/ipc/mod.rs`（仅保持 DTO 兼容的 host outcome
  映射测试；不接新生产 coordinator）
- 对应 tests/evidence/architecture candidate 文档

禁止：

- 修改 ADR 0008/hash、capability、`tauri.conf.json`、CI/CD、发布配置。
- 接真实 Tauri 窗口/native source，或进入 Finder/Dock 验收。
- 修改最终 UI、onboarding、core schema、export、文件格式。
- 重写 MRT-003 close handshake、MRT-001 保存队列或 dirty 契约。
- 新增运行时依赖、使用 displayPath/lossy string 判 identity、吞错、
  sleep、自旋、弱化或删除失败断言。

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
pnpm exec prettier --check <B1A 变更 TS/MD>
rustfmt --edition 2021 --check --config skip_children=true <B1A 变更 Rust>
git diff --check
git status --short
```

另运行 Windows target source check。全量格式检查命中本卡范围外既有格式债
时，不要批量格式化无关文件；报告 changed-scope 结果与 baseline 清单。

## 8. 停止条件

仅在需要修改 capability/配置/CI/CD、安装依赖、改变 Accepted ADR、无法
避免改变保存/close 产品语义或会覆盖现有工作树时停止请求项目负责人。
其余局部类型与接口选择自主完成，不要中途拆分微验收。

## 9. 完成回报

一次性报告：

1. PC1/PC2 红灯与修复后的 commit phase 状态图。
2. open/ordinary/Save As host-only outcome 类型及其不可移花接木证明。
3. AuthorizationPlan 私有绑定与 race/replay 结果。
4. caller label + generation token 校验和真实 cross-window 测试。
5. X/T/U/O/A/P 与 A1 回归矩阵。
6. 全部门禁、Windows blocker/probe、格式 baseline 与 `git diff --check`。
7. 变更文件清单与范围声明。
8. 完成后停止，不自行进入 MRT-004C～E。
