# Architect Review 5 — Minimal Mind Map Tool

## Verdict

**APPROVE**

当前冻结版已完整修复 Critic Review 2 的 F1–F5，并且未回退 Architect Review 3 的 M1–M3、首轮 Critic C1–C6、13 张任务卡、AC-01～AC-14、R-001～R-016 或 G0/G1/G2 边界。规划仍停留在产品发现与可分派合同阶段：没有产品实现、依赖安装、服务器后端、签名、公证、上传或公开发布授权。

该结论只表示第五轮 Architect gate 通过。必须在后续 Critic 以当前版本给出 approving verdict 后，才能把 durable Ralplan consensus 标为完成。

## Critic Review 2 F1–F5 复核

| Finding | 结论 | 架构核验证据 |
| --- | --- | --- |
| F1：G1 批准值与不可变 Spike 快照绑定 | **PASS** | `G1.sourceSpikeResult` 已结构化记录 path、SHA-256、generatedAt；`approvedTracks` 对 desktopHost、canvasView、exportRenderer、font 四轨分别记录 value、candidateResult、candidateEvidenceSha256 和 Accepted ADR id/version/SHA-256；`acceptedAdrVersions` 具有明确的四元素 schema，并由 bootstrap profile 交叉校验。MM-010 先在最终 JSON 内写 generatedAt，冻结 bytes 后把 SHA-256 写入独立 `runtime-spike-decision.sha256` sidecar，避免自哈希；sidecar 已进入允许路径、交付物和 `--sha256-sidecar` 验证命令。推荐、candidate evidence、snapshot 或 ADR 任一漂移都会使 bootstrap 非零，测试规格、MM-000/MM-010/MM-020 和 R-016 均已同步。 |
| F2：一次性授权的不可伪造与单次消费 | **PASS** | `TargetAuthorizationRef` 现在只是 UI 可见的 opaque bearer reference，canonical target、kind、expiry、consumed 和 token/path identity 均保存在 host ledger；host 在 commit 时以 ID 回查并再次验证。forged、expired、consumed replay、document/export wrong-kind 均有稳定错误码，并明确不创建/覆盖目标、不更新 handle/token/saved identity。AC-08、integration/IPC/E2E/人工测试、R-005 和 MM-060 均覆盖这些负向生命周期；`DocumentTargetHandle` 的 window/session 绑定、撤销、外部 token 冲突和普通保存无重复对话框合同未回退。 |
| F3：selected-canvas 中性合同 | **PASS** | 架构第 7 节已改成 `SelectedCanvasProjection` 与 `InteractionController`，不再无条件要求 React Flow。仅当 canvasView=`react-flow` 时加载其 ID、measurement、attribution 与 Pro 限制；custom 分支明确禁止 `@xyflow/react`。架构、测试、MM-020/MM-050 统一使用 `check-boundaries.mjs --scope selected-canvas`，按批准决策 fail-closed。 |
| F4：任务卡路径与 exact command | **PASS** | MM-010 的 Proposed ADR 写入路径已逐个列出；MM-050 和 MM-060 的 macOS、Windows raw evidence 与 aggregate evidence 均在各卡精确允许路径内，文件名互不覆盖。AC-03 已改用 MM-020 必须实现的稳定入口 `node scripts/quality/run-all.mjs --focus core-commands,selected-canvas`，不再依赖未定义 runner 参数。 |
| F5：unsigned packaging 与独立 signing 授权 | **PASS** | G2 `approvedScope` 结构化列出 selectedHost、candidateOutputPaths、installationTargets、allowedActions 和 deletionBoundaries，并显式排除 test-signing、signing、notarization、credential access、system trust changes、upload 与 publication。MM-100 只生成和验证 unsigned 本地候选；bundle/install 命令显式带 `--unsigned` 和 `--scope-from`，发现签名配置、凭据或越界删除时必须 fail-closed。任何 test-signing 只能另获明确授权和另开任务，不能由 G2 推定。 |

## 前序架构条件回归

### Architect M1–M3

- **M1 PASS**：一次性 `TargetAuthorizationRef` 与持久、window/session-bound 的 `DocumentTargetHandle` 职责继续分离。open/成功 Save As 返回 handle + token，ordinary Save 使用 `commitCurrentDocument`，关闭撤销且跨窗口拒绝。
- **M2 PASS**：`spike-result`、`bootstrap`、`packaging` 三个 validator profile 仍由 MM-010、MM-020、MM-100 分别显式消费；未来 gate pending 不会错误阻断前一阶段。
- **M3 PASS**：UI、测试与 boundary script 均以获选画布为条件，依赖方向保持 `ui → export/layout → core`，未获选画布不得进入构建图。

### Critic C1–C6

| 条件 | 结论 | 回归结果 |
| --- | --- | --- |
| C1：四轨、顶层推荐与全失败语义 | **PASS** | 顶层和四轨均支持 `recommendation-ready | blocked`；候选只有 PASS 且 evidence 非空才可推荐。全失败保持 `blocked` 与 `recommended=null`，评分更高的 FAIL 候选不能被强迫推荐。G1 现在额外绑定批准值和源快照。 |
| C2：架构残余风险 | **PASS** | TargetAuthorization ledger、DocumentTargetHandle、VersionToken、TOCTOU、selected-canvas、zoom/session 和依赖边界保持闭环。 |
| C3：风险 owner/trigger/evidence | **PASS** | 风险登记仍为 R-001～R-016，均具有 owner/reviewer、trigger、action、closing evidence 和 status；F1/F2 已分别进入 R-016/R-005。 |
| C4：逐条需求追溯 | **PASS** | PRD 仍为 AC-01～AC-14；测试矩阵逐项提供 owner、case、exact command、artifact 和 reviewer，MM-090 汇总、MM-110 复核。 |
| C5：任务卡独立派发 | **PASS** | 共 13 张定义卡，账本明确为 12 张常规卡 + 1 张条件 MM-045；路径所有权、依赖、STOP/BLOCKED、双平台 raw/aggregate evidence 和验证命令可独立执行。 |
| C6：G0/G1/G2 分阶段 | **PASS** | G0 只授权本地 Spike，G1 才授权正式 bootstrap，G2 只授权精确 unsigned 本地候选准备范围；签名、公证、凭据、信任修改、上传与公开发布仍须新授权。 |

## 架构完整性判断

1. **命令/history/dirty**：永不复用的 `StateIdentity`、不可变保存快照、分叉 redo 截断和 viewport/theme 差异化语义保持一致；异步保存只确认被冻结身份。
2. **文件与原子保存**：canonical schema、版本 token、两平台 commit protocol、failure injection、旧文件保留和外部修改冲突均有 owner、测试与证据路径。
3. **cold/warm open**：`LaunchRouter` 仍统一 argv、Opened/Reopen、single-instance 与 activation，覆盖 early queue、去重、同 identity 聚焦、带文件冷启动不建多余空窗和 dirty 窗隔离。
4. **三格式确定性导出**：UI 和 exporter 共用 layout；semantic SVG 不依赖 DOM screenshot；PNG/PDF 由唯一获选 renderer 产生；中文字体、缺 glyph、viewer tolerance 与尺寸/OOM 门槛均在 Spike/ADR 和 golden 中闭环。
5. **无服务器边界**：core、UI、platform、desktop 和 export 的依赖图没有服务器组件；账号、云、遥测、远程 API、端口监听和延期能力预建均明确排除。
6. **无实现状态**：`apps/` 与 `packages/` 当前只有 4 个目录职责 README，没有源码、manifest 或产品依赖；本轮文件仍是规划和审查文档。

## Strongest steelman antithesis

最强反方依旧是：第一版应直接采用 Electron，而不是把“小包体”置于运行时一致性之前。Electron 会增加安装体积和 RSS，但自带统一 Chromium，通常能减少 WKWebView/WebView2、字体、IME、PDF/PNG 渲染和自动化差异；对于一款必须同时交付 macOS/Windows、需要中文确定性导出且由多个 Agent 分工实现的桌面工具，减少跨平台不确定性可能比节省几十 MB 更有价值。

当前规划公平对待了这一反方：Tauri 和 Electron 必须用同一脚本、硬件、合成数据及阻断标准评估；数据安全或文件入口失败会直接淘汰候选；候选评分高但 exit criteria FAIL 仍不能被推荐。Flutter 也不是基于偏见淘汰，而是因 v1 需新建不可复用的 Dart core/UI/export/tooling 分支、显著扩大交付面。React Flow 与 custom view 同样由独立画布轨决定，未被 host 选择暗中锁定。

## 真实 tradeoff tension

1. **轻量体积 vs. 渲染与自动化一致性**：系统 WebView 可能更轻，但会引入双引擎差异；捆绑 Chromium 更重，却降低跨平台不确定性。
2. **语义文本 vs. 中文视觉确定性**：SVG/PDF 保留文本有利于检索和无损缩放；路径化或固定字体更稳定，却增加包体、许可和可访问性成本。
3. **最小权限 vs. 原生文档体验**：每次保存重新选址最保守但打断工作流；永久路径权限最顺畅但扩大能力面。一次性 host-ledger authorization 加 window/session-bound document handle 和 version token 是有约束的中间方案。
4. **批准可审计性 vs. 流程摩擦**：Spike snapshot、sidecar、逐轨 evidence/ADR digest 和三阶段 validator 增加操作成本，但防止 Agent 在批准后替换推荐或证据；对可并行派发的长期项目，这一成本是合理的。

## 可行 synthesis

保留四轨证据先行选择，不把“轻量”预先等同于 Tauri，也不把“成熟交互”预先等同于 React Flow。G0 只运行可丢弃 Spike；冻结的 Spike JSON 与独立 SHA-256 sidecar 构成批准来源；G1 将每轨 PASS 候选、evidence digest 和 Accepted ADR digest 绑定后，才允许 MM-020 只搭建获选分支。实现以 core document/command/session 为单一事实源，UI 只消费获选 projection，export/layout 复用同一几何合同，desktop/platform 独占本地文件能力。G2 最后只开放精确 unsigned 安装测试范围，发布类动作继续留在独立授权门外。

## 必须修改与建议修改

### 必须修改

**无。** 当前版本满足第五轮 Architect gate。

### 建议修改（非阻断）

1. MM-010 实现时在 harness README 固定 `.sha256` sidecar 的 canonical 格式（例如小写 64 位十六进制及是否包含文件名），并测试 malformed、stale 和 wrong-target sidecar；现有合同已足以派发，不影响本轮批准。
2. host ledger 实现时使用不可预测的 authorization ID，并把清理、日志脱敏和 renderer/window IPC 可见范围纳入安全测试；当前 forged/replay/expiry/kind 合同已满足 F2。
3. MM-100 在每个平台报告中同时记录实际安装目标、实际删除集合与 G2 approvedScope 的 diff，便于 MM-110 证明卸载未越界。

## 原则违反检查

- **未预锁桌面/画布/renderer/font**：PASS；失败候选不能被推荐，任一必需轨全失败时 fail-closed。
- **领域逻辑与桌面框架隔离**：PASS；core 无 React、画布库、host、DOM 或文件系统依赖。
- **跨平台差异仅进入适配层**：PASS；macOS/Windows primitive、入口和证据均由 platform/host 与双平台任务负责。
- **本地优先、无服务器**：PASS；无账号、云、遥测、广告或远程后端。
- **规格/ADR 先于实现**：PASS；G1、Accepted ADR 与 digest bridge 是 MM-020 的前置门。
- **数据完整性与最小权限**：PASS；canonical snapshot、VersionToken、host-ledger authorization、session-bound handle 和原子提交形成闭环。
- **多 Agent 冲突控制**：PASS；卡片路径、串并行依赖、条件 MM-045、证据 ownership 和 STOP/BLOCKED 均明确。
- **红线与发布授权**：PASS；删除仅能发生于 G2 精确范围，签名、公证、凭据、信任修改、上传和发布未获授权。

## 非阻断残余风险

1. Windows ReplaceFile/MoveFile、目录 flush、ACL/attributes、占用文件和非 NTFS 行为仍须真实设备与 failure injection 关闭。
2. 中文固定字体的再分发/嵌入许可、缺 glyph 策略和 PDF 多 viewer 容差可能阻断 font/export 轨；当前正确行为是 `blocked`，不是强行推荐。
3. 系统对话框、文件关联、cold/warm native event 和卸载删除边界仍需双平台人工证据，不能由 mock 或单平台推断。
4. `packages/export/layout` 的 package exports 与循环依赖须由 MM-020 的 boundary script 和 MM-040 实际验证。
5. source-available dual-license 的最终法律文本仍未确定；它不阻断当前开发规划，但继续阻断对外许可定稿和发布。

## 下一门槛

Architect gate 已通过。应把本报告与当前冻结规划交给 Critic 做最终复审；在 Critic 批准前，不得写入 `ralplan_consensus_gate.complete: true`，也不得把规划文档视为实现、安装依赖或发布授权。
