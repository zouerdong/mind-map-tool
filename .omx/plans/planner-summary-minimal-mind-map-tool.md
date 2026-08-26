# 极简自由脑图工具：Planner 摘要

## 1. 规划结果

本轮已把访谈规格转成 PRD、架构决策草案、测试规格和 13 张可独立分派的任务卡（含仅 native renderer 时启用的 MM-045 条件卡）。规划不包含产品代码，也没有安装依赖、派发实现 Agent 或执行公开发布。

当前方向：**优先验证 Tauri 2 + React/TypeScript + `@xyflow/react` 交互视图，core 独立管理文档/命令/历史，三格式导出走独立 semantic SVG scene；没有服务器后端。** 这不是已锁定技术栈：四条决策轨必须先完成 macOS/Windows 双平台 Spike；只有 PASS 候选才能被推荐，任一轨全失败就保持 `blocked`，之后仍须由用户批准对应 ADR。

## 2. 核心取舍

| 决策 | 结论 | 为什么 |
| --- | --- | --- |
| 桌面运行时 | Tauri 2 首选，Electron 降级 | Tauri 使用系统 WebView、预期更轻；Electron 运行时更一致但捆绑二进制/Chromium、多进程更重 |
| 画布 | React Flow 仅作交互视图 | 降低首版拖拽/缩放/连线风险，但防止其内部 state 锁死文件和历史 |
| 历史/dirty | 永不复用 StateIdentity + 不可变保存快照 | 正确处理分叉、undo 回保存点、保存期间继续编辑 |
| 文件 | canonical versioned UTF-8 JSON，扩展名待定 | 稳定 hash；一次性选址授权 + session-bound opaque target handle + VersionToken；双平台 commit protocol |
| 导出 | document → semantic SVG → SVG / 2x PNG / PDF | 不依赖 DOM 截图；三格式共享 scene，可做 semantic/visual golden |
| PNG/PDF owner | 默认 TS/WASM 完整 owner；失败才启用 MM-045 native 分支 | 保持同源渲染并消除 native/TS 无主工作 |
| 窗口/打开 | 单应用实例、一文档一窗口、LaunchRouter | early event 排队/去重；图标/Dock cold/warm 均新建空白，不破坏 dirty 窗 |
| 引导 | 监听真实 command 的状态机 | 教程不复制编辑器逻辑；完成/跳过是本机偏好，不污染文件 |
| 后端 | 不创建 | 首版本地文件闭环没有服务器需求；Tauri Rust 是本机 host，不是服务端 |
| 许可 | source-available dual license 方向，法律审阅后定稿 | 保护“软件本身商业化”，不限制终端用户在工作中使用；PolyForm NC 过宽 |

关键官方证据已在架构文档中以 `[from-research]` 标记并直接链接。Neutralino 因官方安装器链未完成而淘汰；Flutter 因需要不可复用的 Dart core/UI/export/tooling 分支、扩大 v1 交付面而正式 rejected，不基于团队能力假设。

## 3. 先做 Spike，而不是直接锁栈

Spike 必须同时覆盖：

- Tauri/Electron 的发布构建包体、cold/warm 启动、RSS 对照；
- 300 nodes / 450 edges 的拖动、缩放、选择、保存、导出；
- macOS/Windows cold/warm file open、single-instance、中文/空格路径；
- 白/黑主题、中文 IME、DPI/Retina；
- 无 `foreignObject` semantic SVG；只在 PASS 候选中选出唯一 renderer owner，全失败时明确阻断；
- 中文字体、PDF 单页/分页、大画布上限；
- Windows WebView2 bootstrap、最低 OS/CPU；
- host 与 canvas 两份独立评分表，以及顶层/四轨 `recommendation-ready|blocked` 状态；推荐值仅在候选 PASS 且证据完整时非空。

若 Tauri 不能通过既定门槛，按证据切换 Electron，不为保留技术偏好而放宽产品验收。

## 4. 用户确认项

### 4.1 进入正式实现前

1. Spike 后采用 Tauri 2 还是 Electron。
2. 产品名、application/bundle ID、原生扩展名、MIME/UTI、文件图标。
3. schema v1 与兼容承诺，包括重复边/自环、节点/字符串/文件上限。
4. 最低 macOS/Windows 版本和 CPU 架构范围。
5. 独立 canvas 评分结果及 React Flow attribution 保留/处理方式。
6. 标准规模是否接受 300 nodes / 450 edges，以及实机校准后的启动、RSS、包体、交互预算。
7. renderer owner、PNG 背景、PDF 单页/分页/页面尺寸、固定字体/嵌入/子集/缺 glyph 策略。
8. canonical schema、极大画布/内存上限。图标/Dock 激活新建空白已是用户需求，不再作为普通偏好确认；只有 Spike 证明不可实现时才发起范围变更。

### 4.2 公开发布前

1. source-available dual license 的最终文本与商业授权文本，法律审阅结果。
2. 第三方依赖许可证兼容与 notices。
3. Windows WebView2 bootstrap 和 MSI/NSIS 选择。
4. macOS 签名/公证、Windows code signing 的身份、凭据和成本。
5. GitHub 仓库、安装包、发布说明与任何对外操作的明确授权。

规划不会替用户选择产品名、扩展名或许可证文本。

## 5. 建议执行编排（不自动派发）

1. 先由同一 Agent 完成 MM-000，用户确认后执行 MM-010。
2. MM-020 为根配置冲突热点，必须单独完成。
3. MM-030 core 后，MM-040 layout/export 与 MM-060 host/file 可并行；MM-050 必须等待 MM-040 的共享 layout。
4. 只有 decision=native-host 才在 MM-060、MM-040 后串行启用 MM-045；MM-070 只依赖 MM-050，偏好由 MM-080 接线。
5. MM-090 独立 QA；失败开责任卡，修复后必须完整重跑 MM-090，不允许只复跑失败用例。
6. MM-100 只做本地发布准备；MM-110 由未参与实现的审阅 Agent 复验。

建议角色与推理强度：

| Lane | 建议角色 | Reasoning |
| --- | --- | --- |
| Spike/ADR | Architect + platform/export specialists | high |
| Core/schema/history | domain implementer + test reviewer | high |
| UI/onboarding | frontend implementer | medium/high |
| Native file/lifecycle | Rust/platform implementer | high |
| Export/font/PDF | graphics/export implementer | high |
| QA/release review | independent tester/critic | high |

可用规划共识角色为 Planner → Architect → Critic，必须按顺序审阅；当前文件仅是 Planner draft，不代表 Ralplan 共识已完成。实现阶段如需耐久目标跟踪，默认可由用户选择 `$ultragoal`；多 lane 并行可选择 `$team` 并把证据回收到目标账本；`$ralph` 仅作为用户明确选择的单负责人持续验证后备。本轮不触发任何执行模式。

## 6. 主要风险与控制

| 风险 | 控制 |
| --- | --- |
| 系统 WebView 跨平台差异 | 双平台发布构建 Spike；Electron 降级 |
| React Flow state/许可锁定 | UI projection 边界、core 单一事实源、attribution ADR |
| 数据丢失/越权写入 | StateIdentity/save snapshot、host-ledger TargetAuthorization、session-bound DocumentTargetHandle、VersionToken、平台 commit protocol 与分阶段 failure injection |
| DOM 导出不稳定 | 独立 semantic scene、无 `foreignObject`、三层 golden |
| 中文字体/PDF 延迟爆雷 | Spike 前置字体、分页、跨查看器验证 |
| “轻量”变成口号 | 固定设备与 P95 预算，记录 Tauri/Electron 原始对照 |
| 许可误伤允许的工作用途 | 不用 PolyForm NC；双重许可方向 + 法律审阅 |
| 多 Agent 文件冲突 | task card 专属路径、显式依赖、根配置卡单独执行 |

## 7. 交付文件

- `.omx/plans/prd-minimal-mind-map-tool.md`
- `.omx/plans/architecture-minimal-mind-map-tool.md`
- `.omx/plans/test-spec-minimal-mind-map-tool.md`
- `.omx/plans/task-cards-minimal-mind-map-tool.md`
- `.omx/plans/planner-summary-minimal-mind-map-tool.md`
- `.omx/plans/risk-register-minimal-mind-map-tool.md`
- `.omx/plans/decision-register-template-minimal-mind-map-tool.json`

## 8. 下一道门

当前版本已继续响应 Critic Review 2 的 `ITERATE`；必须先返回 Architect 复核 G1 digest bridge、authorization ledger、selected-canvas 合同、证据路径和 unsigned packaging 边界，只有其 approving verdict 后才进入 Critic 再终审。两者按顺序批准才可标记 `ralplan_consensus_gate.complete: true`。

## 9. Revision 记录

- 2026-08-26：按 Architect M1-M6 修订。引入永不复用 StateIdentity、不可变保存快照与明确 viewport/theme dirty 语义；闭合 renderer 唯一 owner 与条件 MM-045；补充 macOS/Windows commit protocol、强制 VersionToken 和 failure injection；定义 LaunchRouter 队列/ready/normalize/dedupe/action/ack；固定字体/换行/node-size authority 与确定性边界；拆分 host/canvas ADR 和评分，Flutter rejected；Spike harness 移入 `scripts/runtime-spike/**`，补齐目录规则、任务依赖、条件命令和 QA 完整复跑。
- 2026-08-26：按 Critic C1-C6 修订。增加可机器验证的 `recommendation-ready|blocked` 决策状态与全失败阻断语义；Save As/Export 引入一次性 `TargetAuthorization` 和 dialog→commit TOCTOU 复核；收紧 `ui → export/layout → core` 与 schema/viewport 边界；新增 R-001～R-016 风险登记册、AC-01～AC-14 追踪矩阵、G0/G1/G2 可读/机器登记；把 13 张定义卡统一补齐精确路径、双平台证据、Risk IDs 与 STOP/BLOCKED 回报规则，并明确 12 张常规执行卡 + 1 张条件卡。
- 2026-08-26：按 Architect Review 3 的 M1-M3 修订。把一次性 Save As/Export 选址授权与普通 Save 的 session-bound opaque `DocumentTargetHandle` 分离，闭合 open/Save As 后继续保存、撤销和越权拒绝；把 decision validator 固定为 `spike-result`、`bootstrap`、`packaging` 三个阶段 profile；将集成测试改为获选画布 projection，只有 React Flow 分支才加载其专属断言。
- 2026-08-26：按 Critic Review 2 的 F1-F5 修订。G1 逐轨绑定 approved value、PASS evidence digest、Accepted ADR id/version/hash 与不可变 source Spike snapshot；一次性 authorization 改为 host-ledger opaque reference并覆盖 forged/replay/expired/wrong-kind；清除架构残留 React Flow 硬编码；修正 MM-010/MM-050/MM-060 的写入权限、双平台 raw/aggregate evidence 和 AC-03 稳定入口；MM-100 仅允许 G2 精确范围内的 unsigned 候选安装测试，test-signing/签名仍需独立授权。
