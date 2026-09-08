# PRR-070 阶段 A 冷启动失败独立审阅

日期：2026-09-08  
source：`ea047e8de3e05b1a262d534ffc5989a11af3ee6f`  
candidate SHA-256：`b7c535b1ab09952935344c16b0a732201ae64677b6a162f0974a1ef6e6123cce`  
结论：`BLOCKED / PRR-067_REQUIRED`

## 结论

PRR-070 阶段 A 在步骤6停止正确，本轮候选不能请求 G-FINAL，也不能继续步骤7～11。源码门、advisory、bundle、身份、DMG 和除 cold start 外的性能项均通过，但 `coldStartP95Ms=1685.4` 超过 Accepted 预算 `1500ms`。

失败集中在整个矩阵的第1个启动样本；其余19个 cold 样本为341.2～374.5ms，warm 20个样本为348.5～388.6ms。该形态说明问题与“新构建产物首次执行”高度相关，但现有 raw 没有 host/renderer 分段、逐样本 wall-clock、PID、系统负载或安全校验信息，不能据此把原因写成磁盘缓存、WebView、Gatekeeper 或应用初始化。

不得采取以下做法恢复绿灯：删除第1个样本、重跑后挑选通过批次、把20样本 estimator 改为第二大值、提高1500ms预算，或在没有协议批准时静默增加未计入的预热启动。

## 独立复算

| 项目 | 复算结果 |
| --- | --- |
| source/worktree | `ea047e8…`；审阅开始时 clean |
| candidate tree hash | `b7c535b1…23cce`，与 raw/summary/inventory 一致 |
| runner hash | `40e0120e…a9c6e9`，与当前 `run-performance.mjs` 一致 |
| raw hash | `9e8eae0c…bc3c0`，与 summary 一致 |
| summary hash | `73981876…196f8` |
| inventory hash | `52f83d45…f27b` |
| cold p95 | 当前固定算法 `sorted[floor(20×0.95)] = sorted[19] = 1685.4ms` |
| cold 离群位置 | 采样顺序第1个；第二大值374.5ms，p50 358ms |
| 其他预算 | warm 388.6ms、RSS 107.5MB、canvas 18ms、edit 18ms、save 11ms、PNG 1617ms、DMG 24,550,870B，全部 PASS |

## 处置

新增 [PRR-067 冷启动首次执行归因与协议收口](../planning/prr-067-cold-start-attribution-task-card-2026-09-08.md)。PRR-067 必须先获得可复算的启动分段与对照实验，再决定是修应用路径，还是向负责人申请性能协议澄清。任何方案都不得修改预算、有效样本数或 percentile estimator。

本轮 `.tmp/release-candidate/ea047e8…/` 保留为只读失败证据。PRR-070 保持阻塞；只有 PRR-067 形成新 clean commit 并通过独立审阅后，才能从步骤1重新执行。
