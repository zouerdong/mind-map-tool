# 首次试用修复完整任务卡

日期：2026-09-13。配套[开发指南](./dogfood-repair-development-guide-2026-09-13.md)。编号 DFR，避免覆盖历史 PRR 证据。

## 全卡共同约束

执行前读取 AGENTS.md、PRD、本指南、当前规划入口和相关 Accepted ADR。起点包含 `9483634`、`f6d4e6d`、`12f8f92`；记录实际 HEAD。不得重做已完成修复，不得把此前单测通过当成原生验收。

当前规划编写时工作树已有用户修改 `AGENTS.md`、删除 `CLAUDE.md`，执行者不得还原、删除或提交这些用户改动。若需要修改重叠的 AGENTS.md，先展示最小状态补丁并协调；不动 CLAUDE.md。新候选必须来自可追溯 clean source；可采用不包含无关修改的隔离 checkout，记录来源和差异。

负责人转发整卡并指示执行后，DFR-010～030 可按顺序实施；先把本卡界面决定同步进 PRD/ADR 0012。同步当前状态不得把授权范围扩大为正式发布。涉及 `.omx` 共识镜像冲突，先只读核对并回报，不能改写历史快照。

所有卡禁止：新 schema、批量迁移、生产配置/CI 修改、新运行时依赖、关闭质量门、VoiceOver/系统设置修改、全局安装、签名公证、凭据访问、push、上传和发布。删除仍按负责人既有明确范围；没有必要就保留现场。

共同 STOP：存在数据丢失风险、来源不明改动重叠、需改 schema/生产配置、需新增依赖、越过允许路径或参考/现行批准互相冲突时停下，提交准确问题和最小建议。失败证据保留，不改写为 PASS。

## 风险表

| ID | 风险 | 验证或处置 |
| --- | --- | --- |
| R1 | core 更新但画布陈旧 | 同时检查显示、保存、撤销结果 |
| R2 | 几何队列丢意图或未处理异常 | ready/pending/failed、部分失败及取消节点 |
| R3 | 新旧几何口径混用、眉题/runs 丢失 | 从空白创建和编辑测试，共享视觉测量 |
| R4 | 菜单事件重复或无法操作 | 原生鼠标及快捷键各一次，效果只发生一次 |
| R5 | 干净画布与入口可发现冲突 | 按指南显式状态规则对照实机截图 |
| R6 | 旧文件/Graph JSON 数据受损 | 保存重开及图结构数量/文本/连线核对 |
| R7 | 候选混入无关改动或旧产物 | clean source、inventory、产物 hash |
| R8 | 仅移除断言掩盖问题 | 真实视图和文档一致性验收 |

## DFR-010：复核并补全状态同步修复

前置：负责人要求执行本整卡。风险：R1/R2/R4/R8。

允许修改：`packages/ui/src/canvas/{editor-canvas,use-canvas-session,geometry-barrier}.ts*`、对应 `packages/ui/test/` 测试；`apps/desktop/src/app/mindmap-app.tsx`、对应应用集成测试；本批次规划及 `docs/quality/` 回报。

步骤：按指南§1审查已提交补丁；统一 mutation/通知；修复 ready 拒绝未处理、队列部分失败通知、取消节点误删字体意图（先用用例确认再修）。验证字体切换后真实显示更新，一次撤销同时恢复字体及尺寸。逐项定位菜单报错，菜单 host 修改若必要先回报路径扩展。

验收：没有陈旧节点、整页崩溃或未处理拒绝；失败时意图和用户文本保留；测试断言显示结果而非只检查 session。运行受影响 UI 测试门及应用集成测试、typecheck、lint。STOP：需重写会话架构或文件协议。交付：commit、根因/用例和剩余风险；下一卡 DFR-020。

## DFR-020：恢复既定卡片视觉与连续编辑

前置：DFR-010。风险：R1/R3/R6。

允许修改：`packages/ui/src/canvas/`、`packages/ui/src/controller/` 及对应 UI 测试；`packages/export/src/visual-style.ts` 及对应视觉测试（仅既定契约修复）；应用集成测试；`docs/product/visual-state-tokens-2026-09-06.md` 的实施澄清，不改已批准色彩/几何目标。

步骤：复核 `12f8f92`；逐条对齐创建/正文/眉题/runs/字体度量；修正 pending 编辑与 ready 编辑差异；确认双击直接输入、字号与文字不跳变；验证隐藏框线和布局端口表现。短文本卡宽≥120，眉题存在时正文编辑不缩掉眉题所需高度。

验收：同一合成内容创建、编辑、保存重开后视觉一致；暖白/黑板色彩正确；既有文件不自动重排；四格式不丢文本或关系。运行完整受影响 UI 与应用集成门、export 视觉契约、typecheck/lint/build。STOP：需要迁移旧文件或改变布局算法/产品样式。交付：修复列表与从空白操作的截图需求清单；下一卡 DFR-030。

## DFR-030：恢复整理可发现性与轻量操作面

前置：负责人转发本卡并要求执行视为采用指南§3方案；先同步 PRD/ADR 0012，再改代码。风险：R4/R5。

允许修改：`docs/product/v1-product-spec.md`、`docs/product/visual-state-tokens-2026-09-06.md`、`docs/decisions/0012-zero-chrome-canvas-command-surface.md`、必要决定登记及当前规划状态；`apps/desktop/src/app/mindmap-app.tsx`、`app-header.tsx` 中复用组件、`shortcut-table.md`；`packages/ui/src/canvas/context-toolbar.tsx`、`editor-canvas.tsx`；对应零 chrome、快捷键、工具条和集成测试。

步骤：无节点显示底部创建提示；两个以上节点显示右上“整理 ⇧⌘L”，复用 dispatcher；选中工具条定位主选附近并夹紧视口；保留系统菜单。既有“零 chrome”测试改为检验新的批准状态，不能删掉整组测试。同步快捷键表中已过期的“垂直树”说明为默认横向分层、可选纵向。

验收：空白/单节点/多节点/选中四态符合指南；800×600 可操作；点击整理和快捷键均只产生一次布局命令；输入/IME 不误触；暖白/黑板可读。运行全部受影响界面和快捷键测试、typecheck/lint/build。STOP：需要新增常驻导航或无边框窗口。交付：实际界面状态说明；下一卡 DFR-040。

## DFR-040：一次新候选与真实用户路径

前置：DFR-010～030 完成，实际 source clean；产品代码不再临时修改。风险：R1～R8。

允许写入：本轮 `.tmp/` 专属证据、既有构建输出目录、`docs/quality/dogfood-repair-report-2026-09-13.md`。不修改生产代码、runner、预算或配置。

步骤：按根 README 的 `pnpm bundle:tauri` 与现有 G2/bundle gate 参数生成一次 unsigned 候选，使用本轮新 inventory。DMG 核验后从本轮应用执行：

1. 空白双击，输入中文；创建三个节点并连线。
2. 点击字体切换两次、字号/粗体/眉题/形状/框线，检查显示和撤销重做。
3. 点击系统菜单主题、整理、适应画布，验证鼠标和对应快捷键；输入时测试隔离。
4. 点击浮动整理按钮，观察连线与动画；保存、关闭后重开，确认文本/布局/样式。
5. 导出 Graph JSON、SVG、PNG、PDF，核对文本与节点/边；Graph JSON 实际解析。

保存空白、多节点选中、整理后、黑板四张实际截图。受控测试使用合成数据，不操作用户真实脑图。应用可以从本轮候选路径启动；不必修改系统文件关联或覆盖现有安装。

验收：上述路径全通过，报告标明 source/hash 和实际操作结果。无需 advisory、性能20轮、VoiceOver、完整发布矩阵。发现产品问题立即停止本卡，回责任卡修复；新 source 重新运行受影响验收后构建，保留失败记录。

交付：DMG 路径/hash、简短报告、截图、未运行项。STOP_FOR_INDEPENDENT_REVIEW，禁止直接宣称已获负责人试用接受。

## DFR-090：独立审阅与试用交付（审阅 Agent 保留）

前置：DFR-040 交回。允许：只读代码、报告与候选核验；新增独立审阅意见和必要状态文档。风险：R1～R8。

核对已报缺陷与修复一一对应、关键边界未被删除校验掩盖、截图符合原视觉方向、候选与源码一致。按真实操作复核字体和整理等最关键路径即可。ACCEPT 后把试用件交负责人；负责人满意才讨论后续正式发布，G-FINAL 不自动批准。

## 固定回报格式

```text
任务：DFR-xxx
状态：PASS / BLOCKED / STOP_FOR_INDEPENDENT_REVIEW
Base / SourceCommit：完整 hash
修改文件：实际路径
关键决定：根因、具体修法、已完成补丁的复核结果
验证命令及结果：含真实 UI 操作，不以单测替代
未运行项/原因：性能、VoiceOver、完整发布矩阵本批不要求
风险/阻塞：对应 R1～R8，无则 none
下一卡输入：commit、证据目录；DFR-040 后停等独立审阅
```
