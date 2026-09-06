# VRA-010 视觉与动效隔离原型

`reference-prototype.html`：自包含单文件（无外部依赖、无构建、不读取本地文件），用浏览器直接打开。数据为内嵌合成夹具（`tests/fixtures/visual/` 的同源拷贝）。

用途：G-VIS 校准材料——同一参考方向的完整状态矩阵（暖白/黑板 × 14 状态）与 800ms 整理动效（打断/undo/reduced-motion/关键帧步进）。

边界：
- 浏览器隔离原型，**不是生产 React Flow 实现**；通过 ≠ 产品通过（生产由 VRA-050/060/080 取证）。
- 字体用系统中文栈近似（PingFang/冬青等），生产为 Noto Sans SC / LXGW WenKai（FontResolver 同源测量）。
- kicker/强调/线型来自 `reference-dag-12.visual.json` 过渡标注（schema 字段待 G-SCHEMA）。
- 打开方式：`open tests/visual-prototype/reference-prototype.html`（或拖入浏览器）。建议 100% 缩放。
