# 发布前收口任务卡（PRC-000～PRC-090）

日期：2026-09-07  
状态：`DRAFT / NOT_AUTHORIZED_FOR_EXECUTION`  
指南：[pre-release-closure-development-guide-2026-09-07.md](./pre-release-closure-development-guide-2026-09-07.md)  
审阅输入：[2026-09-07 发布前终审](../../.omx/reviews/2026-09-07-mrt-post-vra-final-review.md)

## 共同执行合同

每张卡开始前必须：

1. 读取根 `AGENTS.md`、开发指南和本卡。
2. 重新检查 `git status --short`，只认领本卡列出的文件；发现重叠修改时停止并交给 PRC-060 协调。
3. 先建立失败复现或契约测试，再改实现；不能通过跳过测试、吞错误或放宽预算制造绿灯。
4. 交付时记录：source commit/当前 HEAD、实际修改文件、执行命令、退出码、证据路径、未覆盖项和风险。
5. 不得删除文件/目录、修改密钥或生产凭据、改 CI/CD/生产配置、安装全局依赖、`git push`、rebase、重写历史、签名、公证、上传或公开发布，除非对应 Gate 对精确动作已有单独批准。

状态含义：

- `READY_READ_ONLY`：只读盘点可以开始，任何写入仍依任务授权。
- `BLOCKED_BY_GATE`：必须取得卡中列出的 Gate 后才可实施。
- `READY_AFTER_DEPENDENCIES`：依赖卡通过后即可派发。
- `DONE`：所有验收项与证据齐备；仅“代码已写”不能标记 DONE。

---

## PRC-000：源码基线清点与变更账本

类型：审计 / 集成准备  
优先级：P0  
状态：`READY_READ_ONLY`  
依赖：无  
Gate：写入账本需 `G-PRC-PLAN`；任何删除、移动、忽略或提交动作需逐项进入后续批准范围

### 目标

把当前大规模脏工作树还原成可解释的变更集合，确定每个路径的来源、owner、发布归属和最终处理方式；本卡不追求强行把工作树变 clean。

### 当前已知起点

- 终审快照为 112 个 tracked 变化、59 个 untracked，共 171 个路径。
- `packages/platform/src/lifecycle/tauri-adapter.ts` 当前显示为 tracked deletion，必须确认这是有替代实现的计划删除，不能默认接受。
- `input/` 下有视觉参考文件；不得默认纳入发布源码，也不得擅自删除或移动。
- `docs/quality/evidence/visual-alignment/` 中部分图片会被测试再生成，必须区分权威证据与可再生产物。

### 允许范围

- 只读：整个仓库的 Git 状态、diff、文件大小、引用关系和生成脚本。
- 写入（G-PRC-PLAN 后）：`docs/quality/evidence/pre-release/source-change-ledger-2026-09-07.json` 及对应 README 入口。
- 禁止：改生产代码、删除/移动文件、改 `.gitignore`、stage、commit、stash、reset。

### 实施步骤

1. 重新采集 `git status --short`、`git diff --stat`、`git diff --name-status`、untracked 文件清单和大文件清单。
2. 对每个路径记录：
   - `path`
   - `gitState`
   - `originBatch`（MRT/VRA/PRC/用户输入/未知）
   - `owner`
   - `classification`（release-source、review-evidence、reference-input、regenerable-output、obsolete-candidate）
   - `intendedDisposition`（track、retain-untracked-pending-decision、ignore-pending-decision、delete-pending-approval、superseded-pending-review）
   - `evidenceOrGenerator`
   - `approvalRequired`
3. 用 `rg` 检查 deleted/renamed 文件的消费者，尤其确认新的 window bootstrap 实现是否完整替代旧 adapter。
4. 对所有 untracked 源码和文档检查反向引用，避免“测试只在工作树通过，提交后缺文件”。
5. 对二进制参考输入记录大小、SHA-256、来源和许可状态，不复制内容。
6. 输出 unresolved 清单；任何 origin 或 owner 为 unknown 的路径都阻塞 PRC-060。

### 验收

- 账本覆盖当前 `git status --short` 的每个路径，路径集合精确相等。
- tracked deletion、untracked source、参考素材和再生证据均有独立分类。
- 没有执行删除、移动、忽略、stage 或 commit。
- 每个待处理动作都有明确 owner/Gate；无“稍后再看”类模糊项。
- `git diff --check` 通过（现有跨卡问题可列明，但不得被本卡制造）。

### STOP / BLOCKED

- 发现无法确认来源的源码或二进制。
- 同一路径同时被两个活跃任务修改。
- 需要通过删除文件或忽略目录才能继续。
- 账本路径数和 Git 状态不一致。

### 交接

将账本路径、未决决策和推荐 commit 分组交给 PRC-060；不得把本卡标为 `SOURCE_READY`。

---

## PRC-010：v1 平台范围与发布门纠偏

类型：质量门 / 发布契约  
优先级：P0  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-000 只读清点完成  
Gate：`G-PRC-SCOPE`

### 目标

让 PRD、Accepted ADR、发布检查表、performance runner 和 evidence verifier 对 v1 平台范围保持一致：macOS Apple Silicon 是唯一 required platform，Windows 明确 deferred，既不阻断 v1，也不冒充已通过。

### 允许修改范围

- `docs/quality/README.md`
- `docs/quality/release-checklist.md`
- `docs/quality/v1-quality-gates.md`
- `docs/quality/v1-test-spec.md`
- `docs/quality/v1-risk-register.md`
- `docs/quality/mm-090-manual-matrix.md`
- `docs/quality/evidence-index.json`
- `docs/product/v1-product-spec.md`（只纠正与已批准 §1.1/AC-14/G1 冲突的旧平台验收行）
- `docs/product/licensing.md`（只纠正 Windows candidate 作为 v1 必选项的旧表述）
- `docs/quality/evidence/` 下 release manifest/schema/fixture 文档
- `scripts/quality/verify-evidence.mjs`
- `scripts/quality/run-performance.mjs`
- `scripts/quality/run-all.mjs`
- `README.md`（仅当 quality 命令参数发生变化）
- 上述脚本的测试/fixture

不得改变 PRD §1.1、AC-14、G1 或 Accepted ADR 已批准的 macOS v1 范围来迎合旧脚本；只允许修正它们下游仍残留的历史双平台措辞。不得修改 CI/CD 工作流文件，除非 `G-PRC-SCOPE` 另行精确批准。

### 实施步骤

1. 建立平台措辞对账表，至少覆盖 PRD 性能表、quality gates、test spec、risk register、manual matrix、evidence index、licensing、release checklist、runner 和 verifier；区分当前规范与保留不改的历史审计记录，并同步纠正 quality 文档中仍写成 pending 的 G1 状态与仍阻塞 v1 的 R-013 状态。
2. 先更新产品/quality 当前规范，写明 `requiredPlatforms` 与 `deferredPlatforms` 的定义和权威引用；旧 `.omx` 审计快照保留原文，不回写历史。
3. 将 readiness manifest schema 升级为明确版本，新增：
   - `releaseScope.productVersion`
   - `releaseScope.requiredPlatforms`
   - `releaseScope.deferredPlatforms[].platform/reason/decisionRef`
4. 改造 verifier：
   - 只要求 required platform 为 `verified`；
   - deferred platform 允许 `deferred/not-run`，但必须有 reason 与 decisionRef；
   - 拒绝 unknown、duplicate、required/deferred 重叠、空 required 列表；
   - 报告中的 platform 必须与对象 key 和 scope 一致；
   - 当前 source commit、clean worktree、artifact 存在性等原有 fail-closed 规则保持不变。
5. 从 `run-performance.mjs --scope release` 的 blocked reasons 中移除“Windows 设备缺失”作为 macOS v1 阻塞；G2/candidate 缺失仍 fail-closed。
6. 让 `run-all.mjs` 从 manifest scope 驱动证据判定，不再隐含双平台门。
7. 为最终发布验证增加显式入口，例如 `--release-evidence <manifest-path>`：
   - 未传入候选 evidence 时 fail-closed，报告 `BLOCKED_BY_CANDIDATE_EVIDENCE`；
   - 不允许静默回退到仓库内旧的 timestamped readiness manifest；
   - manifest 可位于 G2 批准、非 tracked source tree 的 artifact 目录；
   - verifier 仍必须在 candidate 的 `sourceCommit` checkout 上确认 HEAD 相等且工作树 clean。
8. 建立至少以下 fixture 测试：
   - macOS required 且完整 → PASS；
   - macOS required 但缺失/失败 → FAIL；
   - Windows deferred/not-run 且理由完整 → 不阻断；
   - Windows deferred 却写 verified 假证据 → 按 schema 规则拒绝或要求真实 artifact；
   - Windows 加入 required 但无报告 → FAIL；
   - required 为空、重复或与 deferred 重叠 → FAIL。

### 验收

- 搜索不到 verifier/发布检查表中“v1 必须双平台通过”的硬编码语义。
- 当前生效的 PRD/quality/risk/licensing/evidence 文档中不再把 Windows 原生候选或 Windows 性能证据列为 macOS v1 的必选项；历史审计快照保持不变并在对账表中列出。
- 当前 gate 状态统一为 G0/G1 approved、G2 pending；R-013 体现已由 macOS-first 范围吸收，不再作为本次 v1 blocker。
- Windows 状态清楚显示为 `deferred/not-run`，而非 PASS。
- schema 正反测试全部通过。
- `node scripts/quality/run-performance.mjs --scope release --platform macos` 在 G2 未批准时只报告 G2/candidate 阻塞，不报告 Windows 阻塞。
- `pnpm quality` 在候选未产出阶段仍诚实 fail-closed；不能为了本卡强制全绿。
- `pnpm quality -- --release-evidence <fixture>` 的 CLI 契约有测试并写入根 README。
- `pnpm typecheck`、`pnpm lint`、相关脚本测试和 `git diff --check` 通过。

### STOP / BLOCKED

- owner 不批准 macOS-only required scope。
- 现有 evidence schema 有外部消费者但无法确认迁移策略。
- 修改必须触及 CI/CD，而授权范围没有列出精确文件和行为。
- 方案通过忽略全部 platform reports 来获得绿灯。

### 交接

输出 schema 版本、迁移说明、fixture 矩阵和命令结果；PRC-070/080 必须消费新 schema。

---

## PRC-015：ADR 0011 as-built 对账与架构放行

类型：架构治理 / 实现对账  
优先级：P0  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-000 清点完成  
Gate：`G-PRC-PLAN` 允许修订 Proposed ADR；只有项目负责人可记录 `G-PRC-ADR` / Accepted

### 目标

解决 `docs/decisions/0011-post-vra-reliability-and-loading.md` 已“实现落地”但仍为 Proposed 的倒置状态，把每条决定与真实代码、测试和剩余风险逐项对账；在 PRC-020/025/030 开发前先确定最终协议。

### 允许范围

- 只读审查 ADR 0011 涉及的 host/file/preferences/shortcut/export/loading 实现和测试。
- 修改 ADR 0011、相关 architecture 文档和对账报告。
- owner 明确接受后，才可更新 decision register 中的 ADR version/hash/status 引用。
- 本卡不改生产代码；发现实现偏差时分派到 PRC-020/025/030 或新责任卡。

### 实施步骤

1. 为 ADR 0011 六项决定建立 `decision → code → positive test → negative test → residual risk` 矩阵：
   - window generation/post-I/O commit；
   - 50 MiB bounded read；
   - 32/64 MiB export font limits；
   - corrupt preferences recovery；
   - shortcut transactional rebind；
   - exporter/font/WASM lazy loading。
2. 复跑每项最小测试，确认文档所称行为不是只存在于未提交文件或测试 fake。
3. 把本轮发现的三个协议缺口写入 ADR 决策面：
   - open 内容/identity 必须 descriptor-bound；
   - font resolver 未 ready 时不得提交 fallback node size；
   - shortcut 必须在 host 改变焦点前取得 renderer pre-focus 事实。
4. 推荐将仍为 Proposed 的 ADR 0011 修订为新版本后一次审签；如果 owner 要求拆 ADR，则记录清楚引用关系，不允许一半 Accepted、一半靠口头约定。
5. 由项目负责人给出 `ACCEPT` 或 `REJECT`：
   - ACCEPT：记录版本、SHA-256、日期、批准范围与后续实现卡；
   - REJECT：保持 Proposed，列出冲突和替代决定，阻塞 PRC-020/025/030。

### 验收

- 六项已实现决定均有代码和正/负测试引用，无孤立条款。
- descriptor、font barrier、pre-focus 三项有明确决策，不再由实现者自由发挥。
- ADR 的 Status、Version、hash 与 decision register 一致。
- owner 决策有明确日期和范围；执行者没有自行把 Proposed 改成 Accepted。
- `git diff --check` 和 ADR/architecture 本地链接检查通过。

### STOP / BLOCKED

- 实现和 ADR 语义无法对齐，且需要改变数据兼容或性能边界。
- 缺少 owner 对 ADR 拆分/合并或协议选择的决定。
- 某项“已实现”只有文档陈述，没有测试或生产调用点。

### 交接

输出对账矩阵、Accepted/Rejected 记录和 PRC-020/025/030 的精确协议输入。

---

## PRC-020：descriptor-bound 文件打开协议

类型：可靠性 / 文件安全  
优先级：P1  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-015 通过  
Gate：`G-PRC-ADR`

### 目标

消除“按路径读取内容，再按路径取得身份”的 TOCTOU 窗口，确保打开得到的 bytes、digest、identity 和发放的 capability 都源自同一个底层文件对象。

### 允许修改范围

- 新增下一编号的 Proposed ADR：descriptor-bound open 与平台退化规则
- `apps/desktop/src-tauri/src/file/mod.rs`
- `apps/desktop/src-tauri/src/file/identity.rs`
- `apps/desktop/src-tauri/src/file/handle.rs`
- `apps/desktop/src-tauri/src/file/error.rs`
- 相邻 Rust tests/fixtures
- 只有 IPC 错误契约变化时才可改 `packages/platform/src/file/tauri-file-adapter.ts` 与 `packages/platform/src/ipc/types.ts`

不得改变 50 MiB 限制、generation 语义、冲突处理或自动覆盖策略；不得顺带重构整个 file module。

### 红灯用例

先新增确定性 provider/fake 或受控临时文件测试，覆盖：

1. open descriptor 后路径被替换：返回原 descriptor 内容，但 capability identity 与内容一致；当前路径不再匹配时不得授权其为同一路径对象。
2. identity 在 bounded read 前后变化：返回稳定、可重试错误，无 handle 泄漏。
3. 大于 50 MiB：在超限处停止读取，无完整大缓冲。
4. symlink/rename/hard-link 组合：canonical 路径显示与 descriptor identity 不混淆。
5. 失败后 reservation/generation/handle 表没有 orphan entry。

### 实施步骤

1. ADR 先定义：平台 identity 字段、descriptor 所有权、canonical-only 行为、错误码、重试语义和 Windows 后续实现边界。
2. 以单次 `File/OpenOptions` 打开 canonical target。
3. 从 descriptor metadata 构造 identity；从同一 descriptor 做有界流式 read + SHA-256。
4. 发放 capability 前，将 path metadata 与 descriptor identity 做最后绑定检查；失败时丢弃临时状态并返回稳定错误。
5. capability 保存 descriptor-derived identity/digest；未来 save 时继续做当前路径 identity/generation 校验。
6. 确保任何错误分支都关闭 descriptor，并回滚尚未提交的 reservation。

### 验收

- 新增红灯用例在旧实现失败，在新实现通过。
- 内容、digest、identity 均可追溯到同一 descriptor。
- 路径替换不会让 A 文件内容获得 B 文件身份/权限。
- 失败路径无 orphan handle、reservation 或 generation 漂移。
- 50 MiB 边界与流式 hash 行为保持原契约。
- Rust 相关测试、完整 `cargo test`、平台 adapter test、`pnpm typecheck` 和 `git diff --check` 通过。
- ADR 保持 Proposed，直到 owner 明确接受；执行者不能自行改为 Accepted。

### STOP / BLOCKED

- 目标平台只能提供路径复核，无法提供 descriptor identity。
- 需要改变对外文件格式、自动覆盖策略或数据迁移。
- 需要新增运行时依赖但没有体积/许可/替代方案说明和 ADR 决策。

### 交接

附竞态复现方式、错误码、handle 清理证明、测试命令和平台限制说明。

---

## PRC-025：字体 ready 前的权威几何提交屏障

类型：数据一致性 / 启动交互  
优先级：P1  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-015 通过  
Gate：`G-PRC-ADR`

### 目标

保留“首帧不等待 PDF/PNG/WASM/字体重资源”的启动策略，同时保证真实 bundled font resolver 就绪前，不会把 `DEV_FONTS` 近似度量写成 node 的持久化权威 `size`。

### 已知风险路径

- `LazyTauriExportRenderer` 初始把 `fontProxy` 指向 `DEV_FONTS`，加载后才切换到真实 resolver。
- `MindMapApp` ready 后只 `bump()` 刷新。
- `EditorCanvas` 的 controller/编辑器直接使用同一个 proxy 计算 `CreateNode`、文本/眉题/字体变化后的 size。
- 已提交 node size 不会因 React 刷新自动重测，因此 ready 前的近似值可能进入保存文件并影响导出边界。

### 允许修改范围

- `apps/desktop/src/app/ports.ts`
- `apps/desktop/src/app/mindmap-app.tsx`
- `packages/ui/src/canvas/editor-canvas.tsx`
- 与几何提交相关的 node editor/context toolbar/controller 局部代码
- `packages/export` 的 readiness 类型只在需要暴露 resolver 状态时修改；不改布局算法和字体预算
- 对应 Vitest/integration/performance tests 与 ADR 0011 实现说明

不得全图重写已有 node size，不得更改 schema，不得恢复“启动前同步加载全部 exporter”。

### 红灯用例

使用可控 deferred font resolver：fallback 与 real 对相同 Latin/CJK/标点返回明显不同宽度，然后覆盖：

1. ready 前双击/quick-create/Enter 创建并输入文本。
2. ready 前提交文本编辑、眉题和字体切换。
3. ready 前触发 Save、Close-Save 或导出。
4. resolver ready、reject、组件卸载和窗口 generation 变化。
5. 已载入旧文档在 resolver ready 时不得无命令地改写所有 size。

旧实现至少应在“ready 前提交的 size 来自 fallback”用例变红。

### 实施步骤

1. 在 app port 中暴露稳定的 font metrics readiness：`pending | ready | failed` 与可等待 promise；不能靠轮询或 fixed sleep。
2. 枚举所有会产生/改变权威 node size 的入口，集中经过一个 geometry commit barrier。
3. pending 时可以显示画布并保留用户意图/输入，但不提交依赖 fallback metrics 的 command；ready 后用真实 resolver 计算并恰好提交一次。
4. 编辑器的失焦、Enter、Save/Close-Save 与窗口销毁必须有确定行为：等待成功后提交，或显示可恢复错误并保留输入；不得静默丢字。
5. resolver failed 时不产生部分 command/canonical save；提供 retry 或明确的不可提交提示。
6. 已有文档继续使用持久化 size，不因 ready 事件全图重排；只处理本次 pending 用户意图。
7. 测量 first-frame 与 metrics-ready 延迟；若等待影响明显，再把 font metrics load 与 PDF/resvg renderer 分离，保持现有字体和 layout 契约。

### 验收

- 任一 geometry-affecting command 的 size 都不来自 `DEV_FONTS` fallback。
- pending intent 在 ready 后最多提交一次，undo 仍为一次用户动作，dirty/revision 正确。
- Save/Close-Save/导出不会捕获未提交文字或 fallback size。
- font load 失败可见、可重试且不丢输入；组件卸载/窗口换代后旧 promise 不提交。
- ready 不会隐式重排旧文档，也不制造无用户命令的 dirty 状态。
- 首帧仍不等待重型 exporter；主入口预算不超过 500,000 bytes。
- 相关 unit/integration、export golden、canvas performance、typecheck/lint/build 与 `git diff --check` 通过。

### STOP / BLOCKED

- 修复只能通过修改 schema 或批量重算既有文档 size。
- 需要更换字体、布局算法或放宽启动预算。
- 等待/重试只能靠 fixed sleep，或会在窗口销毁后提交旧操作。
- 保存路径无法知道仍有 pending geometry intent。

### 交接

附旧实现红灯、readiness 状态机、pending intent 生命周期、first-frame/metrics-ready 测量和完整回归结果。

---

## PRC-030：全局快捷键 pre-focus 协议

类型：可靠性 / 跨进程交互  
优先级：P1  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-015 通过  
Gate：`G-PRC-ADR`

### 目标

让当前批准的 `⌥Space / Alt+Space`（以及用户换绑后的组合）基于“调用发生前窗口是否已聚焦”决定是否创建节点，消除 host 先聚焦导致 renderer 误判的竞态，同时保留当前注册/rebind/rollback 的事务保证。

### 允许修改范围

- 新增下一编号的 Proposed ADR，或在 owner 指定下修订现有 Proposed ADR 0011
- `apps/desktop/src-tauri/src/shortcuts/mod.rs`
- 必要的 host window registry/runtime 文件
- `apps/desktop/src/app/mindmap-app.tsx`
- `packages/platform/src/lifecycle/` 中快捷键路由相关模块
- 对应 Rust、Vitest、integration 与 macOS e2e 测试

不得改变用户快捷键、编辑中的 no-op 规则、撤销语义或快捷键设置 UI；不得用固定 sleep 判断焦点。

### 红灯用例

先让测试可确定控制 pre-focus 状态和事件顺序，覆盖：

- 前台且未编辑：创建一个子节点。
- 前台且正在编辑：不创建节点，不打断 IME/输入。
- 后台：只 show/focus，不创建节点。
- 最小化：unminimize/show/focus，不创建节点。
- 无窗口/冷启动：创建或恢复窗口，不创建节点。
- probe 回应晚于 invocation 过期：不得延迟创建。
- 窗口在 probe 与 reply 之间重建：旧 generation reply 无效。
- 同一 invocation 重放：最多消费一次。

### 实施步骤

1. 定义单次协议，例如：
   - host → renderer：`shortcut://pre-focus-probe { invocationId, windowId, generation }`
   - renderer → host：`resolve_shortcut_invocation { invocationId, windowId, generation, hadDocumentFocus }`
   - host → renderer：只有允许创建时才发 `shortcut://quick-create { invocationId, generation }`
2. host 先 probe，不先 show/focus；renderer 立即读取调用瞬间的焦点状态。
3. host 校验 invocation/window/generation，单次消费后失效。
4. `hadDocumentFocus=true` 时才触发 quick-create，再由现有画布状态机对 editing/IME/连线态执行 no-op；其他情况只做安全唤醒。
5. renderer 未响应时安全退化为“只唤醒、不创建”；TTL 只负责失效/清理，不决定业务真值。
6. 保留并回归当前 operation lock、startup retry、rebind serialization 和 rollback 行为。

### 验收

- 旧实现的“先 focus 后判断”路径已不存在。
- 五种用户状态、过期/重放/generation race 均有自动化测试。
- 前台空闲每次调用最多创建一个节点；后台/最小化/冷启动为零。
- 编辑状态、IME、undo/redo 和 selection 无回归。
- 注册失败/rebind 失败仍回滚到可用 binding，不产生双注册。
- Rust 全测、shortcut Vitest/integration、macOS e2e（候选阶段可补原生证据）、typecheck/lint 通过。

### STOP / BLOCKED

- 只能通过 sleep/固定毫秒数猜测窗口是否已聚焦。
- Tauri 事件无法安全携带 invocation/window generation，需改变更大 IPC 架构。
- 修复会改变用户快捷键或产品行为，但产品规格未更新。

### 交接

附协议时序、state matrix、失败退化策略、所有测试与原生待验项。

---

## PRC-040：生产 CSP 与最小权限收口

类型：安全 / 生产配置  
优先级：P1  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-000 清点完成；建议在 PRC-020/030 接口稳定后执行  
Gate：`G-PRC-CONFIG`

### 目标

把 `apps/desktop/src-tauri/tauri.conf.json` 的 `security.csp: null` 改成基于真实 production build 的最小 CSP，并确认 Tauri capability 只开放已用命令、窗口和本地资源。

### 允许修改范围

- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/capabilities/*.json`
- 必要的安全说明/ADR/quality 文档
- `scripts/quality/scan-network-endpoints.mjs` 或新增 CSP 校验脚本与测试
- 仅为满足正确 CSP 而需要的局部资源加载代码

所有生产配置修改必须在 `G-PRC-CONFIG` 精确列出；删除 capability 条目同样不得越过批准范围。

### 实施步骤

1. 构建 production `dist/`，盘点 JS/CSS、inline style/script、字体、图片、WASM、worker、data/blob URL 和 Tauri IPC scheme。
2. 记录每条 CSP directive 的真实消费者与不用它时的失败现象。
3. 设置 production CSP：本地优先、无通配符、无远程 http/https、无 `unsafe-eval`；若必须保留 inline style，单独记录原因，script 不随之放宽。
4. 如开发服务器需要不同策略，使用明确的 dev-only 配置，不污染 production。
5. 审计 capability：window scope、event、dialog/fs/自定义命令逐项对照调用点；没有调用点的权限列为待删除项，获得批准后再移除。
6. 在 production Tauri app 中验证：启动、字体、WASM、打开/保存/另存为、SVG/PNG/PDF 导出、快捷键和多窗口；捕获控制台与 host 日志中的 CSP violation。
7. 增加静态门：拒绝 `csp: null`、`default-src *`、remote endpoint、`unsafe-eval` 和未解释的 wildcard。

### 验收

- production CSP 非空，网络扫描无未批准 endpoint。
- production candidate 启动和核心本地功能无 CSP violation。
- 字体、WASM 与三格式导出都来自批准的本地资源。
- capability 每项有消费者/理由；无为了省事新增的广泛 shell/fs/window 权限。
- `pnpm net:scan`、production build、CSP test、相关单元/integration test 和 `git diff --check` 通过。
- 配置变更与批准范围逐项一致。

### STOP / BLOCKED

- 必须加入远程域名或联网能力，但产品规格没有批准。
- 只能使用 `unsafe-eval` 或 `default-src *` 才能启动。
- 需要改生产配置但 `G-PRC-CONFIG` 未覆盖具体文件/行为。
- 验证只在 Vite dev server 完成，无法在 production app 重现。

### 交接

附 CSP directive → consumer 表、capability → callsite 表、production 日志和复现命令。

---

## PRC-050：产品身份、许可与 G2 决策包

类型：产品 / 法务 / 发布治理  
优先级：P0  
状态：`BLOCKED_BY_GATE`  
依赖：G-PRC-PLAN；可与开发卡并行收集信息  
Gate：项目负责人和必要的法律/品牌 owner；最终形成 G2

### 目标

把候选打包所需的所有产品、法律与操作边界变成明确决策；不允许执行者用默认值或占位符替代 owner 决定。

### 必答清单

| 决策 | 必须输出 |
| --- | --- |
| 产品显示名 | 菜单栏、窗口标题、安装包一致名称 |
| Bundle identifier | 最终反向域名标识，不能使用示例值 |
| 版本 | app/package/Cargo/bundle 的统一版本和 build number 规则 |
| 系统支持 | 最低 macOS 版本、Apple Silicon 架构、Intel Mac 是否明确排除 |
| 文件类型 | 默认扩展名、UTI、MIME、描述、图标、打开方式 |
| 应用图标 | 最终资产、来源、许可、尺寸和生成链 |
| 软件许可 | 私有/商业/开源的准确文本与展示位置 |
| 第三方 notices | npm/Cargo/字体/LXGW/Noto 的许可证与归属，阻塞项处理 |
| 候选类型 | unsigned `.app`、`.dmg` 或其他明确组合 |
| 输出路径 | 每个允许生成的绝对或 repo-relative 目录 |
| 证据路径 | 候选专属 raw/summary manifest 的非 tracked artifact 目录 |
| 安装目标 | 是否允许复制到 `/Applications` 或仅临时运行；逐项列出 |
| 允许动作 | build、launch、install、uninstall、quarantine/permission probe 等逐项列出 |
| 删除边界 | 可清理的精确候选/临时路径；不得使用宽泛 glob |
| 签名/公证/发布 | 默认全部不批准；如需要，另开独立 Gate |
| 分发目标 | 私有试用/GitHub/其他渠道的最终选择；只记录，不在本卡执行 |

### 允许修改范围

- `docs/product/licensing.md`
- 相关产品/发布说明（产品范围变化才改 PRD）
- `docs/decisions/decision-register.json`
- `docs/decisions/decision-register-template.json`
- `scripts/runtime-spike/verify-decision.mjs` 及 G2 packaging profile 测试
- 必要的 Proposed ADR 或 G2 审批记录
- 本卡只形成决策，不直接改 `tauri.conf.json`、package metadata 或 production code；这些由 PRC-060 按已批准值统一应用。

### 实施步骤

1. 从现有 package/Cargo/Tauri config、图标、字体清单和 license scanner 汇总当前值，标注一致/冲突/占位。
2. 为每个未决项给 owner 一个推荐值、替代方案和影响，但不自行选定。
3. 运行 `pnpm license:scan`，将 unknown/copyleft/notice 缺口逐项归类；不得自动移除依赖。
4. 将 owner 的精确答案写入产品/许可文档和 G2 `approvedScope`。
5. G2 至少包含 `selectedHost`、`candidateOutputPaths`、`evidenceOutputPaths`、`installationTargets`、`allowedActions`、`deletionBoundaries`，且全部为非空精确数组。
6. 明确记录不在本次批准范围内的签名、公证、上传和公开发布。

### 验收

- 必答清单无 `TBD`、示例 identifier 或未定许可证。
- 所有第三方依赖/字体均有许可证、来源和 notices 处理结论。
- G2 `approvedScope` 可被 `bundle-gate` / `install-gate` 机器读取，且边界足够具体。
- 各文档的产品名、版本、平台和文件类型一致。
- `pnpm license:scan` 返回 0，或每个非零项有 owner 明确阻塞/替代决定；进入 PRC-060 前必须清零。
- `git diff --check` 通过。

### STOP / BLOCKED

- owner 尚未给出产品名、identifier、扩展名或许可结论。
- 要求执行签名、公证、上传或公开发布。
- 需要删除/替换依赖或资产，但没有精确批准。
- G2 使用“相关目录”“必要文件”等不可机器执行的宽泛描述。

### 交接

输出已批准值表、license/notices 清单、G2 记录位置和明确排除项，交给 PRC-060/070。

---

## PRC-055：候选 bundle/install/performance runner 实装

类型：发布工具链 / 安全执行门  
优先级：P0  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-010 scope/schema 定稿；PRC-050 G2 schema 定稿  
Gate：修改 release gate 需 `G-PRC-SCOPE`；实际 build/install/performance 执行仍需 G2 approved

### 目标

把当前“永远 BLOCKED”的占位链路改成可执行但默认 fail-closed 的候选工具：G2 pending 时绝不产生/安装候选；G2 精确批准后可以按 scope 构建 unsigned Tauri candidate、执行受控安装/卸载和采集真实 release performance evidence。

### 当前红灯

- `run-performance.mjs --scope release` 固定生成 BLOCKED 报告，不消费 candidate，也不测 cold/warm start 或 RSS。
- `install-gate.mjs` 即使 G2 approved，最终仍固定提示“动作本体尚未实现”并退出 1。
- `bundle-gate.mjs` 只拒绝签名迹象，没有读取 G2，也没有校验 candidate output path/allowed action。
- 当前文档中的 `pnpm bundle:tauri -- --unsigned` 与真实 CLI/签名保证没有形成唯一、可测试契约。

### 允许修改范围

- `package.json` 与根 `README.md` 的候选命令
- `scripts/quality/bundle-gate.mjs`
- `scripts/quality/install-gate.mjs`
- `scripts/quality/run-performance.mjs`
- `scripts/quality/measure-release-assets.mjs`
- 已有 macOS runner/Swift probe 中与候选测量直接相关的局部代码
- 上述 runner 的 fixture、unit/integration tests 与 quality 文档

不得触及签名、公证、凭据、系统信任或上传实现；不得在本卡测试中实际安装/卸载正式候选。

### CLI 契约

执行时应收敛成唯一入口，精确名称可在实现测试中确认，但至少具备以下参数：

```text
bundle-gate --host tauri --scope-from <register> --candidate-root <path> -- <tauri-build-command>
install-gate --host tauri --scope-from <register> --candidate <path> --evidence-dir <path> --plan|--execute
run-performance --scope release --platform macos --candidate <path> --evidence-dir <path>
```

- `--plan` 必须为 install gate 默认模式，只输出规范化操作列表，不改文件系统。
- `--execute` 必须同时满足 G2 `status=approved`、selectedHost、allowedActions、installationTargets、deletionBoundaries 与 candidate hash/path 校验。
- release performance 未传 candidate/evidence dir、路径越界或 hash 不一致时必须失败，不能回退测 web dev build。

### 实施步骤

1. 抽取共享的 G2 scope loader/validator，拒绝空数组、相对逃逸、symlink 越界、宽泛 glob、host 不匹配和禁止动作。
2. Bundle gate 在启动子进程前同时验证：
   - G2 approved；
   - `selectedHost=tauri`；
   - allowedActions 包含 build；
   - candidate root 位于唯一批准目录；
   - 环境/配置没有任何 signing hint。
3. Bundle 完成后只盘点批准目录内的新产物，生成 inventory/hash；发现越界产物即失败并保留现场，不自动删除。
4. Install gate 实现 plan/execute 分离：
   - plan 输出 source → target、会创建/替换/删除的精确路径；
   - execute 前拒绝预存但不属于本 candidate 的同名 app；
   - uninstall 只移除本次 execution 创建且 hash/identity 相符的目标；
   - 任一身份不符立即停止，不清理未知文件。
5. Release performance runner 从真实 `.app`/bundle 采集至少 20 次 cold/warm launch、stable RSS、bundle/installer size，并调用既有 dense canvas/native lifecycle 探针；raw samples 和 summary 写入 `--evidence-dir`。
6. 所有 runner 记录 source commit、candidate SHA-256、runner version/hash、OS/arch、完整命令和退出码。
7. 更新根 README，移除多义的 `--unsigned` 传参写法，说明“unsigned”由 signing-hint fail-closed 门保证；若 Tauri CLI 有官方 no-sign 参数，再以本地 CLI help/测试为准记录。

### 测试矩阵

- G2 missing/pending/blocked → bundle/install/release performance 在 spawn 前失败。
- host、action、candidate root、install target 或 evidence dir 不在 scope → 失败。
- `..`、symlink、大小写/规范化逃逸 → 失败。
- signing env/config 命中 → 失败，且不输出凭据值。
- approved synthetic scope + fake command runner → bundle inventory 与 performance summary 可生成。
- install `--plan` → 零文件系统变更；重复 plan 幂等。
- install execute fake → 只操作批准路径；pre-existing target、hash mismatch、部分失败均不误删。
- runner 中断 → 保留 raw evidence 和明确 incomplete 状态，不写 READY。

### 验收

- 三个 runner 不再包含“即使合法输入也固定退出 1”的占位分支。
- 当前 G2 pending 时，`pnpm bundle:tauri`、install execute 和 release performance 都在任何外部写入前 fail-closed。
- approved fixture 的 dry-run/假执行覆盖 build、install、uninstall、measurement 全链路，且没有实际系统安装。
- 任何 path/action/signer 越界都有负向测试。
- 输出 schema 可由 PRC-010 verifier 消费，candidate/source/hash 不可缺失。
- `pnpm typecheck`、`pnpm lint`、runner tests、`pnpm net:scan` 和 `git diff --check` 通过。
- 实际 G2 scope 下的真实执行留给 PRC-070，不在本卡发生。

### STOP / BLOCKED

- G2 schema 仍无法表达 candidate/evidence/install/deletion 精确路径。
- 只能通过 `rm -rf`、宽泛 glob 或覆盖预存 app 完成卸载。
- 需要访问证书、keychain、Apple ID 或改变系统信任。
- 原生性能只能从 dev server 推断，无法绑定 candidate。
- 需要新增全局依赖或修改 CI/CD，但未获单独批准。

### 交接

输出 CLI 规范、scope 负向测试、dry-run 样例、runner schema 和“G2 pending 无副作用”证明，交给 PRC-060/070。

---

## PRC-060：集成、可追溯提交与干净源码基线

类型：集成 / 发布源码  
优先级：P0  
状态：`READY_AFTER_DEPENDENCIES`  
依赖：PRC-000～PRC-055 全部通过；G2 中与源码身份有关的值已确定  
Gate：所有删除/移动/忽略动作逐项批准；本卡不授权 push

### 目标

把已审阅的 MRT/VRA/PRC 变更整合为可重建、可追溯、无未知文件的 clean commit，并应用 PRC-050 已批准的产品身份；不引入新功能。

### 允许范围

本卡可触及 PRC-000 账本中已批准进入 release source 的路径，以及应用已批准产品身份所需的：

- package/Cargo/Tauri metadata
- 文件关联与图标配置
- license/notices/release 文档
- quality evidence 索引

任何不在账本中的新路径都要退回 PRC-000；任何行为修复都要退回对应开发卡。

### 实施步骤

1. 冻结派发，确认没有其他任务继续写工作树。
2. 逐项复核 PRC-000 账本，将已批准的 track/retain/ignore/delete 决策应用；删除或移动必须引用用户批准记录。
3. 应用 PRC-050 的产品名、identifier、版本、文件类型、图标、license/notices，检查 package/Cargo/Tauri 一致性。
4. 按逻辑变更分组审阅 diff；禁止把外部参考素材、临时日志、secret、机器路径或假 evidence 混入 release source。
5. 对所有 untracked source 运行引用/构建验证，确保提交后不会缺文件。
6. 运行格式、类型、lint、单元、集成、a11y、golden、视觉、边界、许可、网络和 build；release performance/evidence 在候选前允许以明确 G2/candidate 原因 fail-closed。任何验证命令都不得留下 tracked diff；若视觉/证据 runner 会重写时间戳或图片，先修正为显式 capture 模式或将 candidate-specific 输出导向非 tracked artifact 目录。
7. 检查主入口仍 `<= 500,000` bytes；若超限，退回责任卡优化，不能抬阈值。
8. 创建一个或多个逻辑清晰、可审阅的 commit；不 push。
9. 从 clean checkout/worktree 重新安装已锁定依赖并重建，确认没有依赖未提交文件。
10. 记录最终 `sourceCommit`、lockfile hash、构建命令和 clean status。

### 验收

- `git status --porcelain` 为空。
- 完整验证执行后 `git status --porcelain` 仍为空；不存在“跑一次质量门就改一次 tracked evidence”的行为。
- `git fsck`/基础 Git 检查无新增异常，所有提交可从仓库重建。
- `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:a11y`、`pnpm test:export`、`pnpm test:visual`、`pnpm boundaries`、`pnpm license:scan`、`pnpm net:scan`、`pnpm build` 通过。
- Rust host 全测通过。
- 主入口和其他已批准预算通过，未修改阈值。
- 产品身份与许可在所有产物/文档中一致，无 placeholder。
- release performance/evidence 只剩候选原生数据，不再有代码、scope、license、CSP 或 dirty-worktree 阻塞。
- 没有执行 `git push`、rebase、reset-hard、签名或发布。

### STOP / BLOCKED

- 任一路径在账本中仍 unknown/unapproved。
- clean 只能通过删除用户文件、覆盖修改或宽泛 `.gitignore` 达成。
- clean rebuild 与当前目录结果不同。
- 某项测试只能通过更新 golden/阈值但变化未经产品/视觉审阅。

### 交接

输出 source commit、commit 列表、clean 证明、完整门禁结果和候选构建输入清单；PRC-070 只能从该 commit 产出候选。

---

## PRC-070：unsigned macOS 候选包与原生验收

类型：候选构建 / 原生 QA  
优先级：P0  
状态：`BLOCKED_BY_GATE`  
依赖：PRC-060、G2 approved  
Gate：G2 的 candidate paths/actions/installation/deletion 精确范围；视觉结论需 `G-FINAL`

### 目标

从 PRC-060 的唯一 clean commit 产出未签名 macOS Apple Silicon 候选，完成真实 app/bundle 上的性能、文件生命周期、快捷键、权限、导出和视觉验收。

### 安全边界

- 只允许 `pnpm bundle:tauri` 及 G2 明确列出的 unsigned 构建参数。
- `bundle-gate` 检测到签名配置或凭据迹象时必须失败。
- 不执行签名、公证、上传或公开发布。
- 安装/卸载只允许 `pnpm test:install:tauri` 在 G2 精确允许的目标和删除边界内执行；当前 install runner 若仍是占位 fail-closed，先作为独立实现缺口处理，不手工绕过。
- 不触发 `permission-probe.swift --request`，除非 G2 单独批准触发系统权限弹窗。

### 实施步骤

1. 验证 HEAD 等于 PRC-060 `sourceCommit` 且工作树 clean。
2. 运行 `pnpm bundle:tauri`；记录完整命令、退出码和输出路径。
3. 对 `.app`/`.dmg`（以 G2 为准）计算 SHA-256、包大小、展开大小，记录 bundle metadata、架构与签名状态（应为 unsigned）。
4. 用 candidate 而非 dev server 执行 release performance：
   - 冷启动/热启动 p95；
   - stable RSS；
   - dense 300～450 节点画布交互；
   - 打开、保存、另存为、关闭、崩溃恢复；
   - SVG、2x PNG、PDF 导出及外部查看器打开。
5. 原生验证快捷键五状态：前台空闲、前台编辑、后台、最小化、无窗口/冷启动；每项记录创建节点数和窗口结果。
6. 验证 descriptor-bound open 的用户可见失败路径：路径对象变化时不误授权、不覆盖、可重试。
7. 验证 production CSP：控制台/host log 无 violation，无网络 endpoint 请求。
8. 验证文件关联、菜单/窗口/安装包显示名、图标、版本、license/notices。
9. 生成 macOS 原生 evidence，绑定 source commit 和 candidate SHA-256。
   - raw、summary 和 readiness manifest 全部写入 G2 批准的非 tracked artifact 目录；
   - 不修改 candidate source checkout 中的 tracked evidence；
   - manifest 路径将由 PRC-080 显式传给 quality/verifier。
10. 将最终视觉/动效对照交给项目负责人；取得 `G-FINAL`，否则记录精确差异并退回责任卡。

### 原生验收矩阵

| 类别 | 必测结果 |
| --- | --- |
| 安装/启动 | approved path 可运行；冷/热启动在 ADR 预算内；无意外权限弹窗 |
| 生命周期 | open/save/save-as/close/reopen/crash recovery 行为与规格一致 |
| 数据安全 | 外部修改与 descriptor mismatch 不覆盖；错误可恢复 |
| 快捷键 | 前台空闲恰好创建 1；其余唤醒/保持编辑且创建 0 |
| 性能 | canvas/edit/save/export/startup/RSS 预算全部有 raw samples |
| 导出 | SVG/PNG/PDF 内容、字体、背景、尺寸在外部 viewer 正确 |
| 安全 | production CSP 无 violation；无未批准联网；capability 无越权现象 |
| 视觉 | 六层视觉证据与候选一致；G-FINAL 有 owner 结论 |

### 验收

- 候选只来自一个 clean `sourceCommit`，candidate SHA-256 唯一。
- macOS Apple Silicon 原生矩阵全部 PASS，或任何 FAIL 明确退回对应卡；不能用 web harness 替代。
- release performance 真实采样并满足 Accepted ADR 预算。
- readiness manifest 的 macOS report 为 verified，Windows 为 deferred/not-run 且有权威引用。
- G-FINAL 明确通过。
- 未执行签名、公证、上传、公开发布或未批准的安装/删除动作。

### STOP / BLOCKED

- G2 仍 pending 或范围使用宽泛路径/glob。
- 构建门检测到证书、签名 identity、Apple ID、keychain 或 signing key。
- 工作树不 clean，或 candidate 无法绑定 source commit。
- install runner 未实现且任务试图手工绕开 gate。
- 性能/生命周期证据来自 dev server、旧候选或另一 candidate hash。
- G-FINAL 未通过。

### 交接

输出 candidate inventory、hash、机器信息、所有 raw/summary evidence、失败重现和 G-FINAL 记录，交给 PRC-080。

---

## PRC-080：最终 Quality Gate 与 MM-110 独立终审

类型：最终验证 / 独立审阅  
优先级：P0  
状态：`READY_AFTER_DEPENDENCIES`  
依赖：PRC-070 完成、G-FINAL 通过  
Gate：MM-110 reviewer 与实现者职责分离

### 目标

从同一 source commit 和 candidate hash 重跑发布门，验证证据完整性，做独立代码/风险审阅，给出唯一 `ACCEPT` 或 `REJECT` 结论。

### 允许范围

- 只读审阅源码、commit、candidate metadata 和 evidence。
- 最终 MM-110 review/evidence summary 只写入 G2 批准的非 tracked release artifact 目录，或写入与 candidate source checkout 隔离的审阅工作区；验证用 source checkout 必须始终 clean。
- 发现问题时不得在本卡顺手改生产代码；P0/P1/P2 均退回责任卡，修复后生成新 candidate 并重跑受影响证据。

### 实施步骤

1. 验证工作树 clean、HEAD/sourceCommit/candidate hash/evidence manifest 四者一致。
2. 运行根标准门：

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test:unit
   pnpm test:integration
   pnpm test:a11y
   pnpm test:export
   pnpm test:visual
   pnpm boundaries
   pnpm license:scan
   pnpm net:scan
   pnpm build
   pnpm quality -- --release-evidence <approved-manifest-path>
   git diff --check
   ```

3. 从 candidate 的 `sourceCommit` clean checkout 运行 release evidence verifier，并显式传入 G2 批准 artifact 目录中的 manifest；确认 macOS required report 与 candidate artifact 存在、hash 一致、命令退出码均为 0。
4. 检查 Windows 只处于 deferred/not-run；确认没有把 Windows 数据伪造为 verified。
5. 独立审阅风险路径：文件 identity/capability、save generation、shortcut invocation、window generation、CSP/capability、license/notices、候选可恢复性。
6. 检查所有 P0/P1 已关闭；P2 只有在 owner 明确写出理由、影响和到期条件时才能接受。
7. 输出 MM-110：`ACCEPT` 或 `REJECT`。任何“条件通过”必须仍视为未完成，除非条件只是公开发布阶段的签名/公证且已明确不属于本批次。

### 验收

- `pnpm quality -- --release-evidence <approved-manifest-path>` 返回 0，没有 G2/candidate/Windows/dirty-worktree 例外。
- evidence verifier 返回 0，所有 artifact 可读且绑定当前候选。
- 独立 reviewer 没有参与本轮具体修复实现，或审阅记录明确说明无法隔离并安排第二 reviewer。
- MM-110 结论唯一、可复核，无未决 P0/P1。
- 如为 `REJECT`，包含最小复现、责任卡和重跑范围，不修改生产代码。

### STOP / BLOCKED

- 任意 evidence 与 source/candidate hash 不一致。
- 工作树不 clean 或测试会生成未解释 tracked diff。
- reviewer 被要求忽略失败、降低严重级别或接受缺失证据。
- 只有旧候选/旧截图可用。

### 交接

`ACCEPT` 后将 review、命令结果和 evidence manifest 交给 PRC-090；`REJECT` 时直接退回对应卡，不进入发布交接。

---

## PRC-090：发布执行交接包（不执行公开发布）

类型：发布准备 / 交接  
优先级：P0  
状态：`READY_AFTER_DEPENDENCIES`  
依赖：PRC-080 `ACCEPT`  
Gate：本卡不含签名、公证、上传或公开发布；这些动作需要新的明确授权

### 目标

把已验证候选整理成他人可以无歧义执行发布的交接包，使项目状态达到 `READY_TO_RELEASE`，但停在任何对外动作之前。

### 交付内容

1. Release identity：版本、source commit、candidate SHA-256、架构、构建时间、构建命令。
2. Candidate inventory：每个 `.app`/`.dmg`/辅助文件的路径、大小、用途和是否 unsigned。
3. Verification index：MM-110、G-FINAL、macOS performance、lifecycle、shortcut、export、CSP、license/notices 的链接。
4. Release notes：用户可见能力、已修问题、明确非目标（Windows、云同步、遥测等）。
5. Known limitations：只保留 owner 已接受且不影响 P0/P1 的限制。
6. Distribution checklist：未来签名、公证、staple、上传、下载校验、回滚的逐步清单，但全部标为 `NOT_AUTHORIZED / NOT_EXECUTED`。
7. Recovery/rollback：候选不发布时如何保留证据；发布后若发现问题应停止分发的触发条件。不得在本卡实际删除候选。

### 允许修改范围

- 只读使用仓库内已经随 PRC-060 提交的 release notes、license/notices，以及 G2 artifact 目录内的 PRC-070/080 evidence。
- 只在 G2 批准的非 tracked release artifact 目录中生成交接索引、checksum 与不可执行的操作清单。
- 不修改 tracked source、候选二进制、生产代码、CI/CD、签名或分发配置；发现交接内容缺失时退回 PRC-060，重建候选并重跑证据。

### 验收

- 交接文档中的 commit/hash/version 与 PRC-070/080 完全一致。
- 所有链接可访问，所有 checksum 可复算。
- `READY_TO_RELEASE` 与 `PUBLISHED` 被明确区分。
- Windows 写为后续专门版本，不写成当前候选已验证。
- 签名、公证、上传、外部提交、`git push` 全部未执行。
- source checkout 在生成交接包前后都保持 clean，HEAD 仍等于 candidate 的 `sourceCommit`。

### STOP / BLOCKED

- MM-110 不是 `ACCEPT`。
- 任一 checksum、candidate path 或 evidence link 无法复核。
- 交接过程要求修改二进制或生产配置。
- 用户要求直接发布但没有对签名、公证、上传目标和 Git 动作给出精确授权；应另开发布执行任务。

### 完成声明模板

```text
状态：READY_TO_RELEASE（未发布）
版本：<version>
Source commit：<sha>
Candidate SHA-256：<sha256>
目标平台：macOS Apple Silicon
MM-110：ACCEPT
G-FINAL：APPROVED
未执行：签名、公证、上传、公开发布、git push
下一 Gate：由项目负责人对精确发布动作单独授权
```

---

## 派发顺序摘要

1. 先派 PRC-000，只做清点。
2. 项目负责人批准 `G-PRC-PLAN` 后，完成 `G-PRC-SCOPE`、`G-PRC-ADR`、`G-PRC-CONFIG`。
3. PRC-010/015、PRC-040 与 PRC-050 信息收集可并行；G-PRC-ADR 通过后再并行 PRC-020/025/030，PRC-050 不改生产配置。
4. PRC-000～055 全部关闭后，冻结其他写入，派 PRC-060。
5. G2 精确批准后串行执行 PRC-070 → G-FINAL → PRC-080 → PRC-090。
6. 到 `READY_TO_RELEASE` 停止；签名、公证、上传和公开发布另开任务并重新授权。
