# PRR-069C 实施报告：无 Finder 依赖的确定性 macOS DMG 装配

日期：2026-09-10
状态：`REVISE / SUPERSEDED_BY_PRR-069C-R1`（正常路径记录保留；见[2026-09-11 独立审阅](./prr-069c-independent-review-2026-09-11.md)）
派发基线：`b14b78a900854c397247e3a43cd42f67db599c1f`（clean worktree）
source commit：`cf392e6044d8df1a467a6f6b6fabfb5309bb59c0`（三轮预检时冻结的 HEAD）
任务卡：[prr-069c-deterministic-dmg-assembly-task-card-2026-09-10.md](../planning/prr-069c-deterministic-dmg-assembly-task-card-2026-09-10.md)
依据：ADR 0013 v1.1.0；[PRR-070 阶段 A STOP 审阅](./prr-070-stage-a-ds-store-blocked-review-2026-09-10.md)

## 1. 结论

Tauri 的 macOS 打包链不再进入发布构建。正式路径现在是：**Tauri 只构建 unsigned `.app`（显式 `--bundles app`），仓库受控 assembler 用 macOS 自带系统工具从该 `.app` 装配最终 ULMO DMG**。装配链全程不启动 Finder、不调用 AppleScript/`osascript`、不使用 `--ci`/`--skip-jenkins`、不读取或生成 `.DS_Store`，也不存在对 `.DS_Store` 的等待——无论是有限还是无限。

三轮完整正式预检（各自独立的 evidence 目录、独立的 app-only build 与装配）全部通过，每轮 DMG 装配阶段为 11.8s / 10.7s / 9.7s（阈值 180s），最终容器为 ULMO、CRC32 VALID、24,286,381 / 24,286,333 / 24,286,341B（预算 25,000,000B）。

## 2. 根因与移除方式

PRR-070 阶段 A 的失败不是压缩格式问题，也不是等待时间不够：Tauri 2.11.4 的 `bundle_dmg.sh` 把 DMG 完成条件交给 Finder 会话写入 `.DS_Store`，并在无上限循环里轮询该文件。Finder 是否写、何时写取决于桌面会话状态，执行侧无法控制也无法证明。

本卡因此不移除等待，而是移除依赖：`dmg` target 不再出现在正式命令里（仓库测试对 `package.json` 与 runner 源码做静态禁区断言），DMG 由 `scripts/quality/assemble-dmg.mjs` 从 staging 一次性装配出来。

## 3. 装配链（全部为参数数组调用，无 shell 拼接）

| 步骤 | 命令/工具 | 作用 |
| --- | --- | --- |
| 1 | `ditto <app> <staging>/<App>.app` | 同源复制本轮 `.app`，复制后立即复算目录级 hash |
| 2 | 写 `.VolumeIcon.icns`、建 `Applications -> /Applications`、建 `.fseventsd/no_log` | 卷图标、安装快捷方式、阻止 fseventsd 写日志 |
| 3 | `hdiutil create -srcfolder … -fs "Journaled HFS+" -format UDRW -nospotlight -ov rw.dmg` | 受控可写镜像 |
| 4 | `hdiutil attach -nobrowse -noautoopen -mountpoint <run>/mnt-rw rw.dmg` | 挂载到本轮运行目录内的受控挂载点 |
| 5 | `SetFile -a C <mountpoint>` + `xattr -px com.apple.FinderInfo` 复核 | 卷图标属性（`kHasCustomIcon`），设置后立即复算 |
| 6 | 有界等待 → 删除 `<mountpoint>/.fseventsd` → 有界确认 | 与 `bundle_dmg.sh:547` 同意图，但改为确定性、有界（1.0s + 0.4s） |
| 7 | `hdiutil detach <mountpoint>` + 残留挂载检查 | 卸载并确认无残留 |
| 8 | `hdiutil convert rw.dmg -format ULMO -o <tmp>.dmg` | 最终容器压缩 |
| 9 | `hdiutil udifrez -xml <eula.xml> '' -quiet <tmp>.dmg` | 注入挂载前 EULA（`TEXT` 5000 = 根 LICENSE 原始字节） |
| 10 | `hdiutil imageinfo` / `verify` | `Format=ULMO`、`Software License Agreement: true`、CRC32 VALID、无签名/加密 |
| 11 | 空 stdin 的 `hdiutil attach` | 证明挂载前 EULA 生效：打印许可证正文并拒绝挂载 |
| 12 | 只读挂载 + 复核 | 卷根条目、`Applications` 目标、卷图标 hash、`.app` 目录级 hash、bundle id/version/minOS/arm64 |
| 13 | `hdiutil udifderez -xml` → 复算 EULA 字节 | 与根 `LICENSE` 逐字节绑定 |
| 14 | `renameSync` 到批准路径 + `imageinfo` 复核 + source/worktree 复核 | 发布与归因 |

体积、格式、CRC、EULA、卷图标、Applications 链接、payload 一致性与挂载生命周期全部在**写入最终 inventory 之前**由 assembler 判定；bundle-gate 随后独立复算 assembler 报告形状、`runnerSha256`、LICENSE hash 绑定、时间拓扑与最终盘点 hash，任一不符即整体失败且不写 inventory。

## 4. 失败与超时语义

- 每个子进程经统一 `runTool` 调用：参数数组、显式 `timeout`（默认 120s，按剩余 deadline 收紧）、`killSignal: SIGKILL`，起止时间与退出码进入命令日志。
- 整轮 `--deadline-ms` 默认 180s；超时或任一命令非零、挂载点与预期不符、detach 失败、残留挂载、卷根条目异常、EULA 缺失或 hash 不符、格式/CRC/体积异常、source/worktree 漂移，均 fail-closed 且不写 PASS inventory。
- 失败时输出单行结构化记录 `assemble-dmg: FAILURE {"stage","error","commands":[…]}`（含超时子进程的 `timedOut: true`），保留本轮运行目录供复算；只解除本轮的挂载，设备不一致时直接 STOP 不强拆。
- `--report` 已存在即拒绝覆盖；失败轮不会覆盖既有证据。

## 5. 证据

### 5.1 三轮正式预检

每轮写入各自的 attempt 目录与 G2 批准的 evidence 目录（互不复用、互不复制）：

| 轮次 | attempt 目录 | evidence 目录 |
| --- | --- | --- |
| 01 | `.tmp/prr-069c-attempt-01/` | `.tmp/release-candidate/prr-069c-attempt-01/` |
| 02 | `.tmp/prr-069c-attempt-02/` | `.tmp/release-candidate/prr-069c-attempt-02/` |
| 03 | `.tmp/prr-069c-attempt-03/` | `.tmp/release-candidate/prr-069c-attempt-03/` |

每轮 attempt 目录含 `attempt-0N-summary.json`（独立复算结果与 inventory 绑定）、`attempt-0N-bundle.log`、`attempt-0N-commands.log`、`mount-state-before.txt`、`mount-state-after.txt`；evidence 目录含 `bundle-inventory.json` 与 `dmg-assembly-report.json`。

跨轮一致性（三轮逐项比对）：

| 字段 | 结果 |
| --- | --- |
| `.app` SHA-256 | 三轮一致 `cfa414c8dc41e3d2…`（与作废基线同源） |
| `.app` 字节 | 三轮一致 `28,067,488` |
| LICENSE / EULA SHA-256 | 三轮一致 `b6427bae28963bd9…`（EULA 与 LICENSE 字节级相同） |
| 仓库 ICNS SHA-256 | 三轮一致 `7146e7c8788a982c…`（与镜像内 `.VolumeIcon.icns` 相同） |
| assembler runner SHA-256 | 三轮一致 `517c28ee413b825e…` |
| 预检 harness SHA-256 | 三轮一致 `e83228ed805a0ad3…` |
| DMG 字节 / 容器 hash | 分别 24,286,381 / 24,286,333 / 24,286,341B，hash 不同——ADR 0013 已声明容器元数据不保证跨次相同，payload/input/runner 一致 |
| 装配阶段耗时 | 11,762 / 10,685 / 9,719 ms（均 ≤180s） |

每轮均验证：`Format=ULMO`、CRC32 VALID、`Software License Agreement: true`、未同意时挂载被拒、`Applications -> /Applications`、卷图标 hash 与仓库 ICNS 一致、卷自定义图标属性已设置、卷根条目恰为 `{Mind Map.app, Applications, .VolumeIcon.icns}`（无 `.DS_Store`、无 `.fseventsd`）、DMG 内 `.app` 目录级 hash 与 app-only build 一致、bundle id/version/minOS/arm64 一致、detach 后无残留挂载、inventory 与独立复算完全一致、`sourceCommit` 与 worktree 全程不漂移、时间戳为合法机器生成 UTC 且顺序正确。

### 5.2 作废候选归档（只读历史留存）

刷新 canonical `target/release/bundle/` 之前，把仍与作废报告 hash 一致的 `b45dc0c` 产物复制到新目录并复算：

- `.tmp/prr-069c-invalidated-b45dc0c/Mind Map.app` — SHA-256 `cfa414c8dc41e3d2…`（与作废报告一致）
- `.tmp/prr-069c-invalidated-b45dc0c/Mind Map_0.1.0_aarch64.dmg` — SHA-256 `0fbdfc832ddc9b4f…`（与作废报告一致）
- 说明与复算记录：`.tmp/prr-069c-invalidated-b45dc0c/invalidated-candidate-archive.json`

该归档**未被**任何一次装配作为输入（装配输入始终是当轮 `tauri build --bundles app` 刷新出的 `.app`）。

### 5.3 只读冻结

`.tmp/release-candidate/b45dc0c4b417ca0c647b5e54bce45d5330a604b5/` 全程只读：36 个文件的目录级 manifest SHA-256 在任务开始与结束时均为 `4d6f2e19cd5b46b645a5bf460ad008643c8a48386aace157a951f622eaa56356`（未删除、未覆盖、未补写）。

### 5.4 红灯证据

新增用例在设计契约缺失时确实失败：把 `assemble-dmg.mjs`、`eula-resource.mjs` 移出源码树并回退 `package.json` 到基线后，`tests/bootstrap/release-runners.test.ts` 为 **19 failed / 55 passed**（记录见 `.tmp/prr-069c-red-proof/red-run-with-old-baseline.txt`）；实现恢复后同一文件 74/74 通过。

## 6. 验证命令与结果

| 命令 | exit |
| --- | --- |
| `pnpm format:check` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm lint` | 0 |
| `pnpm icon:verify` | 0 |
| `pnpm build` | 0 |
| `pnpm test:unit` | 0（53 files / 596 tests 全通过） |
| `pnpm test:integration` | 0（integration + boundaries PASS） |
| `cargo fmt --check` | 0 |
| `cargo test --locked` | 0（210 passed） |
| `cargo clippy --all-targets --locked -- -D warnings` | 0 |
| `git diff --check` | 0 |

三轮正式预检命令（与 `package.json` 的 `bundle:tauri` 同一形状，仅替换 attempt 专属的 `--work-dir` 与 `--inventory`）：

```bash
node scripts/quality/bundle-gate.mjs --host tauri \
  --scope-from docs/decisions/decision-register.json \
  --candidate-root apps/desktop/src-tauri/target/release/bundle \
  --assemble-dmg --dmg-format ULMO \
  --work-dir .tmp/prr-069c-attempt-0N/work \
  --inventory .tmp/release-candidate/prr-069c-attempt-0N/bundle-inventory.json \
  -- pnpm --filter @mindmap/desktop tauri build --bundles app
```

## 7. 关键决策

1. **evidence 路径（已向派发者确认，采 B 方案）**：三轮 attempt 目录存放该轮全部过程证据；`bundle-inventory.json` 与 `dmg-assembly-report.json` 仍写入 G2 已批准的 `.tmp/release-candidate/prr-069c-attempt-0N/`。G2 注册表、`g2-scope.mjs` 与发布证据边界**未做任何放宽**。
2. **EULA 实现**：`hdiutil udifrez` 在 macOS 26.6.2 仍可用但已 deprecated，且必须使用 `-xml <file> '' -quiet <image>` 这一"选项在前、空占位参数、镜像在末"的顺序（与 `bundle_dmg.sh` 的实际调用一致）。EULA 正文为根 `LICENSE` 的原始字节（`TEXT` 5000），与作废基线的资源形态完全相同。
3. **卷图标属性**：`hdiutil create` 在 macOS 26.6.2 已无 `-volicon` 选项，因此改为可写镜像挂载后 `SetFile -a C`，并在转换与最终镜像上两次复算 `com.apple.FinderInfo` 的 `kHasCustomIcon`。
4. **`.fseventsd`**：可写卷挂载会引入系统日志目录。采用 Apple 文档的 `no_log` 预置 + 有界等待后删除 + 有界确认，最终卷根条目被强制校验为恰好三项，多余条目（含 `.DS_Store`）一律失败。
5. **`--report` 不可覆盖**：失败轮不会覆盖既有证据文件，符合"第一次失败后第二次覆盖同一 evidence 必须失败"的要求。
6. **失败现场保留**：失败时保留本轮运行目录（只位于任务临时范围内）并输出结构化记录，便于独立复算；成功路径自动清理。
7. **`repack-dmg.mjs`**：解除正式引用并在文件头标注 `SUPERSEDED`，按卡保留为历史兼容代码，未删除、未重命名。
8. **红灯测试与实现同一提交**：本卡"先提交红灯测试"的意图是契约先行。若把红灯单独提交会让该中间 commit 的单测必然失败（破坏后续 bisect），因此改为同一次提交，并保留 5.4 的红灯复现证据。

## 8. 未运行项

- PRR-070（候选原生矩阵、性能、安装/LaunchServices、G-FINAL）——本卡明确不执行。
- PRR-080、PRR-090。
- 签名、公证、凭据访问、上传、`git push`、公开发布。
- 真实挂载前的 Finder 安装体验（窗口尺寸/图标坐标）——ADR 0013 v1.1.0 已声明不再作为发布功能。

## 9. 剩余风险

1. **依赖已 deprecated 的 `udifrez`**：macOS 12.0 起标记 deprecated，当前（26.6.2）仍可用并已由真机验证。若未来系统移除该子命令，EULA 注入需要新的受支持路径；届时属于 Tauri 之外的独立整改，且会在装配阶段 fail-closed（不会静默产出无 EULA 的镜像）。
2. **`SetFile` 依赖 Command Line Tools**：`/usr/bin/SetFile` 在未安装 CLT 的机器上不可用（本机 `xcode-select -p` 指向 `/Library/Developer/CommandLineTools`）。装配前会 fail-closed，不会产出无卷图标属性的镜像。
3. **安装体验降级**：DMG 使用系统默认 Finder 视图，不再有自定义窗口尺寸与图标坐标。应用、`Applications` 链接、卷图标与挂载前 EULA 仍是强制验收项。
4. **卷根条目白名单**：未来 macOS 版本若在可写挂载中引入新的系统目录，当前白名单会导致 fail-closed。这是有意的——宁可失败也不把系统残留带进发布镜像。
5. **`hdiutil convert` 容器 hash 不跨次稳定**（ADR 0013 已记录）：发布证据以本轮最终 artifact hash 绑定，不假设可复现字节。
6. `apps/desktop/src-tauri/target/release/bundle/dmg/` 内仍留有旧路径产生的 `bundle_dmg.sh` 与 `icon.icns`（构建产物，未在 G2 `candidateOutputPaths` 内）。未删除——删除需要单独授权，且不进入任何证据链。

## 10. Redlines 确认

未执行：PRR-070 / PRR-080 / PRR-090；G-FINAL 申请；签名、公证、凭据访问、系统信任修改、上传、公开发布；`git push` / `rebase` / `reset --hard` / 强制推送 / 改写远端历史；删除或覆盖 `b45dc0c` evidence 及其归档副本；修改 `apps/desktop/src-tauri/tauri.conf.json`、应用/core/ui/platform/export 生产逻辑、图标源与生成集、LICENSE 正文、预算、性能协议、G2/G-FINAL 或 readiness schema；新增运行时依赖或全局依赖；人工操作 Finder；延长阈值后重跑挑结果；复用/复制/混合三轮产物或报告。
