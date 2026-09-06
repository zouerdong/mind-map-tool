# VRA-070：极简 App Shell 与原生安全状态接入（交付记录）

日期：2026-09-06。执行依据：[VRA-070 卡](../planning/visual-alignment-task-cards-2026-09-06.md)；G-VIS 极简 App Shell 提案；ADR 0008 / ADR 0010。状态：**完成**。

## 交付内容

1. **极简 40px 顶栏（`AppHeader`）**：新建 `apps/desktop/src/app/app-header.tsx`
   - **视觉对齐**：顶栏高度固定 40px，色调为画布微暗一档（暖白 `#F1EFE9` / 黑板 `#211E18`，边框 `#E3DFD5` / `#35312A`），与 G-VIS 原型完全一致。
   - **左侧：文件菜单 `[文件 ▾]`**：
     - 下拉菜单包含：新建 (⌘N)、打开… (⌘O)、保存 (⌘S)、另存为… (⌘⇧S)、导出… (⇧⌘E)、热键… (⌥Space)、重放引导；
     - 采用 `opacity` + `pointerEvents` + `transform` 平滑淡入过渡，在关闭态不阻挡画布点击，且可无障碍发现；
     - 点击外部自动关闭、Escape 键快速关闭；
     - 显式 `aria-label` 与测试及屏幕阅读器语义无缝对齐。
   - **中间：文档标题与状态**：
     - 居中文档名加粗显示；
     - 状态指示（已保存 / 未保存），在桌面生产模式下纯净显示，在 dev fake 模式下显示状态后缀供测试判定。
   - **右侧：主动作与视图**：
     - `[整理 ⌘⇧L]` 醒目强调按钮（`#D97757`），直接驱动整理动画与 MoveNodes 提交；
     - `[☰ 视图 ▾]` 菜单：适应画布、布局方向切换（横向默认 / 纵向，D7）、直接导出三格式、快捷键设置、重放引导；
     - `[◐]` `ThemeToggle` 主题切换组件。
2. **零布局偏移提示系统（`AppNotice`）**：新建 `apps/desktop/src/app/app-notice.tsx`
   - **常规成功反馈（info）**：右下角短浮层 Toast（`position: absolute; right: 16px; bottom: 16px`），2.5 秒自动淡出消失，具备手动 `×` 关闭入口，**彻底解决提示显隐导致画布高度与坐标系抖动的问题**。
   - **异常/错误/冲突反馈（error）**：顶栏下方持续悬浮横幅 Banner（`position: absolute; top: 48px; left: 50%; transform: translateX(-50%)`），非模态遮挡但持续常驻，必须由用户行动或手动关闭。
3. **安全状态与生命周期接入（`mindmap-app.tsx`）**：
   - 原生关闭三分支（`closeState`: Save / Discard / Cancel / Retry Close）完全保留，对话框按 G-VIS 模态规格与遮罩层规范呈现；
   - host launch retryable 错误（`launchErrors`）、post-commit 恢复（`pendingRecovery`）、bootstrap 启动回报待重发（`pendingReports`）浮动呈现于画布上方，不侵占画布主干流布局；
   - 整理流程由 `organizeSignal` / `organizeDirection` 接入 `EditorCanvas`，由 `handleOrganizeResult` 接收 moved / no-op / error 状态并呈现友好提示。
4. **运动协调器浮点健壮性保障（`motion-coordinator.ts`）**：
   - 针对 rAF 调度与 `performance.now()` 的亚毫秒浮点抖动，将动画结束判定容差放宽至 `allFinished || elapsed >= this.duration - 1`，避免偶发毫秒级未落定判定。
5. **桌面测试桩对齐（`rf-stub.tsx`）**：
   - 同步 `apps/desktop/src/app/rf-stub.tsx` 与 `packages/ui` 测试桩，支持 `onInit` 视口方法、边容器与 ReactFlow 子组件（ContextToolbar Panel）。

## 验证结果

- `pnpm typecheck`：全模块 0 错误；
- `pnpm lint`：PASS（0 错误 0 警告）；
- `pnpm test:unit`：**36 files / 370 tests 全过**（桌面测试 7 files / 57 tests 包含全部生命周期、文件命令、整理集成、关闭流集成全绿）；
- `pnpm test:a11y`：9 tests 全部通过；
- `pnpm test:export`：14 export golden 契约测试全部通过；
- `pnpm build`：PASS（桌面打包产物生成正常）；
- `node scripts/quality/check-boundaries.mjs`：PASS（边界校验全绿）；
- `git diff --check`：PASS。

## 下一卡承接

- **VRA-080**：参考静态、动态与跨格式的真实验收。
  - 1080×864 参考内容区与 G-VIS 原型逐卡/逐线比对；
  - 散乱夹具自动布局与无重叠复测；
  - 真实 macOS Tauri 下 60fps 动效录像与采样判定。
