# VRA-050：参考画布、节点与真实编辑操作面（交付记录）

日期：2026-09-06。执行依据：[VRA-050 卡](../plans/visual-alignment-task-cards-2026-09-06.md)；G-VIS tokens；ADR 0010。状态：**完成**（含一项显式局限，见下）。

## 交付

1. **tokens（G-VIS palette 落地）**：`theme-tokens.ts` 全量替换为暖白/黑板 palette（与 export `visual-style.ts` 逐值同源）；新增 `visual-contract.test.ts` 同源防线（ui ↔ export 对照断言 + 状态色断言）。
   - **两处实测修正**（对比度公式实算暴露）：强调卡眉题 `#6B3A22`(2.99:1)→`#5C2F1A`(3.59:1)；状态色（选中/焦点/端口/拖动）从 `#D97757`(对暖白 2.94:1)→**状态变体 `#D06B47`**(3.36:1 暖白/5.15:1 黑板)——卡片强调**填充**保持已批 `#D97757`（大色块+深字达标）。两侧（ui/export/文档）同步。
2. **画布视觉**：`mind-node.tsx` 重写——实心卡（普通近黑/强调橙）、圆角 12、无描边无投影；眉题+正文两层排版（export `layoutNodeVisual` 同源，空眉题自然单层）；状态双通道（选中=描边 / 主选/焦点=角标记+环，不靠颜色）；`framesVisible=false` 纯文字态 token；背景点阵移除（G-VIS D1 平坦画布）。
3. **投影与连线**：`projection.ts` 投影 kicker/emphasis/lineStyle；箭头默认开启（RF ArrowClosed marker，同线色）；实(2px)/虚(1.5px `5 4`)/点(`0.1 5` round) 三线型；颜色 edgePrimary/edgeSecondary 同源。
4. **上下文工具条（P0 操作面）**：`context-toolbar.tsx` 新建 + editor-canvas 接线（selection state + 主选跟踪）——选中节点：强调/眉题输入/文档字体/字号±/粗体/下划线/形状/框线/删除；选中边：实/虚/点线型。全部经 `session.commit` 既有命令系统（无 UI-only 样式），可 undo、可键盘操作（原生 button/input）。
5. **vitest alias**：`visual-style.js`/`edge-geometry.js` 直引支持（源码级同源消费）；rf-stub 支持 ReactFlow children（Panel 工具条可测）。

## 验证（实际命令与结果）

- `pnpm test:unit`：**35 files / 359 tests 全过**（ui 107：tokens 对比度实算 15、visual-contract 同源、context-toolbar 4——强调/眉题/字号命令提交与 undo、keyboard-flow 样式断言更新）；
- `pnpm typecheck`（0 错）/ `pnpm lint` / `pnpm test:a11y`（9 过）/ `pnpm build` / `check-boundaries` / `git diff --check`：全 PASS；
- export golden：kicker 色修正触发 REGEN（差异源=cardAccentKicker 单值，已记录）；
- 浏览器证据（dev 预览，`artifacts/visual-prototype-2026-09-06/27-*`）：暖白画布 DOM 实证 `rgb(249,248,244)` ✓、实心无描边卡 ✓、无点阵 ✓（视觉核验"灰底"为暖白固有观感；节点窄为取证脚本焦点问题，非渲染缺陷——单测宽度断言正常）。

## 显式局限（未完成项）

1. **文字选区级 runs 工具**：本卡字号/粗体/下划线作用于**整节点**（全区间 runs，可 undo）；编辑器内文字选区级工具（对选中文字单独设置）延后——`NodeTextEditor` 选区增强独立成小卡，未列入本卡完成度。
2. **工具条位置**：RF Panel 顶部居中（语义=选中态出现）；"浮于主选卡上方 8px"的精确跟随留 VRA-070 壳接入精调。
3. **真实 Tauri 截图**：dev 预览跑的是工作树 W2R2 版壳（bootstrap 适配），12 节点完整工作态截图留 VRA-080 真实 Tauri 环境（浏览器补充证据已存）。
4. IME 手测：jsdom 组合事件契约既有测试保持；真实中文 IME 手测随局限 3 同期。

## 给下一卡的接口

- **VRA-060**：`EditorCanvas` 的 `positionTransitionMs` CSS 过渡即迁移对象——motion coordinator 接管后删除该通道；每帧显示坐标经 rfNodes state 注入，线形态由 `planEdgeGeometry(edges, direction, lineMorph, { obstacles })` 派生；
- **VRA-070**：`ContextToolbar` 已自包含（selection/document/onCommand props），壳层只需提供挂载位置；工具条键盘入口复用画布焦点链。
