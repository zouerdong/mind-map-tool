# Architect Review 4 — Minimal Mind Map Tool

## Verdict

**APPROVE**

当前规划已满足第三轮提出的 M1–M3 必须修改项，并且未发现对 Critic C1–C6 修订成果的回退。该结论仅表示 Architect 架构审查门通过：它不代表实现已经完成，也不授权安装依赖、签名、公证、上传或公开发布；Ralplan 共识仍需 Critic 最终复审通过。

## 第三轮必须修改项复核

| 项目 | 结论 | 核验证据 |
| --- | --- | --- |
| M1：普通保存的持久文档能力 | PASS | 架构已明确区分一次性、对话框授权产生的 `TargetAuthorization`，与 session/window-bound、不可伪造的 `DocumentTargetHandle`。`openDocument` 和成功的 `commitDocumentAs` 返回 handle 与版本 token；后续普通保存通过 `commitCurrentDocument(windowSessionId, documentTargetHandle, expectedVersionToken, bytes)` 完成，无需重复弹出 Save As。handle 在关闭时撤销，不能跨窗口使用，成功提交可轮换 handle；伪造、过期、撤销和跨窗口使用均须失败。该契约已同步进入 PRD AC-06/AC-08、测试规格、R-005/R-014 以及 MM-030/MM-060/MM-080/MM-110。 |
| M2：决策校验 profile | PASS | 决策模板与架构统一定义 `spike-result`、`bootstrap`、`packaging` 三个 profile，并明确各自可通过的 gate 与禁止越权的范围。MM-010、MM-020、MM-100 分别使用对应的显式 `--phase` 参数，避免同一验证器在不同生命周期阶段隐式放宽条件。 |
| M3：画布实现条件化边界 | PASS | UI 集成、测试与边界检查已改为“获选画布 projection”，并统一执行 `check-boundaries.mjs --scope selected-canvas`。脚本必须从已批准决策读取获选实现且 fail-closed；只有 React Flow 获选时才检查 React Flow projection，自定义画布获选时则断言不存在 React Flow 依赖。依赖方向保持 `ui → export/layout → core`，未获选候选不得进入实现依赖图。 |

## Critic C1–C6 回归检查

| Critic 条件 | 结论 | 复核结果 |
| --- | --- | --- |
| C1：四轨决策、顶层推荐与全失败语义 | PASS | 顶层与四条轨道均有 `recommendation-ready | blocked` 语义；候选区分 PASS、FAIL、NOT_TESTED。只有 PASS 候选可被推荐；全失败时保持 `blocked` 与 `recommended: null`，不存在强迫推荐失败候选的路径。 |
| C2：文件授权、依赖图与交互边界 | PASS | 一次性 target authorization 关闭对话框选择到提交之间的 TOCTOU；持久 handle 解决打开/Save As 后的普通保存，同时限制在当前窗口会话。缩放、画布中立措辞、selected-canvas 边界与任务依赖未回退。 |
| C3：风险登记闭环 | PASS | 风险登记保持 R-001…R-016，均具备 owner、trigger、action、evidence 与 status；R-005、R-014、R-016 已分别覆盖目标授权/handle 生命周期和 profile 误用。 |
| C4：验收标准追踪 | PASS | PRD 保持 AC-01…AC-14；测试规格为每项 AC 指定 owner、测试、命令、证据和 reviewer，MM-090 汇总证据索引，MM-110 执行最终审阅。 |
| C5：任务卡可分派与双平台证据 | PASS | 任务集保持 13 张卡，其中 12 张正常卡与 1 张条件卡 MM-045；每卡含限定路径、依赖、STOP/BLOCKED 条件和验证命令。涉及平台行为的卡要求 macOS/Windows 证据，代理间以路径所有权和 gate 控制冲突。 |
| C6：G0/G1/G2 门槛 | PASS | G0、G1、G2 的责任和进入条件仍明确：调研结果、实现启动、打包准备分离；`packaging` 仅覆盖本地打包证据，不隐含签名、公证、凭据、上传或发布授权。 |

## 最强反方、真实张力与综合方案

### Strongest steelman antithesis

最强反方仍是：第一版直接选择 Electron，而不是优先追求更小安装包。Electron 的运行时成本更高，但它通常能提供更一致的跨平台 Web 渲染、字体和导出行为，更成熟的桌面生态，以及更低的实现与诊断不确定性。对于要求 macOS/Windows 行为一致、中文导出确定性和可由多个 Agent 分工实现的项目，这一组合风险可能比包体积更重要。因此 Electron 必须作为真实可胜出的候选，而不能因为“轻量”叙事而被形式化陪跑。

当前四轨 spike、候选证据要求、PASS-only recommendation 和全失败 blocked 语义公平保留了这一路径；架构没有预先把 Tauri、Electron、Flutter 或某个画布方案写成既定答案。

### 真实 tradeoff tension

1. **轻量体积 vs. 跨平台确定性**：更小的桌面壳可能带来更多 WebView、字体、PDF 与平台差异；自带运行时会增大体积，但提高一致性和诊断能力。
2. **语义化 SVG/PDF vs. 中文字体确定性**：保留文本语义更利于后续编辑与无损缩放，但跨平台字体替换会破坏排版一致性；路径化可提高视觉确定性，却牺牲可搜索性并增加文件体积。
3. **最小权限 vs. 顺畅普通保存**：每次保存重新授权最保守，但破坏原生文档体验；持久路径权限最顺畅，却扩大攻击面。window/session-bound opaque handle 配合版本 token 是两者之间的明确折衷。

### 可行 synthesis

维持“证据先行、失败关闭”的四轨选择，并把可逆决策延后到 G0/G1：运行时、画布、SVG/PDF 与中文字体分别通过 spike 得出推荐。实现层以平台无关 core 为单一文档与命令真相，UI 只消费获选画布 projection，导出经 `export/layout` 复用同一布局，桌面宿主独占文件能力与原子提交。文件选择使用一次性 `TargetAuthorization`，普通保存使用受窗口会话约束的 `DocumentTargetHandle` 与乐观版本 token。这样既不预锁方案，也让选定方案之后的边界、保存安全与多 Agent 分工可执行。

## 原则违反检查

- **未预锁技术栈**：PASS。候选只能由 spike 证据和 gate 推进，失败候选不能被推荐。
- **领域逻辑与桌面框架隔离**：PASS。core 不依赖桌面或 UI，系统 API 仅位于 platform/desktop 边界。
- **跨平台差异只进入适配层**：PASS。平台特有行为和证据均落在适配/验收范围。
- **本地优先、无服务器后端**：PASS。第一版不要求账号、云端、遥测或服务器；导出与文件处理均为本地能力。
- **规格与 ADR 先于实现**：PASS。G1 要求批准的决策、版本和证据一致后才允许 bootstrap。
- **最小权限与数据完整性**：PASS。一次性授权、窗口会话 handle、版本 token、原子提交、失败不更新 saved identity 形成闭环。
- **多 Agent 冲突控制**：PASS。任务路径、依赖、gate 与 STOP/BLOCKED 语义已明确；不得绕过未通过的决策门。
- **发布授权边界**：PASS。规划未把打包等同于签名、公证、上传或发布。

## 非阻断残余风险

1. Windows 上替换语义、文件占用、杀进程恢复与版本 token 的真实行为仍须以双平台故障注入证据关闭；这是实现风险，不是当前规划缺口。
2. 中文字体许可、字体缺失和 PDF/SVG 文本语义之间仍可能迫使产品选择“路径化”或受控字体包；四轨决策已提供阻断机制。
3. macOS/Windows 的文件关联、冷启动/暖启动、焦点与未保存关闭流程仍依赖真实 OS 自动化环境，MM-080/MM-090 不应以单平台模拟证据替代。
4. `packages/export/layout` 的具体包导出映射和循环依赖需在 MM-020/MM-040 中由边界脚本验证。
5. “免费传播、商业用途收费”的许可意图不是标准开源定义；正式发布前仍需单独的法律与许可证审查。该问题不阻断产品架构和开发计划，但阻断对外发布条款定稿。

## 下一门槛

Architect gate 已通过。下一步应由 Critic 对当前冻结版本进行最终复审；在 Critic 批准前，不应宣称 Ralplan 共识完成，也不应开始被 G1 阻断的实现任务。
