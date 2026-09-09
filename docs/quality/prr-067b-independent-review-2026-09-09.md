# PRR-067B 独立审阅

日期：2026-09-09  
审阅范围：`b20603c..57c9238`（负责人批准记录、实施 commit `f9d2a75`、完成状态 commit `57c9238`）  
结论：`ACCEPTED_AFTER_REVIEWER_FIXES / PRR-067_COMPLETE`

## 结论

PRR-067B 的双指标主体实现正确：release runner 会先执行一次 conditioning，成功后才采集 20 个 conditioned cold 样本；`sessionFirstLaunchMs` 为记录型指标，`conditionedColdStartP95Ms≤1500ms`、20 样本、固定 estimator、warm 预算和 `renderer-ready` 完成点均未放宽。conditioning 失败会使整轮 `INCOMPLETE`，不会进入 measured cold。

独立审阅发现四项局部证据链缺口，已由审阅者在 commit `f52e77194bdb6f5c7cb4b205ed693b3dedd31c98` 修复，因此无需退回 Coding Agent：

| ID | 原问题 | 修复与验证 |
| --- | --- | --- |
| PRR067B-R1 | 同一 evidence 目录可再次运行并覆盖失败轮次，不符合“重试=新一轮、旧轮保留” | runner 在启动 candidate 前检查本轮拥有的 artifact/HOME；冲突即拒绝，并要求全新 attempt 子目录；红灯证明旧文件原文未变 |
| PRR067B-R2 | 独立 `cold-conditioning.json` 虽有三重身份绑定，但其 bytes 未被 summary SHA-256 绑定 | raw/summary 新增 conditioning artifact path/hash；verifier 复算 artifact SHA-256，并交叉校验 raw、summary 与独立记录 |
| PRR067B-R3 | 批准要求 `sessionFirstLaunchMs` 传播到 native report 与 G-FINAL request，但 PRR-070 指令和最终 verifier 未约束 | PRR-070 卡、readiness schema 与 verifier 已要求 native report 绑定同轮 summary path/hash 并携带双指标；G-FINAL request 也必须逐值展示 |
| PRR067B-R4 | decision register 已记录 ADR 0006 v1.1.0 hash，但 `verify-decision` 完全忽略 `performanceProtocol` | bootstrap/packaging decision gate 现在复算 ADR bytes、批准身份、关键预算/样本/estimator/失败语义；该 gate 纳入 `pnpm quality`，并补 ADR hash/参数漂移红灯 |

## 独立验证

| 验证 | 结果 |
| --- | --- |
| PRR-067/发布 runner 定向测试 | `78/78 PASS` |
| 全量 `pnpm test:unit` | `52 files / 534 tests PASS` |
| `pnpm format:check` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `node scripts/runtime-spike/verify-decision.mjs --phase packaging docs/decisions/decision-register.json` | PASS；ADR 0006 SHA-256=`12768465e9ab5b06ce73b16cc3e5f07f784be8c14914fe5f4873645ac4181e4e` |
| 决策包复算 | MD=`b88850e82a2f6b7962a5e7ac581d806d140bf56dbafcc2a0cc7514d9ff5ba85b`；JSON=`ac4ea609b0e85369478d591da43b3ff25f219b11be3e4432722260e84894f21c` |

## 未运行与边界

- 未构建或启动新的 PRR-070 候选；未复用、覆盖或重跑旧性能证据。
- 未执行签名、公证、凭据访问、Git push、上传或公开发布。
- 真机 conditioning/20 cold/20 warm、安装、LaunchServices、原生功能矩阵与 G-FINAL 仍属于下一轮新候选，不在本次实现审阅中冒充已通过。
- 产品图标仍须在新候选冻结前生产化并集成；因此 PRR-070 虽已解除 PRR-067 技术阻塞，仍保持在图标收口之后执行。

