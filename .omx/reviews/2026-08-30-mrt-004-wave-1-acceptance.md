# MRT-004 Wave 1 统一验收报告

## 结论

- **MRT-004A1：ACCEPTED。** 单一并发 owner、completion 原子推进、Closing identity 延迟路由、bootstrap outcome 可靠重报与 TS/Rust 类型对齐已通过代码审查和独立门禁。
- **MRT-004B：NEEDS-REMEDIATION。** identity alias 方向正确，macOS/Unix 测试也全绿，但 Save As reservation 仍可被窗口创建竞态绕过，rebind token 未绑定目标，未命名文档首次 Save As 无法完成；Windows `cfg` 与无损路径键也未满足本波次边界。
- **Wave 1：NOT ACCEPTED。** 下一步一次性执行 MRT-004B1；不拆成微任务，不回退已接受的 A1。
- **MRT-004C～E：LOCKED。** B1 验收前不得进入真实 Tauri 多窗口/native source/Finder/Dock。

本轮未修改生产代码。发现的是 host 文件身份和保存换绑基础协议问题，属于较大问题，按项目原则退回一张合并修复卡。审查者只修正状态文档并新增验收/任务卡。

## 已通过部分

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| A1 单 owner | PASS | `WindowRegistry` 为无锁纯数据；`LaunchCoordinator` 只有一个 `Mutex<CoordinatorState>` |
| A1 原子 completion | PASS | CreateWindow 与 renderer outcome 先验证后提交；失败测试覆盖 delivery/record/phase 零部分推进 |
| A1 Closing 策略 | PASS | Closing 保留 active identity；重复 open deferred；Destroyed 后同 intentId 恢复 |
| bootstrap 可靠重报 | PASS | action-once；outcome 缓存；report 失败可观察并可显式重报 |
| TS/Rust 契约 | PASS | renderer outcome 收窄；`WindowBootstrap` 为判别联合 |
| Unix identity 基础 | PARTIAL PASS | canonical + dev/inode、symlink/relative/hard-link/Unicode/atomic replace 当前 macOS 测试通过 |
| alias 索引方向 | PARTIAL PASS | canonical/physical aliases 分开建索引，避免非传递 OR 判等 |
| 自动化 | PASS（当前 macOS host） | Rust 100、platform 47、quality 27 files/271 tests、clippy/typecheck/lint/build 均通过 |
| 范围控制 | PASS | 未修改 capability、`tauri.conf.json`、CI/CD、发布配置、最终 UI、core/export/文件格式 |

## 阻断问题

### B1-F1 / P0：pending Save As reservation 可被已发出的 CreateWindow completion 绕过

当前 `route_next()` 只在产出 `CreateWindow` 前检查 pending rebind；真实窗口创建是锁外异步副作用。在 effect 发出后、`WindowCreated` 回报前，另一窗口可以成功 `prepare_rebind()` 同一目标。

随后：

- `WindowCreated` 成功回报只检查 active `identity_reservation()`，不检查 pending reservation。
- `begin_loading()` 同样只检查 `alias_owners`，不检查 `pending_rebinds`。

结果是同一 target alias 可同时属于一个 pending Save As 和一个 Loading 窗口。Save As 文件写入完成后，`finalize_rebind()` 才发现 active owner 冲突：文件已经写了，但原窗口未完成换绑，正是写前 reservation 要消除的失败模式。

修复必须让窗口 assignment 从 effect 发出前就持有可回滚 reservation，或建立语义等价的统一 reservation 状态；不能只在 `WindowCreated` 回报时再检查一次。

### B1-F2 / P0：rebind token 未绑定获准目标，且同一窗口可并存多个未决 token

`prepare_rebind()` 保存 target aliases，但忽略同 label 已存在的 pending rebind；`finalize_rebind()` 只用 token 找 label，没有验证 `final_identity` 的 canonical target 与 token 中预占的 canonical target 一致，也不检查其他 pending reservation。

因此 stale/错配 token 可以：

- 预占 A，却 finalize 到未预占的 B。
- 同一窗口并存多个 Save As token，后完成的旧 token把窗口身份切回过期目标。
- 绕过“所有会失败的冲突必须在写前完成”的协议保证。

首版必须限制每个 label 最多一个 pending document rebind，token 绑定 window generation/source identity/authorized canonical target；finalize 只允许 canonical target 相同，physical alias 可以因原子替换而刷新。

### B1-F3 / P0：未命名空白文档的第一次 Save As 无法 finalize

产品主流程是打开空白窗口、编辑、第一次保存走 Save As。此时 registry 状态是 `Blank`，没有旧 `file_identity`。

当前 `prepare_rebind()` 只要求窗口存在，所以会成功；文件服务也会真实写盘。但 `finalize_rebind()` 要求窗口处于 `holds_identity()` 且已有旧 identity，Blank 首存必然返回 `INVALID_WINDOW_TRANSITION`。结果仍是“文件已写，session/registry 未换绑”。

B1 必须明确并测试：

- Blank/untitled → Save As 成功后采用新 identity，并进入可表示“已命名文档”的状态。
- close-save 路径若窗口已进入 Closing 且原本无 identity，也能在不复活窗口的前提下安全完成提交并等待 Destroyed。
- commit 失败或取消时仍保持 untitled/dirty/无 identity。

### B1-F4 / P1：B 没有留下可安全接入 Wave 2 的 host-domain 提交边界

真实 provider 与 coordinator rebind 方法目前只在测试中被手工串联。生产 `FileLifecycleService`、authorization ledger、open/commit outcome 都没有携带或提供 host-only identity/authorized target plan；`platform_commit_document` 只拿到 opaque authorization ref。

Wave 2 若直接接线，只能在写后从 receipt/display path 猜目标，或重新临时扩展授权协议，无法保证 prepare 发生在真实写入前。B1 需要建立可测试的窄 host orchestration 边界：从授权 ledger 安全取得绑定 window/kind/expiry 的 canonical target plan，prepare reservation，锁外 commit，成功 finalize、所有失败 abort；ordinary/open outcome 也要提供 host-only refreshed identity。不得把 identity 暴露给 renderer 判定。

### B1-F5 / P1：Windows `cfg` 边界会编译失败，canonical key 还会发生有损碰撞

- `UnixFileIdentityProvider` 与 `std::os::unix::fs::MetadataExt` 没有 `#[cfg(unix)]` 包围；Unix 专属测试和 `synthetic_with_physical()` 也没有完整平台 gate。Windows 标准库不存在 `std::os::unix`。
- 直接 `cargo check --target x86_64-pc-windows-msvc` 当前先被仓库既有的 `icons/icon.ico` 缺失阻断；独立 Windows-target 编译探针已确认 `std::os::unix` 不可用。因此现实现不能声称 Windows compile boundary 已完成。
- `CanonicalPathKey(String)` 由 `PathBuf::to_string_lossy()` 构造。两个不同的非 UTF-8 路径可能折叠为相同 replacement 字符串，错误共享 identity owner。

修复方向：host canonical key 保留 `PathBuf`/`OsString` 的无损平台表示，只在日志展示时 lossy；Unix provider/测试完整 `cfg(unix)`；非 Unix 提供明确的 canonical-only provider 或 platform factory，不冒充 physical identity。Windows 完整 file ID 仍可留到平台专项。

### B1-F6 / P2：Wave 1 最终证据缺失，架构文档状态互相矛盾

只存在 A1 红灯/Internal Gate 证据，没有任务卡要求的 Wave 1/B 最终 implementation evidence。架构页顶部仍写 A/B 等待验收和“FileIdentity 当前为合成值”，后文又把 B 标成“已落地”。审查者已把页面改为 A1 Accepted、B candidate/remediation；B1 完成时需补齐统一证据并只把通过验收的事实写成当前架构。

## 独立复验

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @mindmap/platform test` | PASS：4 files / 47 tests |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS：100 tests + doc tests |
| `cargo clippy ... --all-targets -- -D warnings` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm quality` | PASS：27 files / 271 tests；全部阶段 PASS |
| `pnpm build` | PASS |
| changed-scope Prettier / Rustfmt | PASS |
| `git diff --check` | PASS |
| ADR 0008 hash | PASS：`a88c9606000a8e72e59ee634f02eecc652c0d82c1a336b8f5ad248c70a1c105e` |
| Windows target check | BLOCKED：先命中既有 `icons/icon.ico` 缺失；源码另有未 gate 的 `std::os::unix` 确定性错误 |

quality 输出中的 `verify-decision ... FAIL` 是负向漂移测试夹具的预期输出；外层 unit 与 quality 汇总均为 PASS。

## 解锁决定

- MRT-004A1：ACCEPTED，不重做。
- MRT-004B：NEEDS-REMEDIATION。
- MRT-004B1：READY，作为一次完整修复批次执行并统一验收。
- MRT-004C～E / Wave 2：LOCKED。
