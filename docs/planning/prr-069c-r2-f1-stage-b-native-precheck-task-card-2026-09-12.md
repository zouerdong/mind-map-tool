# PRR-069C-R2-F1 阶段 B：三轮原生预检任务卡

状态：`READY_FOR_EXECUTION / PRR-070_BLOCKED`。

本卡是当前唯一可执行任务。阶段 A 已由
[独立审阅](../quality/prr-069c-r2-f1-independent-review-2026-09-12.md)接受；最终代码 source
`0da0d406a3d9b9041921d470363d7db52d5f59f9` 必须是运行基线的祖先。执行时以包含本卡的最新 clean
HEAD 为实际 `SourceCommit`，不得回退或改源码。

## 1. 目标

用真实 macOS 系统工具从同一 frozen source 独立构建、装配并核验三轮 unsigned Apple Silicon ULMO DMG，
证明 R2-F1 在真实 `hdiutil` 路径上的正常行为可重复。阶段 B 不做性能矩阵、安装、LaunchServices 注册或 PRR-070。

## 2. 允许与禁止

允许：使用负责人既有 G2 授权构建 unsigned 候选；在项目 `.tmp/` 新目录写本轮证据；真实只读/可写临时镜像挂载及受控卸载；
运行源码门和本地 Rust 工具。

禁止：修改源码、测试、runner、生产配置、ADR、预算或协议；复用/覆盖历史 attempt；Finder/AppleScript/`.DS_Store`
路线；签名、公证、凭据、系统信任或设置变更、LaunchServices、安装应用、性能采样、push、上传、公开发布。

正式轮次不得设置 `MINDMAP_DMG_CLEANUP_GRACE_MS`，不得传任何 fixture tool/script 注入，也不得改变
120000ms 单命令、180000ms 装配、60000ms 清理宽限。

## 3. 步骤

1. 阅读 AGENTS.md、根 README、本卡、阶段 A 实施报告和独立审阅。记录完整 HEAD、`git status --short`、
   macOS/arch/内存、Node/pnpm/Rust/Tauri 版本。要求 worktree 0 行且 HEAD 是 `0da0d406...` 的后代。
2. 冻结 `SOURCE=$(git rev-parse HEAD)`。运行下列源码门；任一失败立即 STOP，不修代码、不重跑挑绿：

   ```text
   pnpm format:check
   pnpm typecheck
   pnpm lint
   pnpm exec vitest run tests/bootstrap/release-runners.test.ts
   pnpm test:unit
   pnpm test:integration
   pnpm icon:verify
   pnpm build
   cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
   cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
   cargo clippy --all-targets --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
   git diff --check
   ```

3. 先只读确认以下六个任务根和 evidence 根全部不存在；存在即 STOP，不删除、不换编号：

   ```text
   .tmp/prr-069c-r2-f1-<完整SOURCE>-attempt-01/work
   .tmp/prr-069c-r2-f1-<完整SOURCE>-attempt-02/work
   .tmp/prr-069c-r2-f1-<完整SOURCE>-attempt-03/work
   .tmp/release-candidate/prr-069c-r2-f1-<完整SOURCE>-attempt-01/
   .tmp/release-candidate/prr-069c-r2-f1-<完整SOURCE>-attempt-02/
   .tmp/release-candidate/prr-069c-r2-f1-<完整SOURCE>-attempt-03/
   ```

4. 按 01 → 02 → 03 顺序执行。每轮都从同一 clean source 重新 build app 并装配 DMG，不复用前轮 artifact：

   ```text
   env -u MINDMAP_DMG_CLEANUP_GRACE_MS node scripts/quality/bundle-gate.mjs \
     --host tauri \
     --scope-from docs/decisions/decision-register.json \
     --candidate-root apps/desktop/src-tauri/target/release/bundle \
     --assemble-dmg \
     --dmg-format ULMO \
     --work-dir .tmp/prr-069c-r2-f1-<完整SOURCE>-attempt-0N/work \
     --inventory .tmp/release-candidate/prr-069c-r2-f1-<完整SOURCE>-attempt-0N/bundle-inventory.json \
     -- pnpm --filter @mindmap/desktop tauri build --bundles app
   ```

5. 每轮核验并记录：source/app/DMG/runner/helper/LICENSE/ICNS SHA-256 与字节数；UTC 起止；命令/exit；
   `dmgFormat=ULMO`、CRC32 VALID、DMG ≤25000000B；EULA、Applications 链接、卷图标、app payload identity；
   挂载前后状态；`timings.totalElapsedMs = assemblyMs + cleanupMs`。正常成功轮必须 `cleanupMs=0`、无残留挂载。
6. 每轮结束后再次确认 HEAD 未变、worktree 0 行、系统挂载表无该轮 mountpoint。任一不满足立即 STOP。
7. 三轮全部通过后，新增阶段 B 报告和 SHA-256 manifest；只允许提交报告/状态文档，证明文档提交相对
   `SourceCommit` 在 `scripts tests apps packages` 无差异。保持 clean，停在 `STOP_FOR_INDEPENDENT_REVIEW`。

## 4. STOP 条件

任一源码门或正式 attempt 失败；任务/evidence 根预先存在；source/HEAD/worktree 漂移；无法确认挂载已安全清理；
历史 evidence 被修改；必须改变 runner、预算、协议或权限。STOP 后保留本轮现场，只写失败报告；不得重试、补样、
删除现场或把事后自然完成改判 PASS。

## 5. 固定交回

```text
Task: PRR-069C-R2-F1 / Stage B
Status: STOP_FOR_INDEPENDENT_REVIEW | BLOCKED
Base: <派发时完整 clean HEAD>
SourceCommit: <三轮实际 frozen HEAD>
HandoffCommit: <仅报告/状态文档的最终 clean HEAD>
SourceGates: <命令、exit、数量>
Attempt01: <exit、app/dmg hash、字节、ULMO/CRC/EULA/identity/mount/timings>
Attempt02: <同上>
Attempt03: <同上>
Evidence: <三个唯一目录、报告、manifest 与 SHA-256>
SourceIntegrity: <三轮前后 HEAD/status；SourceCommit..HandoffCommit 的代码树 diff 为空>
NotRun: PRR-070 / performance / install / LaunchServices / G-FINAL / PRR-080/090
Risks: <真实遗留；没有则写 none>
Redlines: <逐项确认未执行>
Next: STOP_FOR_INDEPENDENT_REVIEW
```
