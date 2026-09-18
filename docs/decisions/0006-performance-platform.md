# ADR 0006: 性能预算与平台覆盖矩阵

- Status: Accepted
- ADR-Version: 1.2.0
- Date: 2026-08-26
- Revised: 2026-09-09（cold 协议按 [from-user] G-PERF-PROTOCOL（PRR-067 v3）批准修订为双指标；见"G1 批准记录"末段与 decision-register）
- Revised: 2026-09-18（v1.2.0 安装包预算 25MB → 100MB，负责人批准；见文末"修订记录"）
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
| 冷启动至可交互空白画布（conditioned cold p95） | ≤ 1.5 s（一次成功 conditioning 之后的 20 个全新隔离 HOME cold 样本；见"测量协议"） |
| 热启动/已安装 WebView | ≤ 0.8 s |
| 空白文档空闲 RSS | ≤ 120 MB |
| 300 节点/450 连接拖动与缩放帧时间 | ≤ 32 ms |
| 高风险编辑命令（create/move/connect/undo） | ≤ 50 ms |
| 原生文件保存（标准规模） | ≤ 200 ms |
| 2x PNG 导出（标准规模） | ≤ 3 s |
| 安装包/下载体积 | Tauri 每平台 ≤ 100 MB（v1.2.0 修订；原 ≤25MB 因 ADR 0018 而废止，见文末）；Electron 对照实测，不混比格式 |

Proposed 平台矩阵基线：macOS Apple Silicon 必测（Intel 是否覆盖待用户确认）；Windows x64 必测（ARM64 是否覆盖待用户确认）；系统缩放 100%/150%/200%；中文 IME；WebView2 已有/缺失/旧版本三种状态。

测量协议（v1.1.0，cold 部分为双指标）：

- **conditioning（协议先导，恰好一次）**：release cold 采样开始前，对同一候选路径执行恰好一次 conditioning 启动——一次性隔离 HOME（采样后删除），走完整 `renderer-ready` + 进程真实退出（与 measured 样本相同校验）。单独保存为 `cold-conditioning.json` 独立 artifact，必须绑定完整 source/candidate/runner SHA-256；**conditioning 失败则整轮采样判 INCOMPLETE**：不得补跑、不得挑样、不得将重试样本与旧轮混样（重试=新一轮，旧轮整体作废并保留）；conditioning 不计入 20 个 cold 样本，不参与任何 percentile。
- **指标一 `sessionFirstLaunchMs`（记录型，无硬预算）**：conditioning 启动本身的耗时（`renderer-ready` 完成点，与 measured 样本同一计时口径），必须完整记录与展示——写入 `cold-conditioning.json`、performance summary、native report 与 G-FINAL request；v0.1.0 不设 PASS/FAIL 预算，后续版本可依据积累数据再议。
- **指标二 `conditionedColdStartP95Ms`（判定指标）**：一次成功 conditioning 之后，20 个 cold 样本（每样本互不相同的全新隔离 HOME；不丢样、不挑样），沿用 estimator `sorted[floor(n×0.95)]`，≤ 1500ms。
- 各 20 次、热启动 warm p95 ≤ 800ms、本地 SSD、发布或接近发布构建、固定合成数据；报告含设备与脚本版本。warm/RSS/canvas/edit/save/PNG/DMG 预算与 `renderer-ready` 完成点不变。

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

## G-PERF-PROTOCOL 重审签记录（2026-09-09，v1.1.0）

- **批准人**：ErDong Zou（项目负责人），2026-09-09，批准对象：PRR-067 v3 决策包（`g-perf-protocol-request.md` SHA-256 `b88850e82a2f6b7962a5e7ac581d806d140bf56dbafcc2a0cc7514d9ff5ba85b`；JSON `ac4ea609b0e85369478d591da43b3ff25f219b11be3e4432722260e84894f21c`）。
- **批准决定**：cold 协议修订为双指标（`sessionFirstLaunchMs` 记录型 + `conditionedColdStartP95Ms` ≤1500ms，见上方测量协议）；warm p95 ≤800ms、各 20 样本、`renderer-ready` 完成点、estimator 与其余预算不变；授权修改 ADR/register/runner/verifier/schema/测试/文档。
- **依据**：PRR-067 阶段 A 归因 `MEASUREMENT_BOUNDARY_CONFIRMED`（离群成本位于 exec→main 边界，应用分段稳定；新路径首启与系统重启后首启均可能出现；具体 macOS 子系统不可确定），经 PRR-067A-v3 决策包+独立审阅。
- **绑定**：本版本（1.1.0）内容 hash 已登记于 `docs/decisions/decision-register.json` G1.performanceProtocol；批准后任何内容漂移使本记录失效并需重新审签。

## 修订记录

### v1.2.0（2026-09-18，负责人批准）

**安装包预算 25MB → 100MB**。ADR 0018 批准的 MCP 独立运行时（pinned Node 24 +
esbuild 单文件内嵌资产）随安装包分发，使 macOS ULMO DMG 实测达 75,268,912B
（v0.3.0 候选 f611a1e），与原 25MB 预算直接冲突。ADR 0018 决策时已明示代价
（"安装包体积增加约 50MB"），本修订是对该既定决策的预算对齐：新预算 100MB
（实测基线 75.3MB + 约 25MB 余量）。其余全部预算指标不变；发布前如逼近新预算
须重新评估 MCP 运行时瘦身（如 Node 精简构建）。
