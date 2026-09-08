# PRR-065 实现报告：零画布顶栏与 macOS 原生命令承载

日期：2026-09-08  
任务卡：PRR-065（`docs/planning/pre-release-remediation-task-cards-2026-09-07.md` §PRR-065）  
Base：`main@89d7c76` + working-tree PRR-065 planning patch（已纳入本 commit）  
ADR：`docs/decisions/0012-zero-chrome-canvas-command-surface.md`（Accepted）

## 1. 交付概览

- 生产 WebView 内容区零常驻 chrome：`MindMapApp` 不再渲染 `AppHeader`（40px 顶栏），`EditorCanvas` 直接占满原生标题栏以下内容区。`app-header.tsx` 保留（无删除授权），登记为清理债务。
- 命令全部迁移 macOS 原生应用菜单（Mind Map / 文件 / 编辑 predefined / 视图 / 帮助），稳定 menu item id。
- 单一 typed command dispatcher（`AppCommandId` 13 命令 + host-owned 3 命令），菜单事件/快捷键/既有回调共用。
- exactly-once：Tauri 生产 keydown 不派发应用级快捷键（菜单 accelerator 唯一源）；浏览器 dev keydown 派发。
- onboarding explicit-only：not-started / in-progress 均不在启动时自动出示；帮助菜单/⌘⇧H 显式打开（未开始显示 welcome，其余状态从第一步进入），偏好损坏警告仍由已挂载流程消费并可见上报。
- 菜单 check 状态（主题/布局）per-window 缓存，聚焦切换刷新 app-wide 菜单。

## 2. 逐文件变更

| 文件 | 变更 |
| --- | --- |
| `docs/decisions/0012-zero-chrome-canvas-command-surface.md` | 新增（Accepted ADR） |
| `docs/product/v1-product-spec.md` | §7.2 首启不自动出示引导（显式入口）；重放措辞 |
| `docs/product/visual-state-tokens-2026-09-06.md` | shell token 用途注释更新（无 WebView 顶栏） |
| `docs/architecture/visual-motion-architecture.md` | §1.4 AppHeader 段替换为零 Chrome 原生菜单承载 |
| `apps/desktop/src/app/app-commands.ts` | 新增：AppCommandId/dispatcher/exactly-once 分工/快捷键映射/菜单事件桥接 |
| `apps/desktop/src/app/app-commands.test.ts` | 8 测试：命令派发恰好一次、host-owned 泄漏 fail-closed、映射稳定、桥接卸载与监听失败可见上报 |
| `apps/desktop/src/app/zero-chrome-surface.test.tsx` | 7 测试：零 chrome、not-started/in-progress 启动无 onboarding、显式打开/重放、主题 no-op、保存与 title dirty 语义 |
| `apps/desktop/src/app/mindmap-app.tsx` | 移除 AppHeader 渲染；commandHandlers/dispatchCommand；keydown 走 dispatcher（生产不派发）；app-command webview 定向桥接（动态 import 不占 entry 预算）；监听失败可见上报；菜单状态同步 effect；onboarding 恢复但启动不呈现；浏览器 dev-only `__mmDispatchAppCommand` 测试通道 |
| `apps/desktop/src/app/app-header.tsx` | 未改动（解除生产引用；无删除授权，清理债务登记于 §7） |
| `apps/desktop/src/app/keyboard.ts` | 未改动（单一事实源保持） |
| `apps/desktop/src/app/shortcut-table.md` | 新增命令承载节 + host-only accelerator 表（⌘Q/⇧⌘N/⌘W） |
| `apps/desktop/src-tauri/src/menu/mod.rs` | 菜单构建（5 子菜单、稳定 id、CheckMenuItem）；命令分流（host-owned vs renderer 定向 emit + generation/存在性校验）；MenuState per-window 快照与销毁清理；accelerator 合同测试 |
| `apps/desktop/src-tauri/src/lib.rs` | 菜单迁移至 menu 模块；host-owned/renderer 分流；修正 CheckMenuItem 自动 toggle 后的权威状态恢复；Focused/Destroyed 维护菜单快照 |
| `apps/desktop/src-tauri/src/ipc/mod.rs` | `platform_sync_menu_state` 命令（serde camelCase，非法值 fail-closed） |
| `apps/desktop/src/app/{app-integration,close-lifecycle,font-geometry-barrier,organize.integration,global-shortcut,shortcut-pre-focus}.test.tsx` | 按钮驱动 → 快捷键/dispatcher 通道驱动；保存状态断言 → document.title（● 前缀） |
| `scripts/quality/scan-network-endpoints.mjs` | CSP 只精确排除 `localhost`、`127.0.0.1` 与 Tauri IPC `ipc.localhost`；不开放任意 `*.localhost` |
| `docs/planning/README.md`、任务卡 | PRR-065 状态（planning patch 保留并入 commit） |

## 3. 原生菜单命令矩阵

| 菜单 | 项（accelerator） | id | 执行面 |
| --- | --- | --- | --- |
| Mind Map | 关于 / 设置/全局热键… / Services / Hide… / 退出 ⌘Q | `app.shortcuts` / `app-quit` | renderer / host |
| 文件 | 新建 ⌘N / 打开 ⌘O / 保存 ⌘S / 另存为 ⇧⌘S / 导出 ⌘E / 新建窗口 ⇧⌘N / 关闭窗口 ⌘W | `file.*` / host | renderer / host |
| 编辑 | predefined undo/redo/cut/copy/paste/select_all | — | 系统原生（textarea 语义）；画布 ⌘Z/⌘A 不受影响 |
| 视图 | 适应画布 / 整理 ⇧⌘L / 横向 ✓ / 纵向 ✓ / 暖白 ✓ / 黑板 ✓ | `view.*` | renderer（check 状态 per-window） |
| 帮助 | 开始/重放引导 ⇧⌘H | `help.onboarding` | renderer |

定向与 exactly-once 实测（debug bundle，隔离 HOME）：菜单点击 → host `menu event` → 定向 `emit_to`（最近聚焦窗口 + generation 校验）→ renderer webview listener（`getCurrentWebviewWindow().listen`，只收本窗口事件）→ dispatcher 恰好一次 → `SetDocumentStyle dark` 生效（黑板主题截图）。

**关键技术发现**：tauri v2 中 `emit_to(EventTarget::WebviewWindow)` 的事件**不触发**普通全局 `listen()`——必须用 webview 定向 listener（文档 https://tauri.app 的 "Listen to Events from Any Webview" 节）。这保证了多窗口不串扰。

## 4. 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm quality`（20 阶段） | 17 PASS；`releasePerformance`/`evidence` FAIL 为无 manifest 的 fail-closed 设计（PRR-080 阶段），`assets` PASS |
| `pnpm test:unit` | PASS，50 files / 488 tests（独立审阅后复算） |
| desktop app 套件 | PASS，13 files / 85 tests |
| Rust `cargo fmt --check` / `test --locked` / `clippy --all-targets -D warnings` | PASS；207 tests（menu 模块 5：命令表/check 子集、未知 fail-closed、sync parse/check、predefined、accelerator 合同） |
| `pnpm test:a11y` | PASS，9 tests |
| `pnpm test:visual` | PASS，11 tests（golden 无需变更：视觉 harness 独立于 AppHeader；顶栏消失不触及 golden 断言） |
| `pnpm build` | PASS；**entry 485,449B ≤ 500,000B**（动态 import webviewWindow API 后保持在预算内） |
| 网络/许可/边界门 | PASS（network scanner 仅精确允许 `ipc.localhost` 等三个本机 host；107 files / 0 endpoints） |
| 原生视觉证据 | 暖白/黑板两主题 1080×864 等效截图（`.tmp/prr-065-evidence-{warm,dark}.png`）：原生标题栏下直接画布、零 WebView chrome、说明文字保留 |
| AX 树 | `toolbars=0, buttons=0, staticTexts=0`（窗口无 WebView 工具条/按钮） |
| onboarding | jsdom：not-started 无 overlay；⌘⇧H 打开+跳过写入 `onboardingStatus: skipped` |

## 5. 已知工程注意事项

**WKWebView 资产缓存**：debug 迭代中 WebView 可能缓存旧嵌入页面（同 URL index.html），导致"改动不生效"假象。验证 UI 改动须用隔离 `HOME`（本轮诊断即为此消耗大量时间）。生产候选为全新二进制+全新安装，不受影响；此经验已登记供 PRR-070 复用。

## 6. NotRun

- 原生菜单的 VoiceOver 逐项朗读与鼠标/键盘三方式全项巡检：归属 PRR-070 原生矩阵（本轮以 osascript 菜单点击 + AX 树验证核心链路）。
- 多窗口（第二窗口）定向与 check 隔离的原生实测：Rust 单测覆盖 per-window 快照/聚焦切换纯逻辑；多窗口原生 e2e 归属 PRR-070（PRR-065 卡：完成后 PRR-070 从新 clean commit 全量重做）。
- PRR-070 候选构建/冻结/G-FINAL/PRR-080：按负责人指令未开始。

## 7. 独立审阅修复（2026-09-08）

独立审阅结论为 `ACCEPT_AFTER_SMALL_FIXES`，已关闭以下实现问题：

1. 原生导出/关闭窗口 accelerator 从错误的 `⇧⌘E`/`⇧⌘W` 修正为权威表的 `⌘E`/标准 `⌘W`，Rust 合同测试锁定。
2. `in-progress` 偏好不再在启动时自动遮挡画布；流程始终挂载以消费偏好损坏警告，但所有启动状态均隐藏，只有 Help/`⌘⇧H` 显式打开。
3. `window.__mmDispatchAppCommand` 收敛为 browser-dev only；原生 listener 建立失败会显示错误，卸载后的迟到失败不会更新 UI。
4. 窗口 Destroyed 会清理 `MenuState.per_window`；macOS/muda 自动 toggle CheckMenuItem 后立即恢复当前窗口权威快照，避免重复点当前主题/布局留下无勾选态。
5. CSP scanner 从任意 `*.localhost` 宽豁免收窄为 `localhost`、`127.0.0.1`、`ipc.localhost` 精确集合。
6. 重复选择当前主题改为真正 no-op，避免 CheckMenuItem 当前项被再次点击时产生虚假 dirty 标记。

独立复算：format/typecheck/lint、50 files / 488 TS tests、207 Rust tests、a11y 9、visual 11、build、network/license/boundaries 与 Rust clippy 全部返回 0；initial entry 485,449B。

## 8. 残余风险与清理债务

1. `app-header.tsx`（453 行）成为无生产引用的遗留文件——**清理债务**（需删除授权）；其测试引用已随本卡迁移。
2. 编辑菜单 predefined 项在画布态/textarea/IME 的真实 WKWebView responder 行为，以及鼠标菜单与 accelerator exactly-once，必须由 PRR-070 完整原生矩阵关闭。
3. 多窗口菜单定向、check state 隔离、VoiceOver 逐项朗读仍属于候选级原生验收，不可由本报告的单元/AX 抽测代替。

## 9. 红线确认

- 未删除/重命名任何文件（含 `app-header.tsx`、历史截图、旧候选）。
- 未隐藏 macOS 系统菜单栏、原生标题栏或 React Flow attribution。
- 未新增依赖、未修改预算/签名/公证/push/上传/发布。
- 未构建或冻结 PRR-070 候选；未申请 G-FINAL；未开始 PRR-080。
- 旧 PRR-070 试跑候选（caf1c20 等）与性能数据**不可复用**（PRR-070 须从本 commit 之后的新 clean source commit 重做）。
