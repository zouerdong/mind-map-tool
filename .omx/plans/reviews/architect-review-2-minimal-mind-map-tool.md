# Architect Review 2：极简自由脑图工具

## 1. Verdict

**APPROVE**

Planner 已实质修复上一轮 M1–M6。PRD、架构、测试规格、任务卡和摘要现已形成一致、可追溯、带用户确认门槛的规划基线；没有发现仍会阻止进入 Critic review 的架构缺口。

本批准仅代表 **Ralplan Architect 规划门通过**，不代表技术栈已由用户接受、不授权实现或派发 Agent，也不授权许可证落地、签名、公证、GitHub 发布或任何公开分发。下一步仍必须按顺序进入 Critic review。

## 2. 上轮复审条件逐项核验

| 条件 | 结论 | 核验结果 |
| --- | --- | --- |
| M1：history/dirty 分叉与异步保存 | **PASS** | 引入永不复用 `StateIdentity`、原历史节点 identity、不可变保存快照、串行保存队列；明确 `save→undo→divergent edit`、undo 回保存点和 in-flight save 三类语义，并在 PRD、架构、unit/integration/E2E、MM-030/MM-080 中一致覆盖。viewport 已明确 session-only、不持久化、不 undo、不 dirty；theme 相反。 |
| M2：导出 renderer 与 native host 唯一所有权 | **PASS** | `runtime-spike-decision.json` 强制选择 `web-ts-wasm` 或 `native-host`。默认分支由 MM-040 完整拥有三格式；native 分支由条件 MM-045 在 MM-060 后串行独占 native export 路径。IPC、commit、测试、依赖图和验证命令已同步，两套实现不得并存。 |
| M3：跨平台安全提交与外部修改 | **PASS** | 定义 canonical bytes、强制 `VersionToken`、冻结快照、同目录 exclusive temp、sync、提交前 token 复核、macOS/Windows primitive、父目录/最终句柄持久化和失败注入。外部修改不得静默覆盖，旧文件与 dirty 状态均有明确验收。 |
| M4：cold/warm open 状态机 | **PASS** | `LaunchRouter` 统一 argv/Opened/Reopen/single-instance/icon activation，覆盖 Booting 队列、AppReady、路径 identity、intent/path 去重、窗口 action 和 renderer ack。带文件 cold start 不先开空窗；warm 同文件聚焦、不同文件新窗；图标/Dock 激活新空白且不破坏 dirty 窗。 |
| M5：确定性导出与中文排版 | **PASS** | 固定 font token、许可/fallback/缺 glyph 策略、显式换行、line-height/padding/baseline、权威 node size 和共享 `layoutText` 契约。确定性边界区分 canonical SVG hash、固定 renderer/font 的 PNG/PDF 与外部查看器容差；测试加入 locale/timezone/DPI、重复 hash、2x 尺寸、PDF 多 viewer、缺字体和 OOM 前置拒绝。 |
| M6：方案公平、任务可复现与多 Agent 冲突 | **PASS** | host 与 canvas 拆成独立 ADR/评分矩阵；Tauri/Electron 使用同一硬件、脚本和阻断标准；Flutter 以 v1 不可复用执行面为理由正式 rejected，不再名义保留。Spike harness 进入受版本控制的 `scripts/runtime-spike/**`；MM-020 先更新 `AGENTS.md` 再建 `packages/export/`；命令按获选 host 条件化；MM-070 不再依赖 platform；MM-090 指定精确入口并要求修复后全量重跑。 |

## 3. 需求与原则一致性

- “图标或 Dock 激活创建新空白文档”已恢复为已确认需求，不再被降级为普通平台偏好；仅在 Spike 证明入口不可可靠辨认时才允许发起范围变更。
- 自由白板/黑板、纯文字节点、自由连线、首次交互引导、本地原生文件、SVG/PNG/PDF、macOS/Windows 均保持首版范围。
- 账号、云、协作、AI、富媒体、自动树形布局、服务端、遥测和广告继续明确排除。
- core 不依赖 UI/桌面框架；UI 不直接调用 OS；平台差异进入 adapter/native host；`DocumentSession` 与 `LaunchRouter` 分责清晰。
- 新增 `packages/export/` 已由 MM-020 明确要求先更新根 `AGENTS.md`，符合“先定义结构约定，再创建目录”。
- 技术栈、schema、字体/PDF、性能、许可、平台范围和公开发布均保留用户确认门槛。
- 没有 CI/CD、凭据、生产配置、发布或删除动作被隐含授权。

## 4. Steelman Antithesis 复核

上一轮最强反方是：Electron 虽更重，但同一 Chromium 能减少 WKWebView/WebView2、字体、IME、自动化和 Rust/TS 边界风险；如果它在用户接受的资源预算内且显著减少缺陷，应优先于 Tauri。

该反方已被公平处理：

- host 评分中“跨平台行为一致性与维护复杂度”权重 25，高于单独的包体/RSS/启动权重 20；规划没有让“框架声誉更轻”直接决定结果。
- Tauri/Electron 必须用同一设备、合成图、脚本和 release 构建比较；任何文件入口或数据安全阻断项可直接淘汰 Tauri。
- Electron 保留完整 TS core/UI/export 降级路径，并有条件化 bootstrap、host 测试和打包命令，不是象征性备选。
- Flutter 以“v1 必须另建不可复用 Dart core/UI/export/tooling，扩大最小交付面”为架构理由正式淘汰，而非臆测团队能力不足。

因此 strongest steelman 已进入决策权重、淘汰条件和可执行分支，而不是只写在风险备注里。

## 5. Tradeoff 复核

### 5.1 轻量 vs 一致性/维护成本

已通过独立 host 评分与阻断条件处理。Tauri 只有在资源预算、文件安全和跨平台入口全部通过时才能胜出；Electron 可凭更低的行为风险胜出，不需要为了保留 Tauri 而放宽验收。

### 5.2 语义 SVG 文本 vs 中文确定性

已通过固定 font token、共享 layout、权威 node size、canonical SVG hash和外部 viewer 容差分层处理。计划不再把“任意查看器像素一致”和“保留 `<text>/<tspan>` 语义”同时当成无代价承诺。

### 5.3 视图持久化 vs 无摩擦关闭

已明确 viewport 为 session-only，打开 fit-content；pan/zoom 不进入文件、undo 或 dirty。theme 是内容语义，持久化、可 undo 并触发 dirty。该取舍与“白纸即开即用”的产品目标一致。

## 6. Synthesis 复核

上一轮建议的“两层决策漏斗 + 独立 DocumentSession + 单一 ExportScene + 唯一 renderer owner”已完整进入计划：

1. MM-010 分别决定 host、canvas、renderer owner 和 font token，输出机器可读、不可留空的 decision。
2. 用户批准 ADR 后，MM-020 只 scaffold 获选分支；未获选 host/renderer 不进入依赖图。
3. `core` 维护 canonical document、命令历史、state identity 与保存快照；platform 实现 token/commit；app 负责组合。
4. `document → shared layout → ExportScene → canonical SVG` 是唯一语义链；PNG/PDF 只有一个 owner。
5. MM-040 与 MM-060 可并行；MM-045 条件串行；MM-050 等待共享 layout；MM-070 与 platform 解耦；MM-090 失败进入责任卡并全量复验。

该 synthesis 既保留 Tauri 的轻量潜力，也保留 Electron 的一致性降级，并把多 Agent 写冲突限制在显式的串行边界内。

## 7. 非阻断残余风险

以下事项需要在对应 ADR/Spike/实现卡中落定，但已有明确 owner、停止条件或用户门槛，不阻塞 Architect 批准：

1. **Save As / 导出覆盖既有目标的 token 获取方式**：当前 IPC 草案的 save dialog 返回 path，而覆盖 commit 要求 expected token。MM-060 应让 dialog 返回带目标 token 的授权结果，或在 host 内建立等价的原子二阶段授权，避免 dialog 确认与 commit 之间的 TOCTOU。
2. **MM-050 条件分支措辞**：卡标题/目标仍写“React Flow”，但步骤要求按 decision 实现 `react-flow | custom-react-view`。若 Spike 选择 custom，派发前应将任务标题、非目标和验收文字机械替换为中性的“获选 React view”，避免执行者误读；现有 decision gate 足以阻止错误 scaffold。
3. **共享 layout 的依赖图表达**：MM-050 明确依赖 MM-040 的 layout，但架构 ASCII 图没有画出 `packages/ui -> packages/export(layout)`。正式架构文档应补箭头或把 layout 抽成明确子模块；当前不存在循环依赖，故不阻断。
4. **测试规格残留 `zoom` 字样**：Schema unit 表仍写“越界尺寸/zoom”，而 v1 viewport 已移出文件。实现前应把它改为 session viewport 边界测试，避免误把 zoom 加回 schema。
5. **Windows durability 能力差异**：目录 flush、ACL/attributes 和不同文件系统上的 `ReplaceFileW` 行为仍需真实设备验证。计划已要求记录能力与 power-loss 边界，不能在实现回报中把“best effort”写成绝对耐久保证。
6. **字体、PDF 与许可证**：固定中文字体的嵌入/子集许可、PDF 分页和 source-available 双重许可文本仍可能改变包体或发布资格；它们已被正确设为实现/发布前 gate，并需要法律复核。
7. **自动化可行性**：cold/warm OS 事件、系统对话框、签名/公证和多 viewer PDF 验证不一定能稳定自动化；测试规格已要求双平台人工证据，不能用 mock 替代。

## 8. Architect 批准条件与后续门

Architect 复审门已满足：

- M1–M6 在五份草案中形成一致契约；
- renderer/native host 有唯一 owner 和明确路径；
- Tauri/Electron/Flutter 与 React Flow 的选择不再混成一个未经验证的技术偏好；
- dirty、异步保存、外部冲突、early open 和中文导出均有测试证据要求；
- 已确认的入口语义、无服务器边界和用户确认门槛没有被削弱。

可进入 **Critic review**。只有 Critic 随后也给出 `APPROVE`，才能记录 `ralplan_consensus_gate.complete: true`；在此之前不得启动实现模式。
