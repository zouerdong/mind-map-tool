# Architect Review 3：Critic C1–C6 修订复审

## 1. Verdict

**ITERATE**

Critic C1、C3、C4、C5、C6 已被实质吸收，且“失败候选不能被强迫推荐”已经成为机器可读决策、风险、Gate 和任务 STOP 条件的一致规则。但 C2 的 `TargetAuthorization` 修订只闭合了 Save As/导出对话框到首次 commit 的 TOCTOU，没有闭合打开文件后以及 Save As 成功后的普通 `Cmd/Ctrl+S` 主链；同时 decision validator 的阶段语义和画布边界测试仍有两处会使正确分支无法执行的矛盾。

这三项均是局部合同修正，不要求改变产品范围、候选技术或任务总数。修正后可再次 Architect 复审；当前不应进入 Critic 终审或标记 consensus complete。

## 2. 六项重点核验

| 核验项 | 结论 | 说明 |
| --- | --- | --- |
| 1. 四轨及顶层 `recommendation-ready | blocked`、全失败语义 | **条件通过** | decision template、架构、测试、MM-010/MM-020 和 R-002/R-003/R-007/R-009/R-016 均规定：推荐只能引用 PASS+evidence；任一必需轨全失败时该轨与顶层 blocked、推荐 null；最高分 FAIL 不得被推荐。唯一待修是同一 validator 在 MM-010 与 MM-020 的阶段要求矛盾，见 M2。 |
| 2. `TargetAuthorization` TOCTOU | **未通过** | Save As/导出首次目标授权的 dialog→commit 复核已正确；但 authorization 单次使用，普通 Save 没有可续用的 host capability，见 M1。 |
| 3. `ui → export/layout → core` 与 schema/view 边界 | **条件通过** | 架构图、规则、MM-050 和 boundary script 方向正确；viewport/zoom 已移出 schema。测试规格 integration 仍无条件写 React Flow projection，会使 custom view 分支错误依赖未获选库，见 M3。 |
| 4. R-001～R-016 与 AC-01～AC-14 闭环 | **通过** | 风险登记册具备 owner、reviewer、trigger、action、evidence、status；任务卡引用 Risk IDs。PRD AC 有稳定 ID，测试矩阵逐条映射 owner、case、exact command、artifact 与 MM-110，MM-090 负责 evidence/risk index。 |
| 5. 13 张卡路径、双平台证据、STOP/BLOCKED、G0/G1/G2 | **通过** | 13 张定义卡与“12 张常规 + 1 张条件卡”区分清楚；MM-020/MM-060/MM-100 路径已收紧；要求实机的卡均明确 macOS/Windows 独立证据与聚合 owner；统一 STOP/BLOCKED 与三阶段 Gate 已进入依赖图和 register。 |
| 6. 失败候选不能被强迫推荐 | **通过** | 架构、模板、MM-010、MM-020、测试和风险登记均 fail-closed。Tauri/React Flow/TS-WASM 只是偏好，不是保底选项；全部候选失败时必须停止，不得按最高分继续。 |

## 3. 必须修改

### M1｜补齐普通 Save 的 host capability 生命周期

当前 IPC 是：

```text
openDocument(path) -> { bytes, versionToken, pathIdentity }
authorizeDocumentTarget(...) -> TargetAuthorization
commitDocument(targetAuthorization, bytes) -> { versionToken }
```

同时 `TargetAuthorization` 被定义为单次使用。由此产生两个无法执行的正常流程：

1. 从 Finder/Explorer 打开已有文件后编辑并按 `Cmd/Ctrl+S`：`openDocument` 没有返回可提交的 authorization/capability，UI 又不得自行用 path/token 拼授权。
2. 新文档完成 Save As 后继续编辑并再次按 `Cmd/Ctrl+S`：首次 authorization 已消费，`SaveResult` 只返回 version token，没有返回下一次普通保存所需的 capability。

若实现者复用已消费 authorization，会破坏单次授权安全属性；若每次重新调用系统对话框，则普通 Save 退化为每次 Save As，违背 PRD 保存语义。

**必须改为**：将“对话框的一次性选址授权”和“已打开文档会话的持久、不可伪造目标 capability”分开。例如：

- `openDocument` 返回 opaque `DocumentTargetHandle + VersionToken`；
- Save As 的一次性 `TargetAuthorization` 成功提交后，`SaveResult` 返回新的 `DocumentTargetHandle + VersionToken`；
- 普通 Save 使用 `commitCurrentDocument(handle, expectedVersionToken, frozenBytes)`，host 复核 handle 与当前 path identity/token；handle 不暴露任意文件系统能力，并在 session/window 关闭时失效；
- Save As/Export 仍使用短期、单次 `TargetAuthorization`，保留 `TARGET_APPEARED_CONFLICT` 与 dialog→commit TOCTOU 防护。

命名可以不同，但必须满足这两个 capability 生命周期。同步更新：

- 架构 IPC、`DocumentSession` 字段与风险 R-005/R-014；
- PRD AC-06/AC-08；
- integration/E2E：`open → edit → ordinary save`、`Save As → edit → ordinary save` 不重复弹窗；stale/跨窗口/伪造 handle 拒绝；外部修改仍冲突；
- MM-030 port、MM-060 owner、MM-080 接线与 AC evidence。

### M2｜把 decision validator 明确分成阶段化验证

MM-010 的正确完成态要求四轨可以 `recommendation-ready`，但 G1 仍为 pending，等待项目负责人批准；其验证命令却直接调用 `verify-decision.mjs`。架构与测试又写 G0/G1 缺批准记录时 validator 失败。若按字面实现，MM-010 的合法推荐结果会因 G1 尚未发生而失败，用户也无法进入 G1；若 validator 忽略 G1，MM-020 又可能失去 fail-closed 保证。

**必须改为**：定义显式 validation profile，并在任务卡命令中传入，例如：

- `--phase spike-result`：要求 G0 approved、候选/证据/四轨/顶层状态自洽，允许 G1 pending；
- `--phase bootstrap`：在上述基础上要求顶层及四轨 recommendation-ready、G1 approved、批准值来自 PASS candidate、Accepted ADR versions/evidence 匹配；
- `--phase packaging`：追加 G2 对精确本地候选准备范围的批准，不推定签名或发布。

MM-010、MM-020、MM-100 分别调用相应 profile；decision template/consumer rules、integration tests 和 R-016 同步写清退出码语义。任何阶段失败都返回 `BLOCKED`，但不得让未来 Gate 的正常 pending 阻断前一阶段产出。

### M3｜让 integration projection 测试跟随获选画布分支

架构和 MM-050 已正确改成“获选 React 画布视图”，但测试规格 2.2 第 1 项仍无条件写：

```text
UI projection → core command → React Flow projection
```

若 `canvasView=custom-react-view`，该测试会要求导入未获选、按规则不得进入依赖图的 React Flow，和 R-003/R-004、MM-020、MM-050 相冲突。

**必须改为**：使用中性合同 `selected canvas projection → core command → selected canvas projection`；仅在 React Flow 分支追加库 ID/measurement/attribution/无 Pro 代码断言，custom 分支断言依赖图中不存在 React Flow。`check-boundaries.mjs` 和 AC-02/AC-03 证据应读取 decision register 后 fail-closed 地选择对应断言。

## 4. 已通过的 Critic C1–C6 修订

### C1｜决策失败态

已通过。模板初始状态为 blocked；四轨 candidate 显式记录 `pass | fail | not-tested`、exit criteria、evidence 和 reasons；架构规定全部必需轨 ready 才能让顶层 ready。R-002、R-003、R-007、R-009 与 R-016 覆盖四轨失败和未经批准 scaffold。

### C2｜其余三项残余风险

- `ui → export/layout → core` 已进入架构图与 boundary contract。
- MM-050 已中性化，React Flow 约束只在对应分支生效。
- schema 测试明确拒绝 viewport/zoom，zoom 边界转入 session/UI 测试。

只有普通 Save capability 生命周期仍未闭合，故 C2 整体不能判定完成。

### C3｜风险登记

已通过。R-001～R-016 覆盖 Critic 要求的全部最低风险集，并且不是摘要式“风险—缓解”，而是有触发条件、动作、关闭证据、状态和 accountable reviewer 的可交接登记册。

### C4｜需求追溯

已通过。PRD 从原 13 个复合条目重整为 AC-01～AC-14；测试矩阵明确 task、case、命令、证据路径、reviewer；MM-090 和 MM-110 分别生产与复核逐行证据。

### C5｜任务卡执行合同

已通过。路径、条件 manifest、双平台 runner、聚合报告、Risk IDs、STOP/BLOCKED、条件卡计数均明确；质量脚本由 MM-020 前置创建，后续卡只调用已存在入口。

### C6｜G0/G1/G2

已通过。G0 仅授权本地 Spike，G1 才允许 bootstrap，G2 只批准明确的本地候选准备范围；签名、公证、凭据、上传和公开发布均没有被 Gate 隐含授权。M2 仅要求把 validator 的消费阶段写清，不改变 Gate 设计。

## 5. Steelman、Tradeoff 与 Synthesis 复核

- **Steelman**：Electron 的一致运行时优势仍以更高的跨平台/维护权重进入 host 比较；Tauri 若数据安全或文件入口失败直接淘汰。没有候选被当作陪跑。
- **Tradeoff**：轻量 vs 运行时一致性、语义文本 vs 中文确定性、viewport 持久化 vs 无摩擦关闭均已有明确权重或产品语义；新增 capability 区分体现了“最小文件权限 vs 无摩擦普通保存”的真实张力。
- **Synthesis**：四轨 fail-closed decision + G0/G1/G2 + core `DocumentSession` + platform capability/commit + 单一 ExportScene/renderer owner 仍是可行综合方案。M1 只补全 capability 生命周期，不推翻分层。

## 6. 非阻断残余风险

1. Windows directory flush、ACL/attributes 与非 NTFS 行为仍需按 R-006 在真实设备验证；不能声称超出证据的断电耐久性。
2. 固定 CJK 字体的许可、包体与缺 glyph 策略以及 PDF 多 viewer 兼容性仍可能让 font/renderer 轨 blocked；当前 fail-closed 语义正确。
3. OS 系统事件与对话框自动化可能需要人工证据；R-010 已禁止用 mock 冒充系统级通过。
4. source-available/双重许可仍需法律复核；G2 不授权公开发布。
5. `packages/export/layout` 作为 package subpath 的实际 bundler/ESM export map 需在 MM-020/MM-040 验证，但依赖方向本身已成立。

## 7. 下一次 Architect 通过条件

1. M1 的普通 Save capability 生命周期在架构、测试、风险、任务和 AC 证据中一致闭合。
2. M2 的 validator profiles 让 MM-010 合法产生 recommendation、MM-020 只消费 G1-approved recommendation、MM-100 只消费 G2 scope。
3. M3 的 projection 测试不再把 React Flow 强加给 custom 分支。
4. 其余已通过的 C1–C6、R-001～R-016、AC-01～AC-14、13 张卡、双平台 STOP/BLOCKED 和无服务器/无发布边界不得回退。

满足后可给出 `APPROVE` 并交回 Critic 终审。
