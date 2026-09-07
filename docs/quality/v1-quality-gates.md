# V1 质量门（G0 / G1 / G2）

> 状态：G0 与 G1 已由项目负责人于 2026-08-26 批准；G2 保持 pending。v1 权威发布平台为 macOS Apple Silicon，Windows 为后续专门版本（移植就绪约束见 PRD §1.1）。
> 机器可读登记：`docs/decisions/decision-register.json`；本文件是可读说明，冲突时以 JSON 登记为准。

## 1. Gate 定义

### G0｜Spike 授权（已批准 2026-08-26）

- **批准人**：ErDong Zou（项目负责人）
- **批准内容**：本地 Spike 实验授权；macOS 设备 Apple M4 / 24 GB / macOS 26.6.2 / arm64；Windows 设备记录为 no-device-currently（实验红线见下）。
- **红线**：候选依赖只存在于 `scripts/runtime-spike/**`；不发布、不改 CI/CD、不访问凭据、不签名/公证、不安装正式产品依赖、不上传远端。
- **不包含**：正式技术选型、产品实现、发布。

### G1｜Bootstrap 前（已批准 2026-08-26）

- **批准人**：ErDong Zou（项目负责人）
- **批准内容**：
  1. 四轨选型批准：desktopHost=tauri, canvasView=react-flow, exportRenderer=web-ts-wasm, font=noto-sans-sc-regular + lxgw-wenkai-regular。
  2. 平台范围变更：v1 仅发布 macOS（Apple Silicon）；Windows 顺延至后续专门版本，不属于 v1 验收。保留平台无关架构与移植就绪约束（PRD §1.1）。
  3. 对应 ADR 0001～0006 转 Accepted 1.0.0。
  4. `G1.sourceSpikeResult` 绑定不可变 Spike snapshot。

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

发布候选必须同时具备证据：core 单元测试、模块集成测试、桌面 E2E（E2E-01～E2E-14）、macOS 人工矩阵、macOS 原生性能预算达标、三格式导出 golden（语义/视觉/PDF 双 viewer）、安装/文件关联验证。Windows 原生验收顺延至后续专门版本。质量入口脚本由 MM-020 创建并由 PRC 批次演进：`run-all.mjs`、`run-export-golden.mjs`、`run-performance.mjs`、`check-boundaries.mjs`、`scan-dependency-licenses.mjs`、`scan-network-endpoints.mjs`、`run-e2e-macos.sh`。

## 4. 平台证据规则

- **v1 必需平台（requiredPlatforms）**：`macos`（Apple Silicon）。必须有真实设备完整运行报告（AC-01～AC-14 适用范围、性能与安装/生命周期），报告状态必须为 `verified`。
- **顺延平台（deferredPlatforms）**：`windows`。作为后续专门版本，明确不属于 v1 验收范围。在证据清单中明确显示为 `deferred/not-run`，并附带引用 `docs/product/v1-product-spec.md`。不影响本次 v1 的 `READY` 判定，也不得冒充为通过。
- 报告必须记录 OS build、CPU、内存、WebView 版本、应用 commit、构建类型、脚本版本与证据路径。
- 不允许用 mock、假证据或更新 golden 冒充通过。
