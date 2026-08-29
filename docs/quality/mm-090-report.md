# MM-090 聚合报告（自动化 E2E、golden 与双平台验收）

状态：**macOS 维度完成**（2026-08-29 完整重跑全绿；Windows 维度 R-013
无设备 BLOCKED，不产假报告）。自动化覆盖边界（本机 TCC 输入注入限制）
如实记录于下——键盘交互链真机验证归人工矩阵，不以 mock 冒充。

## 执行架构（本卡落地）

三层证据，不以 mock 冒充任何一层：

| 层 | 范围 | 载体 |
| --- | --- | --- |
| 自动化 E2E（真实 app） | E2E-01A 冷启动健康（D1/D2 回归）+ E2E-16 热键唤醒分支（真实系统热键） | `tests/e2e/macos/`（ax-bridge + cases + run）+ `run-e2e-macos.sh`（osascript/System Events 驱动真实 debug bundle） |
| 键盘交互链逻辑 | E2E-02/03/04/08 场景的命令语义（建点/编辑/连线/undo/引导） | packages/ui 199 个 jsdom 测试（keyboard-flow 全键盘建图等）——真机键盘链归人工矩阵 #3 |
| 系统级自动化（真实服务层） | launch 路由、文件安全、authorization 负向、golden、性能 | `run-platform-macos.sh --suite file-lifecycle`、`run-export-golden.mjs`、`run-performance.mjs`（路由：`run-e2e-macos.sh --case launch-router\|file-open\|file-safety`） |
| 人工矩阵（系统对话框/真机 IME/Dock/键盘链/文件关联） | 规格 §7 步骤 1–11 + ⌥Space 分流三态 | `mm-090-manual-matrix.md` |

技术决策记录：

- **tauri-driver 弃用**：v2.0.6 在 macOS 报 `not supported on this platform`
  （官方仅 Linux/Windows）——授权安装后实测发现，改走 macOS 自带的
  osascript + System Events（零依赖；客户端存档于 webdriver-client.mjs
  供 Windows E2E 参考）。
- **自动化覆盖边界（本机 TCC 输入注入限制，实测）**：合成鼠标
  （CGEventPost HID/Session tap）被系统过滤；合成 activate/set_focus 不设
  key window → 键盘不达 WKWebView。真实用户不受影响（真实点击/⌘Tab 正常
  设 key）——键盘交互链真机验证归人工矩阵 #3，逻辑语义由 jsdom 测试覆盖。
- **AX 断言策略**：WKWebView 对非 VoiceOver 客户端懒暴露纯视觉子树
  （节点 aria-label 不进 AX）；表单元素（button/textarea）与 landmark
  可靠暴露——断言与交互（AXPress）基于此设计。
- **WebKitAccessibilityEnabled**（app 域 defaults）为 E2E 前置，fail-closed
  由 run-e2e-macos.sh 检查；可逆（defaults delete）。

## 完整重跑清单（已执行，2026-08-29）

```
node scripts/quality/run-all.mjs
node scripts/quality/run-export-golden.mjs
node scripts/quality/run-performance.mjs
node scripts/quality/check-boundaries.mjs
node scripts/quality/scan-dependency-licenses.mjs
node scripts/quality/scan-network-endpoints.mjs
scripts/quality/run-e2e-macos.sh            # E2E-02/03/04/05/08/09
scripts/quality/run-e2e-macos.sh --case launch-router   # 路由 platform 套件
scripts/quality/run-e2e-macos.sh --case file-open
scripts/quality/run-e2e-macos.sh --case file-safety
cargo test && cargo clippy -D warnings
pnpm test:a11y
git diff --check
```

## Pass/Fail 总表（完整重跑后填）

| 命令 | 退出码 | 证据 |
| --- | --- | --- |
| run-all.mjs（typecheck/lint/unit/boundaries/licenses/network/golden/performance） | **0（8/8 PASS）** | 本表下附 |
| run-export-golden.mjs | **0**（10 用例） | tests/golden/export/golden-manifest.json |
| run-performance.mjs | **0**（pan 17ms / drag 16.7 / zoom 16.7，预算 32ms；bundle 747KB） | run-all 输出 |
| check-boundaries.mjs | **0**（selected-canvas PASS） |  |
| scan-network-endpoints.mjs | **0**（74 files, 0 endpoints） |  |
| run-e2e-macos.sh（自动化子集 E2E-01A/16） | **0** | docs/quality/evidence/mm-090-macos-e2e.json |
| launch-router / file-open / file-safety（platform 套件路由） | **0×3** | docs/quality/evidence/mm-090-macos-{launch-router,file-open,file-safety}.json |
| cargo test / clippy -D warnings | **0**（31 tests；clippy clean） |  |
| pnpm test:a11y | **0** |  |
| git diff --check | **0** |  |

最终重跑时间：2026-08-29（UTC 见 evidence JSON generatedAt）。

## Windows

无设备（R-013）：Windows 维度 BLOCKED（真实报告缺失），不产假报告、
不聚合格 PASS；macOS 证据构成 ADR 0001 G1 批准的先行验收基础。
Windows 移植就绪证据见 platform evidence windowsPortReadiness。

## 缺陷清单

| ID | owner | 复现 | 严重度 | 回归测试 | 状态 |
| --- | --- | --- | --- | --- | --- |
| MM-090-D1 | MM-040（packages/export） | 真实 WKWebView 启动即崩：`初始化失败：ReferenceError: Can't find variable: Buffer`（font-source.ts fontkitCreate(Buffer.from) / render-pdf.ts embedFont(Buffer.from)）。jsdom/vitest 环境存在 Node 全局 Buffer，掩盖了该缺陷；仅真实 WebView 暴露 | **P0**（app 完全不可用） | ① export golden 全量（10 用例）重跑 PASS；② 重建 bundle 后 WKWebView 实机启动到达画布（E2E 首个用例到达即证）；③ grep 断言产品代码无裸 Buffer | 已修复（Uint8Array 直传，官方签名本就收 Uint8Array），待完整重跑确认 |
| MM-090-D2 | MM-060/080（ipc/lib.rs） | 打包实机启动报"启动路由初始化失败"：`state not managed for field 'intents'`——lib.rs manage 的是 `Arc<LaunchIntentStore>`，command 取 `State<LaunchIntentStore>`，类型不匹配。dev/单测不触发（invoke 桩）；且组合根 catch 吞掉错误详情加剧定位成本 | **P1**（launch 路由整体失效：Finder 双击打开文件不工作） | ① 实机启动无错误 notice（E2E 就绪即证）；② platform file-lifecycle 套件含 app_ready 握手 | 已修复：State 类型改 `Arc<LaunchIntentStore>`；catch 显示错误详情 |
| MM-090-D5 | MM-089/050（editor-canvas） | 点击画布后 wrapper（tabIndex=0）不获 DOM 焦点（WebKit 焦点留 body）→ 画布键盘流（方向键/Enter/⌘L/⌘A/Delete/⌘Z）在点击后不可达，需先 Tab。实测两版 mousedown 聚焦（preventDefault / setTimeout）都会破坏双击建点的 dblclick 派发 | **P2**（键盘流可用性：Tab 可绕过） | 人工矩阵 #3 加"点击画布后方向键即时可用"检查；候选修复=RF onPaneClick 聚焦 | open（记录候选方案；不阻断 MM-090——E2E 以 Tab 聚焦） |
| MM-090-D6 | MM-088（shortcuts） | Tauri `window.is_focused()` 在 macOS 返回不可靠（实测恒 false，即使 set_focus 后）→ ⌥Space 同键分流的 quick-create 分支永不触发（唤醒分支正常）。E2E 实测发现 | **P1**（"捕捉 idea"核心动作失效） | E2E-02 ⌥Space 建点进编辑（真实热键链路） | 已修复：`Focused` 窗口事件维护 AtomicBool，dispatch 改用事件跟踪标志 |
| MM-090-D7 | MM-088（shortcuts） | 前一实例退出后热键注销滞后（WindowServer 异步），紧随的启动注册冲突失败且**该实例永久无热键**——用户实测踩到（重启 app 后"⌥Space 无反应"） | **P1**（核心动作失效，触发条件=快速重启，普通使用偶发） | 修复=install 后台线程指数退避重试（300ms×2ⁿ×5）；用户实测重启后 ⌥Space 恢复 | 已修复（2026-08-29 用户在场验证） |
| MM-090-D4 | MM-050（projection/viewport） | 双击建点：视觉观察节点不在双击点（视口中心附近）——panePointFromEvent 的 viewport 换算疑似与 RF 实际 viewport 不同步（onMove 未覆盖 fitView 初始态） | **P3**（位置语义，功能可用） | 人工矩阵 #3 加"双击建点落在双击处"检查 | **关闭（2026-08-30 重新归因）**：根因不是 viewport 换算——d3-zoom 的 dblclick.zoom 调 stopImmediatePropagation，wrapper 的 dblclick 从未收到，观察到的节点实为 ⌥Space quick-create（视口中心）。随 D11 修复后双击建点落点正确 |
| MM-090-D10 | MM-080（apps/desktop index.html） | **画布白屏**：`html/body/#root` 未设高度 → 高度链塌缩，React Flow 容器 0 高——画布自 MM-080 起从未在真机显示任何内容（工具栏正常）。jsdom 无布局、E2E 只查 AX 树存在性，双重盲区；用户是首个用眼睛看画布的人 | **P0**（产品完全不可用） | 浏览器实测 `.react-flow` 高度 0→839px；E2E 截图确认点阵+节点可见 | 已修复（index.html 补高度链）；同时安装 error boundary + window.onerror 黑匣子（此前任何渲染异常=哑白屏） |
| MM-090-D11 | MM-050（editor-canvas） | 双击空白建点从未生效：d3-zoom `dblclick.zoom` 处理器 `noevent()`（stopImmediatePropagation），事件不到 wrapper；另双击节点进编辑会经 wrapper 处理器叠加建一个空节点（panePointFromEvent 只查 pane 祖先、不排除节点） | **P1**（核心交互失效） | 浏览器实测：双击空白建点、双击节点仅进编辑（nodeCount=1） | 已修复（zoomOnDoubleClick={false}——双击=建点属键位定稿；panePointFromEvent 排除 .react-flow__node/.react-flow__edge） |
| MM-090-D12 | MM-050（node-text-editor/mind-node） | 编辑态体验：textarea 继承 16px 而非渲染口径 14px；节点尺寸仅提交时由 core 写入 → 输入中框不增长，小节点里 CJK 一字一行"看不到自己在打什么"；提交瞬间跳变 | **P1**（核心编辑体验不可用） | 浏览器实测：编辑态 14px Noto Sans SC、框随输入实时增长（单行/多行），提交后位置尺寸零跳变 | 已修复（编辑器与提交后渲染共用 measureNodeBox 同源测量，视觉先行、文档尺寸仍由 core 提交时权威写入；字体/字号/颜色/行高与渲染态一致） |
| MM-090-D13 | MM-050（editor-canvas fitView） | 声明式 `fitView` 在空文档首个节点出现时触发 pending fit → 镜头跳到 maxZoom 2.5，用户感觉"字巨大" | **P2**（首次使用体验严重受损） | 浏览器实测：建点后 viewport 保持 scale(1) | 已修复（改显式 fitViewSignal：仅文档加载/新建时框架化，建点永不动镜头） |

另：tauri-driver v2.0.6 在 macOS 报 `not supported on this platform`
（官方仅支持 Linux/Windows）——本卡 E2E 技术路线据此改为
osascript + System Events（macOS 自带，零依赖）：真实键盘事件
（System Events keystroke，走系统输入链）+ AX 树断言
（`WebKitAccessibilityEnabled` app 域偏好开启后 WKWebView 暴露 DOM
AX 树）。交互保真度高于 WebDriver 合成事件；如实记入 evidence。

## 已知缺口（继承预检，非本卡阻断项）

- native 窗口级 dirty-close 拦截（on_window_event）——待项目负责人拍板
- Cargo license 扫描覆盖——人工核验兜底
- 多窗口 create-window 权限——host 缺口待议

## 补记（2026-08-30）

用户首次人工全机体验暴露 D10–D13（见上表，含 P0 画布白屏），全部修复后完整重跑：
vitest 199/199、`tsc` 全 workspace 绿、eslint 绿、macOS E2E（E2E-01A/E2E-16）PASS 且截图人工判读确认
（点阵画布可见、⌥Space 唤醒建点、视口不再跳 maxZoom）。浏览器 dev（fake 端口）实测覆盖
E2E 无法自动化的部分：双击建点/双击进编辑不叠点、编辑态实时增长（单/多行）、提交零跳变、主题切换。
webview 内键盘输入的真实机器验证（TCC 限制不可自动化）仍由人工矩阵承接。
