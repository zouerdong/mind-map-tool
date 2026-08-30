# MRT-001 验收报告

## 结论

**验收结果：未通过，状态保持 BLOCKED。MRT-002 暂不解锁。**

MRT-001 已正确修复原问题的主要路径：保存请求结果不再使用多义 `null`，ordinary/save-as intent 可以原子出队，连续两次和三次保存不会自旋，失败时排队请求可以收到失败终态。但文档切换边界仍破坏“每个请求恰好一个终态”的完成定义：保存进行中调用 `load()` 会静默清空 core 的 in-flight/queue，却没有通知 app 层等待者。

该缺陷属于状态机和数据安全问题，不做验收现场补丁；应按 `MRT-001A` 独立修复并复验。

## 已通过部分

- `requestOrdinarySave()` 已区分 `no-target / queued / snapshot`。
- `takeNextSaveIntent()` 取出即出队，成功路径不再无限重复 commit。
- 排队 Save As 保留 Save As 语义，不会降级为 ordinary。
- 两次/三次快速保存、保存期间继续编辑、Save As 排队、取消、冲突、失败重试均有跨层测试。
- `pnpm quality` 通过：24 个测试文件、213 个测试全部通过。
- `pnpm build` 通过；typecheck 与 lint 通过；`git diff --check` 通过。

## 阻断问题 MRT1-A01：文档切换会让排队保存 Promise 永久悬挂

### 根因证据

- `packages/core/src/document-session.ts:113-125`：`load()` 无条件把 `inFlight` 设为 `null`、把 queue 清空。
- `apps/desktop/src/app/file-commands.ts:41-44,188-249`：排队请求的 Promise waiter 存在 app 层 WeakMap，core 清队时没有终态通知。
- `apps/desktop/src/app/file-commands.ts:92-109,141-148`：打开/新建最终直接调用 `session.load()`，没有 pending-save gate。
- app waiters 只按 session FIFO 配对，没有 document generation；旧保存回执可与切换后的新文档请求串扰。

### 运行时复现

使用 Vite 内存 bundle 执行以下时序，不创建或修改源码文件：

1. 打开已有文件并编辑。
2. 第一次 `saveFlow()` 挂起在 FilePort gate。
3. 第二次 `saveFlow()` 入队并返回等待 Promise。
4. 调用 `session.load(emptyDocument())` 模拟新建/打开。
5. 释放第一次提交，并以 100 ms timeout 观察第二个 Promise。

实际输出：

```json
{
  "firstResult": "ok",
  "secondResult": "TIMEOUT",
  "commits": 1,
  "queued": 0,
  "inFlight": false,
  "dirty": false
}
```

这证明 core 表面已清空队列，但第二个调用者永远等不到终态。更危险的变体是：切换后立即保存新文档，旧回执/失败会对同一 session 的新 waiters 执行 `resolve/failPendingWaiters`，造成跨文档 generation 错配。

## 验证矩阵

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm exec vitest run apps/desktop/src/app/file-commands.test.ts` | PASS | 8/8 |
| `pnpm quality` | PASS | 24 files、213 tests；现有总门禁范围仍有限 |
| `pnpm typecheck` | PASS | 全 workspace |
| `pnpm lint` | PASS | 全 workspace |
| `pnpm build` | PASS | 仍有既知大 chunk/字体体积警告，不归本卡 |
| `pnpm --filter @mindmap/core test` | 初次 FAIL | package script 的 Vitest root 错误；已作为小问题直接修正并待最终复验 |
| `pnpm format:check` | FAIL | 仍有 43 个既有未格式化文件；本卡触及的 `app-integration.test.tsx` 已直接格式化 |
| 运行时切换探针 | FAIL | `secondResult=TIMEOUT`，本次阻断依据 |

## 本次验收直接修复的小问题

依据“小问题现场修、大问题发卡”的原则，本次直接处理：

1. `packages/core/package.json` 的测试脚本改为从 workspace root 定位 `packages/core`，使任务卡规定的专项命令可执行。
2. 对本卡已修改的 `apps/desktop/src/app/app-integration.test.tsx` 执行局部 Prettier；没有格式化其他 43 个基线文件。

## MRT-001A 通过条件

- 新建、打开、launch open 不得在 pending save 时静默替换 session。
- 所有已返回的 `saveFlow/saveAsFlow` Promise 必须在成功、失败、冲突、取消或明确 busy/cancelled 终态之一恰好 resolve 一次。
- 旧文档保存的成功/失败不得改变新文档的 identity、handle、token、dirty、notice 或 waiter。
- host 同一 session 不得因 `load()` 清状态而同时存在旧、新两个 commit。
- 本报告中的运行时序必须变成受控结果，不允许 timeout。
- MRT-001 与 MRT-001A 的全部回归、`pnpm quality`、build、changed-file format、core 专项测试全部通过后，才可解锁 MRT-002。

