# PRR-070 阶段 A DMG 体积失败独立审阅

日期：2026-09-10  
结论：`REJECT / BLOCKED_CORRECTLY / NOT_READY_TO_RELEASE`  
source：`58003c0351bdb53f1b2009c7c377e3410782b12c`

## 结论

执行 Agent 没有完成 PRR-070，但在步骤 5 命中硬预算后正确执行了 STOP。新 DMG 为 25153239B，超过 25000000B 上限 153239B；步骤 6～11 未执行、G-FINAL 未申请、PRR-080 未开始，均是正确行为。当前候选及其证据只作为失败记录保留，不得继续补测或用于发布。

没有发现 tracked source、测试、runner、配置或文档被 PRR-070 现场修改；审阅结束时 HEAD 仍为 `58003c0` 且 worktree clean。步骤 1～4 的源码门、advisory、same-run bundle 和产物身份结论可信，但不能抵消 DMG 红灯。

## 独立复算

- 最终 DMG：25153239B，SHA-256 `ff9c565efd36ea9be9b3b835fec73381a6f9f8b5613b56e59474e94ce4a12b78`；`hdiutil verify` 再次返回 CRC32 VALID。
- `.app` 目录级 SHA-256：`cfa414c8dc41e3d2a16009b816f6ae2e0a364528dcfe267b549e0e85569c5b20`，与 inventory 一致。
- `bundle-gate.mjs` SHA-256：`91b2bfb7d6f6117c0367b2fcb373617f02089c581efe3d98abfc53c20eb2b24c`，与 inventory 一致。
- app 内 ICNS 与 DMG `.VolumeIcon.icns` 均为 307255B；新 ICNS 相对旧候选净增 298802B，两份净增 597604B。DMG 相对旧 `ea047e8` 候选增长 602369B，残差 4765B，归因闭合。
- 17 项源码门全部 exit 0，initial entry 486089B；JS advisory 为 0 vulnerabilities，局部 `cargo-audit 0.22.2` 为 0 vulnerabilities、7 条 warning。

## 审阅发现

### P1：最终 DMG 超过固定发布预算

这是真实产物失败，不是报告或十进制/二进制单位误差。不得提高预算、继续性能矩阵或把新图标回退为旧占位。

处置：采纳 [ADR 0013](../decisions/0013-macos-dmg-compression.md)，先执行 [PRR-069](../planning/prr-069-dmg-compression-remediation-task-card-2026-09-10.md)。同一镜像的 ULMO 只读转换实验得到 24288652B，余量 711348B；CRC32、EULA、`.app` hash、bundle id 和卷图标 hash 均保持。

### P2：source freeze 的 UTC 时间戳不成立

`step1-source-freeze.json` 把 `recordedAt` 写为 `2026-09-10T08:45:00Z`，但源码门在约 `01:58Z` 开始、bundle 在约 `02:08Z` 开始、阻塞报告在约 `02:20Z` 生成。该值显然把本地时间误标为 UTC，无法证明“先冻结、后执行”的时间拓扑。

处置：失败证据保持原样，不回写美化。下一轮所有 UTC 必须由程序或 `date -u` 生成，并在步骤 2 后立即断言 `sourceFreeze.recordedAt <= firstGate.startedAt <= lastGate.finishedAt`；不满足即 STOP。

## 压缩路线独立实验

在 `/tmp` 对失败 DMG 只读试验，不修改候选：UDBZ 为 25113265B、ULFO 为 25309565B，均仍超预算；ULMO 为 24288652B。ULMO 在相同输入上两次转换大小一致但 SHA-256 不同，因此后续协议只绑定本轮最终 artifact hash，不新增“DMG 跨轮 bit-for-bit 可复现”的虚假要求。

128/256 色调色板量化会在深靛背景和白色中心产生可见带状纹理；删除 ICNS 高分辨率槽位也会降低图标完整性。两条路线均拒绝。Tauri 2.11.4 的 `DmgConfig` 不暴露 compression format，故使用受控 runner 后转换，而不修改视觉资产或 fork bundler。

## 下一步

只派发 PRR-069。执行 Agent完成后停在 `STOP_FOR_INDEPENDENT_REVIEW`，不得直接重跑 PRR-070。PRR-069 通过独立审阅后，再从包含 runner、ADR、任务状态和审阅记录的全新 clean HEAD 执行 PRR-070 步骤 1～11；历史候选、转换实验和 raw evidence 均不得复用。
