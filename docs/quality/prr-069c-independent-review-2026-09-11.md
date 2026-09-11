# PRR-069C 独立审阅：确定性 DMG 发布门仍需加固

日期：2026-09-11

审阅结论：`REVISE / PRR-070_BLOCKED`

审阅范围：`b14b78a900854c397247e3a43cd42f67db599c1f..6b490a66016d630d8d04becb288cbf8026f6dc3c`

精确 patch SHA-256：`ae0cd06967e5b8e19e03ca31a549811df85af95845623b4f2dc15555bf7641dc`

后继任务：[PRR-069C-R1 发布门边界与挂载清理加固](../planning/prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md)

## 结论

PRR-069C 已证明 app-only build + 仓库 assembler 的正常路径能够连续生成满足 ULMO、CRC32、体积、EULA、Applications 链接、卷图标与 payload identity 要求的 DMG，移除 Finder/AppleScript/`.DS_Store` 依赖的技术方向成立。

但当前实现仍允许正式仓库调用测试注入和放宽时间阈值；部分成功 attach 后的失败路径也不能证明挂载已清理。由于这些缺口直接影响候选可归因性和失败后的系统状态，独立审阅结论为 `REVISE`。不得接受当前实现为 PRR-070 基线，也不得复用 PRR-069C 三轮预检作为整改后的通过证据。

## 阻断发现

### P1：测试注入没有与正式发布模式隔离

`scripts/quality/bundle-gate.mjs` 暴露 `--assembler-script`、`--assembler-tool-dir`、`--assembler-timeout-ms`、`--assembler-deadline-ms`，但没有在 canonical repository root 拒绝这些参数。现有成功测试证明 mock 系统工具可以完成整条 PASS 路径；inventory 虽记录被注入 assembler 的 hash，却没有证明该实现属于冻结的 clean source，工具目录也未绑定。

正式 bundle gate 同样没有在自身运行时强制 build command 为 Tauri app-only；该约束目前主要由 `package.json` 静态测试承担。发布 Gate 必须自行拒绝非 app-only、`dmg` target、CI 绕过和测试注入，不能依赖调用者自律。

### P1：成功 attach 后存在未登记、未卸载路径

挂载前 EULA 拒绝探针若意外返回 0，代码在登记 `mountedDevice` / `mountedAt` 前直接 `fail`，失败清理因而不知道需要卸载哪个卷。最终只读 attach 若成功但输出解析失败，也存在同类风险。

此外，`cleanupOnFailure` 忽略 `hdiutil detach` 的退出状态后无条件清空内存状态；`mountTable` 忽略 `mount` 非零或超时并把空 stdout 当作“没有挂载”。因此“清理完成”不能由现有控制流证明。

### P2：正式时间预算可以被参数放大

assembler 只检查 timeout/deadline 为正整数，bundle gate 只检查报告字段为整数。调用者可以把任务卡固定的单命令 `120000ms`、总 deadline `180000ms` 放大后继续生成 PASS 证据，违反“超时即 STOP，不得延长阈值重跑”。

### P2：work-dir 超过任务授权范围

当前只要求 work-dir 位于 `.tmp/`，因此历史 `.tmp/release-candidate/...` 或其他旧证据目录也能成为工作目录。任务授权只允许新的 `.tmp/prr-069c-*` 任务范围；历史候选与证据必须只读。

## 独立验证

- `pnpm exec vitest run tests/bootstrap/release-runners.test.ts`：74/74 PASS。
- `pnpm format:check`、`pnpm typecheck`、`pnpm lint`：PASS。
- `pnpm test:integration`：14 files / 94 tests PASS。
- `pnpm icon:verify`、`pnpm build`：PASS；production entry `486.09kB`。
- 隔离 clone 首次 `pnpm test:unit` 为 593 PASS / 3 FAIL，三项均因 clone 没有 ignored `.tmp/runtime-spike` 证据；补入同源只读证据后，相关 16 项测试全部 PASS。
- 三轮原生 ULMO 预检报告及 hash 已复算，正常路径事实成立。
- 本 patch 未修改 Rust；独立 Rust 重跑因隔离 clone 缺缓存会重新下载/编译而中止，本次采用实现交回的 210 项 Rust PASS 记录。该项不是上述结论的决定性未知。

## 处置

1. 派发 PRR-069C-R1，只修复上述发布门和挂载生命周期缺口。
2. 形成新的 clean source commit 后，三轮正式预检必须从头重做，使用新的独立证据目录；不得覆盖或拼接 PRR-069C 旧 attempt。
3. PRR-069C-R1 交回后再次独立审阅。只有审阅结论为 `ACCEPT`，才可从新 clean HEAD 派发 PRR-070。
