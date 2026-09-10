# PRR-069：macOS DMG ULMO 压缩与证据时间拓扑整改

状态：`COMPLETE / INDEPENDENT_REVIEW_ACCEPTED`（2026-09-10；实施 `cfa4dfe`，审阅修复 `198710d`；[独立审阅](../quality/prr-069-independent-review-2026-09-10.md)确认最终 runner、ULMO/CRC、payload/EULA/图标与 fail-closed 证据绑定通过。PRR-070 仍未在本卡执行）

类型：发布 runner 根因整改

优先级：P0

依赖：PRR-068 已通过独立审阅；PRR-070 source `58003c0` 的失败证据只读冻结；[ADR 0013](../decisions/0013-macos-dmg-compression.md) 已 Accepted

后继：独立审阅通过后，才可从新 clean HEAD 完整重跑 PRR-070

## 背景与目标

新图标使 Tauri 默认 UDZO DMG 增至 25153239B，超过 25000000B 预算 153239B。根因不是 app 代码或图标设计，而是完整 ICNS 同时作为 app 图标和卷图标，加上默认压缩余量不足。

本卡保持已批准图标逐字节不变，在 same-run bundle 流程中把最终 DMG 转换为 ULMO，并补上可机器验证的 UTC 时间拓扑规则。目标是让后继 PRR-070 得到 `Format=ULMO`、`≤25000000B`、payload/EULA 不变的唯一候选；本卡本身不执行 PRR-070 性能、安装、LaunchServices、G-FINAL 或 PRR-080。

## 允许范围

- `scripts/quality/bundle-gate.mjs`，或新增一个单一职责的 `scripts/quality/repack-dmg.mjs` 并由 bundle gate 显式调用。
- `tests/bootstrap/release-runners.test.ts` 及必要的同名测试夹具。
- 根 `package.json` / `README.md` 的正式 bundle 命令。
- PRR-070 任务卡中最终 DMG 格式、时间拓扑和命令说明。
- 实施报告与本卡状态。
- 诊断产物只进新的 `.tmp/prr-069-*`；候选预检只使用 G2 已批准的 `apps/desktop/src-tauri/target/release/bundle/`。

## 禁止范围

- 不改 `assets/app-icon/**`、`apps/desktop/src-tauri/icons/**`、SVG、PNG、ICO、ICNS chunk/槽位或 `tauri.conf.json`。
- 不改 app、core、ui、platform、export 生产逻辑，不改 ADR 0006 预算或最低 macOS 11.0。
- 不引入运行时依赖，不 fork/patch Tauri，不把生成的 `bundle_dmg.sh` 提交为源码。
- 不签名、公证、访问凭据、修改系统信任、push、上传或公开发布。
- 不覆盖/改写任何旧 `.tmp/release-candidate/<commit>/` 证据。

## 实施要求

1. bundle gate 必须先完成原有 G2、host、clean worktree、批准路径和 same-run refresh 校验，再只对本轮唯一且已批准的 `.dmg` 执行转换；不得接受 glob 猜测目标。
2. 正式命令显式声明 `ULMO`，不得依赖开发机隐式环境变量。Tauri 先生成带 EULA/卷图标的 unsigned DMG；inventory 计算前执行 `hdiutil convert <input> -format ULMO` 到同一批准候选目录内的唯一临时路径，验证成功后再原子替换最终路径。
3. 输入不是本轮刷新、目标越界、临时目标预存、`hdiutil` 不存在、转换非零、最终 `Format != ULMO`、CRC32 非 VALID、输出为签名/加密镜像、source/worktree 变化时全部 fail-closed；不得回退 UDZO 后写 PASS。
4. inventory 新增 `dmgFormat: "ULMO"` 与转换 runner/hash/开始结束时间，artifact SHA-256/bytes/mtime 必须指向转换后的最终 DMG。不得把转换前 DMG 的 hash 留作 candidate hash。
5. 保留既有 app hash 算法。只读挂载转换后 DMG，确认 EULA 仍展示、`.app` 目录级 hash 与构建 app 相同、bundle id/version/minOS/`.mindmap` identity 不变、`.VolumeIcon.icns` 与仓库 ICNS hash 相同，然后正常 detach。
6. 新增红灯测试：缺格式参数；不允许的格式；输入/临时路径逃逸；临时目标预存；转换命令失败；伪造 `Format`；CRC 校验失败；转换后 source/worktree 变化；inventory 误绑转换前 hash。既有 bundle-gate 安全测试全部保持绿灯。
7. PRR-070 的 source freeze UTC 只能由 `new Date().toISOString()` 或 `date -u` 生成。任务卡加入即时断言：`freeze <= first gate start <= last gate finish <= bundle start <= bundle finish`；解析失败、未来时间或逆序立即 STOP，禁止手工把本地时间加 `Z`。

## 验收

- `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm icon:verify`、`pnpm build` 全 PASS。
- `cargo fmt --check`、`cargo test --locked`、`cargo clippy --all-targets --locked -- -D warnings` 全 PASS。
- 全新预检 build 的最终 DMG 为 ULMO、CRC32 VALID、`≤25000000B`；目标余量至少记录 500000B，若不足仍须说明并停止交回复核。
- EULA、payload `.app` hash、bundle identity 和卷图标 hash 均与转换前/仓库输入一致；未更改任何图标文件。
- bundle 前后 HEAD 相同；提交后 `git status --short` 为空；`git diff --check` 通过。

## STOP 与交回

任一验收失败、需要改变图标/预算/minOS/生产逻辑、需要新增全局工具或发生越权动作时立即停止。

成功时提交 clean source，固定格式交回：`Task / Status / Base / Changed / Decisions / Verification / Evidence / NotRun / Risks / Redlines / Next`。状态写 `STOP_FOR_INDEPENDENT_REVIEW`，并明确 `PRR-070 NOT STARTED`；等待独立审阅，不得自行继续 PRR-070、G-FINAL 或 PRR-080。
