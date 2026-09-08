# PRR-066 独立代码与原生预检审阅

日期：2026-09-08  
受审实现：`f5f887257d316e71b8a9c560a11cc5b45dcb89e9`  
受审状态提交：`a1ed6519a4b9ea6f552f154dd052981c343c591f`  
结论：`ACCEPT_WITH_REVIEW_FIX / PRR-070_READY_AFTER_CLEAN_COMMIT`

## 结论

PRR-066 的五个根因均已关闭，应用路径与诊断候选的原生结果满足进入 PRR-070 重做的条件。该结论只接受实现与预检，不把 `.tmp/prr-066-f5f8872/` 升格为发布候选或最终证据；PRR-070 仍必须从包含本审阅小修的新 clean HEAD 执行步骤1～11。

审阅发现一个 P2 证据隔离缺口并已直接修复：`diagnostic-preflight` 原先只凭 `.tmp/prr-066-*` 目录名自动启用，最终 verifier 也未显式拒绝该模式。现改为必须传入 `--diagnostic-preflight`，且 `verify-evidence` 对 summary/raw 均只接受 `measurementMode=release`。这样诊断数据不能误入 PRR-080 的发布 manifest。

## 根因关闭复核

| 根因 | 独立结论 | 关键证据 |
| --- | --- | --- |
| PNG / CSP | PASS | production CSP 只增加 `'wasm-unsafe-eval'`；普通 `unsafe-eval`、通配符、远程 endpoint 仍被拒绝；真实 `.app` PNG probe 成功 |
| eager export loading | PASS | 空白 mount 不调用 warmup/whenReady/whenMetricsReady；首个几何意图触发单一 in-flight font load |
| GeometryBarrier 并发/失败 | PASS | background flush 与 Save/Close-Save/Export join 同一 promise；失败意图回队首、无 fallback size 落盘、无 unhandled rejection |
| RSS 30秒协议 | PASS | host 等待30,000ms；rss sample/complete 带 settleMs；runner/verifier 对不足值 fail-closed |
| canvas p95 | PASS | renderer、runner、verifier 均从三类完整 raw frames 复算，各类 p95 最大值18ms |
| PNG 错误链 | PASS | fetch/init/render 错误映射为 `EXPORT_WASM_UNAVAILABLE` 并保留底层 message，不再退化为只有 `UNKNOWN` |

## 证据复算与原生抽测

执行 Agent 的 diagnostic preflight：

- candidate SHA-256：`b29c003a741f2bd1cecfe47fa014a988e3f82806b2b16e7f8d0f278b253ea669`，与当前 `.app` artifact 复算一致；
- raw SHA-256：`91823cc8b30938bda8ffde6356bedd9b20b00b354fa32cc34cecbc2a18917253`，与 summary 一致；
- runner SHA-256：`9eb86ee12103cfd3e2ba8cf6605b9c0292735f7095a344012314f0c93f293ced`，与受审 `f5f8872` 源码一致；
- 20样本结果：cold 324.9ms、warm 316.2ms、30秒 RSS 98.8MB、canvas 18ms、edit 18ms、save 14ms、PNG 1561ms、DMG 24,550,854 bytes，全部满足 Accepted 预算；
- PNG 输出为真实 8860×6708 RGBA 文件，20轮输出 hash 稳定。

独立审阅者另行直接启动同一 production `.app` 抽测：

- PNG：resource load 909ms，2x render/export 1588ms，输出 8860×6708，`scenario-result`/exit 0；
- RSS：`renderer-ready` 后30秒得到 108,704KiB（约106.2MiB），低于120MB；`rss-complete`/exit 0。

## 独立验证

| 验证 | 结果 |
| --- | --- |
| `pnpm format:check` / `lint` / `typecheck` | PASS |
| `pnpm test:unit` | 52 files / 512 tests PASS |
| `pnpm test:integration` | 14 files / 94 tests PASS |
| `pnpm test:a11y` | 9 tests PASS |
| `pnpm test:visual` | 11 tests PASS；仅生成 owner-review-required 视觉证据，不授予 G-FINAL |
| `pnpm test:export` | 18 tests PASS |
| `pnpm build` | PASS；initial entry 485,790 bytes，低于500,000 bytes |
| network / license / boundaries | PASS；0 endpoint；792 packages + 4 fonts notices coverage；架构边界 PASS |
| Rust fmt / test / clippy | PASS；208 tests，0 warning |
| review-fix runner/verifier tests | 44 tests PASS |

## 后继约束

1. `.tmp/prr-066-f5f8872/` 与本审阅抽测只作诊断，不能进入 PRR-080 manifest。
2. 本审阅修改了 runner/verifier，因此 `f5f8872` diagnostic evidence 的 runner hash 对新 HEAD 必然过期；这是预期隔离，不得补写或复用。
3. PRR-070 必须从包含本审阅修复与状态文档的新 clean HEAD，使用正式 G2 candidate/evidence 路径完整重做。
4. 仍不得申请或代写 G-FINAL；PRR-080/090 未解锁。

