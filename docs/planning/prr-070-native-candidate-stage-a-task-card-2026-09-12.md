# PRR-070 阶段 A：唯一候选与完整原生矩阵

状态：`READY_FOR_EXECUTION / G-FINAL_NOT_REQUESTED`。优先级 P0。

这是当前唯一可执行任务。前置 [PRR-069C-R2-F1 阶段 B 独立审阅](../quality/prr-069c-r2-f1-stage-b-independent-review-2026-09-12.md)
已经 `ACCEPT`。执行时以包含本卡和独立审阅的最新 clean HEAD 为 `SourceCommit`；必须是
`8dba6f7aeb81f18e573c6c0bafaa8fe974e75a47` 的后代，且相对阶段 B source
`225923f12abac23db0a6605160477cd36c8ca93a` 在 `scripts tests apps packages` 无差异。

## 1. 目标与最终停止点

从一个 clean source 构建唯一 unsigned macOS Apple Silicon `.app`/ULMO `.dmg`，让源码门、advisory、
产物身份、性能、安装/文件关联、原生功能、可访问性和三格式导出全部绑定同一个 app/candidate hash。

全部通过后只生成 `g-final-request.md/json`，状态停在 `WAITING_FOR_OWNER_G_FINAL`。不得代替负责人批准，
不得执行 PRR-070 阶段 B、PRR-080、PRR-090、签名、公证、上传、push 或公开发布。

## 2. 已有授权与写入范围

- 负责人 G2 原文允许构建 unsigned Apple Silicon 候选、生成项目内证据、启动候选、进行性能测试、临时安装并
  注册/恢复 LaunchServices；禁止签名、公证、凭据、上传、公开发布和 Git push。
- 唯一 candidate 输出：
  `apps/desktop/src-tauri/target/release/bundle/macos/Mind Map.app` 与
  `apps/desktop/src-tauri/target/release/bundle/dmg/Mind Map_0.1.0_aarch64.dmg`。
- 唯一 evidence 根：`.tmp/release-candidate/<完整SourceCommit>/`；性能/安装临时目录只用全新的
  `.tmp/prr-070-<完整SourceCommit>-*`。旧 evidence、R2/F1 attempts 和历史候选全部只读。
- 临时安装只能由 `install-gate --plan` 后 `--execute` 管理；遇到外来预存目标、无法证明归属或无法恢复
  LaunchServices 时立即 STOP，不覆盖、不强删。
- 已有本地 `cargo-audit` 可直接使用；不存在时只允许 `cargo install --root .tmp/prr-070-tools cargo-audit --locked`，
  不得全局安装。

PRR-070 不修改源码、测试、runner、生产配置、ADR、预算、协议或 tracked 文档。任何修改需求都必须 STOP，
返回对应整改卡，形成新 clean commit 后从步骤 1 重做。

## 3. 阶段 A 顺序

### 3.1 冻结 source 与目录

1. 记录完整 HEAD、0 行 `git status --short`、机器/OS/arch/CPU/RAM、Node/pnpm/Rust/Tauri 版本和机器生成 UTC。
2. 令 `SOURCE=$(git rev-parse HEAD)`，确认 `.tmp/release-candidate/$SOURCE/`、PRR-070 work/perf/install 根均不存在。
   存在即 STOP，不删除、不改编号、不借旧目录的新子目录。
3. 所有 manifest 路径统一写成仓库相对路径；文件生成后不得追加其他阶段数据，manifest 自身排除在哈希之外。

### 3.2 源码门与 advisory

逐项记录机器生成的开始/结束 UTC、完整命令、exit code 和输出；任一失败立即 STOP：

```text
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:a11y
pnpm test:visual
pnpm test:export
pnpm build
pnpm icon:verify
pnpm net:scan
pnpm license:scan
pnpm boundaries
node scripts/runtime-spike/verify-decision.mjs --phase packaging docs/decisions/decision-register.json
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --all-targets --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
git diff --check
```

另复算 production initial entry `≤500000B`。执行 JS production advisory 与 `cargo audit`，记录工具版本、数据库时间、
命令和结果；工具缺失、数据库不可用、命令失败或 high/critical vulnerability 均不得写 PASS。

### 3.3 构建唯一候选

显式调用正式 gate，不使用 `pnpm bundle:tauri` 的根层默认 inventory，不设置 fixture 环境变量：

```text
env -u MINDMAP_DMG_CLEANUP_GRACE_MS node scripts/quality/bundle-gate.mjs \
  --host tauri \
  --scope-from docs/decisions/decision-register.json \
  --candidate-root apps/desktop/src-tauri/target/release/bundle \
  --assemble-dmg \
  --dmg-format ULMO \
  --work-dir .tmp/prr-069c-prr-070-<完整SOURCE>/work \
  --inventory .tmp/release-candidate/<完整SOURCE>/bundle-inventory.json \
  -- pnpm --filter @mindmap/desktop tauri build --bundles app
```

构建前后 HEAD/worktree 必须不变。inventory 必须记录 app/DMG path、SHA-256、bytes、mtime、source、runner/helper、
LICENSE/ICNS、装配时间、`Format=ULMO`；禁止 Finder/AppleScript、Tauri dmg target、`.DS_Store`、注入或绕过。

### 3.4 产物与 DMG 实测

独立复算 Info.plist、Mach-O 和 bundle：产品名、`com.mindmap.desktop`、0.1.0、bundleVersion 1、arm64、minOS 11.0、
`.mindmap` document type/UTI/MIME/Editor、category、LICENSE/THIRD_PARTY_NOTICES、CSP/capability、unsigned 状态。

对唯一 DMG 执行 `hdiutil verify`、`imageinfo` 和只读挂载；验证 EULA、ULMO、CRC32 VALID、≤25000000B、卷图标、
Applications 链接、三项卷内容和卷内 app hash/identity，随后干净 detach。无法确认无残留时立即 STOP。

### 3.5 真机性能矩阵

对同一 app hash 使用正式 release 协议，唯一全新 performance attempt：

```text
node scripts/quality/run-performance.mjs \
  --scope release \
  --platform macos \
  --samples 20 \
  --scope-from docs/decisions/decision-register.json \
  --candidate "apps/desktop/src-tauri/target/release/bundle/macos/Mind Map.app" \
  --evidence-dir .tmp/release-candidate/<完整SOURCE>/performance-attempt-01
```

- 恰好一次 conditioning，成功后才采 20 conditioned cold + 20 warm；不得把 conditioning 混入样本。
- `sessionFirstLaunchMs` 和 `conditionedColdStartP95Ms≤1500ms` 必须同时写入 conditioning、raw/summary 绑定关系。
- 还需满足 warm≤800ms、stable RSS≤120MB、canvas/edit≤32ms、save≤1000ms、2x PNG≤3000ms、DMG≤25MB；
  预算与 percentile/样本数/ready 终点不得改变。
- raw、summary、conditioning、fixture/source/candidate/runner hash 必须完整，summary 重新从 raw 独立复算。
- conditioning、任一样本或导出失败即 `INCOMPLETE` 并 STOP；不得补样、删离群、改估计器、混合旧数据或原地重跑。

### 3.6 受控安装、LaunchServices 与原生功能

1. 先执行 `install-gate --plan`，审阅精确 plan/receipt，再执行 `--execute`。临时注册 `.mindmap`，测试完成后注销并
   恢复前态；记录前后状态、candidate hash 与清理证明。
2. 完整原生功能矩阵必须使用真实候选，不能以 jsdom/dev server/web harness/单测替代：
   - 零 chrome：not-started/in-progress、暖白/黑板截图、上下文工具条、React Flow attribution、AX 树。
   - 原生菜单/a11y：名称、顺序、enabled/check、快捷键、鼠标/键盘/VoiceOver 可发现。
   - accelerator exactly-once：`⌘N/O/S/⇧⌘S/E/⇧⌘L/⇧⌘H/W/Q`，菜单点击同样一次。
   - 编辑/IME：textarea 原生编辑语义；画布撤销/重做/全选；中文 composition 不误触发应用命令。
   - 多窗口：不同文档/主题/布局，菜单与 check state 跟随最近聚焦窗口，关闭后不污染。
   - 文件/关闭：New/Open/Save/Save As、dirty 标题、外部冲突、旧 handle/token、Save/Discard/Cancel、Quit。
   - 启动/恢复/热键：cold argv、running open、重复/多文件、Reopen 与五种 `⌥Space` 状态分流。
   - 导出：同一中文脑图的语义 SVG、2x PNG、PDF，内容/字体/主题一致；PDF 用至少两种 viewer 打开。
3. VoiceOver 若需要修改系统权限才可继续，立即 STOP 并报告；不得自行改系统设置。

### 3.7 报告、一致性与 G-FINAL 请求

生成 `macos-native-candidate-report.json`，要求 `evidenceKind=native-candidate`、`platform=macos`、`overall=PASS`，
并绑定 source、app/DMG、性能 conditioning/raw/summary、安装/LaunchServices、功能矩阵和截图/日志 hash。

独立复算：`source freeze ≤ first gate start ≤ last gate finish ≤ bundle start ≤ bundle finish ≤ downstream reports`；
全部 artifact 同源同 candidate、runner 未漂移、HEAD/worktree clean。任一 mismatch/缺项/未来时间立即 STOP。

全部通过后生成 `g-final-request.md/json`，只写请求，不写批准。请求必须给负责人：SourceCommit、app 路径与完整 SHA-256、
DMG 路径与完整 SHA-256、`sessionFirstLaunchMs`、conditioned cold p95、summary path/hash、最小人工检查步骤及批准原文模板。

## 4. 强制 STOP

以下任一发生即保留现场并停止：worktree/source/candidate hash 变化；任何源码门、advisory、性能、DMG、安装、
LaunchServices、VoiceOver、IME、多窗口、文件、关闭或导出项失败/缺测；需要修改 tracked 文件、覆盖外来安装、删除历史
evidence、改变系统权限/信任、签名、公证、凭据、push、上传或发布。不得现场修源码、重跑挑绿或把 NotRun 写成 PASS。

## 5. 固定交回

```text
Task: PRR-070 / Stage A
Status: WAITING_FOR_OWNER_G_FINAL | BLOCKED
Base: <派发时完整 clean HEAD>
SourceCommit: <frozen HEAD>
Candidate: <app path / sha256 / bytes>
DMG: <path / sha256 / bytes / ULMO / CRC32 / mount result>
SourceGates: <逐项命令、exit、UTC、entry bytes>
Advisory: <JS/Rust 工具、数据库时间、结果>
Performance: <conditioning、20 cold、20 warm、RSS/canvas/edit/save/png、summary hash>
InstallAndLaunchServices: <plan/receipt/注册/路由/恢复/清理>
NativeMatrix: <逐组 PASS 与证据路径/hash>
Evidence: <唯一 source 目录和统一 repo-relative manifest>
GFinalRequest: <md/json path/hash；不得含伪造批准>
NotRun: G-FINAL record / PRR-070 Stage B / PRR-080 / PRR-090 / signing / notarization / upload / publish
Risks: <真实遗留；无则 none>
Redlines: <逐项确认未执行>
Next: WAITING_FOR_OWNER_G_FINAL
```

命中 STOP 时 `Status` 改为具体 `BLOCKED_ON_<CAUSE>`，列出最后成功步骤、失败原始证据和未执行项，不创建
G-FINAL 请求。阶段 A 全绿也不能创建 `g-final.json`；负责人原文到位后由独立的阶段 B 卡处理。
