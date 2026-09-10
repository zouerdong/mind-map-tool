# PRR-070 阶段 A `.DS_Store` STOP 独立审阅

日期：2026-09-10

结论：`REJECT CANDIDATE / RETURN TO PRR-069C`

审阅 source：`b45dc0c4b417ca0c647b5e54bce45d5330a604b5`

## 结论

执行 Agent按预先派发的 STOP 规则处理正确。本轮不能从步骤 5 续跑；最终自然完成的 `.app`/`.dmg` 只读保留为失败证据，不具备 PRR-070 唯一候选资格。

第二次 clean build 再次进入 Tauri 2.11.4 `bundle_dmg.sh` 的 Finder AppleScript 无上限 `.DS_Store` 轮询。执行 Agent在等待 9 分 15 秒后冻结现场并停止；约 74 秒后原构建进程没有人工干预地自然完成。自然完成证明输出字节可用，但不能追溯撤销已经命中的 STOP，也不能证明下一次构建可在受控时间内完成。

## 独立复算

- source HEAD 与当前 worktree：`b45dc0c4b417ca0c647b5e54bce45d5330a604b5` / clean。
- `.app` SHA-256：`cfa414c8dc41e3d2a16009b816f6ae2e0a364528dcfe267b549e0e85569c5b20`。
- DMG SHA-256：`0fbdfc832ddc9b4fde5c514bd183cb43ddb5b5d1c017fd7b8675c9317a146b83`。
- DMG：`24288680B`、`Format=ULMO`、`hdiutil verify` CRC32 VALID。
- inventory 的 source/runner/repack hash 与当前文件一致；没有 source/worktree 漂移。
- `step4-dsstore-wait-resolution.txt` 的 `2026-09-10T04:20:39.3NZ` 不是合法 UTC ISO，不能进入最终时间拓扑；该缺陷不改变本轮已经作废的结论。

## 为什么不能接受本轮

1. 派发输入明确规定该等待再次发生必须 STOP；STOP 生效后不得靠后续偶然结果改判。
2. 同一失效模式已由独立审阅和执行 Agent各复现一次，属于发布链结构性不确定性。
3. Finder 是否写入 `.DS_Store` 受会话/桌面活动影响，执行侧无法控制或证明；重跑只是在挑选环境结果。
4. 延长等待、人工/自动创建 `.DS_Store`、`--ci`/`--skip-jenkins` 或复用本轮 DMG 都不解决完成条件不可控的问题。

## 后继

先执行 [PRR-069C](../planning/prr-069c-deterministic-dmg-assembly-task-card-2026-09-10.md)，用 app-only Tauri build 和仓库受控的系统工具装配路径替代 Finder DMG 美化。独立审阅通过并形成新 clean source 后，PRR-070 才能从步骤 1 完整重做。

保留范围：`.tmp/release-candidate/b45dc0c4b417ca0c647b5e54bce45d5330a604b5/` evidence 只读保留，不得删除、覆盖或补写。PRR-069C 在刷新 canonical `target/release/bundle` 前须把仍与报告 hash 一致的当前作废候选复制到新的任务临时归档；不得把该归档用于后续装配、继续原生矩阵或生成 G-FINAL 请求。
