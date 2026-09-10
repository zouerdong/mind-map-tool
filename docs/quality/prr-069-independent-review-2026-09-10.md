# PRR-069 DMG 压缩与证据绑定独立审阅

日期：2026-09-10

结论：`ACCEPT / COMPLETE`

实施提交：`cfa4dfee63f2b353f4432328657d8f4bc2a73568`

审阅修复提交：`198710d5b1a5598874e06bbf26af21eebf62d94e`

## 结论

PRR-069 已完成。正式 `bundle:tauri` 显式要求 ULMO；转换发生在最终 inventory 之前，目标路径、G2、same-run mtime、格式、CRC32、签名/加密状态、source/worktree 与最终 artifact hash 全部 fail-closed。已批准图标、app 生产逻辑、预算、最低 macOS 版本和 `tauri.conf.json` 均未修改。

实施预检的 ULMO DMG 为 24288684B，低于 25000000B 上限 711316B；独立使用最终修正版 runner 和系统 `hdiutil` 再次执行 UDZO→ULMO，得到 24288652B、CRC32 VALID。只读挂载后 EULA、`.app` 目录级 hash、bundle identity 和卷图标 hash 均保持。没有剩余 P0/P1/P2 代码问题。

## 审阅发现与已修复问题

### P2：bundle gate 未把 repack 报告与最终盘点写成代码级约束

原实现会在测试中断言 `inventory artifact == dmgRepack.afterSha256`，但生产 gate 只把两个值同时写入 JSON，没有主动比较；同时也未严格复核 nested runner hash、输入路径、source commit 和 repack 时间窗。

已修复：bundle gate 现在校验 repack 报告结构、runner SHA-256、source、format、输入、hash/bytes 与时间拓扑，并在最终扫描后强制比较 DMG `sha256/sizeBytes` 与 repack `afterSha256/afterBytes`。任何漂移均不写 PASS inventory。

### P2：无效 report 目标会在 DMG 已替换后才失败

原实现直到成功转换并原子替换最终 DMG 后，才校验 `--report` 是否位于 G2 evidence 范围；独立调用时会产生“报告越权被拒绝，但候选已改变”的副作用。

已修复：report 路径和授权边界在调用 `hdiutil convert` 前完成；新增红灯证明未批准路径失败时原 DMG 不变。

### P3：standalone repack 缺少转换前 clean/HEAD 基线与严格 UTC 输入

原实现只在转换后检查 worktree clean，不能区分预存 dirty 与转换期间变化；`Date.parse` 还会接受带 offset 的本地时间，弱于任务卡的 UTC-only 约束。

已修复：转换前先冻结 HEAD/clean，转换后同时比较 HEAD 与 status；`--after` 给出时必须是以 `Z` 结尾的明确 UTC ISO。新增预先 dirty 和本地 offset 时间红灯。

## 独立验证

| 验证 | 结果 |
| --- | --- |
| release runner 定向测试 | 53/53 PASS（实施 50 项，审阅新增 3 项） |
| `pnpm test:unit` | 53 files、575/575 PASS |
| `pnpm test:integration` | 14 files、94/94 PASS；boundaries PASS |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | PASS |
| Rust `fmt` / `test --locked` / `clippy -D warnings` | 210/210 PASS / PASS |
| 最终 runner + 系统 `hdiutil` | UDZO 25323578B → ULMO 24288652B；CRC32 VALID |
| ULMO 只读挂载 | EULA 1 次；app hash `cfa414c8…c5b20`；bundle id `com.mindmap.desktop`；版本 0.1.0；minOS 11.0 |
| 卷图标 | `.VolumeIcon.icns` 与仓库 ICNS 均为 `7146e7c8…e684cc` |
| 最终 runner hash | `repack-dmg.mjs=c83927a9…871d7`；`bundle-gate.mjs=cd8c1e0e…a04f0` |

独立产物保存在 `.tmp/prr-069-real-hdiutil-review/198710d5b1a5598874e06bbf26af21eebf62d94e/`。它只用于 PRR-069 代码复核，不是 PRR-070 候选，不得复用为发布证据。

## 上游 Finder 挂起记录

审阅曾从 clean `198710d` 启动一次完整 Tauri bundle。app 编译完成后，上游 `create-dmg` 的 Finder AppleScript 长时间等待 `.DS_Store`，ULMO 阶段尚未开始；审阅主动终止该次无进展的 `osascript`，脚本正常返回非零并卸载临时卷，未生成 inventory。未完成的 54564352B 可写临时镜像已移动到 `.tmp/prr-069-review-failed-build/198710d5b1a5598874e06bbf26af21eebf62d94e/`，没有删除或冒充成功证据。

该现象位于 Tauri 上游 DMG 美化阶段，不是 PRR-069 转换器回归；实施者此前的完整预检已成功，最终修正版 runner 也已用真实 `hdiutil` 独立通过。它作为 PRR-070 的受控环境风险保留：若下一轮再次发生，必须按 STOP 返回，不能手工伪造 `.DS_Store`、跳过美化或混用本次产物。

## 下一步

从包含本报告和状态同步的最新 clean HEAD 完整执行 PRR-070。必须从步骤 1 新建 source 专属证据，机器生成 UTC，运行全部源码门，构建唯一 ULMO `.app/.dmg`，然后依序完成性能、安装/LaunchServices、原生矩阵和 G-FINAL 请求。不得复用 PRR-069 预检、独立 fixture 或任何历史候选；命中 Finder 挂起或其他失败即 STOP。
