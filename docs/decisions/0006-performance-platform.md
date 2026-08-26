# ADR 0006: 性能预算与平台覆盖矩阵

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-08-26
- Owners: Project maintainers
- Track: 性能/平台基线（G1 批准后才成为约束性预算）

## Context

"轻量"是核心产品承诺，但不得以开发机单次观感代替实测。预算必须由双平台 Spike 在代表性设备上校准，再由 G1 批准为约束值；所有测量必须记录硬件、OS、CPU 架构、WebView 状态与构建类型。当前本仓库已确认的 macOS Spike 设备：Apple M4 / 24 GB / macOS 26.6.2 / arm64；Windows 设备待项目负责人登记。

## Decision Drivers

- 冷/热启动与交互流畅度直接定义"轻量"体感
- 包体决定分发与下载体验
- 最低平台矩阵决定测试与打包范围，过度扩面增加长期成本

## Considered Options

（预算值为 PRD §9 建议基线，Spike 校准后由 G1 固化；平台矩阵选项待设备登记）

## Decision

Proposed 预算基线（P95，双平台各自达标）：

| 指标 | 建议目标 |
| --- | ---: |
| 冷启动至可交互空白画布 | ≤ 1.5 s（排除首次 WebView 安装） |
| 热启动/已安装 WebView | ≤ 0.8 s |
| 空白文档空闲 RSS | ≤ 120 MB |
| 300 节点/450 连接拖动与缩放帧时间 | ≤ 32 ms |
| 高风险编辑命令（create/move/connect/undo） | ≤ 50 ms |
| 原生文件保存（标准规模） | ≤ 200 ms |
| 2x PNG 导出（标准规模） | ≤ 3 s |
| 安装包/下载体积 | Tauri 每平台 ≤ 25 MB；Electron 对照实测，不混比格式 |

Proposed 平台矩阵基线：macOS Apple Silicon 必测（Intel 是否覆盖待用户确认）；Windows x64 必测（ARM64 是否覆盖待用户确认）；系统缩放 100%/150%/200%；中文 IME；WebView2 已有/缺失/旧版本三种状态。

测量协议：各 20 次、本地 SSD、发布或接近发布构建、固定合成数据；报告含设备与脚本版本。

## Consequences

### Positive

- "轻量"成为可验收数字而非口号；双平台数据驱动 host/renderer 选型。

### Negative

- 未达预算时候选 FAIL 或需开性能修复卡；预算本身不得由实现 Agent 放宽。

## Validation

MM-010 Spike 建立基线 → G1 批准 → MM-050/MM-090 用 `run-performance.mjs --fixture dense-300-450` 双平台出证；`docs/quality/evidence/mm-*-performance-*.json` + 聚合报告。

## G1 批准记录

- **批准人**：ErDong Zou（项目负责人），2026-08-26，基于 macOS Spike 证据（`docs/quality/runtime-spike-decision.json`）。
- **批准决定**：macOS 实测校准预算；v1 平台 = macOS Apple Silicon
- **绑定**：本版本（1.0.0）内容 hash 已登记于 `docs/decisions/decision-register.json` G1.acceptedAdr；批准后任何内容漂移使 G1 失效并需重新审签。
