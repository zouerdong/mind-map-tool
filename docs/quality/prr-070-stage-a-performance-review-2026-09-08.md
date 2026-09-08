# PRR-070 阶段 A 性能阻断独立审阅

日期：2026-09-08  
结论：`REJECT_CANDIDATE / RETURN_TO_PRR-066`  
受审 source：`0c8a93bf4cc1b55234cd6b54f0dfe9f02eac9c65`  
受审证据：`.tmp/release-candidate/0c8a93bf4cc1b55234cd6b54f0dfe9f02eac9c65/`

## 结论

执行 Agent 在步骤 6 停止是正确的。步骤 1～5 的候选、DMG 与 runner 绑定经抽查仍与 inventory 一致，但该 candidate 不能继续步骤 7～11，也不能申请 G-FINAL。阻断不是单一“机器噪声”，而是三个实现/证据协议问题和两个真实预算红灯：

1. **P0：生产 PNG 导出被 CSP 阻断。** 独立单次候选复现得到 WKWebView `CompileError`：`script-src` 未允许 `wasm-unsafe-eval`，resvg WASM 无法实例化。原报告的 `error/UNKNOWN` 是错误消息格式又把底层原因遮住，并非文件授权路径失败。
2. **P0：空白启动会无条件常驻完整导出资源。** `MindMapApp` mount 后立即调用 renderer warmup；三份 WOFF2（合计 20,770,972 bytes）、fontkit/export chunk 与约 2.48MB resvg WASM 随即载入和解析。RSS 探针在此之后得到稳定约 171.2MB，超过 120MB。Accepted ADR 0011 已允许“真正需要时动态载入”，应改为首次几何意图/导出触发，不应在空白画布无条件预热。
3. **P0：RSS 采样协议未满足质量规范。** `docs/quality/v1-quality-gates.md` 要求窗口稳定 30秒后采样；host 当前仅等待 2秒。现有 171.2MB 可以证明当前路径超预算，但不能充当最终“30秒 stable RSS”发布证据。
4. **P1：canvas p95 双口径。** renderer 把“20轮中最坏一轮的 p95”上报为 52ms，runner 从全部 raw frames 复算为 18ms。raw 显示 pan/drag/zoom 的整体 p95 均为 18ms，实际满足 32ms 预算；候选仍因自相矛盾而 `INCOMPLETE`。审阅 patch 已把 renderer 改为按每类全部 raw frames 复算后取三类最大值，并保留逐轮 p95 仅作诊断。
5. **P1：启动 p95 真实失败，当前不能剔除离群。** 20个 warm 样本中16个为 369～399ms，4个为 1102～1261ms；即使使用 nearest-rank estimator，p95 仍为 1115.1ms，大于 800ms。warmup 与 `renderer-ready` 同时在首帧后启动，存在明确竞争路径；先移除空画布 eager warmup，再按不丢样本的同一协议复测。不得以“关后台”或手工删除离群方式放行。

## 独立复算

| 项目 | 复算结果 | 审阅结论 |
| --- | ---: | --- |
| `.dmg` SHA-256 | `731e1610edd65e74aec6ba52f00118ccb9364daec798b77e340efb3815d3fbaa` | 与 inventory 一致 |
| `.app` artifact SHA-256 | `ca0c6faf1e1c72e35fe88fe71d37659e5c4574a283946a5dc5d81cabc4d179e4` | 与 inventory 一致 |
| performance runner SHA-256 | `6c6f5c281a8113ccb7e83081c93fab5a4a3e2032e7e05e3707d3c2ac4e2815c4` | 与 raw 一致 |
| cold 20 samples | current estimator 1255.9ms；nearest-rank 398.3ms | 两种均 PASS |
| warm 20 samples | current estimator 1260.6ms；nearest-rank 1115.1ms | 两种均 FAIL |
| stable RSS | p50 171.2MB（仅等待2秒） | 超预算且协议不足 |
| pan / drag / zoom raw p95 | 18 / 18 / 18ms | 真实性能 PASS，报告一致性 FAIL |
| PNG | CSP 拒绝 WebAssembly compilation | 功能与性能均 FAIL |

`calcStats` 当前 percentile estimator 在20个样本时把 p95 取为最大值；runner 与 verifier 一致，因此本轮不擅自更换发布门算法。该定义虽偏保守，但不是 warm 失败的决定因素。若未来修改 estimator，需单独版本化测量协议，不能在本次整改中为变绿而改口径。

## 已完成的小修

- `apps/desktop/src/app/perf-probe.ts`：canvas `frameP95Ms` 与 raw 独立复算口径一致；失败描述保留 `code + message`。
- `apps/desktop/src/app/perf-probe.test.tsx`：新增 raw p95 可复算断言与 PNG 底层错误消息保留测试。
- 已通过定向 Vitest 7项、Prettier 和全量 TypeScript typecheck。

这些修改使旧 candidate 自动作废；不得把 patch 后的报告或新源码与旧 `.app/.dmg` 拼接。后继必须先完成 [PRR-066 性能整改任务卡](../planning/prr-066-performance-remediation-task-card-2026-09-08.md)，形成新 clean commit，再从 PRR-070 步骤1完整重做。

