# PRR-069C-R1 实施报告：DMG 发布门边界与挂载清理加固

2026-09-11 当前派发更新：`PRR-069C-R1_REVISE / PRR-069C-R2_READY / PRR-070_BLOCKED`。[R1 独立审阅](./prr-069c-r1-independent-review-2026-09-11.md)确认异常接管、工具注入和中间路径 symlink 缺口仍未闭合。当前唯一执行入口为 [R2 完整任务卡](../planning/prr-069c-r2-attach-and-path-safety-task-card-2026-09-11.md)；下文 R1 实施完成、CLOSED、37/37 等描述仅保留执行侧历史报告，不表示独立验收通过。R2 完成并独立审阅接受前，不执行 PRR-070/G-FINAL/080/090；如与下文旧派发状态冲突，以本更新与 R2 卡为准。

日期：2026-09-11
状态：`STOP_FOR_INDEPENDENT_REVIEW`
派发基线：`9862be17a5138fcbececa7ebe355e2b9a78e92d4`（clean worktree）
实现 commit：`77f8ca93576152d50f8e5f2010881f4b8ba48fd6`（三轮预检时冻结的 HEAD）
任务卡：[prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md](../planning/prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md)
审阅输入：[PRR-069C 独立审阅（2026-09-11，REVISE）](./prr-069c-independent-review-2026-09-11.md)

## 1. 结论

四项阻断发现全部修复并各以负向测试证明 CLOSED。正式发布路径现在满足：

1. **测试注入与正式模式隔离**：正式/fixture 模式由 runner 文件所在的 canonical source root（`realpath` 归一化）判定，调用者无法通过 `--root`、环境变量伪造。正式仓库内 `bundle-gate.mjs` 拒绝 `--assembler-script` / `--assembler-tool-dir` / `--assembler-timeout-ms` / `--assembler-deadline-ms`，`assemble-dmg.mjs` 拒绝 `--tool-dir` 与显式 timeout/deadline 覆盖（即使值更小）；fixture 注入只接受 fixture root 内相对路径（拒绝绝对路径、穿越、指向 canonical 仓库或其祖先）。
2. **app-only 构建合同由 gate 自身强制**：正式模式 + `--assemble-dmg` 时 build command 必须精确匹配窄允许列表（与 `package.json` 的 `bundle:tauri` 完全一致的 token 序列），fake command、默认全 bundle、`--bundles dmg`、`--bundles app,dmg`、`--ci`、`--skip-jenkins` 与 wrapper 全部拒绝；且正式 assembler 必须是 git tracked 的 `scripts/quality/assemble-dmg.mjs`。
3. **时间预算不可放宽**：单命令 timeout ≤ `120000ms`、整轮 deadline ≤ `180000ms` 在 gate 与 assembler 双侧强制（任何模式，含非正数/非整数/deadline<timeout）；正式报告必须**精确等于** `120000/180000`。
4. **work-dir 白名单**：正式只允许 `.tmp/prr-069c-<非空>`（本轮三轮使用 `.tmp/prr-069c-r1-attempt-01..03/work`）；任何模式拒绝 G2 evidence 子树、候选产物目录、符号链接与预存非空目录。

挂载生命周期重构为单一状态机：**attach 返回 0 → 登记（stdout 可解析，否则从 mount table 精确恢复，都无法确认即 STOP）→ 语义断言 → 受控 detach（退出 0 且表内无 exact 挂载点/设备才清空登记）**。`mountTable()` 对 timeout/spawn error/非零退出 fail-closed 并输出结构化证据；残留时明确 `RESIDUAL_MOUNT`、登记与现场保留、失败记录（`assemble-dmg: FAILURE` JSON）携带 `activeMount`/`residualMount` 供复算。EULA 拒绝探针意外挂载成功时先登记、受控卸载、复核表空，然后才失败。

三轮正式预检（各自独立 app-only build + 装配 + 独立复核 37/37 checks）全部通过，装配阶段 8,665 / 8,807 / 9,391 ms（阈值 180,000 ms），DMG 24,284,017 / 24,284,021 / 24,284,037 B（预算 25,000,000 B）。

## 2. 审阅发现逐项处置

| 发现 | 处置 | 代码/测试证据 |
| --- | --- | --- |
| P1 测试注入未与正式模式隔离 | CLOSED | `bundle-gate.mjs`：`CANONICAL_ROOT`/`IS_PRODUCTION`（realpath 判定）+ 参数阶段注入拒绝 + `PRODUCTION_BUILD_COMMANDS` 精确合同 + tracked assembler 检查 + `SYSTEM_TOOL_PATHS` 清单逐项复核（path + gate 重算 hash）；`assemble-dmg.mjs`：正式拒绝 `--tool-dir`/显式阈值 + `tools` manifest 进报告。测试 R1-1/2/4/5/14/15 |
| P1 成功 attach 后未登记、未卸载路径 | CLOSED | `registerAttachResult`/`registerLeakedMount`/`controlledDetach`/`requireMountTable` 统一状态机；EULA 探针与最终只读挂载都先登记后断言；cleanup 与正常路径都在清空登记前证明 detach 成功且无残留。测试 R1-7/8/9/10/11/12/13 |
| P2 时间预算可被参数放大 | CLOSED | 双侧上限 + 正式精确值校验（gate 报告验证置于其余形状检查之前）。测试 R1-2/3/15 |
| P2 work-dir 超过任务授权范围 | CLOSED | 正式白名单 `.tmp/prr-069c-<非空>`；两模式拒绝 evidence 子树/symlink/预存非空/candidate 子树（gate 在 build 前拒绝）。测试 R1-6 |

## 3. 实现要点

### 3.1 模式判定（fail-closed 方向）

`CANONICAL_ROOT = resolve(HERE, "../..")` 由 runner 文件自身位置决定；`IS_PRODUCTION = toRealPath(ROOT) === toRealPath(CANONICAL_ROOT)`。通过 symlink 别名把 canonical 指向自身时判定为正式（拒绝注入），只有真正切换到 canonical 之外的合成 fixture root 才是 fixture 模式。

### 3.2 检查顺序

`bundle-gate.mjs` 的纯参数检查（注入拒绝、work-dir 白名单、build command 合同）位于 G2 scope、git clean 检查与 build 执行**之前**——正式拒绝不依赖仓库当前状态，也不会先跑一次非法构建再拒绝。

### 3.3 mount 状态机（assemble-dmg.mjs）

| 阶段 | 行为 |
| --- | --- |
| attach 返回 0 | `registerAttachResult`：stdout 解析设备与 exact mountpoint；不可解析时 `findExactMountInTable`（严格 `on <mp> (` 匹配 + `/dev/diskN(sM)` 设备）恢复登记，恢复事实写入命令日志（`recoveredFromMountTable: true`）；两者都失败 → STOP 保留现场 |
| mount table 不可用 | `MountTableUnavailable`（结构化证据：工具路径、起止时间、timeout、退出码、stdout/stderr 摘录）；主流程经 `requireMountTable` fail（STOP），绝不把空输出解释为无挂载；超时预算 = `min(30s, timeoutMs)` |
| 受控卸载 | `controlledDetach`：detach 退出非零、或返回 0 后表内仍有 exact 挂载点/设备、或表不可读 → `RESIDUAL_MOUNT` + 保留登记，返回 false；只有三重证明通过才清空登记 |
| EULA 拒绝探针 | 返回 0（或超时）时先登记 → 受控卸载 → 复核表空 → 再以"挂载前 EULA 未生效"失败；不再出现"先 fail、未登记挂载无人清理"的路径 |
| 失败清理 | `cleanupOnFailure`：登记存在时查表 → 无条目则清空；设备不匹配 → STOP；否则受控 detach + 复核，任一不通过输出 `RESIDUAL_MOUNT` 并保留登记；每次清理 detach 进命令日志 |
| 失败记录 | `FAILURE` JSON 增加 `activeMount`（失败时刻登记）与 `residualMount`（结构化残留原因） |

### 3.4 工具清单绑定

`g2-scope.mjs` 新增导出 `SYSTEM_TOOL_PATHS`（7 个 macOS 系统工具绝对路径，冻结）。assembler 装配开始时对每个实际使用的工具计算 `path + sha256` 写入报告 `tools` 字段；bundle gate 在正式模式逐项核对报告工具与该清单一致（路径相等 + gate 自行重算 hash 相等），fixture 模式仅验形状。正式 inventory 的 source 归因因此绑定 tracked assembler 与冻结系统工具，而不是"被注入文件的 hash 与自身一致"。

### 3.5 测试适配（不改断言强度）

旧 PRR-069C 测试中同 fixture 连续多 case 复用同一 work-dir 的写法与新边界冲突（失败轮按设计保留 runDir 现场）。修改为每个 case 使用独立 work-dir 后缀；所有旧断言保留并按需增强（如 detach 失败断言增加 `RESIDUAL_MOUNT` 与 mock mount table 保持非空）。

## 4. 红灯 → 绿灯证据

- 红灯（旧实现 + 新测试）：`pnpm exec vitest run tests/bootstrap/release-runners.test.ts -t "R1-"` → **15 failed / 74 skipped**，输出存 `.tmp/prr-069c-r1-red/red-run.txt`（2026-09-11 04:13 UTC）。
- 绿灯（新实现）：同文件全量 **89/89 通过**（74 旧 + 15 新）；`pnpm test:unit` 全仓 **53 files / 611 tests** 通过（输出存 `.tmp/prr-069c-r1-red/green-unit.txt`）。
- 红灯与实现按原 PRR-069C 决策 8 同一提交链交付（避免产生单测必然失败的中间 commit），红灯复现证据保留在 `.tmp/prr-069c-r1-red/`。

## 5. 三轮正式预检

每轮从同一 clean HEAD `77f8ca9` 独立执行 `pnpm --filter @mindmap/desktop tauri build --bundles app` + 仓库 assembler 装配（与 `package.json` 的 `bundle:tauri` 同一形状，仅替换 attempt 专属 `--work-dir`/`--inventory`）：

```bash
node scripts/quality/bundle-gate.mjs --host tauri \
  --scope-from docs/decisions/decision-register.json \
  --candidate-root apps/desktop/src-tauri/target/release/bundle \
  --assemble-dmg --dmg-format ULMO \
  --work-dir .tmp/prr-069c-r1-attempt-0N/work \
  --inventory .tmp/release-candidate/prr-069c-r1-attempt-0N/bundle-inventory.json \
  -- pnpm --filter @mindmap/desktop tauri build --bundles app
```

| 轮次 | work-dir（attempt 目录） | evidence 目录（G2 批准） | gate | 装配耗时 | 独立复核 |
| --- | --- | --- | --- | --- | --- |
| 01 | `.tmp/prr-069c-r1-attempt-01/` | `.tmp/release-candidate/prr-069c-r1-attempt-01/` | PASS | 8,665 ms | 37/37 |
| 02 | `.tmp/prr-069c-r1-attempt-02/` | `.tmp/release-candidate/prr-069c-r1-attempt-02/` | PASS | 8,807 ms | 37/37 |
| 03 | `.tmp/prr-069c-r1-attempt-03/` | `.tmp/release-candidate/prr-069c-r1-attempt-03/` | PASS | 9,391 ms | 37/37 |

独立复核（`.tmp/prr-069c-r1-verify.mjs`，逐轮 `attempt-summary.json`）覆盖：source HEAD/clean、阈值精确 120000/180000、命令链无超时、app-only 命令原文、assembler/gate runner hash 与 tracked 文件重算一致、工具清单与 `SYSTEM_TOOL_PATHS` 逐项一致（path + 重算 hash）、LICENSE/EULA/ICNS 绑定、canonical `.app` 目录 hash、DMG hash/bytes 与 inventory 和装配报告三方一致、体积预算、真实 `hdiutil imageinfo`（ULMO + SLA true + 无签名/加密）与 `verify`（CRC32）、挂载前 EULA 拒绝探针（非零 + LICENSE 标记行 + 无挂载内容）、只读挂载复核（卷根恰三项、`Applications → /Applications`、卷图标 hash、`.app` 目录 hash、bundle id/version/minOS、`lipo -archs` = arm64）、干净 detach 后 mount table 无残留、时间拓扑（build-start ≤ assembly-start ≤ assembly-finish ≤ now，全部 Z 结尾 UTC）。

跨轮一致性：

| 字段 | 结果 |
| --- | --- |
| `.app` SHA-256 | 三轮一致 `465d0d6a4f7c9a48…`（28,067,488B） |
| assembler runner SHA-256 | 三轮一致 `6fb4ffb933ba4d65…`（tracked `assemble-dmg.mjs`） |
| gate runner SHA-256 | 三轮一致 `4a5a0e40640562b7…`（tracked `bundle-gate.mjs`） |
| DMG SHA-256 / 字节 | `7e16d3add285f56b…` 24,284,017B / `d617db275033f399…` 24,284,021B / `38d917c7c25c1afb…` 24,284,037B（ADR 0013 已声明容器元数据不跨次稳定；payload/input/runner 一致） |
| HEAD / worktree | 全程 `77f8ca9` / clean |
| 任务挂载点 | 每轮开始前与结束后 mount table 均无 `prr-069c-r1-attempt-*` 挂载点 |

作废前序证据只读复算（记录于 `.tmp/prr-069c-r1-baseline/start-state.txt`）：PRR-069C 三轮 attempt 的 `bundle-inventory.json`/`dmg-assembly-report.json` hash 已复算；canonical 现存 DMG 与 attempt-03 记录一致（`52cad734…`）后由本轮三轮刷新。本轮未修改、覆盖或复制任何历史 attempt/candidate/evidence 目录。

## 6. 验证命令与结果

| 命令 | exit | 备注 |
| --- | --- | --- |
| `pnpm format:check` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm exec vitest run tests/bootstrap/release-runners.test.ts` | 0 | 89/89（含 15 项 R1） |
| `pnpm test:unit` | 0 | 53 files / 611 tests |
| `pnpm test:integration` | 0 | integration + boundaries PASS |
| `pnpm icon:verify` | 0 | |
| `pnpm build` | 0 | 既有 chunk 大小警告不变 |
| `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | |
| `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | 210 passed |
| `cargo clippy --all-targets --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` | 0 | |
| `git diff --check` | 0 | |

单测所需 ignored runtime-spike 证据在运行前确认存在（`.tmp/runtime-spike/`：canvas/debug/export/fixtures/fonts/hosts），未发生 `BLOCKED_ON_REQUIRED_EVIDENCE`。

环境：macOS 26.6.2（25G83）、Node v26.8.2、rustc 1.98.0、pnpm 9.15.9、tauri 2.11.5（Cargo.lock）、CLT `/Library/Developer/CommandLineTools`。

## 7. 关键决策

1. **窄允许命令合同**：正式 build command 用精确 token 序列白名单（与 `package.json` 的 `bundle:tauri` 一致）而不是黑名单猜测 shell 语义；未来命令变更需同步白名单与静态测试，fail-closed。
2. **正式显式阈值一律拒绝（含调小）**：任务卡只要求拒绝"超预算"，实现采取更严口径——正式模式下任何显式 `--timeout-ms/--deadline-ms/--assembler-*` 都拒绝，正式值只能是默认 120000/180000；fixture 可调低用于超时测试但任何模式不得超上限。
3. **work-dir 预存非空即拒绝**：失败轮按设计保留现场，同目录重跑会破坏证据链；每轮/每 case 用独立 work-dir 是正确用法（旧测试已按此适配）。
4. **`SYSTEM_TOOL_PATHS` 放入 `g2-scope.mjs`**：两个 runner 已共享该辅助模块；新增冻结常量避免在 gate/assembler 双份漂移，也避免新建模块。
5. **R1 复核脚本为 `.tmp/` 诊断件**：独立复核脚本不入库（`prr-069c-r1-verify.mjs`），其结论以每轮 `attempt-summary.json` 落盘为证据。

## 8. 未运行项

- PRR-070 / PRR-080 / PRR-090；G-FINAL 申请。
- 签名、公证、凭据访问、系统信任修改、`git push`、上传、公开发布。
- Windows 平台验证（本卡只涉及 macOS DMG 发布门）。

## 9. 剩余风险

1. **系统工具哈希绑定随系统更新变化**：`SYSTEM_TOOL_PATHS` 的 sha256 记录本机工具指纹，macOS 升级后 hash 改变属预期（gate 重算一致即通过）；它证明"装配用的是本机系统工具"而非"工具未被任何方替换"。
2. **`udifrez`/`SetFile` 的 deprecated 与 CLT 依赖**（承 PRR-069C 风险 1/2，不变）：缺失即 fail-closed，不会静默产出无 EULA/无卷图标属性的镜像。
3. **mount 恢复依赖表输出格式**：`findExactMountInTable` 按 `device on <mp> (` 严格匹配；未来 macOS 变更 `/sbin/mount` 输出格式会导致恢复分支 STOP（fail-closed 方向）。
4. **RESIDUAL_MOUNT 需人工介入**：登记保留与现场保留后，恢复动作（如系统级卸载）超出本卡授权，须按 STOP 流程交回。
5. **正式三轮后 canonical bundle 保留 attempt-03 产物**：`apps/desktop/src-tauri/target/release/bundle/` 现为 R1 attempt-03 刷新产物（hash 见上表）；后续 PRR-070 须从新 clean HEAD 重新构建，不得复用。

## 10. Redlines 确认

未执行：PRR-070 / PRR-080 / PRR-090；G-FINAL；签名、公证、凭据访问、系统信任修改、上传、公开发布；`git push` / `rebase` / `reset --hard` / 强制推送；Finder、AppleScript、`osascript`、`.DS_Store`、`--ci`、`--skip-jenkins`、force detach、`sudo`、`diskutil unmountDisk force`；修改 `tauri.conf.json`、应用/core/ui/platform/export 生产逻辑、图标、LICENSE 正文、预算、性能协议、G2/G-FINAL、readiness schema、依赖；延长阈值、重跑挑结果、复用/复制/混合三轮产物或报告；修改、覆盖、清理或复制 PRR-069C 原三轮 attempts、`b45dc0c` 现场及任何历史 candidate/evidence。
