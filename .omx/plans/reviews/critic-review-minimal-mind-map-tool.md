# Critic Review：极简自由脑图工具

## 1. Verdict

**ITERATE**

规划的产品边界、架构方向和大部分任务拆分已经可用，Architect 第一轮 M1–M6 也已被实质吸收；但当前还不能作为“13 张可直接独立派发的任务卡”进入实现。主要阻断项不是产品方向错误，而是决策失败态、风险责任、验收追溯和若干卡片契约尚未完全闭合。尤其是 Spike 强制填入技术选择但不能表达“所有候选均未达标”，会让未通过验证的建议被实现 Agent 锁死，违反用户确认门槛。

本结论不否定 Architect Review 2 的架构批准；Architect 已列为非阻断的几项风险，在进入多 Agent 实现前必须转成明确 owner、触发条件和验证合同，因此对最终可执行性构成 Critic 阶段的修改要求。

## 2. 通过项

### 2.1 原则与方案一致性

- 产品仍是本地、单机、macOS/Windows 的自由空间文字脑图；白/黑主题、首次交互引导、本地原生文件和 SVG/PNG/PDF 均可追溯到访谈规格。
- 账号、云、协作、AI、富媒体、自动树形布局、服务端、遥测和广告被持续排除；Tauri Rust host 被正确限定为本机适配层，不是服务器后端。
- `core`、UI、platform、desktop composition 与 export scene 的职责方向清楚，领域模型没有被桌面框架或画布库绑架。
- 数据安全不再停留在“原子保存”口号：StateIdentity、不可变保存快照、VersionToken、分阶段 failure injection 与双平台 commit primitive 已形成可实现契约。
- 本轮规划没有实现产品代码、安装依赖、修改 CI/CD、操作凭据、签名、公证或公开发布，也没有把这些动作隐含授权给后续卡片。

### 2.2 替代方案公平性

- Tauri 与 Electron 使用同一 host 评分框架；Electron 的运行时一致性和维护优势得到实质权重，不是陪跑方案。
- React Flow 与最小自研 React view 被要求独立评分，画布决定没有再与 host 选择绑定。
- Flutter 因 v1 需要不可复用的 Dart core/UI/export/tooling 分支而淘汰，理由是交付面和复用成本，不是对团队能力的无依据假设。
- TS/WASM 与 native renderer 均有明确结果分支和唯一 owner；MM-045 已消除两个 Agent 同时拥有 native 导出的核心冲突。

### 2.3 主要架构验收

- history/dirty 分叉、undo 回保存点和 in-flight save 均有 unit/integration/E2E 覆盖要求。
- LaunchRouter 覆盖 boot queue、ready、normalize/dedupe、window action 和 renderer ack；带文件冷启动、多文件、等价路径和 dirty 窗安全均进入验收。
- semantic SVG、固定字体与共享布局契约把 UI、SVG、PNG、PDF 放在同一语义链上，且明确了 canonical hash 与外部 viewer 容差的不同保证边界。
- MM-090 要求缺陷修复后完整重跑，而不是只复跑失败用例；MM-110 要求独立审阅。

## 3. 必须修改

### C1｜让 Spike 能表达“没有合格方案”，避免强制锁死失败候选

**问题**：`architecture-minimal-mind-map-tool.md` 与 MM-010 要求 `desktopHost`、`canvasView`、`exportRendererOwner`、`fontToken` 全部非空且只能二选一，同时又规定阻断项可淘汰候选。如果某一轨所有候选都失败，当前 schema 仍迫使 Agent 写入一个未达标方案；`blockedReasons` 不能抵消这个错误选择。随后 MM-020 只读 decision.json scaffold，存在把失败建议实现化的风险。

**必须改为**：

1. 为机器可读 decision 增加顶层 `status: "recommendation-ready" | "blocked"`，并为 host、canvas、renderer、font 分别记录 `status`、候选结果、通过证据和阻断原因。
2. 只有某轨至少一个候选通过其 exit criteria 时，才允许该轨写非空推荐值；所有候选失败时必须是 `blocked`，不得用“分数较高”代替通过。
3. `verify-decision.mjs` 必须验证“推荐值来自已通过候选”“所有实现必需轨均 recommendation-ready”“用户批准记录存在”，否则 MM-020 返回 BLOCKED。
4. MM-010 产出只能是 **recommendation / Proposed ADR**，不得自行写 Accepted。用户批准应记录为独立、可审计的 decision register 条目，列出批准的 ADR/version/date；MM-020 的依赖必须引用这些具体批准记录。
5. 同样处理 `fontToken`：不存在许可、中文覆盖和包体均达标的字体时必须阻断，不得塞入占位字符串。

**涉及文件**：架构、测试规格、任务卡 MM-000/MM-010/MM-020、Planner 摘要。

### C2｜闭合 Architect Review 2 的四项尚未落地风险

Architect 已给出明确后续要求，但当前草案仍保留原问题。必须在派发前写入正式合同：

1. **Save As / 导出覆盖 TOCTOU**：当前 `showSaveDialog() -> path` 与覆盖提交强制 expected token 不闭合。由 MM-060 拥有：对话框返回带 path identity/version token 的授权结果，或 host 实现等价原子二阶段授权；MM-040/MM-080 只消费该合同。测试增加“选择已有目标后、commit 前目标被外部修改”，期望冲突且旧文件不被覆盖。
2. **MM-050 条件措辞**：把标题、目标、非目标和验收统一改成中性的“获选 React 画布视图”；仅在 decision 选择 React Flow 时应用 attribution/无 Pro 代码要求。不能依赖派发者临时机械改卡。
3. **共享 layout 依赖图**：在架构图中显式画出 `packages/ui -> packages/export/layout`，或把 layout 定义为不会造成依赖反转的明确子模块；同时用 boundary check 锁定该方向。
4. **schema/zoom 残留**：测试规格 Schema unit 中删除“越界 zoom”，把 zoom 边界移入 session/UI viewport 测试，避免实现 Agent 把 viewport 写回 v1 schema。

### C3｜建立带 owner 和触发条件的风险登记表

**问题**：Planner 摘要只有“风险—控制”，多数任务卡只有“风险—缓解”；没有统一 owner、触发信号、停止条件、证据和关闭人。用户明确要把任务另行交给 Agent，这种写法不能保证风险在卡片交接中被真正接住。

**必须改为**：新增规划级风险登记表，并给每项稳定 Risk ID，至少包含：

- 风险描述与影响；
- owner task / accountable reviewer；
- 可观察触发条件；
- 触发后的动作（继续、降级、开缺陷卡或停止等待用户）；
- 验证/关闭证据；
- 当前状态。

至少覆盖：host 两平台差异、所有 host 候选失败、画布候选失败、React Flow attribution/许可、Save As/导出 TOCTOU、Windows directory flush/ACL/文件系统差异、字体许可与缺 glyph、PDF 策略、renderer 两轨失败、OS 级自动化不可行、许可证法律审阅、跨卡文件冲突和双平台设备不可用。各任务卡引用对应 Risk ID；不能只写“通过测试缓解”。

### C4｜补一张逐条闭合的需求追溯矩阵

**问题**：测试规格末尾的追溯表按大类汇总，而 PRD 13 条验收没有稳定 ID，任务卡也多用“PRD 全部行为”概括。它能说明覆盖方向，不能证明每个关键验收都有唯一 owner、测试入口和最终证据。

**必须改为**：

1. 给 PRD 13 条验收分配稳定 ID（例如 `AC-01`…`AC-13`），必要时把复合条目拆成可独立判定的子项。
2. 在测试规格增加 `Requirement/AC -> owner task -> unit/integration/E2E/manual case -> exact command -> evidence artifact -> final reviewer` 矩阵。
3. MM-090 按矩阵生成证据索引；MM-110 逐项复核，不允许用“应用可走通”替代记录。
4. 把无网络/无后端、文件数据安全、三格式内容完整、双平台文件入口、首次引导、性能与安装关联分别映射到明确证据，不得只依赖人工口头结论。

### C5｜修正任务卡的独立派发合同与验证命令

13 张卡均已具备目标、依赖、非目标、交付物、验收、风险和回报，数量与主依赖图正确；但以下项仍不足以无上下文独立派发：

1. MM-020 的“根工具链文件、各 package manifest/tsconfig”和 MM-100 的“桌面 bundle 配置”必须换成明确 glob/文件清单，并说明条件分支可新增哪些 manifest/config；禁止把模糊路径解释成整个仓库可改。
2. MM-010、MM-060、MM-090、MM-100 的完成条件必须明确要求 macOS 与 Windows 各自产出一次结果，并指定聚合报告 owner；没有另一平台设备时返回 BLOCKED，不得以单平台推断。
3. MM-020 必须显式创建所有后续会调用的标准入口，包括 `test:a11y`、`bundle` 和按 host 条件化的命令；每张后续卡的验证命令要么引用这个已存在入口，要么在本卡允许路径内创建它。
4. MM-040 的验证命令必须包含本卡声称会执行的 dependency license scan；MM-050 的 300/450 性能验收必须对应一个具体命令和结果文件；MM-060 的平台提交/文件事件验收必须对应双平台 runner；MM-100 的 bundle 命令应按已选 host 明确，而不是依赖未定义的通用脚本。
5. MM-000 的 `rg ... && git diff --check` 只能检查文本存在和 diff 格式，不能证明“与规格无冲突”或“门槛齐全”。增加可人工审签的决策清单与文档链接/结构校验；在 bootstrap 前无法自动化的项明确标成 review evidence，不伪装成自动测试。
6. 每张卡增加统一的 `STOP/BLOCKED` 条件：依赖产物缺失、ADR 未 Accepted、decision 状态 blocked、需要越过允许路径、需要新增运行时依赖但许可失败、需要执行红线动作时，立即停止并按回报模板交还。
7. MM-045 若未启用，不应作为已执行任务计数；任务图和进度账本应区分“13 张定义卡”与“12 张执行卡 + 1 张条件分支卡”。

### C6｜把用户仍需确认的决定分阶段，避免 MM-000 与 MM-010 相互含糊

**问题**：用户确认清单内容正确，但尚未明确“哪些在 Spike 前必须确认、哪些由 Spike 提案后确认、哪些仅发布前确认”。MM-000 说收集阻塞决定，MM-010 又需要产出最低平台、font/PDF/上限建议，容易让执行 Agent 不知道何时停止。

**必须改为**：建立三阶段 gate：

- **G0 / Spike 授权前**：只确认允许本地实验、可用测试设备/OS、不得发布或改 CI/CD/凭据；允许候选依赖仅存在于 Spike harness。
- **G1 / Bootstrap 前**：用户基于 Spike 证据确认 host、canvas、renderer、font、schema v1、最低平台、性能预算、产品标识/扩展名、attribution、PDF/背景/上限。只有对应 ADR Accepted 才可执行 MM-020 及实现卡。
- **G2 / 发布准备与公开发布前**：许可证/商业授权法律文本、安装器选择、签名身份和发布动作分开确认；MM-100 只做用户允许的本地候选准备，任何签名、公证、上传仍需新的明确授权。

每个 gate 应有 machine-readable/readable register 与明确 owner；实现 Agent 不得把“规划建议”视为批准。

## 4. 关键验收可测试性审查

| 主题 | 当前结论 | Critic 要求 |
| --- | --- | --- |
| Core/schema/history | 通过 | 保留 StateIdentity、canonical encoding、property tests 和 dirty 三组回归 |
| 文件安全 | 条件通过 | 补 Save As/导出目标授权 token 与 dialog→commit TOCTOU 用例 |
| LaunchRouter | 通过 | 保留 cold/warm/early/重复/等价路径/dirty 窗矩阵 |
| UI/IME/a11y | 条件通过 | MM-050 改中性分支措辞；MM-020 固定 `test:a11y` 入口 |
| 三格式导出 | 条件通过 | 保留唯一 owner；为两 renderer 都失败建立 blocked 状态和 owner |
| 轻量 | 条件通过 | MM-050 性能命令与证据路径必须具体，双平台数据不可缺 |
| 安装/文件关联 | 条件通过 | MM-100 使用获选 host 的精确 bundle/安装 runner |
| 本地无后端 | 通过 | 离线运行、boundary/network scan 和人工验收形成三层证据 |
| 首次引导 | 通过 | state machine、组件测试、E2E 和人工重放路径齐全 |

## 5. Architect Review 2 残余风险归属审查

| Architect 残余风险 | 当前归属 | 结论 |
| --- | --- | --- |
| Save As/导出覆盖 token | 隐含在 MM-060 | **未充分归属**；按 C2 明写 API、TOCTOU 测试和 owner |
| MM-050 React Flow 条件措辞 | 派发前人工修改 | **未充分归属**；卡片本体应立即中性化 |
| UI→shared layout 依赖图 | 卡片依赖存在，架构图缺失 | **未闭合**；更新图与 boundary test |
| Schema 测试残留 zoom | 无 owner | **未闭合**；修正测试分类 |
| Windows durability 差异 | MM-060 + MM-090 人工矩阵 | 已有合理 owner；风险登记表补触发条件与 capability evidence |
| 字体/PDF/许可证 | MM-010/MM-040/MM-100 + 用户/法律审阅 | 方向正确；decision blocked 状态与 G1/G2 gate 仍需补齐 |
| OS 级自动化可行性 | MM-090 人工矩阵 | 方向正确；设备不可用/自动化失败需成为显式 BLOCKED 条件 |

## 6. 修订后批准条件

以下全部完成后可进入下一次 Critic review：

1. C1–C6 在 PRD、架构、测试规格、任务卡和摘要中保持一致，不只在单一文件补注释。
2. 机器可读 decision 能正确表达失败/阻断，且只有通过 exit criteria 并获得用户批准的方案可被 MM-020 消费。
3. Architect Review 2 的四项未落地风险已进入具体 API、架构图、测试和任务 owner。
4. 风险登记表具有 Risk ID、owner、trigger、action、evidence、status，任务卡引用它。
5. PRD 验收有稳定 ID，并形成 AC→task→test→command→evidence→reviewer 的逐条闭环。
6. 13 张定义卡的允许路径、STOP 条件、条件分支、双平台证据和验证命令足以原样独立派发。
7. G0/G1/G2 用户确认门明确，无服务器、无实现授权、无公开发布授权和红线边界保持不变。

在这些条件满足前，不应把 `ralplan_consensus_gate.complete` 标为 `true`，也不应开始 MM-020 或任何产品实现卡。
