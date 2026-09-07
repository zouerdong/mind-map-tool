# MRT-004A A1 红灯证据(旧行为)

日期:2026-08-30。临时测试文件 `packages/platform/test/red-light.test.ts`
(已按任务卡删除,最终工作树全绿),运行命令
`pnpm exec vitest run packages/platform/test/red-light.test.ts`,
4/4 失败,输出原样保存于 `.tmp/mrt-004a/red-light.log`(任务结束清理;
本文件为可审计摘要)。

| ID | 旧行为断言 | 失败输出(根因) | 对应生产代码 |
| --- | --- | --- | --- |
| RED-1 | action Promise pending 时 ack 必须为零 | `expected [ 'i-1' ] to deeply equal []` — `LaunchRouter.dispatch()` 同步调用 `onWindowAction` 后立即 `onAck` | `packages/platform/src/lifecycle/launch-router.ts:113-118` |
| RED-2 | appReady 快照与 listen 注册之间的 intent 必须被处理 | `expected [] to include '/gap.mm'` — `TauriLifecycleAdapter.start()` 先 `invoke(appReady)` 后 `listen`,间隙事件在真实事件模型下丢失 | `packages/platform/src/lifecycle/tauri-adapter.ts:39-46` |
| RED-3 | 同 identity loading 中应聚焦该窗口 | `expected 'open-in-window' to be 'focus-existing'` — `WindowContext` 无 loading 态,loading 窗口被视作 clean 空闲窗口重复承载 | `packages/platform/src/lifecycle/launch-router.ts:37-47` |
| RED-4 | action 终态须有 outcome 回报通道 | `expected 'undefined' to be 'function'` — fire-and-forget 回调模型无 completion 校验通道,host 无法区分 opened/retryable,重放/跨窗无从拒绝 | `packages/platform/src/lifecycle/launch-router.ts:24-29` |

根因归纳:MM-060 的 `LaunchRouter`/`TauriLifecycleAdapter` 采用同步决策
+ fire-and-forget action + 立即 ack 的模型,缺少 loading 态、identity
reservation 与 awaitable terminal outcome,不能安全支撑 ADR 0008 的
多窗口协议。MRT-004A 以纯状态机(Registry/Coordinator/bootstrap adapter)
取代该模型;生产装配切换在 MRT-004C/D。

新实现的等价场景由以下正式测试全绿覆盖:
- RED-1 → `window-bootstrap.test.ts` "P2 action 未终态时零 report" +
  coordinator `p5_success_terminal_acks_exactly_once`
- RED-2 → `window-bootstrap.test.ts` "listener-first 顺序" 两条
- RED-3 → coordinator `q2_duplicate_identity_while_loading_only_focuses`
- RED-4 → coordinator `p3_replay_cross_window_and_mismatched_completions_rejected`
  + registry `delivery_completion_rejects_cross_window_replay_and_stale_generation`
