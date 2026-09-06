# VRA-040：UI 与三格式导出的共同绘制契约（交付记录）

日期：2026-09-06。执行依据：[VRA-040 卡](../plans/visual-alignment-task-cards-2026-09-06.md)；G-VIS 定稿 tokens §1.1–1.5；ADR 0010。状态：**完成**（实现 Agent + 主会话验收）。

## 交付

- **`packages/export/src/visual-style.ts`**（新）：唯一视觉事实源——暖白/黑板双主题 palette（与 tokens §1.1/§1.2 逐值一致：`#F9F8F4/#141412/#F5F2EA/#A8A296/#D97757/#331708/#6B3A22/#4A4640/#8A8478`）、普通/强调角色、眉题+正文两层排版（11px/16px）、圆角 12/内距 16/12；`measureNodeVisual` 为 ADR 0010 原子几何编辑提供权威测量入口。
- **`packages/export/src/edge-geometry.ts`**（新）：一处派生端口/方向/控制点/箭头/线型——G-VIS D8 三级路由（内部直连优先→被挡才贴边通道 56px→目标侧梳状转折，fillet r=12，**零共线重叠**硬规则）；`lineMorph 0..1` 曲线↔正交插值（VRA-060 动画同源）；横向（右出左入）/纵向（底出顶入）双方向；箭头 9×7 实心三角、端点 gap 4、实/虚/点 dash；`obstacles` 传入卡盒做遮挡检测。
- **scene/svg/render-pdf/index 切换新契约**：每行 segment 各自 baseline（tspan 修复）、独立箭头 path、rx=12、dash、PDF roundRect；**修复 PDF 坐标双翻转缺陷**（既有 bug）；`createExportRenderer` 新增 `layoutNodeVisual/measureNodeVisual/planEdgeGeometry` 三个 UI 同源入口。
- **golden**：全部 fixture 升 schemaVersion 2；新 `visual-style-v2` 用例（12 节点参考 DAG：眉题/强调/虚线/点线/长中文）；正交段穿盒检测（`segEntersBox`）入测试。

## Golden 预期差异说明（REGEN 依据，非静默 hash 刷新）

| 差异源 | 旧 → 新 |
|---|---|
| 背景 | `#ffffff` / `#000000` → `#F9F8F4` / 黑板深底（G-VIS D1） |
| 节点框 | 白底近黑描边矩形 → 实心深卡（暖白文字）+ 橙强调卡（深字），圆角 0→12 |
| 连线 | 中心到中心平滑曲线、无箭头 → 底出顶入/右出左入**全正交圆角折线 + 实心箭头**，含实/虚/点三线型 |
| 眉题 | 无 → 节点内两层文字（11px 眉题 + 16px 正文） |
| schemaVersion | 1 → 2（fixture 全升级，读旧写新已由 VRA-020 契约测试覆盖） |

## 验证（实际命令与结果，暂存树）

`pnpm typecheck` / `pnpm lint` / `pnpm test:unit`（29 files / 319 tests）/ `pnpm test:export`（14 tests 含双跑确定性对照与 REGEN 机制）/ `pnpm build` / `check-boundaries` / `git diff --check` 全 PASS；主会话视觉验收：visual-style-v2 SVG（Chrome 渲染 + 视觉核验：暖白 ✓ 实心卡/橙卡 ✓ 两层文字 ✓ 全正交圆角+箭头 ✓ 虚/点线 ✓ 无缺陷），证据 `artifacts/visual-prototype-2026-09-06/26-vra040-export-svg.png`。

## 执行说明

实现由子 Agent 完成（约 1.5h，中途因 API 限额中断一次后恢复，最终在 golden 断言阶段失去响应），主会话接手收尾（REGEN 重生成 + 全套验证 + 视觉验收 + 临时调试文件清理）。子 Agent 的两个临时验收工具（preview-manual/gen-svg）按其自述删除。

## 给下一卡的接口

- **VRA-050（UI）**：`@mindmap/export` 的 `layoutNodeVisual / measureNodeVisual / planEdgeGeometry / buildScene` 为画布同源入口；palette 从 `visual-style.ts` 导入（替换 `packages/ui/src/theme/theme-tokens.ts` 的纯白/纯黑旧值——属 VRA-050 范围）；
- **VRA-060（动画）**：`planEdgeGeometry(edges, direction, lineMorph, { obstacles })`——每帧传显示坐标 + 当帧 morph 值即得连续布线；
- MRT-006 视觉一致性部分由本卡承接（tspan baseline/三格式同源）；剩余字体资源上限/失败路径留 MRT-006。
