# ADR 0001: 桌面 Host 选型

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-08-26
- Owners: Project maintainers
- Track: desktopHost（exit criteria 版本 host-v1）

## Context

第一版要求 macOS/Windows 双平台轻量本地桌面应用：原生文件关联、原子安全保存、单实例多窗口、启动/文件打开事件路由、无服务器后端。候选必须使用同一硬件、同一合成图、同一脚本在双平台实测；任何数据安全或文件入口阻断项直接淘汰，最高分不自动胜出。

## Decision Drivers

- 跨平台行为一致性与维护复杂度：25
- 安装器/文件打开事件完整度：20
- 包体/RSS/启动：20
- 文件安全与自动化可测性：20
- 实现与长期维护成本：15

## Considered Options

1. **Tauri 2**：使用系统 WebView（macOS WKWebView / Windows WebView2），不捆绑浏览器引擎；Rust host 适合原子文件写入与 resvg；提供 `fileAssociations`、RunEvent 与 single-instance 插件。风险：双 WebView 差异、Rust/TS 双栈、Windows WebView2 bootstrap。
2. **Electron**：捆绑 Chromium，运行时一致、生态成熟；多进程与体积使其与"轻量"冲突，但若体积在用户预算内且显著降低缺陷，应胜出。
3. **Flutter**：Rejected for v1——需要一套不可与 TS 方案复用的 Dart core/UI/export/tooling 分支，首版交付面显著扩大。
4. **Neutralino**：Rejected——macOS/Windows 安装器官方链不完整，可靠大众分发风险过高。

## Decision

Proposed **Tauri 2**。仅在双平台 Spike 按上述矩阵评分、exit criteria 全部 PASS 且项目负责人于 G1 批准后转 Accepted；Electron 是完整的降级分支（同一 TS core/UI/export 可迁移），不是次要选项。两轨全 FAIL 时本轨与顶层 `blocked`，不得选分数最高的失败项。

## Consequences

### Positive

- 预期包体小（建议预算每平台 ≤ 25 MB，待 Spike 校准）；Rust host 承担 fsync/ReplaceFile 级安全提交。

### Negative

- 若获选：维护 Rust IPC、WebView2 bootstrap 策略与两套系统事件语义；WKWebView/WebView2 差异需双平台 golden 与人工矩阵覆盖。
- 若降级 Electron：接受较大包体/RSS，换取消除 WebView 差异。

## Spike 记录（2026-08-26，macOS 腿；Windows 腿未测，R-013）

- Tauri 2：release 冷启动 p50 **362 ms**；主进程 RSS **112 MB**；二进制 **8 MB**；native resvg 导出 21 ms/89.7 KB。
- Electron 33：冷启动 p50 **296 ms**（略快）；进程树 RSS **139 MB**；框架磁盘 **233 MB**；native printToPDF 323 ms。
- 解读：Tauri 优势集中在分发体积（29 倍差距）与内存（约 -20%）；启动/内存两者均远优于预算。RSS 预算 120 MB 对两者都紧，需真实页面 MM-090 复测。
- 平台范围：[from-user] 2026-08-26 G1 决定 v1 = macOS 先行（Windows 为后续专门版本，附移植就绪约束），macOS 证据因此构成完整验收基础；Electron 数据保留为降级参考。

## Validation

MM-010 双平台 Spike（cold/warm 启动、RSS、包体、文件打开、中文/空格路径、IME、DPI）；评分表与原始证据进入 `runtime-spike-decision.json`；G1 由项目负责人批准并绑定本 ADR 版本与 hash。

## G1 批准记录

- **批准人**：ErDong Zou（项目负责人），2026-08-26，基于 macOS Spike 证据（`docs/quality/runtime-spike-decision.json`）。
- **批准决定**：Tauri 2（macOS 先行，Windows 移植就绪约束）
- **绑定**：本版本（1.0.0）内容 hash 已登记于 `docs/decisions/decision-register.json` G1.acceptedAdr；批准后任何内容漂移使 G1 失效并需重新审签。
