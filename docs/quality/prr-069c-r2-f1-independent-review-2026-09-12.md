# PRR-069C-R2-F1 阶段 A 独立审阅

结论：`ACCEPT / STAGE_B_READY / PRR-070_BLOCKED`。

审阅基线为交回 HEAD `14cb77bd1c7a40d34f4972101e6d1d597fec5e16`，原实现 source 为
`32148097aaf9f7a9da0a7de8996de8583ad3c2d0`。独立审阅发现的局部缺口已由维护者直接修复，
最终代码 source 为 `0da0d406a3d9b9041921d470363d7db52d5f59f9`；未改产品逻辑、图标、生产 Tauri 配置、
ADR、预算、依赖或 CI/CD。

## 1. 独立判断

R2-F1 的三项原始目标均成立：

1. EULA 拒绝证据只接受正常结束的非零退出；timeout、signal、spawn error、缺失/非法 status
   均按执行失败处理，不能被 LICENSE marker 挽救。
2. 失败清理只创建一个 cleanup context；前查询、detach、后查询共享同一截止时间，预算耗尽后
   不再启动子进程。
3. 正式任务根必须由 assembler 本轮原子创建；历史目录、空目录、残留 logs 和创建竞争均不能重入。

审阅额外发现并已关闭以下小问题：

| 编号 | 问题 | 处置 |
| --- | --- | --- |
| IR-1 | attach 恰好耗尽 assembly deadline 时，pending mount 无法再用 assembly context 对账 | 失败清理用既有 cleanup context 查询 exact mountpoint；确认本轮设备后才 detach；失败或身份不符保持 UNKNOWN/RESIDUAL |
| IR-2 | 失败报告把已包含 cleanup 的 assembly elapsed 与 cleanup elapsed 相加，可能重复计时 | 以 cleanup 起点切分单一单调时钟区间，报告满足 `total = assembly + cleanup` |
| IR-3 | 两个子区间各自四舍五入时可能产生 1ms 漂移 | 总区间只取整一次，cleanup 使用余数；增加亚毫秒假时钟反例 |
| IR-4 | fixture 环境变量接受正式值 `60000`，与“只可调小”不一致 | 合法范围改为正整数且严格 `< 60000`；正式 assembler 与 gate 均在副作用前拒绝该变量 |
| IR-5 | F2-a/F2-c 的真实墙钟断言易受机器负载影响 | 精确预算移到假时钟测试；完整子进程测试只验证接线，并给 attach 前置步骤足够余量 |

## 2. 安全不变量复核

- pending mount 只按 exact mountpoint 接管，detach 前再次核对设备身份。
- mount table 不可用、清理预算耗尽、设备不匹配、detach 失败或后查失败时，不写 `CLEAN`。
- 只有 exact mountpoint 已不存在，或确认归属后 detach 成功且后查无残留，才写 `CLEAN`。
- 失败清理只回收本轮已证明归属的挂载；不会根据空 stdout 或路径近似值盲目卸载。
- 清理成功不会覆盖原始装配错误；最终仍由 `fail()` 返回非零，不生成成功 inventory。
- fixture-only 宽限缩短入口不进入正式模式，正式 60000ms 常量未变。

独立只读复核结论：P0/P1/P2/P3 均无剩余项。

## 3. 独立验证

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run --root . tests/bootstrap/release-runners.test.ts -t 'PRR-069C-R2-F1'` | PASS，19 项通过 |
| `pnpm test:unit` | PASS，53 files / 654 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:integration` | PASS，94 tests + boundaries |
| `pnpm icon:verify` | PASS，C 方案图标无漂移 |
| `pnpm build` | PASS |
| `cargo fmt --all -- --check` | PASS |
| `cargo test` | PASS，210 tests |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `git diff --check` / 目标文件 Prettier check / 四个 `.mjs` `node --check` | PASS |

本轮没有真实 DMG 构建、真实挂载、LaunchServices 注册、安装、性能采样、签名、公证、上传或发布。

## 4. 解锁边界

阶段 A 已接受，仅解锁 [PRR-069C-R2-F1 阶段 B 原生预检任务卡](../planning/prr-069c-r2-f1-stage-b-native-precheck-task-card-2026-09-12.md)。
阶段 B 必须从包含最终修复与本任务卡的最新 clean HEAD 冻结 source，连续执行三轮全新原生预检；任一轮失败立即 STOP，
不得重跑挑绿。阶段 B 交回再次独立审阅前，PRR-070 / G-FINAL / PRR-080 / PRR-090 继续阻塞。
