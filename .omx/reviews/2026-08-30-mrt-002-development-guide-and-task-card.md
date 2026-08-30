# MRT-002 开发指导与任务卡

## 1. 任务定位

**优先级：P0**  
**状态：READY**  
**前置：MRT-001 与 MRT-001A 已验收通过**  
**后续：本卡复验通过后才解锁 MRT-003**

本卡只修复一个根因：`History.redo()` 当前重新执行命令并创建新 StateIdentity，违反 Accepted ADR 0003 的历史节点语义，也让 DocumentSession 无法通过 identity 正确判断 dirty。

## 2. 当前错误

- `packages/core/src/history.ts:45-50` 的 undo 只移动 cursor，正确返回原历史节点。
- `packages/core/src/history.ts:52-64` 的 redo 却再次调用 `applyCommand()`，覆盖原 history entry 并分配新 identity。
- `packages/core/src/history.test.ts:81-94` 把错误行为写成了测试期望。
- `docs/decisions/0003-core-schema-session-save.md:30-33` 明确规定：undo/redo 返回原历史节点及原 identity；只有分叉编辑分配新 identity。

用户可见后果：保存 S2 → undo 到 S1 → redo 回完全相同的 S2 后，session 仍显示 dirty，关闭提示、标题和保存判断随之错误。

## 3. 必须成立的不变量

1. **历史节点稳定**：undo/redo 只移动 cursor；返回已经存在的 StateNode，不重新计算文档。
2. **对象与 identity 稳定**：redo 返回的 StateNode 应与原节点是同一个对象引用，其 identity 也完全相同。
3. **分叉新发 identity**：undo 后 commit 新命令会截断 redo 分支，并为新状态分配从未使用过的 identity。
4. **dirty 只比较状态身份**：当前 identity 等于 saved identity 时 clean，否则 dirty；不能改用栈下标、内容深比较或 revision 回绕。
5. **保存快照不被改写**：in-flight save 仍冻结开始时的 identity；undo/redo 不改变快照。
6. **无命令重放副作用**：redo 不调用 `applyCommand()`，因此不会重复 effects、重新计算 inverse 或引入未来非纯命令的风险。

## 4. 推荐实现

`History.redo()` 应与 undo 对称：

1. `canRedo === false` 时返回 `null`，history 完全不变。
2. `canRedo === true` 时只执行 `cursor += 1`。
3. 返回 `this.current`。

不要重新调用 `applyCommand()`，不要重新创建 StateNode，不要覆盖 `entries[cursor]`。`HistoryEntry.command/inverse` 本卡保持不动，避免无关数据结构重构。

## 5. 允许修改范围

- `packages/core/src/history.ts`
- `packages/core/src/history.test.ts`
- `packages/core/src/document-session.test.ts`
- 必要时增加只针对 dirty 标题/状态的最小 App 集成测试
- 本卡验收/回报文档

禁止修改：

- `packages/core/src/identity.ts` 的 identity 分配策略。
- command 实现、schema、canonical 格式。
- MRT-001/001A 的保存队列和 pending-save gate，除非新测试证明真实回归；遇到回归应停下报告，不顺手重写。
- UI 键位、原生关闭、多窗口、export、quality evidence、CI/CD、发布配置。
- ADR 0003。它已经 Accepted，代码必须回到 ADR，而不是反过来改 ADR 迁就现实现。

## 6. 实施步骤

### 步骤 A：先把错误测试改成正确契约并确认红灯

将“redo 产生新 identity”改为：

- redo 返回原 StateNode 对象。
- `redone === originalStateNode`。
- `redone.identity === originalStateNode.identity`。

先运行该测试并记录旧实现失败；不要先改实现再补测试。

### 步骤 B：最小修改 redo

只移动 cursor 并返回 current。同步修改误导性注释，使文件头、方法注释、ADR 三者一致。

### 步骤 C：补 DocumentSession dirty 回归

dirty 场景必须从真实保存回执建立 saved identity，不能直接篡改私有字段。

- 保存 S2 → undo 到 S1：dirty → redo 原 S2：clean。
- 保存 S1 → 编辑成 S2：dirty → undo S1：clean → redo S2：dirty。
- in-flight 保存 S2 → undo S1 → 回执完成：仍 dirty → redo S2：clean。
- in-flight 保存 S2 → undo S1 → redo S2 → 回执完成：clean。

### 步骤 D：补多级历史与分叉

- S0 → S1 → S2；反复 undo/redo，S0/S1/S2 的对象引用和 identity 每次都稳定。
- undo 到 S1 后 commit S3：redo 被截断；S3 identity 不等于任何旧 identity。
- 在首端 undo、末端 redo 返回 null，cursor/current 不变。

### 步骤 E：回归保存状态机

运行 MRT-001/001A 文件流测试，证明 identity 修复没有改变保存队列、pending gate、commit 次数或 Promise 终态。

## 7. 必测场景

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| H1 | do → undo → redo | redo 返回原对象、原 identity、原 canonical state |
| H2 | S0/S1/S2 多级往返 | 每一级对象与 identity 始终稳定 |
| H3 | undo 后分叉 commit | redo 截断；新 identity 从未出现过 |
| H4 | 无 undo/redo 可用 | 返回 null；current/cursor 语义不变 |
| D1 | save S2 → undo → redo | dirty：false → true → false |
| D2 | save S1 → edit S2 → undo → redo | dirty：false → true → false → true |
| D3 | save S2 in-flight → undo → receipt → redo | receipt 后 dirty；redo 后 clean |
| D4 | save S2 in-flight → undo → redo → receipt | receipt 后 clean |
| S1 | queued save + undo/redo | 每个请求终态、commit 次数、队列归零不回归 |
| O1 | ObservedDocumentSession redo | 仍只广播一次 redo observation，不重复 command effect |

若 O1 现有测试已经充分覆盖，可引用测试名，不必为了数量重复创建测试。

## 8. 风险控制

- 不要通过 canonical 内容相等来判 clean；这会改变 ADR 并增加大文档成本。
- 不要在 redo 时 clone StateNode；即使 identity 被复制，对象稳定契约仍被破坏。
- 不要重建 inverse；本卡不是历史系统重构。
- 不要把 saved identity 跟着 cursor 移动；saved identity 只能由 load 或成功保存回执建立。
- 不要删除旧 history entry；分叉 commit 之前 redo 分支必须可导航。

## 9. 验收命令

先执行专项：

```bash
pnpm --filter @mindmap/core test
pnpm exec vitest run packages/core/src/history.test.ts packages/core/src/document-session.test.ts apps/desktop/src/app/file-commands.test.ts
```

再执行完整检查：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm quality
pnpm build
pnpm exec prettier --check packages/core/src/history.ts packages/core/src/history.test.ts packages/core/src/document-session.test.ts
git diff --check
git status --short
```

全仓 `pnpm format:check` 当前存在 42 个已知基线文件；本卡不得新增，也不得顺手格式化无关文件。

## 10. 完成定义

- H1～H4、D1～D4、S1 全部有明确断言并通过。
- `History.redo()` 不再引用 `applyCommand()`。
- 保存点 dirty 变化与 ADR 0003 完全一致。
- MRT-001/001A 的 14 个文件流测试全部继续通过。
- changed-scope 格式、typecheck、lint、unit、quality、build、diff check 全部通过。
- 工作区没有本卡范围外的新修改。

## 11. Agent 回报格式

1. 旧行为的失败测试与失败输出。
2. redo 修改前后的状态转换说明。
3. 修改文件清单。
4. H1～H4、D1～D4、S1、O1 的测试映射。
5. 专项及完整命令结果。
6. 明确列出 StateNode 对象引用、identity 和 dirty 的关键断言。
7. `git diff --check` 与 `git status --short`。
8. 声明未修改保存队列、pending gate、ADR、质量证据、CI/CD 和发布配置。

## 12. 解锁规则

MRT-002 经审查者复验通过后，才能启动 MRT-003“实现 Tauri 原生 dirty-close 三分支”。不得在本卡内提前实现 close handler。

