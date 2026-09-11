# PRR-069C-R2 实施报告：attach 异常接管与路径隔离闭合

日期：2026-09-11

状态：**执行完成，等待独立审阅**（`STOP_FOR_INDEPENDENT_REVIEW`）。本报告是执行侧自述，不构成独立验收；PRR-070 / G-FINAL / PRR-080 / PRR-090 保持阻塞。

- 派发基线：`ed30987fe64756cee3057d8c4f4320bef51335b1`（clean，与派发时一致）
- 实现 source（三轮预检实际 source）：`885d877b660a608604c8dc5921aeabd49fd4131e`
- 交回 HEAD：见本报告所属文档提交（下表“source 与交回 HEAD 的差异”）
- 依据：[PRR-069C-R1 独立审阅](./prr-069c-r1-independent-review-2026-09-11.md)、[R2 完整任务卡](../planning/prr-069c-r2-attach-and-path-safety-task-card-2026-09-11.md)

## 1. 修改内容

| 文件 | 变更 |
| --- | --- |
| `scripts/quality/dmg-assembly-contract.mjs` | 新增。DMG 装配专用契约模块：固定工具清单、注入路径与注入工具集合校验、work-dir 逐分量与落点校验、清理宽限常量 |
| `scripts/quality/assemble-dmg.mjs` | attach 生命周期统一为“先登记 pending，再按 mount table 核对，再决定语义”；受控卸载增加卸载前设备身份核对；失败清理改为独立有界宽限；work-dir 与工具注入改用共享契约；成功路径回收空 work-dir；失败/成功报告补充 `pendingMount`/`mountState`/`cleanup`/`timings` |
| `scripts/quality/bundle-gate.mjs` | 注入路径改用共享校验；新增注入工具集合完整性校验（build 之前）；work-dir 改用共享校验并新增落点核对；assembler 终止窗口容纳声明的清理宽限；工具名清单改用 `DMG_TOOL_NAMES` |
| `scripts/quality/g2-scope.mjs` | 仅移除 R1 新增的 `SYSTEM_TOOL_PATHS`；授权、签名检测与通用路径语义未改 |
| `tests/bootstrap/release-runners.test.ts` | 新增 R2 红灯/回归矩阵 24 项；mock 工具链补充阶段化 attach 异常注入、调用轨迹落盘与设备身份替换钩子 |

未修改：生产 Tauri 配置、应用逻辑、图标（负责人选定的 C 方案保持原样）、许可文本、ADR、decision register、证据 schema、依赖、CI/CD、系统设置。

## 2. 四项发现的处置

### R2-01 attach 异常接管（P1）

- 任何 attach 子进程启动前先写入本轮 `pendingMount`（exact mountpoint + stage + 时间），不再等 exit 0 才登记责任。
- 正常 / 非零 / timeout / signal / spawn error 一律先按 `mount table` 精确复核（严格 ``on <mp> (`` 与 `/dev/disk*` 设备正则），再决定语义：
  - 已挂载 → 立即接管为 active mount；`requireSuccess` 且 attach 未成功时，先在清理宽限内受控卸载并复核表内不再存在，然后整体仍返回失败（超时不得转成成功）。
  - 未挂载但 stdout 声称挂载 → 状态矛盾，STOP 保留现场。
  - 退出 0 却没有任何挂载 → 同样视为状态矛盾并 STOP，绝不当作“没有挂载”。
  - mount table 不可用 → fail-closed，转入有界清理并报 UNKNOWN。
- 卸载新增**卸载前置身份核对**：表不可读时拒绝卸载（UNKNOWN）；表内该挂载点设备与本轮登记不符时拒绝卸载（RESIDUAL）。只清理本轮可证明拥有的挂载。
- 仅有 pending 登记、无法证明归属时不做卸载，保留 pending/active/residual 结构化证据并 STOP。
- 清理有界：`DMG_CLEANUP_GRACE_MS = 60000` 单独计时、仅用于回收；装配预算仍为单命令 120000ms / 整轮 180000ms，二者未变。父 gate 的终止窗口改为 `deadlineMs + 清理宽限 + 30s`，避免在清理中途杀掉 assembler。
- 报告明确两段耗时：成功报告 `timings.{assemblyMs, cleanupGraceMs, cleanupMs}`；失败记录 `cleanup.{graceMs, elapsedMs, status, attempts}`、`mountState`、`pendingMount`、`timeoutMs`、`deadlineMs`。
- 不使用 force / sudo / 批量卸载。

### R2-02 fixture 工具注入闭合（P1）

- gate 与直接 assembler 两个入口共用 `validateInjectionPath`：拒绝绝对路径、`..` 穿越、通配符、任一分量 symlink、越界落点与指向 canonical 仓库源码区的注入（fixture root 与 canonical root 的身份判定保持 realpath 归一化）。
- 提供 tool-dir 时，`validateInjectedToolSet` 在**任何工具调用与工作目录写入之前**校验七项工具：存在、常规文件（非 symlink/断链/目录）、可执行、真实落点位于注入目录内。缺项、断链、symlink、类型错误、不可执行一律直接失败；gate 在 build 之前 BLOCKED。
- `resolveTool` 在注入模式下只认校验通过的集合，**缺项即 fail-closed，禁止回退 `/usr/bin` 等真实系统工具**。
- 合法的仓库内合成 fixture（含嵌套目录）仍照常通过。

### R2-03 work-dir 路径分量与实际落点（P1）

- 从归一化 ROOT 逐分量 `lstat`，中间层、末级与悬空 symlink 全部拒绝；随后用最近已存在祖先的 realpath 核对实际落点，再对候选产物目录与 G2 evidence 目录做落点比较（不只依赖词法前缀）。
- 保留 `.tmp/prr-069c-<非空>` 白名单；**不再接受“已存在但为空”的 work-dir**，借用历史 attempt 树复跑同一 work-dir 的入口因此关闭；正式 attempt 目录中除本轮 work 分量外只允许 `logs` 目录，历史 attempt 的新子目录被拒绝。
- 允许本轮唯一新 attempt 下 work 与日志作为兄弟目录（本次三轮即使用 `attempt-NN/logs` 与 `attempt-NN/work`）。
- 成功路径回收本轮创建且已清空的 work-dir。
- 两个入口在 build / mkdir / 工具 / 挂载之前完成上述校验；本轮未声称可抵抗运行期间的任意并发路径替换。

### R2-04 模块归位（P2）

`SYSTEM_TOOL_PATHS` 移入仅供 DMG 两入口使用的 `dmg-assembly-contract.mjs`；`g2-scope.mjs` 只移除该常量，未重置、未放宽 G2 授权能力，其他消费者行为不变。

## 3. 红灯与绿灯

红灯在**未修实现**上运行并保留完整输出；绿灯在同一测试集合的修复实现上运行。

| 证据 | 结果 |
| --- | --- |
| `.tmp/prr-069c-r2-20260911T-impl/red-01-r2-block.txt` | 首轮红灯：18 failed / 4 passed（4 项为保持性回归断言） |
| `.tmp/prr-069c-r2-20260911T-impl/red-02-r2-block.txt` | 调整断言顺序后重跑，红灯输出直接证明“本轮挂载遗留在 mock mount table 中” |
| `.tmp/prr-069c-r2-20260911T-impl/green-08-full-suite.txt` | 修复后全量专项 113/113 PASS（R1 原有 89 项 + R2 新增 24 项） |

红灯覆盖的关键缺陷：可写卷/最终只读卷/EULA 探针三个 attach 阶段的超时与挂载后非零退出均遗留挂载；gate 工具列表缺失 mock `ditto` 时回退真实 `/usr/bin/ditto` 并成功；绝对 `--tool-dir` 被直接 assembler 接受；中间层 symlink 指向 evidence 后 work-dir 校验通过并写入 evidence 树；历史 attempt 新子目录被接受。

修复过程中发现并处置的三个额外问题（均已补测）：

1. **清理归属**：mount table 不可读时不做未证明归属的卸载，保留现场并报 UNKNOWN；卸载前增加设备身份核对，身份不符即拒绝卸载并报 RESIDUAL（`R2-01h`/`R2-01l`）。
2. **exit 0 却无挂载**：视为状态矛盾并 STOP，不得当作“没有挂载”（`R2-01k`，三阶段各测一次）。
3. **mock 调用轨迹落盘**：mock 工具链原先仅在部分分支写状态文件，导致“没有真实系统工具调用”无法从证据侧复核；已在每次调用落盘。

R1 原有断言全部保留，未删除、未 skip、未改成恒空 mount mock。

## 4. 必跑验证（均在 source `885d877` / clean worktree 上执行）

| 命令 | 结果 |
| --- | --- |
| `pnpm format:check` | EXIT 0 |
| `pnpm typecheck` | EXIT 0 |
| `pnpm lint` | EXIT 0 |
| `pnpm exec vitest run tests/bootstrap/release-runners.test.ts` | 113 passed / 113 |
| `pnpm test:unit` | 635 passed（53 files） |
| `pnpm test:integration` | 94 passed（14 files） |
| `pnpm icon:verify` | EXIT 0 |
| `pnpm build` | EXIT 0 |
| `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` | EXIT 0 |
| `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | 210 passed / 0 failed |
| `cargo clippy --all-targets --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` | EXIT 0 |
| `git diff --check` | EXIT 0 |

原始输出保存在 `.tmp/prr-069c-r2-20260911T-impl/gate-05-full-final.txt`。

Windows：本卡原生验证不适用（macOS DMG 装配），未做 Windows 实测，也不宣称 Windows 通过。

## 5. 三轮正式预检

命令骨架与任务卡 §4.8 完全一致，未添加注入或阈值覆盖；三轮各自独立重新 build app 并装配 DMG，未复用前轮或历史 artifact。

```text
node scripts/quality/bundle-gate.mjs --host tauri \
  --scope-from docs/decisions/decision-register.json \
  --candidate-root apps/desktop/src-tauri/target/release/bundle \
  --assemble-dmg --dmg-format ULMO \
  --work-dir .tmp/prr-069c-r2-885d877b660a608604c8dc5921aeabd49fd4131e-attempt-<NN>/work \
  --inventory .tmp/release-candidate/prr-069c-r2-885d877b660a608604c8dc5921aeabd49fd4131e-attempt-<NN>/bundle-inventory.json \
  -- pnpm --filter @mindmap/desktop tauri build --bundles app
```

| 轮次 | exit | 墙钟 | DMG 字节 | DMG SHA-256 | 格式 | CRC32 | timeoutMs | deadlineMs | 装配 elapsedMs | cleanupMs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attempt-01 | 0 | 53s | 24284033 | `edd209ed7f4f941b…` | ULMO | VALID | 120000 | 180000 | 9397 | 0 |
| attempt-02 | 0 | 53s | 24284017 | `db0913b6cbafb615…` | ULMO | VALID | 120000 | 180000 | 10100 | 0 |
| attempt-03 | 0 | 52s | 24284025 | `636b584b488cf1f8…` | ULMO | VALID | 120000 | 180000 | 9886 | 0 |

三轮共同满足：ULMO；`hdiutil verify` 由独立系统工具复核为 CRC32 VALID；DMG ≤ 25000000 B；装配 ≤ 180000 ms；正式参数精确为 120000/180000。

跨轮不变量：

- app 产物三轮一致：`465d0d6a4f7c9a48…`，28067488 B。
- 卷根条目恰好 `[.VolumeIcon.icns, Applications, Mind Map.app]`；`Applications -> /Applications`；卷图标 hash == 仓库 ICNS hash；payload app hash == app-only build hash；identity 为 `com.mindmap.desktop / 0.1.0 / 1 / 11.0 / arm64`。
- EULA：`resourceSha256 == licenseSha256`，`preMountDisplayVerified`、`imageInfoDeclaresAgreement` 均为 true，展示标记与根 LICENSE 逐字节绑定。
- 工具清单三项均为系统绝对路径（`/usr/bin/hdiutil`、`/usr/bin/ditto`、`/usr/bin/SetFile`、`/sbin/mount`、`/usr/bin/plutil`、`/usr/bin/lipo`、`/usr/bin/xattr`）。
- 每轮命令日志 20 条，无 `timedOut`；detach 恰为 2 次（可写卷 + 最终只读卷）。
- 每轮挂载前后表逐行一致（无新增挂载）；成功路径 `cleanupMs = 0`（无失败清理）。
- 每轮成功路径回收了 work-dir：attempt 目录最终只含 `logs/`。

### source 与交回 HEAD 的差异

- SourceCommit（三轮预检实际 source）：`885d877b660a608604c8dc5921aeabd49fd4131e`
- HandoffCommit：见本报告的文档提交（父提交即 SourceCommit）
- 两者差异**仅限文档**；`scripts/quality/*.mjs`、`tests/bootstrap/release-runners.test.ts` 在两棵树中逐字节相同：

| 文件 | source `885d877` SHA-256 | 交回 HEAD SHA-256 |
| --- | --- | --- |
| `scripts/quality/bundle-gate.mjs` | `4b09a4841affc66842697ca79b71f1a9ea3307790b78f1bc1405e1e9bc47c58e` | 同名文件，由 `git diff --stat 885d877..HEAD -- scripts tests` 为空证明 |
| `scripts/quality/assemble-dmg.mjs` | `4211312f340f78d88b9ec2845bb5d635a461458267f65c76e8e0ac6693aac210` | 同上 |
| `scripts/quality/dmg-assembly-contract.mjs` | `5e379a8aefb1b6e3389b53fcc183302851ca65d0c30d3ec56ff49cf1d6f7d714` | 同上 |
| `scripts/quality/g2-scope.mjs` | `a6ebc4ab767bc0d0cf9dbd9f018e2a38810459bd4754276b49520f76157a34f1` | 同上 |
| `scripts/quality/eula-resource.mjs` | `a8bd99845c04a104a5cee90a98defca75aba7a885d02ede92539cfabe782599a` | 同上 |
| `scripts/quality/release-budgets.mjs` | `4f92aa093c7402f4e2c04171a32630de8514b1370b6acf9d336939254302f01f` | 同上 |

## 6. 证据清单

唯一的红灯/绿灯目录：`.tmp/prr-069c-r2-20260911T-impl/`（含 `baseline.txt`、`pre-change-hashes.txt`、`historical-evidence-readonly.txt`、`red-*.txt`、`green-*.txt`、`gate-*.txt`、`collect-round.sh`、`evidence-sha256-manifest.txt`）。

三轮目录：

- `.tmp/prr-069c-r2-885d877b660a608604c8dc5921aeabd49fd4131e-attempt-01/logs/`（…-02、…-03 同构）：`command.txt`、`started-at.txt`、`finished-at.txt`、`exit-code.txt`、`wall-seconds.txt`、`source-commit.txt`、`mount-state-before.txt`、`mount-state-after.txt`、`bundle-gate.log`、`evidence.txt`
- `.tmp/release-candidate/prr-069c-r2-885d877b660a608604c8dc5921aeabd49fd4131e-attempt-01/`（…-02、…-03 同构）：`bundle-inventory.json`、`dmg-assembly-report.json`

逐文件 SHA-256 清单见 `evidence-sha256-manifest.txt`（56 条）。

历史证据只读核验：`.tmp/prr-069c-r1-attempt-0{1,2,3}`、`.tmp/release-candidate/prr-069c-r1-attempt-0{1,2,3}` 的目录级与逐文件哈希，以及 `docs/quality/prr-069c-r1-implementation-report-2026-09-11.md`、`docs/quality/prr-069c-r1-independent-review-2026-09-11.md`、`docs/planning/prr-069c-r1-release-gate-hardening-task-card-2026-09-11.md` 的哈希，在本轮开始与结束时完全一致，未被修改或复制为本轮证据。

## 7. 未运行 / 未宣称

- PRR-070、G-FINAL、PRR-080、PRR-090：未执行，也未申请。
- 签名、公证、凭据访问、`git push`、上传、公开发布：未执行。
- Windows 原生验证：不适用，未实测。
- 独立验收：未执行，本报告不冒充独立审阅结论。

## 8. 风险与遗留

1. **DMG 字节未逐轮一致**：三轮为 24284033 / 24284017 / 24284025 B（R1 历史为 24284017 / 24284021 / 24284037）。ADR 0013 的“确定性”指装配过程确定（无 Finder/AppleScript、无 `.DS_Store`、固定命令顺序与固定工具），并不承诺逐字节同一。本卡未声称字节级确定性，也未放宽任何阈值。
2. **并发路径替换未防护**：work-dir 校验是运行前与建目录前的检查，未声称能抵抗校验与使用之间的任意并发替换；任务卡 §2 R2-03.4 明确不要求声称这一点。
3. **历史 attempt 借用的边界**：本轮拒绝“已存在的 work-dir（含空目录）”，并限制正式 attempt 目录下除本轮 work 分量外只允许 `logs`。若某历史 attempt 目录恰好只含 `logs`，其下新建的子目录仍会被当作本轮 attempt 使用——该残余边界需要独立审阅判断是否接受；本轮未进一步收紧以避免破坏 `package.json` 中既有 `bundle:tauri --work-dir .tmp/prr-069c-assembly` 的可重复执行。
4. **mount table 不可读时的残留**：此时不执行未证明归属的卸载，会保留待人工检查的挂载现场。这是 R2 明确选择的 fail-safe 方向（保留证据、报 UNKNOWN），不属缺陷，但需要运维侧知晓。
5. **项目 `CLAUDE.md` 状态漂移**（既有，未修改）：其中“当前派发入口是 2026-09-06 参考对齐批次（VRA-000～VRA-090）”早于 PRR 批次，与本卡范围外的文件冲突。本卡允许范围不含该文件，故未改动，留待负责人决定。
6. **`scripts/quality/assemble-dmg.mjs` 含裸控制字节**（既有，未修改）：卷名校验正则 `/[\x00-\x1f/]/` 在源文件中是真实的 0x00/0x1F 字节，导致 `grep` 将该文件判为二进制（`git diff` 不受影响）。非本卡范围，未改动。

## 9. 红线确认

未删除任何历史数据；未采用 Finder/AppleScript/`.DS_Store` 路线；未使用 force/sudo；未签名、未公证、未访问凭据；未改动系统信任或设置；未注册 LaunchServices；未安装应用；未做性能采样；未全局安装；未 push、未上传、未公开发布；未扩大允许修改范围；未更改预算或发布协议。
