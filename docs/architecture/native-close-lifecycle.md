# 原生关闭生命周期（MRT-003 / CR-003）

描述 2026-08-30 落地的 native dirty-close 三分支协议的实际数据流、状态与平台
差异。触发背景：v0.1.3 审查发现原生关闭只依赖浏览器 `beforeunload`（不能等待
异步保存、不构成数据安全边界），⌘Q 则完全绕过所有保护直接终止进程。

## 总览

```text
OS 关闭源（红按钮 / ⌘W / ⌘Q / Dock 退出）
  → Rust host（唯一关闭权持有者）
     WindowEvent::CloseRequested
       ├─ 有一致性 permit → 消费放行（discarded 先 revoke 窗口 capability）
       └─ 无 permit → prevent_close
            → CloseRequestStore 建立/复用 per-window pending requestId
            → 定向 emit platform://close-requested（复用不重发）
  → 前端（App 三分支控制器，经类型化 CloseLifecyclePort）
     ├─ clean 且无 pending save → 自动应答 clean（不弹 modal）
     ├─ pending save → 受控等待态（Save/Discard 禁用，Cancel 可用；
     │    await whenSavesSettled 持续吸收等待期间新增的保存请求，
     │    直至整条保存链自然终态；不轮询不超时）
     └─ dirty → 三分支 modal：保存… / 不保存 / 取消
  → invoke platform_resolve_close_request(requestId, disposition)
     host 校验调用者窗口（Tauri 注入的 WebviewWindow，拒绝自报 label）
       ├─ cancelled → 清 pending，窗口保持（零副作用）
       └─ clean/saved/discarded → 写一次性 permit → window.close()
            第二次 CloseRequested 消费 permit → 真正关闭
            close 失败 → rollback：撤 permit、恢复 pending（可重试）
            前端保留 requestId/disposition，显示“重试关闭 / 取消”
  → Destroyed：幂等 revoke 窗口 capability + 清 store 状态
```

## 组件与职责

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| `CloseRequestStore` | `apps/desktop/src-tauri/src/lifecycle/close.rs` | 纯状态机：per-window pending、requestId 复用、permit 单次消费、rollback、Destroyed 幂等清理、退出集合协调。Mutex<HashMap>，统一锁序 pending→permits，不依赖 tauri 类型（cargo test 直接覆盖） |
| host 接线 | `apps/desktop/src-tauri/src/lib.rs` | `CloseRequested`/`Destroyed` 事件处理；discarded 放行前 `revoke_window`；自定义 Quit 菜单（见平台差异）；`ExitRequested` 逐窗协调 |
| IPC | `apps/desktop/src-tauri/src/ipc/mod.rs` + `packages/platform/src/ipc/types.ts` | `platform_pending_close_request`（快照）、`platform_resolve_close_request`（应答）、`platform://close-requested`（定向事件）、稳定错误码 `INVALID_CLOSE_REQUEST` / `WINDOW_CLOSE_FAILED` |
| `CloseRequestGate` | `packages/platform/src/lifecycle/close-protocol.ts` | 订阅先于快照（listener 竞态补偿）、event/snapshot 双源按 requestId 去重、IPC 拒绝→`PlatformError` 映射 |
| `TauriCloseLifecycleAdapter` | `packages/platform/src/lifecycle/tauri-close-adapter.ts` | listen/invoke 传输接线（无独立状态） |
| App 三分支控制器 | `apps/desktop/src/app/mindmap-app.tsx` | clean 自动放行 / awaiting-save 受控等待 / dirty 三分支 modal；Save 复用 `saveFlow` 并在 `ok` 后复查 `isDirty && hasPendingSaves` 才应答 saved |
| in-flight 保存追踪 | `apps/desktop/src/app/file-commands.ts` | `saveFlow`/`saveAsFlow` 入口 trackSave；`whenSavesSettled(session)` 循环等待当前集合并复查 core pending，覆盖等待期间新增的保存请求 |

## 关键不变量

1. host 掌握最终关闭权：无 permit 的 `CloseRequested` 一律 `prevent_close`。
2. 每窗最多一个活动请求：重复关闭复用同 requestId（`newly_created=false`
   → 不重发事件、不叠 modal）。
3. response 单次消费：伪造/跨窗/过期/重放 → `INVALID_CLOSE_REQUEST`，窗口保持。
4. permit 一次性：只放行紧接着的一次原生 close；`window.close()` 失败回滚
   permit 并恢复同 requestId 的 pending。
5. Cancel 零副作用：不写盘、不 revoke、dirty 不变。
6. Discard 不写盘：host 在真正放行前撤销该窗口全部文件 capability。
7. pending save 时不允许直接 Discard：前端等待保存链自然终态（MRT-001 语义）。
8. 事件不丢：前端"先订阅，后读快照"，双达去重。
9. resolve 失败不丢流程：clean/saved/discarded 保留原 disposition 供显式重试；
   Cancel 未获 host ack 时保留 modal，不能把 pending request 变成无入口状态。
10. close modal 存在时屏蔽 New/Open/Save 等全局文件快捷键，避免在决策面背后
    新建文档或扩张保存队列。

## 应用退出（⌘Q）

逐窗协调：`RunEvent::ExitRequested` → `CloseRequestStore::on_exit_requested(labels)`
→ 任一窗口无 permit 即 `prevent_exit` 并为无请求窗口建立/复用 close request；
全部窗口许可后放行。最后一个窗口 Destroyed 后的自然 ExitRequested（labels 为
空）直接 Allow。

## 平台差异（macOS 实测，2026-08-30）

- **⌘Q 必须替换默认菜单**：Tauri 2 macOS 默认菜单的 Quit 是 AppKit 预定义项，
  直接 terminate 进程，`CloseRequested`/`ExitRequested` 均不触发（dirty 文档被
  无提示杀死）。已改为自定义 Quit 菜单项（保留 About/Services/Hide 与 Edit
  预定义项），菜单事件逐窗 `window.close()` 走同一关闭协议。Windows 移植时
  `CmdOrCtrl+Q` 同样生效（R-013 范围，未实测）。
- **对话框命令必须 async**：`platform_open_document` /
  `platform_request_target_authorization` 原为同步命令（Tauri 2 同步命令在主
  线程执行），`blocking_pick_file`/`blocking_save_file` 在主线程与面板 run loop
  互相等待死锁——真实 app 的文件对话框自 MM-060 起从未打开（jsdom/browser-dev
  fake port 掩盖）。改为 async command 后在真实 app 首次可用。
- **State 注入类型必须与 managed 确切类型一致**：`manage(Arc<FileLifecycleService>)`
  对 `State<FileLifecycleService>` 报 "state not managed"——真实 app 的文件
  命令注入从未成功（同样被死锁掩盖），已统一为 `State<Arc<…>>`。
- **系统 Save/Open 面板跑在 XPC 服务**
  （`com.apple.appkit.xpc.openAndSavePanelService`），System Events 无法操作
  其按钮——面板内交互（输入文件名/存储/取消）属人工矩阵，不以自动化冒充
  （MM-090 同类边界）。
- **React Flow 节点在 WKWebView AX 树懒暴露**：E2E 的 dirty 断言使用状态指示
  的 AX value（"未保存 · 桌面"），不依赖节点元素。

## 验证索引

- Rust 状态机：`cargo test`（close::tests 14 项：R1–R5、X2、cancel/discard
  语义、rollback、destroy 幂等）。
- 协议协调器：`packages/platform/src/lifecycle/close-protocol.test.ts`（9 项：
  订阅先于快照、双达去重、错误映射）。
- App 三分支：`apps/desktop/src/app/close-lifecycle.test.tsx`（16 项：C1、R2、
  R4、S1–S5、D1、D2×2、X1、resolve 失败重试与 modal 快捷键隔离）。
- 真实 macOS：`tests/e2e/macos/`（E2E-CL1…CL5 + 既有 E2E-01A/16 回归），
  证据 `.omx/reviews/2026-08-30-mrt-003-macos-e2e.json`。
- 人工矩阵（系统面板内交互，待执行）：S1 存储→saved 关窗、S2 面板取消→
  modal 保持、S4 外部修改冲突保持、S5 保存期间再编辑保持。
