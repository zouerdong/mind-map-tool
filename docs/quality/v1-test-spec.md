# 极简自由脑图工具：测试规格

> 状态：Ralplan 共识测试基线。工具名为建议；技术栈 ADR 接受后，根 `README.md`/`AGENTS.md` 必须把命令固定为唯一可复制版本。

## 1. 质量门槛

发布候选必须同时满足：core 单元测试、模块集成测试、桌面 E2E、macOS 原生人工矩阵与性能预算（Windows 原生验收顺延至后续专门版本）、三格式导出 golden、安装/文件关联验证。任何一项缺证据都不是“已完成”。

建议统一命令：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:export
pnpm build
```

技术 Spike 期间命令可变化；正式 bootstrap 卡必须将上述脚本实现或更新本文。

具体质量入口固定为：`scripts/quality/run-all.mjs`、`run-export-golden.mjs`、`run-performance.mjs`、`check-boundaries.mjs`、`scan-dependency-licenses.mjs`、`scan-network-endpoints.mjs`，以及 `run-e2e-macos.sh` / `run-e2e-windows.ps1`。MM-020 必须创建并版本化这些入口；package scripts 只作薄封装。

## 2. 测试分层

### 2.1 Unit：`packages/core/` 与 `packages/export/`

| 主题 | 必测行为 |
| --- | --- |
| Schema | 合法 v1；重复 ID；dangling edge；NaN/Infinity；越界坐标/尺寸；未知未来版本；超大文件/数组限制；确认不存在 viewport/zoom 字段 |
| Commands | create/edit/move/delete node；create/delete edge；batch move；delete node + incident edges 原子性 |
| History/session | 永不复用 state identity；do/undo/redo；新命令截断 redo；拖动一个历史项；`save→undo→divergent edit` dirty；`save→edit→undo back` clean；in-flight save 成功/失败不误清 dirty |
| View/theme | session/UI zoom min/max 与非法输入；viewport 不持久化、不 undo、不 dirty；打开 fit-content；theme 持久化、undo、dirty |
| Serialization | canonical UTF-8 无 BOM/LF/末尾换行/键顺序/3位数值/`-0`；中文与控制字符；稳定 hash；round trip；不序列化 selection/viewport/history/path/onboarding |
| Bounds | 空文档、单节点、负坐标、长文本、多边界节点、固定 padding |
| Text layout | 固定 font token、显式换行、line-height/padding/baseline、node size authority；UI/exporter 同契约；缺 glyph 明确失败/警告 |
| SVG scene | 稳定数值精度和层级/hash；无 `foreignObject`；XML 转义；白/黑主题 token；空文档错误；尺寸/OOM 前置拒绝 |
| Onboarding reducer | 完成、跳过、重放；只由真实 command/effect 前进；reduced-motion 状态 |

属性/生成式测试建议覆盖随机合法文档的 `decode(encode(doc)) ≡ doc`，以及任意合法命令序列不会产生 dangling edge 或重复 ID。

### 2.2 Integration：模块边界

1. selected canvas projection → core command → selected canvas projection；测试读取 decision register 后 fail-closed 选择分支。React Flow 分支追加库 ID/measurement/attribution/无 Pro 代码断言；custom-react-view 分支断言依赖图中不存在 React Flow。两者都确认交互库内部状态不泄漏到文件。
2. 保存/打开 adapter：dialog 返回 host-ledger 支撑的单次 opaque `TargetAuthorization`；`openDocument` 与成功的 Save As 返回绑定 window/session 的 opaque `DocumentTargetHandle + VersionToken`；普通 Save 不重开对话框。覆盖成功、取消、authorization forged/replay/expired/document-export wrong-kind、handle 伪造/过期/撤销/跨窗口、无权限、磁盘满；temp write、file sync、metadata、token compare、replace、directory/final-handle sync 分阶段 failure injection；所有 authorization 负向分支均不创建/覆盖目标且不更新 handle/token/saved identity，旧文件保持可读且 dirty 正确。
3. 外部修改与并发：`open → edit → ordinary save`、`Save As → edit → ordinary save`；选择已有 Save As/导出目标后、commit 前外部写入；选择不存在目标后、commit 前目标出现；打开后外部写入、保存快照后继续编辑、排队保存、同路径重复打开；外部改变均冲突不覆盖，正常 ordinary save 不重复弹窗。
4. `LaunchRouter`：renderer/app 未 ready 时排队；带文件 cold start 抑制默认空窗；macOS Opened/Reopen、Windows argv/single-instance；intent/path 幂等；大小写/符号链接/Unicode 等价路径；连续多文件顺序；warm icon/Dock activation 新建空白且不碰 dirty 窗。
5. dirty/close flow：保存、放弃、取消；保存失败/外部冲突后继续阻止关闭。
6. preferences：app 注入引导偏好，UI 状态机不依赖 platform，不污染脑图文件。
7. export owner：TS/WASM 分支验证 platform 只提交 bytes；native 分支才验证 `renderExport` IPC。两分支均验证取消、尺寸上限、同一 SVG 和原子落盘。
8. IPC contract：非法 payload、越权路径、过大 SVG、未知 command、缺失 expected token，伪造/重放/过期/wrong-kind `TargetAuthorization`，以及伪造/过期/已撤销/跨窗口 `DocumentTargetHandle` 均以稳定错误码拒绝。
9. Decision register：每轨全 FAIL 必须 `blocked/recommended=null`；推荐必须引用 PASS+evidence；font 同规则。`--phase spike-result` 要求 G0 和结果自洽但允许 G1 pending；`--phase bootstrap` 要求四轨 ready、G1，并逐轨核对 approved value、PASS evidence digest、ADR id/version/hash 与 `sourceSpikeResult` path/SHA-256/generatedAt；推荐替换、evidence digest 变化、Spike snapshot hash 变化、ADR version/hash 变化或任一 approved value 不匹配均必须非零；`--phase packaging` 追加 G2 的 selected host、candidate output paths、installation targets、allowed install/uninstall actions 与 deletion boundaries，并拒绝 signing/system-trust/upload/publication。不得让未来 Gate pending 阻断前一阶段。

### 2.3 E2E：发布构建或接近发布构建

| ID | 场景 | 期望 |
| --- | --- | --- |
| E2E-01 | 图标/Dock cold/warm activation | 每次新空白窗口，无登录/模板页，不替换 dirty 窗 |
| E2E-02 | 双击创建并编辑中文节点 | IME 正常，输入期间不误触快捷键 |
| E2E-03 | 创建两节点并连线，移动目标 | 连接持续附着 |
| E2E-04 | 多选移动、删除、undo/redo | 状态逐步精确恢复 |
| E2E-05 | 切换白/黑主题 | 视觉与文档状态一致 |
| E2E-06 | open → 修改 →普通 Save；Save As → 修改 →普通 Save → reopen | 两条普通 Save 均不重复弹选址对话框；canonical round trip 等价，hash/handle/token/dirty 正确 |
| E2E-07 | 关闭 dirty 文档 | save/discard/cancel 三分支正确 |
| E2E-08 | 首次引导完成/跳过/重放 | 不强制重复，不污染文档 |
| E2E-09 | 导出 SVG/2x PNG/PDF | 内容齐全，无 UI overlay |
| E2E-10 | 损坏/未来版本/外部修改文件；authorization 伪造/重放/过期/错类型；伪造/撤销/跨窗口 handle | 可理解且稳定的错误/冲突；不创建或改写目标，不更新保存身份；越权 capability 被拒绝 |
| E2E-11 | early/warm open 多文件/同文件/等价路径 | 队列不丢事件；不同文件顺序开窗；同 identity 聚焦，无覆盖竞争 |
| E2E-12 | 关闭未保存后再次图标冷启动 | 空白画布，不恢复被放弃内容 |
| E2E-13 | save→undo→分叉；save→edit→undo back | 前者 dirty、后者 clean |
| E2E-14 | save in flight→继续编辑→成功/失败 | 只确认保存快照；新编辑 dirty；旧文件始终可读 |

WebView 自动化无法可靠覆盖的系统对话框、文件关联、签名/公证行为，必须进入人工矩阵，不能用 mock 结果代替。

## 3. 导出 golden 规范

### 3.1 固定合成夹具

- `empty-document`：空画布。
- `two-linked-nodes`：基础边界。
- `negative-coordinates`：负坐标与 content bounds。
- `chinese-multiline`：中文、英文、标点、换行、XML 特殊字符。
- `dark-theme`：黑板背景与对比。
- `dense-300-450`：300 节点 / 450 连接性能夹具。
- `large-bounds`：极宽/极高画布，用于尺寸上限/PDF 策略。
- `missing-glyph`：获选字体不覆盖的合成 code point，验证稳定警告/替代。
- `empty-document` 必须断言 `EXPORT_EMPTY_DOCUMENT`，不能接受零字节或随意 1×1 产物。

### 3.2 三层断言

1. **语义 golden**：canonical SVG snapshot + SHA-256；解析后断言 `<text>/<tspan>`、`<rect>`、`<path>` 数量、viewBox、无 `foreignObject`、无编辑控件。同输入连续 100 次且在 `TZ=UTC/Asia/Shanghai`、`LANG=C/zh_CN`、DPI 100%/200% 下 hash 相同。
2. **视觉 golden**：SVG 用获选固定 renderer/font 生成 PNG；断言 2x 宽高恰为 scene CSS width/height×2、感知 diff、alpha/主题背景。缺字体不得静默换系统字体。
3. **PDF 结构/视觉**：页数、MediaBox、字体/文本/路径存在性；至少用两个独立 PDF viewer/rasterizer 验证内容和几何容差，不能只判断文件可打开，也不声称任意 viewer 像素一致。
4. **资源边界**：在分配前拒绝超单边/总像素/页数上限；监控进程峰值并验证无 OOM、无半成品。

更新 golden 必须在变更报告中列出差异原因和审阅截图；不得把 `--update-snapshots` 作为常规通过手段。

## 4. 跨平台矩阵

最低 OS/CPU 由用户确认。Spike 与发布候选至少覆盖：

| 维度 | macOS | Windows |
| --- | --- | --- |
| 架构 | Apple Silicon；Intel 是否支持待确认 | x64；ARM64 是否支持待确认 |
| WebView | WKWebView 对应最低 OS | WebView2 已有、缺失/旧版本 bootstrap |
| 安装 | DMG/app，首次启动与卸载 | MSI/NSIS 选择、安装/卸载 |
| 文件关联 | UTI/扩展名、Finder 双击、中文/空格路径 | extension/ProgID、Explorer 双击、中文/空格路径 |
| 冷/热打开 | early Opened/Reopen、Dock activation、多窗口、symlink/Unicode 等价路径 | early argv/single-instance、图标 activation、大小写/等价路径、连续多文件 |
| 输入 | 鼠标、触控板、中文 IME、Cmd 快捷键 | 鼠标、触控板、中文 IME、Ctrl 快捷键 |
| 缩放 | Retina、系统缩放 | 100%/150%/200% DPI |
| 导出 | SVG/PNG/PDF + 中文字体 | SVG/PNG/PDF + 中文字体 |
| 安全 | 签名/公证状态 | code signing/SmartScreen 状态 |

每项记录 OS build、CPU、内存、WebView 版本、应用 commit、构建类型和证据路径。

## 5. 性能与资源测试

### 5.1 环境

选择一台代表性 Mac 与一台代表性 Windows 设备；性能 ADR 写清型号、CPU、RAM、OS、磁盘、WebView2 版本、`scripts/quality/run-performance.mjs` 版本/hash。发布构建预热一次后测量，cold 与 warm 分开；不同脚本版本的数据不得直接比较。

### 5.2 建议预算（需 Spike 校准）

| 指标 | 方法 | 建议门槛 |
| --- | --- | ---: |
| cold start | 进程启动至画布可输入，各 20 次 | P95 ≤ 1.5 s |
| warm start | WebView 可用状态，各 20 次 | P95 ≤ 0.8 s |
| idle RSS | 空白画布稳定 30 s，10 次 | P95 ≤ 120 MB |
| 标准图交互 | 300/450，拖动/缩放录制 | P95 frame ≤ 32 ms，无 >200 ms freeze |
| command latency | create/move/connect/undo，100 次 | P95 ≤ 50 ms |
| save | 标准图本地 SSD，20 次 | P95 ≤ 200 ms |
| 2x PNG export | 标准图，10 次 | P95 ≤ 3 s |
| installer/download size | 每平台相同格式记录 | Tauri 建议 ≤ 25 MB；Electron 仅对照 |

性能回归门槛建议：相对已批准基线恶化 >15% 时失败或需要书面批准。测试同时记录平均、P50、P95，不能只报最佳值。

## 6. 安全、数据与离线检查

- 在网络禁用环境执行核心流程；应用不得因无网受阻。
- 扫描代码和构建产物，不应出现遥测端点、服务端 URL、token 或真实用户数据。
- `scripts/quality/check-boundaries.mjs` 必须检查 core 不导入 React/画布/host/DOM，UI 不调用 OS API，未获选 host/renderer 分支不进入构建图；`--scope selected-canvas` 读取 decision register，只加载获选画布断言并确认另一分支依赖不存在。
- `scripts/quality/scan-dependency-licenses.mjs` 在每次新增运行时依赖时运行；`scan-network-endpoints.mjs` 对源码与解包产物扫描 URL/网络 API/遥测 SDK，并使用 allowlist 审阅每一命中。
- IPC fuzz/边界输入不导致任意路径读写或 host panic。
- 导入文件限制大小、节点/边数量、字符串长度与数字范围；具体上限写 schema ADR。
- 合成恶意文本覆盖 XML 注入、路径字符、超长中文、控制字符。

## 7. 人工验收脚本

每个平台由未参与实现的人执行：

1. 全新安装，断网启动；确认直接空白画布。
2. 完成和跳过首次引导各一次，再从菜单重放。
3. 创建至少 8 个中英文节点，连接、移动、多选、删除并 undo/redo。
4. 切换主题；分别检查正常、hover、selected、focused、editing 状态。
5. 保存到含中文和空格的路径；关闭后从文件系统双击打开；用符号链接/大小写等价路径验证同文件 identity。
6. 应用 booting/renderer 未 ready 和已运行时分别连续打开多个文件、同一文件与图标/Dock 激活；检查队列顺序、聚焦、新空白窗和 dirty 窗安全。
7. 修改后依次验证关闭对话框 save、cancel、discard；确认 discard 不恢复。
8. 导出 SVG、2x PNG、PDF；在至少两个独立查看器打开并与画布核对；改变 locale/timezone/DPI 后重复 hash；验证空文档、缺字体和极大画布错误。
9. 尝试打开损坏文件、未来版本文件、只读目录中的文件；在保存期间外部修改，并对 temp-write/sync/replace 注入失败；伪造、重放、过期和错类型使用一次性 authorization；确认旧文件安全、目标未新建/覆盖、保存身份未更新、token 冲突和 dirty 正确。
10. 仅在 G2 精确批准的目标/删除边界内检查 unsigned candidate 的安装/卸载、文件关联、应用图标与明确的 `unsigned` 状态；不做 test-signing、签名、公证或系统信任修改。
11. 运行标准性能脚本并附结果。

验收记录模板：平台/设备、构建 ID、步骤、期望、实际、Pass/Fail、截图/日志、issue ID、执行人、日期。

## 8. AC 逐条追溯矩阵

MM-090 必须为每行生成所列 aggregate JSON，并在 `docs/quality/evidence-index.json` 登记 macOS/Windows 原始证据；MM-110 逐行复核，不能用一次录屏或“全部可走通”替代。

| AC | Owner task | Test / manual case | Exact command | Evidence artifact | Final reviewer |
| --- | --- | --- | --- | --- | --- |
| AC-01 | MM-060、MM-080 | E2E-01/E2E-11；人工 1/6 | macOS `scripts/quality/run-e2e-macos.sh --case launch-router`；Windows `powershell -File scripts/quality/run-e2e-windows.ps1 -Case launch-router` | `docs/quality/evidence/ac-01.json` | MM-110 |
| AC-02 | MM-030、MM-050 | core/UI unit；获选画布 projection；E2E-02 | `pnpm --filter ./packages/core test && pnpm --filter ./packages/ui test && node scripts/quality/check-boundaries.mjs --scope selected-canvas` | `docs/quality/evidence/ac-02.json` | MM-110 |
| AC-03 | MM-030、MM-050 | command unit；获选画布 projection；E2E-03/04 | `node scripts/quality/run-all.mjs --focus core-commands,selected-canvas` | `docs/quality/evidence/ac-03.json` | MM-110 |
| AC-04 | MM-030、MM-080 | history/session unit；E2E-13/14 | `node scripts/quality/run-all.mjs --focus session-history` | `docs/quality/evidence/ac-04.json` | MM-110 |
| AC-05 | MM-070、MM-080 | theme/onboarding component；E2E-05；人工 4 | `pnpm test:a11y && node scripts/quality/run-all.mjs --focus theme` | `docs/quality/evidence/ac-05.json` | MM-110 |
| AC-06 | MM-030、MM-060、MM-080 | canonical round-trip；open/Save As 后 ordinary save；E2E-06 | `node scripts/quality/run-all.mjs --focus canonical-file,ordinary-save` | `docs/quality/evidence/ac-06.json` | MM-110 |
| AC-07 | MM-060 | LaunchRouter integration；E2E-11；人工 5/6 | macOS `scripts/quality/run-e2e-macos.sh --case file-open`；Windows `powershell -File scripts/quality/run-e2e-windows.ps1 -Case file-open` | `docs/quality/evidence/ac-07.json` | MM-110 |
| AC-08 | MM-030、MM-060、MM-080 | failure injection/TOCTOU；E2E-10/14；人工 9 | macOS `scripts/quality/run-e2e-macos.sh --case file-safety`；Windows `powershell -File scripts/quality/run-e2e-windows.ps1 -Case file-safety` | `docs/quality/evidence/ac-08.json` | MM-110 |
| AC-09 | MM-070、MM-080 | onboarding reducer/component；E2E-08；人工 2 | `pnpm --filter ./packages/ui test -- onboarding && pnpm test:e2e -- --case onboarding` | `docs/quality/evidence/ac-09.json` | MM-110 |
| AC-10 | MM-040 | semantic/hash golden；E2E-09 | `node scripts/quality/run-export-golden.mjs --format svg` | `docs/quality/evidence/ac-10.json` | MM-110 |
| AC-11 | MM-040/MM-045、MM-080 | PNG/PDF/size/font/OOM golden；人工 8 | `node scripts/quality/run-export-golden.mjs --format png,pdf --viewers 2` | `docs/quality/evidence/ac-11.json` | MM-110 |
| AC-12 | MM-010、MM-050、MM-090 | 300/450 与 resource benchmark；人工 11 | `node scripts/quality/run-performance.mjs --fixture dense-300-450 --platform current`（两平台各跑） | `docs/quality/evidence/ac-12.json` | MM-110 |
| AC-13 | MM-020、MM-090 | offline manual；boundary/dependency/network scan | `node scripts/quality/check-boundaries.mjs && node scripts/quality/scan-dependency-licenses.mjs && node scripts/quality/scan-network-endpoints.mjs` | `docs/quality/evidence/ac-13.json` | MM-110 |
| AC-14 | MM-100 | 两平台 unsigned install/uninstall/file association；人工 10 | Tauri `pnpm bundle:tauri -- --unsigned && pnpm test:install:tauri -- --unsigned --scope-from docs/decisions/decision-register.json`；Electron `pnpm bundle:electron -- --unsigned && pnpm test:install:electron -- --unsigned --scope-from docs/decisions/decision-register.json`；只跑获选 host | `docs/quality/evidence/ac-14.json` | MM-110 |

## 9. 停止条件

- 任一平台出现可复现数据丢失、原文件覆盖、打开错文件：阻断发布。
- SVG/PNG/PDF 任一缺字、缺节点/边或 PDF 策略未定：阻断发布。
- 技术 Spike 未覆盖两平台或只测 debug build：不得确认技术栈/性能 ADR。
- Spike 未对 host/canvas 分别评分，或 renderer 轨没有形成 `recommendation-ready` 的唯一 PASS owner（全失败时应为 `blocked/recommended=null`）：不得 bootstrap。
- MM-090 任一失败必须生成带 owner/复现/严重度的修复卡；修复合入后从 `node scripts/quality/run-all.mjs` 重新完整执行 MM-090，不能只复跑失败用例即宣布通过。
- 许可证、扩展名、最低 OS/CPU、签名分发边界未获用户确认：不得公开发布。
