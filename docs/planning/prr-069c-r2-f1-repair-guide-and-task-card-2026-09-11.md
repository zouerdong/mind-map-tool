# PRR-069C-R2-F1：修复指南与分阶段任务卡

状态：`STAGE_A_EXECUTED / STOP_FOR_CODE_REVIEW`；优先级 P1；阶段 B 未派发。

阶段 A 执行结果：source `32148097aaf9f7a9da0a7de8996de8583ad3c2d0`（clean），实施报告 [阶段 A 报告](../quality/prr-069c-r2-f1-stage-a-report-2026-09-11.md)；源码门全绿（release-runners 129/129、unit 651、integration/icon/build/cargo/clippy/diff-check）。本卡 §7 阶段 B 与 PRR-070 仍未解锁，需独立代码审阅接受并给出新 clean 基线。

基线：包含本文及状态同步的新 clean HEAD，必须为 `7d496a849a06c3149be706f4febe675f8503885f` 的后代。不得回退源码。

本卡承接 R2 独立审阅，不推翻已完成的工具注入校验、模块归位和挂载接管。旧 R2 卡的实现范围与禁令继续适用；执行顺序、目录协议及以下补充以本卡为准。

## 1. 为什么仍需返修

审阅范围：`ed30987fe64756cee3057d8c4f4320bef51335b1..7d496a849a06c3149be706f4febe675f8503885f`；patch SHA-256 为 `a804f4169b1961c3ebf73fc154bc0f7bb50c82a4d8c46a6c9fbbcd8e9e9b56dd`。

独立审阅结论为 REVISE。56 项证据 hash 吻合，三轮正常预检记录可信；未独立重跑全量测试或原生构建。三个反例用源码提取的内存隔离探针验证，无真实挂载、无文件写入：

| 编号 | 根因 | 反例 | 必须守住的性质 |
| --- | --- | --- | --- |
| F1 / P1 | `requireSuccess:false` 将“允许正常拒绝”扩大为允许任意执行失败 | 无挂载、超时、已输出 LICENSE marker，仍进入 verify-mount | 只有正常结束的拒绝结果才是有效 EULA 证据 |
| F2 / P1 | 清理时钟从 detach 前才启动；mount 查询不消费宽限；结束不更新耗时 | 前查询29秒 + detach59秒 + 后查询29秒，共117秒，记录0ms | 所有清理工作消费同一个60秒预算，耗时真实 |
| F3 / P2 | 根据已有目录内容推测归属 | 历史 attempt 只含 logs，new-work 被接受 | 新任务目录必须由本轮创建，历史现场不能重入 |

不要只针对反例加字符串判断；按下面的结果分类、共享预算和目录创建协议实施。

## 2. F1：先分离进程结果，再判断 EULA 语义

目标文件：`assemble-dmg.mjs` 的 `runTool`、`attachVolume` 和 `pre-mount-eula`。

### 实现顺序

1. `runTool` 返回完整进程结果：`status` 保持原值（允许 null），`signal`、`timedOut`、`spawnError`、stdout/stderr。不要提前把 null 改成普通非零码，丢掉分类依据。
2. `attachVolume` 继续先登记 pending、运行工具、核对 mount table、接管已确认挂载。异常检查不能提前越过资源回收。
3. 用纯函数区分 execution failure 与 normal exit。timeout、signal、spawn error、缺失/非法 status 都是 execution failure，不是“用户拒绝”。
4. RW 和最终挂载只接受 normal exit 0 且挂载身份确认。EULA 拒绝探针只允许 normal exit 非零且无挂载、挂载目录为空、许可 marker 匹配。
5. 任意分支出现挂载先按现有归属规则回收；探针意外挂载无论退出码都失败。UNKNOWN 不视为无挂载。

伪代码（说明决策顺序，不是直接粘贴覆盖原函数）：

```text
result = runTool(...)
mountState = reconcileOwnedMount(...)   // 保留既有pending/active接管

if mountState is UNKNOWN:
    failWithPreservedState()
if probeMode and mountState is MOUNTED:
    cleanupOwnedMountThenFail()
if executionFailed(result):
    cleanupIfOwnedThenFail()            // marker不能挽救进程异常

if probeMode:
    require result.status != 0
    require mountState == UNMOUNTED
    require directoryEmpty && licenseMarkerMatches
else:
    require result.status == 0 && mountState == MOUNTED
```

非零码暂不凭空指定为某个 macOS 特定数值；保留已实测的正常拒绝控制。若另加退出码白名单，需要本机证据支撑，不能从 mock 发明生产合同。

### 红灯与验收

- marker 已输出、无挂载，分别注入 timeout、signal、spawn error：必须失败，不运行最终 attach、不写成功 report/inventory，不做无归属 detach。
- 正常非零拒绝 + marker + 无挂载仍通过；缺 marker、exit 0无挂载、挂载未知均失败。
- 三类 attach 已挂载后异常仍受控回收后失败；保持 R2 已通过测试。
- 纯函数测试覆盖结果分类；至少一条完整 assembler mock 子进程测试复现“输出 marker 后挂起”。仅测辅助函数不足以证明调用点接线正确。

## 3. F2：清理是一段完整事务，只持有一个截止时间

目标文件：`assemble-dmg.mjs`、`dmg-assembly-contract.mjs`、`bundle-gate.mjs`；必要时抽出 DMG 专用、可注入时钟的纯预算辅助模块。

### 实现模型

使用单调时钟计算耗时（例如 performance.now），UTC 仅用于审计时间。进入首次失败清理、包括其第一次 mount 查询之前创建一个 cleanup context；同一轮不能重新创建或重置截止时间。

```text
cleanupContext = { startMono, deadlineMono: startMono + 60000 }
remaining(ctx) = max(0, ctx.deadlineMono - nowMono())
timeoutFor(ctx, commandCap) = min(commandCap, remaining(ctx))
```

1. `mountTable` 接受预算 context，不再独立使用固定30秒。正常流程使用 assembly context，失败接管/清理使用 cleanup context。两者预算不可混用。
2. 清理前查询、detach、清理后查询都传同一个 context；前查询上限30秒，detach上限为单命令上限与剩余宽限的较小者，后查询同样收紧。
3. 剩余预算 ≤0 时不要启动子进程；特别注意 Node 的 timeout=0 表示不设超时，绝不能把0传进去。返回明确的 budget-exhausted 状态，保留挂载责任。
4. 任何分支退出都在 finally 中更新 elapsed；失败报告序列化时再取真实终值。cleanup 未开始才是0；UNKNOWN也必须记录已花费时间。
5. `fail()` 不能开启第二个60秒清理。可以完成同一清理流程，但不得因为递归失败、再次 detach 或复核失败而重置预算。优先让失败出口统一接管一次 cleanup，避免多个调用点各自先清理再调用 fail。
6. assembly deadline 耗尽后，不再启动装配动作；必要的挂载归属复核进入失败清理宽限，最终仍失败。parent gate 继续容纳 assembly180秒 + cleanup60秒 + 既有30秒进程收尾余量，不能用扩大 parent timeout 掩盖清理无界。
7. 报告区分 assemblyMs、cleanupMs、totalElapsedMs 和 cleanup outcome。超时调度可能有微小墙钟误差，不要求真实进程恰在60000.000ms退出；要求不在预算耗尽后开新工作、不分配超过剩余时间的子超时，且报告不隐瞒实际耗时。

### 红灯与验收

- 使用 fake monotonic clock，不真实 sleep 117秒。前查询耗29秒后，detach timeout必须≤31秒；如果再耗31秒，后查询不得启动。
- 前查询29秒、detach20秒后，后查询timeout必须≤11秒；断言每次传给进程执行器的timeout与最终真实模拟耗时。
- 前查询失败/耗尽、detach失败/耗尽、后查询失败/耗尽分别断言 UNKNOWN/RESIDUAL 与 pending/active保留，不能写 CLEAN。
- 多次进入失败出口，start/deadline不变；报告elapsed不再是0或仅为detach前耗时。
- 快速成功detach仍复核归属及无残留；正常全流程cleanupMs=0。
- 测试要覆盖生产调用链所用的 budget helper 和至少一条完整 mock assembler 路径。fixture可以缩短测试预算，但正式值精确保持120000/180000/60000，不添加生产CLI预算覆盖。

## 4. F3：用“本轮原子创建”证明目录新鲜度

目标文件：`dmg-assembly-contract.mjs`、gate、assembler；`package.json` 仅允许移除 `bundle:tauri` 中固定 `--work-dir .tmp/prr-069c-assembly` 参数；根 README 同步说明默认唯一路径。其余命令语义不变。

### 选定方案：日志与工作树分离，已有任务根一律拒绝

不引入可伪造的 owner.json 通行证，也不依据 logs-only、空目录或目录年龄推测“属于本轮”。

1. 正式工作树结构固定为 `.tmp/prr-069c-<唯一run-id>/work`；任务根指 `.tmp/` 下这一直接子目录。任务根在开始时必须不存在，而不只是末级work不存在。
2. gate 未传work-dir时生成一次唯一run-id（UUID等），把实际路径传给assembler。显式work-dir仍可用于预先固定的验收轮次，但只能为上述结构且任务根全新。默认值不是固定目录，从而保持 `pnpm bundle:tauri` 可重复执行。
3. gate 在 build 前只读验证任务根不存在、无symlink、在白名单内；build不得写该任务树。assembler 在任何工具调用前再次验证，然后以非recursive mkdir原子创建任务根；EEXIST即失败，不删除重试或另找目录。需要创建`.tmp/`时单独处理，先验证根及路径分量。
4. assembler成功创建后，该运行持有任务根归属；创建work及子目录前检查归属与路径身份。成功后保留任务根/完成记录，失败保留现场。未来任何调用即使指定同名新子目录也会因任务根已存在而失败。不要恢复R2的logs例外。
5. 日志写到本轮新 G2 evidence 目录或独立诊断目录，不预先创建工作任务根。正式轮次的command/mount-state/bundle日志可与inventory/report同处新证据目录。
6. gate与assembler共用结构校验，只有assembler负责原子创建任务根。不要让gate先创建根、assembler再因“已存在”拒绝自己。碰到并发创建者时失败，不猜测归属。
7. 旧固定work-dir输入不符合新合同则给出可操作错误（使用省略参数的默认唯一路径或新的完整路径），不能静默复用。该局部CLI变更及默认命令兼容测试写入README；不改变ULMO/EULA/G2授权路径。

### 红灯与验收

gate和直接assembler分别测：旧任务根仅logs、仅文件、空、已有work、已成功清理过work，全部拒绝新work；历史hash不变，build/tool均未调用。

合法新根通过并只创建一次；模拟校验后mkdir遇EEXIST必须失败；中间symlink/悬空链接继续拒绝。默认gate连续两次独立fixture运行选出不同任务根；显式重复同一任务根第二次失败。日志落到独立证据树不影响合法新根。

这不宣称抵抗任意恶意并发文件系统替换，也不新增多构建并发支持；必须保证本卡测试的创建冲突与可观察身份变化不会静默继续。

## 5. 文档收口

- R2报告的交回HEAD父提交并非source：`7d496a8`父为`e284be3`，再上才是`885d877`。修正关系说明，保留历史实验结果；新报告用明确完整source与可复算交回HEAD，允许中间多个文档提交，但代码树必须一致。
- 状态只写“执行完成/等待独立审阅”，不能自称独立验收关闭。
- 不修改C方案图标、应用逻辑、生产Tauri配置、ADR预算/协议、decision register、依赖、全局环境、CI/CD。无需新的产品设计决策。

## 6. 任务卡 A：代码与异常证据（现在执行）

执行顺序：先读本文并给出不超过一页的实现映射（具体函数、状态、预算传递、目录创建者），随后在允许范围内实施，无需仅为复述计划等待用户再次回复。若必须大改架构或扩大范围则STOP请求批准。

1. 记录clean基线；唯一新 `.tmp/prr-069c-r2-f1-dev-<run-id>/` 保存红/绿证据。先建立 F1/F2/F3 红灯，不删除旧断言。
2. 按F1→F2→F3修复；F2允许可测试的纯辅助函数，不引入运行时依赖。
3. 跑旧R2卡§5列出的全部源码门：format/typecheck/lint、release-runners专项、unit、integration、icon:verify、build、cargo fmt/test/clippy、diff check；新增helper测试必须包含在必跑集合内。
4. 写 `docs/quality/prr-069c-r2-f1-stage-a-report-2026-09-11.md`，含每项红→绿、调用链、fixture异常最终状态、未执行项目；本地提交并保持clean。
5. 交回并停在 `STOP_FOR_CODE_REVIEW`。本阶段不做真实挂载/DMG构建，不做三轮预检，更不执行PRR-070。预期红灯及开发迭代允许，不能将它们伪装为正式候选证据。

允许文件：上述明确的runner/helper/test、package.json限定参数、README、当前规划与状态文档、R2报告勘误、新阶段报告。`g2-scope.mjs`无需继续改动。超过此范围说明必要性并停下。

## 7. 任务卡 B：三轮原生预检（暂不派发）

前置：阶段A独立代码审阅明确接受并给出新的clean基线；不能凭自身测试通过解锁。

接受后从同一clean source独立build+装配三轮，使用 `.tmp/prr-069c-r2-f1-<完整source>-attempt-01/work` 等全新任务根；日志和inventory/report放入 `.tmp/release-candidate/prr-069c-r2-f1-<完整source>-attempt-01/`，不得预建工作树。02/03同构。

沿用R2全部原生预检项、预算和证据绑定；每轮失败STOP，不重跑挑绿。此后再次交回独立审阅，PRR-070仍需明确派发。阶段B不是当前执行授权。

## 8. 固定交回与红线

```text
Task: PRR-069C-R2-F1 / Stage A
Status: STOP_FOR_CODE_REVIEW | BLOCKED
Base: <完整HEAD/clean>
HandoffCommit: <完整HEAD/clean>
Changed: <逐文件与函数>
F1: <结果分类与完整mock反例>
F2: <共享截止时间、真实耗时、预算传递与调用次数证据>
F3: <原子创建者、默认重复执行、历史拒绝矩阵>
Verification: <命令/exit/数量/红绿证据路径与SHA-256>
NotRun: Stage B / native DMG prechecks / PRR-070 / G-FINAL / PRR-080/090
Risks: <未解决项>
Next: STOP_FOR_CODE_REVIEW
```

禁止删除历史证据、改系统设置/信任、访问凭据、签名、公证、push、上传、公开发布。阶段A没有真实挂载清理授权；测试只使用合成fixture。所有历史attempt与证据保留，不因本轮返修而补写或覆盖。
