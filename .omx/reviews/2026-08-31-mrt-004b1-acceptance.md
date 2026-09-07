# MRT-004B1 统一验收报告

## 结论

- **MRT-004A1：继续 ACCEPTED。** 本批没有破坏单 owner、原子
  completion、Closing 延迟路由和 bootstrap 可靠交付。
- **MRT-004B1：NEEDS-REMEDIATION。** CreateWindow 写前 assignment、
  untitled 首次 Save As、无损 `PathBuf` identity 与 Unix/Windows `cfg`
  边界已通过；但 host-domain commit outcome、写后 fail-closed 和真实
  cross-window token 校验仍未满足 B1 任务卡。
- **Wave 1：仍未接受。** 下一步只执行一张合并卡 MRT-004B1A；不拆成
  微任务，不进入真实 Tauri 多窗口。
- **MRT-004C～E / Wave 2：继续 LOCKED。** B1A 验收前不得接生产 IPC、
  native source、真实 `editor-*` 窗口或 Finder/Dock 场景。

本轮未修改生产代码。审查者只修正了候选架构/证据中的状态和事实表述，
并新增本验收报告与下一张任务卡。

## 已通过部分

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| CreateWindow assignment | PASS | `CreateWindow` effect 发出前预占；成功升级 Active，失败释放；X1/X2/X3 通过 |
| active/assignment/pending 单占用 | PASS | pending 虽是独立表，但所有关键写入口均参与冲突检查 |
| target/source/generation token 绑定 | PARTIAL PASS | canonical target、source、window generation、单 label pending、stale/replay 已实现 |
| untitled 首次 Save As | PASS | Blank 成功 adopt 为 Open；失败保持 Blank；Closing untitled 成功后不复活 |
| Unix identity | PASS | canonical + dev/inode、symlink/relative/hard-link/Unicode/atomic replace 通过 |
| 无损路径 | PASS | `CanonicalPathKey(PathBuf)`；lossy 只用于展示投影 |
| 非 Unix `cfg` | PASS（源码边界） | 同一份 `identity.rs` 在 `x86_64-pc-windows-msvc` 独立源码探针编译通过 |
| 回归门禁 | PASS | Rust 119、platform 47、quality 271、Clippy、build 均通过 |

## 阻断问题

### B1A-F1 / P0：commit 成功后的 identity refresh 失败会错误释放 target reservation

`orchestrate_save_as()` 在文件 commit 成功后，如果
`provider.refresh_after_commit()` 失败，会调用 `abort_rebind()`。此时目标
bytes 已经落盘，语义上已不可能回滚；释放 pending 后，另一个 open/create
可以立即取得该 target，而原窗口仍保留旧 identity。这违反任务卡“写后
内部错误必须 fail closed、不得伪装回滚”的明确不变量。

正确边界是：只有 redeem/TOCTOU/commit **尚未成功**时才能 abort；commit
一旦成功，refresh/finalize 失败都必须保留或转化为等价的 fail-closed
reservation，并返回可区分“已写盘、待恢复换绑”的稳定错误。

### B1A-F2 / P0：open/ordinary 的 host identity 没有与实际 handle/commit 结果绑定

目前存在三条移花接木入口：

1. `open_file_with_identity()` 先得到 `OpenOutcome`，再把展示用
   `display_path: String` 转回 `PathBuf` 解析 identity；非 UTF-8 路径会丢失，
   而且内容读取与 metadata 不是同一个不可替换来源。
2. ordinary Save 仍返回不含 identity 的 `Receipt`；调用方随后可把任意
   `path` 传给 `refreshed_identity_after_commit()`，再把这个 identity 换绑
   给当前窗口。commit A 后刷新 B 在类型/API 层没有被禁止。
3. `AuthorizationPlan` 字段全部公开，而 `commit_save_as_planned()` 只使用
   `authorization_ref`，没有校验 plan 的 window/kind/canonical target 与
   ledger redeem 结果一致。当前诚实调用路径通常正确，但接口本身没有建立
   B1.5 要求的不可伪造绑定。

B1A 必须让 open/ordinary/Save As 的 host-only identity 来自 ledger/handle
绑定的真实 canonical target，不得从 DTO `displayPath` 或调用方另传 path
反推。

### B1A-F3 / P1：rebind token 无法执行 cross-window caller 校验

`PendingRebind` 虽保存了 `window_label`，但 `finalize_rebind(token, identity)`
与 `abort_rebind(token)` 都没有 caller label（或等价 scoped guard）参数，
因此 API 无法区分 token 是由哪个窗口上下文提交。名为
`t3_cross_window_and_forged_token_rejected` 的测试实际只覆盖 forged token
和 replay，没有发起一次“W2 使用 W1 token”的调用。

B1A 需让 finalize/abort 同时验证 caller label + window generation，并补
真实 cross-window 零变化断言；不能只依赖 token 难猜或 host 调用方诚实。

### B1A-F4 / P2：自检证据存在过度声明

实现证据曾写 pending 与 active/assignment“共用 `alias_owners`”，但源码中
pending 位于独立表；曾声明 T3 覆盖 cross-window，但测试未覆盖；门禁表还
引用了不存在的“下一节最终 Gate”。这些属于文档小问题，审查者已直接修正，
不单独退卡。

## 独立复验

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS：119 tests + 0 doc tests |
| `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `pnpm --filter @mindmap/platform test` | PASS：4 files / 47 tests |
| `pnpm quality` | PASS：27 files / 271 tests；typecheck/lint/boundaries/licenses/network/golden/performance 全 PASS |
| `pnpm build` | PASS；仅保留既有 chunk-size warning |
| B1 changed-scope Rustfmt / Prettier | PASS |
| `git diff --check` | PASS |
| ADR 0008 hash | PASS：`a88c9606000a8e72e59ee634f02eecc652c0d82c1a336b8f5ad248c70a1c105e` |
| `cargo check --target x86_64-pc-windows-msvc --lib` | BLOCKED：先命中既有 `icons/icon.ico` 缺失 |
| `identity.rs` Windows target 源码探针 | PASS；同一文件经 `rustc --target x86_64-pc-windows-msvc` 编译 |

仓库全量 `pnpm format:check` 与 `cargo fmt -- --check` 仍会命中本批范围外的
既有格式债；B1 changed-scope 检查通过，未批量格式化或夹带无关改动。

## 解锁决定

- 保留 B1 已通过的 assignment、untitled 与平台 identity 实现，不重写。
- 执行 `.omx/reviews/2026-08-31-mrt-004b1a-host-outcome-and-token-remediation-task-card.md`。
- B1A 完成后一次性统一验收；通过后再把 MRT-004C～E 合并成下一批生产
  接线任务，不恢复逐小步验收。
