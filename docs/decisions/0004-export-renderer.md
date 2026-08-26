# ADR 0004: 导出 Renderer Owner 选型

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-08-26
- Owners: Project maintainers
- Track: exportRenderer（exit criteria 版本 export-renderer-v1）

## Context

导出必须从同一 canonical document 产出语义 SVG、2x PNG、PDF 三格式，内容/几何一致，不使用 DOM 截图。管线：`document → validate → 共享文本布局 → ExportScene → canonical SVG → 获选 renderer → PNG/PDF`。renderer owner 必须唯一，不允许双实现或"顺手实现"的模糊状态。

## Decision Drivers

- 三格式内容/几何一致性（同一 scene）
- 中文字体渲染质量与缺 glyph 行为
- 内存可控（超大画布前置拒绝，不 OOM 后失败）
- 许可与包体
- owner 边界清晰（IPC/native 依赖 vs 纯 TS）

## Considered Options

1. **web-ts-wasm（TS/WASM 完整 renderer）**：默认优先。`packages/export/` 唯一拥有 SVG/PNG/PDF；host 只执行 `commitExport` 落盘。无需额外 native IPC；代价是 WASM 依赖体积与中文字体/PDF 能力待实测。
2. **native-host（native renderer）**：获选 host 的 native 侧（Tauri Rust / Electron main）做 SVG→PNG/PDF 转换；TS 侧只定义 renderer port。质量/内存潜力好，代价是互斥的 MM-045 专卡、native 依赖与 IPC 面。
3. DOM 截图（`html-to-image` 类）：无语义、不稳定，Rejected——不作为主链。

## Decision

Proposed **web-ts-wasm 为默认分支**。Spike 双轨独立比较 SVG/2x PNG/PDF 质量、中文字体、locale/timezone/DPI、内存与 owner 成本；只有默认轨 FAIL 且 native 轨 PASS 时，G1 才选 native 并激活互斥的 MM-045（串行在 MM-060 后）。两轨全 FAIL 时本轨与顶层 `blocked`，推荐 `null`。

约束：scene 与 serializer 是纯函数，固定属性顺序/数值精度/层级/padding/font token；SVG 只用 `<rect>`、`<text>/<tspan>`、`<path>`，无 `foreignObject`；同 canonical 输入 SVG bytes/hash 稳定；空文档返回 `EXPORT_EMPTY_DOCUMENT`；超限返回 `EXPORT_SIZE_LIMIT` 并建议缩小或改用 SVG；2x 定义为 scene CSS 宽高 ×2，分配前检查单边/总像素/内存上限。两分支互斥，`exportPng` 之类半契约不得残留。

## Consequences

### Positive

- 默认分支无 native IPC 面，owner 唯一；golden 分层（canonical SVG hash 跨平台一致 + 固定 renderer/font 的像素/PDF golden）。

### Negative

- 若选 native：MM-045 串行执行、native 依赖许可扫描、双平台 failure injection 成本；若 WASM 体积/质量不过关需走降级。

## Spike 记录（2026-08-26，macOS 腿）

- TS/WASM 腿：SVG 8/8 夹具确定性 + TZ/LANG 不敏感；PNG 7/8 通过（large-bounds 正确拒绝 EXPORT_SIZE_LIMIT）；PDF 8/8 确定性（pdf-lib 需每文档重嵌字体 + 注册 @pdf-lib/fontkit）。中文渲染经像素级验证。
- native 腿：Tauri/Rust resvg 0.45 PNG 46 ms/89.7 KB ✓；native PDF（Rust）not-tested（需额外栈，仅 native-host 获选时评估）；Electron printToPDF 见 electron-metrics.json。
- 已知工程坑（实现期必守）：resvg-wasm 用 `fontBuffers` 而非 `fontFiles`；pdf-lib 字体对象不跨文档复用。
- G1 决定（2026-08-26 [from-user]）：选 web-ts-wasm；MM-045 条件卡 NOT_ACTIVATED。

## Validation

MM-010 renderer 轨评分；MM-040 golden 三层断言（语义/视觉/PDF 双 viewer）；`run-export-golden.mjs`；G1 批准绑定本 ADR。

## G1 批准记录

- **批准人**：ErDong Zou（项目负责人），2026-08-26，基于 macOS Spike 证据（`docs/quality/runtime-spike-decision.json`）。
- **批准决定**：web-ts-wasm（packages/export 唯一拥有三格式；MM-045 不激活）
- **绑定**：本版本（1.0.0）内容 hash 已登记于 `docs/decisions/decision-register.json` G1.acceptedAdr；批准后任何内容漂移使 G1 失效并需重新审签。
