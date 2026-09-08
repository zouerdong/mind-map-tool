# PRR-000～PRR-050 实现审阅

日期：2026-09-07  
结论：`ACCEPT_IMPLEMENTATION_WITH_REVIEW_FIXES / REJECT_PRR_090_ENTRY`  
源码基线：`main@541d38ceebe15b272689450072f6195b2440b2b5` 加当前未提交 working-tree diff  
审阅对象：执行 Agent 回报的 PRR-000～050 代码 diff、测试、构建与门禁实现  
非审阅对象：尚未生成的 clean source commit、新 `.app`/`.dmg`、原生性能矩阵、G-FINAL、PRR-080 冻结包

## 1. 结论

PRR-010、PRR-020、PRR-040、PRR-050 的主体实现是真实且基本完成的；本轮发现的局部实现错误已直接修复，静态检查、隔离 production build、JavaScript 生产依赖审计和安全范围测试均通过。

但本次输入不能按 PRR-090 验收，更不能得出 `READY_TO_RELEASE`：PRR-000 的真实 G2 仍缺负责人原始批准，PRR-030 与 PRR-060 尚未解锁，当前工作树不是冻结 clean commit，PRR-070 的新候选、DMG 实测、真机原生性能矩阵和 G-FINAL 不存在，PRR-080 也没有生成冻结验收包。执行 Agent 还没有按任务卡固定格式提交可审计的 PRR-000～050 交回记录；目前可审阅输入只有代码 diff 和用户转述。

## 2. 分卡判定

| 任务 | 判定 | 说明 |
| --- | --- | --- |
| PRR-000 | `PARTIAL / BLOCKED` | readiness v3、G2 fail-closed 与证据校验基础设施已实现；真实批准人、精确范围和 `[from-user]` 原文缺失，packaging decision 仍按设计返回非零。 |
| PRR-010 | `ACCEPT_WITH_FIXES` | 原生性能探针、Rust host 与 runner 已实现；本轮修复 canvas tracker、原始 frame samples、聚合计算和启动进程假绿。仍需 PRR-070 在新候选上产生 ≥20 次真实样本。 |
| PRR-020 | `ACCEPT_WITH_PENDING_NATIVE_PROOF` | 三份 WOFF2 总计 20,770,972B，字体度量/导出契约与隔离构建通过；本轮补齐 UI `@font-face`。最终 DMG 大小和 WebView 字体视觉一致性仍待 PRR-070 实测。 |
| PRR-030 | `NOT_STARTED / BLOCKED` | 生产 `tauri.conf.json` 尚未获得修改授权；文件关联、最低 macOS 版本、LaunchServices 和双击打开未完成。 |
| PRR-040 | `ACCEPT_WITH_FIXES` | 原子字体几何事务和测试已实现；本轮移除调用者可伪造的 `previousSizes`，逆操作现在从当前状态派生。真机视觉仍随 PRR-070 验收。 |
| PRR-050 | `ACCEPT_WITH_LIMITATION` | active handle generation 与 Rust 定向测试通过；完整 Rust 生命周期套件需在得到任务卡列明的临时目录清理授权后复跑。 |
| PRR-060 | `NOT_STARTED / BLOCKED` | 根 `LICENSE` 与 `THIRD_PARTY_NOTICES` 仍不存在；许可扫描因此正确失败。 |
| PRR-070 | `NOT_STARTED` | 没有 clean source commit、新 `.app`/`.dmg`、native candidate evidence、真机 perf 矩阵或 G-FINAL。 |
| PRR-080 | `NOT_STARTED` | 没有 readiness v3 manifest、acceptance request 或冻结验收索引。 |
| PRR-090 | `NOT_ELIGIBLE` | 前置 PRR-080 未交回，不能开始独立 MM-110 或生成新 handoff。 |

## 3. 本轮发现并修复的问题

1. **Canvas 性能结果会产生 `NaN/null` 或错误 tracker 数据。** `runCanvasScenario` 停止了错误 tracker，runner 又把数组直接传给 `Math.max`。现已修正 tracker，并强制保存三类 raw frame samples、按样本复算 p95，verifier 会拒绝缺样本或汇总不一致。
2. **启动性能可以在应用真正完成前假绿。** runner 收到 `renderer-ready` 后立即 SIGTERM，信号退出也被当成有效。现改为必须候选自然 `exit 0`；超时只负责终止并判失败，host 也拒绝 ready 前或不适用场景的 `scenario-result`。
3. **字体切换 undo 可被调用者提供的旧尺寸污染。** `SetDocumentStyle` 的逆操作曾信任外部 `previousSizes`。该输入已从 public command 删除，core 从当前文档状态派生逆尺寸。
4. **UI 没有注册随包 WOFF2。** 导出消费了内置字体，但 React/WebView 画布仍可能回退系统字体。现新增 UI `@font-face`、入口导入与资产契约测试。
5. **G1 bootstrap 缺失时 verifier 会异常崩溃。** 现改为结构化失败，并增加回归测试。
6. **测试自身包含未经授权的固定目录删除。** 新 decision verifier 测试改用唯一临时文件且不执行递归删除。
7. **字体文档把源文件大小误写成 DMG 实测。** 现明确 20,770,972B 只是被引用字体源文件总量；安装包效果必须由 PRR-070 实包测量。

## 4. 独立验证

| 验证 | 结果 |
| --- | --- |
| `pnpm format:check` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| 安全范围 Vitest | PASS，46 files / 445 tests |
| Rust 定向测试 | PASS，file handle 5 tests；perf 4 tests |
| `cargo fmt --check` | PASS |
| `cargo check --locked` | PASS |
| `cargo clippy --all-targets --locked -- -D warnings` | PASS |
| 隔离 Vite production build | PASS，500 modules；initial entry 488,966 / 500,000B |
| `pnpm audit --prod --audit-level high` | PASS，无已知 JS 生产依赖漏洞 |
| `pnpm net:scan` | PASS，103 files / 0 endpoints |
| `pnpm license:scan` | FAIL，唯一门禁原因为根 LICENSE 与 THIRD_PARTY_NOTICES 缺失 |
| G2 packaging decision | FAIL，真实批准人和 `[from-user]` 原始记录缺失 |
| 新候选 DMG / native perf / G-FINAL | NOT RUN，前置输入与冻结候选不存在 |

完整删除型测试没有运行：根工程规则要求删除文件或目录前先获得负责人授权。本轮没有擅自清理 `.tmp`、安装应用、修改 LaunchServices、签名、公证、推送或公开发布。

## 5. 两项建议决策

### UI `@font-face`

这不是可选的独立功能决策，而是“UI 与导出使用同一内置字体”契约的必要实现，已作为小问题直接修复。仍需在 PRR-070/090 对新候选做 Noto regular/bold、LXGW regular/模拟粗体的原生 WebView 视觉核对；若发现具体视觉差异，再建立定向整改卡，不需要现在另开一张与主发布链平行的泛化视觉任务。

### 旧 PRC-090 交接包

保留为只读审计材料，不修补、不复用，也不删除。PRR-070/080 只生成并冻结新证据；只有 PRR-090 独立验收 `ACCEPT` 后，才基于新 source/candidate hash 生成新的发布交接包。旧包不能通过替换 hash 或补写字段恢复有效性。

## 6. 下一步与解锁条件

负责人先提供以下四组可引用输入：

1. G2：真实批准人、产品标识/version、候选与证据路径、允许/禁止动作，以及以 `[from-user]` 保存的原始批准语句。
2. 生产配置：`.mindmap` 文件关联、UTI、最低 macOS 版本及修改 `tauri.conf.json` 的明确授权。
3. 法律：最终 LICENSE 文本、THIRD_PARTY_NOTICES 口径与责任人确认。
4. 验收环境：允许清理的精确临时目录、受控安装/LaunchServices 操作范围，以及 Rust advisory 工具链或书面风险处置。

输入到位后的唯一正确顺序是：补完 PRR-000 → PRR-030/060 → 集成为 clean source commit → PRR-070 新候选与全部原生证据 → 负责人对该候选给出 G-FINAL → PRR-080 冻结 → 回到独立审阅者执行 PRR-090。签名、公证、上传、Git push 和公开发布仍需另行明确授权。
