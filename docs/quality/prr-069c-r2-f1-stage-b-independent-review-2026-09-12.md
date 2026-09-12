# PRR-069C-R2-F1 阶段 B 独立审阅

结论：`ACCEPT / PRR-070_STAGE_A_READY`。

审阅对象：commit range
`225923f12abac23db0a6605160477cd36c8ca93a..8dba6f7aeb81f18e573c6c0bafaa8fe974e75a47`；
patch SHA-256：`9619482b2391a8995c0364c1a9c57842faacd06ff9366d123912e56578d857a3`。
该范围只修改报告与状态文档，`scripts tests apps packages` 无差异。

## 1. 独立复算结果

- SourceCommit 固定为 `225923f12abac23db0a6605160477cd36c8ca93a`，是阶段 A 最终修复
  `0da0d406a3d9b9041921d470363d7db52d5f59f9` 的 clean 后代。
- 25 个 gate/timing/extract 文件及 6 个 inventory/report 文件全部与 manifest 中 SHA-256 一致。
- 三轮 `bundle-inventory.json` 与各自 `dmg-assembly-report.json` 的嵌套报告逐字节语义一致；source、runner、
  helper、LICENSE、ICNS 指纹与冻结树一致。
- 三轮 app SHA-256 均为 `465d0d6a4f7c9a48084064da3b3519c9c6765af5df675f63cbc5d2e3e6867222`；
  DMG 为 ULMO、CRC32 VALID，字节数 24284017 / 24284073 / 24284017，均小于 25000000。
- 每轮 27 条系统工具命令均无 timeout、signal、spawn error 或 skipped；唯一非零命令是预期的
  `pre-mount-eula-refusal`（status 1），随后的 mount-table 查询为 status 0。
- 三轮 `totalElapsedMs = assemblyMs + cleanupMs`；`cleanupMs=0`、`cleanupStarted=false`，无失败清理或残留挂载。
- 当前系统挂载表与 `hdiutil info` 均没有本轮 mountpoint。
- 最后一轮 DMG 本体仍在磁盘：SHA-256 `9f841ed736806336fbca26fd2800c4f8d1e987ac4c4f895b8471ba8add33b187`、
  24284017 bytes；独立执行 `hdiutil verify` 返回 CRC32 VALID，`hdiutil imageinfo` 返回 `Format: ULMO`。
- 12 项源码门证据均为 PASS：release-runners 132/132、unit 654/654、integration 94、cargo 210，
  format/typecheck/lint/icon/build/clippy/diff-check 全绿。

## 2. 边界判断

| 边界 | 最强反例 | 独立结论 |
| --- | --- | --- |
| source 归因 | 报告提交夹带 runner/app 变更 | 不成立；交回相对 SourceCommit 的四个代码根无差异 |
| 任务根新鲜度 | 同名历史目录被重用或重跑挑绿 | 三个新任务根均由成功 assembler 报告绑定；原子创建合同下已存在根无法再次成功 |
| EULA 执行异常 | timeout/signal 被误当正常拒绝 | 不成立；三轮拒绝探针均正常结束 status 1，且 mount-table 后查成功 |
| 挂载生命周期 | detach 后仍残留但报告 CLEAN | 不成立；每轮报告、执行侧独立检查及当前系统检查均无残留 |
| artifact 归因 | 后轮覆盖共享 candidate-root，使前轮 hash 指向错误实体 | 前两轮二进制确已被后轮覆盖，但每轮 report/inventory 与下一轮前的即时独立 hash 记录吻合；足以作为预检，不足以作为最终候选 |

## 3. 审阅中直接修正的小问题

1. release checklist 仍引用 R2 source `885d877` 和“阶段 B 未执行”等过期状态；已同步为本次阶段 B 接受事实。
2. `attempt-01-independent-verify.txt` 的 hash/size 块确实在 attempt-02 启动前产生，但该文件随后追加了
   attempt-02 EULA cross-check，不能把整个文件的最终状态描述成 01:35:58Z 已冻结；实施报告已更正表述。
3. evidence manifest 同时使用相对 evidence 目录的 `./...` 与仓库相对 `.tmp/...`，不能从单一 cwd 直接执行
   `shasum -c`。独立审阅按两个明确基准解析后 31/31 全部吻合；PRR-070 要求新 manifest 统一使用仓库相对路径。

这些是 P2/P3 级证据表达与状态同步问题，不改变三轮真实运行结论。没有修改或覆盖 `.tmp` 历史证据。

## 4. 风险与放行边界

- 前两轮 DMG 本体未保留，只保留不可变报告、即时复算记录与 hash；因此三轮预检不得作为 PRR-070 最终候选或
  G-FINAL 输入。PRR-070 必须从新的 clean HEAD 构建唯一候选并生成全新 evidence。
- ULMO DMG 跨轮字节不同但 payload app 一致；ADR 0013 的确定性边界是无 Finder 的受控装配流程，不承诺镜像字节复现。
- `assemble-dmg.mjs` 的历史裸控制字节不影响本轮执行，仍属非阻断维护债。

阶段 B 只解锁 [PRR-070 阶段 A](../planning/prr-070-native-candidate-stage-a-task-card-2026-09-12.md)。
PRR-070 必须执行完整源码门、唯一候选、性能、受控安装/LaunchServices 和原生功能矩阵，随后停在
`WAITING_FOR_OWNER_G_FINAL`；未取得负责人对精确 candidate hash 的原文前，不得进入阶段 B、PRR-080 或 PRR-090。
