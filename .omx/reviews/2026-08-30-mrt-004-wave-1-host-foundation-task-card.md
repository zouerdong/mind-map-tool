# MRT-004 Wave 1：Host 可靠性与文件身份基础

## 1. 定位与验收节奏

**优先级：P0**

**状态：NEEDS-REMEDIATION — MRT-004A1 已接受；MRT-004B 转 MRT-004B1**

> 统一验收见 `.omx/reviews/2026-08-30-mrt-004-wave-1-acceptance.md`。下一派发入口为 `.omx/reviews/2026-08-30-mrt-004b1-reservation-and-rebind-remediation-task-card.md`；不得重新执行已接受的 A1。

**上游：MRT-004G ACCEPTED；MRT-004A NEEDS-REMEDIATION**

**本轮验收点：完成 A1 内部 Gate 后继续 B；A1 与 B 全部完成后再统一交回审查，不在两者之间等待人工验收。**

本卡把原来的微任务改成一个可独立证明的工程波次：先修复 host 状态机的并发与交付可靠性，再在同一正确状态所有权上落地真实 macOS/Unix 文件身份及保存换绑基础。真实 Tauri 多窗口、native source、最终错误 UI 与 Finder/Dock 验收留在 Wave 2。

## 2. 必读与优先级

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`（Accepted 1.0.0，不得修改已冻结内容或 hash）。
3. `.omx/reviews/2026-08-30-mrt-004a-acceptance.md`。
4. `.omx/reviews/2026-08-30-mrt-004a1-concurrency-and-delivery-remediation-task-card.md`（A1 技术子规格）。
5. `.omx/reviews/2026-08-30-mrt-004-development-guide-and-task-card.md`。
6. 当前 `file/`、`lifecycle/`、`ipc/` 与 `packages/platform/src/lifecycle/` 实现及测试。

发生冲突时，Accepted ADR 优先；本 Wave 卡优先于旧任务卡中的“完成 A1 后停止”或“B 保持锁定”字样；A1 的技术要求仍以 A1 子规格为准。

当前工作树包含前序 Agent 与审查者的累计变更，都是项目现状。不得覆盖、还原、丢弃或用 destructive Git 命令清理。

## 3. 本波次交付结果

完成后必须同时具备：

1. A1：单一并发 owner、原子 reducer、Closing identity 延迟路由、bootstrap outcome 可靠重报、TS/Rust 契约一致。
2. B：真实 host-owned `FileIdentity`，至少在 macOS/Unix 使用 canonical path 与 `(device, inode)`；renderer 的 `displayPath` 不参与判等。
3. B：registry 以 identity aliases 管理 owner，能正确处理 symlink、相对段、hard link、Unicode 路径与原子保存后的 inode 轮换。
4. B：ordinary Save 成功后刷新物理别名；Save As 使用“写前预占、写后换绑、失败回滚”的 host 协议；Destroyed 清理 active 与 pending reservation。
5. B：文件服务与 registry 的 host-domain 接口及失败矩阵有自动化证明，但不提前接真实 Tauri 多窗口。
6. 文档明确 Windows 物理文件身份仍是后续平台腿，不把 canonical-path-only 冒充已验证的 Windows 等价性。

## 4. 执行顺序

### Phase A：完成 MRT-004A1

完整执行 A1 子规格，不删弱原 R/Q/F/P 测试。需要先补红灯、再修实现，并生成：

- `.omx/reviews/2026-08-30-mrt-004a1-red-light-evidence.md`

### Internal Gate A→B：Agent 自检，不等待审查者

只有同时满足以下条件才进入 Phase B：

- A1 子规格的 L/T/C/B/Y 与原 R/Q/F/P 矩阵通过。
- `WindowRegistry` 不再拥有分散 Mutex；coordinator state 只有一个并发 owner。
- 所有 completion 在失败时 snapshot 零变化。
- bootstrap `reportOutcome` 失败后 outcome 可重报且 action 不重跑。
- A1 changed-scope format、platform test、Rust test、clippy、typecheck 与 `git diff --check` 通过。

若 Gate 失败：停在 A1，报告真实失败与工作树，不伪造通过、不进入 B。Gate 通过：在证据文件记录命令摘要，直接继续 Phase B，不回来等待人工确认。

### Phase B：Host registry 与真实 FileIdentity

按第 5～7 节落地。B 完成后运行全量 Gate，一次性交回 Wave 1 验收。

## 5. FileIdentity 强制设计

### 5.1 身份不是单字符串

首版模型必须表达：

```text
FileIdentity
  canonicalKey: CanonicalPathKey        // 始终存在；同一逻辑路径的稳定锚点
  physicalKey?: PlatformPhysicalFileKey // Unix: device + inode

IdentityAlias
  canonical(canonicalKey)
  physical(platformPhysicalKey)
```

要求：

- registry 的 owner index 按 `IdentityAlias` 建索引；两个 identity 任一 alias 重叠即视为同一资源。
- 不得把 `canonicalKey OR physicalKey` 塞进一个派生 `Eq/Hash` 键；这种 OR 判等在文件替换后可能不满足等价关系并造成 HashMap 漂移。
- canonical path 解决相对段与 symlink；Unix physical key 解决 hard link、大小写/Unicode 表达最终落到同一文件的情况。
- `displayPath` 只供 UI 展示；registry/coordinator API 不接受 renderer 自报的 display path 作为 identity。
- identity 的调试投影不得暴露为可由 renderer 伪造的授权或 IPC 判定字段。

### 5.2 平台接口

建立可注入的 host `FileIdentityProvider`（名称可调整，但职责不可混入 UI）：

- resolve existing file：canonicalize + 平台 metadata。
- resolve authorized target：目标存在时返回完整 identity；目标不存在时用 canonical parent + file name 形成 canonical alias，physical alias 为空。
- refresh after commit：原子替换后重新读取 physical alias，canonical alias保持稳定。

macOS/Unix 实现使用标准库 `std::os::unix::fs::MetadataExt` 的 `dev()` / `ino()` 或语义等价封装，不为此新增运行时依赖。

Windows 本轮只要求接口和 `cfg` 边界清楚、可由 fake provider 测试；不得声称已经完成 Windows physical identity，也不得用随机/合成值冒充真实实现。若实现 Windows 稳定 file ID 需要新增依赖、系统能力或配置，本波次停止该平台腿并在回报中列为 Wave 2/平台专项，不自行扩大依赖。

### 5.3 原子替换后的身份语义

当前 ordinary Save 使用临时文件 rename/replace，成功后 inode 可能变化。因此：

- canonical alias 是逻辑文档路径的稳定锚点。
- ordinary Save 成功后刷新 physical alias；移除该 label 的旧 physical alias，注册新 physical alias，canonical owner 不发生空窗期。
- 文件被外部替换但路径不变时，launch duplicate 判定仍先由 canonical alias 命中原窗口；保存冲突继续由 VersionToken/TOCTOU 协议负责，不得把内容版本和窗口 identity 混为一层。

## 6. 保存换绑协议

### 6.1 Ordinary Save

1. 文件服务按现有 handle + expected token 做写前校验。
2. 写入成功后取得 refreshed identity。
3. host 对同 label 原子刷新 physical aliases；canonical alias持续归该 label。
4. 写入失败、外部修改冲突或 handle 拒绝时 registry identity 完全不变。

### 6.2 Save As

Save As 不允许采用“先写文件，再发现 identity 被另一窗口占用”的顺序。必须有三段式协议：

```text
prepare rebind(targetIdentity)
  -> reserve target aliases with opaque rebind token
  -> perform authorized file commit outside coordinator lock
  -> success: finalize rebind(finalIdentity)
     failure/cancel: abort rebind(token)
```

要求：

- prepare 在任何写入前检查 target aliases；若已被其他 open/loading/closing 窗口或 pending rebind 占用，稳定拒绝且目标文件 bytes 不变。
- pending rebind 期间旧 identity 仍由当前窗口占用；新 target 只作 pending reservation，不能让另一个 open/create 抢占。
- 文件 I/O、OS API、IPC 不得在 coordinator state lock 内执行。
- commit 失败/授权过期/TOCTOU/目标出现时，abort 只释放 pending target，窗口旧 identity、handle、token、displayPath 与 registry owner 均不变。
- commit 成功后 finalize 必须原子地移除旧 aliases、采用 refreshed target aliases 并清 pending token。
- Destroyed 发生时 active identity 与该 label 全部 pending rebind 一起幂等清理。
- 不得把“文件已经写成功但 registry finalize 返回普通可重试错误”伪装成完全回滚。设计应在写前完成会失败的冲突验证；写后若出现内部不变量错误，fail closed 保留 reservation并返回明确 host invariant error，不能静默释放导致重复窗口。

Phase B 可通过纯 host orchestration API/测试完成上述接线；不要把未完成 bootstrap 的 coordinator 强行注入当前生产 IPC，避免破坏现有单窗口可运行基线。真实 `lib.rs` / Tauri command / window event 装配属于 Wave 2。

## 7. 必测矩阵

除 A1 全部矩阵外，至少覆盖：

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| I-B1 | 相对路径 / symlink | canonical alias 重合；只得到一个 owner |
| I-B2 | Unix hard link | physical alias 重合；第二窗口 reservation 被拒绝/路由聚焦 |
| I-B3 | 不同真实文件 | identity 不重合，可分别 reservation |
| I-B4 | Unicode/空格路径 | identity 可稳定解析，不依赖展示字符串比较 |
| I-B5 | ordinary atomic replace | canonical owner持续存在；旧 inode alias 移除；新 alias 生效 |
| S-B1 | Save As 到空闲新路径 | pending → commit → 原子换绑；旧 identity 释放 |
| S-B2 | Save As 到另一窗口 identity | 写前拒绝；目标 bytes、两窗 registry 均不变 |
| S-B3 | Save As commit 失败 | pending 清理；旧 identity 与文件能力不变 |
| S-B4 | Save As pending 时同目标 open | 零重复 create/抢占；按明确 deferred 语义保留 intent |
| S-B5 | Destroyed during pending rebind | active/pending aliases 与 token 全部幂等清理 |
| R-B1 | identity/provider 失败 | 零部分 registry 更新；稳定错误可观察 |
| R-B2 | renderer 伪造 displayPath | 不存在能借此改变 owner/routing 的 API |
| W-B1 | Windows 平台边界 | fake provider 合约通过；文档明确未完成真实 physical ID |

测试必须使用合成内容，不把真实用户脑图放入夹具。

## 8. 允许与禁止修改

允许：

- A1 子规格列出的文件。
- `apps/desktop/src-tauri/src/file/identity.rs`、`file/mod.rs`、`file/handle.rs` 及同模块测试。
- `apps/desktop/src-tauri/src/lifecycle/` 中 identity/rebind/coordinator 接口与测试。
- `apps/desktop/src-tauri/src/ipc/mod.rs` 仅限内部 host outcome/DTO 装配所需的最小兼容改动；不得启用未完成的真实多窗口命令。
- `docs/architecture/window-launch-lifecycle.md`。
- 本 Wave 的 red-light / implementation evidence。

禁止：

- 修改 ADR 0008 已冻结正文、版本、批准记录或 hash。
- 修改 Tauri capability、`tauri.conf.json`、CI/CD、发布配置。
- 在 `lib.rs` 接真实 editor window、Finder/Dock/native source 或切换生产 launch pipeline。
- 新增运行时依赖；若确有必要，先按项目规则说明用途、体积、许可证、替代方案并等待项目负责人授权。
- 修改最终 UI、onboarding、core schema、export、文件格式或 MRT-003 close handshake 语义。
- 为通过测试吞错、sleep/轮询、自旋重试、弱化断言或保留 synthetic identity 在生产路径。

## 9. 验收命令

Internal Gate A→B 运行 A1 changed-scope 命令；Wave 1 完成后运行：

```bash
pnpm --filter @mindmap/platform test
pnpm test:unit
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
pnpm lint
pnpm quality
pnpm build
pnpm exec prettier --check <本 Wave 变更的 TS/MD 文件>
rustfmt --edition 2021 --check --config skip_children=true <本 Wave 变更的 Rust 文件>
git diff --check
git status --short
```

本 Wave 不运行或声称 Finder/Dock 真实多窗口验收；那是 Wave 2 的完成证据。

## 10. 停止与升级条件

仅在以下情况中途停止并报告，不为了微小实现选择回来等待：

1. Internal Gate A→B 未通过。
2. 必须修改 capability、`tauri.conf.json`、CI/CD、发布配置或安装新依赖。
3. 发现 Accepted ADR 0008 与必需实现根本冲突，需要改变产品/架构边界。
4. 发现当前文件提交协议无法在不改变既有保存语义的情况下实现写前 reservation。
5. 工作树出现无法安全区分来源的冲突，继续会覆盖用户或前序 Agent 变更。

其他局部实现判断由执行 Agent 依据测试和不变量自主完成，不需要逐项请示。

## 11. 完成定义与回报

- A1 与 B 全部完成，Internal Gate 和最终 Gate 都通过。
- A1 红灯证据与 Wave 1 实现证据完整。
- identity alias、ordinary refresh、Save As prepare/finalize/abort、Destroyed cleanup 均有失败注入。
- 没有真实 Tauri 多窗口、native source、最终 UI 或配置越界。
- `git diff --check` 通过，`git status --short` 只含预期累计差异。

Agent 最终一次性回报：

1. A1 五项根因与最终单 owner/原子 reducer 结构。
2. Internal Gate A→B 的命令结果。
3. FileIdentity 与 alias index 数据结构；Unix 实现与 Windows 未完成边界。
4. ordinary Save 与 Save As 三段式时序及失败不变量。
5. A1 矩阵 + I/S/R/W-B 矩阵的测试映射。
6. 修改文件职责、证据路径、全量命令结果。
7. `git diff --check` 与 `git status --short`。
8. 明确声明未修改 ADR/hash、capability、`tauri.conf.json`、CI/CD、发布配置、真实窗口/native source、最终 UI、core/export/文件格式和 MRT-003 close 语义。
9. 完成后停止，不自行进入 Wave 2。
