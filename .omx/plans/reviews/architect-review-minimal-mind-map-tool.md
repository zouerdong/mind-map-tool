# Architect Review：极简自由脑图工具

## 1. Verdict

**ITERATE**

规划的产品方向、无服务器边界、core/UI/platform 分层、独立 semantic scene 和 ADR/用户确认门槛基本正确，已具备形成可执行计划的主体结构。但当前版本仍有 6 个会让不同 Agent 产出互不兼容实现或导致数据安全/验收误判的问题；在这些问题修正前，不应进入 Critic 的最终批准或实现派发。

本结论不是否定 Tauri + React 的候选方向，而是要求先把候选方案、数据安全语义和任务所有权闭合。

## 2. 需求一致性结论

### 已正确保持

- 产品仍是自由空间节点图，不是自动树状脑图。
- 首版包含白/黑画布、首次交互式引导、原生文件和 SVG/PNG/PDF 导出。
- 账号、云同步、协作、AI、富媒体、模板、服务端、遥测和广告均明确排除。
- “终端用户在工作中免费使用”和“第三方不得商业化软件本身”的许可边界没有被误写成限制用户产出。
- 当前交付只包含规划、指导和任务卡；没有授权实现、派发、发布或许可证落地。

### 存在偏移

- PRD 已把“点击应用图标始终得到新空白画布”列为原则和验收项（`prd-minimal-mind-map-tool.md:32,42-49,181`），但架构又把 macOS 已运行时的 Dock Reopen 行为降回“用户确认项”（`architecture-minimal-mind-map-tool.md:136`）。该行为已有 `[from-user]` 规格，不应因平台惯例自动降级；只有 Spike 证明无法可靠实现时，才能作为明确的范围变更重新请求用户决定。

## 3. 最强 Steelman Antithesis

对当前 Tauri 首选方案最强的反方不是“Electron 更流行”，而是：**本产品真正不可接受的失败是跨平台行为不一致、文件丢失、中文输入/导出异常，而不是多几十 MB。**

Electron 捆绑同一 Chromium，虽然下载体积和 RSS 更高，却能显著压缩 WKWebView/WebView2 差异、WebView2 bootstrap、字体与自动化矩阵，并减少 Rust/TypeScript 跨边界调试。在由多个 Agent 分卡实现、长期维护者规模未知的前提下，单一渲染运行时可能比更小的安装包更接近“整体系统极简”。如果 Electron 在用户最终接受的启动、RSS 和包体预算内，而 Tauri 的双 WebView 差异造成额外缺陷或测试成本，那么 Electron 应当胜出。

Flutter 也不能仅因“需要 Flutter/Canvas 经验”而名义保留、实际排除：当前没有证据表明后续 Agent 缺少该能力。要么用同一评分矩阵明确淘汰 Flutter，要么为它保留可执行的分支计划；不能把它列为 viable option，同时让全部任务卡、目录和命令只支持 TypeScript。

## 4. 真实 Tradeoff Tensions

1. **包体/RSS vs 跨平台一致性与维护复杂度**：Tauri 预期更轻，但必须维护 WKWebView、WebView2、Rust IPC 和两套系统事件差异；Electron 更重，但运行时和自动化更一致。
2. **语义 SVG 文本 vs 确定性中文渲染**：保留 `<text>/<tspan>` 有利于可选择、可搜索与源码可读；跨查看器像素一致则通常要求固定字体、固定 shaping/换行，甚至嵌入字体或转 path，会增加包体并削弱文本语义。
3. **保存视图状态 vs 无摩擦关闭**：若 viewport 进入文档，单纯平移/缩放可能触发 dirty close；若不进入 dirty，又可能静默丢失最后视角。必须定义产品语义，不能由实现 Agent各自猜测。

## 5. 可行 Synthesis

保留当前分层，但把决策过程改为两层漏斗：

1. 先以统一指标评估桌面 host（Tauri/Electron，Flutter 若仍被列为 viable 则同样评分）和画布实现（React Flow/最小自研视图）两个独立决策。
2. Spike 只验证候选可行性，不把 React Flow、Tauri、Rust resvg 或 pnpm 写成尚未批准的事实。
3. 用户批准 ADR 后，生成/启用与获选分支匹配的 bootstrap、native 和验证命令；不获选的分支退出任务图。
4. 保持 `core` 为 canonical document + command/history；增加独立的 `DocumentSession` 语义，负责唯一状态身份、保存快照、dirty、path、外部文件版本 token 和窗口生命周期。
5. 保持 document → ExportScene → SVG 的单一语义管线；在 Spike 后明确 PNG/PDF renderer 的实际执行位置和唯一负责人，并以固定字体/换行契约保证中文一致性。

这样既保留 Tauri 的轻量潜力，也保留 Electron 的可靠降级，不让 UI 库、host 或导出实现渗入文件格式和领域历史。

## 6. 必须修改

### M1｜修正 history/dirty 的分叉与异步保存语义

**问题证据**：架构用 `currentRevision !== savedRevision` 判定 dirty（`architecture-minimal-mind-map-tool.md:115`），任务卡直接要求 `savedRevision`（`task-cards-minimal-mind-map-tool.md:67`）。如果 revision 是历史游标，保存于序号 2，undo 到 1 后执行另一条新命令再次到序号 2，内容不同却可能被误判 clean。保存进行中继续编辑时，保存成功也可能错误清除新改动。

**必须改为**：

- 明确 revision 是永不复用的状态身份/历史节点 ID，或使用 canonical document fingerprint；不得只比较可复用的栈索引。
- 保存开始时绑定不可变快照身份 `R`；完成后只把 `R` 标为保存点。若当前状态已是 `R+...`，仍须 dirty。
- ADR 明确 viewport 是否持久化、是否进入 undo、是否触发 dirty；不要让每次 pan/zoom 默认产生关闭提示。
- 在 test spec 增加：`save -> undo -> divergent edit`、`save -> edit -> undo back to saved state`、`save in flight -> edit -> save completes/fails`、viewport/theme dirty 语义。

### M2｜闭合导出模块与 native host 的所有权

**问题证据**：架构建议 Rust `resvg`（`architecture-minimal-mind-map-tool.md:51,168`），IPC 只列 `exportPng`（同文件 `140-147`）；但 MM-040 仅可改 `packages/export/**` 却要求实现 resvg PNG/PDF adapter（`task-cards-minimal-mind-map-tool.md:74-84`），MM-060 未拥有导出 adapter，MM-080 又禁止修改 native host/config。当前没有任务卡能够按声明边界完成 Tauri Rust 导出，PDF IPC/安全落盘也未闭合。

**必须改为**：Spike 后二选一并写清任务所有权：

- WebView/TS/WASM 完整渲染：MM-040 拥有三格式，platform 只负责经系统对话框授权后的 bytes 写入；或
- TS 只生成 canonical SVG，native host 拥有 resvg/PDF 转换：拆出专属 native export card，定义 `exportPng`、`exportPdf`/generic export、尺寸上限、取消和原子落盘契约。

相应更新依赖图、允许路径、IPC 测试和验证命令，禁止两个并行 Agent 同时修改 `src-tauri`。

### M3｜把“安全保存”从口号补成跨平台提交协议

**问题证据**：目前只有“同目录临时文件 → flush/sync → replace/rename”（`architecture-minimal-mind-map-tool.md:122`），`expectedToken` 还是可选且未定义（同文件 `142`）。这不足以覆盖 Windows 覆盖既有文件的语义、保存时外部文件变化和进程在提交点中断。

**必须改为**：

- ADR 明确 macOS/Windows 各自的 replace primitive、文件 flush 与必要的目录持久化、权限/属性处理、临时文件命名与恢复/清理规则。
- 打开时取得文件 identity/version token；覆盖保存时必须检查 token，外部变化需提示冲突，不得静默覆盖。若决定首版不保护外部修改，必须把它列为显式风险并由用户接受。
- 增加 failure-injection 测试：temp write、sync、replace 各阶段失败；保存期间外部修改；同一路径重复打开；保存快照后继续编辑。所有失败都要证明旧文件仍可读且 dirty 正确。

### M4｜定义 cold/warm open 的单一事件状态机，并保持已确认入口语义

**问题证据**：当前仅列举 Opened/Reopen/argv/single-instance（`architecture-minimal-mind-map-tool.md:127-136`），没有处理 native 事件早于 WebView/session registry 就绪、默认空窗与文件打开事件竞争、重复事件幂等性。

**必须改为**：

- 定义 `launch intent -> queued native events -> app ready -> normalize/dedupe -> focus/create window` 的状态机和稳定 path identity。
- 明确冷启动带文件时不得先产生多余空白窗口；warm open 同文件聚焦、不同文件新窗口；多事件按顺序且幂等。
- “图标/Dock 激活得到新空白文档”按现有规格作为默认验收，不重新当作普通平台偏好；只有技术 Spike 失败才触发用户范围变更。
- 测试补充 renderer 未就绪事件、连续打开多个文件、大小写/符号链接或等价路径、应用已运行时图标激活，以及 dirty 窗口不受打开事件破坏。

### M5｜补齐确定性导出与中文字体/布局契约

**问题证据**：计划固定了 SVG 属性顺序和 scene（`architecture-minimal-mind-map-tool.md:159-176`），但 node `size`、系统字体差异、换行/shaping 的关系没有定义（同文件 `81-104`）。测试目前只规定 golden 层级，没有要求同输入在 locale/timezone/DPI 变化下稳定（`test-spec-minimal-mind-map-tool.md:69-87`）。

**必须改为**：

- 字体 ADR 明确许可、是否随应用/导出嵌入或子集化、fallback、中文 glyph 缺失行为和包体代价。
- 定义纯文本换行、line-height、padding、baseline、节点 size 的权威来源；UI 与 exporter 使用同一布局契约，不依赖临时 DOM measurement 重新解释文档。
- 明确“确定性”的边界：同输入 canonical SVG bytes/hash 必须稳定；PNG/PDF 必须由固定 renderer/font 产出；外部 SVG 查看器只要求定义的兼容容差，不能声称任意查看器像素一致。
- 测试增加重复运行 hash、locale/timezone/DPI、缺字体、中文多行、极大像素面积/OOM、PNG 2x 尺寸定义和 PDF 多查看器结果。

### M6｜让技术方案和任务卡真正可分派、可复现、无冲突

**问题证据**：Flutter 被列为 viable，但所有正式卡和命令都假设 TS/pnpm，MM-060 甚至无条件写 Cargo 命令（`task-cards-minimal-mind-map-tool.md:109`）；MM-010 的实验代码只在会清理的 `.tmp`，却要求“可复现实验”（同文件 `39-45`）；MM-070 依赖 MM-060 的 preference contract，但二者的完成/并行边界不明确；新增 `packages/export/` 尚未在根 `AGENTS.md` 目录契约中登记。

**必须改为**：

- 对 Tauri/Electron/Flutter 使用同一权重表：包体、RSS、启动、双平台事件/安装、画布交付成本、字体导出、Agent 技能供应、长期维护。Flutter 若不进入 Spike，须用证据正式标为 rejected；若仍 viable，补分支任务卡与验证命令。
- 把“桌面 host 选择”和“React Flow 选择”拆成两个 ADR。React Flow 需要明确 exit criteria（attribution、API/许可、300/450 性能、IME、投影隔离）；不能用 Tauri/Electron 对照实验顺便锁定 UI 库。
- 将 Spike harness/命令放入受版本控制且符合目录规则的位置（例如 `scripts/runtime-spike/**`），`.tmp` 只存可再生构建产物；否则实验无法从全新 clone 复现。
- 明确 MM-070 不得反向依赖 `packages/platform`：onboarding 发出语义事件/由 app 注入初始偏好，MM-080 负责接线；或让 MM-070 明确等待 MM-060 完成，不再宣称可并行。
- MM-020 在创建 `packages/export/` 前先更新 `AGENTS.md` 结构约定；所有 Electron/Tauri 分支命令都须条件化，未获选分支不得作为必跑命令。
- 给 MM-090 指定精确脚本路径；QA 失败必须产生责任卡并在修复后重新完整执行 MM-090，不能只口头“回到责任卡”。

## 7. 建议修改（非阻断）

1. 为 JSON 定义 canonical encoding：UTF-8、换行、数值精度、字段顺序和非法控制字符，以便文件 diff、hash 和 golden 稳定。
2. 明确空文档导出行为、PNG 背景默认值和 PDF 超大画布超过上限时的用户错误文案。
3. 将性能指标的参考设备与测量脚本版本一起纳入 ADR，避免不同 Agent 用不同机器的 P95 互相比较。
4. 在最终审阅卡加入“依赖方向自动扫描”和“构建产物网络端点扫描”的具体工具/命令，而不是只写抽象检查。
5. 把第三方依赖许可扫描前移到 MM-020/MM-040，每次新增运行时依赖即检查，不要等到 MM-100 才集中发现冲突。

## 8. 原则违反检查

| 原则 | 结论 | 说明 |
| --- | --- | --- |
| 规格先于实现 | 基本通过 | PRD/ADR/任务卡先行；但 MM-010 预设 React Flow，需拆分候选决策。 |
| 领域逻辑与框架隔离 | 方向通过、契约待修 | core 边界清晰；dirty/session 与 onboarding preference 依赖需补齐。 |
| 跨平台差异只进适配层 | 基本通过 | cold/warm open 有平台证据，但缺统一状态机。 |
| 本地优先、无服务器 | 通过 | 没有服务端、端口监听、账号、云、遥测。 |
| 最小必要依赖 | 待修 | React Flow/resvg/PDF 路径未完成独立选择和所有权闭合。 |
| 新目录先定义结构约定 | **违反风险** | `packages/export/` 不在现有根目录契约中；必须先更新 `AGENTS.md` 再创建。 |
| 关键决策需用户确认 | 基本通过 | 技术栈/schema/许可/发布均设 gate；但已确认的图标启动语义不应被反向降级。 |
| 大改动先 Plan | 通过 | 当前没有实现动作，任务图明确在 ADR 后开始。 |
| 红线操作先询问 | 通过 | 不改 CI/CD、凭据，不签名、公证、发布；`.tmp` 清理明确等待授权。 |

## 9. Architect 复审通过条件

Planner 修订五份草案后，以下条件同时成立才可给出 `APPROVE`：

- M1-M6 均在 PRD/架构/test spec/task cards 中形成一致契约；
- 每个 renderer/native host 工作都有唯一 owner 和允许路径；
- 技术分支与命令不再假装同时适用于 Tauri/Electron/Flutter；
- dirty 分叉、异步保存、外部修改、early open event、中文确定性导出都有明确自动化或人工证据；
- 已确认产品入口语义、无服务器边界和用户确认门槛没有被削弱。
