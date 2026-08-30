# MRT-003 验收报告

## 结论

**MRT-003 代码实现：ACCEPTED。MRT-003 总体验收：NEEDS-EVIDENCE。MRT-004 暂不解锁。**

Rust host、IPC、platform adapter 和 App 三分支的实现方向正确，自动化门禁全部通过。审查中发现的三个局部状态机缺口已现场修复并补测试，没有需要退回的大型代码问题。

当前唯一阻断是原生证据闭环：已有 macOS 自动化覆盖 clean、Cancel、Discard、重复关闭与 ⌘Q，但明确没有执行真实 Save/Save As 成功、Save As 取消和冲突保持窗口；证据所测 bundle 还早于最终前端源码。审查者尝试使用 `computer-use` 操作最新 bundle 时，本机处于锁屏状态，无法补做系统窗口与保存面板验证。因此不能把现有 `overall: PASS` 当作 MRT-003 完整通过。

下一步只执行 MRT-003V 证据收口卡。证据通过后，无需重做 MRT-003 代码，即可转为 ACCEPTED 并解锁 MRT-004。

## 已通过的实现契约

| 契约 | 结果 | 证据 |
| --- | --- | --- |
| Host fail closed | PASS | 无 permit 的 `CloseRequested` 一律 `prevent_close()` |
| per-window 隔离 | PASS | pending/permit 以 `window.label()` 为键；跨窗 response 被拒绝 |
| request correlation | PASS | requestId 单次消费；伪造、过期、重放返回 `INVALID_CLOSE_REQUEST` |
| permit once | PASS | 第二次 close 消费 permit；close dispatch 失败可 rollback |
| listener 竞态 | PASS | 前端先 listen、后 pending snapshot，event/snapshot 按 id 去重 |
| clean close | PASS（自动化） | 不弹三分支 modal，直接 resolve `clean` |
| Save 分支逻辑 | PASS（自动化） | 复用 `saveFlow`；成功后复查 dirty/pending；失败不 resolve allow |
| Discard | PASS（自动化） | App 不调用 FilePort；host 在真正放行前 revoke window capability |
| Cancel | PASS（自动化） | 不写盘、不撤权、不改 dirty；host ack 后才清 modal |
| pending save | PASS（自动化） | 等待整条动态保存链终态；等待期间禁止直接 Discard |
| app exit | PASS（自动化+已有原生子集） | 自定义 Quit 逐窗进入同一 close 协议；ExitRequested fail closed |
| 原生 Save 三分支 | **缺证据** | 系统 Save 面板内操作被现有报告标为“人工矩阵待执行” |

## 审查中现场修复的小问题

### F1：Cancel resolve 失败仍清 modal

原实现使用 `finally` 清理 close state。若 host 未接受 Cancel，pending request 仍在，但 UI 已失去入口；重复原生关闭又会复用该 request 且不重发事件，窗口会永久卡住。

修复：只有 host 成功 ack 后才清 modal；失败保留 request、modal 与错误，可再次取消。

### F2：`whenSavesSettled` 只截取调用瞬间的 Promise

等待期间若又有保存请求加入，旧实现只等待第一批 Promise；第一批结束而第二批仍 pending 时，关闭流程会停在 `awaiting-save`，没有后续唤醒。

修复：循环等待当前集合，并在每轮后复查 core `hasPendingSaves`，直至整条保存链自然归零；新增“等待开始后再加入保存”的回归测试。

### F3：原生 close dispatch 失败没有前端重试入口

host 已正确 rollback permit，但 clean 分支没有 modal；用户无法重新提交同一个 pending request。

修复：clean/saved/discarded resolve 失败时保留原 requestId 和 disposition，显示“重试关闭 / 取消”；重试不改变原处置语义。close modal 存在时同时屏蔽 New/Open/Save 等全局文件快捷键，避免在互斥决策面背后制造新竞态。

附带补齐 `FILE_IO_ERROR`/只读保存失败保持窗口的 App 集成测试。

## 自动化复验

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @mindmap/platform test` | PASS：3 files / 32 tests |
| close/file 专项 | PASS：3 files / 40 tests |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS：45 tests |
| `cargo clippy ... -- -D warnings` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:unit` | PASS：26 files / 256 tests |
| `pnpm quality` | PASS：全部现有阶段通过 |
| 最新 `tauri build --debug` | PASS：`.app` 与 `.dmg` 均生成 |
| changed-scope Rustfmt / Prettier | PASS |
| `git diff --check` | PASS |

全 crate `cargo fmt --check` 仍会列出多个本卡未触及的既有 Rust 格式基线；本轮使用 `skip_children=true` 对 MRT-003 变更 Rust 文件逐一检查并通过，没有扩张格式债务。

`quality-negative-drift` 的内部 FAIL 文本是负向门禁夹具，外层 Vitest 与 quality 均为 PASS。

## 原生证据审计

已有 `.omx/reviews/2026-08-30-mrt-003-macos-e2e.json`：

- 自动化 PASS：E2E-CL1 clean、CL2 Cancel、CL3 Discard、CL4 重复关闭、CL5 ⌘Q。
- 明确未覆盖：Save As 面板成功/取消、ordinary Save、外部冲突、IO/只读。
- evidence 生成时间晚于 bundle，但被测 bundle 的构建时间早于最终 `mindmap-app.tsx` 修改时间，无法绑定最终工作区。
- `overall: PASS` 只表示自动化子集，不应被解释为 MRT-003 完成定义整体 PASS。

审查期间已经重新构建最新 debug bundle；因 Mac 锁屏，`computer-use` 无法进入 UI，未伪造补验结果。

## 解锁决定

- MRT-003V：READY，唯一下一步。
- MRT-004：LOCKED，等待 MRT-003V。
- UXD-001 前端体验定义：可并行启动，因为它只产出设计规格和原型，不修改生产 UI。
