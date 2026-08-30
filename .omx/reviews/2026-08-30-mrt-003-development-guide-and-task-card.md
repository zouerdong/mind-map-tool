# MRT-003 开发指导与任务卡

## 1. 任务定位

**优先级：P0**  
**状态：READY**  
**前置：MRT-001、MRT-001A、MRT-002 已验收通过**  
**后续：本卡验收通过后才解锁 MRT-004**

本卡解决关闭数据安全：用户点击系统关闭按钮、按平台关闭快捷键或触发应用退出时，都必须先经过同一套 host 主导的关闭协议。dirty 文档提供“保存 / 不保存 / 取消”三分支；保存取消、冲突、只读或 IO 失败时窗口必须继续存在。

MRT-003 不实现多窗口创建和文件路由，那属于 MRT-004；但关闭协议和 host 状态必须按 `window.label()` 隔离，不能写死 `main`，否则下一卡只能推倒重来。

## 2. 当前缺口与根因

- `apps/desktop/src-tauri/src/lib.rs` 的 `on_window_event` 只处理 `Destroyed` 和 `Focused`，没有处理 `WindowEvent::CloseRequested`。
- `apps/desktop/src/app/mindmap-app.tsx` 只有浏览器 `beforeunload`。它不能作为 Tauri 原生关闭的数据安全边界，也无法等待异步保存。
- New/Open 的 dirty 确认是二分支流程，不能直接复用为原生关闭的三分支。
- 当前没有 close request id、重复请求去重、host 一次性放行或 response replay 防护。
- 当前没有“关闭请求早于前端 listener 安装”时的快照补偿；单发事件可能永久丢失。

根因不是缺一个弹窗，而是缺少跨 Rust host 与 WebView 的、可关联且 fail-closed 的关闭状态机。

## 3. 本卡必须维持的不变量

1. **Host 掌握最终关闭权**：未经有效 close response，`CloseRequested` 一律 `prevent_close()`。
2. **按窗口隔离**：pending request、一次性放行和 capability 撤销均以真实 `window.label()` 为键。
3. **每窗最多一个活动请求**：重复点击关闭只复用当前 request，不重复发事件或显示多个对话框。
4. **response 单次消费**：request id 必须匹配当前窗口和当前 pending；伪造、跨窗、过期、重复 response 一律拒绝。
5. **一次性放行**：前端同意后，host 只放行紧接着的一次原生 close；放行标志不能永久残留。
6. **保存成功才关闭**：Save 分支必须等待 MRT-001 的完整保存链终态，并在关闭前重新确认 session clean。
7. **失败保持能力**：Save As 取消、外部修改冲突、只读、IO 失败均保留窗口、文档和该窗口的文件 capability。
8. **Discard 不写盘**：不得为“不保存”调用 save/commit；host 在真正放行关闭前撤销该窗口 ledger/capability。
9. **Cancel 零副作用**：只结束本次 close request；不写盘、不改 dirty、不撤销 capability、不关闭窗口。
10. **事件不丢**：listener 使用“先订阅，后读取 pending snapshot”，并按 request id 去重。
11. **保存竞态 fail closed**：已有 pending save 时不得直接 Discard 关闭；至少等待保存链自然终态后再允许用户决定。
12. **前端失联时不关闭**：WebView 未响应或协议错误时保持窗口，不能用 timeout 模拟用户同意。

## 4. 采用的协议

本卡是在 Accepted ADR 0001（Tauri 2 host）和既有 MRT-003 产品约束内补齐生命周期协议，不改变桌面框架、数据格式或平台范围。若实现者需要改为 frontend 直接调用原生 `destroy()`、引入新运行时依赖、扩大 Tauri capability 或改变应用退出语义，必须先提交 ADR/授权，不得自行偏离。

### 4.1 Rust host 状态

新增最小、独立、可纯测试的 close lifecycle 模块，例如：

```text
apps/desktop/src-tauri/src/lifecycle/close.rs
```

建议由 `CloseRequestStore` 管理：

- `pending_by_window: windowLabel -> requestId`
- `permit_once_by_window: windowLabel -> { requestId, disposition }`
- application-exit coordination 所需的最小 per-window 状态

`disposition` 至少区分：

- `clean`：无 dirty，放行；capability 在 `Destroyed` 时撤销。
- `saved`：真实保存成功且 session 已 clean，放行；capability 在 `Destroyed` 时撤销。
- `discarded`：不写盘，在第二次 `CloseRequested` 真正放行前撤销 capability。

不要把完整文档、路径、保存内容或前端声称的 window id 放进该 store。

### 4.2 原生关闭握手

推荐时序：

```text
OS close
  -> Rust CloseRequested
  -> 若存在匹配的一次性 permit：消费 permit，必要时 revoke，放行
  -> 否则 prevent_close
  -> 建立或复用 pending requestId
  -> 定向 emit platform://close-requested
  -> 前端完成 clean / Save / Discard / Cancel 判断
  -> invoke platform_resolve_close_request(requestId, disposition)
  -> Rust 校验调用者窗口 + requestId
  -> Cancel：清 pending，返回，不 close
  -> 其他：写入一次性 permit，调用 window.close()
  -> 第二次 CloseRequested 消费 permit并真正关闭
  -> Destroyed 再做幂等 revoke 与状态清理
```

必须使用调用命令时由 Tauri 注入的 `WebviewWindow` 确认调用者身份，禁止接收前端自报的 `windowLabel` 作为授权依据。

事件必须用目标 window 定向发送，不得用 app 全局广播让其他窗口收到同一关闭请求。

如果 `window.close()` 返回错误，host 必须回滚一次性 permit，并保留或恢复 pending request，使窗口仍可重试；不得留下下次关闭无条件放行的残余状态。

### 4.3 防止 listener 竞态

新增只读命令，例如 `platform_pending_close_request`。前端 adapter：

1. 先注册 `platform://close-requested` listener。
2. 再读取当前调用窗口的 pending close snapshot。
3. event 与 snapshot 统一进入同一入口。
4. 以 `requestId` 去重。

这样覆盖“host 已建立请求，但 WebView listener 尚未安装”的窗口。不要用延时重发事件解决。

### 4.4 前端三分支控制器

把 close 生命周期封装成 platform port/adapter，避免 `MindMapApp` 直接散落 `invoke/listen` 字符串。browser-dev 使用不会触发原生关闭的 fake port，集成测试使用可驱动 request 的 fake。

收到请求后：

- session clean 且 `hasPendingSaves === false`：不显示 modal，直接回 `clean`。
- dirty：显示 Save / Discard / Cancel。
- `hasPendingSaves === true`：显示“保存进行中”的受控状态；Cancel 仍可取消本次关闭；Discard 暂不可执行，直到现有保存链终态。不得销毁仍可能提交文件的窗口。

Save 分支必须调用既有 `saveFlow(session, deps)`，不能复制一套提交逻辑：

1. 锁定当前 close request 的按钮，防止重复提交。
2. await `saveFlow` 的真实结果。
3. Save As 被用户取消：保持 modal 和窗口。
4. conflict/readonly/IO error：显示既有稳定错误，保持 modal 和窗口。
5. `ok` 后重新检查 `session.isDirty` 和 `session.hasPendingSaves`；只有 clean 且无 pending 才回 `saved`。
6. 保存期间若又产生编辑，继续保留 modal，提示用户再次保存或选择其他分支。

Discard 分支只回 `discarded`，不调用 `FilePort`。Cancel 只回 `cancelled`；收到 host 成功 ack 后再清前端 modal。

### 4.5 应用退出

应用级退出不能绕过窗口协议。Rust 侧需要处理相应的 app exit event：

- 有受管理窗口尚未取得关闭许可时阻止退出。
- 为每个窗口建立/复用自己的 close request。
- 任一窗口 Cancel 或保存失败，整次应用退出保持阻止。
- 只有全部窗口均已完成允许关闭，才使用一次性 application-exit permit 完成退出。

当前只有一个实际编辑窗口也必须按集合实现和测试 store；MRT-004 只负责创建/路由更多窗口，不应重写关闭安全模型。

## 5. IPC 契约建议

在 `packages/platform/src/ipc/types.ts` 与 Rust IPC 同步增加：

- event：`platform://close-requested`
- query：`platform_pending_close_request`
- response：`platform_resolve_close_request`
- payload：`{ requestId: string }`
- disposition：`clean | saved | discarded | cancelled`

新增稳定错误码时至少区分：

- `INVALID_CLOSE_REQUEST`：不存在、跨窗口、过期或已消费。
- `WINDOW_CLOSE_FAILED`：host 无法发起第二次 close。

命名可以在实现中作局部调整，但 TS/Rust 必须一一对应，有 contract test，且错误不能退化为任意字符串判断。

不建议开放 frontend `window.destroy()` 或扩大 `core:window` 权限。正常关闭应只通过自定义、校验调用者身份的 IPC 完成。

## 6. 允许修改范围

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/lifecycle/`（新增最小 close lifecycle 模块）
- `apps/desktop/src-tauri/src/ipc/` 的 close 命令与测试
- `apps/desktop/src/app/mindmap-app.tsx`
- `apps/desktop/src/app/ports.ts`
- `apps/desktop/src/app/file-commands.ts`，仅在复用/暴露既有保存终态确有必要时
- `packages/platform/src/lifecycle/` 的 port、Tauri adapter 与单元测试
- `packages/platform/src/ipc/types.ts`
- close modal 所需的最小 `packages/ui/` 组件及测试
- `tests/e2e/macos/` 的真实关闭用例
- 实现完成后新增 `docs/architecture/native-close-lifecycle.md` 描述当前事实
- 本卡验收/证据文档

禁止修改：

- MRT-001/001A 的保存语义、排队 owner、pending-save gate。
- MRT-002 的 identity/dirty 契约。
- canonical 文件格式、schema、导出格式、画布操作面。
- launch intent ack、多窗口创建、同文件聚焦；这些属于 MRT-004。
- Tauri capability、CI/CD、生产/发布配置，除非先取得项目负责人明确授权。
- 用 browser `beforeunload`、同步 `confirm()` 或 frontend `destroy()` 代替原生协议。
- 引入新的运行时依赖；request id 可由现有能力或无依赖的 host 方案生成。

## 7. 分步任务卡

### MRT-003A：先写失败测试与协议骨架

目标：在不改变真实关闭行为前，让缺口稳定变红。

- 为 `CloseRequestStore` 写纯 Rust 状态机测试。
- 为 platform adapter 写 subscribe-first、snapshot、dedupe、response 映射测试。
- 为 App 写 fake CloseLifecyclePort 集成测试，先覆盖 clean、dirty 与重复 request。
- 记录红灯输出；禁止先实现再补一批只会通过的测试。

完成条件：测试明确因“无 CloseRequested/无三分支/无 correlation”失败，而不是夹具错误。

### MRT-003B：实现 Rust host fail-closed 状态机

目标：任何未授权关闭都被阻止，且 request/permit 可证明单次消费。

- 接管 `WindowEvent::CloseRequested`。
- 实现 per-window pending、dedupe、permit once、rollback、destroy cleanup。
- 增加 pending snapshot 与 resolve IPC。
- Discard 在真正放行前撤销窗口 ledger；Destroyed 保持幂等兜底。
- 增加 application exit 阻止与集合协调。

完成条件：纯 Rust 测试覆盖状态转换；未接前端时关闭请求只会保持窗口，不会误关。

### MRT-003C：实现 platform port 与 App 三分支

目标：UI 只通过类型化 port 参与协议，保存分支复用真实 saveFlow。

- port/adapter 完成订阅、snapshot 与 id 去重。
- App 收到 clean 请求自动放行。
- dirty modal 实现 Save / Discard / Cancel。
- Save 的 cancel/conflict/readonly/IO error 均保持窗口。
- 处理 saving phase、重复点击和保存期间再次编辑。
- 不破坏 New/Open 已有二分支行为。

完成条件：App 集成测试能证明每个分支的端口调用次数、FilePort 写次数、dirty 与 modal 状态。

### MRT-003D：真实 macOS 验证与架构同步

目标：用真实 Tauri 窗口证明 jsdom 无法证明的 native close 行为。

- 构建并启动真实 macOS 应用。
- 逐项执行本卡 E2E/人工矩阵。
- 能自动化的用例进入 `tests/e2e/macos/`；系统对话框等无法稳定自动化的步骤记录人工证据，不得伪造成自动化 PASS。
- 新增 `docs/architecture/native-close-lifecycle.md`，只描述实际落地的数据流、状态与平台差异。

完成条件：真实窗口三分支证据完整，且与 Rust/TS 自动化结果一致。

## 8. 必测矩阵

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| R1 | 首次 native close | 被阻止；建立一个 requestId；只发一个流程 |
| R2 | pending 时重复 close | 复用同一 requestId；不叠 modal、不多次 resolve |
| R3 | response replay/伪造/跨窗口 | `INVALID_CLOSE_REQUEST`；窗口不关闭 |
| R4 | host `window.close()` 失败 | permit 回滚；pending 可重试；窗口不关闭 |
| R5 | Destroyed cleanup | pending/permit 清理；ledger revoke 幂等 |
| A1 | listener 前已有 request | snapshot 补回；event/snapshot 双达只处理一次 |
| C1 | clean 文档关闭 | 不显示 modal；一次 resolve 后真实关闭 |
| S1 | dirty 未命名 Save | Save As 成功、session clean、随后关闭 |
| S2 | dirty 未命名 Save As cancel | 不关闭；dirty、capability 和 modal 可继续操作 |
| S3 | dirty 已命名 Save success | commit 一次，成功回执后关闭 |
| S4 | conflict/readonly/IO fail | 显示稳定错误；不 resolve allow；窗口保持 |
| S5 | 保存期间再次编辑 | 保存回执不误清 dirty；窗口保持，允许再次决定 |
| D1 | Discard | FilePort 零写入；host revoke 后关闭 |
| D2 | pending save 时 Discard | 不直接执行；等待链终态，不造成后台落盘竞态 |
| X1 | Cancel | 零写盘、零 revoke、dirty 不变、窗口保持 |
| X2 | 应用退出 | 每窗独立 request；任一 Cancel/失败阻止整次退出 |
| X3 | browser beforeunload 回归 | 可保留为 dev fallback，但不影响 Tauri 协议 |

每项测试都要断言调用次数和最终状态，不能只检查文案或函数返回值。

## 9. 实现风险与停止条件

- 若 Tauri `RunEvent::ExitRequested` 与窗口 `CloseRequested` 的真实顺序和假设不一致，先用最小日志/测试确认事件序列，再调整 store；不要通过同时无条件放行两个事件碰碰运气。
- 若必须修改 capability 配置、`tauri.conf.json`、CI/CD 或发布配置，命中项目红线，停止并请求项目负责人授权。
- 若现有保存 API 无法让关闭控制器观察 pending save 的自然终态，先提交最小接口方案；不得复制保存状态机或用轮询/timeout 猜测完成。
- 若 app exit 在当前 Tauri 版本无法可靠逐窗协调，提交复现证据和 ADR 提案；不得只保护关闭按钮却宣称应用退出通过。
- 不得把 MRT-004 的 window registry、launch ack 或新窗口创建夹带进本卡。

## 10. 验收命令

先执行专项：

```bash
pnpm --filter @mindmap/platform test
pnpm exec vitest run apps/desktop/src/app/app-integration.test.tsx apps/desktop/src/app/file-commands.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

再执行完整检查：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm quality
pnpm build
pnpm exec prettier --check <本卡全部变更的 TS/TSX/JSON/MD 文件>
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
git diff --check
git status --short
```

最后执行真实 macOS 三分支。至少记录：应用版本/commit、macOS 与架构、启动方式、测试文件类型、逐步操作、每分支实际结果、退出码或截图/日志位置。jsdom、fake port 和浏览器 `beforeunload` 不能替代该证据。

全仓格式仍有既知历史基线时，只检查本卡变更范围并明确列出，禁止顺手格式化无关文件。

## 11. 完成定义

- Rust host 对 native close 默认 fail closed。
- R1～R5、A1、C1、S1～S5、D1～D2、X1～X3 均有自动化或明确真实平台证据。
- clean、Save 成功、Discard 能真实关闭；Cancel 与全部保存失败能真实保持窗口。
- 重复请求、stale response、close dispatch failure 不产生永久 permit。
- Discard 零写盘且在放行前撤销窗口 capability。
- 应用退出不绕过每窗口决策。
- platform IPC 有稳定类型、错误码和 contract tests。
- `docs/architecture/native-close-lifecycle.md` 与实际实现一致。
- 专项、Rust、TS、quality、build、changed-scope format、diff check 全部通过。
- 未修改 MRT-004+ 范围、配置红线或现有产品契约。

## 12. Agent 回报格式

1. 旧行为失败测试与失败输出。
2. Rust host 状态机和完整事件时序。
3. 修改文件清单及每个文件职责。
4. R1～R5、A1、C1、S1～S5、D1～D2、X1～X3 的测试映射。
5. Save/Discard/Cancel 各自的 FilePort、ledger、dirty、窗口最终状态。
6. 重复请求、snapshot 竞态、response replay、close failure 的处置证据。
7. 专项与完整命令原始结果。
8. 真实 macOS 证据索引；明确哪些是自动化、哪些是人工。
9. `git diff --check` 与 `git status --short`。
10. 声明未修改保存/identity 契约、MRT-004、capability/CI/CD/发布配置；若有例外必须附项目负责人授权。

## 13. 解锁规则

只有审查者复验 Rust 状态机、前端三分支以及真实 macOS native close 全部通过，MRT-003 才能转 ACCEPTED 并解锁 MRT-004。仅有 modal 截图、unit test 或 `beforeunload` 行为都不构成验收通过。
