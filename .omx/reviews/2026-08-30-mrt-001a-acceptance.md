# MRT-001A 验收报告

## 结论

**MRT-001A：ACCEPTED。MRT-001 同步转为 ACCEPTED。下一步解锁 MRT-002。**

本次实现建立了 pending-save gate：DocumentSession 在存在 in-flight 或 queued save 时拒绝 `load()`，New/Open/launch-open 在调用外部端口前以及 await 后的实际替换点都 fail closed。原先悬挂的排队 Promise 现在由原保存链自然送达终态，旧保存回执没有机会进入新文档 generation。

没有发现需要现场修改的小型代码问题；本次验收只新增验收与下一阶段指导文档，没有改动产品实现。

## 不变量验收

| 不变量 | 结果 | 证据 |
| --- | --- | --- |
| 单文档代际 | PASS | pending 时 `load()` 返回 `save-pending`，history/identity/target 不变 |
| 单提交链 | PASS | 文档替换不再清空 in-flight；旧链完成前不能开始新 generation |
| 每个保存请求有终态 | PASS | 两次保存均在 gate 释放后 `ok`；冲突时当前与排队请求均得到 conflict |
| 终态不跨代 | PASS | 新 generation 在保存链归零前无法建立 |
| 替换原子化 | PASS | `replaced / save-pending` 可判别；Open await 后由 core 同步二次 gate |
| 无虚假取消 | PASS | 未加入 timeout/cancel 模拟；host commit 自然完成或失败 |

## 运行时复验

使用 Vite 内存 bundle 重跑上一轮失败时序：

```json
{
  "newResult": "error:SAVE_IN_PROGRESS",
  "directLoadResult": "save-pending",
  "firstResult": "ok",
  "secondResult": "ok",
  "retryNewResult": "ok",
  "commits": 2,
  "queued": 0,
  "inFlight": false,
  "dirty": false
}
```

验收点：New 和直接 load 都在 pending 时被拒；两个保存请求都得到终态；commit 恰好两次；保存链结束后 New 可重试成功；无 timeout、无残留队列。

## 自动化结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @mindmap/core test` | PASS：6 files / 55 tests |
| MRT-001/001A 专项三文件 | PASS：3 files / 42 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm quality` | PASS：24 files / 222 tests，全部现有阶段通过 |
| `pnpm build` | PASS；仍有既知大 chunk/字体体积警告 |
| 任务卡 changed-scope Prettier | PASS |
| `git diff --check` | PASS |
| 全仓 `pnpm format:check` | FAIL：42 个既有基线文件，不由本卡扩张处理 |

## 已覆盖场景

- 保存挂起 + ordinary 排队 + New busy，终态后 New 可重试。
- OpenPath 读取中保存进入 pending，adopt 前二次 gate 阻止替换。
- 首提交冲突，当前与排队保存同获终态，随后 New 可重试。
- Save As 挂起 + ordinary 排队，New 同样被 gate。
- pending 时 Open 不打开文件对话框。
- pending 时 launch open 不发起读取。
- document、identity、handle、token、displayPath、dirty、queue、inFlight 逐项不变。
- 原 MRT-001 的连续两次/三次保存、对话框次数与提交次数回归保持通过。

## 保留到后续卡的问题

以下不阻断 MRT-001A，但不得遗忘：

- Open 已取得 handle 后被二次 gate 拒绝时，host ledger 暂无显式 revoke；在 MRT-003/004 结合窗口 capability 生命周期收口。
- launch adapter 仍可能在异步动作完成前 ack；归 MRT-004。
- 全仓格式基线、clippy、质量证据真实性等仍按总整改卡后续处理。

## 解锁决定

下一位 Agent 只执行 MRT-002“恢复历史 identity 与 dirty 契约”。MRT-003 继续锁定，必须等 MRT-002 复验通过。

