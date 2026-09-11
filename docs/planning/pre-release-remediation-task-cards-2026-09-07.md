# 发布前终审整改任务卡（PRR-000～PRR-090）

2026-09-11 当前派发更新：`R2_REVISE / R2-F1_STAGE_A_READY / PRR-070_BLOCKED`。R2 独立审阅确认 EULA 异常分类、清理统一计时和历史任务目录隔离仍需返修；当前唯一入口为 [R2-F1 修复指南与任务卡](./prr-069c-r2-f1-repair-guide-and-task-card-2026-09-11.md)。现在只执行阶段 A（代码与合成异常测试），交回 STOP_FOR_CODE_REVIEW；阶段 B 三轮原生预检暂不派发。下文 R2 执行报告与正常预检保留历史事实，不表示独立验收通过；旧路线与本更新冲突时，以本更新为准。

日期：2026-09-07  
状态：`IN_PROGRESS / R2_REVISE / R2-F1_STAGE_A_READY / PRR-070_BLOCKED`
指南：[pre-release-remediation-development-guide-2026-09-07.md](./pre-release-remediation-development-guide-2026-09-07.md)  
审阅输入：[pre-release-code-review-2026-09-07.md](../quality/pre-release-code-review-2026-09-07.md)
当前审阅：[prr-000-050-implementation-review-2026-09-07.md](../quality/prr-000-050-implementation-review-2026-09-07.md)
性能回卡：[PRR-066 候选性能与 PNG/CSP 根因整改](./prr-066-performance-remediation-task-card-2026-09-08.md)
冷启动回卡：[PRR-067 冷启动首次执行归因与协议收口](./prr-067-cold-start-attribution-task-card-2026-09-08.md)

图标集成回卡：[PRR-068 应用图标生产集成与原生验证](./prr-068-app-icon-integration-task-card-2026-09-09.md)

DMG 确定性装配回卡：[PRR-069C 无 Finder 依赖的确定性 macOS DMG 装配](./prr-069c-deterministic-dmg-assembly-task-card-2026-09-10.md)

DMG 发布门审阅返卡：[PRR-069C-R1 发布门边界与挂载清理加固](./prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md)

R1 审阅返修（已执行，等待独立审阅）：[PRR-069C-R2 attach 异常接管与路径隔离闭合](./prr-069c-r2-attach-and-path-safety-task-card-2026-09-11.md)

## 共同执行合同

每张卡必须先读根 `AGENTS.md`、指南和本卡，先建立红灯再改实现。交付必须列出 source HEAD、改动文件、命令/exit code、证据路径、未覆盖项和风险。

以下动作仍必须由项目负责人单独批准：删除文件/目录，修改生产 Tauri 配置或 CI/CD，写入/确认最终法律文本，安装到系统目录或更改 LaunchServices 状态，签名/公证/凭据访问，Git push/rebase/reset，上传或公开发布。

旧 `.tmp/release-candidate` 不得修改成“通过”，也不得未经批准清理。任何新证据都进入新的 source/candidate hash 子目录。

执行 Agent 必须从包含 PRR-066 独立审阅小修 `6302866` 与本状态同步的当前 clean HEAD 开始；任何历史 commit 或 working-tree snapshot 都不具备正确的 PRR-070 基线。每卡交回时使用以下固定格式：

```text
Task: PRR-XXX
Status: COMPLETE | BLOCKED | FAILED
Base: <starting HEAD + working-tree snapshot说明>
Changed: <逐文件>
Decisions: <采用方案及为什么>
Verification: <完整命令、exit code、通过数量>
Evidence: <路径 + SHA-256>
NotRun: <未运行项及原因>
Risks: <剩余风险>
Redlines: <确认未执行，或列出负责人原始授权>
```

任何 STOP 条件命中时必须返回 `BLOCKED`，不得以“代码已写完”替代完成。

## 派发矩阵

| 波次 | 任务 | 是否可并行 | 派发条件 | 交回状态 |
| --- | --- | --- | --- | --- |
| 0 | 负责人输入 | 否 | 提供 G2、生产配置、法律、验收环境四组输入 | 不交给 coding Agent |
| 1 | PRR-000 | 独占 quality/证据 schema | G2 原始授权已给出；未给出时只能完成红灯基础设施 | Gate 与 schema 可复算 |
| 2A | PRR-010 | 可与 020/040 并行 | PRR-000 protocol 已冻结 | 原生性能实现与测试 |
| 2B | PRR-020 | 可与 010/040 并行 | 不改变产品范围；若需改变则先停 | 包体方案与实测 |
| 2C | PRR-040 | 可与 010/020 并行 | command contract 审阅完成 | 原子字体几何事务 |
| 3A | PRR-050 | 可与 030/060 并行，避开 PRR-010 的 Rust 冲突 | PRR-010 Rust 修改已集成 | active handle 生命周期 |
| 3B | PRR-030 | 可与 050/060 并行 | 生产配置与最低系统版本明确授权 | bundle/文件关联 |
| 3C | PRR-060 | 可与 030/050 并行 | PRR-020 资产集合冻结且法律文本到位 | LICENSE/notices |
| 4 | PRR-065 | 不可并行 | PRR-000～060 已集成；负责人要求打开即零菜单画布 | 零画布顶栏与原生命令承载 |
| 5 | PRR-066 | 不可并行 | PRR-070 阶段 A 性能回卡 | PNG/CSP、按需加载与性能协议整改 |
| 6 | PRR-067 | 不可并行 | PRR-070 source `ea047e8` cold 预算失败 | 首次执行归因与条件式收口 |
| 7 | PRR-068 | 不可并行 | PRR-067 独立审阅通过、负责人已选定产品图标 | 确定性桌面图标与原生验证 |
| 8A | PRR-069C | 不可并行 | `b45dc0c` 候选命中 `.DS_Store` STOP；ADR 0013 v1.1.0 | `REVISE`：正常路径成立，发布门边界未通过独立审阅 |
| 8B | PRR-069C-R1 | 不可并行 | PRR-069C 独立审阅返卡 | 正式模式、时间/目录与挂载清理加固；三轮新预检 |
| 8C | PRR-070 | 不可并行 | PRR-069C-R2 独立审阅通过、新 clean commit、精确 G2 | 唯一新候选与原生证据 |
| 9 | PRR-080 | 不可并行 | PRR-070/G-FINAL 完成 | 冻结验收包 |
| 10 | PRR-090 | 不可并行；保留给独立验收者 | 用户把 PRR-080 交回当前审阅任务 | MM-110 与发布交接结论 |

并行只表示逻辑上可并行；若多个 Agent 直接共享同一 checkout，则必须改为串行，避免未提交文件相互覆盖。

### 文件所有权与最低验证

| 任务 | 主写入范围 | 共享热点 / 集成规则 | 最低验证（再加该卡专项命令） |
| --- | --- | --- | --- |
| PRR-000 | `docs/decisions`、证据 schema、`g2-scope`、`verify-evidence` 及 fixture | 独占 `scripts/quality` 后再开放其他卡 | `pnpm typecheck`、`pnpm lint`、verify-evidence 正反测试 |
| PRR-010 | desktop perf probe、Tauri perf IPC、`run-performance`、perf fixtures | 完成后再让 PRR-050 改 Rust lifecycle | TS/Rust 专项测试、真实候选的 incomplete/PASS 两路 |
| PRR-020 | 字体资产、字体加载/导出消费链、体积 probe | 若动 `package.json` 或许可清单，先与 PRR-060 协调 | `pnpm build`、`pnpm test:export`、字体/golden/体积门 |
| PRR-030 | `tauri.conf.json`、launch/file-association probe、install gate | 独占生产 bundle 配置；PRR-060 不同时编辑 | Rust/launch tests、bundle、plist/vtool、受控原生安装验证 |
| PRR-040 | core command/history、UI font/geometry、对应测试 | 不修改 bundle/quality runner | typecheck、core/UI 专项、undo/redo、三格式导出 |
| PRR-050 | Tauri file handle/coordinator/lifecycle、Rust tests | PRR-010 Rust 改动先集成 | 对 `apps/desktop/src-tauri/Cargo.toml` 运行 `cargo fmt --check`、`cargo test --locked`、`cargo clippy --locked --all-targets -- -D warnings` |
| PRR-060 | LICENSE、THIRD_PARTY_NOTICES、许可 metadata/scanner/docs | bundle licenseFile 由 PRR-030 单点集成 | `pnpm license:scan`、build 后检查 app/DMG 携带文件 |
| PRR-065 | 产品/架构文档、desktop command surface、原生菜单、关联测试 | 不改 core/schema/export/quality budget；完成后作废此前 PRR-070 试跑证据 | desktop/keyboard/menu/a11y/visual 专项 + 全量源码门 |
| PRR-066 | PNG/CSP、按需字体/导出加载、perf probe/runner/verifier 与对应测试 | 不改预算/样本/percentile/字体范围；旧 PRR-070 证据只读 | production PNG、30秒 RSS、20样本 native preflight + 全量源码门 |
| PRR-067 | perf-only 启动 milestone、cold 对照诊断、条件式应用优化或协议决策包 | 不改预算/20样本/percentile；无批准不改 Accepted ADR | 分段正反测试、B0～B3 对照、全量相关源码门 |
| PRR-068 | 固定 SVG 母版、Tauri 桌面图标集、生成器/manifest/verifier | 不重设计，不改性能协议或发布证据 | 两轮确定性、图标红灯、app/ICNS/Finder 与尺寸矩阵 |
| PRR-069C | app-only bundle、DMG assembler、bundle gate 与 runner tests | 不改 Tauri 生产配置/app/图标/预算；保留旧候选只读 | 无 Finder/AppleScript/`.DS_Store` 红灯、超时/挂载恢复、三轮真实 DMG 预检 |
| PRR-069C-R1 | bundle gate/assembler 正式边界、mount 状态机、runner tests | 不改装配产品语义；原 PRR-069C attempts 只读作废 | 注入/app-only/阈值/目录红灯、挂载异常矩阵、三轮新预检 |
| PRR-070 | 新 candidate/evidence 目录；原则上不再改 source/runner | 任一 source/runner 变化即作废重来 | 全量源码门、bundle/install/native/perf/visual 矩阵 |
| PRR-080 | readiness manifest、acceptance request、验收索引 | 冻结后只读；不得修代码 | `pnpm quality -- --release-evidence <manifest>`、完整 Rust/审计门 |
| PRR-090 | 独立 MM-110 与新 handoff | 只读冻结输入；发现问题退回对应 PRR | 独立 hash/预算/样本复算与高风险抽测 |

任何卡若必须修改“主写入范围”之外的共享热点，应先在交回记录中声明为依赖，不得直接越界编辑。

---

## PRR-000：发布 Gate 与证据基线纠正

类型：治理 / 证据完整性  
优先级：P0  
状态：`IMPLEMENTED / G2_RECORDED`（负责人四组输入 2026-09-08 已提供并写入 `decision-register.json` G2 evidence `[from-user]`；`verify-decision --phase packaging` 复算 PASS；红灯测试覆盖占位批准人/缺原文/缺排除动作路径）  
依赖：无

### 目标

让 G2、G-FINAL、candidate manifest 和 MM-110 都有真实主体、时间、范围与候选 hash；把旧候选明确降级为审计材料。

### 允许范围

- `docs/decisions/decision-register.json`（仅在负责人给出明确批准原文后）
- `docs/quality/`、`docs/planning/` 当前状态与证据 schema 文档
- `scripts/runtime-spike/verify-decision.mjs`
- `scripts/quality/g2-scope.mjs`、`verify-evidence.mjs` 及其 fixture tests

不得替负责人补写批准语句，不删除旧 `.tmp` 证据，不修改生产配置。

### 红灯

1. `approvedBy: project-owner/TBD/unknown` 必须失败。
2. 没有 `[from-user]` 原始批准记录必须失败。
3. G-FINAL 没有真实批准人、时间、candidate hash 或 artifact 必须失败。
4. native report 直接指向 `.app`、不是 JSON 或未绑定 source/candidate 必须失败。
5. manifest 早于被引用证据、runner/hash 变化或工作树 dirty 必须失败。

### 实施

1. 请负责人明确确认 G2 的产品名、identifier、version、candidate/evidence/install/deletion paths、allowed/excluded actions；把原文和真实姓名写入 Gate。
2. 定义 readiness schema v3，列出 bundle/install/performance/native-platform/G-FINAL 必需 artifact。
3. 每个 runner artifact 增加 source commit、runner hash、candidate hash、开始/结束时间和 measurement source；manifest 为每个 artifact 记录 SHA-256，performance summary 另绑定 raw evidence SHA-256。
4. 旧 `541d38c…` candidate 标为 `REJECTED_BY_REVIEW`，只在本审阅报告引用；不回写旧 JSON。
5. 正反 fixture 覆盖缺字段、占位批准人、时间倒挂、路径逃逸、错误平台和旧 runner。

### 验收

- `verify-decision --phase packaging` 对真实记录 PASS，对占位记录 FAIL。
- `verify-evidence` 不能用最小伪 manifest、旧截图或二进制路径获得 PASS。
- G-FINAL schema 明确“自动化不得授予”。
- 文档状态不再同时出现“DRAFT 未授权”和“READY_TO_RELEASE”。

### STOP

负责人未给出可引用的 G2/G-FINAL 决策；需要删除旧证据；需要扩大 G2 系统修改范围。

---

## PRR-010：候选原生性能 runner 与 raw evidence

类型：性能 / 原生测量  
优先级：P0  
状态：`IMPLEMENTED / NATIVE_CANDIDATE_EVIDENCE_PENDING`  
依赖：PRR-000 schema；最终执行依赖新 candidate

### 目标

用真实 Tauri 候选完成 Accepted ADR 0006 的全部指标，彻底移除固定值、固定 sleep 和 web→native 冒名。

### 允许范围

- `apps/desktop/src/` 的 perf-only renderer-ready 上报
- `apps/desktop/src-tauri/src/` 的 perf run-id/generation 校验与机器输出
- `scripts/quality/run-performance.mjs`、新建的 candidate driver/helper
- 合成 fixture 与对应 TS/Rust/runner tests

不得把诊断入口开放为普通用户命令，不接入网络，不修改预算。

### 红灯

- app 不输出 `renderer-ready` 时必须 `INCOMPLETE`。
- stdout 只有 `setup 完成`/`READY` 或进程活着 600ms 不能算可交互。
- RSS、canvas、edit/save/export 任一 raw array 为空或少于规定样本必须失败。
- web harness 标成 `native-candidate` 必须失败。
- 样本含 NaN/0/负数、进程未退出、run id/generation 不匹配必须失败。

### 实施

1. 增加 env-gated run id；React mount + 两帧 + 可交互画布后经 typed IPC 上报。
2. host 校验 run id/window generation 后输出唯一 JSON line；sampler 等进程退出再启动下一样本。
3. 定义可复现 cold/warm cache 条件，各采至少 20 个有效样本。
4. renderer-ready 后采稳定 RSS；驱动 300/450 dense canvas 和 create/move/connect/undo。
5. 通过 host file port 测标准 save，通过真实 renderer 测 2x PNG；每项输出 raw、失败数与 percentile。
6. 绑定 fixture/source/runner/candidate hash；任何 incomplete 返回非零。

### 验收

| 指标 | 门槛 |
| --- | ---: |
| cold start p95 | ≤ 1500ms |
| warm start p95 | ≤ 800ms |
| stable RSS | ≤ 120MB |
| dense canvas p95 | ≤ 32ms |
| high-risk edit p95 | ≤ 50ms |
| native save p95 | ≤ 200ms |
| 2x PNG p95 | ≤ 3000ms |

报告能从 raw 独立重算；杀掉任一探针或删一组 sample 后 verifier 必须失败。

### STOP

只能用 Accessibility fixed delay 猜完成；无法区分 cold/warm；需要关闭 CSP/安全校验；需要提高预算。

---

## PRR-020：安装包体积与字体资产整改

类型：性能 / 资源 / 产品取舍  
优先级：P0  
状态：`IMPLEMENTED / DMG_AND_NATIVE_VISUAL_PENDING`  
依赖：PRR-000

### 目标

在不牺牲已批准中文输入、字体一致性和导出契约的前提下，让 `.dmg ≤ 25MB`，并给后续代码保留合理的 entry 预算余量。

### 红灯

1. 当前 `.dmg` 28,011,310B 必须失败。
2. 任一字体缺常用 CJK/标点或 UI、SVG、PNG、PDF 度量不一致必须失败。
3. 只让 test fixture 字符可用的子集字体必须失败。
4. entry >500,000B 或通过改预算获得 PASS 必须失败。

### 实施

1. 记录三份字体/WASM/JS 的 app 与 DMG 压缩占比。
2. 先做全字库 WOFF2 spike，验证 WebView、fontkit、SVG、resvg、pdf-lib 与加载错误路径。
3. 若仍超限，形成“更换手写字体 / 移除 v1 可选手写字体 / 明确覆盖范围后子集化”的对比；产品范围变化先更新 product spec/ADR 并由负责人批准。
4. 对选定方案重跑 CJK coverage、missing glyph、canonical/golden、启动与首次导出性能、许可审计。
5. 从 clean source 重建 `.app/.dmg` 并由 bundle inventory 记录真实 tree/file bytes。

### 验收

- `.dmg ≤ 25MB`，不得四舍五入掩盖。
- entry JS ≤500,000B，建议保留至少 5% 余量。
- Noto/LXGW 或获批替代方案在 UI/SVG/PNG/PDF 的文字布局一致。
- 字体来源、修改/子集化状态、Reserved Font Name 与 license text 完整。

### STOP

需要移除字体/缩小字符覆盖但未获产品批准；字体格式不被全链消费；只能提高阈值。

---

## PRR-030：macOS bundle 身份、文件关联与安装验收

类型：生产配置 / 原生集成  
优先级：P1  
状态：`IMPLEMENTED / NATIVE_BUNDLE_VALIDATION_PENDING`（`tauri.conf.json` 已按 2026-09-08 授权配置 fileAssociations/UTI/minimumSystemVersion 11.0/licenseFile/resources；产物级 plist/vtool/LaunchServices/双击验证随 PRR-070 新候选执行）  
依赖：PRR-000；最终验证依赖 PRR-020 新 candidate

### 目标

让产物真实声明并实现 `.mindmap`、UTI/MIME、最低系统版本、版本/图标/许可，而不是只在产品文档中存在。

### 允许范围（批准后）

- `apps/desktop/src-tauri/tauri.conf.json`
- 必要的 macOS bundle test/probe、产品身份文档
- 对话框/launch intent 的局部测试

不得修改签名身份、凭据或发布目标。

### 红灯

- `Info.plist` 缺 `CFBundleDocumentTypes` 或 `UTExportedTypeDeclarations`。
- `.mindmap` 双击不把原始路径送入 host launch queue。
- `LSMinimumSystemVersion`、Mach-O minos 和产品文档不一致。
- 默认 Save As 仍生成 `.json`，或 `.json` 兼容打开失效。
- install gate 只复制/删除目录却自称原生安装 PASS。

### 实施

1. 获批后配置 `bundle.fileAssociations`：`mindmap`、Editor、MIME `application/x-mindmap+json`、UTI `com.mindmap.document`、conforms to `public.json`。
2. 配置 `bundle.macOS.minimumSystemVersion` 为负责人批准值（当前目标 11.0）。
3. 许可文本完成后加入 `bundle.licenseFile`；统一 product/version/build/copyright。
4. 扩展 bundle/install probe，解析 plist 精确字段，不做 substring 匹配。
5. 在受控环境验证 `open -a`、Finder 双击、cold/running/dirty/minimized 多窗口路由和 `.json` 兼容。
6. 对 LaunchServices 注册/状态变更记录精确命令、前后状态与恢复方法。

### 验收

- 新候选 plist/UTI/minos 与产品值一致。
- `.mindmap` 双击打开与 Save As 默认扩展名 PASS；`.json` 兼容 PASS。
- app 名、菜单/窗口名、bundle id、version、icon、license 一致。
- 原生报告绑定 source/candidate hash；未签名状态描述准确。

### STOP

未授权修改生产配置或 LaunchServices；最低系统版本尚未决定；需要签名/公证。

---

## PRR-040：文档字体切换的原子几何事务

类型：数据一致性 / core + UI  
优先级：P1  
状态：`IMPLEMENTED / NATIVE_VISUAL_PENDING`  
依赖：当前 GeometryBarrier 小修；若改变 command contract，先更新 ADR 0011

### 目标

切换 Noto/LXGW 时，用目标真实字体重测全部 node，并把字体与 sizes 作为一次可撤销、全有或全无的用户命令提交。

### 红灯

1. 不同字体 advance 下，切字体后 node size 仍为旧值。
2. metrics pending/failed 时 font style 已提交但 sizes 未提交。
3. 第 N 个 node 度量/校验失败后出现部分更新。
4. undo 需要多次或只恢复字体不恢复 size。
5. 已打开文档在无用户命令时被自动重测并变 dirty。

### 实施

1. 在 core 增加 compound command（名称由实现确定），输入 old/new font 与完整 node size map。
2. 命令先验证 id 集合、finite/positive size 和限额，再一次生成新 state/inverse。
3. ContextToolbar 的 `SetDocumentStyle(font)` 分支改走 GeometryBarrier；只用 ready 的目标 font resolver 构造命令。
4. pending/failed 保留用户意图；Save/Close-Save/Export 必须 flush；重试与组件卸载遵守当前 barrier 生命周期。
5. 300 节点性能纳入 `≤50ms` 高风险编辑预算。

### 验收

- Noto↔LXGW 两向切换、pending/reject/retry、undo/redo、Save/reopen、SVG/PNG/PDF 全部通过。
- 任一失败零部分提交；一次切换只产生一个 undo step。
- 老文档不被无命令改写。

### STOP

需要 schema migration、隐式全图重排或放宽布局契约；无法原子构造 inverse。

---

## PRR-050：Document handle active-session 生命周期

类型：安全硬化 / 文件能力  
优先级：P2（发布前必须完成或由负责人书面接受）  
状态：`IMPLEMENTED / FULL_LIFECYCLE_RERUN_PENDING`  
依赖：ADR 0011/file lifecycle 现有协议

### 目标

Save As、重新打开或窗口重建后，旧 document handle 不能继续驱动对旧路径的 ordinary save。

### 红灯

- 同窗 Save As 成功后，用旧 handle + 旧 token 保存旧文件必须返回 `INVALID_DOCUMENT_HANDLE`。
- 旧 generation 的 handle 不能用于同名新窗口。
- recovery-pending/commit 已落盘时不能误撤销唯一可恢复 handle。
- 跨窗口、重放、close 后使用继续失败。

### 实施

1. 为 handle 记录 window generation/session generation 或 active binding id。
2. 将新 handle 激活与 coordinator rebind finalize 放在同一提交边界；成功后撤销旧 active handle。
3. 明确定义 Save As 写后 refresh/finalize 失败时新旧 handle 的恢复所有权。
4. 增加 count/diagnostic 断言，保证无 orphan/stale capability。

### 验收

- 每个稳定窗口最多一个 active document handle。
- 所有失败/恢复/销毁竞态有 Rust 负向测试。
- 不改变外部修改冲突、version token 或 50MiB 限制。

### STOP

需要改变文件格式或覆盖语义；无法保证 post-commit recovery；负责人选择接受 P2 时必须记录理由、边界和复查版本。

---

## PRR-060：最终 LICENSE、商业条款与第三方 notices

类型：法律输入 / 许可工程  
优先级：P0  
状态：`IMPLEMENTED / NATIVE_BUNDLE_VALIDATION_PENDING`（ADR 0007 Accepted 方案 4；根 `LICENSE`、确定性生成的 `THIRD_PARTY_NOTICES.md`、workspace `UNLICENSED`/`LicenseRef-Proprietary` metadata 与 scanner 逐条目覆盖校验已完成；`.app`/`.dmg` 携带验证随 PRR-070 执行）  
依赖：PRR-020 最终字体/依赖集合

### 目标

把“source-available 双重许可方向”变成可分发的最终文本和完整第三方归属。

### 负责人输入

- 最终 LICENSE 文本、权利主体、年份与商业授权联系方式；
- ADR 0007 的 Accepted/Rejected 决定；
- notices 在 app/DMG/关于页或文档中的展示位置。

### 工程实施

1. 添加根 LICENSE（原文由负责人/法律提供）。
2. 从 pnpm lock、Cargo metadata、字体清单生成 THIRD_PARTY_NOTICES，包含 package/version/license/source/text path。
3. 给 workspace `package.json` / `Cargo.toml` 填与最终决定一致的 license metadata；非 SPDX 的 source-available 文本用合法的 metadata 表达方式。
4. 让 license scanner 校验 notices 覆盖每个 shipped package/font，而不仅是 allowlist。
5. 配置获批后，验证 LICENSE/notices 实际进入 `.app/.dmg`。
6. 修正文档中“自由开源协议”等与 ADR 0007 冲突的措辞。

### 验收

- `pnpm license:scan` 返回 0；29 direct JS、300 transitive JS、487 Cargo 与最终字体均有覆盖。
- 根 LICENSE 与 THIRD_PARTY_NOTICES 存在、非占位、被候选携带。
- ADR/product/package/Cargo/bundle/handoff 的许可措辞一致。

### STOP

没有最终法律文本；依赖许可与附加条款兼容性不明；需要替换依赖/字体但未回到 PRR-020。

---

## PRR-065：零画布顶栏与 macOS 原生命令承载

类型：产品视觉边界 / desktop command surface / 可访问性
优先级：P0（PRR-070 新候选前必须完成）
状态：`COMPLETE / INDEPENDENT_REVIEW_ACCEPTED`（实现点 `808959b`、状态点 `79f099c`；2026-09-08 独立审阅修正 onboarding 启动遮挡、accelerator 合同、CheckMenuItem 状态、监听失败处理、缓存清理与 CSP 窄豁免，并复跑全量源码门；PRR-070 只从包含审阅修复与本卡的当前 clean HEAD 重做）
依赖：PRR-000～060 已集成；起点为 `main@89d7c76` 加本任务卡 planning patch
后继：当前审阅修复与 PRR-070 卡形成 clean source commit 后，从头执行 PRR-070

### 负责人意图与本卡技术决议

```text
[from-user 2026-09-08]
我的出发点是希望用户一打开这个程序，就是一张全干净的画布。看不到任何菜单。
Coding Agent 已停止并等待 PRR-065；请建立任务卡后再开始。
```

本卡把“全干净”精确定义为：**生产 WebView 内容区打开后没有任何常驻菜单、顶栏、汉堡按钮、主题按钮、状态文字或自动 onboarding 遮罩；画布直接占满原生标题栏以下的全部内容区。**

采用以下方案：

1. 移除生产渲染树中的 40px `AppHeader`；不做 hover 自动显现，也不保留单个菜单按钮。
2. 保留 macOS 标准原生标题栏、交通灯和屏幕顶部的系统应用菜单栏；不进入无边框、强制全屏、`LSUIElement` 或 private API 路线。
3. 文件、编辑、视图、整理、主题、设置和帮助命令进入 macOS 原生应用菜单；既有快捷键继续可用，并与原生菜单共用同一个 renderer command dispatcher。
4. 节点/边格式工具条只在有选择时出现；错误、冲突、恢复、导出、设置和引导只在用户动作或异常发生后临时出现。
5. 任何启动状态（包括 `not-started` / `in-progress`）都不自动显示 onboarding；既有引导逻辑继续保留，只能由原生“帮助 → 开始/重放引导”或 `⌘⇧H` 显式打开。
6. 文档名与 dirty 状态继续使用现有原生窗口标题（`● <name> — Mind Map`），不在画布内复制。
7. React Flow attribution 沿用既有 G1 决定，`hideAttribution: false`；本卡不得隐藏、移动或以 CSS 遮盖。
8. 本卡不新增可见 command palette、右键菜单或新依赖；Windows 原生命令表仅保持可移植契约，Windows 视觉实现继续 deferred。

### 命令归属

| 原生菜单 | 必需命令 | 约束 |
| --- | --- | --- |
| `Mind Map` | 关于、设置/全局热键、Services、Hide、Hide Others、Show All、Quit | Quit 继续走现有逐窗 fail-closed 关闭协议，不得恢复 AppKit 直接 terminate |
| `文件` | 新建、打开、保存、另存为、导出、关闭窗口、新建窗口 | “新建当前文档”与“新建窗口”必须区分；不得绕过 dirty 确认和 handle/token 语义 |
| `编辑` | 撤销、重做、剪切、复制、粘贴、全选 | textarea 编辑态使用原生文本语义；画布态使用 session/history；一次快捷键只执行一次 |
| `视图` | 适应画布、整理、横向/纵向布局、暖白/黑板主题 | app-wide 菜单必须跟随最近聚焦窗口的文档主题和布局方向，不得把主题切换变成全局偏好 |
| `帮助` | 开始/重放首次引导 | 任何启动状态都不自动弹出；显式命令对未开始状态显示 welcome，其余状态从第一步进入 |

应用级快捷键以 `apps/desktop/src/app/shortcut-table.md` 与 `keyboard.ts` 为单一事实源：`⌘N/O/S/⇧S/E/⇧L/⇧H`。画布 `⌘Z/⇧Z/A/±/0/L`、节点编辑与 IME 隔离规则保持不变；原生 accelerator 与 WebView `keydown` 不得双重派发。

### 允许修改范围

- `docs/product/v1-product-spec.md`
- `docs/product/visual-state-tokens-2026-09-06.md`
- `docs/architecture/visual-motion-architecture.md`
- 新增 `docs/decisions/0012-zero-chrome-canvas-command-surface.md`
- `apps/desktop/src/app/mindmap-app.tsx`
- `apps/desktop/src/app/keyboard.ts`、`shortcut-table.md`
- `apps/desktop/src/app/app-header.tsx`（只能解除生产引用或保留审计说明；未授权删除/重命名）
- `apps/desktop/src-tauri/src/lib.rs`
- 为单一命令 dispatcher、菜单状态同步或生命周期安全定向分发新增的 desktop/platform 单职责文件
- 对应 TS/Rust/integration/a11y/visual tests 与 fixtures
- 本任务卡、planning index、质量实现报告

不得修改 core document schema、export renderer、字体、预算、readiness schema、G2/G-FINAL、生产 bundle identity、签名或发布配置。必须扩大范围时先返回 `BLOCKED`。

### 红灯（先写）

1. 空白启动、打开已有文档和新窗口三种情况下，WebView 中出现 `主工具条`、`文件 ▾`、`整理`、`视图`、主题按钮或 40px 顶部占位，测试必须失败。
2. 偏好为 `not-started` 或 `in-progress` 时在启动阶段自动出现 onboarding，测试必须失败；显式“帮助 → 开始引导”不能打开也必须失败。
3. 任一原生菜单命令不可达、到达错误窗口、在窗口 closing/destroyed generation 上执行，必须失败。
4. 一次 accelerator 同时触发 native event 与 renderer keydown，导致新建/保存/整理等执行两次，必须失败。
5. dirty close、Save/Save As、open、export、快捷键、IME 或 textarea 原生编辑语义出现回归，必须失败。
6. 原生菜单主题/布局 check state 与最近聚焦窗口不一致，或切换一个窗口污染另一个窗口，必须失败。
7. 为了“干净”而隐藏 macOS 系统菜单栏、标题栏、React Flow attribution、异常提示或选择态工具条，必须失败。
8. PRR-065 后继续引用 `caf1c20` 或任何此前 PRR-070 试跑 candidate/raw evidence，必须失败。

### 实施顺序

1. **规格先行**：新增 ADR 0012，记录零 WebView chrome、macOS 原生菜单、显式 onboarding、标准标题栏和 attribution 保留决定；同步产品视觉状态表与当前架构，删除“40px AppHeader 不破坏沉浸感”等过期事实。不得先改代码后补文档。
2. 建立 typed `AppCommandId` 和单一 command dispatcher。现有 header callback、应用快捷键和原生菜单事件只能调用它，不能各自复制 new/open/save/export/organize/theme 业务逻辑。
3. 扩展 Rust 原生 app menu 与稳定 menu item id。需要 renderer 状态的命令只定向发送给最近聚焦且 generation 有效、未 closing 的 WebView；`New Window` 与自定义 Quit 保留 host 生命周期所有权。
4. 建立 renderer → host 的轻量菜单状态同步，仅同步 enable/check 所需的非敏感状态；主题和布局状态按窗口隔离。不得引入轮询、网络或持久化副本。
5. 把应用级快捷键接到同一 dispatcher；明确 native accelerator 与 browser-dev keydown 的平台分工，保住输入控件/IME 隔离和 exactly-once。
6. 从 `MindMapApp` 生产渲染树解除 `AppHeader`，让 `EditorCanvas` 直接占满内容区；窗口 title 的文档名/dirty 逻辑保留。没有文件删除授权，不删除或重命名 `app-header.tsx`，在交回风险中登记后续清理债务。
7. 将 onboarding 改为 explicit-only：任何启动状态都保持不可见，Help/`⌘⇧H` 才显式显示；未开始状态显示 welcome，其余状态从第一步进入；偏好损坏告警仍须被消费并可见上报。
8. 更新视觉与 a11y fixtures。视觉 golden 的变更只能来自顶栏消失和画布高度增加；节点、边、字体、主题 token、attribution 和导出 bytes 不得借机变化。
9. 运行全部验证，提交一个新的本地 clean source commit；不得构建/冻结最终 PRR-070 候选，不得申请 G-FINAL 或开始 PRR-080。

### 验收

- 1080×864 暖白与黑板两张首次空白截图：原生标题栏下直接是画布，无 WebView 顶栏、菜单、按钮、状态文字或 onboarding；React Flow attribution 仍存在。
- 浏览器/AX 树中不存在隐藏的 `主工具条` 或关闭菜单项；选择节点后 context toolbar 可见，取消选择后消失。
- 原生菜单全部项目可由鼠标、键盘和 VoiceOver 发现；核心命令仅执行一次，目标始终是正确窗口。
- 新建、打开、保存、另存为、导出、整理、fit、主题、设置、引导、dirty close 与多窗口定向测试全部通过。
- not-started / in-progress 启动均无 onboarding；Help/`⌘⇧H` 的 welcome/从第一步继续/重放分支正确，完成与跳过偏好仍正确。
- `document.title` 的文档名与 `●` dirty 标记通过；保存成功后 dirty 标记清除。
- 无新增运行时依赖；`initial entry ≤ 500,000B`；license/network/boundary gate 不退化。
- `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、相关 Vitest/a11y/visual、`cargo fmt --check`、`cargo test --locked`、`cargo clippy --all-targets --locked -- -D warnings`、`pnpm build` 全部返回 0。
- 形成新的 clean source commit；`git status --short` 为空。交回报告明确声明旧 PRR-070 试跑候选与证据不可复用。

### 交回物

- `docs/quality/prr-065-implementation-report-2026-09-08.md`
- ADR 0012、同步后的产品/架构文档
- 逐文件变更表、命令/exit code/测试数量
- 两主题首次空白视觉证据与 AX 结果
- 原生菜单命令矩阵、focused-window/multi-window/exactly-once 结果
- 新 clean source commit、`git status`、initial entry bytes
- `NotRun`、残余风险与红线确认

### STOP

- 需要删除/重命名 `app-header.tsx`、历史截图、旧候选或任何目录但没有新的精确删除授权。
- 需要隐藏 macOS 系统菜单栏、原生标题栏、React Flow attribution，或引入 private API/强制全屏。
- 无法在 native accelerator 与 renderer keydown 之间保证 exactly-once。
- 无法把 app-wide macOS 菜单安全定向到最近聚焦且 generation 有效的窗口。
- 需要新增依赖、修改文档 schema/export bytes、提高预算、签名、公证、push、上传或公开发布。
- 任一源码、测试或 runner 修改发生在 PRR-070 candidate 冻结之后；此时必须作废候选并回到 PRR-070 第一步。

---

## PRR-069C：无 Finder 依赖的确定性 macOS DMG 装配

类型：发布 runner 根因整改

优先级：P0

状态：`REVISE / SUPERSEDED_BY_PRR-069C-R1`（正常路径三轮预检通过；2026-09-11 独立审阅发现发布门边界与挂载清理缺口）

任务卡：[prr-069c-deterministic-dmg-assembly-task-card-2026-09-10.md](./prr-069c-deterministic-dmg-assembly-task-card-2026-09-10.md)
实施报告：[prr-069c-implementation-report-2026-09-10.md](../quality/prr-069c-implementation-report-2026-09-10.md)

依赖：source `b45dc0c` 的 PRR-070 STOP 现场只读冻结；ADR 0013 v1.1.0 已记录替代路线
后继：执行 [PRR-069C-R1](./prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md)；再次独立审阅通过并形成新 clean source 后，从步骤 1 完整重做 PRR-070

本卡移除 Tauri Finder AppleScript/`.DS_Store` 的无上限构建依赖：Tauri 仅构建 `.app`，仓库受控 runner 使用 macOS 系统工具生成带 EULA、Applications 链接、卷图标的 ULMO DMG。禁止延长等待、人工/自动生成 `.DS_Store`、CI 绕过和重跑挑结果。完整允许范围、红灯、三轮真实预检与 STOP 见独立任务卡。

---

## PRR-069C-R1：DMG 发布门边界与挂载清理加固

类型：独立审阅返卡 / 发布证据与系统状态加固

优先级：P0

状态：`READY_FOR_IMPLEMENTATION`

任务卡：[prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md](./prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md)

审阅输入：[prr-069c-independent-review-2026-09-11.md](../quality/prr-069c-independent-review-2026-09-11.md)

本卡封闭正式测试注入、app-only 命令、时间/目录边界和 attach/detach 生命周期四类缺口。只允许修改 DMG release runner、专项测试和状态文档；必须从修复后的同一 clean source 重做三轮正式预检，并停在独立审阅。完整合同、红灯、STOP 和交回格式见独立任务卡。

---

## PRR-070：新 unsigned 候选、原生矩阵与 G-FINAL

类型：候选构建 / 原生验收  
优先级：P0  
状态：`BLOCKED_BY_PRR-069C-R2`（PRR-069C 独立审阅结论为 `REVISE`；原三轮预检不得作为 PRR-070 输入）
依赖：PRR-000～069 已集成并经独立审阅；PRR-069C-R2 实现与再次独立审阅通过；包含全部收口的新 clean source commit；G2 `approved`（ErDong Zou，2026-09-08）
后继：阶段 A 证据齐备后停在 `WAITING_FOR_OWNER_G_FINAL`；负责人明确批准后完成阶段 B，再单独派发 PRR-080

### 目标

从一个 clean source commit 构建唯一的新 unsigned macOS Apple Silicon `.app`/`.dmg`，对同一 candidate hash 完成 bundle、DMG、安装、LaunchServices、生命周期、原生命令、VoiceOver、导出和真机性能矩阵。自动化只生成证据与负责人验收请求；G-FINAL 只能来自负责人查看/操作该候选后的 `[from-user]` 原文。仍不签名、不公证、不访问凭据、不上传、不 push、不公开发布。

### 精确授权与写入范围

- 已授权 candidate：`apps/desktop/src-tauri/target/release/bundle/macos/Mind Map.app`、`apps/desktop/src-tauri/target/release/bundle/dmg/Mind Map_0.1.0_aarch64.dmg`。
- 新 evidence：`.tmp/release-candidate/<full-source-commit>/`；临时 profile/样本只进入 `.tmp/prr-070-*`。旧 `.tmp/release-candidate` 根层文件和其他 commit 子目录全部只读，不覆盖、不删除。
- 临时安装仅使用 G2 登记的 `.tmp/release-candidate/installed/Mind Map.app`，由 `install-gate --execute` 按 receipt/hash 核验后清理；若发现外来预存目标，fail-closed 停止，不得强删。
- 允许临时注册并恢复 LaunchServices 文件关联；不得修改系统信任、默认安全策略或签名设置。
- 允许使用已有本地 Rust advisory 工具；若 `cargo-audit` 不存在，只可 `cargo install --root .tmp/prr-070-tools cargo-audit --locked`，不得全局安装。
- PRR-070 不修改源码、测试、runner、生产配置、tracked 文档或 Gate。任何此类修改需求都要返回对应整改卡，形成新 clean commit 后从第 1 步重做。

### 阶段 A：候选与完整原生矩阵

### 实施顺序

1. **冻结 source**：记录 `git rev-parse HEAD`、`git status --short`、OS build、arch、CPU/RAM、Node/pnpm/Rust/Tauri 版本；worktree 非空立即停止。证据目录名使用完整 source commit，不使用短 hash 猜测归属。UTC 只可由 `new Date().toISOString()` 或 `date -u` 生成；禁止手工把本地时间标为 `Z`。
2. **源码门**：逐项记录开始/结束时间和 exit code，至少运行 `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:a11y`、`pnpm test:visual`、`pnpm test:export`、`pnpm build`、`pnpm icon:verify`、`pnpm net:scan`、`pnpm license:scan`、`pnpm boundaries`、`node scripts/runtime-spike/verify-decision.mjs --phase packaging docs/decisions/decision-register.json`、`cargo fmt --check`、`cargo test --locked`、`cargo clippy --all-targets --locked -- -D warnings`。其中 decision gate 必须复算 PRR-067 G-PERF-PROTOCOL 对 ADR 0006 v1.1.0 的 hash 与固定参数绑定；icon gate 必须复算 PRR-068 固定 SVG 母版、完整桌面 7 件、manifest 与 Tauri 引用。复算 initial entry `≤ 500,000B`。此阶段不要运行缺 manifest 必然 fail-closed 的最终 `pnpm quality -- --release-evidence`，它属于 PRR-080。
3. **依赖 advisory**：记录 JS advisory 命令/数据库时间与结果；运行已有 `cargo audit`，不存在时按本卡局部安装。不得把工具缺失、网络失败或旧数据库写成 PASS；无法完成则 `BLOCKED`。
4. **唯一 bundle**：用 PRR-069C-R2 独立审阅通过后的正式 `bundle:tauri` / `scripts/quality/bundle-gate.mjs` 从该 clean HEAD 运行 unsigned app-only Tauri build，并由受控 assembler 装配 ADR 0013 v1.1.0 规定的 ULMO DMG，把 inventory 写进本 source 的新 evidence 目录。正式路径不得调用 Finder/AppleScript、Tauri `dmg` target、CI 绕过或 `.DS_Store`。inventory 必须证明 `.app` 与最终 ULMO `.dmg` 都由本轮刷新，记录 path/SHA-256/bytes/mtime/source、bundle/assembler runner hash、LICENSE/ICNS 输入 hash、装配时间与 `dmgFormat=ULMO`。构建前后 source HEAD 和 worktree 必须不变。
5. **产物身份与 DMG 实测**：从 `.app/Contents/Info.plist` 与可执行文件复算 product/version/bundle id/arm64/`LSMinimumSystemVersion=11.0`、`.mindmap` document type、UTI/MIME、category、LICENSE/THIRD_PARTY_NOTICES 携带和 CSP/capability；验证 candidate 未签名。用 `hdiutil imageinfo` 复算最终 `Format=ULMO`，只读挂载 `.dmg`，核对 EULA、能打开、包含的 `.app` hash/身份与 inventory 关系、卷图标 hash 以及 `.dmg ≤ 25000000B`，随后正常 detach；不得签名、调用公证或改变系统信任。
6. **真机性能**：对同一 `.app` 用 `run-performance.mjs --scope release --platform macos --samples 20` 在全新的 attempt evidence 子目录生成 `cold-conditioning.json`、raw 与 summary；先执行恰好一次 conditioning，成功后再采 20 个 conditioned cold 与 20 个 warm 样本。`sessionFirstLaunchMs` 必须在 conditioning artifact 与 summary 一致展示，`conditionedColdStartP95Ms≤1500ms`；另含 renderer-ready、stable RSS、300/450 pan/zoom/drag、create/move/connect/undo、save、2x PNG。每项记录失败数、p50/p95/max、fixture hash、`measurementSource=native-candidate`、candidate/source/runner hash；conditioning artifact 必须由 summary 的 SHA-256 绑定。conditioning 或任一样本失败即整轮 INCOMPLETE；同目录已有本轮性能产物必须拒绝覆盖，重试使用新 attempt 子目录并保留旧轮，不得复用、复制、改写或混合旧 raw data。
7. **受控安装与文件关联**：先 `install-gate --plan`，再对同一 candidate 执行 `--execute`；按 receipt/hash 证明复制、身份校验和只清理本轮安装。临时注册 LaunchServices 后验证 Finder/`open` 的冷启动与运行中 `.mindmap` 路由、已有 `.json` 兼容、默认 Save As `.mindmap`，结束时注销/恢复并记录前后状态。发现外来安装或无法可靠恢复时停止，不得覆盖或强删。
8. **完整原生功能矩阵**：只操作真实 candidate，不以 jsdom、dev server、web harness 或 Rust 单测替代。每项必须记录操作方式（鼠标/accelerator/VoiceOver）、预期、实际、时间、截图/日志路径和 candidate hash：

   | 组 | 必测事实 |
   | --- | --- |
   | 零 chrome / 两主题 | not-started 与 in-progress 两种启动均直接显示纯画布；无 WebView 顶栏、菜单、按钮、状态文字或 onboarding；暖白/黑板各一张 1080×864 图；React Flow attribution 保留；选择节点时上下文工具条出现、取消选择后消失；AX 树无隐藏“主工具条” |
   | 原生菜单 / a11y | `Mind Map/文件/编辑/视图/帮助` 全项名称、顺序、enabled/check、快捷键提示正确；鼠标、键盘菜单导航、VoiceOver 逐项可发现；VoiceOver 权限不可用且需要修改系统权限时返回 `BLOCKED`，不得自行改系统设置 |
   | accelerator / exactly-once | `⌘N/O/S/⇧⌘S/E/⇧⌘L/⇧⌘H/W/Q` 各执行恰好一次；导出必须是 `⌘E`，关闭窗口必须是 `⌘W`；菜单鼠标点击同样只执行一次；窗口 closing/destroyed 时命令 fail-closed |
   | 编辑与 IME 隔离 | textarea 的撤销/重做/剪切/复制/粘贴/全选为原生文本语义；画布 `⌘Z/⇧⌘Z/A` 仍走 session/history；节点编辑态与中文 IME composition 期间不得误触发应用/画布命令。若原生 accelerator 绕过既有隔离，立即判 FAIL 并退回 PRR-065，不得在本卡现场改 source |
   | 多窗口 | 至少两个窗口分别载入不同文档/主题/布局；菜单命令、`⌘W`、check state 始终跟随最近聚焦窗口；重复点击当前主题/布局仍恰有一个勾选；关闭一个窗口后其快照不残留、不污染另一窗口 |
   | 文件与关闭 | New/Open/Save/Save As/dirty 标题 `●`、外部变更冲突、旧 handle/token 拒绝、关闭 Save/Discard/Cancel 三分支、保存中关闭、失败重试、逐窗 Quit 均保持 fail-closed |
   | 启动/恢复/热键 | cold argv、running open、重复文件、多个文件、Reopen、最小化/失焦/已聚焦/编辑态/连线态五状态的 `⌥Space` 分流和 recovery/pending-report 均正确 |
   | 导出 | 同一合成中文脑图导出语义 SVG、2x PNG、PDF；三者内容/字体/主题一致，SVG 无编辑控件/`foreignObject`，PNG 尺寸正确，PDF 至少两种 viewer 可打开 |

9. **原生报告**：生成 `.tmp/release-candidate/<source>/macos-native-candidate-report.json`，`evidenceKind=native-candidate`、`platform=macos`、`overall=PASS`；包含 source commit、candidate/dmg hash、环境、逐项命令窗口、结果、artifact path/hash、NotRun（必须为空或只含 Windows deferred 决策）和红线确认。另须包含 `performance.summaryArtifact`、`performance.summarySha256`、`performance.sessionFirstLaunchMs` 与 `performance.conditionedColdStartP95Ms`，并与同轮 performance summary 完全一致。报告不能只引用 `.app` 路径，也不能把 web harness 标成 native。
10. **一致性复算**：确认全部 artifact 都属于同一 source/candidate，runner hash 未漂移，最终 DMG 为 ULMO，报告时间晚于其输入；至少断言 `source freeze <= first source gate start <= last source gate finish <= bundle start <= bundle finish <= downstream reports`，并再次确认 worktree clean。任一解析失败、未来时间、逆序、mismatch、失败、遗漏或 source/candidate 变化都作废本轮，停止并返回，不得拼接旧证据。
11. **交回并等待**：输出绑定精确 source/candidate hash 的 `g-final-request.md/json`（仅请求，不含伪造批准），同时逐值展示 `sessionFirstLaunchMs`、`conditionedColdStartP95Ms` 及其 summary artifact/hash，告诉负责人候选路径、hash、最小人工检查动作和结论格式；状态返回 `WAITING_FOR_OWNER_G_FINAL`。不得自行写 `APPROVED`，不得生成 readiness manifest，不得开始 PRR-080。

负责人 G-FINAL 最小人工检查：从本卡候选启动，确认首次为全干净画布；用系统菜单完成新建/保存/导出、主题/布局切换和开始引导；打开第二窗口确认命令目标；查看一份 `.mindmap` 和三格式导出；确认是否接受该**精确 hash**作为 0.1.0 unsigned 发布候选。

### 阶段 B：仅在负责人原文到位后

1. 核对 `[from-user]` 原文明确包含批准人、结论、source commit、candidate path 与完整 SHA-256；任何缺项都继续等待，不补写、不推断。
2. 在同一 evidence 目录生成独立 `g-final.json`：`approvalKind=g-final`、`status=APPROVED`、`approvedBy`、`approvedAt`、`userRecord`、`sourceCommit`、`candidateSha256`、artifact path/hash 均可复算。
3. 只复核 hash/时间拓扑/worktree，不重跑会覆盖 artifact 的 runner。交回 `PRR-070 COMPLETE / G-FINAL_RECORDED` 后停止；PRR-080 必须由下一次明确派发开始。

### 验收

- source/worktree、`.app`/`.dmg`、全部原生预算、文件关联、安装生命周期、命令/a11y、导出与视觉均 PASS，且没有复用旧证据。
- native report 的 `evidenceKind=native-candidate`，source/candidate/platform/runner/time 全匹配，且双指标及 performance summary path/hash 绑定可由 verifier 复核；Windows 只以 ADR 决策 deferred，不阻断 macOS v1。
- 阶段 A 正确停在 `WAITING_FOR_OWNER_G_FINAL`；阶段 B 的 G-FINAL 有真实主体、时间、原文、独立 artifact 与精确 candidate hash。
- `git status --short` 始终为空；本卡不生成 readiness manifest，也不宣称 `READY_TO_RELEASE`。

### 交回物

- 新 source 目录下的 bundle inventory、source-gate/advisory 日志、release performance raw/summary、install/LaunchServices 证据、DMG/Info.plist/codesign 探针、原生矩阵截图/日志与 `macos-native-candidate-report.json`。
- 阶段 A：`g-final-request.md/json` + 固定格式任务报告，状态 `WAITING_FOR_OWNER_G_FINAL`。
- 阶段 B：负责人原文绑定的 `g-final.json` + hash 清单，状态 `COMPLETE / G-FINAL_RECORDED`。

### STOP

worktree 非 clean；任一源码/测试/runner/tracked 文档在候选构建前后变化；candidate hash 变化；任何 native/性能/DMG/文件关联/VoiceOver/IME/多窗口项失败或缺测；需要覆盖外来安装、删除旧证据、修改系统权限/信任、签名/公证/凭据/push/上传/发布；负责人尚未给出精确 G-FINAL。命中后必须保留现场并报告，不得现场绕过或把 `NotRun` 写成 PASS。

---

## PRR-080：全量质量门与冻结验收包

类型：集成自检 / 验收准备  
优先级：P0  
状态：`BLOCKED_BY_PRR-070`  
依赖：PRR-070 与 G-FINAL

### 目标

由执行 Agent 对不可变 source/candidate/evidence 完成最终自检并冻结验收包，但不自行给出 MM-110 `ACCEPT` 或生成发布交接结论。

### 实施

1. 复算 source、app、DMG、runner、raw/summary、native report 与批准记录 hash。
2. 在已授权的临时清理边界内运行完整 `pnpm quality -- --release-evidence <manifest>` 和 Rust 全测/clippy。
3. 运行 JS production audit 与固定版本 RustSec/Cargo advisory 扫描，记录工具/数据库版本；工具缺失或数据库不可用时保持 `NOT RUN`，不得用许可证扫描替代。
4. 审阅文件 identity/capability、save generation、shortcut invocation、font geometry、CSP、license/notices、bundle metadata 与可恢复性。
5. 检查 manifest 时间拓扑；生成后任何输入不得更新。
6. 生成 `acceptance-request.json` 与验收索引，列出 source/candidate/evidence hash、命令结果、P2 处置、未执行红线和复现命令。
7. 冻结所有输入后停止，把任务交回用户；不得再覆盖 artifact、manifest 或候选。

### 验收

- 全量 quality、verifier、TS/Rust 测试与 advisory 门全部返回 0。
- `acceptance-request.json` 能从冻结 artifact 独立复算，且不存在 `NOT RUN`、未决 P0/P1 或无处置 P2。
- 状态只能是 `READY_FOR_INDEPENDENT_REVIEW`，不能提前写 `READY_TO_RELEASE`。

### STOP

任何证据缺失/过期/不匹配；任一 P0/P1；未处置 P2；验收包冻结后源码或候选发生变化；需要签名、公证、push、上传或公开发布。

---

## PRR-090：独立 MM-110、最终验收与发布交接重建

类型：独立终审 / 交接  
优先级：P0  
状态：`RESERVED_FOR_INDEPENDENT_REVIEWER`  
依赖：PRR-080 冻结验收包  
执行者：当前审阅任务或其他未参与 PRR-000～080 实现/证据生成的独立 Agent

### 目标

独立复算执行 Agent 的全部结论。只有零未决 P0/P1、P2 已书面处置且全部冻结证据真实匹配时，才重新生成 MM-110 与发布交接包。

### 输入

- PRR-000～080 的固定格式交回记录；
- clean source commit；
- 唯一 unsigned `.app/.dmg` 及 inventory；
- readiness manifest、raw evidence、native platform report、真实 G2/G-FINAL；
- `acceptance-request.json`。

### 实施

1. 不信任执行 Agent 的 PASS 摘要，独立复算 source、runner、candidate 和 artifact hash。
2. 抽查并重跑高风险测试：证据负向 fixture、字体几何事务、handle 重放、安装/文件关联、原生性能和三格式导出。
3. 复算全部 percentile、预算、包体、plist/UTI/minos、许可证覆盖及 manifest 时间拓扑。
4. 检查执行期间是否发生越权删除、生产配置修改、系统注册、签名、公证、push 或发布。
5. 输出新 MM-110，只能为 `ACCEPT` 或 `REJECT`，不得条件通过。
6. 仅在 `ACCEPT` 后生成新 handoff，列出 checksum、支持系统、许可、证据索引、签名/公证/发布待办与回退方案。

### 验收

- 所有结论能由冻结输入独立复算，抽样重跑与执行 Agent 结果一致。
- 新 MM-110 明确 source/candidate/evidence hash，旧候选和旧 handoff 不被复用。
- 通过时状态为 `READY_FOR_RELEASE_EXECUTION_REVIEW (UNSIGNED / NOT_PUBLISHED)`，仍不代表发布授权。

### STOP

任何 hash/时间/身份/测量来源不匹配；证据需要执行者解释后才能成立；任一 P0/P1；P2 未处置；候选或源码已变化。

---

## 推荐派发顺序

1. 负责人先提供四组输入，并处理 PRR-000、PRR-030 授权项与 PRR-060 法律输入。
2. 先独占执行 PRR-000，再按派发矩阵执行 PRR-010/020/040/050/030/060。
3. 000～060 集成后执行 PRR-065；PRR-065 形成新的 clean source commit，旧 PRR-070 试跑证据全部作废。
4. 由于 `b45dc0c` 已复现 Finder `.DS_Store` 无上限等待，PRR-069C 已完成替代路线；其独立审阅结论为 `REVISE`，下一步只执行 PRR-069C-R2，原候选与 attempts 只读保留。
5. 从包含 PRR-069C-R2 实现、独立审阅接受记录与状态同步的新 clean commit 串行执行 PRR-070 → G-FINAL → PRR-080，在 `READY_FOR_INDEPENDENT_REVIEW` 停止。
6. 用户把冻结验收包交回当前审阅任务，由我执行 PRR-090；发布执行仍需另开任务和明确授权。
