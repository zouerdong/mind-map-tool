# PRR-069C-R2：attach 异常接管与路径隔离闭合

状态：`EXECUTED / STOP_FOR_INDEPENDENT_REVIEW`（2026-09-11）

执行记录：派发基线 `ed30987fe64756cee3057d8c4f4320bef51335b1`（clean）；实现 source `885d877b660a608604c8dc5921aeabd49fd4131e`；三轮正式预检 attempt-01/02/03 全部通过（DMG 24284033/24284017/24284025B，装配 9397/10100/9886ms）。R2-01～04 的处置、红绿证据与遗留项见 [R2 实施报告](../../docs/quality/prr-069c-r2-implementation-report-2026-09-11.md)。执行侧自述不构成独立验收。

优先级：P1；类型：独立审阅返修；执行者：Coding Agent。

派发基线：包含本卡、[R1 独立审阅](../quality/prr-069c-r1-independent-review-2026-09-11.md)及状态同步的最新本地 clean HEAD；它必须为 `7bb72dd1fa809e6a6103a97a952189ca8cfaed0a` 的后代。记录完整实际 HEAD，不直接从旧实现提交开工。

后继：交回独立审阅。PRR-070 / G-FINAL / PRR-080 / PRR-090 均保持阻塞。

## 1. 目标与范围

只关闭审阅 R2-01～04，不重新设计装配、不修改应用或图标、不放宽预算和发布协议。

允许修改：

- `scripts/quality/assemble-dmg.mjs`、`scripts/quality/bundle-gate.mjs`。
- 新建 DMG 专用纯辅助模块，例如 `scripts/quality/dmg-tool-contract.mjs`，仅供上述两入口使用。
- `scripts/quality/g2-scope.mjs` 仅允许移出 R1 新增的系统工具常量；不改既有授权、路径通用语义或其他消费者行为。
- `tests/bootstrap/release-runners.test.ts` 及确有必要的 DMG 专项测试。
- 本卡、planning/quality 索引、总指南/总任务卡、AGENTS.md、release checklist 和新的 R2 实施报告。

不允许修改生产 Tauri 配置、应用逻辑、图标、许可、ADR、decision register、性能/证据 schema、依赖、CI/CD 或系统设置。无需重新提供 icon；负责人选定的 C 方案保持原样。

## 2. 必须实现的合同

### R2-01：attach 的所有退出路径都能接管资源

1. 统一 RW、EULA 拒绝探针、最终只读 attach 的生命周期。在启动子进程前记录本轮拥有的 pending exact mountpoint；不得等 exit 0 才记录责任。
2. 对正常、非零、timeout、signal、spawn error 均返回受控结果，先核对挂载状态再决定失败；不得由通用 `must=true` 提前退出、跳过接管。
3. 使用严格校验的 stdout 与 exact mount table 确认设备和挂载点；仅清理本轮可证明拥有的挂载。stdout 缺失或不可解析不能当成没有挂载。
4. 已挂载但 attach 失败时，受控 detach 并验证表内不再存在后，整体仍返回失败。不得将超时转成成功。
5. mount table 查询失败、身份不确定、detach 失败或仍有残留时，保留 pending/active/residual 状态及结构化证据，明确 UNKNOWN/RESIDUAL，不得输出已清理或成功 inventory。
6. 清理必须有界；不得 force/sudo/批量卸载。装配预算仍为单命令 120000ms、总计 180000ms。失败后的清理宽限单独计时、仅用于回收，不得用于完成装配或通过预算；父 gate 的终止策略必须容纳已声明的有界清理，避免提前杀掉清理进程。报告明确两段耗时和最终状态。

### R2-02：fixture 注入完整验证，绝不落入真实工具

1. gate 和直接 assembler 两个 CLI 入口都验证注入路径，拒绝绝对路径、`..`、symlink 分量、逃逸和指向 canonical source 的注入；fixture root 本身与 source 的身份判定保留 realpath 归一化。
2. 提供 tool-dir 时，必须在任何工具调用或工作目录写入前验证七项工具完整、为合法可执行文件、全部位于 fixture 内。缺项、断链、工具文件 symlink、错误类型或缺失参数直接失败。
3. 禁止缺项后回退 `/usr/bin` 等真实工具。测试注入只能用于隔离 fixture；正式路径仍拒绝一切注入。
4. 合法的仓库内合成 fixture 目录仍可用于测试；不要以全面禁止 nested fixture 代替精确校验。

### R2-03：work-dir 检查所有路径分量与实际落点

1. gate 与直接 assembler 均在 build、mkdir、工具或挂载之前拒绝中间层与末级 symlink，包括 dangling symlink；只看最终节点不够。
2. 从归一化 ROOT 检查路径分量，并用最近已存在祖先的实际路径核对目标落点；候选、历史 evidence、旧 attempt 树不能成为新 work-dir。不能仅靠词法前缀防护。
3. 保留新 `.tmp/prr-069c-*` 白名单和空 work-dir 合同。禁止借用历史 attempt 的新子目录。允许本轮唯一新 attempt 下 work 与日志作为兄弟目录。
4. 对实际写入入口保持一致校验；不要声称简单预检查能抵抗任意恶意并发替换。发现运行期间路径身份变化应失败并保留现场。

### R2-04：模块归位

将 R1 新增的 `SYSTEM_TOOL_PATHS` 移至 DMG 专用模块，两入口从该模块引用。只移除通用模块新增的那部分，不重置整个 `g2-scope.mjs`，不改变 G2 授权能力。

## 3. 红灯与回归矩阵

测试使用隔离合成 fixture 和 mock mount table，禁止为负向测试触发真实 mount。每项断言退出码、错误分类、无成功 inventory、调用轨迹与最终 pending/active/residual/mount table；不能仅检查日志字符串。

- 三种 attach 阶段分别覆盖：挂载前失败、挂载后非零、挂载后 timeout/无 stdout、成功但 stdout 无法解析；另测 spawn error。
- 已挂载分支证明先 detach 再失败；未挂载分支证明不误卸载。mount 查询失败、detach 非零、detach 零但仍残留，均不伪报清理成功。
- EULA 正常拒绝无挂载保持通过；拒绝探针意外成功或错误返回但已挂载，均清理后失败。
- 直接 assembler 与 gate 覆盖绝对/穿越/tool-dir 或单文件 symlink/缺失工具/非法参数；记录没有真实系统工具调用。合法完整 fixture 仍通过。
- 两入口覆盖 work-dir 中间层 symlink 指向仓库内 evidence、candidate、其他任务目录以及仓库外；覆盖末级/悬空 symlink、历史 attempt 新子目录。断言在任何 build/mkdir/tool 前失败，历史文件 hash 不变。
- 保留 R1 原有 89 项中的所有有效断言，特别是正式注入拒绝、app-only、固定阈值、正常 identity/EULA/卸载路径；不能删测、skip 或改成恒空 mount mock。

首次红灯应在未修实现上证明缺陷；可采用审阅中的复现方式：mock 在记录 mount 后挂起；直接 assembler 传绝对 tool-dir；缺失 mock ditto；中间 symlink 指向 release-candidate。

## 4. 顺序与证据隔离

1. 读 AGENTS.md、根 README、相关目录 README（存在时）、R1 审阅和本卡；记录完整 HEAD/clean/环境。只读核验前序 evidence hash，保留历史事实，不复制为本轮证据。
2. 在唯一新 `.tmp/prr-069c-r2-<run-id>/` 保存红灯和开发日志；补测 → 修复 → 绿灯。开发阶段预期红灯和修复迭代是允许的，不触发正式预检 STOP；不得抹掉失败记录。
3. 全量源码门通过后先创建本地实现 commit，确认 clean；记录完整 `sourceCommit` 和 runner/helper hash。
4. 从同一 clean source 连续执行三轮正式预检。work-dir 使用 `.tmp/prr-069c-r2-<完整source>-attempt-01/work`（然后 02/03）；inventory/report 使用 G2-approved `.tmp/release-candidate/prr-069c-r2-<完整source>-attempt-01/`（然后 02/03）。目录已存在则停止，不覆盖。
5. 每轮独立重新 build app 和装配 DMG；不复用前轮或历史 artifact。只刷新 G2 允许的固定 candidate 输出，历史 evidence 一律不动。
6. 每轮记录 source/app/DMG/runner/helper/LICENSE/ICNS 的 SHA-256、字节数、UTC 时间拓扑、命令和退出码、EULA/Applications/卷图标/payload identity、挂载前后表。ULMO、CRC32 VALID、DMG ≤25000000B、装配 ≤180000ms、120000/180000 正式参数精确不变。
7. 三轮通过后写 `docs/quality/prr-069c-r2-implementation-report-2026-09-11.md`，同步状态为“执行完成，等待独立审阅”，再做文档提交。分别记录实现 source 和最终交回 HEAD，证明两者只差文档、运行文件 hash 不变；不得把后置文档 HEAD 冒充预检 source。
8. 停在 `STOP_FOR_INDEPENDENT_REVIEW`；不得自行宣布独立验收通过或启动 PRR-070。

正式预检命令骨架（替换本轮唯一 work-dir 与 inventory；不可添加注入/阈值覆盖）：

```text
node scripts/quality/bundle-gate.mjs --host tauri --scope-from docs/decisions/decision-register.json --candidate-root apps/desktop/src-tauri/target/release/bundle --assemble-dmg --dmg-format ULMO --work-dir <本轮仓库相对work-dir> --inventory <本轮仓库相对inventory.json> -- pnpm --filter @mindmap/desktop tauri build --bundles app
```

## 5. 必跑验证与停止条件

以根 README 为命令权威，不减少以下覆盖：

```text
pnpm format:check
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/bootstrap/release-runners.test.ts
pnpm test:unit
pnpm test:integration
pnpm icon:verify
pnpm build
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --all-targets --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
git diff --check
```

Windows 标为本卡原生验证不适用（macOS DMG），不宣称 Windows 实测。依赖的 ignored runtime-spike evidence 缺失时报告阻塞，不伪造 PASS。

以下必须 STOP：进入正式三轮后任一轮失败；冻结 source 后源码/HEAD/worktree 改变；无法确认挂载已安全清理；历史 evidence 被修改；必须扩大允许范围或更改预算/协议。记录失败，不原地重复挑绿，不把事后自然完成翻成 PASS。开发中的合成预期失败不在此列；真实残留无论阶段都停止。

禁止删除历史数据、Finder/AppleScript/DS_Store 路线、force/sudo、签名、公证、凭据、系统信任/设置变更、LaunchServices、安装应用、性能采样、全局安装、push、上传或公开发布。任何新权限需求交回负责人。

## 6. 固定交回

```text
Task: PRR-069C-R2
Status: STOP_FOR_INDEPENDENT_REVIEW | BLOCKED
Base: <完整派发HEAD / clean>
SourceCommit: <三轮预检实际source>
HandoffCommit: <最终文档HEAD / clean / 与source仅文档差异证明>
Changed: <逐文件>
ReviewFindings: <R2-01..04实现处置 + 对应红/绿测试；待独立确认>
Verification: <命令/exit/数量/时间；不可冒充独立验收>
Evidence: <唯一red/green与三轮目录 + SHA-256清单>
MountSafety: <异常矩阵与真实前后状态、清理宽限协议>
NotRun: PRR-070 / G-FINAL / PRR-080 / PRR-090
Risks: <未解决项或环境缺口>
Redlines: <确认未执行>
Next: STOP_FOR_INDEPENDENT_REVIEW
```
