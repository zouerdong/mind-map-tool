# 首次试用修复报告（DFR-010～040）

日期：2026-09-14。状态：**DFR-010～040 完成，STOP_FOR_INDEPENDENT_REVIEW**（停等 DFR-090 独立审阅；不宣称已获负责人试用接受）。
对应规划：[开发指南](../planning/dogfood-repair-development-guide-2026-09-13.md)、[任务卡](../planning/dogfood-repair-task-cards-2026-09-13.md)。

## 一、来源与候选

| 项 | 值 |
| --- | --- |
| SourceCommit | `b1f04f447dfdbb7cf37c03cb83e369329b0c968b`（main） |
| 构建来源 | 隔离 clean checkout（`git worktree`，路径 `.tmp/dfr040-src`）；工作树用户改动（AGENTS.md、CLAUDE.md 删除、规划文档）全部保留未提交、未进候选 |
| 候选 DMG | `.tmp/dfr040-src/apps/desktop/src-tauri/target/release/bundle/dmg/Mind Map_0.1.0_aarch64.dmg` |
| DMG sha256 | `00f353a259917228255472900470f6796e69ab39cb2e039f9b0fa0e62b79373f` |
| App sha256 | `b5546e6e4afbc028…`（完整值见 inventory） |
| Inventory | `.tmp/dogfood-2026-09-13/bundle-inventory.json`（sourceWorktree=clean，ULMO 装配 PASS） |
| 旧 DMG | `21d2…b1ed` 继续作废，未作为输入 |
| 签名/公证/上传/发布 | 未执行（未授权） |

## 二、既有补丁复核结论（不以"移除断言"为成功标准）

| 补丁 | 复核结果 |
| --- | --- |
| `9483634`（commit/通知原子化） | 方向正确，但有三个遗漏缺陷，已在 DFR-010 补全（见下）。显示同步回归以 DOM 断言锁定（非只读 session）。 |
| `f6d4e6d`（移除生产投影断言） | 合理（微任务窗口内误杀整页无数据保护作用）；本轮未恢复生产断言，以真实显示/撤销/保存一致性验证替代。 |
| `12f8f92`（几何与直接编辑恢复） | ready/pending、正文/眉题/runs 路径复核后发现四处口径不一致，已在 DFR-020 补全。 |

## 三、根因与修复（按卡）

### DFR-010 状态同步（`af86d4a` + `5544adf`）

1. **队列部分提交后失败不通知 UI**：`drainQueue` 在第二条意图失败时直接 throw，已提交的前序意图从未触发 `onCommitted`——core 已变、画布停留旧版本（陈旧画面根因之一）。修复：catch 路径先对已提交部分发 `onCommitted`，失败意图回队首保留。测试：双意图部分失败用例。
2. **ready 分支未处理拒绝**：ready 分支 commit 失败返回 rejected Promise，而全部调用点都是 `void enqueue(...)` → 未处理拒绝。修复：经 `onError` 呈现后 resolve。测试锁定。
3. **`cancelPendingNode` 误删字体意图**：filter 条件 `q.kind !== "set-document-font" && q.id !== id` 与注释意图相反，取消节点时把文档级字体切换意图一并删除。修复为保留文档级意图。测试锁定。
4. **幽灵选择（原生实测发现）**：core 驱动重投影用全新节点数组覆盖受控视图，`selected` 标志被静默丢弃而 `selectionRef`/`uiSelection` 收不到 deselect——undo/redo 后重选同一节点，工具条退化为多选形态（眉题输入框消失），删除命令可能波及不可见 id。修复：重投影时选择一并权威化（保留仍存在 id 的选中、剪除失效 id 并同步 uiSelection）。`5544adf`，含回归测试。

### DFR-020 视觉接线（`d5dd5bd`）

1. **ready 路径正文编辑丢眉题高度**：`commitEditText` 测量只传 text；带眉题节点编辑正文后高度被压掉。`MeasureText` 增加 kicker 参数。测试锁定（12+14.3+6+22.4+12=66.7）。
2. **编辑框排版与提交后不一致**：`NodeTextEditor` 用旧 `LAYOUT`（14px/1.5/10-8 内距）→ 切到 `VISUAL_TYPOGRAPHY`（16px/1.4/16-12，眉题占位 32.3px 顶内距）。
3. **`framesVisible=false` 画布 UI 从不生效**：仅 export 侧实现。修复：隐藏填充并切换画布墨色/眉题色（与 `nodeColorsOf` 同语义）。DOM 测试锁定。
4. **整理后再次编辑连线掉回贝塞尔**：规整态只在动画期间存在，普通重投影丢失 pathD（导出却始终规整态，所见≠所得）。新增 `MotionCoordinator.settledEdgePaths`：驻留 lineMorph>0 时按最新 doc 重算正交连线。测试锁定。
5. **edit-text runs 语义**（随 `af86d4a` 同文件提交）：屏障 pending 路径用旧 runs 测量新纯文本；core 对无 runs 命令的语义是清除旧 runs，测量已对齐为纯文本（保留眉题）。

### DFR-030 命令入口与轻量界面（`0458634` 文档 + `24fe172`/`b63c361`/`dea33ed`/`e132a22`/`8384007`/`5b221f6`/`b1f04f4` 实现）

先同步规格再实现：PRD §5.1（提示/浮钮/双入口）、ADR 0012 v1.1.0、visual-state-tokens 实施澄清、快捷键表（"垂直树"→默认横向分层、可选纵向）。

1. 空白画布底部居中创建提示「双击创建 · ⌥Space」（0 节点显示、非交互、`role="note"` 保留在 AX 树）。
2. ≥2 节点右上浮动「整理 ⇧⌘L」按钮，与系统菜单共用 `dispatchCommand("view.organize")`（同一 dispatcher）；0/1 节点不显示。
3. 上下文工具条锚定主选节点卡上方并夹紧视口；无主选回退顶部居中；bar `mousedown` preventDefault 不抢输入焦点。
4. **onboarding 自动弹出**（负责人本机偏好 in-progress 真实触发；范围扩展经负责人 2026-09-13 批准）：reducer `observe` 推进步骤时经 `beginStep` 强制 `visible: true`，后台恢复/暂时隐藏的引导在首个真实操作后自动弹出遮挡画布，违反 ADR 0012 §7。修复为步骤推进保留 `state.visible`。`dea33ed`。
5. **小窗口夹紧失效**（原生 800×600 实测发现，三轮定位）：窗口缩小时夹紧值停留在旧视口宽度；`documentElement.clientWidth`/容器 `clientWidth` 在内容横向溢出时被撑大约 16px，形成"溢出→视口变宽→纵容溢出"反馈环。终案：ResizeObserver 观察 `.react-flow` 容器驱动重算 + `window.innerWidth` 基准。`b1f04f4`。

## 四、验证

### 自动门（全部通过）

| 门 | 结果 |
| --- | --- |
| `pnpm test:unit`（全量） | 680 passed（基线 673 + 本轮新增 7） |
| `pnpm test:export`（golden 契约） | 18 passed |
| `pnpm typecheck` / `pnpm lint` | 5/5 包 Done |
| `pnpm build` | 通过 |

### 真实原生操作（DFR-040，自研驱动 `.tmp/dogfood-2026-09-13/drive.mjs`，复用既有 `ax-driver.swift` CGEvent/AX 通道 + System Events 菜单，未改动任何 runner）

对本轮 release 候选执行完整路径，**38 项断言全部 PASS**（证据：`dfr-040-native-evidence.json`）：

1. 空白双击输入中文 ×3 节点（创意起源/目标用户/核心场景）→ 拖拽连线 ×2（Graph JSON 确认 edges=2）。
2. 选中 → 楷体切换（按钮文案翻转）→ **⌘Z 撤销（显示同步恢复）→ ⇧⌘Z 重做**（原崩溃路径）；眉题输入提交（标签变为「灵感·节点：创意起源」）；字号+2/粗体/手绘圈/隐藏框线各一次，无崩溃无漂移。
3. 系统菜单：黑板主题（dirty ● 出现）→ 暖白；适应画布；整理（菜单点击）；⇧⌘L 快捷键整理（"已整理为分层布局"）；浮动按钮二次触发幂等 no-op（"已经是整理好的布局"）；菜单整理再次 no-op。**负责人报告的"其他菜单也报错"在修复后未复现**——逐项点击均生效，符合"均为投影崩溃下游症状"的判断。
4. 浮动整理按钮点击 → 正交连线与动画；800×600 小窗口工具条夹紧视口（数值断言含 AX 噪声容差，截图复核 `07-小窗口800x600-工具条.png`）。
5. 输入隔离：编辑态 Delete 删字符不删节点；Esc 取消编辑文本不变。
6. ⌘S 保存（首次转 Save As 原生面板 + 覆盖确认）→ dirty 清除、标题带文档名；关窗重开 → 3 节点/眉题/椭圆/字体（霞鹜文楷）全部持久化（`06-保存重开.png`）。
7. 四格式导出（⌘E 面板逐一点击 + 原生面板落盘）：Graph JSON 实际解析（3 节点/2 边/文本/眉题）、SVG 含文本无 foreignObject、PNG/PDF 魔数与体积正常。

### 截图（`.tmp/dogfood-2026-09-13/`）

`01-空白画布-创建提示`（含底部提示）、`02-多节点选中`（三节点橙框全选 + 工具条）、`03-隐藏框线`、`04-黑板主题`、`05-整理后`（正交连线）、`06-保存重开`、`07-小窗口800x600-工具条`。对照 `input/样式参考.JPG` 与 visual tokens：暖白 `#F9F8F4`、近黑实心卡、橙强调、120px 最小卡宽、16px 正文、眉题小字均一致；黑板为同构深底亮卡。

## 五、未运行项（本批不要求）

- advisory、20 轮性能、VoiceOver、完整发布矩阵（按卡豁免）。
- 真实 IME 组合输入（合成 `type`/粘贴注入与 IME 组合路径不同；IME 隔离由 jsdom 单测覆盖，建议独立审阅时人工抽查一次真实输入法）。
- Windows 平台（v1 范围外）。

## 六、风险与遗留观察（R1～R8 映射）

- R1/R2/R8：已通过显示级测试与原生路径覆盖（幽灵选择、部分失败通知、ready 拒绝均已修复）。
- R3：几何口径统一到 `measureNodeVisual`；旧文件未做批量迁移（打开旧文档不静默重排，符合既有契约）。
- R4：菜单/快捷键/浮钮 exactly-once 已由幂等 no-op 验证。
- R5：四态截图证据齐全。
- R6：保存重开内容逐项核对（文本/眉题/形状/字体/主题/边）。
- R7：clean worktree + inventory + hash 链完整；用户未提交改动未进候选。
- 遗留观察（不阻塞本批，供后续参考）：
  1. **WKWebView 粘贴导航隐患**：无任何可编辑元素聚焦时 ⌘V 可能让 WebKit 把粘贴解释成页面导航（实测日志出现 frame 加载空文档）。自动化场景高频触发；真实用户风险待确认，建议后续卡评估（如画布层 paste 事件处理）。
  2. WKWebView 内容 AX 坐标存在 ~15–20px 逐元素测量噪声（不影响产品；影响 AX 驱动断言精度，已在驱动侧以容差+截图处理）。
  3. 成功 Toast 仅 2.5s：快速自动化可能错过提示（不影响真人）；保存类断言建议以标题/dirty 等持久信号为准。
  4. 测试产物位于 `~/Documents`（`dfr-040-sample.mindmap`、`dfr-040-export.{json,svg,png,pdf}`，合成数据），副本已在证据目录；原文件留待负责人处置（未获删除授权）。
  5. 编辑器在保存时的 `flushActiveEditor` 会提交当前编辑中文字（既有设计）；驱动曾因此把"遗留编辑会话"计入快照——内容正确，但建议真人试用时留意 Esc/blur 语义是否符合预期。

## 七、DFR-090 返修收口（2026-09-14 追加）

审阅意见：[/tmp 外部审阅文档，要点存档于本节] REVISE —— F1（ready 提交失败丢意图）、F2（正文编辑清空样式/编辑态退回 16px/编辑中格式读旧文本）。均按"先红灯后修复"执行，不做无关重构。

### F1（`cb45b8b`）

ready 分支拆分为两个 try：commitIntent 失败 → 意图按 pending 同规则归并入队（`hasPendingIntents` 为 true，显式 flush 可重试、持续失败时拒绝——Save 阻断可见），onError 呈现后 resolve（void 调用无未处理拒绝）；`onCommitted` 通知抛错 → 仅 onError，绝不重入队（避免 flush 重复提交已生效命令）。归并逻辑抽取为 `queueIntent` 供两分支共用。红灯用例 3 个：可恢复失败重试恰好一次、持续失败 flush 拒绝且文档未误改、通知失败不重复提交。

### F2（`ade5a07` + `4b5d054`）

1. 新增 `packages/ui/src/controller/runs-remap.ts`：前缀/后缀 diff 的 TextRun 区间映射——整节点统一样式（含 stepFontSize 多段同属性）全域保留（含全量替换）；混合 runs 边界映射（start/end 规则区分插入点归属）、空 run 丢弃、相邻同属性合并。
2. `commitEditText` 携带映射后 runs 并以其测量；barrier pending/ready 两路径共用同一映射。编辑态实时测量与渲染沿用整节点样式（`NodeTextEditor` 新增 fontWeight/underline；混合 runs 编辑态退回纯文本渲染，提交后样式保留）。
3. 编辑中点格式：`flushActiveEditor` 返回草稿文本，先提交草稿（样式随映射保留）再基于最新文本重算命令 runs——不再用渲染期捕获的旧 `node.text` 覆盖新草稿。
4. **原生实测追加暴露**：A+ 后点 B 时 `toggleWhole` 整体替换 runs 导致字号静默丢失（F2"字号/粗体/下划线共存"前提不成立）。修复为翻转目标属性、保留其他属性（`4b5d054`，红灯用例先行）。

### 返修验证

- 自动门：`pnpm test:unit` 703 passed（+23 vs 上轮 680）；export golden 18 passed；typecheck/lint 5/5。
- 新候选：source `4b5d054`（clean worktree），DMG sha256 `c181429c2a2e47c94be4971aaf9456ba6bbb333c54b9ed95e1dce3022e321ecc`，inventory `.tmp/dogfood-2026-09-13/bundle-inventory-f1f2.json`。旧候选 `00f353a2…` 转为诊断记录，不作交付。
- 原生短路径（同一驱动增补 S5b/S8 场景，43 项断言全 PASS）：带样式节点续写 ⌘Enter 提交（bold+fontSize 18 runs 全域保留至导出 JSON）、编辑中点 U 草稿不被旧文本覆盖（underline 落在草稿文本全域）、撤销重做、整理、保存重开、四格式导出（Graph JSON runs/眉题/文本逐项核对、SVG font-size 18 呈现、PNG/PDF 魔数）。证据 `dfr-040-native-evidence.json`。
- 期间发现并处理环境干扰：本机自动锁屏会阻断 AX 通道（进程存活但 0 窗口）；解锁后以 caffeinate 保持唤醒完成跑批，非产品缺陷。
- **遗留观察（交审阅定夺，未擅自改）**：LXGW WenKai 无 bold 字面，导出层 `seg.bold` 依赖 `fonts.bold(fontId)`，文楷文档的粗体在 SVG/PDF 中不呈现（canvas 由浏览器合成粗体）；是否引入 faux-bold 属独立导出策略决策。`layout.ts` 已有 `fauxBold` 常量但无生产者。
- 真实 IME 手工抽查：自动化无法驱动系统 IME，建议负责人本机试用时以真实输入法在带样式节点上续写一次。

## 八、交接

- 新候选（见 §一）+ 证据目录 `.tmp/dogfood-2026-09-13/`（驱动、证据 JSON、截图、导出件、inventory）。
- 提交链：`0458634`（文档）→ `af86d4a`（DFR-010）→ `d5dd5bd`（DFR-020）→ `24fe172`+`b63c361`（DFR-030）→ `dea33ed`（onboarding，范围扩展已批）→ `5544adf`（选择态）→ `e132a22`→`8384007`→`5b221f6`→`b1f04f4`（夹紧终案）。
- **STOP_FOR_INDEPENDENT_REVIEW**：请 DFR-090 独立审阅核对缺陷↔修复一一对应、关键边界未被删除校验掩盖、截图符合原视觉方向、候选与源码一致；ACCEPT 后交负责人决定是否恢复试用。G-FINAL 未申请。
