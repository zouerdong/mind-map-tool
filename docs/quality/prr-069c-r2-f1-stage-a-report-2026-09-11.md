# PRR-069C-R2-F1 阶段 A 实施报告（代码与合成异常测试）

状态：**执行完成，等待独立代码审阅**（`STOP_FOR_CODE_REVIEW`）。本报告是执行侧自述，不构成独立验收；
阶段 B 三轮原生预检未派发、未执行，PRR-070 / G-FINAL / PRR-080 / PRR-090 保持阻塞。

## 0. 基线与提交关系（修正 R2 报告的 provenance 写法）

| 项 | 值 |
| --- | --- |
| Base（派发基线，clean） | `3c5cf6150607255c7cd75c18079fc1c0db9e49fb` |
| Source（本次唯一代码提交） | `32148097aaf9f7a9da0a7de8996de8583ad3c2d0` |
| 交回 HEAD | 见本报告所在文档提交（`git log -1 --format=%H`），仅文档差异 |
| 代码树一致性判据 | `git diff --stat <source>..HEAD -- scripts tests apps packages` 必须为空 |
| 可复算依据 | 所有验证命令都在 source 提交的冻结树上执行，见 §6 与证据 manifest |

R2 报告曾把「交回 HEAD 的父提交」当成 source（`7d496a8` 的父是 `e284be3`，source 还要再上一级 `885d877`）。
本次不重复该写法：source 是**代码提交**，交回 HEAD 是它的**纯文档后代**，两者都由上面的判据命令区分，
不依赖阅读提交图。R2 的历史实验结果、三轮正常预检记录与全部证据保持原样，未修改、未补写。

## 1. 实现映射（函数 / 状态 / 预算传递 / 目录创建者）

| 关注点 | 位置 | 变更 |
| --- | --- | --- |
| 进程结果分类（纯函数） | `dmg-assembly-contract.mjs:59` `classifyProcessResult` | 新增：spawn error / timeout / signal / 缺失或非法 status = 执行失败；正常结束（含非零码）返回 `null` |
| 进程结果载体 | `assemble-dmg.mjs:856` `runTool` | 新增：`status` 保留 `null`，回报 `signal`/`timedOut`/`spawnError`/`timeoutMs` |
| EULA 探针语义 | `assemble-dmg.mjs:481` `attachVolume({ intent })` | 新增 `intent: "mount" \| "eula-probe"`，决策顺序：登记 pending → mount table 复核 → 接管 exact 挂载 → 探针意外挂载回收后失败 → 进程异常回收后失败 → 正常结束才判语义 |
| 清理结论记录 | `assemble-dmg.mjs:585` `recordCleanupOutcome` | 新增：CLEAN 只标已回收；其余保留 `residualMount`，绝不写成已清理 |
| 装配预算状态 | `assemble-dmg.mjs:178` `assemblyCtx` | 新增：启动即建，上限 `deadlineMs`，覆盖全部装配动作与正常路径的 mount 查询/detach |
| 清理预算状态 | `assemble-dmg.mjs:195` `cleanupBudget` / `:207` `budgetContext` | 新增：首次失败清理惰性创建，同一轮永不重置；`budgetContext(kind)` 是唯一取用口 |
| mount 查询预算 | `assemble-dmg.mjs:376` `mountTable(ctx, stage)` | 由固定 30s 改为 `timeoutFor(ctx, min(30000, timeoutMs))`，预算不足 1ms 不启动子进程并记 `skipped` |
| detach 预算 | `assemble-dmg.mjs:757` `spawnDetach` | 统一走 `timeoutFor(ctx, timeoutMs)`；耗尽时 `budgetExhausted` + `skipped` |
| 卸载与复核预算 | `assemble-dmg.mjs:629` `detachAndVerify` | 前查询/detach/后查询共用同一个 ctx；预算耗尽记 RESIDUAL（责任保留），表不可读才记 UNKNOWN |
| 失败出口 | `assemble-dmg.mjs:236` `fail` | 序列化时现算 `assemblyMs`/`cleanupMs`/`totalElapsedMs`；只经 `cleaningUp` 门做一次清理，不重置 ctx |
| 预算纯函数 | `dmg-budget.mjs`（新文件） | `createBudgetContext` / `remainingMs` / `timeoutFor` / `elapsedMs` / `isExhausted`，单调时钟可注入 |
| 正式工作树形状 | `dmg-assembly-contract.mjs:83` `parseProductionWorkTree` | 新增：精确 `.tmp/prr-069c-<run-id>/work`，删除 R2 的 logs/兄弟目录启发式 |
| 任务根新鲜度 | `dmg-assembly-contract.mjs:110` `assertTaskRootAbsent` | 新增：任务根已存在（含空、仅日志、仅文件、已有 work、已回收过 work）一律拒绝 |
| 任务根创建者 | `dmg-assembly-contract.mjs:132` `createTaskRootAtomically` | 新增：**只由 assemble-dmg 调用**，非递归 `mkdir`，EEXIST 即失败 |
| 默认唯一任务根 | `bundle-gate.mjs:97` `defaultDmgWorkDir` | 新增：gate 未传 `--work-dir` 时生成 `.tmp/prr-069c-<uuid>/work`，只做只读校验后传给 assembler |

预算常量未改：单命令 120000ms、整轮 180000ms、清理宽限 60000ms。fixture 允许用
`MINDMAP_DMG_CLEANUP_GRACE_MS` **只调小**清理宽限以便用真实子进程验证预算耗尽；正式模式设置该变量即 fail-closed。

## 2. F1：进程结果与 EULA 语义分离

调用链（`assemble-dmg.mjs`）：

```text
attachVolume(intent)
  ├─ pendingMount 登记（子进程启动前）
  ├─ runTool(must:false)              → status 保留 null，附 signal/timedOut/spawnError
  ├─ requireMountTable(assembly)      → 表不可用即 fail-closed（不把空输出当无挂载）
  ├─ 1) mount table 出现该挂载点 → 立即接管为 active mount（先管资源）
  ├─ 2) eula-probe 且已挂载      → detachAndVerify(cleanup) → 无论退出码一律失败
  ├─ 3) classifyProcessResult ≠ null → 已挂载先回收再失败；未挂载直接失败
  └─ 4) 正常结束：mount 意图要求 exit 0 且已挂载（非零+已挂载同样回收后失败）；
         eula-probe 要求 exit 非零且无挂载，之后才校验目录空与 marker 匹配
```

`udifderez`（EULA 内容复算）同样先 `classifyProcessResult` 再判退出码，进程异常不再被误报为「内容不一致」。

## 3. F2：清理是一段完整事务，只持有一个截止时间

- assembly 与 cleanup 两个 context 各自只持有一个 `deadlineMono`；正常流程不借用清理宽限，清理也不重新获得完整装配预算。
- 清理前查询 / detach / 清理后查询传同一个 ctx；命令上限分别按 `min(30000, timeoutMs)`、`timeoutMs` 与剩余预算取小。
- 剩余预算不足 1ms 时**不启动子进程**（`timeoutFor` 返回 0 是「不得启动」，绝不作为 Node 的「不设超时」传入）。
- 耗时由单调时钟在序列化时现算：清理未开始才是 0，UNKNOWN 也记录已花费时间；`fail()` 不开启第二个 60 秒。
- 报告与失败记录都给出 `timings.{assemblyMs, cleanupMs, totalElapsedMs, cleanupGraceMs, cleanupStarted, cleanupStatus}`。
- parent gate 的终止窗口仍是 `180000 + 60000 + 30000`，未借扩大父超时掩盖清理无界。

## 4. F3：用「本轮原子创建」证明目录新鲜度

- 正式工作树固定 `.tmp/prr-069c-<run-id>/work`；任务根是 `.tmp/` 下这一直接子目录。
- gate 与 assembler 共用同一结构校验；**只有 assembler 创建任务根**（非递归 `mkdir`，EEXIST 即失败，不删除重试、不另找目录）。
- gate 未传 `--work-dir` 时生成本轮唯一路径并在日志中给出；`package.json` 的 `bundle:tauri` 已移除固定 `--work-dir .tmp/prr-069c-assembly`，`README.md` 记录默认唯一路径与显式合同。
- 成功轮同样**保留**任务根：R2 的「回收空 work-dir」正是「已成功清理过 work 的历史目录重入」入口，已删除。
- 日志与报告写入本轮证据目录（`--inventory` 所在目录），不写入工作树，也不预建任务根。

## 5. 红 → 绿

红灯先行（source 前的实现，`.tmp/prr-069c-r2-f1-dev-20260911T130621Z/red-01-vitest.txt`）：
7 failed / 9 passed / 113 skipped。

| 编号 | 红灯现象（修复前） | 绿灯断言（修复后） |
| --- | --- | --- |
| F1-a | 探针已输出许可正文后**超时**，被当作有效拒绝并进入最终挂载，整轮 **exit 0 成功** | exit 1；失败分类指向超时且明示「进程异常不接受作为 EULA 拒绝证据」；只读 attach 仅 1 次；对 `mnt-final` 无 detach；无 report/DMG |
| F1-b | 同上，探针被 **SIGTERM** 终止后整轮仍 **exit 0 成功** | exit 1，失败分类指向信号 |
| F1-c | 探针 attach **spawn error**（进程从未启动）被误诊为「许可展示内容与根 LICENSE 不匹配」 | 失败分类指向「无法启动 / ENOENT」，且不再归因 LICENSE 内容；只读 attach 0 次 |
| F1-d | —（对照） | 正常非零拒绝 + 目录空 + marker 匹配仍是有效 EULA 证据，整轮成功 |
| F2-a | 清理宽限未生效，detach 无共享预算，`cleanupMs` 无真实终值 | 前查询消耗约 2s 后 detach 上限收紧到 ≤ 宽限−1s 且 < 单命令上限；耗尽后最后一次 mount 查询记 `skipped=cleanup-budget-exhausted`；`cleanup.elapsedMs` ≥ 2.5s 且 ≤ 宽限+3s；`mountState=RESIDUAL` 且登记保留 |
| F2-b | 成功报告缺 `timings.cleanupStarted/cleanupStatus` | `cleanupMs=0`、`cleanupStarted=false`、`totalElapsedMs=assemblyMs`、无任何 `skipped` 命令 |
| F2-U1..U4 | 模块不存在（import 失败即红） | 假时钟下：前查询 29s → detach ≤31s；再耗 31s → 清理查询不得启动；非法命令上限不放大预算；多次取用不重置截止时间 |
| F3-a | 任务根不被约束（仅 logs 的历史任务根被放行，直到 G2 才拦下） | 仅 logs / 仅文件 / 空 / 已有 work / 已回收过 work 五态，assembler 与 gate 双侧拒绝且提到「任务根」；gate 未放行 build；历史文件 hash 与目录清单不变 |
| F3-b | —（对照） | 全新形状合法：不报任务根冲突，且**不预建**任务根 |
| F3-c | — | 旧固定 `.tmp/prr-069c-assembly` 被拒绝且错误可操作（指出新形状） |
| F3-d | — | `createTaskRootAtomically`：首次成功、重复 EEXIST 失败、不删除既有内容、不产生替代目录 |
| F3-e | 默认 work-dir 固定（`--work-dir` 缺失时直接 BLOCKED） | 省略 `--work-dir` 的 gate 连续两次生成**不同**唯一任务根且各自装配成功；报告落在独立证据树 |

红灯只作为开发证据保留，不冒充正式候选证据。中间一次 F2-a 在并发负载下出现过失败，定位为测试自身的时序余量不足
（合成 mount 的启动开销逼近单命令上限），已把上限/时长余量放宽到约 3 倍后稳定通过；该次隔离调试记录保留在
`debug-f2a.txt`，不删除。

## 6. 验证（全部在 source 提交 `3214809` 冻结树上执行）

| 门 | 命令 | exit | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 格式 | `pnpm format:check` | 0 | All matched files use Prettier code style | `final-format_check.txt` |
| 类型 | `pnpm typecheck` | 0 | packages/ui + apps/desktop 全通过 | `final-typecheck.txt` |
| Lint | `pnpm lint` | 0 | 两个包全通过 | `final-lint.txt` |
| 专项 | `vitest run tests/bootstrap/release-runners.test.ts` | 0 | **129/129**（R1/R2 旧断言 + 16 项新增） | `green-04-vitest.txt` |
| 单测 | `pnpm test:unit` | 0 | **651/651**，53 files | `final-test_unit.txt` |
| 集成 | `pnpm test:integration` | 0 | PASS integration + boundaries | `final-test_integration.txt` |
| 图标 | `pnpm icon:verify` | 0 | PASS（母版无漂移，C 方案图标未改） | `final-icon_verify.txt` |
| 构建 | `pnpm build` | 0 | vite 构建成功 | `final-build.txt` |
| Rust 格式 | `cargo fmt --all -- --check` | 0 | 无差异 | `final-cargo_fmt.txt` |
| Rust 测试 | `cargo test` | 0 | **210 passed / 0 failed** | `final-cargo_test.txt` |
| Rust Lint | `cargo clippy --all-targets -- -D warnings` | 0 | 无警告 | `final-cargo_clippy.txt` |
| 空白 | `git diff --check` | 0 | 无空白错误 | 见 shell 输出 |

证据目录：`.tmp/prr-069c-r2-f1-dev-20260911T130621Z/`（红/绿、门禁输出、`evidence-sha256-manifest.txt` 共 40 条）。
变更文件 SHA-256（source 冻结树，见 manifest）：`dmg-budget.mjs` `89a76de5…`、`dmg-assembly-contract.mjs` `a1c97904…`、
`assemble-dmg.mjs` `acf8b33c…`、`bundle-gate.mjs` `350313ce…`、`release-runners.test.ts` `6fcac68e…`、
`package.json` `75ed587a…`、`README.md` `44f07016…`。

## 7. 旧断言的处理（逐条说明，无删除、无跳过）

- 旧的 R1/R2 断言全部保留并通过（113 项既有用例 → 129/129 含新增）。
- 仅一处**按新合同反向**：`bundle:tauri` 命令禁区断言由 `toContain("--work-dir")` 改为
  `not.toContain("--work-dir")`（并新增不得出现 `prr-069c-assembly`）。这是卡片 §4/§7 明确授权的
  局部 CLI 变更，固定 work-dir 正是「历史目录重入」入口，不属可保留行为。
- 三处测试自身需要随合同调整（不改断言意图，只改夹具）：`runCanonicalGate` 的 work-dir 改为合法形状
  `.../work`（使被断言的门而非路径形状先触发）；「report 已存在」用例为第二轮换新 work-dir（工作树不再回收）；
  F2-a 的时间余量放大。均在测试内就地注明原因。
- 未删除任何历史证据；未使用 skip/only/恒真 mock。

## 8. fixture 异常最终状态矩阵（合成工具链）

| 场景 | 退出 | mountState | 挂载表 | 产物 |
| --- | --- | --- | --- | --- |
| 探针超时 / 信号（无挂载） | 1 | CLEAN | 空 | 无 report、无 DMG，只读 attach 仅探针 1 次 |
| 探针 spawn error | 1 | CLEAN | 空 | 无 report、无 DMG，只读 attach 0 次 |
| 探针意外挂载（含异常） | 1 | CLEAN 或 RESIDUAL | 期望为空 | 先受控卸载再失败 |
| rw/final attach 超时或非零（已挂载） | 1 | CLEAN | 空 | 无 DMG |
| 挂载表不可读 | 1 | UNKNOWN + pending/residual | 保留 | STOP，不做无归属 detach |
| 设备身份不符 | 1 | RESIDUAL | 保留 | 拒绝卸载 |
| 清理预算耗尽 | 1 | RESIDUAL | 保留 | 最后一次 mount 查询记 `skipped=…budget-exhausted` |
| 正常成功 | 0 | — | 空 | `cleanupMs=0`，任务根保留 |

## 9. 未执行项 / 未验证项

- **阶段 B 未执行**：无真实 DMG 构建、无真实挂载、无三轮原生预检（需独立代码审阅接受后的新基线解锁）。
- 未运行 PRR-070 / G-FINAL / PRR-080 / PRR-090。
- 未做真实 `hdiutil` 行为验证：本阶段全部挂载/超时/信号场景由合成替身注入，真实系统工具下的同等行为仍待阶段 B 证明。
- 未验证：并发进程竞争任务根的真实交错（只在单进程内证明 EEXIST 失败语义）。

## 10. 风险 / 待独立判断项

1. **默认唯一路径的可见性**：gate 生成的任务根只出现在 stdout 日志与报告 `workTree` 字段里；操作者需要从日志取值用于后续复核。
2. **fixture 专用清理宽限覆盖**是新增的注入面（env，只可调小、正式模式拒绝）；若审阅认为连这个入口也应移除，可用更长的真实等待替代。
3. **`cleanupGraceMs` 缩短只在 fixture 下生效**，正式模式仍然是 60000ms 固定值；阶段 B 必须用正式值重跑。
4. **任务根不复用**意味着重复运行同一显式路径必然失败，历史 CI/文档若写死路径需要相应更新（已更新 README 与 package.json）。
5. **F2-a 这类时序断言**对机器负载敏感；本次已放宽余量，但仍是潜在的 flaky 候选，交审阅判断是否需要改为假时钟全链路注入。
6. 既有遗留（R2 报告已记录、本卡未授权修改）：`assemble-dmg.mjs` 含一个裸控制字节导致 `grep` 判其为二进制（`rg --text` 可读）；项目 `CLAUDE.md` 派发入口段落漂移。

## 11. 红线确认

未删除历史证据；未改图标、应用功能、生产 Tauri 配置、ADR 预算/协议、decision register、依赖、CI/CD；
未做真实挂载或卸载；测试只使用合成 fixture，且不触碰真实系统工具；未签名、未公证、未访问凭据、
未改系统设置或信任、未推送、未上传、未公开发布。历史 attempts 与本轮证据目录全部只读保留。

## 12. 交回状态

`STOP_FOR_CODE_REVIEW`。阶段 A 接受并给出新的 clean 基线后，才可派发阶段 B（三轮原生预检）；
本报告不构成独立验收，也不解锁 PRR-070。
