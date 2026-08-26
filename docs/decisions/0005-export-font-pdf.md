# ADR 0005: 导出字体与 PDF 策略

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-08-26
- Owners: Project maintainers
- Track: font（Spike 四轨之一）+ PDF 策略

## Context

导出与 UI 排版共用同一布局契约：固定 font token、font size/weight、line-height、padding、baseline；换行只认显式 `\n`，不做 DOM 宽度隐式重排。中文字体必须有可再分发/嵌入许可、CJK 覆盖完整、缺 glyph 行为明确；node `size` 是持久化权威，不被 renderer 重新测量覆盖。字体轨是必需轨——无合格字体候选时整轨 `blocked`，不得填占位 fontToken。

## Decision Drivers

- 再分发/嵌入许可明确（含导出物内嵌）
- CJK 覆盖与缺 glyph 行为
- 包体代价（整包 vs 子集化）
- PDF 单页/分页、页面尺寸、字体嵌入策略
- 跨 viewer 内容/几何容差

## Considered Options

（字体候选由 MM-010 评估至少一个；以下为策略选项，候选名单在 Spike 报告中固化）

1. **随应用打包完整 CJK 字体**：覆盖可靠，包体代价大（CJK 字体常见 5–20 MB）。
2. **导出时子集化嵌入**：包体小，子集化管线复杂、缺 glyph 风险转移。
3. **系统字体 fallback**：许可干净但跨平台渲染不可控、canonical hash 不稳定，Rejected as 主链（仅可作为显式 fallback 顺序记录）。

PDF 策略选项：

1. **单页适合内容**（默认提案）：一页容纳全部内容边界 + 固定留白；实现简单、与 PNG 语义对齐。
2. **分页**：支持超大画布打印；页数/MediaBox/分页规则复杂度高。

## Decision

Proposed：**固定 font token + 随包字体（候选待 Spike）+ PDF 单页适合内容 + 缺 glyph 显式警告/替代 + 超限前置拒绝**。首版排版参数固定（单一 font size/weight、固定 line-height/padding/baseline）；fallback 顺序与包体代价在 Spike 报告量化后由 G1 确认。字体候选必须附许可链接、CJK corpus 覆盖报告、缺 glyph 测试与包体数据。

## Consequences

### Positive

- UI 与 exporter 共享 `layoutText`，node size 单一权威；SVG/PNG/PDF 同源同布局。

### Negative

- 字体增加包体；子集化若被选中需额外管线；PDF 分页需求出现时须新 ADR。

## Spike 记录（2026-08-26，macOS 腿）

- **Noto Sans SC（SubsetOTF，OFL 1.1，7.9 MB）**：语料覆盖 100%，PUA 缺字行为正确，SVG/PNG/PDF 全链路验证通过——PASS 候选。
- LXGW WenKai（OFL，23.6 MB）：覆盖 100%，手写风格备选（视觉方向属停点C/G1 用户偏好）。
- Source Han Sans：与 Noto SC 同源设计，subset 分发路径失效未重复测。MiSans：非 OFL + 全字重包 217 MB，不做首选。
- PDF 策略：pdf-lib 单页适合内容已验证确定性 bytes；分页未实现（维持默认提案）。
- Windows WebView2 字体行为：顺延至 Windows 专门版本。

## Validation

MM-010 字体轨（许可/覆盖/缺 glyph/包体）；MM-040 golden：`chinese-multiline`、`missing-glyph`、`dark-theme` 夹具 + PDF 双 viewer 容差；`TZ/LANG/DPI` 变化下 canonical SVG hash 不变。

## G1 批准记录

- **批准人**：ErDong Zou（项目负责人），2026-08-26，基于 macOS Spike 证据（`docs/quality/runtime-spike-decision.json`）。
- **批准决定**：Noto Sans SC 基础 + LXGW WenKai 手写可选；PDF 单页适合内容
- **绑定**：本版本（1.0.0）内容 hash 已登记于 `docs/decisions/decision-register.json` G1.acceptedAdr；批准后任何内容漂移使 G1 失效并需重新审签。
