# PRR-070-R1：精简发布验收与原生测试修正

状态：`READY_FOR_EXECUTION / PRR-070_STOPPED / G-FINAL_NOT_REQUESTED`。优先级 P0。

负责人 2026-09-12 指令：本项目是本地优先的小型工具，发布前验收应按真实风险精简；不得为了形式完整反复执行已经通过且与本次改动无关的重型矩阵。VoiceOver 不作为 v0.1.0 自动化发布硬门，也不得为了本卡开启 VoiceOver、语音播报或 AppleScript 控制权限。

## 1. 目标

只关闭上一轮暴露的三个验收问题，然后产出可供独立审阅和本机试用的 unsigned 候选：

1. `wave2` 的 S7a 不再寻找 PRR-065 已移除的 WebView“新建”按钮。
2. E2E-CL2～CL5 的双击建点改用项目已有、实测有效的 Swift `CGEvent` 驱动，不再通过 JXA 内嵌 CoreGraphics 投递。
3. 发布门不再自动启动或控制 VoiceOver；可访问性硬检查收敛为已有 AX 树、原生菜单语义和键盘可达性。VoiceOver 仅留作负责人日后自愿人工抽查，不阻塞 v0.1.0。

本卡允许实现、验证、提交并构建一次候选。完成后停在 `READY_FOR_INDEPENDENT_REVIEW`；不得申请 G-FINAL，不得进入 PRR-080/090，不得签名、公证、上传、push 或公开发布。

## 2. 基线与允许范围

- 从包含本卡的最新 clean HEAD 开始；记录完整 Base 和 0 行 `git status --short`。
- 保留上一轮 `.tmp/release-candidate/5978e49fee2d0492fdf63f9d02d290bd302233a2/` 为只读失败记录，不删除、不改写。
- 允许修改：
  - `tests/e2e/macos/ax-bridge.mjs`
  - `tests/e2e/macos/wave2-windows.mjs`
  - 与上述两项直接对应的测试或最小说明
  - 本卡状态与必要的规划状态镜像
- 不允许修改应用业务代码、Rust host、生产配置、依赖、产品数据格式、性能预算或 DMG 装配实现。若发现必须修改这些范围，停止并交回原因。

## 3. 实现要求

### 3.1 修正双击驱动

- `doubleClickAt`/`axDoubleClick` 复用 `scripts/quality/ax-driver.swift dblclick <x> <y>`，不要再维护第二份 JXA `CGEvent` 实现。
- helper 路径从仓库根可靠解析；命令失败必须带 exit/stderr 抛错，不得吞错或自动改走 DOM 事件。
- E2E-CL2、CL3、CL4、CL5 必须各自真实完成“双击建点 → dirty → 对应关闭行为”。不得把上一轮 Swift 手工探针直接写成测试 PASS。

### 3.2 修正 S7a

- S7a 只验证 clean 窗口关闭；用当前仍受支持的原生新窗路径准备第二个空白窗口，例如 warm activation 或原生“新建窗口”命令。
- 删除对已移除 WebView“新建”按钮及其旧注释的依赖。
- 不借机恢复顶部工具栏或隐藏按钮。

### 3.3 精简可访问性规则

- PRR-070 后续自动验收只要求：AX 树能发现画布/节点/上下文操作，原生菜单名称与 enabled/check 状态可读，键盘能到达菜单和核心命令。
- 不调用或启动 VoiceOver，不读取 `vo cursor`/`last phrase`，不要求开启“允许 VoiceOver 被 AppleScript 控制”。
- 若执行前发现 VoiceOver 已开启，只记录前态；不要替负责人改变系统设置。若本卡自身意外启动了它，必须在退出路径恢复前态。

## 4. 验证——只验证本次风险

实现过程中允许迭代；最终提交前只需以下验证各跑一次：

```text
pnpm format:check
pnpm typecheck
pnpm lint
pnpm build
```

然后对真实 macOS app 执行：

```text
E2E-CL2
E2E-CL3
E2E-CL4
E2E-CL5
wave2 --only S7
```

要求上述目标用例全部 PASS，且 VoiceOver 始终未被启动。本卡不重复：18 项全源码门、JS/Rust advisory、20 cold + 20 warm 性能矩阵、全十场景 wave2、全部快捷键排列、`Option-Space` 五态、两种 PDF viewer 或临时 LaunchServices 注册。

## 5. 一次候选与核心冒烟

1. 形成一个 clean implementation commit，再从该 commit 构建一次 unsigned `.app` 与 ULMO `.dmg`。
2. 记录 app/DMG 路径、SHA-256、大小；执行 `hdiutil verify`，确认 DMG 可打开且包含 app。
3. 若 app SHA-256 与上一轮已经完成性能验证的 `465d0d6a4f7c9a48084064da3b3519c9c6765af5df675f63cbc5d2e3e6867222` 完全一致，直接引用上一轮性能 PASS，不重跑性能。
4. 若 app hash 不一致，只如实报告差异并交回独立审阅；不要擅自恢复 20×性能矩阵。
5. 对候选只做以下核心冒烟，各一次：
   - 启动后是干净空白画布，无 WebView 顶栏；
   - 双击建点、输入文字、编辑成功；
   - 保存并重新打开一份 `.mindmap`；
   - SVG、2x PNG、PDF 各导出一次且文件可打开；
   - 切换主题一次；
   - 新建第二窗口；
   - dirty 关闭的 Cancel 与 Discard 各一次。

无需临时安装到 `/Applications`，无需修改 LaunchServices；独立审阅通过后再把 DMG 交给负责人作为本机 dogfood 版本。

## 6. 停止条件

只有以下情况需要停止：

- 应用业务代码或生产配置确实必须修改；
- 目标用例或核心冒烟存在可复现的产品故障；
- 构建失败、DMG 损坏，或 worktree 无法保持 clean；
- 操作需要系统权限、凭据、签名、公证、上传、push 或发布。

单纯缺少 VoiceOver AppleScript 权限不再是失败，也不得因此要求负责人开启语音播报。

## 7. 固定交回

```text
Task: PRR-070-R1
Status: READY_FOR_INDEPENDENT_REVIEW | BLOCKED_ON_<真实原因>
Base: <完整 commit>
ImplementationCommit: <完整 commit；clean>
Changed: <文件与目的>
TargetedVerification: <4 个静态/构建命令 + CL2～5 + S7>
Candidate: <app path / sha256 / bytes>
DMG: <path / sha256 / bytes / hdiutil verify>
PerformanceReuse: <same app hash，引用上一轮 PASS | app hash changed，待审阅>
CoreSmoke: <7 项结果>
VoiceOver: NOT_STARTED / system setting unchanged
Evidence: <本轮 .tmp 路径>
NotRun: full legacy matrix / G-FINAL / PRR-080/090 / signing / notarization / push / upload / publish
Risks: <真实遗留；无则 none>
Next: STOP_FOR_INDEPENDENT_REVIEW
```
