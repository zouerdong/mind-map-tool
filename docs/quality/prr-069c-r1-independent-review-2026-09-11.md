# PRR-069C-R1 独立审阅

日期：2026-09-11

结论：`REVISE / PRR-070_BLOCKED`。正常路径成立不等于异常边界闭合；下一步只派发 [PRR-069C-R2](../planning/prr-069c-r2-attach-and-path-safety-task-card-2026-09-11.md)。

## 审阅对象与证据边界

- 精确范围：`9862be17a5138fcbececa7ebe355e2b9a78e92d4..7bb72dd1fa809e6a6103a97a952189ca8cfaed0a`。
- 实现 source：`77f8ca93576152d50f8e5f2010881f4b8ba48fd6`；交回 HEAD：`7bb72dd1fa809e6a6103a97a952189ca8cfaed0a`。
- 审阅 patch SHA-256：`cce7dd761c5511d39a45f0279a50825f87f8e99983dd05c9855468aca61805f1`。
- 隔离副本独立运行原专项测试 89/89 PASS；format/typecheck/lint PASS。typecheck 首次因副本工作区依赖缺失失败，恢复依赖链接后通过，不作为代码缺陷。
- 执行报告的全量 JS 611 / Rust 210 测试通过，本次未独立重跑这两组全量测试。
- R1 三轮正常原生预检记录已检查，装配 8665/8807/9391ms，DMG 24284017/24284021/24284037B。报告中的 37/37 是执行侧复核，不替代本次独立审阅，也不代表审阅者重新挂载了三份 DMG。
- 以下异常用例在隔离副本验证；没有修改正式源码或历史证据。历史成功记录保留原事实，但不得用作后继新 source 的候选证据。

## 剩余发现

### R2-01 / P1：attach 已挂载后超时，清理无法接管

`assemble-dmg.mjs` 的 `runTool` 默认在超时/非零时直接失败；RW 和最终 attach 在返回后才登记挂载。系统工具先建立挂载、后卡住或失败时，清理看不到尚未登记的资源。隔离 mock 在写入 mount table 后挂起，runner 非零结束但挂载记录仍在。EULA 探针及查询失败也需统一覆盖，而不是只修成功返回分支。

### R2-02 / P1：直接调用 assembler 绕过 fixture 工具路径合同

`resolveTool` 直接 resolve 调用者路径，缺失工具又回退到真实系统工具。隔离测试传入绝对 tool-dir，runner 实际成功；移除 mock ditto 后仍成功并调用真实 ditto。gate 入口已有的检查无法保护直接 assembler 入口。应在任何工具调用前验证完整注入集合，并禁止回退。

### R2-03 / P1：中间路径 symlink 可绕过 work-dir 隔离

共享路径校验只限制 realpath 留在仓库；末级 lstat 与词法 evidence 检查无法拒绝仓库内中间层 symlink。隔离探针令 `.tmp/prr-069c-review-alias` 指向 `release-candidate`，使用其新子目录作为 work-dir，通过路径检查并走到 app 缺失检查。探针未使用真实 app、未写历史 evidence；证明的是路径防线可绕过，不声称已发生历史数据损坏。

### R2-04 / P2：DMG 常量进入通用授权模块

R1 将七项系统工具常量加入多 runner 共用的 `g2-scope.mjs`，超出原卡“DMG 专用辅助模块”约定。迁移到仅供 DMG 两入口使用的单一职责模块；这是一项范围/维护性修正，不是 G2 授权逻辑已被破坏的证据。

## 保留结论与下一步

正式模式注入拒绝、app-only 窄命令、固定 120000/180000 阈值及已有正常路径测试继续保留，不退回 Finder 路线。R2 需先补红灯、修根因、完成专项与全量门，然后从同一新 clean source 连续三轮新预检。独立审阅通过前，不执行 PRR-070，不申请 G-FINAL，不执行 PRR-080/090。
