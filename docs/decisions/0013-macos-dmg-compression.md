# ADR 0013: macOS DMG 使用 ULMO 压缩

- Status: Accepted
- ADR-Version: 1.0.0
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

## Decision

1. macOS 0.1.0 的最终 unsigned DMG 使用 `ULMO`（UDIF LZMA）压缩；不得修改 25000000B installer 预算。
2. 继续让 Tauri 构建标准 unsigned `.app` 与带 EULA/卷图标的 DMG，再由受控发布 runner 在 inventory 计算前把本轮唯一 DMG 转换为 ULMO。最终 inventory、后续挂载、性能和 G-FINAL 只绑定转换后的 DMG。
3. 转换必须 fail-closed：输入必须是本轮刚刷新的已批准路径；输出只可暂存于同一候选目录；转换、格式复核、CRC32 或原子替换任一步失败时，不得保留 PASS inventory。
4. 转换后必须用 `hdiutil imageinfo` 证明 `Format=ULMO`，用 `hdiutil verify` 证明镜像有效，并通过只读挂载复算 EULA、`.app` 目录级 hash、bundle identity 与卷图标 hash。
5. 不更改 SVG 母版、PNG/ICO/ICNS、ICNS 槽位、应用内容或最低系统版本；不新增运行时依赖；不签名、不公证。

## Consequences

### Positive

- 保留完整已批准图标和 DMG 安装体验，同时恢复约 711KB 的预算余量。
- 只改变磁盘镜像容器压缩；应用二进制、资源、文件关联和 EULA 内容不变。
- 使用 macOS 自带 `hdiutil`，不引入第三方生产依赖。

### Negative

- ULMO 不能在 macOS 10.15 之前使用，也不支持内核直接挂载；这不影响本项目 macOS 11.0+ 的 Finder/DiskImages helper 安装路径。
- Tauri 2.11.4 配置 schema 不暴露 DMG compression format，因此发布 runner 需要一个显式、可测试的同轮转换步骤。
- `hdiutil convert` 的容器 SHA-256 不保证跨次相同；发布证据仍按本轮最终 artifact hash 绑定，而不是假设可复现 DMG 字节。

## Validation

由 PRR-069 先实现和独立审阅 ULMO runner，再从新的 clean source 完整重跑 PRR-070。PRR-070 必须验证最终 DMG 格式、预算、EULA、只读挂载 payload identity 和时间拓扑；任何失败均按原 STOP 规则中止。
