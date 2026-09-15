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

## 八、DFR-090 R2 复审收口（2026-09-14 再追加）

复审结论 REVISE（R2），附四个可运行独立反例（已入库 `packages/ui/test/dfr090-independent.test.tsx`，先复用红灯再修根因）。勘误：上轮报告"43 项断言"实际计数为 49。

### R2-F1（`6c23da7`）：旧失败意图覆盖新操作

ready 快路只看 metrics state 不看队列：旧失败意图留队时新操作直接写文档，保存 flush 重放旧操作覆盖新值。修复：队列未空或有 in-flight drain 时新意图先归并入队（同字段新值取代旧值、跨字段保留顺序）经统一 drain 顺序提交；空队列快路保持同步通知。EditorCanvas 五处仅按 `getMetricsState()` 旁路 `api.commit` 的入口（正文/眉题/建点/工具条格式）同步受新增的 `hasUnresolvedIntents()` 约束。独立反例（older 失败入队→latest 成功→flush 得 latest）转绿；失败保留、通知不重入队、持续失败阻断保存的原用例全部保留。

### R2-F2（`7c90826`）：格式叠加只修了一个方向

B→A+ 字号不变（stepFontSize 只步进显式 fontSize，默认 16 未提升）；局部 runs 的空隙吃不到整节点 B/U。修复：`runs-remap.ts` 新增 `segmentTextRuns`（覆盖段+空隙分割全文本域）与 `mergeAdjacentRuns`；stepFontSize 按段有效字号（缺省按正文默认 16）步进，toggleWhole 全域翻转目标属性保留其他属性。混合开关策略不变。两个独立反例转绿。

### R2-F3（`5c46547`）：文楷语义粗体在上游被清除

PRD §5.1 既定"文楷无真粗体用描边模拟"，scene/SVG/PDF 模拟分支均存在；断点是 `layoutNodeText` 把请求 bold 与真粗体字面合成 useBold，文楷段输出 bold=false 使 fauxBold 永不命中。修复：段上保留语义 bold（缺真粗体仍用 regular 度量），scene 派生 fauxBold；SVG 端 font-weight 与描边只取其一防双重模拟过粗；PDF 双绘与 PNG（消费 SVG）经既有路径生效，未改动。`lxgw-font` golden 三项哈希 REGEN——夹具本就为文楷模拟粗体设计，旧快照固化的是缺陷输出；其余用例哈希不变。独立反例转绿。

### R2 验证

- 自动门：`pnpm test:unit` 707 passed；export golden 18 passed（REGEN 说明如上）；typecheck/lint 5/5。
- 新候选：source `5c46547`（clean worktree），DMG sha256 `567b4f0974e06e22c47534cdd96f17b70443cefb28f83e0ebbbc4c21c1dfdd2e`，inventory `bundle-inventory-r2.json`。
- 原生短路径 **51 项断言全 PASS**：在上一轮场景基础上覆盖 B→A+ 逆序叠加（导出 JSON 确认 `bold+fontSize:18` 全域）、文楷导出 SVG 描边模拟（含 stroke、无 font-weight、无双重庆合）、编辑/格式/整理/保存重开/四格式导出。证据 `dfr-040-native-evidence.json`。
- 视觉对照：导出 PNG 人工目检——文楷描边模拟粗体效果可辨且不过粗（证据目录 `dfr-040-export.png`）。
- **测试环境观察（非产品缺陷，供后续跑批参考）**：未签名重建候选会触发 macOS TCC「访问文稿文件夹」授权弹窗（cdhash 变化视为新应用）；该弹窗为系统级 modal，出现时 AX 查询返回空窗口——曾被误判为应用故障。跑批前需人工点击允许一次。锁屏同样阻断 AX（见 §七）。
- R2-F1 相邻残留（已报审阅/负责人，未擅自扩修）：失败意图留队后用户删除目标节点，flush 将永久失败阻断保存；建议下轮决定"不可恢复错误丢弃意图并告警"或"删除命令连带清理队列意图"。

## 九、交接

- 新候选（见 §一）+ 证据目录 `.tmp/dogfood-2026-09-13/`（驱动、证据 JSON、截图、导出件、inventory）。
- 提交链：`0458634`（文档）→ `af86d4a`（DFR-010）→ `d5dd5bd`（DFR-020）→ `24fe172`+`b63c361`（DFR-030）→ `dea33ed`（onboarding，范围扩展已批）→ `5544adf`（选择态）→ `e132a22`→`8384007`→`5b221f6`→`b1f04f4`（夹紧终案）。
- **STOP_FOR_INDEPENDENT_REVIEW**：请 DFR-090 独立审阅核对缺陷↔修复一一对应、关键边界未被删除校验掩盖、截图符合原视觉方向、候选与源码一致；ACCEPT 后交负责人决定是否恢复试用。G-FINAL 未申请。

## 十、OFR-2026-09-14 负责人第二次实用反馈收口（2026-09-15 追加）

负责人第二次实用反馈 7 项（OFR-2026-09-14 #1～#7）：#1 全选后单击放置光标、#2 整理后拖动连线跟随、#3 保存格式选择、#4 新文档默认文楷、#5 菜单撤销/重做、#6 文楷粗体长文本裁剪、#7 首启自动引导。修复提交链：`7f8b1ec`（#1/#2）→ `c867d99`（#6）→ `8629a3c`（#4）→ `86c2614`（#5）→ `f17af44`（#7）→ `4ff5c7d`（#3 初修）→ `91a0e97`（PRD/ADR 0012 v1.2.0/快捷键表同步）。

### R1 原生验证（2026-09-15 00:19，候选 source `91a0e97`）

26 项路径中 12 项通过后 **S5 #3 红灯**：保存面板无任何格式控件（证据 `ZZ-失败现场.png` / `ZZ-ax-texts.json`，面板 AX 树仅 Save As/Tags/Where/Cancel/Save）。根因经 vendored 源码证实：rfd 0.16（tauri-plugin-dialog 2.7.2）在 macOS 把全部 filter 合并进 `NSSavePanel allowedFileTypes`（`panel_ffi.rs add_filters`），系统不会因此显示格式 popup——`4ff5c7d` 的双 filter 修复在用户层面无效。

### R2 修复（`bd1fdae`）

macOS 文档保存改走自承载 NSSavePanel + accessory view（`apps/desktop/src-tauri/src/ipc/save_panel.rs`）：「格式：」label + NSPopUpButton（Mind Map 文档 (.mindmap) / JSON (.json)），切换实时联动 name field 扩展名（覆盖确认与最终文件名一致；用户手改扩展名仍以输入为准）；sheet 呈现与旧路径一致。objc2 0.6.4 / objc2-app-kit 0.3.2 / objc2-foundation 0.3.2 / block2 0.6.2 均已在依赖图（rfd/wry 相同版本），仅声明直接依赖+feature，lockfile 零新增 crate。非 macOS 保持 rfd 路径（Windows 通用对话框原生显示 filter 下拉）。两格式写入同一份 canonical JSON，host 不做扩展名策略（与 open 接受范围一致）。

### R2 验证

- 自动门：cargo test 212 passed（含新增 swap_extension 2 例）；`pnpm typecheck` / `lint` / `test:unit` 714 passed 全绿。
- 新候选：source `bd1fdae`（ofr-src clean worktree），DMG sha256 `570e10b2f7864abb5d4cea046d63b514a5af5450a80dbd5ec6ca63294fbd4f42`（24,304,089B），.app sha256 `71937dd0dbb95623…`；inventory `.tmp/dogfood-2026-09-14/r2/bundle-inventory.json`。
- 原生全路径 **26 项断言全 PASS**（`r2/ofr-native-evidence.json`）：首启引导（#7）、默认文楷（#4）、单击放光标（#1）、整理/拖动连线跟随（#2）、焦点不在画布时菜单 ⌘Z/⇧⌘Z 双向可达（#5）、保存面板格式选择 + 选 JSON 扩展名联动 + JSON 落盘可解析 + 重开三节点完整（#3）、字体持久化（#4）、Graph JSON meta.font=lxgw-wenkai、长文本与粗体 runs 完整、导出 SVG 文楷描边模拟（#6）。截图 01–08 齐全，`07-保存面板-格式选择.png` 可见原生格式 popup。
- 驱动修正（诚实披露，非产品改动）：S5 点击机制改为点可见 popup 本体再点 JSON 项（原逻辑会命中隐藏菜单项的失效坐标）；S6 字体断言路径修正为契约路径 `meta.font`（`graph-json.ts GraphJsonMeta`，旧断言检查不存在的 `document.font`/`graph.font`）。
- 环境干扰记录（非产品缺陷）：① 跑批前机器自动锁屏阻断 AX（进程存活但窗口无 frame，同 §七/§八 既有记录），解锁后 caffeinate 保持唤醒完成；② 一次 drag-repro 探针在引导遮罩未关闭时创建节点，导致偏好被写为 `in-progress`（S0 前置破坏），已复位为 `not-started` 后重跑；③ 首轮 r2 跑批连线/拖动拖拽全部未生效（点击/键入正常），同构建同坐标隔离复现全部成功，判定为解锁后首次跑批的合成 HID 投递抖动，重跑即恢复。
- 未运行项（按既定轻量验收口径）：Windows 实机（PRD 延后）、advisory、20 轮性能、VoiceOver、完整发布矩阵。

### 交接

- 新候选 DMG + 证据目录 `.tmp/dogfood-2026-09-14/r2/`（驱动、证据 JSON、截图、导出件、inventory）；R1 失败现场保留在同名上级目录供审计。
- **STOP_FOR_INDEPENDENT_REVIEW**：请独立审阅核对 #1～#7 缺陷↔修复一一对应、S5/S6 驱动修正未掩盖产品问题、候选与源码一致；ACCEPT 后交负责人决定是否恢复试用。旧 DMG 全部继续作废；G-FINAL 未申请。

## 十一、OFR-2026-09-15 第三轮反馈修复与一次清理事故（2026-09-15 追加）

### 负责人反馈（第二候选实机）

1. 引导停留在 1/4，步骤卡没有进入下一步的按钮，只能关掉。
2. 节点里写很长文字后切到别的框，原框文字显示不全。

### 根因与修复（`5c0b947`）

- **反馈 2（产品缺陷）**：`layoutNodeText` 只认显式 `\n`，长单段文本量成单行无限宽卡（实测 2048px 宽、47px 高），文本伸出视口即"显示不全"。该实现对 G-VIS §1.3"内容自适应 120–260"的解读（"无软换行"）与 token 上限自相矛盾。修复：共享排版新增软换行（内容区 228px 贪心折行，词边界优先、CJK 字符硬折，runs 跨行保留），卡片纵向生长；UI 显示、权威测量、四格式导出同一来源同步生效。
- **反馈 1（产品缺陷，两处）**：① welcome 入口卡与第 1 步同显"引导 1/4"造成"卡住"错觉；② 动作驱动步骤卡无显式"下一步"（PRD §7.2 要求"下一步"与"跳过"），且末步主按钮"稍后再说，完成引导"错接 `onStart`（会回跳第一步）。修复：welcome 不计步、步骤卡补"下一步"（reducer 新增 `next` 动作，末步 next=完成），动作自动推进保留。

### 验证

- `pnpm typecheck` / `lint` 通过；`pnpm test:unit` 718/721（新增换行契约 3 项、引导 next 4 项、overlay 2 项；替换旧"无软换行"断言）。7 个测试文件的假字体度量由 `size×10`（160px/字，两字即折行）统一为既有 CJK 真实感假度量。
- 原生速验（新候选实机，`5c0b947`，DMG sha256 `04b01f454e15269f…`，证据 `.tmp/dogfood-2026-09-15/`）：步骤卡"引导 2/4 + 下一步/跳过引导/×"截图确认；长文本节点提交后 w=256 ≤260、h=181 纵向生长、失焦后完整可见。
- 未运行项：cargo test（本轮无 Rust 变更，212 项基线未动）；Windows；完整 drive.mjs 全路径（驱动断言需为折行后的尺寸断言微调，留待独立审阅轮）。

### ⚠️ 清理事故（过程缺陷；已于当日按方案 B 闭环）

执行"清理中间文件"时误删 `.tmp/runtime-spike/`（254MB）：该目录被 `docs/decisions/decision-register.json` 的 G1 `candidateEvidenceSha256` 按字节冻结引用，**不是普通构建缓存**。原始字节不可恢复（无 Time Machine/快照/Trash 副本）。已按 README"可再生"路径重生成 export/fonts 两轨，但含计时字段无法字节一致，verify-decision packaging 红灯 3 项（hosts/canvas 两轨证据缺失 + export/fonts 哈希漂移）。修复方向（均需负责人批准，因为改写 G1 冻结记录）：

- A. 补齐重跑 hosts/canvas 两轨（需下载 Electron/Playwright、构建 spike app）后运行 `finalize-g1.mjs` 重冻结哈希；
- B. 借机把四轨证据迁入受版本控制目录（如 `docs/quality/evidence/g1/`）并同步 register 路径与哈希，一次性消除"测试依赖易失 .tmp"的结构性隐患。

**闭环记录（[from-user 2026-09-15] 负责人选 B）**：四轨批准候选证据经 harness 再生并迁入 `docs/quality/evidence/g1/`（tracked）；register 的 exitEvidence 路径/哈希与 candidateEvidenceSha256 重冻结；`test:unit` 恢复 726/726 全绿。electron（未批准候选）证据未再生（其 exitEvidence 不参与批准校验，原路径保留作历史记录）。spike 侧构建残留（tauri target 888MB、node_modules 142MB、Electron 半成品）已清。

已沉淀规则到项目 AGENTS.md：`.tmp/runtime-spike/` 为 register 冻结引用证据，清理禁区。

### 另一次流程偏差（已闭环）

为隔离负责人会话而起的探针两次误用：① 未知 tauri-plugin-single-instance 的存在，`open -n` 探针被转发进负责人正在使用的实例，注入了两个合成节点（"这是一段故意…"、"别的框"）——经全盘点对，未写入任何磁盘文件，会话退出后消失；② 速验探针未检查应用是否在运行即驱动，可能打断了负责人 140 步的会话（截图显示当时"已保存"，探针只在其后追加了未保存的合成节点）。教训：探针必须先检查目标进程状态，运行中一律中止等待。

## 十二、OFR-2026-09-15 出口合并轮：保存/另存为/导出统一（2026-09-15 追加）

### 负责人决策链（[from-user 2026-09-15]）

「保存/另存为/导出三个功能合并成一个出口」→ 收敛为「保存=可编辑文档（仅此一种）」+「另存为与导出合并」→「保存的 .json 与 Graph JSON 是否重复？不重复则保存只留 .mindmap」。最终定稿（PRD §8.2 / ADR 0012 v1.3.0）：

- 保存 ⌘S：仅 `.mindmap`（既有 .json 文档打开兼容不变）；
- 存储为… ⇧⌘S（⌘E 同入口）：统一面板五格式分两组（可编辑文档 .mindmap / SVG / PNG 2x / PDF / Graph JSON）；
- 选导出格式且文档从未保存过：自动补写同名 .mindmap 并绑定为文档目标（防源文档丢失，面板内预告）。

### 实现与两个追加修复

- `c54e1b5`：macOS 自承载 NSSavePanel 分组 popup（分隔线 + 扩展名联动 + 兜底提示行）；host 新增 `platform_request_unified_save_authorization`（按格式签发 Document/Export 授权 + 兜底双授权）；前端 `unifiedSaveFlow`（文档路由走保存队列、导出路由共享冻结/渲染/提交段）；应用内导出浮层与视图菜单直出项移除；⌘E 不再有菜单 owner，经 renderer keydown 进入同一命令（注释记录 exactly-once 豁免理由）。
- `7b67fd1`：AppKit name field 无法无损显示 `.graph.json` 双段扩展名（吞中段）——allowedFileTypes 限单段 + allowsOtherFileTypes 透传 + host 落盘前按选择器规范化路径。
- `330b298`：Graph JSON 导出扩展名改为纯 `.json`（保存侧 .json 选项移除后无歧义，双段扩展名问题随之消失；Graph JSON 为单向导出产物，无迁移负担）。

### 验证

- cargo test 214 passed + clippy 干净；pnpm typecheck / lint 干净；test:unit 723/726（3 项红 = §十一 清理事故的 verify-decision 证据缺失，重冻结进行中）。
- 原生全路径 **32/32 PASS**（`.tmp/dogfood-2026-09-15/ofr-native-evidence.json`，source `330b298` clean，DMG sha256 `cd58dff6cd5846e1…`）：首启引导、默认文楷、单击放光标、整理/拖动/撤销重做、保存单一 .mindmap、统一面板五格式分组、Graph JSON 与 SVG 经统一面板导出落盘（含扩展名联动、跨行长文本完整、描边模拟、已保存文档不产生兜底文件）。
- 驱动修正披露：S5/S6 改为驱动统一原生面板；SVG 长文本断言改为跨 tspan 拼合（软换行产物）；faux-bold 描边断言落到 tspan（导出处 stroked tspan，stroke-width=字号×1/32）。
- 环境干扰：锁屏再次阻断一轮跑批（保活方案 `caffeinate -u` 循环已加入验证流程）；S5b 曾因保存 sheet 关闭后焦点漂移丢 ⇧⌘S（驱动补 activate）。
- 未运行项：Windows、advisory、性能 20 轮、VoiceOver。

### 交接

- 新候选已安装至 /Applications（DMG `.tmp/dogfood-2026-09-15/Mind Map_0.1.0_aarch64.dmg`）。
- verify-decision 证据重冻结按负责人批准的方案 B 执行中（证据迁入版本库 docs/quality/evidence/g1/ + register 路径与哈希重冻结）。

### 追加：出口合并轮负责人实机反馈两项（`f5e395b`，同日闭环）

1. **兜底提示截断**：统一面板"导出格式不能重新打开编辑；将同时保留可编辑源文件"单行 330px 放不下被截断——拆两行 + accessory 加高（72px），实机截图验证完整显示。
2. **首节点橙卡**（[from-user] 新需求）：空文档第一个节点自动 `emphasis: true`（橙色"出发点"卡，"记得我们的出发点在哪里"）。规则锚定空文档（含 pending 判定），非追溯、可手动开关；CreateNode 命令新增可选 `emphasis`（原子单命令，撤销一次整体回退）；几何屏障 intent 携带传递。ADR 0010 v1.1.0 记录"不自动派生"的例外条款；PRD §6 注记。core/ui 定向测试 4 项（应用/撤销/并发 pending/删光重建）。
- 实机验证截图：`verify-orange-origin.png`（首节点橙卡）、`verify-hint-twoline.png`（提示两行完整）。
- 新候选 source `f5e395b`，DMG sha256 `645689e1399e077a…`，已安装 /Applications。
