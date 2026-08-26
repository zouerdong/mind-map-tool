# V1 质量门（G0 / G1 / G2）

> 状态：MM-000 建立的门槛定义。G0 已由项目负责人于 2026-08-26 批准；G1/G2 保持 pending。
> 机器可读登记：`docs/decisions/decision-register.json`；本文件是可读说明，冲突时以 JSON 登记为准。

## 1. Gate 定义

### G0｜Spike 授权（已批准 2026-08-26）

- **批准人**：ErDong Zou（项目负责人）
- **批准内容**：本地 Spike 实验授权；macOS 设备 Apple M4 / 24 GB / macOS 26.6.2 / arm64；Windows 设备待登记（登记前 MM-010 双平台聚合保持 BLOCKED）；实验红线见下。
- **红线**：候选依赖只存在于 `scripts/runtime-spike/**`；不发布、不改 CI/CD、不访问凭据、不签名/公证、不安装正式产品依赖、不上传远端。
- **不包含**：正式技术选型、产品实现、发布。

### G1｜Bootstrap 前（pending）

进入 MM-020 前必须满足：

1. Spike 顶层与四轨（desktopHost/canvasView/exportRenderer/font）全部 `recommendation-ready`，每轨推荐引用 PASS 候选与证据。
2. 项目负责人逐轨批准 approved value，并确认：schema v1、最低平台/CPU、性能预算、产品标识与扩展名、React Flow attribution（如适用）、PDF/背景策略、尺寸上限。
3. 对应 ADR（0001–0006 相关轨）转 Accepted，`acceptedAdr {id, version, sha256}` 与当前 ADR bytes 一致。
4. `G1.sourceSpikeResult {path, sha256, generatedAt}` 绑定不可变 Spike snapshot；任何漂移使 G1 失效并重新审签。
5. `verify-decision.mjs --phase bootstrap` 通过。

### G2｜发布准备前（pending）

进入 MM-100 前必须满足：许可证/商业授权法律文本完成审阅；安装器选定；G2 `approvedScope` 精确列出 selected host、候选包路径、安装目标、允许动作与删除边界；`verify-decision.mjs --phase packaging` 通过。test-signing、签名、公证、凭据、系统信任、上传、公开发布各自需要新的明确授权。

## 2. 性能预算（Proposed，待 Spike 校准后由 G1 固化）

| 指标 | 建议目标（P95） | 测量方式 |
| --- | ---: | --- |
| 冷启动至可交互空白画布 | ≤ 1.5 s | 发布构建、本地 SSD、各 20 次，排除首次 WebView 安装 |
| 热启动/已安装 WebView | ≤ 0.8 s | 各 20 次 |
| 空白文档空闲 RSS | ≤ 120 MB | 窗口稳定 30 s 后采样 |
| 300/450 拖动与缩放帧时间 | ≤ 32 ms | 固定合成数据 `dense-300-450` |
| 高风险编辑命令 | ≤ 50 ms | create/move/connect/undo 自动基准 |
| 原生文件保存（标准规模） | ≤ 200 ms | 本地 SSD，20 次 |
| 2x PNG 导出（标准规模） | ≤ 3 s | 固定字体、固定 scene bounds |
| 安装包体积 | Tauri 每平台 ≤ 25 MB；Electron 对照实测 | 签名/未签名分别记录，不混比格式 |

预算不得由实现 Agent 放宽；不达标 = 候选 FAIL 或性能修复卡。

## 3. 发布候选质量门槛（MM-090 消费）

发布候选必须同时具备证据：core 单元测试、模块集成测试、桌面 E2E（E2E-01～E2E-14）、macOS/Windows 人工矩阵、双平台性能预算达标、三格式导出 golden（语义/视觉/PDF 双 viewer）、安装/文件关联验证。任何一项缺证据都不是"已完成"。质量入口脚本由 MM-020 创建：`run-all.mjs`、`run-export-golden.mjs`、`run-performance.mjs`、`check-boundaries.mjs`、`scan-dependency-licenses.mjs`、`scan-network-endpoints.mjs`、`run-e2e-macos.sh` / `run-e2e-windows.ps1`。

## 4. 双平台证据规则

- 每项验收（AC-01～AC-14）与性能数据都需要 macOS、Windows 各一份真实设备报告 + 一份聚合报告；缺任一平台返回 BLOCKED（R-013）。
- 报告必须记录 OS build、CPU、内存、WebView 版本、应用 commit、构建类型、脚本版本与证据路径。
- 不允许用 mock、单平台推断或更新 golden 冒充通过。
