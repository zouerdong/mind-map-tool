# 事件 → Command 映射（MM-050 交付物）

单一事实源：`packages/ui/src/controller/interaction-controller.ts`。改动先改代码与本文档，再补契约测试。

## 归一化事件 → core Command

| UI 事件（React Flow / DOM）                                                                   | InteractionController 方法                                 | 产生 Command                                                       | 备注                                                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 画布空白双击（`onPaneDoubleClick`，viewport 逆变换为画布坐标）                                | `createNodeAt(point)`                                      | `CreateNode`（空文本，size=共享 layout 空文本框）                  | 任意位置创建                                                             |
| 节点双击（`onNodeDoubleClick`）                                                               | 进入编辑态（无命令）                                       | —                                                                  | 编辑提交才产生命令                                                       |
| 编辑输入 Enter / blur（非 IME 组合）                                                          | `commitEditText(id, next, current, kicker?, currentRuns?)` | `EditNodeText`（text + 权威 size 同命令；runs 经文本变更映射保留） | 文本未变 → `null`（无空历史）；无 currentRuns → 纯文本（core 清除 runs） |
| 编辑输入 Escape                                                                               | 取消（无命令）                                             | —                                                                  |                                                                          |
| 节点拖动结束（`onNodeDragStop`）                                                              | `moveNodes(deltas, doc)`                                   | `MoveNodes`（批量原子）                                            | 拖动期间只本地位移；**只提交一次**；位移为零 → `null`                    |
| 连接（`onConnect` source→target）                                                             | `connect(source, target, doc)`                             | `CreateEdge`                                                       | 预检自环/同向重复/悬空 → `null`（core 亦会拒绝，预检避免注定失败的提交） |
| Delete / Backspace（画布 focus，非编辑态）                                                    | `deleteSelection(nodeIds, edgeIds)`                        | `DeleteSelection`                                                  | 选中节点 + 选中边；incident 边由 core 原子删除                           |
| ⌘/Ctrl+Z（非编辑态、非 IME 组合；生产经编辑菜单 accelerator → dispatcher，OFR-2026-09-14 #5） | `session.undo()`（不产生新命令）                           | —                                                                  | history hook                                                             |
| ⌘/Ctrl+Shift+Z / ⌘/Ctrl+Y                                                                     | `session.redo()`                                           | —                                                                  |                                                                          |
| 主题切换（未来 MM-070 入口）                                                                  | `setTheme(theme)`                                          | `SetDocumentStyle`                                                 | 持久化、可 undo                                                          |
| 节点形状覆盖（未来入口）                                                                      | `setNodeShape(id, shape)`                                  | `SetNodeShape`                                                     | null=清除覆盖                                                            |

## 画布手势（2026-09-18 内测批次，负责人定稿 Q1=A + 内测反馈②③）

- **左键拖空白 = 框选**（Figma/Miro 白板惯例）；Shift+拖同效（RF `selectionKeyCode` 默认）；
- **平移 = 触控板双指滚动（panOnScroll）/ Space+左键拖 / 中键拖 / 右键拖**；
- **缩放 = 捏合 / ⌘(Ctrl)+滚轮 / ⌘±0**（滚轮让位给平移，zoomOnScroll 关闭）；
- 三指拖移注记：macOS 辅助功能「三指拖移」在系统层合成左键拖拽，事件层与鼠标左键
  不可区分 → 三指拖移等同框选；平移请用双指滚动；
- 多选后拖动任一选中节点 = 整体移动，`onNodeDragStop` 一次 `MoveNodes` 提交全部位移。

## 主选（primary）语义（2026-09-18 内测反馈③）

- 主选 = **本次选择会话中第一个进入选择集的节点**（框选时 = 最先被框到的框）；
  追加选中（Shift 点选/框选扩大）不抢主选；
- 主选被取消选中 → 落到剩余集合中最早进入者（插入序），不跳到最新；
- 选择集清空后，下一次选中重新落定主选；
- 主选驱动：上下文工具条目标、角标记、能量脉冲（多选仅主选播放）。

## session-only（绝不产生 Command、绝不入文件）

- 画布 selection（左键框选 / Shift 点选 / ⌘A 全选）——仅作为 `DeleteSelection` 的参数来源
- viewport（pan/zoom/fitView）
- `editingId`（正在编辑的节点）
- 拖动期间的乐观位移（drag stop 前的 view-model 状态）

## IME 隔离规则（ADR 0002：中文输入无阻断）

1. `compositionstart` → `compositionend` 期间，画布层 keydown 全部放行不拦截（`isCompositionEvent`：`isComposing || keyCode === 229`）；
2. 编辑输入内的 Enter 在组合期间不提交（keyCode 229 / isComposing）；
3. 编辑态（`editingId !== null`）时画布快捷键（undo/redo/delete）整体不派发。

## 权威尺寸约定

`CreateNode` / `EditNodeText` 携带的 `size` 由 `measureNodeVisual({ text, runs, kicker }, fontId, fonts)`（`@mindmap/export` 共享完整视觉契约）计算——包含 G-VIS 卡片最小宽度与内距，并与 exporter 使用同一 `FontResolver`，保证画布所见即导出所得；core 不做字体测量（ADR 0003）。DFR-020：正文编辑（textarea / `commitEditText`）必须传入节点当前眉题参与测量（眉题高度不被正文编辑压掉）；不携带 runs 的命令按纯文本测量（与 core 清除 runs 语义一致）。DFR-090 F2：节点既有 runs 经 `remapRunsForTextChange`（前缀/后缀 diff 的区间映射，见 `runs-remap.ts`）随命令提交并参与测量——整节点样式续写保留，混合 runs 不套旧索引；编辑中点击工具条格式命令时先提交草稿再基于最新文本重算 runs（不用旧 `node.text` 覆盖新草稿）。
