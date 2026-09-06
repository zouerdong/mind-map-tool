# VRA-020：视觉样式 schema 与文件兼容（交付记录）

日期：2026-09-06。执行依据：[VRA-020 卡](../plans/visual-alignment-task-cards-2026-09-06.md)；[ADR 0010](../../docs/decisions/0010-visual-style-schema.md)（**G-SCHEMA 2026-09-06 项目负责人批准，Accepted**）。状态：**完成**。

## 交付

1. **PRD 增补**（`docs/product/v1-product-spec.md`，G-VIS 结论落档）：§5.1 整理行改写（默认横向分层、可选纵向、保留多父/环/孤立、800ms、正交折线无重叠）、主题行（暖白 `#F9F8F4`，覆盖纯白措辞）、节点形态行（实心卡默认，覆盖描边措辞）、新增强调/眉题/连线外观三行；AC-15 同步更新（含结构化失败）。
2. **ADR 0010 Accepted**：kicker（≤40 字、无换行）/emphasis（默认 false）/lineStyle（默认 solid）；**读旧写新**（v1 读取不改坐标尺寸、缺省呈现、不 dirty；保存=新写恒 v2；≥3 只读拒绝；不批量迁移）；缺省值归一（空 kicker/false/solid 内存即缺省——roundtrip 恒等、v1 文件逐字节兼容）；三条单命令（SetNodeKicker 携带注入 measured 尺寸原子提交；SetNodeEmphasis；SetEdgeLineStyle）。
3. **实现**：`schema.ts`（类型/LIMITS.maxKickerLength/校验/归一/emptyDocument→v2）、`commands.ts`（三命令 + inverse + cloneDocument 保留来源版本与新字段 + fail-closed 校验）、`canonical.ts`（encode v2、字段序 kicker/emphasis 紧随 shape、lineStyle 紧随 targetNodeId、缺省不输出、FUTURE_VERSION ≥3）。

## 验证（实际命令与结果）

- 新增 `packages/core/src/visual-style.test.ts`（11 用例）：v1 读取内容/坐标/尺寸不变且新字段缺省；v2 roundtrip（kicker/emphasis/lineStyle 重开一致 + decode∘encode 恒等）；缺省不落盘（bytes 断言）；kicker 非法三例（非 string/换行/41 字拒绝、恰 40 合法）；emphasis/lineStyle 非法拒绝；SetNodeKicker 原子提交与一次 undo 恢复 kicker+size；非法值（换行/超长/坏 measured/不存在 id）拒绝且文档不变；emphasis/lineStyle 提交-undo-归一；RestoreSelection 保留全部新字段；命令不降级 schemaVersion（v1 编辑后保存输出 v2 且携带 emphasis）；
- `canonical.test.ts` 未来版本测试更新为 ≥3（并补 v2 可读、encode 恒 v2、v1 可读断言）；
- 全套：core 7 files/80 tests；全仓 `pnpm test:unit` 30 files/297 tests；typecheck/lint/build（1.5MB chunk 警告为 MRT-011 既有项）/boundaries/`git diff --check` 全 PASS。

## 关键决定

- 缺省归一放 schema 层（validate 输出即归一形态）——比在 canonical/命令层各自归一更稳，内存表示唯一；
- `cloneDocument` 修正：保留 `doc.schemaVersion`（原硬编码 1 会把 v2 文档降级）与 kicker/emphasis 字段；
- 保存即 v2 的语义落在 encode（所有"新写"路径统一，不依赖调用方记得升级）；
- CreateNode 不携带 kicker/emphasis（创建后单独设置——最小字段集，未预埋）。

## 给下一卡的接口

- **VRA-040**：`kicker/emphasis/lineStyle` 为导出共享解析的输入；export golden 需补 v2 fixture（含三种 lineStyle 与眉题排版）；
- **VRA-050**：三条命令为操作面（上下文工具条）的提交通道；`measured` 由共享 FontResolver 测得后随命令提交；
- 未做（显式）：文档级视觉 profile（ADR 0010 排除）、批量迁移、任意样式字符串。
