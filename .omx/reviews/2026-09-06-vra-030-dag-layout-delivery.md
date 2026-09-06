# VRA-030：DAG 分层布局（交付记录）

日期：2026-09-06。执行依据：[VRA-030 卡](../plans/visual-alignment-task-cards-2026-09-06.md)；G-VIS 定稿契约（D7 横向默认/纵向可选、D8 布线归 VRA-040）。状态：**完成**。

## 实现

`packages/core/src/organize.ts` 全量重写（替换 MM-085 的 DFS 生成树实现）：

- **SCC 缩点**（Tarjan 迭代显式栈，10k 深链不爆调用栈）：环/双向边分量内同层并排，原文档边不删不翻向；
- **最长前驱层级**（缩点 DAG 上 Kahn 拓扑 + 最长路径 DP）：source→target 严格靠后、短跨层边不拉回目标、多父恰放一次；
- **方向**：`organize(doc, { direction })` 默认 `"horizontal"`（G-VIS D7），纵向轴对称转置（沿/跨轴尺寸随方向互换）；
- **孤立节点**：横向主图下方成行（首项左齐第一列）/ 纵向右侧成列（首项顶齐第一层）；全孤立文档从 0 起排；
- **确定性**：邻接索引一次构建 + 重复边去重；层内排序 = (scc 最小文档序, 节点文档序)；与当前坐标、边数组顺序无关；
- **结构化失败**：`OrganizeResult = ok{positions} | error{COORD_LIMIT}`；10k 单链 span 超过 `LIMITS.maxCoordAbs` 返回错误，不产非法坐标、不动文档与历史；
- `organizeCommand` 三态：`moved`（单条 MoveNodes）/ `no-op` / `error`；调用方 `mindmap-app.tsx` onOrganize 同步三态（错误为可行动 notice，不显示"已整理"）。

## 验证（实际命令与结果）

- `pnpm --filter @mindmap/core test`：6 files / **69 tests 全过**（organize 18 用例：三角+6 边序置换全同、diamond、多根汇聚、负坐标无关性、双向边/三环、孤立双向、无边/单节点/空文档、尺寸感知列宽行距、12 节点参考 DAG 五层+孤立下移、300/450 随机 DAG 无重叠、10k 链 COORD_LIMIT、幂等 no-op、转置对称、MoveNodes 全覆盖）；
- `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test:unit`（29 files 286 tests）/ `check-boundaries --scope selected-canvas` / `git diff --check`：全部 PASS（build 的 1.5MB chunk warning 为 MRT-011 既有登记项）；
- 通用不变量（每用例断言）：全节点恰好一次、坐标 finite、全对矩形无重叠。

## 关键决定

- 布线（电路线/通道分配）不在本卡——VRA-040 共享几何负责；本卡只产出目标坐标（层×堆叠网格）；
- `ORGANIZE_GAPS` = { intraGap 38, layerGap 82, orphanGap 120 }（G-VIS tokens §1.5 节奏）；
- 10k 链在坐标上限内放不下（span ≈ 2.7M > 1M）→ 按任务卡验收为结构化失败，不引入折行等未定义行为；
- 调用方 `mindmap-app.tsx`/`organize.integration.test.tsx` 仅做三态与文案适配（"垂直树"→"分层布局"），未混入 W2R2 生命周期改动（选择性暂存提交，工作树保留 W2R2 未验收改动）。

## 给下一卡的接口

- **VRA-040**：`organize()` 输出的层×堆叠网格坐标即布线输入（层列/堆叠行/孤立组分组可由坐标+尺寸重建；或后续按需导出分组元数据）；
- **VRA-060**：`organizeCommand` 的 moved/moves 即动画终态；no-op/error 即动画不启动的两类前置；
- **VRA-050/070**：方向参数待 UI 偏好接线（当前默认横向，无 UI 切换入口——属 VRA-050 操作面范围）。
