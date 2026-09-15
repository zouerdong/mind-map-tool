# ADR 0012: 零 WebView Chrome 画布与 macOS 原生命令承载

- Status: Accepted
- ADR-Version: 1.2.0
- Date: 2026-09-08（v1.1.0 修订 2026-09-13；v1.2.0 修订 2026-09-14；v1.3.0 修订 2026-09-15）
- Owners: ErDong Zou（产品决定）/ 执行 Agent（工程实现）
- 任务来源: PRR-065（[from-user 2026-09-08]："用户一打开这个程序，就是一张全干净的画布。看不到任何菜单。"）
- 修订来源: DFR-030（[from-user 2026-09-13]：负责人批准 [首次试用修复开发指南](../planning/dogfood-repair-development-guide-2026-09-13.md) §3 轻量界面方案——空白画布底部创建提示、≥2 节点浮动整理按钮、选中工具条靠近节点）；v1.2.0：OFR-2026-09-14（负责人第二次实用反馈——编辑菜单撤销/重做改为自定义 renderer 命令 ⌘Z/⇧⌘Z；首次使用启动自动出示引导 welcome，见 PRD §7.2）；v1.3.0：OFR-2026-09-15（[from-user 2026-09-15] 负责人定稿保存/导出出口合并，见 3b 与 PRD §8.2）

## Context

VRA-070 引入的 40px 常驻 `AppHeader`（文件下拉 / 文档名 / 整理按钮 / 视图下拉 / 主题切换）把命令承载放进了 WebView 内容区。负责人在 PRR-065 明确：打开即全干净画布，看不到任何菜单。同时命令不能消失——文件、编辑、视图、主题、设置与引导都需要可发现、可键盘操作的宿主。

macOS 上系统已提供两个天然的命令宿主：屏幕顶部原生应用菜单栏与标准原生标题栏（交通灯、`● <name> — Mind Map` 窗口标题）。本项目自 MM-080 起已存在 `keyboard.ts` 快捷键表与 Rust 原生 app 菜单雏形（自定义 Quit / 新建窗口），具备把命令全部迁移到原生菜单的条件。

## Decision Drivers

1. 打开即"全干净"画布：内容区**零常驻** chrome（菜单、顶栏、按钮、状态文字、自动遮罩）。v1.1.0 明确："零常驻"不排除**状态依赖的轻量画布内元素**（见 Decision 3a）。
2. 命令可发现性与可访问性：鼠标、键盘、VoiceOver 都能到达全部命令。v1.1.0：首次试用证明仅靠系统菜单不足以让"整理"可发现（2026-09-12 dogfood 拒绝项），需要画布内的状态化入口。
3. 不破坏既有语义：dirty 确认、handle/token 保存、IME 隔离、textarea 原生编辑、React Flow attribution（G1 决定）。
4. 多窗口正确性：app-wide 菜单命令必须定向到最近聚焦窗口，主题/布局 check state 按窗口隔离。
5. 平台约束：macOS 先行（ADR 0001）；Windows 只保持可移植契约。

## Considered Options

1. **保留 AppHeader 但 hover 自动显现**：仍是 WebView chrome，与"看不到任何菜单"冲突；hover 误触干扰画布。
2. **无边框 + 自绘标题栏**：引入 private API/强制全屏风险，破坏交通灯与系统拖拽语义；卡内明确禁止。
3. **macOS 原生菜单 + 标准标题栏承载全部命令**（采纳）：零 WebView chrome；命令宿主由系统提供，VoiceOver/键盘导航免费获得；快捷键与菜单共用 renderer dispatcher。

## Decision

1. **移除生产渲染树中的 `AppHeader`**：`MindMapApp` 不再渲染它；`EditorCanvas` 直接占满原生标题栏以下内容区。不做 hover 显现，不保留单按钮。`app-header.tsx` 文件保留（无删除授权），仅解除生产引用并登记清理债务。
2. **保留 macOS 标准原生标题栏、交通灯与系统应用菜单栏**；不进入 `LSUIElement`、无边框、强制全屏或 private API 路线。
3. **命令归属 macOS 原生菜单**（稳定 menu item id）：
   - `Mind Map`：关于（predefined）、设置/全局热键、Services、Hide、Hide Others、Show All、Quit（自定义，继续走逐窗 fail-closed 关闭协议）
   - `文件`：新建 `⌘N`、打开 `⌘O`、保存 `⌘S`、存储为 `⇧⌘S`、新建窗口 `⇧⌘N`、关闭窗口 `⌘W`（v1.3.0 起「另存为」与「导出」合并为单一「存储为…」统一面板，见 3b；`⌘E` 不再有菜单 owner，经 renderer keydown 进入同一命令）
   - `编辑`：撤销 `⌘Z` / 重做 `⇧⌘Z`（v1.2.0 起为自定义 renderer 命令——accelerator 被菜单拦截产生唯一 menu event，不再依赖画布焦点收到 keydown；renderer 按焦点分流：文本编辑中原生文本撤销，否则 session 文档撤销/重做）+ predefined 剪切/复制/粘贴/全选（textarea 原生文本语义）
   - `视图`：适应画布、整理 `⇧⌘L`、横向布局 ✓ / 纵向布局 ✓（check）、暖白 ✓ / 黑板 ✓（check）
   - `帮助`：开始/重放引导 `⇧⌘H`

3a. **[v1.1.0] 状态依赖的轻量画布内元素**（DFR-030，[from-user 2026-09-13] 批准）：
   - **空白创建提示**：文档无节点时，画布底部居中显示一行低对比但可读的非交互提示「双击创建 · ⌥Space」；出现节点后即消失。不遮挡输入、不是遮罩、不携带按钮。
   - **浮动整理入口**：文档有 **2 个及以上**节点时，画布右上角显示浮动按钮「整理 ⇧⌘L」；0/1 节点不显示。按钮与系统菜单「视图 → 整理」调用**同一 dispatcher**（Decision 4），不产生第二份业务逻辑。
   - **上下文工具条定位**：选中态上下文工具条（Decision 8 保留项）定位到主选节点附近（上方 8px 起），贴边时夹紧在视口内，小窗口（800×600）不溢出；节点文本输入期间工具条不抢焦点。
   - 以上元素都是状态驱动的瞬态呈现，不构成常驻 chrome；不恢复整条常驻顶栏（v1.0 决定不变）。
3b. **[v1.3.0] 保存/导出出口合并**（OFR-2026-09-15，[from-user 2026-09-15] 负责人定稿）：「保存 `⌘S`」仅产出可编辑文档 `.mindmap` 单一格式（不再提供 `.json` 选项；既有 `.json` 文档打开兼容不变）。「存储为…」面板统一承载另存为与导出：可编辑文档 `.mindmap` 在上组，导出产物 SVG / PNG(2x) / PDF / Graph JSON 在下组（原生 accessory popup，分隔线分组，切换实时联动扩展名）。选导出格式且当前文档从未保存过时，host 同时签发同名 `.mindmap` 兜底授权并在面板内预告，导出成功后自动补写源文件并绑定为文档目标（防源文档丢失）。应用内导出浮层与视图菜单直出项移除；格式呈现顺序由 Rust `save_panel` 锁定。
4. **单一 typed command dispatcher**：renderer 定义 `AppCommandId`；原生菜单事件（host 定向 emit）、应用级快捷键（浏览器 dev keydown）与既有回调都只调用同一 dispatcher，业务逻辑零复制。
5. **定向与 exactly-once**：带 accelerator 的菜单命令由 macOS 菜单拦截按键并产生唯一 menu event，定向发给最近聚焦且仍存在的 WebView；Tauri 生产环境下 WebView keydown 不再派发应用级快捷键（浏览器 dev 仍走 keydown）。`⌥Space` 全局热键与画布级键位不变。
6. **菜单状态同步**：renderer 仅向 host 上报非敏感的 enable/check 状态（主题、布局方向）；host 按 per-window 缓存，窗口聚焦时刷新 app-wide 菜单 check state。不轮询、不联网、不持久化。
7. **Onboarding explicit-only**：任何启动状态（包括偏好 `not-started` / `in-progress`）都不自动显示引导；仅“帮助 → 开始/重放引导”或 `⌘⇧H` 显式打开。`not-started` 显示含开始/跳过的 welcome，`in-progress` 从第一步继续，`completed/skipped` 从第一步重放；中断状态可在后台恢复但不遮挡画布，完成/跳过本机偏好语义保持。
8. **保留**：dirty `●` 标记与文档名的原生窗口标题、选择态上下文工具条、错误/恢复/导出/设置临时面板、React Flow attribution（`hideAttribution: false`）。
9. **不新增**：command palette、右键菜单、运行时依赖；Windows 原生命令表仅保持可移植契约（`AppCommandId` 与 dispatcher 契约平台无关），视觉实现继续 deferred。

## Consequences

### Positive

- 打开即全干净画布，产品意图精确落地。
- 命令可发现性由系统菜单承担：VoiceOver、键盘导航、加速键提示免费获得。
- dispatcher 单源消灭了 header 回调/快捷键/菜单三处复制业务逻辑的漂移风险。

### Negative

- macOS 原生菜单的 check/enable 同步增加了一条 renderer→host 轻量 IPC 与 per-window 状态缓存。
- `app-header.tsx` 成为无生产引用的遗留文件（无删除授权），登记为后续清理债务。
- Windows 版本需要单独的原生命令表实现（契约已就位，实现 deferred，R-013）。
- [v1.1.0] 浮动整理按钮与空白提示引入两条状态化 UI 分支（节点数 0 / 1 / ≥2），需要四态界面测试锁定；整理入口变为两处（菜单 + 浮钮），exactly-once 由共享 dispatcher 保证。

## Validation

PRR-065 任务卡验收：两主题首次空白视觉证据（无 WebView 顶栏/菜单/按钮/onboarding、attribution 保留）、AX 树无隐藏 `主工具条`、原生菜单命令矩阵（鼠标/键盘/VoiceOver 可达、exactly-once、多窗口定向、check state 窗口隔离）、首启无 onboarding 且 `⌘⇧H` 可显式启动、`document.title` dirty 语义、全量源码门、`initial entry ≤ 500,000B`、无新增依赖。

DFR-030 任务卡验收（v1.1.0）：空白 / 单节点 / 多节点 / 选中四态符合指南 §3（空态仅底部提示、单节点无浮钮、≥2 节点显示浮钮、选中工具条在主选节点附近且夹紧视口）；800×600 可操作；浮钮点击与 `⇧⌘L` 快捷键均恰好产生一次布局命令；输入/IME 不误触；暖白/黑板两主题可读。
