# 发布前终审整改任务卡（PRR-000～PRR-090）

日期：2026-09-07  
状态：`PARTIAL_IMPLEMENTATION_REVIEWED / BLOCKED_BY_OWNER_INPUT`  
指南：[pre-release-remediation-development-guide-2026-09-07.md](./pre-release-remediation-development-guide-2026-09-07.md)  
审阅输入：[pre-release-code-review-2026-09-07.md](../quality/pre-release-code-review-2026-09-07.md)
当前审阅：[prr-000-050-implementation-review-2026-09-07.md](../quality/prr-000-050-implementation-review-2026-09-07.md)

## 共同执行合同

每张卡必须先读根 `AGENTS.md`、指南和本卡，先建立红灯再改实现。交付必须列出 source HEAD、改动文件、命令/exit code、证据路径、未覆盖项和风险。

以下动作仍必须由项目负责人单独批准：删除文件/目录，修改生产 Tauri 配置或 CI/CD，写入/确认最终法律文本，安装到系统目录或更改 LaunchServices 状态，签名/公证/凭据访问，Git push/rebase/reset，上传或公开发布。

旧 `.tmp/release-candidate` 不得修改成“通过”，也不得未经批准清理。任何新证据都进入新的 source/candidate hash 子目录。

执行 Agent 必须从包含 2026-09-07 审阅小修的当前 working-tree snapshot 开始；只从 `main@541d38c` 启动的新 worktree 不具备正确基线。每卡交回时使用以下固定格式：

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
| 4 | PRR-070 | 不可并行 | 000～060 集成、clean commit、精确 G2 | 唯一新候选与原生证据 |
| 5 | PRR-080 | 不可并行 | PRR-070/G-FINAL 完成 | 冻结验收包 |
| 6 | PRR-090 | 不可并行；保留给独立验收者 | 用户把 PRR-080 交回当前审阅任务 | MM-110 与发布交接结论 |

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

## PRR-070：新 unsigned 候选、原生矩阵与 G-FINAL

类型：候选构建 / 原生验收  
优先级：P0  
状态：`BLOCKED_BY_PRR-065`（2026-09-08 负责人指令：新增零画布顶栏产品决定须先经 PRR-065 实施，PRR-070 从其后的新 clean source commit 完整重做；本轮在 caf1c20 上的试跑构建与性能矩阵不作为验收候选冻结）  
依赖：PRR-000～060、PRR-065、clean source commit、精确 G2

### 目标

从 clean source 构建唯一新候选，对同一 hash 完成所有原生证据，并取得负责人 G-FINAL。仍不签名、不公证、不发布。

### 实施顺序

1. 记录 source commit 和 clean worktree；运行完整源码门。
2. bundle gate 构建 `.app/.dmg`，inventory 证明本轮刷新、hash/size/runner。
3. 运行 PRR-010 性能；不得复用旧 raw data。
4. 执行受控 install/launch/LaunchServices 验证。
5. 在真实候选覆盖：冷启动、running/open、dirty、多窗口、最小化、关闭三分支、恢复、快捷键五状态、`.mindmap`/`.json`、SVG/2x PNG/PDF、CSP/权限/零网络。
6. 输出 `macos-native-candidate-report.json`，每项含命令、时间、结果、artifact 与 candidate hash。
7. 把候选交给项目负责人实际查看/操作；只在收到明确结论后记录 G-FINAL `[from-user]`。
8. 最后生成 readiness manifest，不再覆盖任何输入 artifact。

### 验收

- `.dmg`、全部原生预算、文件关联、安装生命周期、导出与视觉均 PASS。
- native report 的 `evidenceKind=native-candidate`，source/candidate/platform 全匹配。
- G-FINAL 真实主体、时间、artifact、candidate hash 齐全。
- verifier 返回 0；工作树保持 clean。

### STOP

任一源码或 runner 在构建后变化；candidate hash 变化；需要删除旧证据或修改系统状态但未授权；负责人未做 G-FINAL。

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
3. 000～060 集成完成后形成 clean source commit。
4. 串行执行 PRR-070 → G-FINAL → PRR-080，在 `READY_FOR_INDEPENDENT_REVIEW` 停止。
5. 用户把冻结验收包交回当前审阅任务，由我执行 PRR-090；发布执行仍需另开任务和明确授权。
