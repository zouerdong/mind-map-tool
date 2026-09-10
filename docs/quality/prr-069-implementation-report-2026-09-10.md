# PRR-069 实施报告：macOS DMG ULMO 压缩与证据时间拓扑整改

日期：2026-09-10
状态：`STOP_FOR_INDEPENDENT_REVIEW`（PRR-070 NOT STARTED）
Base：`5e7b99cd44255bee48616614f7d80b0c3a6f537b`（clean main）
实现 commit：`cfa4dfee63f2b353f4432328657d8f4bc2a73568`
ADR：[0013-macos-dmg-compression.md](../decisions/0013-macos-dmg-compression.md)（Accepted 1.0.0）

## 1. 目标与结果

把 ADR 0013 的 ULMO 决定落为 same-run 发布 runner 步骤，使后继 PRR-070 得到
`Format=ULMO`、`≤25000000B`、payload/EULA/图标逐字节不变的唯一候选；同时补齐
可机器复算的 UTC 时间拓扑证据链。

实测结果（本报告预检，source `cfa4dfe`）：

| 项 | 值 | 判定 |
| --- | --- | --- |
| UDZO 转换前 | 25,153,270B | — |
| ULMO 转换后 | **24,288,684B** | ≤ 25,000,000B PASS |
| 余量 | **711,316B** | ≥ 500,000B PASS |
| `hdiutil imageinfo` | `Format: ULMO`（UDIF LZMA 只读） | PASS |
| `hdiutil verify` | 全分区 CRC32 已验证（终值 `$CDF26534`） | PASS |
| 卷内 `.app` 目录级 SHA-256 | `cfa414c8dc41e3d2a16009b816f6ae2e0a364528dcfe267b549e0e85569c5b20`，与构建侧、与 PRR-068 轮 source `58003c0` 构建的 `.app` 完全一致 | PASS |
| `.VolumeIcon.icns` / app 内 `icon.icns` / 仓库 `icons/icon.icns` | 三者均为 `7146e7c8788a982c31a8e8455e785b1bbd78783e2498b592b3cc1fd39ce684cc` | PASS |
| EULA | attach 时展示 Proprietary Software License 全文（挂载前 EULA 协议路径） | PASS |
| bundle identity | `com.mindmap.desktop` / 0.1.0 / `LSMinimumSystemVersion=11.0` / `.mindmap` + `com.mindmap.document` | PASS |
| 图标文件 | 17 个 tracked 图标文件 hash 前后零变化 | PASS |
| HEAD 前后 | `cfa4dfe…` 不变；worktree clean | PASS |

## 2. 逐文件变更（commit `cfa4dfe`）

| 文件 | 变更 |
| --- | --- |
| `scripts/quality/repack-dmg.mjs`（新增） | 单一职责 DMG 容器转换器（详见 §3） |
| `scripts/quality/bundle-gate.mjs` | 新增 `--dmg-format` / `--repack-hdiutil`；在 G2/签名/clean-worktree/same-run 校验全部通过且子进程 build 成功后、inventory 计算前，对本轮唯一批准 DMG 执行转换；repack 失败整体失败不回退；inventory 新增 `dmgFormat` 与 `dmgRepack`（runner/hash/起止时间/前后 bytes），artifact hash 绑定转换后文件；时间戳覆盖转换完成点（`finishedAt=repack 完成时间`） |
| `tests/bootstrap/release-runners.test.ts` | 新增 12 项测试（2 项 bundle-gate 全链 + 10 项 repack-dmg 红灯/绿灯）与 mock hdiutil / 合成 DMG fixture |
| `package.json` | `bundle:tauri` 显式 `--dmg-format ULMO`（不依赖隐式环境变量） |
| `README.md` | bundle 命令说明同步 ULMO 语义 |

未修改：`assets/app-icon/**`、`apps/desktop/src-tauri/icons/**`、`tauri.conf.json`、
app/core/ui/platform/export 生产逻辑、ADR 0006 预算、最低 macOS 11.0、任何旧
`.tmp/release-candidate/<commit>/` 证据。

## 3. repack-dmg.mjs fail-closed 合同

1. `--format` 必须显式给出且 ∈ {`ULMO`}；其他值（含 `UDZO`/`UDBZ`/小写）拒绝。
2. 输入必须通过 `validateSafePath`（拒绝 `..`、通配符、越出 repo root）、以
   `.dmg` 结尾、存在且为常规文件；必须精确等于 G2 `candidateOutputPaths` 中
   唯一的 `.dmg`（`loadAndValidateG2Scope({candidate})` 精确白名单，无 glob）。
3. `--after <UTC ISO>`（bundle gate 传 build 开始时间）：输入 mtime 早于它即
   拒绝（不转换旧轮/陈旧产物）。
4. 临时目标确定性命名于同一批准候选目录（`<dmg>.repack-ULMO.tmp.dmg`）；预存
   即 fail-closed（上一轮失败残留或外来文件需人工检查，不自动清理他人文件）。
5. `hdiutil convert` 非零、临时未生成、`imageinfo` 非 `Format: ULMO`（伪造或
   静默回退）、声明 Signed/Encrypted、`hdiutil verify` CRC32 未通过——全部
   fail-closed，且**先清理本轮创建的临时文件再退出**（使"临时预存"信号始终
   指向外来文件；原始输入 DMG 在任何失败路径保持原样）。
6. 成功路径：同目录 `renameSync` 原子替换最终路径 → 对最终路径再次
   `imageinfo` 复核 → `git rev-parse`/`git status` 复核（转换后 worktree 变化
   即 fail-closed）→ 输出单行 JSON 报告（runner hash、前后 SHA-256/bytes、
   起止 UTC、格式证据行、gitHead）；`--report` 可写入 G2 批准 evidence 路径。
7. `--root`/`--hdiutil` 为测试注入入口（生产不传，默认本仓库根与系统
   `hdiutil`），与仓库既有 runner 的 `--root` 惯例一致。

## 4. 红灯测试（12 项新增，既有全部保持绿灯）

bundle-gate 集成层：全链成功（inventory `dmgFormat=ULMO`、DMG artifact hash ==
`dmgRepack.afterSha256` != 转换前 hash、临时文件消失、report 落盘）；
repack 失败传导（bundle gate 整体失败、不写 inventory、原 DMG 原样）。

repack-dmg 层：缺 `--format`；不允许的格式（UDZO/UDBZ/小写）；路径穿越
`../../evil.dmg` 与绝对路径越界；输入不在批准 candidateOutputPaths；输入非本轮
刷新（mtime 早于 `--after`）；临时目标预存；convert 失败（原 DMG 未破坏）；
伪造 `Format`（imageinfo 声明 UDZO）；输出签名/加密；CRC32 失败；转换期间
worktree 被写脏（fail-closed）；成功路径（ULMO 标记、JSON 报告、hash 绑定）。

## 5. 时间拓扑整改

- bundle-gate inventory 的 `startedAt`/`finishedAt` 现在覆盖含转换的完整流程
  （`finishedAt` = repack 完成时间），`dmgRepack.startedAt/finishedAt` 单独
  可复算，支撑 PRR-070 卡第 10 步断言链
  `source freeze <= first gate start <= last gate finish <= bundle start <= bundle finish <= downstream reports`。
- PRR-070 任务卡（步骤 1/4/5/10）在 `5e7b99c` 基线中已含 UTC 生成规则
  （只允许 `new Date().toISOString()` / `date -u`，禁止手工加 `Z`）与上述
  断言链；本实现与其一致，未再改动该卡文本（避免不必要变更）。
- 本次预检全部时间戳由 `date -u` / `new Date().toISOString()` 生成。

## 6. 验证记录（全部 exit=0）

`pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`
（53 文件 / 572 测试）、`pnpm test:integration`、`pnpm icon:verify`、
`pnpm build`、`cargo fmt --check`、`cargo test --locked`（210 通过）、
`cargo clippy --all-targets --locked -- -D warnings`、`git diff --check`。

预检构建（clean HEAD `cfa4dfe`）：`pnpm bundle:tauri` exit 0；证据目录
`.tmp/prr-069-precheck/`（bundle-gate.log、dmg-format-verify.txt、
inventory-check.txt、built-app-hash.txt、dmg-attach.txt、dmg-volume-verify.txt、
post-check.txt、icon-baseline/postcheck-sha256.txt、pre-build-head.txt）；
inventory 落于 `.tmp/release-candidate/bundle-inventory.json`（G2 批准
evidence 根层；该文件此前不存在，未覆盖任何旧证据）。

## 7. 决策与理由

1. **独立 `repack-dmg.mjs` 而非内联进 bundle-gate**：任务卡二选一授权中的
   单一职责路径；转换合同独立可测（10 项红灯不需跑完整 bundle），bundle-gate
   只增加编排（~70 行）。
2. **确定性临时文件名**：可预测路径使"临时预存"红灯可测，且失败清理语义
   明确（本轮创建的文件本轮清理，外来文件永不触碰）。
3. **转换在盘点前执行**：inventory 的 artifact hash/mtime/bytes 自然绑定
   转换后 DMG，从机制上排除"误绑转换前 hash"。
4. **不回退 UDZO**：repack 任一失败让 bundle-gate 以非零退出且不写
   inventory；不留"转换失败但构建成功"的中间态。
5. **`--hdiutil` 测试注入**：CI/单测无法控制真实 hdiutil 的失败面；显式
   flag 比环境变量更符合"正式命令显式声明"的反面（仅测试路径）。

## 8. NotRun / 风险

- 未运行 PRR-070 任何步骤（性能、安装、LaunchServices、功能矩阵、G-FINAL），
  未运行 `pnpm quality -- --release-evidence`（PRR-080 范围）。
- 未在 macOS 11.0 实机验证 ULMO 挂载（本机 macOS 26.6.2；ADR 0013 已记录
  ULMO 自 10.15 起可用、Finder/DiskImages helper 路径不受内核挂载限制）。
- `hdiutil convert` 容器字节跨次不保证可复现（ADR 0013 已声明）；发布证据
  按本轮 artifact hash 绑定，预检与后继 PRR-070 各自实测。
- Windows 侧不适用（v1 仅 macOS）。

## 9. 红线确认

未签名、未公证、未访问凭据、未修改系统信任/权限、未 push、未上传、未公开
发布；未删除/覆盖任何旧 `.tmp/release-candidate/<commit>/` 证据；未修改图标、
预算、minOS、生产配置或 `tauri.conf.json`；DMG 只读挂载并正常 detach。
