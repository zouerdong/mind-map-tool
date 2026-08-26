# Critic Review 2：冻结版终审

## 1. Verdict

**ITERATE**

当前冻结版已经实质完成首轮 Critic C1–C6 的大部分整改，也满足 Architect Review 3 的 M1–M3 主体要求；产品方向和架构无需推翻。但仍有五处会影响“原样独立派发”或 fail-closed 安全性的合同缺口，因此暂不能把 `ralplan_consensus_gate.complete` 标为 `true`。

本轮未发现产品代码、依赖安装、服务器后端、签名、公证、上传或公开发布动作；仓库仍只有工程骨架和规划文档。本结论只要求修正规划合同，不授权实现。

## 2. 终审核验总表

| 核验项 | 结论 | 说明 |
| --- | --- | --- |
| 全失败 `blocked` / PASS-only recommendation | **主体通过，机器批准绑定待修** | 四轨与顶层已能表达 `recommendation-ready | blocked`，全失败时 `recommended=null`，最高分 FAIL 不能被推荐；但 G1 模板没有结构化记录“用户批准了哪个候选及哪份 Spike 快照”，见 F1。 |
| `TargetAuthorization` / `DocumentTargetHandle` | **主体通过，负向生命周期证据待补** | 一次性选址授权与 session/window-bound 普通保存 handle 已分离；open、Save As、ordinary Save 主链闭合。authorization 的伪造、重放和 target-kind 错用尚未进入 AC/Risk/任务验证，见 F2。 |
| 三阶段 validator profiles | **通过** | `spike-result` 允许 G1 pending；`bootstrap` 要求 G1、PASS 推荐和 Accepted ADR；`packaging` 追加精确 G2 scope，且不推定签名/发布。MM-010/MM-020/MM-100 使用了对应 `--phase`。 |
| selected-canvas fail-closed | **条件通过** | 测试、boundary script 和 MM-050 已中性化；架构第 7 节仍无条件写 React Flow projection，和前文条件分支冲突，见 F3。 |
| AC / Risk 追溯 | **通过** | PRD 有 AC-01～AC-14；测试矩阵逐条给出 owner、case、命令、artifact、reviewer；R-001～R-016 具备 owner、trigger、action、evidence、status。 |
| 13 张任务卡 | **条件通过** | 13 张定义卡、12 张常规卡 + 1 张条件卡、依赖图、STOP/BLOCKED 和双平台聚合均已明确；MM-050/MM-060 的 evidence 写入超出允许路径，见 F4。 |
| G0 / G1 / G2 | **主体通过** | 三阶段授权边界正确；G1 的批准值与 Spike 结果尚缺不可歧义的机器绑定，G2 卡内仍有 test-signing 措辞冲突，见 F1/F5。 |
| 本地、无服务器、无发布授权 | **通过** | PRD、架构、任务和扫描门槛一致排除服务器、云、账号、遥测与广告；打包不等于签名、公证、上传或发布。 |

## 3. 首轮 Critic C1–C6 回归

| 首轮要求 | 结论 | 当前状态 |
| --- | --- | --- |
| C1：Spike 失败态与批准门 | **条件通过** | 候选失败态已闭合；G1 approved value 与 source Spike snapshot 的结构化绑定仍缺失。 |
| C2：Architect 残余架构风险 | **条件通过** | Save As/ordinary Save capability、layout 箭头、zoom 分类、MM-050 中性化均已进入主体合同；架构第 7 节残留无条件 React Flow，authorization 负向生命周期未完整测试。 |
| C3：Risk owner / trigger | **通过** | 风险登记册已可交接；F2 修订时需扩展 R-005 的 authorization replay/forgery/wrong-kind 触发。 |
| C4：逐条需求追溯 | **通过** | AC-01～AC-14 与 evidence index/MM-110 闭合；F2 需追加到 AC-08，而不必新增 AC。 |
| C5：任务卡独立派发 | **条件通过** | 卡片结构和双平台条件已达标；两张卡存在声明写入路径与允许路径冲突，且一条 exact command 带未定义 runner 参数。 |
| C6：G0/G1/G2 分阶段 | **条件通过** | 阶段语义已正确；G1 机器登记尚不能证明批准值没有在批准后漂移。 |

## 4. 必须修改

### F1｜把 G1 批准值绑定到具体 PASS 候选与不可变 Spike 快照

**证据**：`decision-register-template-minimal-mind-map-tool.json` 的 `gates.G1` 只有 `acceptedAdrVersions: []` 与通用 `evidence: []`，没有按四轨记录批准候选值，也没有绑定 `docs/quality/runtime-spike-decision.json` 的版本/hash。与此同时，`bootstrap` profile 声称会检查“G1 approved values match PASS recommendations”。按当前模板，validator 无法仅凭稳定 schema 证明：

- 用户批准的是 Tauri 还是 Electron、React Flow 还是 custom view、哪个 renderer 和哪个 font；
- G1 批准后，推荐值或 Spike evidence 是否被替换；
- 每个批准值对应哪个 ADR ID/version/hash。

**必须改为**：

1. 在 G1 增加结构化 `approvedTracks`，四轨各包含 `value`、candidate result/evidence digest、ADR ID/version/hash。
2. 增加 `sourceSpikeResult { path, sha256, generatedAt }`，MM-000 批准 G1 时记录不可变来源；若源结果变化，G1 自动失效或 bootstrap 非零。
3. 明确 `acceptedAdrVersions` 的元素 schema，不能保留无类型空数组让实现者自行猜测。
4. `--phase bootstrap` 测试加入：推荐值批准后被替换、ADR version/hash 变化、Spike snapshot hash 变化、某轨 approved value 与 PASS candidate 不匹配，均必须失败。
5. 同步 MM-000/MM-010/MM-020、R-016 与测试规格 Decision register 条目。`docs/quality/runtime-spike-decision.json` 是证据产物，`docs/decisions/decision-register.json` 是批准源；两者之间必须通过上述 digest bridge 连接，不能靠人工复制默契。

### F2｜补齐一次性 `TargetAuthorization` 的不可伪造与单次消费证据

**证据**：架构已规定 authorization 有 `authorizationId`、短期有效、单次使用和 target-kind 绑定，但 integration、AC-08、R-005 和 MM-060 主要覆盖过期与 dialog→commit TOCTOU；显式的 forged ID、消费后 replay、document/export kind 混用没有对应验收。只有 handle 的伪造/撤销/跨窗口被完整列出。

**必须改为**：

1. 明确 `TargetAuthorization` 是 host-side ledger 支撑的 opaque bearer reference；UI 不能只修改结构字段就获得授权，host 必须以 `authorizationId` 回查 canonical target、kind、expiry 和 consumed 状态。
2. AC-08、测试 integration/IPC、R-005、MM-060 增加 forged authorization、已消费 replay、过期、document/export wrong-kind 的拒绝用例。
3. 明确失败码或稳定错误族，并证明这些失败不会创建/覆盖目标、不会更新 document handle/token/saved identity。
4. `DocumentTargetHandle` 的现有 session/window 绑定、关闭撤销、外部 token 冲突和 ordinary Save 不重复弹窗合同保持不变。

### F3｜清除架构第 7 节的无条件 React Flow 合同

**证据**：架构 2 节、测试 integration、MM-020/MM-050 已改成 selected-canvas fail-closed；但架构第 7 节仍名为“UI 与 React Flow 隔离”，并无条件规定 `DocumentProjection` 生成 React Flow 数据、React Flow measurement 只能临时预览。若 G1 选择 `custom-react-view`，实现 Agent 会同时收到“不得引入 React Flow”和“必须投影为 React Flow”的冲突指令。

**必须改为**：

1. 第 7 节改为“UI 与获选画布隔离”，使用中性 `SelectedCanvasProjection`/`InteractionController` 合同。
2. React Flow ID、measurement、attribution 和 Pro 限制仅放在 `canvasView=react-flow` 条件分支；custom 分支明确依赖图中不存在 `@xyflow/react`。
3. 保持 `check-boundaries.mjs --scope selected-canvas` fail-closed，并让架构、测试、MM-050 三处用词完全一致。

### F4｜修正任务卡写入越界与不可复现的 exact command

**证据**：

- MM-050 允许修改范围只有 `packages/ui/**`，但验证命令写入 `docs/quality/evidence/mm-050-performance-current.json`，并要求 owner 再生成 `docs/quality/evidence/mm-050-performance.json`。
- MM-060 允许 platform/native 路径，但交付物和命令写入 `docs/quality/evidence/mm-060-macos.json`、`mm-060-windows.json`、`mm-060-aggregate.json`。
- MM-050 两个平台都写同一 `mm-050-performance-current.json`，后运行的平台会覆盖前一平台，无法形成可审计聚合。
- AC-03 exact command 使用 `--runInBand`，但尚未锁定的建议测试栈/`vitest.config.*` 没有定义支持该 runner 参数。

**必须改为**：

1. 在 MM-050/MM-060 允许路径中加入各自精确的 evidence 文件 glob，或把证据生产统一交给允许写 `docs/quality/**` 的聚合卡；不得一边禁止、一边要求写入。
2. MM-050 使用独立 `mm-050-performance-macos.json` / `mm-050-performance-windows.json`，再生成 aggregate；两份 raw evidence 均不可被覆盖。
3. AC-03 改用 MM-020 明确定义并保证存在的稳定脚本/参数，例如 `node scripts/quality/run-all.mjs --focus core-commands,selected-canvas`，或删除未定义的 `--runInBand`。
4. MM-010 的“对应 Proposed ADR”在允许路径中改成明确 `docs/decisions/**` 或具体 ADR glob，避免自然语言权限。

### F5｜消除 MM-100 的 test-signing 措辞与红线冲突

**证据**：MM-100 非目标明确“不签名、公证”，G2 和 packaging profile 也明确不授权 signing；但步骤仍要求“本地 unsigned/test-signed 安装卸载”。`test-signed` 仍是签名动作，可能涉及证书、凭据或系统信任设置，不能由“本地准备”默认推定。

**必须改为**：

1. 默认步骤只生成并验证 unsigned 本地候选，记录签名状态为 unsigned。
2. 如确需 test-signing，必须是 G2 之外单独、明确的 signing 授权，列出证书来源、是否修改系统信任、凭据边界和恢复步骤；未获授权不得执行。
3. MM-100 的验证命令不得隐含签名；安装/卸载若涉及项目红线中的文件删除，应由 G2 的精确本地测试范围显式覆盖。

## 5. 已确认可执行的部分

- 核心产品范围、非目标、许可意图与用户旅程一致，没有出现服务器后端或延期能力预建。
- Tauri/Electron 与 React Flow/custom 的替代方案仍被公平评估；Flutter 的 v1 淘汰理由成立。
- StateIdentity、保存快照、VersionToken、跨平台 commit protocol 和 LaunchRouter 已具备明确 owner 与测试层级。
- renderer owner 的 TS/WASM 与 native 条件分支互斥，MM-045 的激活与计数规则清楚。
- AC-01～AC-14、R-001～R-016、MM-090 evidence index 和 MM-110 独立验收构成了完整的追溯框架。
- 所有需要 macOS/Windows 真机的关键卡均禁止单平台推断；缺设备/报告返回 BLOCKED。
- G0 只授权 Spike，G1 才允许 bootstrap，G2 只允许精确本地候选准备；签名、公证、凭据、上传、公开发布没有得到授权。

## 6. 再审批准条件

以下条件全部满足后，可给出 `APPROVE`：

1. G1 机器登记能把批准值、PASS candidate、ADR version/hash 和 source Spike snapshot 不可歧义地绑定，且 validator 有漂移失败测试。
2. 一次性 TargetAuthorization 的 forged/replay/wrong-kind/expired 负向生命周期进入 AC-08、R-005、MM-060 和自动化证据。
3. 架构第 7 节不再把 React Flow 强加给 custom 分支。
4. MM-050/MM-060 允许路径覆盖其证据产物，双平台文件不互相覆盖，AC-03 命令使用已定义入口。
5. MM-100 默认只做 unsigned 本地候选；test-signing 只能在独立明确授权后执行。
6. 以上修订不得回退现有 C1–C6、Architect M1–M3、AC/Risk/13 卡/Gates、无服务器、无实现授权和无发布授权边界。

在完成这些局部修订前，不应派发 MM-020 或任何正式实现卡，也不应宣布 Ralplan 共识完成。
