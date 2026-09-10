# PRR-069C：无 Finder 依赖的确定性 macOS DMG 装配

状态：`READY_FOR_DISPATCH`

类型：发布 runner 根因整改

优先级：P0

依赖：PRR-069 已独立验收；[ADR 0013 v1.1.0](../decisions/0013-macos-dmg-compression.md) 已明确替代路径；source `b45dc0c` 的 PRR-070 STOP evidence 只读冻结

后继：实现交回独立审阅；只有审阅接受并形成新 clean HEAD 后，才能从步骤 1 完整重做 PRR-070

## 问题与目标

Tauri 2.11.4 的 macOS DMG 美化脚本把完成条件交给 Finder 写入 `.DS_Store`，并通过无超时循环等待。该路径已经在两次独立 clean build 中挂起约 9 分钟，不能继续作为发布候选构建依赖。

本卡不是给等待加超时后继续碰运气，而是移除依赖：Tauri 只构建 unsigned `.app`，由仓库内受控 runner 使用 macOS 系统工具装配最终 ULMO DMG。最终安装包继续包含同源 `.app`、`Applications` 链接、卷图标和挂载前 EULA；Finder 自定义窗口尺寸/图标坐标不再属于发布功能。

本卡只整改构建与证据 runner，不执行 PRR-070 原生性能、安装、LaunchServices、功能矩阵、G-FINAL 或 PRR-080。

## 固定技术路线

1. 正式 Tauri 命令显式使用 app-only target（`tauri build --bundles app`），不得调用 `dmg` target。
2. 新增单一职责 DMG assembler，由 `bundle-gate.mjs` 在同一轮 app build 成功、HEAD/worktree 复核后调用；只接受 G2 精确批准的 `.app` 输入和 `.dmg` 输出。
3. assembler 使用 macOS 自带工具建立受控 staging/read-write image、放入 `.app`、`Applications -> /Applications` 和 `.VolumeIcon.icns`，设置卷图标属性，注入根 `LICENSE` 生成的 EULA resource，再生成或转换为 ULMO。实际可用的 `hdiutil`/resource 命令必须由实现测试证明，不得把未验证的命令写成 PASS。
4. 正式路径不得启动/控制 Finder，不得调用 AppleScript/`osascript`，不得使用 `--ci`、`--skip-jenkins`，不得读取、生成、复制、提交或等待 `.DS_Store`。
5. 不保证 Finder 窗口尺寸和 app/Applications 坐标；这部分装饰性布局明确让位于可重复构建。EULA、卷图标、Applications 链接和 payload identity 仍是强制验收项。
6. 每个 DMG 装配子进程必须有显式超时和结构化失败记录；超时后只能清理由本轮创建且位于已授权 `.tmp/prr-069c-*` 的资源，并确认无残留挂载。无法安全 detach 或识别到外来路径时立即 STOP，不得强制清理。

## 允许修改范围

- `scripts/quality/bundle-gate.mjs`
- 新增单一职责 `scripts/quality/assemble-dmg.mjs`，以及确有必要的同目录 EULA resource 生成模块
- 保留 `scripts/quality/repack-dmg.mjs` 作为历史兼容代码；本卡未授权删除或重命名，只能解除正式发布命令引用并标注 superseded
- `tests/bootstrap/release-runners.test.ts` 及该测试使用的仓库内合成 fixture
- 根 `package.json`、`README.md` 中的正式 bundle 命令与说明
- ADR 0013 的实施状态说明、本卡状态、planning/quality 索引和实施报告
- 诊断与三轮预检证据只进入新的 `.tmp/prr-069c-*`

不得修改 `apps/desktop/src-tauri/tauri.conf.json`、应用/core/ui/platform/export 生产逻辑、图标源与生成集、LICENSE 正文、预算、性能协议、G2/G-FINAL 或 readiness schema。必须扩大范围时返回 `BLOCKED`。

## 红灯测试（先写）

1. 正式 bundle 命令仍包含 Tauri `dmg` target，或 runner 调用 Finder、AppleScript、`osascript`、`--ci`、`--skip-jenkins`、`.DS_Store`，测试必须失败。
2. `.app` 不是本轮刷新、路径不等于 G2 批准值、source HEAD/worktree 漂移、输入为 symlink 或目录结构异常，必须 fail-closed。
3. staging、临时 image、mount point 或最终 DMG 越过批准范围、命中预存外来目标、出现 symlink traversal，必须 fail-closed，且不得覆盖/删除外来内容。
4. 任一系统命令超时/非零、mount 设备与预期不一致、detach 失败或出现残留 mount，必须返回非零且不得写 PASS inventory。
5. DMG 缺 `.app`、Applications 链接目标不是 `/Applications`、卷图标 hash 不等于仓库固定 ICNS、EULA 缺失/内容 hash 不等于根 LICENSE，必须失败。
6. 最终 `Format != ULMO`、CRC32 非 VALID、DMG 加密/分发签名、大小超过 `25000000B`，必须失败。
7. DMG 内 `.app` 目录级 hash/bundle id/version/minOS/arm64 与 app-only build 不一致，必须失败。
8. inventory 沿用旧 Tauri DMG/repack hash、缺 assembler/inputs/commands/timestamps/hash，或时间不是合法机器生成 UTC、顺序逆转/未来时间，必须失败。
9. 第一次失败后第二次覆盖同一 evidence，或三轮预检混用 artifact/report，必须失败。
10. 合成 hanging tool 必须在约定超时内被终止并输出可复算失败证据；测试不得真实等待数分钟。

## 实施顺序

1. 冻结 base HEAD 和 clean worktree，确认 `b45dc0c` PRR-070 evidence 目录与报告只读不动。正式 build 会刷新 G2 已批准的 canonical `target/release/bundle` 路径；刷新前先把仍在该路径且 hash 与作废报告一致的 `.app`/`.dmg` 复制到新的 `.tmp/prr-069c-invalidated-b45dc0c/` 并复算 hash。该副本只作历史留存，不得成为 assembler 输入；若 canonical 产物已不存在或 hash 不符，只记录事实，不从旧 evidence 反向拼装。随后记录实际 Tauri 2.11.4 app-only CLI 能力和系统工具可用性。
2. 先提交红灯测试，覆盖命令禁区、路径/同源、超时、挂载生命周期、EULA/图标/Applications、ULMO/CRC/体积和 inventory 绑定。
3. 实现 assembler 的纯参数/路径/报告层，再实现受控系统命令层。调用必须使用参数数组，不拼 shell 字符串；stdout/stderr 去敏后写证据。
4. 修改 bundle gate：app-only build 前后复核 source；确认 `.app` 本轮刷新后调用 assembler；只在 DMG 装配、只读复核和 source 再复核全部通过后生成最终 inventory。
5. 正式 `bundle:tauri` 明示 app-only + assembler 方案。不得依赖开发机环境变量或交互式 Finder 状态。
6. 以根 LICENSE 生成临时 EULA resource；生成物只进任务临时目录，不提交包含路径/时间的临时资源。验证挂载前确实展示 EULA，而非仅检查 resource 文件存在。
7. 使用最终 DMG 执行 imageinfo/verify/无写入挂载：核对 ULMO、CRC、体积、app hash/identity、Applications 链接、卷图标、EULA，正常 detach，并确认无残留 mount。
8. 连续执行三次完整正式预检，每轮使用不同的 `.tmp/prr-069c-attempt-01..03/` evidence；不得人工操作 Finder，不得复用/复制产物或报告。每轮分别记录 app/DMG hash、阶段时长、assembler runner hash、HEAD/worktree、挂载前后状态。DMG 字节 hash允许因容器元数据不同而不同，但 payload/app/input/runner 必须一致。
9. 更新 README、ADR 实施说明、planning/quality 状态和 `docs/quality/prr-069c-implementation-report-2026-09-10.md`；提交一个新的本地 clean source commit。
10. 固定格式交回并停在 `STOP_FOR_INDEPENDENT_REVIEW`。不得自行开始 PRR-070。

## 验收

- `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm icon:verify`、`pnpm build` 全部 exit 0。
- `cargo fmt --check`、`cargo test --locked`、`cargo clippy --all-targets --locked -- -D warnings` 全部 exit 0。
- release runner 红灯/绿灯完整；hanging fake tool 在固定短超时内 fail-closed。
- 三轮正式预检全部在没有 Finder/AppleScript/`.DS_Store` 依赖的情况下完成；每轮 DMG 装配阶段目标 `≤180s`，超出即失败，不延长阈值重跑。
- 三轮最终 DMG 均为 ULMO、CRC32 VALID、`≤25000000B`，且挂载前 EULA、Applications 链接、卷图标、payload app hash/identity 全 PASS。
- 每轮 inventory 独立绑定 source、app、DMG、assembler、LICENSE、ICNS、命令和合法 UTC 时间拓扑；source/worktree 全程不漂移。
- 没有修改 Tauri 生产配置、应用代码、图标、LICENSE、预算或性能协议；没有新运行时/全局依赖。
- `git diff --check` 通过；提交后 `git status --short` 为空。

## STOP

- 无法用系统工具保留挂载前 EULA、卷图标或 Applications 链接，或只能通过 Finder/AppleScript/`.DS_Store`/CI 绕过实现。
- 需要新增第三方生产依赖、修改 `tauri.conf.json`、图标、LICENSE、预算、应用代码或 G2 范围。
- 任一测试/预检失败，任一 mount 无法安全恢复，或三轮中出现人工桌面干预、旧产物复用、重跑挑结果。
- 需要删除/覆盖 `b45dc0c` evidence 或其归档副本；canonical `target/release/bundle` 在完成上述归档后可由本卡授权的正式预检刷新。修改系统配置/信任，签名、公证、访问凭据、push、上传或发布同样立即 STOP。

## 交回格式

```text
Task: PRR-069C
Status: STOP_FOR_INDEPENDENT_REVIEW | BLOCKED | FAILED
Base: <starting HEAD + clean status>
Changed: <逐文件>
Decisions: <装配链与失败语义>
Verification: <完整命令、exit code、测试数量、三轮时长>
Evidence: <三个独立 attempt 路径 + SHA-256>
NotRun: PRR-070 / G-FINAL / PRR-080
Risks: <系统工具与安装体验残余风险>
Redlines: <确认未执行>
Next: STOP_FOR_INDEPENDENT_REVIEW
```
