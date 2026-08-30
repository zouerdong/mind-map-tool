# MRT-001A 开发指导与任务卡

## 1. 任务定位

**优先级：P0**  
**状态：READY**  
**前置：MRT-001 主路径实现保留，但尚未验收通过**  
**后续：本卡复验通过后才解锁 MRT-002**

本卡只解决一个根因：**pending save 与 document replacement 目前没有原子边界。** Core 把保存队列清掉，App 仍持有等待者，二者生命周期分裂。

这不是给 waiter 增加 timeout 就能解决的问题。Timeout 只掩盖悬挂，无法阻止旧 commit 与新文档串扰，也无法说明磁盘上究竟写入了哪一代文档。

## 2. 必须成立的系统不变量

实现完成后，下列条件必须同时成立：

1. **单文档代际**：一个 DocumentSession 在任意时刻只服务一个 document generation。
2. **单提交链**：同一 session 同时最多一个 host commit；切换文档不能靠清空内存伪装提交已结束。
3. **请求有终态**：每个已经返回 Promise 的保存请求恰好 resolve 一次，不悬挂、不重复 resolve。
4. **终态不跨代**：旧 generation 的 receipt/error 不得更新新 generation 的 saved identity、handle、token、displayPath、dirty、notice 或 waiter。
5. **替换原子化**：new/open/launch-open 要么完整替换文档，要么返回 typed busy 并保持旧 session 完全不变。
6. **无隐式取消**：host commit 当前没有可靠 cancel 能力，因此不得把内存清理包装成“已取消”。

## 3. 推荐方案

推荐采用 **pending-save gate**，不引入虚假的 commit cancellation：

- DocumentSession 暴露统一的 `hasPendingSaves`（或等价只读状态），语义覆盖 in-flight 与 queued。
- 文档替换 API 改为可判别结果，例如 `replaced | save-pending`；pending 时不得修改 history、identity、target、inFlight 或 queue。
- `openDocumentFlow`、`openPathFlow`、`newDocumentFlow` 在动作开始前检查一次，并在所有 `await` 之后、真正 adopt/load 前再次原子检查，封住 TOCTOU。
- UI 收到 `SAVE_IN_PROGRESS` 时显示非致命提示，例如“保存完成后再新建/打开”，不弹 discard，也不替换当前文档。
- 保存链自然结束后，用户可重试新建/打开。不要自动替用户重放打开对话框或切换动作。

为什么优先这个方案：当前 FilePort/host 没有可证明的 commit cancellation。阻止文档替换比引入 generation cancellation 更小、更可验证，也不改变磁盘提交事实。

如果实现者认为必须支持“保存中立即切换”，应先写 ADR，定义 commit cancellation、旧回执处置、授权回收和 UI 语义，交项目负责人批准后再改；不得在本卡中自行扩张。

## 4. 允许修改范围

- `packages/core/src/document-session.ts`
- `packages/core/src/document-session.test.ts`
- `packages/core/src/index.ts`（仅导出必要类型）
- `apps/desktop/src/app/file-commands.ts`
- `apps/desktop/src/app/file-commands.test.ts`
- `apps/desktop/src/app/mindmap-app.tsx`
- `apps/desktop/src/app/app-integration.test.tsx`
- 必要时调整最小 fake port/test helper

不要修改：

- history/redo 实现；那属于 MRT-002。
- Tauri native close；那属于 MRT-003。
- launch 多窗口架构；本卡只让当前 launch-open 在 pending save 时 fail closed，完整多窗口属于 MRT-004。
- export、schema、organize、quality evidence。
- CI/CD、发布配置、依赖和锁文件。

## 5. 实施步骤

### 步骤 A：先补失败测试

先写测试并证明至少以下两条在现实现下失败：

- 第一次保存挂起 + 第二次保存排队 + new：new 返回 busy，两个保存请求最终都有终态。
- 第一次保存挂起 + openPath 读取完成：adopt 前返回 busy，原文档、target、dirty 完全不变。

禁止用缩短 timeout 或直接 resolve waiter 的方式让测试变绿。

### 步骤 B：收口文档替换 API

- 为 session 增加能同时反映 `inFlight || queue.length > 0` 的只读状态。
- 把 `load()` 的“无条件清空 pending save”改成 fail-closed 的 typed transition。
- pending 时返回后，session 所有字段逐项保持不变。
- 没有 pending 时，保持现有 open/new：替换文档、清历史、设置 clean，之后 open 可 adopt 新 target。

### 步骤 C：更新 App 文件流

- `newDocumentFlow` 在 pending 时返回稳定的 `SAVE_IN_PROGRESS` 错误，不调用 discard callback，不调用 load。
- `openDocumentFlow/openPathFlow` 至少在调用 FilePort 前和 adopt 前检查；第二次检查失败时不得替换当前 session。
- 处理第二次检查失败时取得的 opened handle：记录 capability 生命周期风险；若现有 ledger 没有 revoke API，不在本卡扩展平台层，但必须保证该 handle 不进入 session、不被后续保存使用，并在回报中列入 MRT-003/004 收口项。
- MindMapApp 把 busy 映射为非致命 notice；不得显示“已新建/已打开”。

### 步骤 D：证明 waiter 与队列仍一一对应

- pending gate 生效后，`session.load()` 不再清掉仍有 app waiter 的 core intent。
- 成功时按 FIFO 一对一 resolve；失败时当前和剩余 waiters 各 resolve 一次。
- 失败后允许用户发起全新保存；旧 waiter 数组不得影响新请求。
- 不把 `Promise.race(timeout)` 写进生产代码。

### 步骤 E：回归小门禁

- 保留 MRT-001 的 8 个文件流测试，不删断言。
- core 专项脚本必须可执行并找到测试。
- 只格式化本卡触及文件，不顺带格式化全仓库基线。

## 6. 必测场景

### 保存与 New

1. ordinary save 挂起，第二次 ordinary 排队；New 返回 `SAVE_IN_PROGRESS`，不执行 discard callback。
2. 释放提交后两个 save Promise 都成功，队列为 0；此后再次 New 成功。
3. 第一次提交冲突/IO 失败时，两个 save Promise 都得到同一失败类别；New 在终态后可重试。
4. Save As 挂起 + ordinary 排队；New 同样被 gate。

### 保存与 Open

5. save 已 pending 时点击 Open：不得打开对话框，或即使产品选择先读，也不得 adopt/load。
6. Open 已开始读取，随后 save 进入 pending；read 完成后的第二次 gate 必须阻止 adopt，原 target/identity/dirty 不变。
7. launch `openPathFlow` 同样 fail closed，不能替换当前文档。

### 不变量与竞态

8. gate 返回 busy 前后逐项断言 document、identity、handle、token、displayPath、dirty、queue、inFlight。
9. 旧保存完成后不会出现“已打开/已新建”错误 notice。
10. 连续三次保存仍恰好三次 commit；无对话框误触发，无自旋。
11. 所有公开 flow Promise 用测试门闩证明终态，不允许 timeout。
12. 无 pending 时原有 new/open/save 行为不回归。

## 7. 验收命令

先执行专项：

```bash
pnpm --filter @mindmap/core test
pnpm exec vitest run packages/core/src/document-session.test.ts apps/desktop/src/app/file-commands.test.ts apps/desktop/src/app/app-integration.test.tsx
```

再执行完整检查：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm quality
pnpm build
pnpm exec prettier --check packages/core/package.json packages/core/src/document-session.ts packages/core/src/document-session.test.ts packages/core/src/index.ts apps/desktop/src/app/file-commands.ts apps/desktop/src/app/file-commands.test.ts apps/desktop/src/app/mindmap-app.tsx apps/desktop/src/app/app-integration.test.tsx
git diff --check
git status --short
```

如果某个列出的文件未被本卡修改，也保留在 changed-scope 格式检查中；全仓 `pnpm format:check` 的既有红灯不归本卡处理，但不得新增红灯。

## 8. 完成回报格式

后续 Agent 必须按下面顺序回报：

1. 根因与采用的状态机不变量。
2. 先失败测试的名称和失败证据。
3. 修改文件清单及每个文件职责。
4. 12 个必测场景的覆盖映射。
5. 专项与完整命令的退出码/摘要。
6. commit 次数、dialog 次数、queue、inFlight、dirty、handle/token 的关键断言。
7. opened capability 未 adopt 时的处置与残余风险。
8. `git diff --check` 和 `git status --short`。
9. 明确声明没有修改 MRT-002/003/004、质量证据、CI/CD 或发布配置。

## 9. 解锁规则

MRT-001A 由审查者复验通过后：

- MRT-001 状态改为 ACCEPTED。
- 按原整改总卡启动 MRT-002“恢复历史 identity 与 dirty 契约”。
- 不允许同一 Agent 在未复验的情况下顺手进入 MRT-002。

