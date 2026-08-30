# MRT-002 验收报告

## 结论

**MRT-002：ACCEPTED。下一步解锁 MRT-003。**

`History.redo()` 已恢复为纯 cursor 移动，能够返回原历史节点、原对象引用和原 StateIdentity。DocumentSession 的 dirty 状态因此重新符合 ADR 0003：保存点对应的历史状态在 undo 后为 dirty，redo 回该保存点后重新 clean；分叉编辑仍会获得新的 identity。

本次未发现需要退回 MRT-002 的中大型问题。验收时发现一处小型测试缺口：ObservedDocumentSession 只验证了 command 与 undo，没有显式验证 redo 观察事件。已按既定原则直接在 `apps/desktop/src/app/app-integration.test.tsx` 补齐，断言 `CreateNode`、`undo`、`redo` 各广播一次；没有修改产品实现。

## 契约验收

| 契约 | 结果 | 证据 |
| --- | --- | --- |
| H1：redo 返回原历史节点 | PASS | 对象引用、identity 与 canonical state 均与原节点相同 |
| H2：多级 undo/redo 稳定 | PASS | S0/S1/S2 往返不重建节点或 identity |
| H3：undo 后分叉 | PASS | redo 分支被截断，新节点使用未出现过的 identity |
| H4：历史边界 | PASS | 不可 undo/redo 时返回 `null`，current 不变 |
| D1：保存 S2 后 undo/redo | PASS | dirty 为 `false → true → false` |
| D2：保存 S1 后编辑/undo/redo | PASS | dirty 为 `false → true → false → true` |
| D3：in-flight 保存后先 undo | PASS | 回执只确认冻结快照；redo 回保存点后 clean |
| D4：in-flight 保存期间 undo/redo | PASS | 回执完成时当前节点等于快照，保持 clean |
| S1：保存排队回归 | PASS | 请求均有终态，commit 次数正确，队列归零 |
| O1：观察事件 | PASS | `CreateNode`、`undo`、`redo` 各广播且只广播一次 |

## 代码审查结果

- `packages/core/src/history.ts` 的 redo 不再调用 `applyCommand()`，只递增 cursor 并返回 `current`。
- 原历史 entry 不被覆盖，command/inverse 结构没有无关改动。
- `packages/core/src/document-session.ts` 的 saved identity、in-flight snapshot 与 pending-save gate 未被绕开。
- MRT-001/MRT-001A 的保存串行、二次替换 gate、冲突终态继续成立。
- 修改范围内未发现以 canonical 深比较替代 identity、复用旧 identity 或跟随 cursor 移动 saved identity 的实现。

## 自动化复验

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @mindmap/core test` | PASS：6 files / 63 tests |
| MRT-002 专项四文件 | PASS：4 files / 54 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm quality` | PASS：24 files / 230 tests，全部现有阶段通过 |
| `pnpm build` | PASS；保留既知 wasm、字体和 JS 大资源警告 |
| changed-scope Prettier | PASS |
| `git diff --check` | PASS |

`quality-negative-drift` 在内部故意打印失败样例后由外层测试判 PASS，这是负向门禁的预期输出，不是本轮失败。

## 小问题现场修复

文件：`apps/desktop/src/app/app-integration.test.tsx`

- observation sink 增加 `undo`、`redo` 记录。
- 集成测试真实调用 undo 与 redo。
- 精确断言三类观察事件按顺序各出现一次。

该修复只提高回归覆盖率，不改变 App 行为、保存状态机或产品规格。

## 未纳入本卡的问题

- 原生窗口关闭目前仍只依赖浏览器 `beforeunload`，属于 MRT-003。
- launch intent 的订阅、ack 与多窗口拓扑属于 MRT-004。
- 构建资源体积警告、全仓格式基线和发布证据真实性按后续总整改卡处理。

## 解锁决定

MRT-003“实现 Tauri 原生 dirty-close 三分支”转为 READY。MRT-004 继续锁定，必须等待 MRT-003 的 Rust、TypeScript 与真实 macOS 三分支证据全部复验通过。
