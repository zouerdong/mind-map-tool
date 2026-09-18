# ADR 0013: macOS DMG 使用 ULMO 压缩

- Status: Accepted
- ADR-Version: 1.1.0
- Date: 2026-09-10
- Owners: 独立发布审阅 / 执行 Agent（工程实现）
- 任务来源: PRR-070 source `58003c0351bdb53f1b2009c7c377e3410782b12c` 的 DMG 体积红灯

## Context

PRR-068 把负责人选定的 C 方案完整集成为 macOS 应用图标。Tauri 2.11.4 的默认 DMG 流程使用同一 `icon.icns` 作为 app 图标和 `.VolumeIcon.icns`，因此 307255B 的高质量 ICNS 在镜像中出现两次。source `58003c0` 的唯一 unsigned 候选使用默认 UDZO 压缩后为 25153239B，超过 ADR 0006 固定的 25000000B installer 预算 153239B。

图标母版和完整 macOS 槽位已经通过独立视觉验收。为包体而删除 1024px/Retina 槽位、量化渐变或移除卷图标，会降低已经批准的视觉资产质量或安装体验；提高预算又违反已接受的发布门。

同一失败 DMG 的只读转换实验结果如下：

| 格式 | 实测 bytes | 相对 25000000B | 结论 |
| --- | ---: | ---: | --- |
| UDZO（Tauri 默认） | 25153239 | +153239 | FAIL |
| UDBZ | 25113265 | +113265 | FAIL，且系统已标记 deprecated |
| ULFO | 25309565 | +309565 | FAIL |
| ULMO | 24288652 | -711348 | PASS |

本机 `hdiutil` 文档声明 ULMO 自 macOS 10.15 起可用；产品最低版本为 macOS 11.0。ULMO 实验镜像通过 CRC32，EULA 仍在挂载前展示，只读挂载后的 `.app` 目录级 SHA-256、bundle id 和 `.VolumeIcon.icns` SHA-256 均与转换前一致。

PRR-069 实现后，两次相互独立的 clean build 都在 Tauri 2.11.4 上游 `bundle_dmg.sh` 的 Finder AppleScript 中长时间等待 `.DS_Store`。该脚本用无上限循环等待 Finder 写入窗口布局元数据：第一次由独立审阅者终止，第二次在执行 Agent 按预先声明的 STOP 冻结现场后约 74 秒自然完成，总等待约 9 分 20 秒。第二次最终产物本身为有效 ULMO/CRC32，但因 STOP 已生效而不具备 PRR-070 候选资格。

问题的本质不是压缩格式，而是发布构建把完成条件交给 Finder 会话和桌面活动。延长等待、人工或自动创建 `.DS_Store`、使用 CI/`--skip-jenkins` 绕过、重试挑选成功轮次，都不能建立可重复、可审计的发布路径。

## Decision

1. macOS 0.1.0 的最终 unsigned DMG 使用 `ULMO`（UDIF LZMA）压缩；不得修改 25000000B installer 预算。
2. Tauri 只负责构建标准 unsigned `.app`；仓库受控的单一职责 runner 使用 macOS 系统工具从该 `.app` 装配最终 DMG。正式路径不得调用 Finder、AppleScript、Tauri `dmg` target、`--ci`/`--skip-jenkins`，也不得读取、生成、复制或等待 `.DS_Store`。
3. DMG 继续包含同源 `.app`、指向 `/Applications` 的链接、仓库固定 ICNS 对应的卷图标和根 `LICENSE` 生成的挂载前 EULA；不再把 Finder 窗口尺寸或图标坐标视为发布功能。可靠装配优先于不可审计的装饰性窗口布局。
4. 装配必须 fail-closed：输入 `.app` 必须是本轮刚刷新的已批准路径；临时 staging/image 只进入 G2 已批准的项目内临时范围；每个系统子进程有明确超时；路径、symlink、挂载点、detach、EULA 注入、格式、CRC32、体积、source/worktree 或 identity 任一异常时不得生成 PASS inventory。
5. 最终 DMG 直接产出或转换为 ULMO。必须用 `hdiutil imageinfo` 证明 `Format=ULMO`，用 `hdiutil verify` 证明镜像有效，并通过无写入挂载复算 EULA、Applications 链接、`.app` 目录级 hash、bundle identity 与卷图标 hash。
6. inventory 必须绑定 `.app`、最终 DMG、装配 runner、EULA 输入、卷图标、开始结束时间和实际系统命令；不得继承被替代 Tauri DMG 或旧 repack 报告的 hash。
7. 不更改 SVG 母版、PNG/ICO/ICNS、ICNS 槽位、应用内容、最低系统版本或 25000000B 预算；不新增运行时依赖；不签名、不公证。
  ※ 2026-09-18 注记：本条"预算"所指 25MB 已被 ADR 0006 v1.2.0 修订为 100MB（ADR 0018 MCP 运行时对齐）；本 ADR 的 ULMO 压缩决策不受影响。

## Consequences

### Positive

- 保留完整已批准图标和 DMG 安装体验，同时恢复约 711KB 的预算余量。
- 只改变磁盘镜像容器压缩；应用二进制、资源、文件关联和 EULA 内容不变。
- 使用 macOS 自带 `hdiutil`，不引入第三方生产依赖。
- 移除 Finder 会话、桌面活动和无上限 `.DS_Store` 轮询对发布构建的影响。

### Negative

- ULMO 不能在 macOS 10.15 之前使用，也不支持内核直接挂载；这不影响本项目 macOS 11.0+ 的 Finder/DiskImages helper 安装路径。
- 发布 runner 需要维护 app-only build、DMG staging、EULA resource 与装配证据；Tauri 升级时须重新确认 app target 和 bundle identity，但不再依赖其 Finder DMG 美化脚本。
- DMG 使用系统默认 Finder 展示，不保证自定义窗口尺寸和图标坐标；应用、Applications 链接、卷图标和 EULA 保持为验收项。
- `hdiutil convert` 的容器 SHA-256 不保证跨次相同；发布证据仍按本轮最终 artifact hash 绑定，而不是假设可复现 DMG 字节。

## Validation

PRR-069 已验证 ULMO；PRR-069C 已实现确定性装配 runner（`scripts/quality/assemble-dmg.mjs`：udrw → 卷图标属性 → ULMO → `udifrez` 注入根 LICENSE 生成的挂载前 EULA → 只读挂载复核），正式命令为 `tauri build --bundles app` + 受控装配，三轮真实预检全部通过，现等待独立审阅。PRR-069C 必须至少连续三次在不调用 Finder/AppleScript、没有 `.DS_Store` 输入的情况下完成 app-only build → DMG，并验证超时/失败分支。之后从新的 clean source 完整重跑 PRR-070。PRR-070 必须验证最终 DMG 格式、预算、EULA、Applications 链接、卷图标、只读挂载 payload identity 和时间拓扑；任何失败均按原 STOP 规则中止。
