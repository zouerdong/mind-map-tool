# PRR-069C-R2-F1 阶段 B 实施报告（三轮原生预检）

> 2026-09-12 独立审阅更新：阶段 B 已 `ACCEPT`，仅解锁 PRR-070 阶段 A。独立复算、证据限制与
> 审阅修正见[阶段 B 独立审阅](./prr-069c-r2-f1-stage-b-independent-review-2026-09-12.md)。下文保留执行侧
> 交回时的原始状态；三个预检 DMG 不得作为 PRR-070 候选或 G-FINAL 输入。

状态：**执行完成，等待独立审阅**（`STOP_FOR_INDEPENDENT_REVIEW`）。本报告是执行侧自述，不构成独立验收；
PRR-070 / G-FINAL / PRR-080 / PRR-090 继续阻塞。

## 0. 基线与提交关系

| 项 | 值 |
| --- | --- |
| Base（派发基线，clean） | `225923f12abac23db0a6605160477cd36c8ca93a` |
| SourceCommit（三轮 frozen HEAD） | `225923f12abac23db0a6605160477cd36c8ca93a` |
| HandoffCommit | 见本报告所在文档提交（`git log -1 --format=%H`），仅报告/状态文档差异 |
| 祖先判据 | `0da0d406a3d9b9041921d470363d7db52d5f59f9` 是 Base 的祖先（`git merge-base --is-ancestor` 通过） |
| 代码树一致性判据 | `git diff --stat 225923f..HEAD -- scripts tests apps packages` 必须为空 |

本轮无代码提交：Base 与 SourceCommit 相同；三轮全部在 frozen HEAD `225923f` 上执行，
每轮前后 HEAD 与 `git status --short` 均复核（见 §5）。

执行环境：macOS 26.6.2（25G83）、Apple Silicon arm64、24 GB 内存；Node v26.8.2、pnpm 9.15.9、
Rust 1.98.0（stable，rust-toolchain.toml 固定 channel + rustfmt/clippy）、tauri crate 2.11.5（Cargo.lock）。

## 1. 源码门（全部在 frozen HEAD 执行，任一失败即 STOP；实际 12/12 通过）

| # | 命令 | exit | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `pnpm format:check` | 0 | All matched files use Prettier code style | `gate-01-format-check.txt` |
| 2 | `pnpm typecheck` | 0 | packages/ui + apps/desktop 通过 | `gate-02-typecheck.txt` |
| 3 | `pnpm lint` | 0 | 两包通过 | `gate-03-lint.txt` |
| 4 | `pnpm exec vitest run tests/bootstrap/release-runners.test.ts` | 0 | **132/132** | `gate-04-release-runners.txt` |
| 5 | `pnpm test:unit` | 0 | **654/654**，53 files | `gate-05-test-unit.txt` |
| 6 | `pnpm test:integration` | 0 | 94 tests + boundaries PASS | `gate-06-test-integration.txt` |
| 7 | `pnpm icon:verify` | 0 | PASS，母版无漂移 | `gate-07-icon-verify.txt` |
| 8 | `pnpm build` | 0 | vite 构建成功 | `gate-08-build.txt` |
| 9 | `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | 无差异（零输出） | `gate-09-cargo-fmt.txt` |
| 10 | `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | **210 passed / 0 failed** | `gate-10-cargo-test.txt` |
| 11 | `cargo clippy --all-targets --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` | 0 | 无警告 | `gate-11-cargo-clippy.txt` |
| 12 | `git diff --check` | 0 | 无空白错误 | `gate-12-git-diff-check.txt`（零输出） |

## 2. 任务根预检（步骤 3，只读）

六个路径在执行前全部确认不存在（三个 `.tmp/prr-069c-r2-f1-225923f…-attempt-0N/work` 与三个
`.tmp/release-candidate/prr-069c-r2-f1-225923f…-attempt-0N/`）；未删除、未改名、未换编号。
历史 attempt 目录（含 R2 source `885d877` 的三个）只读未触碰。

## 3. 三轮正式 attempt

命令形状（每轮仅 `-attempt-0N` 不同，完整命令见各轮 `attempt-0N-gate-output.txt` 与报告）：

```text
env -u MINDMAP_DMG_CLEANUP_GRACE_MS node scripts/quality/bundle-gate.mjs \
  --host tauri --scope-from docs/decisions/decision-register.json \
  --candidate-root apps/desktop/src-tauri/target/release/bundle \
  --assemble-dmg --dmg-format ULMO \
  --work-dir .tmp/prr-069c-r2-f1-225923f…-attempt-0N/work \
  --inventory .tmp/release-candidate/prr-069c-r2-f1-225923f…-attempt-0N/bundle-inventory.json \
  -- pnpm --filter @mindmap/desktop tauri build --bundles app
```

每轮均从同一 clean source 完整重建（tauri release 重编译 + vite 前端重建），不复用前轮 artifact；
`MINDMAP_DMG_CLEANUP_GRACE_MS` 以 `env -u` 显式剥离，未传任何 fixture 注入；预算常量未改
（单命令 120000ms、装配 180000ms、清理宽限 60000ms，报告 `timeoutMs/deadlineMs/cleanupGraceMs` 三字段证实）。

### 3.1 汇总

| 轮 | UTC 起止 | exit | DMG SHA-256 | DMG bytes | app SHA-256 | app bytes | assemblyMs | cleanupMs | totalElapsedMs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 2026-09-12T01:33:51Z → 01:34:47Z | 0 | `79d05f20d41511ded03f8230d520c98ab9986a5898c08b0eeacd20142f3ac4b0` | 24284017 | `465d0d6a4f7c9a48084064da3b3519c9c6765af5df675f63cbc5d2e3e6867222` | 28067488 | 9361 | **0** | 9361 |
| 02 | 2026-09-12T01:36:20Z → 01:37:15Z | 0 | `91b02d4cbf0e02cd4b7cdec26785a1bd3c44d1b1ede2d8e6a123a4a01c18984b` | 24284073 | 同上 | 28067488 | 9312 | **0** | 9312 |
| 03 | 2026-09-12T01:37:59Z → 01:38:56Z | 0 | `9f841ed736806336fbca26fd2800c4f8d1e987ac4c4f895b8471ba8add33b187` | 24284017 | 同上 | 28067488 | 11060 | **0** | 11060 |

三轮 `timings` 均满足 `totalElapsedMs = assemblyMs + cleanupMs`、`cleanupMs=0`、`cleanupStarted=false`、
`cleanupStatus=CLEAN`（成功轮无清理动作、挂载自然完成，符合任务卡第 5 步要求）。

### 3.2 每轮共同核验项（三轮逐一记录于各自 `attempt-0N-report-extract.txt` 与独立复算文件）

- **格式/完整性**：`dmgFormat=ULMO`、`crc32=VALID`、DMG ≤ 25000000B（实际 24284017/24284073/24284017）。
- **EULA**：`licenseSha256 == resourceSha256 == b6427bae…`（根 LICENSE 2395B 生成）；挂载前探针
  `pre-mount-eula-refusal` 每轮均为**正常结束、status=1、无挂载**（有效拒绝证据），随后
  `pre-mount-eula-mount-table-check` status=0 确认无残留；`preMountDisplayVerified=true`、
  `displayMarker="Copyright (c) 2026 ErDong Zou. All rights reserved."`。
- **卷内容**：`mountedEntries = [.VolumeIcon.icns, Applications, Mind Map.app]`；
  `applicationsTarget=/Applications`；卷图标 SHA-256 `7146e7c8…`（= `apps/desktop/src-tauri/icons/icon.icns`，307255B）。
- **app payload identity**：`bundleId=com.mindmap.desktop`、`shortVersion=0.1.0`、`bundleVersion=1`、
  `minimumSystemVersion=11.0`、`archs=arm64`；`payloadAppSha256` 与 inputs 一致。
- **真实工具链**：`/usr/bin/hdiutil`（`7b73b38f…`）、`/usr/bin/ditto`（`638df9b6…`）、`/usr/bin/SetFile`
  （`b8763cf2…`）、`/sbin/mount`（`e0368cc8…`）、`/usr/bin/plutil` 等系统工具，路径与 SHA-256 记录于各轮报告。
- **命令纪律**：每轮 27 条子命令，无 timeout、无 signal、无 spawnError、无 skipped；除 EULA 拒绝探针的
  预期 status=1 外全部 status=0。
- **挂载前后**：装配前挂载表无该轮 mountpoint；每轮结束后 `mount | grep "Mind Map"` 为空、
  `hdiutil info` 无 image 条目（独立复核，见 `attempt-0N-independent-verify.txt`）。
- **独立复算**：DMG/LICENSE/ICNS/runner SHA-256 与字节数、app 递归字节数（28067488）由执行侧在
  每轮结束后用 `shasum`/`stat`/`find` 复算，与 runner 报告一致；attempt-01 文件中的 hash/size 块产生于
  attempt-02 启动之前（01:35:58Z < 01:36:20Z），但该文件随后追加了 attempt-02 EULA cross-check，
  因此不能把整个文件的最终状态描述成 01:35:58Z 已冻结。

### 3.3 三轮一致性与 DMG 字节差异说明

- app SHA-256 三轮**完全一致**（同一 frozen source 的确定性重建）。
- DMG SHA-256 三轮互不相同（字节差 ±56B 以内）。该现象与历史 R2 source `885d877` 的三轮正常预检
  完全同构（`edd209ed…`/`db0913b6…`/`636b584b…`，app 同为 `465d0d6a…`），属 ULMO `hdiutil` 路径的
  既有已知行为（镜像时间戳等非 payload 元数据），不是本轮新引入的回归；每轮 CRC32 均为 VALID，
  payload identity 一致。ADR 0013 的"确定性装配"指无 Finder 依赖的确定性流程，非 DMG 字节级可复现。

### 3.4 runner 与 helper 指纹（三轮相同，冻结树）

| 文件 | SHA-256 | 字节 |
| --- | --- | --- |
| `scripts/quality/assemble-dmg.mjs`（runner） | `21ff7e8f506251f1ca408f1b33acee041d61e2d47b812ce85c6371557670d016` | 66505 |
| `scripts/quality/dmg-assembly-contract.mjs` | `0aef36afdef917ed69f4574765de256ecb8f3451bc219778194aede4257af819` | 17929 |
| `scripts/quality/dmg-budget.mjs` | `f5b71e0922f7d53c00b3e4752e7ce29ab0763988e150e6434de4ffb1ec641b1a` | 3874 |
| `scripts/quality/bundle-gate.mjs` | `24ee4f06df57242db0382154052e582001ffb427d2036fa4e721a1a6edaf29c3` | 30260 |

## 4. 证据清单

- 执行侧证据目录：`.tmp/prr-069c-r2-f1-stage-b-20260912T000000Z/`
  （12 个源码门输出、3 组 attempt 起止/输出/报告提取/独立复算、`source-frozen.txt`、
  `evidence-sha256-manifest.txt` 共 25 个文件）。
- 每轮证据根：`.tmp/release-candidate/prr-069c-r2-f1-225923f…-attempt-01|02|03/`
  （各含 `bundle-inventory.json`、`dmg-assembly-report.json`）。
- 每轮任务根（成功轮保留）：`.tmp/prr-069c-r2-f1-225923f…-attempt-01|02|03/work/`。
- 全部 SHA-256 见 `evidence-sha256-manifest.txt`（manifest 自身排除在哈希之外）。

## 5. 源完整性（SourceIntegrity）

- 三轮之前：HEAD `225923f12abac23db0a6605160477cd36c8ca93a`，`git status --short` 0 行。
- 每轮结束后与三轮全部结束后：HEAD 未变、worktree 0 行、系统挂载表无本轮 mountpoint。
- 交回提交仅含报告与状态文档：`git diff --stat 225923f…<HandoffCommit> -- scripts tests apps packages` 为空。

## 6. 未执行项（NotRun）

PRR-070 / performance matrix / 安装 / LaunchServices / G-FINAL / PRR-080 / PRR-090 全部未执行、未解锁。

## 7. 风险（Risks）

1. DMG 字节级跨轮不可复现（§3.3）：验收若要求字节级可复现需另立协议；本卡未作此要求。
2. 执行侧独立复算依赖 candidate-root 共享输出路径，前轮 DMG 实体会被后轮覆盖，仅存哈希记录
  （attempt-01/02 的 DMG 文件本体已被后轮构建覆盖，各自 hash 与字节以当轮报告 + 当轮后即时复算为准）。
3. 阶段 A 遗留未变：`assemble-dmg.mjs` 含一个裸控制字节（`rg --text` 可读）；不属本卡修改范围。
4. evidence manifest 的 `./...` 以 evidence 目录为基准，而 `.tmp/...` 以仓库根为基准；不能在单一 cwd 直接
   `shasum -c`。独立审阅按两种明确基准复算 31/31 一致；PRR-070 起统一使用仓库相对路径。

## 8. 红线确认（Redlines）

未修改源码、测试、runner、生产配置、ADR、预算或协议；未复用/覆盖任何历史 attempt；未走
Finder/AppleScript/`.DS_Store` 路线；未签名、未公证、未访问凭据、未改系统信任或设置；未做
LaunchServices 注册、安装、性能采样；未 push、未上传、未公开发布；未设置
`MINDMAP_DMG_CLEANUP_GRACE_MS`（正式轮 `env -u` 剥离）；未改变 120000/180000/60000ms 预算。

## 9. 交回状态

`STOP_FOR_INDEPENDENT_REVIEW`。阶段 B 独立审阅接受前，PRR-070 / G-FINAL / PRR-080 / PRR-090 保持阻塞；
本报告不构成独立验收。
