# VRA-000：对齐规划基线与任务所有权（对账报告）

日期：2026-09-06。执行依据：[visual-alignment-task-cards-2026-09-06.md](../plans/visual-alignment-task-cards-2026-09-06.md) VRA-000 卡；指南 [§5 迁移表](../plans/visual-alignment-development-guide-2026-09-06.md)。本报告是 G-BASE 的判定材料：同伴审查结论见文末，用户批准另行记录，不以本报告冒充用户批准。

## 0. 执行环境记录

- HEAD：`8394f106924eec9b9a193a19aae2698770081023`（与批次 manifest `sourceHead` 一致）。
- 工作树 dirty，含三类变更，本卡只新增/修改文档，未触碰前两类：
  1. MRT-004W2R2 生命周期整改（`apps/desktop/src-tauri/**`、`packages/platform/**`、`apps/desktop/src/app/**`、`docs/decisions/0008-*.md`、部分 `.omx/reviews/2026-08-30-mrt-00*`），与前批审查一致，属独立生命周期 owner；
  2. 2026-09-06 视觉对齐批次文档（`.omx/plans/visual-*`、`docs/planning/visual-*`、`docs/product/visual-target-brief-*`、两份入口 README）；
  3. 本卡对账更正（本报告 + AGENTS.md/v1 三份头部状态行 + 新 manifest + planning README）。
- 验证方法：`shasum -a 256` 重算全部登记 hash；`diff`/`cmp` 比较快照与镜像；`git log`/`git show` 核对批准链提交。所有命令在本机执行，逐项结果见下。

## 1. 旧基线与批次 hash 复验（步骤 1）

### 1.1 旧 Ralplan 共识基线（9 文件 + manifest 自身）

`.omx/plans/ralplan-consensus-minimal-mind-map-tool.json` 登记的全部 hash 重算**全部 MATCH**：7 份 artifacts（prd/architecture/test-spec/task-cards/risk-register/decision-register-template/planner-summary）、2 份 reviews（architect/critic）、manifest 自身（`00f63fd1…`）。历史基线未被篡改，可继续作为审计锚点。

### 1.2 G1 绑定证据链

decision-register.json `gates.G1.acceptedAdrVersions` 与 `sourceSpikeResult` 登记 hash 重算**全部 MATCH**：ADR 0001/0002/0004/0005（Accepted 1.0.0）与 `docs/quality/runtime-spike-decision.json`（`24ea43fa…`，sidecar 一致）。ADR 0003/0006/0008 状态为 Accepted、0007 为 Proposed，与登记册一致。**无批准证据漂移。**

### 1.3 本批（2026-09-06）快照、镜像与媒体

4 份快照 hash 与批次 manifest 登记**全部 MATCH**；4 份 docs 镜像与快照 `cmp` **逐字相等**；2 份入口 README、同伴审查记录、`input/样式参考.JPG`、`input/动态样式参考.mov` hash **全部 MATCH**。本批镜像精确匹配快照，入口链接可达。

### 1.4 五份 v1 镜像 vs 旧快照 drift 逐项结论

| 镜像 | manifest 标注 | 实测 diff | 结论 |
| --- | --- | --- | --- |
| `docs/product/v1-product-spec.md` | substantive | 88 行：状态行、§1.1 平台范围、§5 新增行（整理/全局唤醒/键盘/主题/形态/字体/富文本）、AC-01/07/12/14 平台语义、AC-15/16/17、决策清单 ✅、G0/G1 ✅ | **全部增补有批准证据**：G1 平台变更与选型见 decision-register（2026-08-26）；AC-15/16/17 与 §5 新行均为 `[from-user 2026-08-26/27]`，git `f6e7590` 提交信息逐条对应，PRD 修订先于实现入库。**镜像（含增补）= 当前有效 PRD；快照 = 历史基线，两者并存不冲突** |
| `docs/planning/v1-task-cards.md` | substantive | 49 行：头部状态行 + MM-085/088/089 三卡 | MM-085/088/089 增补有 `[from-user 2026-08-27]` 与 git `f6e7590` 批准链；三卡已实现（`f6e7590`/`f2d190e`/`0e66c44`），键位定稿 `798a0fa`。头部"G0 尚未批准"为陈旧说明，本卡已更正（§2）。**镜像有效，但派发地位被 VRA 批次接管（见 §4）** |
| `docs/planning/v1-architecture-proposal.md` | status-heading-only | 4 行（仅状态行） | 头部差异属实且方向正确（共识完成）。本卡已补 G1 已批更正（§2）。**镜像有效，降级为历史提案** |
| `docs/quality/v1-test-spec.md` | status-heading-only | 4 行（仅状态行） | 属实。**镜像有效**。测试基线的规模/门槛更新归后续质量卡（MRT-010/VRA-080），不在本卡 |
| `docs/quality/v1-risk-register.md` | status-heading-only | 3 行（新增状态行） | 属实。**镜像有效**。风险状态刷新归 MRT-010/VRA-090 核销，不在本卡 |

**AGENTS.md「镜像不一致须停止派发」规则的本次裁决**：五项 drift 均已逐项给出上述结论，非静默择一；新批次（VRA）即为重新完成的规划审阅入口。对账后镜像新 hash 登记于 [visual-alignment-baseline-manifest-2026-09-06.json](../plans/visual-alignment-baseline-manifest-2026-09-06.json)。

## 2. 陈旧状态说明更正清单（步骤 2）

依据：decision-register（G0/G1 approved 2026-08-26）、根 README（已是正确状态，未动）、git `26c221b`/`f6e7590`。只改状态说明，不动历史正文与技术决策内容；已批 macOS-first、Tauri/React Flow/export/font 选择**无一倒退**。

| 文件 | 更正 | 性质 |
| --- | --- | --- |
| `AGENTS.md` | 「产品发现阶段」段 → 实现阶段（G0/G1 已批、G2 pending、MM-010..090 已执行、派发以 VRA 批次为准）；「技术栈尚未确定」段 → 标准命令以根 README 为唯一来源 | 状态说明 |
| `docs/planning/v1-development-guide.md` | 状态行下补更正注记（G0/G1 已批 + 本文件降级为历史镜像） | 状态注记 |
| `docs/planning/v1-task-cards.md` | 同上；并指向 §4 映射清单 | 状态注记 |
| `docs/planning/v1-architecture-proposal.md` | 同上（G1 已批、ADR 0001–0006/0008 Accepted） | 状态注记 |
| 根 `README.md` | 无需更正（已反映 G1 后状态） | — |
| 项目 `CLAUDE.md` | **已批准并执行（2026-09-06，用户批准）**：「项目现状」与「当前验证命令」两段按本对账事实更正（实现阶段、VRA 派发入口、标准命令锚定根 README）；安全红线（Gate 前禁止 schema/生产 UI/依赖变更，G2 前禁止签名/发布）保留 | 已完成 |

## 3. PRD 冲突与待决条款（步骤 3）

原则：已有批准据证据对齐；无证据列待决；不猜测。G-VIS（用户看 VRA-010 原型后一次确认）是这些条款的裁决点，届时按 PRD 增补流程改文字，不在此预改。

| # | 条款 | 现状 | 处置 |
| --- | --- | --- | --- |
| C-1 | 主题底色：PRD §5「纯白与纯黑，无纸张/粉笔质感」[from-user 2026-08-26] vs 参考/视觉增补推荐暖白 `#F9F8F4`（brief §2 已自我标记须显式登记） | 真实条款冲突，参考方向用户已选但 PRD 文字未改 | **待 G-VIS**：D1 确认后按增补流程改 PRD §5；黑板为同构深底方案 |
| C-2 | 节点默认形态：PRD §5「默认圆角卡片**描边**、可选手绘圈」vs 参考/D1「近黑**实心**卡片」 | 同上 | **待 G-VIS**（D1）；手绘圈去留一并裁决 |
| C-3 | 整理布局语义：PRD §5「垂直树布局」+ AC-15「确定性垂直树」vs VRA-030「DAG 分层：多父只放一次、SCC 缩点、不删边、汇聚/跨层」。现有 `organize.ts` 为 DFS 生成树破环实现（`f6e7590`），对多父图会把 DAG 折成树 | VRA 指南 §5 已裁决方向（MRT-007 整理算法→VRA-030）；**G-VIS 2026-09-06 已裁决：整理默认横向分层、可选纵向** | **已裁决**：AC-15/§5 措辞更新为「默认横向分层布局（保留多父与跨层）、可选纵向」+ 线形态双轨（见 VRA-010 G-VIS 决议 D7/D8）；由 VRA-020 按 PRD 增补流程执行，VRA-030 按横向默认重写算法 |
| C-4 | 眉题（kicker）：PRD 无此概念；D3 提议可选单行眉题 | 新产品语义 | **待 G-VIS + G-SCHEMA**（字段、runs、测量、undo 由 VRA-020 ADR 定） |
| C-5 | 箭头与线型：PRD §5 未规定箭头；D4 提议默认箭头 + 实/虚线外观 | 新产品语义 | **待 G-VIS**；线型持久化进 G-SCHEMA |
| C-6 | 强调色语义扩展：PRD 已批 `#D97757` 用于选中/手柄/焦点；D2 扩展为节点「普通/强调」色彩角色 | 语义扩展（token 复用，非新色值） | **待 G-VIS** |
| C-7 | 键盘表：PRD「键位以快捷键表为单一事实源」 | **已解决**：`apps/desktop/src/app/shortcut-table.md` 已按 2026-08-29 用户 review 定稿（git `798a0fa`，⌥Space 全局热键 + Enter 语义已定） | 登记事实，无待决 |
| C-8 | 全局唤起：AC-16 + MM-088 已实现（`f2d190e`） | 机制完成，原生五状态验证归 MRT-008 | 登记事实 |
| C-9 | 层级判定待议项：PRD §5「层级方向交互语义待议，v1 以 source→target 为层级」 | 与 VRA 指南「连线方向是层级输入、不强制单父树」一致 | v1 维持不变，无冲突 |

## 4. 旧问题 → 新卡映射与所有权（步骤 4）

迁移依据：指南 §5 表逐项展开。**没有任何旧范围凭空消失**；每行恰有一个 owner。「已实现」指代码已入库，其验收状态以对应证据文件为准。

| 旧 ID | 内容 | 新归属 | owner | 必测项（承接验收） |
| --- | --- | --- | --- | --- |
| MM-085 | 一键整理（垂直树 + CSS transition 动画） | 算法→**VRA-030**（DAG 分层重写）；动画→**VRA-060**（协调者替代 CSS transition）；入口/undo 契约保留 | VRA-030/060 | graph-adversarial 全集；12 节点参考 DAG；10k 链；第二次 no-op；一次 undo 恢复 |
| MM-088 | 全局唤醒热键（⌥Space，已实现） | 原范围保留；焦点/换绑/原生验证→**MRT-008**；VRA-050/070 只重排操作入口 | MRT-008 | 真实 macOS 五状态（前台/遮挡/他应用前台/中文编辑/绑定冲突） |
| MM-089 | 键盘操作完整性（已实现，键位 `798a0fa` 定稿） | 已完成；IME/焦点收口→MRT-008；视觉焦点样式→VRA-050 | MRT-008（收口）/VRA-050（样式） | test:a11y + 人工焦点检查 |
| MM-090 | E2E 质量执行（已执行，`b23a1ff` 全绿） | 已完成；后续质量演进→MRT-010/VRA-080 | — | — |
| UXD-001 | 体验方向选择 | **VRA-010**（参考方向用户已选，替代多方向探索；保留完整状态与用户校准） | VRA-010 | 状态矩阵无空项；中英双语成立；G-VIS 确认 |
| UXI-001 | 极简 App Shell + 核心画布结构 | 拆分：画布/节点/操作面→**VRA-050**；shell/状态接入→**VRA-070** | VRA-050/070 | 状态矩阵；成套截图；port 调用次序不变 |
| UXI-002 | 状态补齐、动效、a11y、最终视觉验收 | 动画→**VRA-060**；状态/a11y→**VRA-050/070**；最终验收→**VRA-080** | VRA-060/070/080 | 录像 + 关键帧；≤1 CSS px 端点误差；reduced-motion |
| MRT-001..003V | 保存队列/redo identity/原生 dirty-close（已完成，`8394f10`） | 保留既有验收 | — | 回归由 VRA-080 内容链复测 |
| MRT-004W2R2 | generation 线性化与 native 证据收口 | **原卡保留**，独立生命周期 owner；通过前不得把 browser fake 当原生完成；解锁 G-NATIVE | 原 W2R2 owner | 卡内 R1–R4 红灯与 native 事实 |
| MRT-005 | 不可信文件、schema/canonical 不变量、bounded read | **原卡保留**；其中 schema/commands 防线与 **VRA-020** 由同一整合 owner 串行协调（`packages/core/src/index.ts`、fixtures）；host 文件范围仍归 MRT-005 | MRT-005 + VRA-020（协调，指南 §6.3） | 非法 bytes 结构化结果；50MB preflight；命令序列 validate+encode+decode 等价 |
| MRT-006 | 三格式导出一致性（CR-008/009/015） | 视觉/导出一致性→**VRA-040** 吸收（旧 CR 与 golden 逐项列出由 VRA-040 承接）；剩余字体资源上限/失败路径→**MRT-006 保留** | VRA-040（视觉）/MRT-006（安全） | text-style-matrix；四格式几何对照；独立 raster oracle |
| MRT-007 | 整理算法（CR-013）+ 偏好损坏恢复（CR-014） | 算法→**VRA-030**（旧整理子项停止重复派发）；偏好恢复→**MRT-007 保留** | VRA-030 / MRT-007 | VRA-030 反例集；preferences 损坏不 fatal |
| MRT-008 | 快捷键/焦点状态机、事务式全局换绑 | **原卡保留**；VRA-050/070 消费其契约接口 | MRT-008 | action×focus×IME×platform 契约表；换绑失败旧键仍工作 |
| MRT-009 | PRD P0 样式编辑操作面（CR-010） | **VRA-050/070 吸收**（含原字号/粗体/下划线、字体、形状、frame 开关与键盘能力，非只新增颜色/眉题） | VRA-050/070 | mixed selection；runs 不清空；framesVisible 真隐藏 |
| MRT-010 | 唯一质量门禁与证据链（CR-016/019） | **原卡保留**（质量总入口）；视觉/动效门禁在 **VRA-080 同期**接入唯一入口；**VRA-090** 只核销余项，不得借拆段绕过旧前置 | MRT-010 owner | fail-closed 负向测试；证据 schema 校验 |
| MRT-011 | release 性能/包体（CR-017，1.5MB chunk + 41.6MB 字体） | **原卡保留**；VRA-080 性能层（300/450 + 实际字体）供其复用 | MRT-011 | release 实测启动/RSS/导出；启动不加载三字体+wasm |
| MRT-012 / G2 | 发布前安全、许可证、CSP、标识（CR-018/020/021） | **原卡保留**；ADR 0007（licensing）仍 Proposed | MRT-012 | Cargo license lockfile 审查；CSP 最小化 |
| CR-006..CR-021 | v0.1.3 审查问题全集 | 已按上述 MRT 卡行归属；无孤立 CR | 随行 | 随行 |

### 4.1 对旧「全部 UI 等 MRT-004」规则的显式替代登记

旧规则（`.omx/reviews/2026-08-30-frontend-design-strategy-and-uxd-001-task-card.md` §1）：「MRT-004 通过 + UXD-001 获用户确认：UXI-001 实现 App Shell 与核心画布界面」——即全部生产 UI 实现等待 MRT-004 完成。**自本登记起替代为**：

- 视觉原型、纯布局与共享几何（VRA-010/020/030/040 及 VRA-050/060 的隔离 browser fixture 部分）**不依赖 MRT-004W2R2**；
- 修改生产 `mindmap-app.tsx` 的壳接入（VRA-070）与任何「宣称产品可交付」仍受 **G-NATIVE**（W2R2 与当前变更匹配的通过记录 + 必要原生证据）约束；
- W2R2 owner 的工作树不被 UI 重构混入（指南 §6.5）。

## 5. G-BASE 判定与遗留

**判定：G-BASE 达成（同伴审查通过后生效，见 §6）**——所有旧差异均有结论或具体隔离项（§1.4）；每个旧未完成问题恰有一个 owner（§4）；无 hash 静默失效（§1 全 MATCH）；新入口链接可达、镜像精确匹配快照（§1.3）。新批次（VRA-010 起）可按卡派发。

遗留待用户决策（不阻塞 VRA-010 派发，因其属文档治理）：

1. 项目 `CLAUDE.md` 现状段更正（§2 末行）——建议批准，否则每个新会话仍会读到「产品未开始」的错误前提；
2. C-1/C-2（纯白纯黑 vs 暖白实心）与 C-4/C-5/C-6（眉题/箭头线型/强调角色）在 G-VIS 一并裁决；
3. C-3 整理措辞（垂直树→纵向分层）在 G-VIS 后由 VRA-020 增补流程同步 PRD/AC-15。

## 6. 同伴审查

按任务卡「独立 Agent 审查后才能标完成」要求，本报告由独立 Agent 复核（只读）。

**审查 Agent**：`vra-000-peer-review`（general-purpose 子代理）。**日期**：2026-09-06。**结论：PASS**，无未完成项、无阻塞。

| 项 | 结果 | 摘要 |
| --- | --- | --- |
| A. hash 复验 | PASS | 旧基线 10 项（7 artifacts + 2 reviews + manifest 自身）与 VRA-000 manifest 全部登记项（mirrorDriftResolution 5、statusCorrections 4、entrypoints 2）重算一致，无静默失效 |
| B. 证据链 | PASS | `f6e7590` 提交信息逐条覆盖 AC-15/16/17 与 MM-085/088/089；`f2d190e`/`0e66c44`/`798a0fa` 核实；decision-register G0/G1 approved 2026-08-26、G2 pending |
| C. 映射完整性 | PASS | roadmap 12 个旧 ID 全部有归属、无范围消失、无未界定双重 owner；与指南 §5/§6.3 逐行一致（含 MRT-005 协调、MRT-010 拆分） |
| D. 更正安全 | PASS | 5 文件 +28/−5；v1 三份仅头部注记、零正文删除；已批选型无一倒退 |
| E. 陈旧说明 | PASS | 保留原文均紧邻更正注记；CLAUDE.md 遗留已被 §2 显式登记（未动是纪律正确） |
| F. 报告质量 | PASS | 验收 5 条逐条满足；diff 行数口径可复现；唯一失效 hash（planning/README）已显式 supersede；链接抽查 7 个全可达 |

**非阻塞观察（采纳）**：MRT-005×VRA-020 的 schema/commands「整合 owner」两边均未指名具体 Agent——登记为 G-SCHEMA 派发时必须先指名的派发前置条件（见 §5 遗留）。

**审查时点说明**：审查针对 VRA-000 时点文件；其后 `docs/product/README.md` 由 VRA-010 登记（新 hash 与理由见 [visual-alignment-vra-010-manifest-2026-09-06.json](../plans/visual-alignment-vra-010-manifest-2026-09-06.json) 的 entrypointUpdates），不构成本对账的失效。

**G-BASE 正式达成**：同伴审查 PASS + §1–§5 结论齐全。VRA-010 已派发（用户 2026-09-06 指令）；VRA-020～090 的解锁仍按各自 Gate（G-PLAN/G-VIS/G-SCHEMA/G-NATIVE）执行。
