# PRR-069C-R1：DMG 发布门边界与挂载清理加固

状态：`IMPLEMENTED / STOP_FOR_INDEPENDENT_REVIEW`（2026-09-11，实现 commit `77f8ca9`，四项审阅发现全部 CLOSED，三轮正式预检通过；见[实施报告](../quality/prr-069c-r1-implementation-report-2026-09-11.md)）

类型：独立审阅返卡 / 发布证据与系统状态加固

优先级：P0

派发基线：包含本任务卡与状态同步的最新 clean HEAD

审阅输入：[PRR-069C 独立审阅](../quality/prr-069c-independent-review-2026-09-11.md)

前序实现：[PRR-069C 实施报告](../quality/prr-069c-implementation-report-2026-09-10.md)

后继：再次独立审阅；通过前 PRR-070、G-FINAL、PRR-080、PRR-090 全部阻塞

## 1. 目标

保留已经实测成立的 app-only + 无 Finder ULMO 装配路线，只修复以下四项边界：

1. 正式仓库路径拒绝所有测试 assembler/tool/时间注入，并由 bundle gate 自身强制 Tauri app-only 命令。
2. 任一 `hdiutil attach` 成功后，无论后续解析或语义检查怎样失败，都必须进入可证明的卸载与残留检查。
3. 正式 timeout/deadline 固定为单命令最多 `120000ms`、装配总计最多 `180000ms`，不得通过 CLI 或报告字段放宽。
4. 正式 work-dir 只允许新的 `.tmp/prr-069c-*` 任务目录，不得进入历史 candidate/evidence 或其他 `.tmp/` 子树。

本卡不是重新设计装配链，不改变 ADR 0013、EULA、ULMO、图标、应用功能、性能预算或 G2 范围。

## 2. 允许修改范围

- `scripts/quality/bundle-gate.mjs`
- `scripts/quality/assemble-dmg.mjs`
- `tests/bootstrap/release-runners.test.ts`
- 确有必要时，可修改同目录仅供上述 runner 使用的纯辅助模块
- `package.json` 仅在保持现有正式命令语义、且专项测试需要同步时修改
- 本任务卡、原 PRR-069C 卡、planning/quality 索引、release checklist、AGENTS.md 和新的实施报告
- 新诊断与 assembler work-dir 只进入新的 `.tmp/prr-069c-r1-*`；正式 inventory/report 进入新的 G2-approved `.tmp/release-candidate/prr-069c-r1-*` 子目录

不得修改：

- `apps/desktop/src-tauri/tauri.conf.json`
- app/core/ui/platform/export 生产逻辑
- 图标源、图标生成集、LICENSE / THIRD_PARTY_NOTICES
- ADR 0006/0013 的预算、性能协议、ULMO 或 EULA 产品要求
- G2/G-FINAL、readiness schema、PRR-070/080/090 实现
- 依赖版本、运行时依赖、全局工具或系统配置

需要扩大范围时立即返回 `BLOCKED`。

## 3. 固定实现合同

### 3.1 正式模式与 fixture 模式

1. 以 runner 文件所在仓库根作为 canonical source root。正式执行即 `ROOT === canonical source root`；不得仅根据调用者可伪造的普通环境变量判断正式/测试模式。
2. 正式模式必须拒绝 `--assembler-script`、`--assembler-tool-dir`、`--assembler-timeout-ms`、`--assembler-deadline-ms` 以及 assembler 的 `--tool-dir`、超预算 timeout/deadline 覆盖。
3. 测试注入只允许在与 canonical source root 不同的合成 fixture root 中使用；注入路径必须经过 `validateSafePath`，并是 fixture root 的后代，不接受绝对路径、路径穿越或指向 canonical repo。
4. 正式 inventory 必须绑定 tracked `scripts/quality/assemble-dmg.mjs` 的当前文件 hash 和固定系统工具清单；不得把“被注入文件的 hash 与自身一致”当成 source 归因。
5. bundle gate 正式模式必须验证 build command 为 Tauri app-only：包含单一 `tauri build --bundles app` 语义，拒绝 `dmg`、`app,dmg`、默认全 bundle、`--ci`、`--skip-jenkins` 及 wrapper/fake command。优先采用窄的允许命令合同，而不是黑名单猜测任意 shell 语义。

### 3.2 时间与目录边界

1. 正式 assembler 使用 `DEFAULT_TIMEOUT_MS = 120000`、`DEFAULT_DEADLINE_MS = 180000`；正式 bundle gate 必须验证报告为这两个精确值。
2. fixture 可以把阈值调低以测试 timeout，但任何模式都不得超过上述上限；负数、零、非整数、deadline 小于 timeout 或超过上限全部失败。
3. 正式 work-dir 必须匹配仓库相对路径 `.tmp/prr-069c-<non-empty>`（R1 使用 `.tmp/prr-069c-r1-<non-empty>`），不得只使用模糊的 `.tmp/` 根或普通 `.tmp/work`。
4. 明确拒绝 `.tmp/release-candidate/**`、已有 evidence/report 目录、candidate output 目录、符号链接和预存外来目标。fixture 目录规则只在隔离 fixture root 生效。
5. runner 不得删除、覆盖或修改 PRR-069C 原三轮 attempt、`b45dc0c` 现场及任何历史 release-candidate evidence。

### 3.3 attach/detach 生命周期

1. 每次 `hdiutil attach` 返回 0 后，必须先从 stdout 或严格校验过的 mount table 确认 exact mountpoint/device，并登记为 active mount，再执行后续语义断言。
2. EULA 拒绝探针意外 attach 成功时，先执行受控 detach 和残留复核，再以非零结束；不能先 `fail` 后期待未登记状态被清理。
3. attach 返回 0 但 stdout 不可解析时，必须查询 exact mountpoint；若发现挂载则登记并清理。无法确认状态时 STOP 并保留真实现场，不得把空输出解释为无挂载。
4. `mountTable()` 遇到 timeout、spawn error 或非零状态必须失败并输出结构化证据，不得返回空表。
5. cleanup 中 `detach` 只有在退出 0 且随后 mount table 不再包含 exact mountpoint/device 时才可清空 active state。detach 失败、设备不匹配或仍有残留时保留状态和现场，返回非零并明确 `RESIDUAL_MOUNT`。
6. 正常成功路径同样在清空 active state 前证明 detach 成功且无残留。
7. 不允许使用 `-force` detach、`sudo`、`diskutil unmountDisk force`、全局扫描后批量卸载或其他扩大系统影响面的补救。

## 4. 红灯测试（先建立失败，再实现）

至少新增以下测试，且测试必须断言退出码、错误分类、inventory 不存在以及 mock mount table 最终状态：

1. canonical root 传 `--assembler-script`，拒绝。
2. canonical root 传 `--assembler-tool-dir`，拒绝。
3. canonical root 覆盖 timeout/deadline，即使值更小也拒绝；超过 `120000/180000` 在任何模式都拒绝。
4. fixture 注入路径逃逸、绝对路径或指向 canonical repo，拒绝。
5. 正式 build command 为 fake Node command、默认 Tauri bundle、`--bundles dmg`、`--bundles app,dmg`、`--ci` 或 `--skip-jenkins`，逐项拒绝。
6. work-dir 为 `.tmp/release-candidate/...`、普通 `.tmp/work`、candidate 子树、symlink 或预存 evidence，逐项拒绝。
7. EULA 拒绝探针返回 0 且真实建立 mock mount：runner 必须先成功 detach，mount table 为空，然后整体失败。
8. attach 返回 0、stdout 不可解析但 mount table 有 exact mountpoint：必须找到并清理。
9. attach 返回 0、stdout 不可解析且 mount table 查询失败：明确 STOP，不得报告已清理。
10. cleanup detach 返回非零：active mount 不能被静默清空，错误包含 `RESIDUAL_MOUNT`，mock mount table 保持非空供复算。
11. detach 返回 0 但 mount table 仍有条目：失败并保留残留证据。
12. mount 命令 timeout/非零：不得把 stdout 空值解释成“无残留”。
13. 正常路径 detach 后 mount table 为空，最终 inventory 仍满足现有全部绑定。

不得通过弱化现有断言、删除旧红灯、mock 永远返回空 mount table、吞掉非零或跳过测试完成本卡。

## 5. 实施顺序

1. 记录起始 HEAD、`git status --short`、系统版本、Node/Rust/Tauri 版本；确认 worktree clean。
2. 只读复算 PRR-069C 三轮 attempt 的现存 hash，记录为作废前序证据；不得修改其内容。
3. 先补上述红灯并保存失败输出到新的 `.tmp/prr-069c-r1-red/`。
4. 实现 production/fixture 边界、app-only 命令合同、固定阈值与 work-dir 白名单。
5. 实现统一 attach 登记、detach 确认和 fail-closed cleanup；避免在多个调用点复制不一致的状态机。
6. 运行专项测试并逐项证明红灯转绿；再运行全量源码门。
7. 从本卡修复后的同一 clean source 连续执行三轮完整正式预检，每轮使用独立的 `.tmp/prr-069c-r1-attempt-01..03/` work-dir，并把 inventory/report 写入新的 `.tmp/release-candidate/prr-069c-r1-attempt-01..03/`。三轮均重新构建 `.app` 和 DMG，不复用任何旧 artifact/report。
8. 每轮复算 source/app/DMG/assembler/LICENSE/ICNS hash、ULMO、CRC32、体积、EULA、Applications、卷图标、payload identity、命令日志、时间拓扑和挂载前后状态。
9. 更新实施报告和状态文档，提交新的本地 clean commit。
10. 固定格式交回并停在 `STOP_FOR_INDEPENDENT_REVIEW`。不得开始 PRR-070。

## 6. 必跑验证

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

若根 README 的命令形式与上面不同，以 README 为准，但不得减少覆盖。单测所需的 ignored runtime-spike evidence 必须在运行前明确验证存在；缺失时报告 `BLOCKED_ON_REQUIRED_EVIDENCE`，不得复制历史 PASS 文本冒充本轮执行。

三轮预检每轮必须：

- 从同一 clean HEAD 独立 app-only build；
- assembler elapsed `<=180000ms`，且未覆盖正式阈值；
- DMG 为 ULMO、CRC32 VALID、`<=25000000B`；
- EULA、Applications、卷图标、payload/app identity 全 PASS；
- 开始前、结束后 exact task mountpoint 均不存在；
- HEAD/worktree 全程不变；
- evidence 不覆盖、不混用、不补写。

## 7. STOP 条件

- 需要放宽 ADR、预算、时间阈值、G2 路径或 app-only 合同。
- 无法在不使用 force/sudo/Finder/AppleScript/`.DS_Store` 的情况下证明挂载已清理。
- 需要修改生产 Tauri 配置、应用代码、图标、许可证、依赖、CI/CD 或系统配置。
- 任一专项/全量测试或任一正式预检失败。
- 发现本卡运行修改、覆盖或复用任何历史 candidate/evidence。
- 需要签名、公证、访问凭据、修改系统信任、push、上传或公开发布。

命中 STOP 后保留本轮专属现场并返回 `BLOCKED`；不得延长阈值、换口径、跳过失败或重跑挑结果。

## 8. 交回格式

```text
Task: PRR-069C-R1
Status: STOP_FOR_INDEPENDENT_REVIEW | BLOCKED | FAILED
Base: <starting HEAD + clean status>
Changed: <逐文件>
ReviewFindings: <P1/P2 四项逐项 CLOSED/OPEN + 代码/测试证据>
Decisions: <production/fixture 边界 + mount 状态机>
Verification: <完整命令、exit code、测试数量、三轮装配时长>
Evidence: <red/green + 三个独立 attempt 路径及 SHA-256>
MountSafety: <每类异常路径的最终 mock/real mount table 状态>
NotRun: PRR-070 / G-FINAL / PRR-080 / PRR-090
Risks: <剩余系统工具风险>
Redlines: <确认未执行>
Next: STOP_FOR_INDEPENDENT_REVIEW
```
