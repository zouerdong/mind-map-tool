# ADR 0010：视觉样式 schema（眉题/强调角色/线型）与文件兼容

- Status: **Accepted**（G-SCHEMA 批准，2026-09-06 项目负责人）
- Date: 2026-09-06
- Deciders: 项目负责人（G-VIS 2026-09-06 已确认产品语义 D1–D8；本 ADR 为其 schema 落地契约）
- 依据：PRD §5（眉题/强调/线型/整理/主题行，G-VIS 增补）、AC-15；visual-state-tokens-2026-09-06 §5.1 方向 A；ADR 0003（core schema/session/save）

## Context

G-VIS 用户确认了三项新的持久化视觉语义：节点可选眉题（kicker）、节点普通/强调角色（emphasis）、边实/虚/点线型（lineStyle）。这些必须随文档保存、可 undo、在导出中不丢失，且不得破坏既有 v1 用户文件。现有 schema v1 无这些字段。

## Decision（ Proposed ）

### 1. 字段（最小集，无预埋）

节点级（`MindNode`，全部可选）：

- `kicker?: string` —— 单行眉题；≤ 40 字符；默认缺省（= 无眉题，卡高自然）；不得包含换行（命令层校验拒绝）；
- `emphasis?: boolean` —— 强调角色；缺省 `false`；不自动派生。

边级（`MindEdge`）：

- `lineStyle?: "solid" | "dashed" | "dotted"` —— 缺省 `"solid"`；纯外观，参与布局与层级语义不变。

文档级：**不新增**视觉 profile 字段（暖白/黑板沿用既有 `theme: "light" | "dark"` token 映射升级，不引入 profile 版本机制；若未来需要再另立 ADR）。

禁止：任意 CSS 字符串、参考业务分类枚举（PLAN/BUILD 等）、UI 选择态/路径缓存/动画进度/viewport 入文件（沿用 ADR 0003 红线）。

### 2. schemaVersion 与兼容

- 新写文件 `schemaVersion: 2`；`schemaVersion: 1` 仍可读；
- **读旧（v1）**：按缺省值呈现（无眉题、普通角色、实线）；**不修改旧文件坐标、尺寸、文本；读取本身不触发 dirty**；首次编辑保存时写 v2（一次自然升级，不批量迁移）；
- 未知未来版本（≥3）拒绝（沿用现有行为）；
- **不做**任何自动批量迁移或用户目录内文件改写。

### 3. canonical 与校验

- canonical 序列化：节点输出顺序中 `kicker`、`emphasis` 紧随 `shape`/`runs` 之后（固定字段序）；边 `lineStyle` 紧随 `targetNodeId`；缺省值**不输出**（保持文件精简与 v1 逐字节兼容的升级路径）；
- 校验：`kicker` 非 string / 含 `\n` / 超 40 字符 → 结构化错误；`emphasis` 非 boolean → 错误；`lineStyle` 非三枚举之一 → 错误（fail-closed，与既有 schema 行为一致）。

### 4. 命令与几何原子提交

新增三条单命令（各自可撤销、触发 dirty、进入历史）：

- `SetNodeKicker { id, kicker }`（空串 = 清除，等价缺省）
- `SetNodeEmphasis { id, emphasis }`
- `SetEdgeLineStyle { id, lineStyle }`

几何原子性（PRD/tokens 契约）：眉题增删改变节点高度——**命令层接受注入的已测尺寸**（`measured?: { width, height }`，由调用方经共享 FontResolver 测得后随命令提交）；core 不引入字体库/DOM，本 ADR 阶段以注入尺寸的纯测试验收；真实测量联调归 VRA-040/050。内容/样式与权威 `size` 作为同一条历史提交，任一失败不部分提交。`SetEdgeLineStyle` 不影响几何。

既有命令语义不变：删除/恢复/克隆/文本编辑/分叉 undo 均保留新字段（inverse 快照携带）；`MoveNodes` 与创建/编辑路径继续校验 finite/范围/正尺寸。

### 5. 超限与上限

`kicker` 长度上限 40 字符进入 `LIMITS`（`maxKickerLength: 40`）；其余沿用既有上限。

## Consequences

- 正：v1 文件零破坏；新语义最小字段集；几何测量留在共享 FontResolver（无 core 依赖污染）；导出/undo/重开一致。
- 负/成本：schema v2 触碰 canonical/golden（export golden 需新增 v2 fixture，属 VRA-040 范围）；`kicker` 注入尺寸的命令签名略复杂。
- 不做：文档外观版本/profile、批量迁移、任意样式字符串（均显式排除）。

## Verification（批准后的实施验收，VRA-020 卡内）

v1 文件读取不丢内容、外观缺省呈现、不 dirty；v2↔v1 save/open roundtrip；未知/非法字段（三种）fail-closed；三条命令 undo/redo、分叉 dirty、in-flight save；删除恢复/克隆保留新字段；kicker 换行/超长拒绝；注入尺寸的原子提交（失败不部分提交）；中英文/多行/runs 混合不回归。
