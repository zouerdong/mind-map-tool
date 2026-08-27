# 极简自由脑图工具：开发任务卡

> 状态：Ralplan 共识任务集；G0 尚未批准，当前不授权派发 Spike 或实现。

> 用途：用户可把单卡独立交给其他 Agent。本文不派发 Agent、不授权公开发布。所有 Agent 先读根 `AGENTS.md` 与本卡依赖产物；遇到用户确认门槛必须停止。

## 1. 执行图与冲突控制

```text
MM-000 G0 approval
   -> MM-010 host/canvas/export spike -> MM-000 G1 approval -> MM-020 bootstrap -> MM-030 core
MM-030 -> MM-040 layout/scene/export -----> MM-050 canvas -> MM-070 theme/onboarding ---+
MM-030 -> MM-060 selected host/file/lifecycle -----------------------------------------+-> MM-080
MM-040 + MM-060 -> [only if decision=native-host] MM-045 native renderer --------------+
MM-080 -> MM-090 QA -> MM-000 G2 approval -> MM-100 packaging/license -> MM-110 review
```

可并行：MM-040 与 MM-060。共定义 13 张卡：正常执行账本为 12 张；MM-045 是条件分支卡，仅当 decision register 的 export renderer 推荐为 `native-host` 且 G1 已批准时激活，并在 MM-060 后串行执行。其他情况下 MM-045 记为 `NOT_ACTIVATED`，不计入“已执行/已完成”数量。不可并行：MM-020 与任何实现卡、MM-040 与 MM-050、MM-050 与 MM-070、MM-060 与 MM-045/MM-100。每卡只修改允许路径；跨路径需求先回报。

统一回报格式：`状态；修改文件；关键决定；验证命令及结果；未运行项/原因；风险/阻塞；下一卡输入；commit（如有，不要求）`。

统一 `STOP/BLOCKED` 规则适用于每一张卡，并在各卡内重复引用：依赖产物缺失、所需 Gate 未 `approved`、decision/任一必需轨为 `blocked`、ADR 未达到卡片要求的 `Accepted` 版本、需要修改允许路径之外文件、需要新增但许可证扫描不通过的运行时依赖、缺少要求的 macOS/Windows 实机证据，或触发删除、CI/CD、凭据、签名、公证、上传、发布等红线时，立即停止；不得降级标准或扩权，按统一回报格式返回 `BLOCKED` 与所需用户决定。

## MM-000｜确认产品与 ADR 门槛

- **目标**：把规划转成正式产品/ADR 草案，并作为 G0/G1/G2 的唯一可审计登记入口；本卡在三个 Gate 分别复用。
- **依赖**：PRD、架构、测试规格、风险登记册和 decision register 模板；G1 还依赖 MM-010 PASS evidence，G2 还依赖 MM-090 PASS evidence与法律审阅输入。
- **允许修改路径**：`docs/product/**`、`docs/decisions/**`、`docs/quality/**`。
- **非目标**：不选许可证文本，不安装依赖，不写产品代码，不发布。
- **步骤**：①固化首版范围并建立精确 ADR：`0001-desktop-host.md`、`0002-canvas-view.md`、`0003-core-schema-session-save.md`、`0004-export-renderer.md`、`0005-export-font-pdf.md`、`0006-performance-platform.md`、`0007-licensing.md`；②从模板初始化 `docs/decisions/decision-register.json`；③G0 仅记录本地 Spike 授权、两平台设备/OS 与红线；④MM-010 后只允许用户把有 PASS evidence 的推荐批准为 G1/Accepted，逐轨写 approved value、candidate evidence digest、ADR id/version/hash，并把它们绑定到 `sourceSpikeResult` path/SHA-256/generatedAt；⑤运行 `verify-decision.mjs --phase bootstrap`，任何推荐/evidence/snapshot/ADR 漂移都使 G1 失效并重新审签；⑥MM-090 后按法律与发布准备证据记录 G2 的精确本地范围，并运行 `--phase packaging`；⑦每次更新 `docs/quality/mm-000-review.md`，逐链接对照 deep-interview spec、PRD、ADR、风险与 Gate，建议/研究不得冒充批准。
- **交付物**：`docs/product/v1-product-spec.md`、上述 7 份编号 ADR、`docs/quality/v1-quality-gates.md`、`docs/decisions/decision-register.json`、`docs/quality/mm-000-review.md`。
- **验收**：G0/G1/G2 仅在对应证据齐全时批准；G1 的批准人、时间、四轨 value/PASS evidence digest、source Spike snapshot SHA-256、ADR id/version/hash 均可机器追溯且漂移即失效；未决项保持 Proposed/TBD；明确无服务器后端；人工审签记录逐项链接到事实来源。
- **验证命令**：`test -f docs/product/v1-product-spec.md && test -f docs/decisions/decision-register.json && test -f docs/quality/v1-quality-gates.md && test -f docs/quality/mm-000-review.md && rg -n "G0|G1|G2|Proposed|Accepted|BLOCKED|无服务器后端" docs/product docs/decisions docs/quality && git diff --check`；JSON schema/链接结构在 MM-010 的 `verify-decision.mjs` 建立后追加执行，人工一致性以 `mm-000-review.md` 为 evidence，不伪装成自动证明。
- **Risk IDs**：R-002、R-003、R-007、R-009、R-011、R-013、R-016。
- **STOP/BLOCKED**：适用统一规则；此外，不得批准无 PASS evidence 的 G1 轨道，不得把 G2 本地准备推定为签名/公证/上传/发布授权。
- **风险**：把建议误写成用户决定；缓解：每个关键条目标 `[from-user]`、`[from-research]` 或 `Proposed`，批准必须由项目负责人写入 register。
- **回报模板**：按统一格式，另附当前 Gate、批准/拒绝清单、decision register diff 和下一 Gate 前置条件。

## MM-010｜双平台 host、画布与 renderer Spike

- **目标**：分别评估 host、canvas view、export renderer 和 font 四轨，输出可审计的 recommendation 或 `blocked`，绝不强迫选择失败候选。
- **依赖**：MM-000 的 G0=`approved`；macOS/Windows 测试设备和本地实验 scope 已登记。这不等于采纳、实现或发布授权。
- **允许修改路径**：`scripts/runtime-spike/**`（harness/README/fixtures/命令，受版本控制）、`.tmp/runtime-spike/**`（仅可再生产物）、`docs/quality/runtime-spike-results.md`、`docs/quality/runtime-spike-decision.json`、`docs/quality/runtime-spike-decision.sha256`、`docs/decisions/0001-desktop-host.md`、`docs/decisions/0002-canvas-view.md`、`docs/decisions/0004-export-renderer.md`、`docs/decisions/0005-export-font-pdf.md`。
- **非目标**：不建设正式产品、不修改 CI/CD、不签名/公证、不凭单平台下结论。
- **步骤**：①用同一硬件/脚本/阻断标准比较 Tauri/Electron；②独立比较 React Flow/最小自研 React view，覆盖 attribution/API/许可、300/450、IME、a11y、投影隔离；③比较 TS/WASM/native renderer，覆盖 semantic SVG、2x PNG、PDF、中文字体、locale/timezone/DPI、OOM；④评估至少一个有可分发/嵌入许可和 CJK 覆盖的字体候选；⑤覆盖 early/cold/warm open、activation、中文/空格/等价路径；⑥按模板写顶层与四轨 `recommendation-ready|blocked`、每个候选 `pass|fail|not-tested`、evidence、blocked reasons 与 JSON 内 generatedAt；⑦冻结聚合后的 `runtime-spike-decision.json`，对其最终 bytes 计算 SHA-256 并写入独立 sidecar `runtime-spike-decision.sha256`，不得把自哈希写回 snapshot；供 G1 建立不可变 digest bridge；⑧只更新允许路径内的 Proposed ADR recommendation，绝不写 Accepted。
- **交付物**：可从全新 clone 运行的 harness、host/canvas/renderer/font 评分与原始数据、两平台独立报告、MM-010 聚合报告、样本 hash、`docs/quality/runtime-spike-decision.json` 及其 `.sha256` sidecar、Proposed ADR 建议。
- **验收**：macOS/Windows release 结果各一份且聚合报告由 MM-010 owner签署；推荐只能引用 PASS+evidence；任一必需轨全失败则该轨和顶层 `blocked`、推荐 `null`，MM-020 不得继续；缺任一平台设备返回 BLOCKED；G1 仍为 pending，等待项目负责人批准。
- **验证命令**：`node scripts/runtime-spike/verify-decision.mjs --phase spike-result docs/quality/runtime-spike-decision.json --sha256-sidecar docs/quality/runtime-spike-decision.sha256`（G1 正常 pending 时也应通过）；macOS 运行 `scripts/runtime-spike/run-macos.sh --release --all`，Windows 运行 `powershell -File scripts/runtime-spike/run-windows.ps1 -Release -All`；再运行 `git diff --check`。
- **Risk IDs**：R-001、R-002、R-003、R-004、R-007、R-008、R-009、R-013、R-015、R-016。
- **STOP/BLOCKED**：适用统一规则；任一平台报告缺失、四轨任一为 blocked、字体无合格候选时，返回 BLOCKED，不得用最高分失败项或占位值填充。
- **风险**：设备差异、字体造成假回归、临时代码污染；缓解：记录环境，scene/字体固定，正式代码零复用假设。
- **回报模板**：按统一格式，另附 host/canvas 评分、renderer owner、字体结论、blocked reasons 与用户确认项。

## MM-020｜仓库工具链与桌面骨架

- **目标**：仅在 ADR Accepted 后建立可复制的 workspace、质量命令与最小桌面窗口。
- **依赖**：MM-010 recommendation-ready；MM-000 已记录 G1=`approved`、`sourceSpikeResult` path/SHA-256/generatedAt、四轨 approved value/PASS evidence digest 及 Accepted ADR id/version/hash；`verify-decision.mjs --phase bootstrap` 通过。
- **允许修改路径**：根仅 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc`、`.nvmrc`、`rust-toolchain.toml`（仅 Tauri）、`tsconfig*.json`、`vite.config.*`、`vitest.config.*`、`eslint.config.*`、`prettier.config.*`、`README.md`、`AGENTS.md`；应用仅 `apps/desktop/**`；包配置仅 `packages/*/package.json`、`packages/*/tsconfig*.json`、新建 `packages/export/README.md`；质量入口仅 `scripts/quality/**`。其他根文件不在权限内。
- **非目标**：不实现节点、文件、导出、引导；不改 `.env`、CI/CD；不公开发布。
- **步骤**：①先运行 `verify-decision.mjs --phase bootstrap`，验证 G1 approvedTracks、source Spike snapshot 与 ADR digests 未漂移后，只 scaffold G1 获选分支；②固定 Node/条件化 host 工具/package manager；③建立 workspaces；④先更新根 `AGENTS.md` 登记 `packages/export/`，再创建 README/manifest；⑤创建 `scripts/quality/run-all.mjs`（支持稳定 `--focus` case 集）、`run-export-golden.mjs`、`run-performance.mjs`、`aggregate-evidence.mjs`、`check-boundaries.mjs`、`scan-dependency-licenses.mjs`、`scan-network-endpoints.mjs`、`run-platform-macos.sh`、`run-platform-windows.ps1`、`run-e2e-macos.sh`、`run-e2e-windows.ps1`；⑥创建 `test:a11y`、支持显式 `--unsigned` 且发现签名配置即失败的 `bundle:tauri|electron`、要求 `--scope-from` 的 `test:install:tauri|electron` 等获选 host/条件分支入口，未获选入口明确 fail-closed 或不进入默认构建；⑦`check-boundaries.mjs --scope selected-canvas` 必须按 decision fail-closed 选择 React Flow 或 custom view 断言；⑧为 bootstrap profile 建立推荐替换、candidate evidence/Spike snapshot/ADR version/hash 漂移及 approved value 不匹配的 negative tests；⑨每个新增运行时依赖立即做 license scan；⑩补 README 唯一命令。
- **交付物**：可安装/构建的空桌面壳、lockfile、标准命令、依赖清单。
- **验收**：全新 clone 可构建；未获选 host/renderer 不在依赖图；`packages/export/` 已先登记；质量脚本存在；无服务端/遥测/云依赖；license scan 通过。
- **验证命令**：先执行 `node scripts/runtime-spike/verify-decision.mjs --phase bootstrap docs/decisions/decision-register.json`；再执行共同 `pnpm install --frozen-lockfile && node scripts/quality/scan-dependency-licenses.mjs && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit && node scripts/quality/check-boundaries.mjs --scope selected-canvas && pnpm build`；仅 Tauri 分支追加 `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`，仅 Electron 分支追加 `pnpm --dir apps/desktop electron:check`。
- **Risk IDs**：R-004、R-012、R-016。
- **STOP/BLOCKED**：适用统一规则；`verify-decision` 非零、source Spike/approvedTracks/ADR 任一 digest 缺失或漂移、G1 未批准或任一必需轨非 recommendation-ready 时，不得安装正式依赖或创建桌面骨架。
- **风险**：根配置高冲突、依赖膨胀；缓解：本卡独占执行，逐依赖记录。
- **回报模板**：按统一格式，附版本表、安装/构建时长、空壳包体。

## MM-030｜Core schema、命令与历史

- **目标**：实现 canonical document/encoding、命令历史和 `DocumentSession` 保存快照/dirty 语义。
- **依赖**：MM-020；schema/commands ADR Accepted。
- **允许修改路径**：`packages/core/**`。
- **非目标**：不依赖 React/React Flow/Tauri/DOM；不实现文件系统或 UI；不实现自动布局。
- **步骤**：①定义 V1 schema、canonical UTF-8 encoding 与上限；②实现永不复用 StateIdentity、commands/inverse；③实现 `DocumentSession`、不可变保存快照、排队保存，以及只存放/回传 opaque `DocumentTargetHandle + VersionToken` 的 platform port；④普通 Save 冻结 handle/token/bytes，Save As 冻结一次性 authorization，失败不改变 handle/token/saved identity；⑤固定 viewport 不持久化/不 undo/不 dirty，theme 相反；⑥覆盖分叉/undo-back/in-flight success/failure 与 handle 不序列化 tests；⑦文档化 API。
- **交付物**：core package、合成 fixtures、unit tests、README API。
- **验收**：canonical round-trip/hash；无 dangling edges；删除/批移原子；分叉不误 clean；undo 回保存节点 clean；异步保存不误清新编辑；selection/viewport/history/path/target handle 不序列化；core 不解析或伪造 handle。
- **验证命令**：`pnpm --filter ./packages/core lint && pnpm --filter ./packages/core typecheck && pnpm --filter ./packages/core test`。
- **Risk IDs**：R-014、R-016。
- **STOP/BLOCKED**：适用统一规则；schema/session/save ADR 未 Accepted、需要平台 API 或文件系统实现、canonical contract 与批准版冲突时停止回报。
- **风险**：过早锁死扩展名/迁移；缓解：只实现 schema version，不决定品牌标识。
- **回报模板**：按统一格式，附 schema 摘要、命令表、测试数量/覆盖缺口。

## MM-040｜确定性导出包

- **目标**：实现共享文本布局、semantic SVG scene；默认 TS/WASM 分支完整拥有三格式，native 分支只交付 canonical SVG 并把转换交给 MM-045。
- **依赖**：MM-010 导出结论、MM-030 core API、字体/PDF ADR Accepted。
- **允许修改路径**：`packages/export/**`、`tests/fixtures/export/**`、`tests/golden/export/**`；该目录必须已由 MM-020 登记，禁止修改 native host。
- **非目标**：不读取 React DOM，不用 `html-to-image` 主链，不导出 selection/onboarding，不增加富媒体。
- **步骤**：①固定 font token/显式换行/line-height/padding/baseline/node-size contract；②bounds/scene/canonical SVG hash；③空文档与尺寸/OOM 前置错误；④若 decision=web-ts-wasm，实现 PNG/PDF 并唯一拥有三格式；若 native-host，只定义严格 renderer port/fixtures，禁止实现 native；⑤locale/timezone/DPI/缺 glyph/PDF viewer golden；⑥新增依赖立即 license scan。
- **交付物**：共享 layout/scene/export package、固定夹具/golden；TS/WASM 分支含三格式，native 分支含 canonical SVG + renderer port contract。
- **验收**：同输入 SVG hash 稳定；UI 可复用 layout；2x 尺寸准确；空/极大/缺字体可控；获选分支 owner 完整，无双实现。
- **验证命令**：`pnpm --filter ./packages/export lint && pnpm --filter ./packages/export typecheck && pnpm --filter ./packages/export test && pnpm test:export && node scripts/quality/run-export-golden.mjs && node scripts/quality/scan-dependency-licenses.mjs`。
- **Risk IDs**：R-007、R-008、R-009、R-012、R-015。
- **STOP/BLOCKED**：适用统一规则；font/export ADR 未 Accepted、renderer track blocked、所需依赖许可证失败或必须修改 native host 时停止；native 分支只交 renderer port，不越权实现 native。
- **风险**：中文字体、PDF分页、超大位图内存；缓解：尺寸上限、统一 scene、平台视觉 golden。
- **回报模板**：按统一格式，附导出样本路径/哈希、golden diff、性能结果。

## MM-045｜条件卡：Native PNG/PDF renderer

- **目标**：仅当 `exportRendererOwner=native-host` 时，由唯一 owner 完成 PNG/PDF native 转换与 IPC；否则标记 `NOT_ACTIVATED`。
- **依赖**：MM-040、MM-060；decision register 的 exportRenderer 推荐=`native-host`、G1 approved 且对应 ADR Accepted。否则返回 `NOT_ACTIVATED`，不算执行任务。
- **允许修改路径**：Tauri 分支仅 `apps/desktop/src-tauri/src/export/**`、`apps/desktop/src-tauri/Cargo.toml`；Electron 分支仅 `apps/desktop/electron/export/**`、`apps/desktop/package.json`；共同仅 `packages/platform/src/export-native-adapter/**`、`packages/platform/package.json`；不得修改 file/lifecycle 模块或其他 manifest。
- **非目标**：不修改 scene/SVG/UI，不重复 TS/WASM renderer，不做 DOM 截图。
- **步骤**：①实现 `renderExport(canonicalSvg, format, dimensions, fontToken)`；②校验尺寸/内存/取消；③返回 bytes，由共同 `commitExport` 原子落盘；④PNG/PDF/缺字体/OOM/failure IPC tests；⑤license scan。
- **交付物**：唯一 native renderer、typed adapter、条件分支测试和依赖说明。
- **验收**：只有获选 host 代码存在；三格式同 scene；错误不写半成品；MM-060 文件协议复用而非复制。
- **验证命令**：共同 `pnpm --filter ./packages/platform test && node scripts/quality/scan-dependency-licenses.mjs`；Tauri 分支追加 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml export`；Electron 分支追加 `pnpm --dir apps/desktop test:export-native`。
- **Risk IDs**：R-008、R-009、R-012。
- **STOP/BLOCKED**：适用统一规则；分支未激活时只回报 `NOT_ACTIVATED`；MM-060 未完成、需要修改其 file/lifecycle 路径或 native依赖许可失败时返回 BLOCKED。
- **风险**：与 MM-060 manifest/IPC 冲突；缓解：严格在 MM-060 后串行并限定 export 子目录。
- **回报模板**：按统一格式，首行写 `ACTIVATED native-host` 或 `NOT_ACTIVATED web-ts-wasm`，附 IPC/内存/golden 证据。

## MM-050｜获选 React 画布视图与编辑交互

- **目标**：实现 G1 获选的 React 画布视图、节点/连接/导航交互，所有持久变更提交 core command；仅在推荐=`react-flow` 时使用 React Flow。
- **依赖**：MM-020、MM-030、MM-040 共享 layout；canvas ADR 已 Accepted；若获选 React Flow，attribution/API/许可决定也必须 Accepted。
- **允许修改路径**：`packages/ui/**`（不含 onboarding/theme 后续模块的预留实现）、`docs/quality/evidence/mm-050-performance-macos.json`、`docs/quality/evidence/mm-050-performance-windows.json`、`docs/quality/evidence/mm-050-performance-aggregate.json`。
- **非目标**：不实现文件 IO/导出/桌面菜单；不把任何画布库 state 写入原生文件；仅 React Flow 分支禁止使用未授权 Pro 示例代码并遵守 attribution 决定；custom React view 分支不得引入 React Flow。
- **步骤**：①按 decision.json 实现获选 React view；②projection/controller；③创建/编辑/移动/连接/删除；④用共享 layout 提交 text+size；⑤多选、pan/zoom/fit（viewport session-only）；⑥history hooks、IME/a11y、projection contract tests。
- **交付物**：可嵌入 EditorCanvas、interaction tests、事件到 command 映射文档。
- **验收**：鼠标完整建图；拖动只提交一次 command；中文输入无快捷键冲突；连接随节点移动；`ui → export/layout → core` 边界通过；300/450 双平台交互达 G1 预算并生成结果文件。
- **验证命令**：共同先跑 `pnpm --filter ./packages/ui lint && pnpm --filter ./packages/ui typecheck && pnpm --filter ./packages/ui test && node scripts/quality/check-boundaries.mjs --scope selected-canvas`；macOS 运行 `node scripts/quality/run-performance.mjs --fixture dense-300-450 --scope canvas --platform macos --output docs/quality/evidence/mm-050-performance-macos.json`，Windows 运行 `node scripts/quality/run-performance.mjs --fixture dense-300-450 --scope canvas --platform windows --output docs/quality/evidence/mm-050-performance-windows.json`；MM-050 owner 再运行 `node scripts/quality/aggregate-evidence.mjs --task MM-050 --inputs docs/quality/evidence/mm-050-performance-macos.json,docs/quality/evidence/mm-050-performance-windows.json --output docs/quality/evidence/mm-050-performance-aggregate.json`。缺一平台返回 BLOCKED，raw evidence 不得覆盖。
- **Risk IDs**：R-003、R-004、R-012、R-013、R-015。
- **STOP/BLOCKED**：适用统一规则；canvas track blocked、G1/ADR缺失、共享 layout 未完成、任一要求平台性能结果缺失或需改 core/export 路径时返回 BLOCKED。
- **风险**：双状态漂移、IME/焦点、UI 库锁定；缓解：core 单一事实源、projection contract tests。
- **回报模板**：按统一格式，附交互录屏/截图、command mapping、性能 trace。

## MM-060｜原生平台、文件与生命周期

- **目标**：只为获选 host 实现跨平台 commit protocol、version token、偏好、对话框与 `LaunchRouter`。
- **依赖**：MM-020、MM-030；扩展名/MIME/UTI、窗口策略 ADR Accepted。
- **允许修改路径**：共同仅 `packages/platform/src/file/**`、`packages/platform/src/lifecycle/**`、`packages/platform/src/ipc/**`、`packages/platform/src/preferences/**`、`packages/platform/src/index.*`、`packages/platform/test/**`、`packages/platform/package.json`、`docs/quality/evidence/mm-060-macos.json`、`docs/quality/evidence/mm-060-windows.json`、`docs/quality/evidence/mm-060-aggregate.json`；Tauri 分支仅 `apps/desktop/src-tauri/src/file/**`、`apps/desktop/src-tauri/src/lifecycle/**`、`apps/desktop/src-tauri/src/ipc/**`、`apps/desktop/src-tauri/src/main.rs`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/capabilities/file-lifecycle.json`；Electron 分支仅 `apps/desktop/electron/file/**`、`apps/desktop/electron/lifecycle/**`、`apps/desktop/electron/ipc/**`、`apps/desktop/electron/main.*`、`apps/desktop/package.json`。所有 `export/**` 路径保留给条件 MM-045；安装器/图标专用配置仍保留给 MM-100。
- **非目标**：不实现编辑 UI/导出 scene；不开放任意文件系统；不创建服务或网络监听。
- **步骤**：①typed ports/IPC；②platform file identity + SHA-256 `VersionToken`；③以 host-side ledger 实现 opaque `TargetAuthorization`，canonical path/kind/expiry/consumed 不交给 UI，区分稳定错误 `INVALID_TARGET_AUTHORIZATION`、`TARGET_AUTHORIZATION_EXPIRED`、`TARGET_AUTHORIZATION_CONSUMED`、`TARGET_AUTHORIZATION_KIND_MISMATCH`；④实现绑定 window/session 的 opaque `DocumentTargetHandle`，`openDocument`/成功 Save As 签发 handle+token，ordinary Save 用 handle+expected token且不重开对话框；⑤host 拒绝伪造、过期、撤销、跨窗口 handle，并在 window/session 关闭时撤销；⑥两类 commit 都在 host 二次验证，macOS fsync/rename/dir-sync 与 Windows FlushFileBuffers/ReplaceFileW或MoveFileEx/最终flush；⑦temp-write/sync/token/replace、dialog→commit 外部修改/目标突然出现、authorization forged/replay/expired/wrong-kind 及 handle misuse failure injection，所有拒绝均不写目标、不更新保存身份；⑧偏好；⑨`LaunchIntent→queue→AppReady→normalize/dedupe→WindowAction→ack`；⑩early events、activation、等价路径、连续多文件双平台 tests。
- **交付物**：platform adapter、native commands/events、TargetAuthorization/DocumentTargetHandle/commit contract、macOS/Windows 独立报告、MM-060 聚合报告、集成 tests、平台差异说明。
- **验收**：选择现有/不存在目标后至 commit 的 TOCTOU 均冲突且不覆盖；authorization forged/replay/expired/document-export wrong-kind 返回稳定错误且不创建/覆盖目标、不更新 handle/token/saved identity；`open → edit → ordinary save` 与 `Save As → edit → ordinary save` 不重复弹窗；伪造/过期/撤销/跨窗口 handle 被拒绝；各提交阶段失败保留旧文件和 dirty；early/cold/warm intent 幂等；带文件 cold start 无多余空窗；activation 新建空白且不碰 dirty 窗；未获选 host 不构建；两平台各有一份真实结果。
- **验证命令**：共同 `pnpm --filter ./packages/platform test && pnpm typecheck`；Tauri 分支追加 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml && cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`，Electron 分支追加 `pnpm --dir apps/desktop test:host && pnpm --dir apps/desktop lint:host`；macOS 再跑 `scripts/quality/run-platform-macos.sh --suite file-lifecycle --output docs/quality/evidence/mm-060-macos.json`，Windows 再跑 `powershell -File scripts/quality/run-platform-windows.ps1 -Suite file-lifecycle -Output docs/quality/evidence/mm-060-windows.json`；MM-060 owner 运行 `node scripts/quality/aggregate-evidence.mjs --task MM-060 --inputs docs/quality/evidence/mm-060-macos.json,docs/quality/evidence/mm-060-windows.json --output docs/quality/evidence/mm-060-aggregate.json`。raw evidence 不得覆盖。
- **Risk IDs**：R-001、R-005、R-006、R-010、R-012、R-013、R-014。
- **STOP/BLOCKED**：适用统一规则；缺任一平台设备/报告、数据安全 failure test 失败、host track/G1/ADR缺失、需修改 reserved native export 路径时返回 BLOCKED。
- **风险**：OS 事件次序、Windows WebView2、原子替换差异；缓解：双平台集成和人工测试。
- **回报模板**：按统一格式，附平台矩阵、IPC 清单、失败注入证据。

## MM-070｜主题与交互式首次引导

- **目标**：在现有 UI 上完成白/黑主题和可完成/跳过/重放的引导状态机。
- **依赖**：MM-050；不依赖 MM-060，偏好由 MM-080 注入。
- **允许修改路径**：`packages/ui/**` 中明确的 `theme/`、`onboarding/` 与相关测试。
- **非目标**：不重写编辑器、不做模板/演示模式、不把偏好写进脑图文件。
- **步骤**：①token 与状态对比；②纯 onboarding reducer/state machine + preference input/output port；③锚定 semantic id；④监听真实 commands；⑤skip/replay/reduced-motion；⑥以 fake port 做 a11y/组件测试。
- **交付物**：主题 tokens、onboarding flow、测试、文案清单。
- **验收**：两主题状态清晰；完成/跳过不再强制弹出且可重放；引导不阻塞关闭；文档序列化无 onboarding 字段。
- **验证命令**：`pnpm --filter ./packages/ui test && pnpm --filter ./packages/ui typecheck && pnpm test:a11y`。
- **Risk IDs**：R-012。
- **STOP/BLOCKED**：适用统一规则；MM-050 未完成、需要修改画布核心/平台路径、a11y 入口缺失或主题/引导需求需扩范围时停止回报。
- **风险**：遮罩脆弱、文案与键位漂移；缓解：semantic anchors、从 command map 生成/校验提示。
- **回报模板**：按统一格式，附两主题状态截图、引导路径录屏、a11y 结果。

## MM-080｜桌面应用集成

- **目标**：组合 core/UI/platform/export，完成菜单、快捷键、窗口标题、dirty close 与三格式导出流程。
- **依赖**：MM-040、MM-060、MM-070；若 decision=native-host 还必须 MM-045 完成，web-ts-wasm 分支不得等待/调用 MM-045。
- **允许修改路径**：`apps/desktop/src/**`、`apps/desktop` 前端测试与静态资源；不改 native host/config。
- **非目标**：不改变 schema/命令/IPC；不加入后端、更新器、遥测或新范围。
- **步骤**：①接线 core `DocumentSession`；②菜单/快捷键/viewport session；③new/open/save/save-as/close 与 token conflict；普通 Save 只回传 opaque handle/token，Save As 才请求一次性 target authorization；④验证 open/Save As 后再次 Save 均不重复弹窗，handle 不跨窗口；⑤按唯一 renderer owner 接线导出；⑥注入引导偏好；⑦LaunchRouter renderer ack；⑧错误 UI 和 integration tests。
- **交付物**：完整本地应用闭环、集成测试、快捷键表。
- **验收**：PRD 全部验收行为可走通；分叉/异步保存/外部冲突 dirty 正确；open/Save As 后 ordinary save 不重复弹窗且越权 handle 被拒绝；图标/Dock 新建空白；三格式只有一个 owner且不含 UI overlay。
- **验证命令**：`pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration && pnpm build`。
- **Risk IDs**：R-005、R-008、R-009、R-012、R-014。
- **STOP/BLOCKED**：适用统一规则；唯一 renderer owner 未完成、需要改 core/schema/IPC/native host，或集成暴露新的第一版范围决定时停止并开责任卡。
- **风险**：窗口生命周期竞态、快捷键与输入冲突；缓解：session state machine 与 E2E。
- **回报模板**：按统一格式，附完整流程录屏、剩余 mock/平台缺口。

## MM-085｜一键整理（垂直树布局）

- **目标**：[from-user 2026-08-27] 自由画布一键整理为垂直树（主干向下、分支横向、同层等距）；整理 = 纯函数布局 → **单条 MoveNodes**（可 undo、进历史、触发 dirty）；**丝滑过渡动画**（reduced-motion 关闭）。
- **依赖**：MM-080；PRD §5"一键整理"与 AC-15 已先行更新。
- **允许修改路径**：`packages/core/src/organize.ts` 与其相邻测试、`packages/ui/src/canvas/**`（仅位置过渡动画的最小接线）、`apps/desktop/src/**`、`docs/product/v1-product-spec.md`（本卡已先行完成）；不改 schema/文件格式。
- **非目标**：不做布局风格切换（水平导图等留后续）、不改连线渲染风格（正交折线属视觉增强另议）、不引入分组/折叠概念。
- **步骤**：①core 纯函数 `organize`：BFS 分层（y）+ 子树宽度简版 Reingold-Tilford（x），兄弟等距、父居中；②环形拓扑破环降级（DFS 生成树），孤立节点右侧独立列；③确定性输出（同输入同输出）；④`organizeCommand(document) → MoveNodes | null`（全部已就位时 null）；⑤UI：工具条"整理"按钮 + 快捷键，单条命令经 session 提交；⑥动画：EditorCanvas 重投影时节点位置 CSS transition（拖动走乐观态不经此通道，不受影响）；⑦单测（确定性/环/孤立/空文档/300 规模）+ 集成测试（整理→undo 恢复→redo）。
- **交付物**：core 布局纯函数、整理入口、位置过渡动画、快捷键表更新、测试。
- **验收**：AC-15——单条可撤销命令；确定性垂直树；undo 完整恢复；环/孤立降级不崩不丢；动画平滑且 reduced-motion 关闭。
- **验证命令**：`pnpm --filter ./packages/core test && pnpm --filter ./packages/core typecheck && pnpm --filter ./packages/core lint && pnpm --filter ./apps/desktop typecheck && pnpm --filter ./apps/desktop test && pnpm lint && pnpm typecheck && pnpm test:unit && node scripts/quality/check-boundaries.mjs --scope selected-canvas`。
- **Risk IDs**：R-012、R-015。
- **STOP/BLOCKED**：适用统一规则；需要改 schema/文件格式或导出链路时停止回报。
- **风险**：大规模图布局耗时；缓解：O(n) 算法 + 300/450 性能断言。
- **回报模板**：按统一格式，附确定性 hash 证据与整理前后示意。

## MM-088｜全局唤醒热键

- **目标**：[from-user 2026-08-27] 应用运行时任意前台应用下按全局热键一键唤起画布（随手感核心；AC-16）。
- **依赖**：MM-085；MM-060 的 activation 路由语义。
- **允许修改路径**：`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/src/shortcuts/**`、`apps/desktop/src-tauri/src/lib.rs`（装配）、`apps/desktop/src-tauri/capabilities/**`、`packages/platform/src/**`（如需热键偏好 port）、`apps/desktop/src/**`（热键设置 UI）、`docs/product/v1-product-spec.md`（已先行）。
- **非目标**：不做 menubar 常驻 UI、不改 LaunchRouter 队列协议、不拦截系统保留组合。
- **步骤**：①集成 `tauri-plugin-global-shortcut`（license scan）；②默认热键实测选定（低冲突，如 ⌃⌥Space）+ 注册失败（冲突）稳定提示；③唤起语义 = MM-060 activation（focus 现有/新建空白，不碰 dirty 窗）；④热键可改并持久化到本机偏好（复用 preferences）；⑤cargo test + 集成测试（热键偏好读写/冲突路径）。
- **交付物**：全局热键注册/冲突处理/偏好设置、测试、快捷键表更新。
- **验收**：AC-16。
- **验证命令**：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml && cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings && pnpm lint && pnpm typecheck && pnpm test:unit && node scripts/quality/scan-dependency-licenses.mjs`。
- **Risk IDs**：R-012、R-013、R-014。
- **STOP/BLOCKED**：适用统一规则；插件许可证失败或需改 LaunchRouter 协议时停止回报。
- **风险**：热键与其他应用冲突；缓解：冲突检测 + 可修改 + 稳定降级提示。
- **回报模板**：按统一格式，附默认热键选择依据与冲突场景证据。

## MM-089｜键盘操作完整性

- **目标**：[from-user 2026-08-27] 全部核心操作仅用键盘完成（AC-17；键盘文化 + a11y 双重价值）。
- **依赖**：MM-085（整理入口/动画）、MM-080（快捷键/编辑隔离基础）。
- **允许修改路径**：`packages/ui/src/**`（导航/连线模式/快捷键）、`packages/core/src/**`（如需几何导航纯函数则相邻测试）、`apps/desktop/src/**`（快捷键接线）、`docs/product/v1-product-spec.md`（已先行）。
- **非目标**：不做可改键系统（键位固定、表驱动）、不做指针操作的移除（鼠标全部保留）、不引入命令面板（后续另议）。
- **步骤**：①方向键节点导航（几何最近邻纯函数：方向 + 焦点 → 下一节点，可测）；②键盘创建（Enter/⌘⏎ 视口中心建节点）、Enter 进编辑；③键盘连线流：⌘L 发起 → 方向键换目标 → Enter 确认 / Esc 取消；④⇧+方向扩展多选、⌘A 全选；⑤⌘+/⌘-/⌘0 缩放与 fit、焦点跟随滚动；⑥快捷键表全量更新（单一事实源）+ a11y 套件断言键盘流；⑦IME 隔离贯穿全部新键位。
- **交付物**：键盘操作全集、几何导航纯函数、更新的快捷键表与测试。
- **验收**：AC-17——建图全流程（建→连→编辑→整理→保存→导出）无鼠标可完成。
- **验证命令**：`pnpm --filter ./packages/ui test && pnpm --filter ./packages/ui typecheck && pnpm --filter ./apps/desktop test && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:a11y`。
- **Risk IDs**：R-003、R-012。
- **STOP/BLOCKED**：适用统一规则；需要改 schema/平台 IPC 时停止回报。
- **风险**：焦点管理与编辑态冲突；缓解：焦点优先级状态机（PRD §6）+ 交互测试。
- **回报模板**：按统一格式，附键盘流录屏/测试与快捷键表。

## MM-090｜自动化 E2E、golden 与双平台验收

- **目标**：执行测试规格并形成可审计发布候选证据；不修隐藏缺陷，失败回到责任卡。
- **依赖**：MM-080。
- **允许修改路径**：`tests/**`、`docs/quality/**`、`scripts/quality/**`；发现产品修复只开含 owner/复现/严重度/回归测试的缺陷卡。
- **非目标**：不通过放宽断言/盲更 golden 让测试变绿；不改产品范围。
- **步骤**：①运行 `run-all.mjs`；②canonical hash/locale/timezone/DPI/PNG尺寸/PDF多viewer/空和极大画布；③分叉/异步保存与每阶段 failure injection；④early events/等价路径/连续多文件/activation；⑤300/450 与双平台人工矩阵；⑥失败开责任卡，修复后完整重跑本卡。
- **交付物**：自动化测试、macOS/Windows 独立报告、`docs/quality/evidence-index.json`、`docs/quality/risk-evidence-index.json`、MM-090 聚合报告、性能数据、截图/日志索引、缺陷清单。
- **验收**：AC-01～AC-14 每行均有两平台适用证据/明确不适用理由、命令退出码和 evidence artifact；Risk IDs 有状态/证据；阻断缺陷为 0；最后一次证据来自修复后的完整 MM-090 重跑；未获选分支不执行且有 decision 证据；缺任一平台真实报告返回 BLOCKED。
- **验证命令**：共同 `node scripts/quality/run-all.mjs && node scripts/quality/run-export-golden.mjs && node scripts/quality/run-performance.mjs && node scripts/quality/check-boundaries.mjs && node scripts/quality/scan-dependency-licenses.mjs && node scripts/quality/scan-network-endpoints.mjs`；macOS 再跑 `scripts/quality/run-e2e-macos.sh`，Windows 再跑 `powershell -File scripts/quality/run-e2e-windows.ps1`。
- **Risk IDs**：R-001、R-005、R-006、R-007、R-008、R-010、R-013、R-014、R-015。
- **STOP/BLOCKED**：适用统一规则；缺任一平台设备/原始报告、AC evidence 缺失、阻断缺陷未关闭、脚本不稳定且无可重复人工替代时返回 BLOCKED；不得用 mock 或更新 golden 冒充通过。
- **风险**：WebView E2E 不稳定、字体差异；缓解：语义断言优先、平台 golden、人工系统级验证。
- **回报模板**：按统一格式，附 Pass/Fail 总表、证据索引和阻断 issue。

## MM-100｜安装包、许可与发布准备（不发布）

- **目标**：为获选 host 生成明确为 unsigned 的本地候选安装包和发布清单，完成文件关联、运行时、签名状态记录与许可证准备。
- **依赖**：MM-090 通过；MM-000 已记录 G2 对精确本地候选准备范围的批准；`verify-decision.mjs --phase packaging` 通过；产品名/app id/扩展名/最低 OS/CPU/最终许可证获用户确认和必要法律审阅。
- **允许修改路径**：共同仅 `assets/**` 已授权资源、`docs/product/licensing.md`、`docs/quality/release-checklist.md`、`docs/quality/evidence/mm-100-*.json`、用户批准的根 `LICENSE*`/`NOTICE*`；Tauri 分支仅 `apps/desktop/src-tauri/tauri.conf.json`、`tauri.macos.conf.json`、`tauri.windows.conf.json`、`apps/desktop/src-tauri/icons/**`；Electron 分支仅 `apps/desktop/electron/forge.config.*`、`apps/desktop/package.json`、`apps/desktop/build/**`。未获选分支路径禁止修改。
- **非目标**：不修改 CI/CD；不读取/修改密钥；不签名（包括 test-signing）、公证、修改系统信任、上传 GitHub 或公开发布。任何签名必须另开授权与任务卡，不能由本卡条件化偷渡。
- **步骤**：①只配置获选 host 的 DMG 与 MSI/NSIS、fileAssociations；②Tauri 才处理 WebView2 bootstrap；③汇总此前逐依赖许可结果；④仅生成 unsigned 本地候选并记录签名状态为 `unsigned`；⑤仅在 G2 `approvedScope` 明确列出目标安装目录、候选包路径、安装/卸载动作与可恢复边界后做本地安装/卸载，禁止扩大删除范围；⑥记录未来签名步骤但不执行、不读取凭据、不修改信任；⑦生成哈希与批准的 SBOM。
- **交付物**：本地候选包、第三方 notices、许可/发布检查表、macOS/Windows 独立安装报告与 MM-100 聚合报告。
- **验收**：两平台 unsigned candidate 的安装/卸载/文件关联通过；安装/卸载目标与删除边界完全落在 G2 approvedScope；许可与依赖兼容有审阅；所有签名/test-signing、公证、凭据、系统信任、上传/对外动作仍为独立阻断 gate；缺任一平台报告返回 BLOCKED。
- **验证命令**：先执行 `node scripts/runtime-spike/verify-decision.mjs --phase packaging docs/decisions/decision-register.json`；再执行共同 `pnpm build && node scripts/quality/scan-dependency-licenses.mjs && node scripts/quality/run-all.mjs`；Tauri 分支执行 `pnpm bundle:tauri -- --unsigned && pnpm test:install:tauri -- --unsigned --scope-from docs/decisions/decision-register.json`，Electron 分支执行 `pnpm bundle:electron -- --unsigned && pnpm test:install:electron -- --unsigned --scope-from docs/decisions/decision-register.json`，只运行获选 host，命令检测到签名配置/凭据或范围外删除时必须 fail-closed；macOS/Windows分别输出 `docs/quality/evidence/mm-100-macos.json`、`mm-100-windows.json`，由 MM-100 owner 聚合。
- **Risk IDs**：R-006、R-010、R-011、R-012、R-013、R-016。
- **STOP/BLOCKED**：适用统一规则；G2 scope 未精确批准安装/卸载目标与删除边界、法律审阅、任一平台设备/报告或许可证兼容缺失时返回 BLOCKED；任何签名/test-signing、公证、凭据/系统信任、范围外删除、上传或发布请求必须停止并另行获得明确授权。
- **风险**：许可误伤工作用途、签名凭据、安装器差异；缓解：source-available dual license 法律审阅、凭据由用户控制。
- **回报模板**：按统一格式，附安装包路径/哈希、license 清单、仍需用户执行的签名/发布步骤。

## MM-110｜最终独立审阅与验收

- **目标**：由规划/验收 Agent 对实现与需求、ADR、质量证据做独立审阅；只报告，不直接扩范围。
- **依赖**：MM-100；所有实现 Agent 回报齐全。
- **允许修改路径**：`.omx/reviews/**` 或用户指定审阅目录；默认只读产品代码。
- **非目标**：不顺手修代码、不发布、不改变许可证/范围；缺陷另建修复卡。
- **步骤**：①逐行复核 AC-01～AC-14 的 owner/test/command/evidence；②逐项复核 R-001～R-016 的 trigger/action/evidence/status；③运行边界/无后端/网络端点扫描；④审阅 schema/state identity/TargetAuthorization/DocumentTargetHandle/token/LaunchRouter/renderer owner 与三阶段 decision profiles；⑤重新运行 MM-090 全量脚本并抽查两平台原始证据；⑥按 P0/P1/P2 出具 verdict。
- **交付物**：审阅报告、inline findings、AC 逐项矩阵、风险关闭矩阵、`ACCEPT / REJECT / CONDITIONAL` 结论与修复卡建议。
- **验收**：每个 AC 和风险结论都有文件/测试/截图/退出码证据；P0/P1 不为 0 时不得 ACCEPT；MM-045 若未激活不得误计为完成；公开发布仍单独等待用户授权。
- **验证命令**：`node scripts/quality/run-all.mjs && node scripts/quality/check-boundaries.mjs && node scripts/quality/scan-dependency-licenses.mjs && node scripts/quality/scan-network-endpoints.mjs && git diff --check`，并执行对应平台 E2E 脚本；报告真实退出码。
- **Risk IDs**：R-001～R-016（accountable reviewer）。
- **STOP/BLOCKED**：适用统一规则；AC/risk evidence、任一平台证据或批准记录缺失时不得给 `ACCEPT`；需要修复产品代码时只开修复卡并交还用户派发。
- **风险**：依赖开发者自报、漏测另一平台；缓解：重新运行和抽查原始证据。
- **回报模板**：按统一格式，另附 verdict、按严重度 finding 表、是否可进入“用户决定发布”门槛。

## 2. 完成定义

任务卡“完成”同时要求：允许路径内交付物齐全、验收逐条有证据、命令真实运行、Risk IDs 已更新、未运行项明确、无越界改动、关联文档同步且未触发 STOP/BLOCKED。账本区分“13 张定义卡”与“12 张常规执行卡 + 1 张条件卡”；MM-045 未激活时状态为 `NOT_ACTIVATED`，不是完成。只有 MM-110 `ACCEPT` 且用户另行批准公开发布后，项目才可进入发布动作。
