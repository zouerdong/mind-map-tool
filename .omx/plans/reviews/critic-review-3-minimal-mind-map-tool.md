# Critic Review 3：最终规划共识审查

## 1. Verdict

**APPROVE**

当前冻结版已完整修复 Critic Review 2 的 F1–F5，并保持首轮 Critic C1–C6、Architect Review 3 的 M1–M3、13 张任务卡、AC-01～AC-14、R-001～R-016 和 G0/G1/G2 边界一致。没有发现仍会阻止规划原样分派的缺口。

本批准只表示规划与开发指导合同达到共识门槛。它不代表产品已经实现，不授权安装正式依赖、创建服务器、签名、公证、访问凭据、上传 GitHub 或公开发布。

## 2. Critic Review 2 F1–F5 逐项复核

| Finding | 结论 | 最终证据 |
| --- | --- | --- |
| F1：G1 批准值与不可变 Spike 快照 | **PASS** | Decision template 已包含 `sourceSpikeResult {path, sha256, generatedAt}`、四轨 `approvedTracks`、candidate evidence digest、Accepted ADR id/version/SHA-256，以及结构化 `acceptedAdrVersions`。MM-010 在 JSON 内先写最终 `generatedAt`，冻结最终 bytes 后将 SHA-256 写入独立 `.sha256` sidecar，不把 hash 写回被哈希 JSON，避免 self-hash。bootstrap profile 对推荐、evidence、snapshot、ADR 和 approved value 漂移全部 fail-closed。 |
| F2：一次性授权负向生命周期 | **PASS** | UI 只收到 `TargetAuthorizationRef {authorizationId}`；canonical path/token/kind/expiry/consumed 存在 host ledger。forged、replay、expired、document/export wrong-kind 均有稳定错误码，并要求不创建/覆盖目标、不更新 handle/token/saved identity。AC-08、integration、IPC、E2E-10、人工测试、R-005 和 MM-060 已一致覆盖。 |
| F3：selected-canvas 中性合同 | **PASS** | 架构第 7 节已改为 `SelectedCanvasProjection` 与获选画布 view model。React Flow 规则只在 `canvasView=react-flow` 时生效；custom 分支禁止 `@xyflow/react`。架构、测试、MM-020/MM-050 均以 `check-boundaries.mjs --scope selected-canvas` 按批准决策 fail-closed。 |
| F4：允许路径、双平台证据与 exact command | **PASS** | MM-010 的四份 Proposed ADR 路径已明确；MM-050/MM-060 的 macOS、Windows raw evidence 与 aggregate 文件均进入各自允许路径，文件名互不覆盖；AC-03 使用 MM-020 明确负责建立的稳定 `run-all.mjs --focus core-commands,selected-canvas` 入口。 |
| F5：unsigned packaging 与删除边界 | **PASS** | G2 `approvedScope` 结构化记录 selected host、candidate output paths、installation targets、allowed actions、deletion boundaries，并显式排除 test-signing、签名、公证、凭据、系统信任修改、上传和发布。MM-100 只运行带 `--unsigned` 与 `--scope-from` 的获选 host 命令，越界删除或签名配置必须失败。 |

## 3. 关键合同终审

### 3.1 四轨决策与阶段验证

- desktop host、canvas、export renderer、font 四轨与顶层都支持 `recommendation-ready | blocked`。
- recommendation 只能引用 `result=pass` 且 evidence 非空的候选；同轨全部失败时必须 `blocked`、`recommended=null`，评分更高的 FAIL 候选不能被强迫推荐。
- `spike-result`、`bootstrap`、`packaging` 三 profile 分别由 MM-010、MM-020、MM-100 消费；未来 Gate 的正常 pending 不会反向阻断前一阶段。
- G1 把批准值绑定到冻结 Spike snapshot、candidate evidence digest 与 ADR digest；批准后任何漂移都会使 bootstrap 非零并要求重新审签。
- `.sha256` sidecar 与 snapshot 分离，已经避免“文件包含自身 hash”的不可满足合同。

### 3.2 文件能力与数据完整性

- Save As/Export 使用 host-ledger、短期、单次、kind-bound `TargetAuthorizationRef`；普通 Save 使用 session/window-bound opaque `DocumentTargetHandle`。
- `openDocument` 与成功 Save As 返回 handle + VersionToken；普通 Save 不重复弹出选址对话框，handle 伪造、过期、撤销或跨窗口使用均被拒绝。
- StateIdentity、不可变保存快照、串行保存队列、VersionToken、外部修改冲突和 macOS/Windows commit protocol 共同覆盖分叉、undo 回保存点、in-flight save 与文件覆盖安全。
- 所有 authorization/handle/failure-injection 失败都要求旧文件安全、dirty 正确且保存身份不变。

### 3.3 画布、导出与依赖方向

- 依赖方向为 `ui → export/layout → core`；core 不依赖 React、画布库、DOM、文件系统或桌面 host。
- 获选画布由 decision register 唯一决定，未获选依赖不得进入构建图。
- semantic SVG、2x PNG 与 PDF 使用同一 layout/scene；renderer owner 唯一。仅当 native renderer 获选时激活 MM-045，否则记为 `NOT_ACTIVATED`。
- 字体、中文 glyph、PDF viewer、locale/timezone/DPI、极大画布与 OOM 均有 Spike/ADR、golden 和停止条件。

## 4. 前序条件回归

### 4.1 Critic C1–C6

| 条件 | 结论 |
| --- | --- |
| C1：全失败 blocked、PASS-only recommendation、用户批准门 | **PASS** |
| C2：TargetAuthorization/DocumentTargetHandle、layout、zoom、selected canvas | **PASS** |
| C3：Risk owner、trigger、action、evidence、status | **PASS** |
| C4：AC→owner→test→command→artifact→reviewer 追溯 | **PASS** |
| C5：13 卡独立分派、路径、验证命令、双平台与 STOP/BLOCKED | **PASS** |
| C6：G0/G1/G2 分阶段授权 | **PASS** |

### 4.2 Architect M1–M3

- **M1 PASS**：一次性选址授权与持久普通保存 handle 的生命周期已经分离并完整接线。
- **M2 PASS**：validator profile 与 Gate 生命周期一致，不会形成 MM-010/G1 的循环阻断。
- **M3 PASS**：projection 测试和 dependency boundary 跟随获选画布，custom 分支不会被强制引入 React Flow。

## 5. 任务、验收、风险与授权边界

- 共 13 张定义卡：12 张常规执行卡 + 1 张条件 MM-045；未激活条件卡不计作完成。
- 每张卡具备目标、依赖、允许路径、非目标、交付物、验收、具体命令、Risk IDs、STOP/BLOCKED 和回报合同。
- 需要平台事实的 MM-010、MM-050、MM-060、MM-090、MM-100 均要求 macOS/Windows 独立原始证据和聚合报告；缺一平台即 BLOCKED。
- PRD 的 14 个 AC 均映射到测试、命令、evidence artifact 和 MM-110；风险登记的 16 个 Risk 均有 owner、触发条件、动作与关闭证据。
- MM-090 失败必须开责任卡并在修复后完整重跑；MM-110 是只读的最终独立验收，不顺手修代码或扩范围。
- 第一版持续排除账号、云、协作、AI、富媒体、服务器后端、远程 API、遥测、广告和延期能力骨架。
- G2 只允许精确范围内的 unsigned 本地候选安装/卸载测试；删除边界必须结构化批准。任何 test-signing、签名、公证、凭据、系统信任修改、上传或公开发布都需要新的独立授权。

## 6. 非阻断残余风险

以下风险已有 owner、触发条件和 fail-closed 处理，不阻塞本次规划批准：

1. `.sha256` sidecar 的 canonical 文本格式、malformed/stale/wrong-target 用例需由 MM-010 harness README 与测试固定。
2. authorization ID 需要足够不可预测，host ledger 的清理、日志脱敏和 IPC 可见范围需在 MM-060 安全测试中验证。
3. Windows ReplaceFile/MoveFile、directory flush、ACL/attributes、文件占用与非 NTFS 行为仍需真实设备和 failure injection 关闭。
4. CJK 字体许可、包体、缺 glyph 与 PDF 多 viewer 兼容性可能让 font/export 轨 blocked；正确结果是停止并回到用户决策，不是降低门槛。
5. 系统对话框、文件关联、cold/warm native event 和卸载实际删除集合仍需双平台人工证据；mock 不能替代。
6. source-available/双重许可的最终文本仍需法律审阅，并继续阻断对外许可定稿和公开发布。

## 7. 用户仍需明确确认

- **G0**：是否授权本地 Spike，以及可用的 macOS/Windows 设备与 OS 范围。
- **G1**：基于 PASS evidence 确认 host、canvas、renderer、font、schema v1、最低平台/CPU、性能预算、产品标识/扩展名、attribution、PDF/背景/尺寸上限和对应 ADR digest。
- **G2**：最终许可与法律审阅、获选安装器、unsigned candidate 输出路径、安装目标、允许的安装/卸载动作和删除边界。
- **独立红线授权**：test-signing、正式签名、公证、凭据访问、系统信任修改、GitHub 上传和任何公开发布均不包含在上述规划批准内。

## 8. Consensus 结论

Planner、Architect 与 Critic 的规划共识门已满足。当前版本可将：

```text
ralplan_consensus_gate.complete = true
```

后续仍须从 MM-000/G0 开始，并由用户另行决定是否派发任何 Spike 或实现任务。共识完成本身不构成实现、安装依赖、删除、签名或发布授权。
