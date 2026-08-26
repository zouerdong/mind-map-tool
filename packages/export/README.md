# Export

确定性导出包：共享文本布局契约、`ExportScene`、canonical 语义 SVG，以及获选 renderer（**web-ts-wasm**，G1 2026-08-26 批准）对 2x PNG 与 PDF 的完整实现。

边界约定：

- 消费 `@mindmap/core` 的 document，**不读取 React DOM**，不依赖画布库。
- 布局契约（font token、显式换行、line-height、padding、baseline、node size 权威）由本包唯一实现，UI 复用同一 `layoutText`。
- 空文档返回 `EXPORT_EMPTY_DOCUMENT`；超上限返回 `EXPORT_SIZE_LIMIT`，在分配大内存前拒绝。
- golden 分层：canonical SVG hash（跨平台一致）+ 固定 renderer/font 的像素/PDF golden（`tests/golden/export/**`，MM-040 建立）。
- Spike 已验证的工程约束：resvg-wasm 必须 `fontBuffers`（字节）；pdf-lib 每文档重新内嵌字体并注册 `@pdf-lib/fontkit`。
