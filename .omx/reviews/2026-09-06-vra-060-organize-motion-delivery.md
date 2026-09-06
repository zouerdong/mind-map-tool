# VRA-060：一条整理动作的节点、线与视口动画（交付记录）

日期：2026-09-06。执行依据：[VRA-060 卡](../planning/visual-alignment-task-cards-2026-09-06.md)；G-VIS 动效契约；ADR 0010。状态：**完成**。

## 交付内容

1. **运动协调器（`MotionCoordinator`）**：新建 `packages/ui/src/canvas/motion-coordinator.ts`
   - **时间线与缓动**：按 G-VIS 校准值设定（总长 800ms，卡片主体 600ms，层级差 25ms/层，最大延时 120ms；`easeOutCubic` 缓动）。
   - **单一 rAF 驱动**：单一 requestAnimationFrame 时钟驱动显示坐标；每帧通过 `calculateFrame` 统一计算节点显示位置与连线几何，禁止节点与边步调不一致。
   - **拓扑连续与插值**：`packages/export/src/edge-geometry.ts` 扩展 `PlanContext.routes` 支持路线拓扑冻结，`planEdgeGeometry` 在动画期间沿冻结通道连续插值控制点与箭头端点，无突变跳形。
   - **撤销与重做平滑反转（`reverseTo`）**：在动画中途撤销时，从当前显示态逆向平滑插值返回原点，不发生瞬间闪烁跳变。
   - **用户拖动打断（`interruptNode`）**：用户在整理动画期间拖拽节点时，该节点立即脱离动画帧接管为手动拖拽状态，其余未触碰节点继续平滑完成动画。
   - **无障碍降级（`prefers-reduced-motion`）**：检测系统减弱动效偏好，时长与错峰归零，立即完成终态定位。
   - **大规模降级（>= 300 节点）**：节点数达到 300 时自动取消层级错峰延时，单帧统一并发缓动，保障流畅度。
   - **视口单次协调（`computeCoordinatedViewport`）**：基于前后包围盒并集 + 80px 安全边距计算一次视口，缩放区间限制在 [0.2, 1.2]，避免小节点过度放大或每帧镜头剧烈摇晃。
2. **自定义连线渲染（`MindEdgeView`）**：新建 `packages/ui/src/canvas/mind-edge.tsx`
   - 消费 `data.pathD` 与 `data.arrowD`，直接渲染协调器计算的精确 SVG 路径与箭头；
   - 保持矢量的线型（实/虚/点）与颜色同步。
3. **画布接入（`EditorCanvas`）**：
   - 注册自定义边类型 `edgeTypes={{ mind: MindEdgeView }}`；
   - 彻底删除 MM-085 的全局 CSS `transform` 过渡，由 `MotionCoordinator` 统一管理帧坐标；
   - 暴露 `organizeSignal`、`organizeDirection`、`onOrganizeResult`、`onOrganizeComplete` 接口；
   - 在动画完成时仅执行一次 canonical `session.commit(new MoveNodesCommand(...))` 提交；
   - 在 `onNodesChange` 拖拽事件中挂接 `interruptNode`。
4. **单测与契约防线**：
   - `packages/ui/test/motion-coordinator.test.ts`：9 项单元测试覆盖缓动、层级错峰、300+ 节点降级、视口前后包围盒、rAF 推进、reduced-motion 瞬时到达、拖动打断脱离、中途 undo 平滑反转；
   - `packages/ui/test/editor-canvas.test.tsx`：测试 `organizeSignal` 触发整理、无位移 no-op、命令提交与完成回调；
   - `packages/ui/test/helpers/rf-stub.tsx`：扩展 stub 支持 edges 容器与 viewport 操作。

## 验证结果

- `pnpm typecheck`：全模块 0 错误（严格 `exactOptionalPropertyTypes: true` 通过）；
- `pnpm lint`：PASS（0 错误 0 警告）；
- `pnpm test:unit`：**36 files / 370 tests 全过**（含新增 `motion-coordinator.test.ts` 9/9，`editor-canvas.test.tsx` 13/13）；
- `pnpm test:a11y`：9 tests 全部通过；
- `pnpm test:export`：14 tests 全部通过（无 golden 回归）。

## 显式局限与下一卡承接

1. **应用外壳接线**：VRA-060 遵循职责边界，未修改 `mindmap-app.tsx`。整理操作的外壳入口、快捷键和菜单在 VRA-070 中与 `EditorCanvas` 的 `organizeSignal` 对接。
2. **真实环境录屏**：本卡在单测与 jsdom 下完成了逻辑与数学验证，真机 macOS Tauri 下的 60fps 动效录像留待 VRA-080 统一验收。
