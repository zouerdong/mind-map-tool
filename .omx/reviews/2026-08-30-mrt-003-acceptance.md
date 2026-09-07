# MRT-003 验收报告

## 结论

**MRT-003 代码实现与总体验收：ACCEPTED。MRT-003V 已补齐原生证据。**

Rust host、IPC、platform adapter 和 App 三分支的实现方向正确，自动化门禁全部通过。审查中发现的三个局部状态机缺口已现场修复并补测试，没有需要退回的大型代码问题。

MRT-003V 已用同一真实 debug bundle 完成 V1～V7：中文与空格路径 Save As、系统面板取消、ordinary Save、外部改写冲突、只读目录 I/O 失败、Discard 和 Cancel，且逐项保留窗口状态、文件 hash 与截图。自动化子集 7/7、V1～V7 7/7，`automationStatus`、`manualNativeStatus` 与 `overall` 均为 PASS。

MRT-004 的证据前置条件已经解除；当前只剩 ADR 0008 的负责人批准 Gate，未批准前不得进入多窗口生产实现。

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
| 原生 Save 三分支 | PASS（MRT-003V） | 真实 NSSavePanel V1～V7，含成功、取消、冲突与 I/O 失败 |

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
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS：46 tests（含 IPC camelCase 回归） |
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

最终证据见 `.omx/reviews/2026-08-30-mrt-003v-native-evidence.json`：

- 自动化 PASS：E2E-01A、E2E-16、E2E-CL1～CL5。
- 人工原生矩阵 PASS：V1～V7；全部操作真实系统面板和真实 bundle，未使用 fake/jsdom 冒充。
- 被测 executable SHA-256 为 `6b40410433238dd5c9e9ed0e318c4c0f1975ff2dc1f3cb5370c52332425f78e6`；前端主资源 SHA-256 为 `2192a6509f9cb46f49cc3390f6024364ab8f4abfdc4183028794f340655d237e`。
- source 在 evidence 时为 `d57d9b9 + dirty`，随后完整落入 `v0.1.4 / 8394f10`；审查复核了各生产源文件时间、bundle hash、提交内容与现存原始夹具。
- evidence 中“最新源码时间”原漏算 15:12:54 的 Rust serde 修复，已现场更正；bundle 仍晚于该修复，不影响 V1～V7 结论。

## 解锁决定

- MRT-003V：COMPLETE / ACCEPTED。
- MRT-004：DECISION-GATE，等待负责人批准 ADR 0008。
- UXD-001 前端体验定义：可并行启动，因为它只产出设计规格和原型，不修改生产 UI。
