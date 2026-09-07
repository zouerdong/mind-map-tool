# MRT-004W2R：多窗口隔离、失败恢复与真实 native 证据修复卡

## 1. 定位

**优先级：P0**  
**状态：READY — 单次完成、单次统一验收**  
**依赖：MRT-004 Wave 1 ACCEPTED；Wave 2 首轮 NEEDS-REMEDIATION**  
**阻断：MRT-005 与最终视觉实现**

本卡一次性修复 Wave 2 统一验收中的 W2R-F1～F7。执行 Agent 应先补红灯，
再完成 host/renderer 修复，最后重做真实 macOS 矩阵和可复现 Windows probe。
中间 Internal Gate 由执行 Agent 自证，不需要逐小项回来等待人工验收；整卡
完成后一次性交回。

## 2. 必读

开始前完整阅读：

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`（Accepted 1.0.0）。
3. `docs/architecture/window-launch-lifecycle.md`。
4. `2026-08-31-mrt-004-wave-2-production-integration-task-card.md`。
5. `2026-08-31-mrt-004-wave-2-implementation-evidence.md`。
6. `2026-08-31-mrt-004-wave-2-acceptance.md`。
7. Wave 2 变更过的 Rust lifecycle/ipc/file、platform bootstrap 与
   `MindMapApp` 文件及测试。

当前工作树包含多轮累计成果。不得还原、覆盖或清理其他作者的变更；不得使用
destructive Git 命令。先用 `git status --short` 和 `git diff --name-status`
记录基线。

## 3. 必须保留的基线

不得借修复之名推倒以下已成立方向：

1. Rust host 是 WindowRegistry、LaunchCoordinator、launch errors、identity
   reservation 和 effect execution 的唯一 owner。
2. renderer 不得自报 window label、path、FileIdentity、canonical target、
   rebind token 或 host capability。
3. open 内容/handle/token/identity 保持 host 同源；ordinary/Save As 继续使用
   B1A host outcome，不退回 loose path 或 displayPath 判定。
4. listener-first + per-window snapshot + deliveryId 去重、terminal 前零 ack、
   retryable 不自动重试、Destroyed 组合清理保持不变。
5. 一文档一窗口、同 identity 聚焦、warm activation 新空白的产品语义不变。
6. 不重写 MRT-001 保存队列和 MRT-003 三分支 close 协议。

## 4. Phase R：先补红灯

红灯证据新增到：

`.omx/reviews/2026-08-31-mrt-004w2r-red-light-evidence.md`

必须先写并真实跑出以下失败；不得只写说明：

### R1. launch error 按窗隔离

- 同时存在 `main` 与 `editor-1`；让 editor 的 read/bootstrap 失败。
- main 查询错误快照必须为空，editor 只能看到自己的错误。
- main 用 editor 的 `intentId` retry/dismiss 必须稳定拒绝且状态零变化。
- editor 的合法 retry/dismiss 才能推进；同一错误只由一个呈现窗口拥有。
- 呈现窗口 Destroyed 后，要么按明确规则转移到另一个活窗并更新 generation，
  要么保持 host-only 未呈现状态；绝不能重新变成所有窗口可查。

### R2. Failed 窗口生命周期

- read/decode 失败后 retry 必须复用原 `Failed` 窗口并走
  `Failed → Loading → Open`；不得多建 editor、不得留下旧僵尸窗。
- dismiss 后原窗口必须进入明确可用终态。首选 `Failed → Blank`，并清掉
  active intent/delivery，使其可编辑、可首次 Save As；不得留下 UI 可编辑但
  host 拒绝保存的窗口。
- retry/dismiss 重放和跨窗调用零副作用；terminal 仍只 ack once。

### R3. bootstrap report-pending 生产重报

- 第一次 `platform_complete_window_bootstrap` 传输失败，action 只执行一次，
  adapter 保留缓存 outcome。
- renderer 出现明确的“重试启动回报”动作；一次点击对每个 pending delivery
  至多重报一次，不自旋、不重跑 open/decode/load。
- 重报成功后 host terminal/ack once，提示消失；再次点击零副作用。

### R4. startup barrier 原子交错

用 latch/barrier 强制构造：ready 读取空 snapshot 与 native open 入队竞争。
断言单一线性化结果：

- open 先获得 coordinator 临界区 → main 承载该文件，不能随后被标 Blank；
- ready 的“确认无 open 并 mark Blank”先线性化 → 后到 open 才走新窗。

禁止用 sleep 作为正确性条件。

### R5. recovery generation 与记录替换

- provider refresh 锁外阻塞时 Destroyed + 同 label 新 generation；旧恢复不得
  修改新 registry、不得删除新 generation 的 recovery。
- recovery 成功 remove 必须 compare-and-remove 具体 generation/record，不能
  只按 label 无条件删除。
- 同窗已有 recovery 时并发 commit/record 不得覆盖旧记录；稳定 fail closed。

### R6. assigned open capability 失效竞态

在内容读取/identity 解析与 handle 签发之间注入 Destroyed：最终调用返回
stale，且 HandleRegistry 对该窗口零残留。测试必须能直接观察 handle 数量或
验证所有候选 handle 已不可用。

### R7. native runner 真实性门禁

- runner 若存在任何 `MANUAL`/未执行场景，overall 必须 `INCOMPLETE` 且非零。
- 断言必须失败于“动作没发生”，不能只检查“日志里没有失败字样”。
- 截图增加最小有效性检查：拒绝近全黑、完全重复或无法辨认目标窗口的文件。

红灯完成后进入 Internal Gate R；确认每条确实打到根因，再改实现。

## 5. Phase H：host 协议修复

### H1. caller-bound launch error record

把错误快照从全局可消费列表收紧为 host-only record，至少绑定：

```text
intentId
reason / kind / receivedAt
presentationWindowLabel
presentationWindowGeneration
originFailedWindowLabel? / originGeneration?
rawPath?                 // source retry，仅 host
```

- `platform_launch_errors` 注入 `WebviewWindow`，只返回 caller 当前 generation
  所拥有的错误。
- retry/dismiss 同样注入真实 caller window；runtime 校验 caller label +
  generation + intent 当前 retryable + error record 当前可见，全部通过后才修改。
- source error 也遵守同一呈现所有权。
- error event 仍 target emit；snapshot 与 action 不能绕过 target 语义。
- 统一 Tauri invoke reject 的 `{code,message}` 映射，retry/dismiss/recovery/report
  失败 UI 不得退化为 `[object Object]`。

### H2. Failed 窗口原位恢复

- coordinator 保留 retryable intent 与原 failed label/generation 的关联；可用
  registry 的 active intent 事实，但不能依赖 renderer 自报。
- retry 在原 failed 窗执行新 generation delivery：重新解析/刷新目标后
  `Failed → Loading`，同一窗口完成 open；若窗口已 Destroyed，再按正常路由
  新建窗口。
- dismiss 原子完成 `Failed → Blank`、清 active intent/bootstrap slot、terminal
  dismissed + ack。为该转换增加窄方法和不变量测试，不通过直接篡改 record。
- source/create/focus 失败没有 origin window 时，继续使用正常 retry 路由；
  不强行套用 Failed 窗逻辑。

### H3. 原子 startup ready

在 `LaunchCoordinator` 增加一个单锁方法，原子完成：

```text
read caller pending bootstrap snapshot
if caller == main && snapshot empty && no open-file intent:
  validate main still Booting
  mark Blank
return snapshot / decision
```

runtime 不再用三个独立 public snapshot/mutation 调用拼 barrier。保持文件 I/O、
Tauri API 和 emit 在锁外。

### H4. recovery 与 capability 失效安全

- recovery record 的所有查询、resolve 前置校验、锁外 I/O 后回写和 remove 都
  校验 window generation；成功清理使用 compare-and-remove。
- record 插入不得覆盖既有同窗 recovery；并发入口用 per-window gate 或原子
  状态转换保证同窗 commit/recovery 串行，其他窗口仍可并行。
- assigned open 改为“校验 → 锁外读/identity → 再校验 → 签发 handle”，或
  提供可精确 revoke 的 provisional handle；Destroyed 与最终签发必须形成
  线性化边界。
- 不把 generation、token、canonical 或 capability 暴露给 renderer。

完成 H1～H4 后运行全部 Rust/TS 集成矩阵；Internal Gate H 全绿再进入 renderer
和 native evidence。

## 6. Phase P：renderer 生产恢复入口

1. `LaunchPort` 的错误 snapshot/retry/dismiss API 保持 caller 隐式注入，不
   增加前端 window label 参数。
2. `MindMapApp` 只显示本窗错误；重试/放弃后刷新本窗 snapshot。
3. 为 `WindowBootstrapAdapter.pendingReports()` 提供最小功能 UI：显示 delivery
   级 report failure 和一次显式 retry；成功后清提示。不要自动 timer retry。
4. React StrictMode/HMR 测试仍需证明 listener/action once；生产 adapter 单例
   不得捕获已经失效的 session/ports closure。
5. Failed dismiss 后 renderer session 必须与 host Blank 一致；不得保留失败
   文档 handle、dirty 或错误提示。
6. 这仍是功能性 UI，不做最终视觉换肤。

## 7. Phase E：重做真实 macOS 矩阵

保留可自动化 runner，但每个 PASS 必须同时有可判真的结构化 facts。至少完成：

1. cold 无文件：唯一 main Blank。
2. cold A/B：main 与 editor 分别到 `opened` terminal/ack；不仅是窗口计数。
3. warm系统 Opened A/B：两个文档各自内容/标题/label 可区分，main 不替换。
4. 重复 A（symlink、相对段、中文空格）：窗口数不变，聚焦 A owner。
5. **真实 dirty A** 时打开 C：A 内容、dirty、handle/token 不变；C 新窗。
6. warm activation 两次：每次一个新 Blank，既有文档窗不变。
7. **真实逐窗关闭矩阵**：clean、dirty Cancel、dirty Save、dirty Discard、
   pending save；每次验证目标 label 和其他窗口零变化。
8. read/decode 错误：错误在 origin 窗可见，不自动重试；真实 retry 原窗恢复；
   再制造一次错误并真实 dismiss，原窗成为可 Save As 的 Blank；ack once。
9. 真实 Save As → ordinary Save；至少一次可控 post-commit recovery，验证 receipt
   已成功、同窗保存被 gate、显式恢复后 ordinary Save 可继续。
10. **至少两个窗口**下聚焦 editor，触发真实全局热键；目标窗 quick-create，
    其他窗文档/dirty 不变。不能用“无注册失败日志”代替动作断言。

若 AX/合成键盘无法驱动某动作，可以采用人工点击，但必须在同一最终工作区上
真实执行并记录：时间、bundle binary hash、操作前后窗口 label/标题/dirty/
handle 投影、截图及观察者。没有执行就是 `INCOMPLETE`，不能用 fake/jsdom 或
历史 MRT-003 截图代替。

截图要求：

- 每张图在入库/索引前人工打开复核；必须可辨认 app 窗口与目标状态。
- raw screenshot 可留 `.tmp/`，但结构化 log 必须记录每张 SHA-256、尺寸与
  对应 scenario；关键人工场景至少保留可审阅图或明确的持久化 artifact。
- runner 自动拒绝全黑/近全黑和跨场景完全重复图。
- 若声明三次连跑，保存三份带时间和 binary hash 的独立 aggregate；否则只
  声明实际次数。
- `PASS` 仅在所有必需场景为 PASS 时产生；`MANUAL`、`SKIP`、缺 artifact 均
  汇总 `INCOMPLETE` 并返回非零。

## 8. Windows probe

1. 真实运行主 crate target check；若仍被 `icons/icon.ico` baseline 阻断，
   如实记录，不修改配置绕过。
2. 把 Wave 2 同源源码 probe 做成仓库内可重复脚本或完整命令文档，输出 raw
   log 和源码 SHA-256 清单；不能只描述“复制到临时 crate”。
3. probe 至少编译 runtime、coordinator、registry、file identity/commit 与
   serde DTO 的 Windows cfg；不声称它等同 Windows 实机。
4. 不安装全局依赖，不修改图标/capability/`tauri.conf.json`。

## 9. 允许修改范围

- `apps/desktop/src-tauri/src/lifecycle/`
- `apps/desktop/src-tauri/src/ipc/`
- `apps/desktop/src-tauri/src/file/`（只限 assigned open/recovery/capability）
- `apps/desktop/src-tauri/src/lib.rs`（只限 Destroyed/error 转移接线）
- `packages/platform/src/lifecycle/`、`packages/platform/src/ipc/`、
  `packages/platform/src/file/` 及对应测试
- `apps/desktop/src/app/`（最小错误/report recovery UI 与集成测试）
- `tests/e2e/macos/`、`scripts/quality/` 中本卡直接相关工具
- `docs/architecture/window-launch-lifecycle.md`
- `docs/quality/evidence/wave2/`
- `.omx/reviews/2026-08-31-mrt-004w2r-*`

## 10. 禁止与 STOP 条件

禁止：

- 进入 MRT-005、MRT-008/009 或最终视觉实现。
- 修改 Accepted ADR 0008 的决定/批准 hash。
- 修改 capability、`tauri.conf.json`、CI/CD、发布配置、core schema、export、
  onboarding 产品内容或文件格式。
- 新增运行时依赖、账号、云、遥测或网络端点。
- 通过关闭校验、吞错、自动无限重试、mock native 动作或改测试预期掩盖问题。

若修复必须改变“一文档一窗口/同文件聚焦/activation 新空白”、需要通用
renderer create/destroy 权限、需要修改配置/依赖/发布流程，立即停止并请求
项目负责人授权。

## 11. 验收标准

整卡完成必须同时满足：

1. W2R-F1～F5 每项有先红后绿测试，且测试命中生产 runtime/adapter seam。
2. launch error snapshot 和 retry/dismiss 由真实 caller label + generation
   隔离；跨窗零变化。
3. read/decode retry 原窗恢复，dismiss 后原窗成为一致且可保存的 Blank；无
   `Failed` 僵尸窗口。
4. report-pending 有显式有限重报，action once、terminal/ack once。
5. startup ready/open 决策单锁线性化；强制交错测试稳定通过。
6. recovery 与 assigned open 在 Destroyed/同名新代竞态下零错绑、零孤立
   capability、零误删新记录。
7. E2 十场景全部真实执行并 PASS；没有 MANUAL/SKIP，截图和结构化 facts
   可审阅，runner 不再弱断言。
8. Windows 主 target blocker如实记录；同源 probe 可一条命令重跑并有 raw log。
9. 所有全量门禁通过；ADR/capability/config/CI/CD/发布文件未变。

## 12. 验证命令

```bash
pnpm --filter @mindmap/platform test
pnpm test:unit
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
pnpm lint
pnpm quality
pnpm build
pnpm exec prettier --check <本卡变更 TS/TSX/MJS/MD/JSON>
rustfmt --edition 2021 --check --config skip_children=true <本卡变更 Rust>
git diff --check
git status --short
```

另执行并记录：

- 真实 macOS E2 runner/人工动作的准确命令、退出码和 aggregate artifact。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --target
  x86_64-pc-windows-msvc --lib`。
- 新增的一条命令式 Windows 同源 probe。
- ADR 0008 SHA-256 与批准记录比对。

## 13. 完成回报

一次性报告：

1. W2R-F1～F7 根因与逐项修复映射。
2. 红灯测试名称、失败原因与修复后结果。
3. 最终 error ownership、Failed retry/dismiss、report retry、startup barrier、
   recovery/capability 数据流。
4. 真实 macOS 十场景表、每场关键 facts、截图/hash 索引和总体退出码。
5. Windows blocker与可复现 probe 命令/raw log。
6. 全部门禁结果、变更文件、`git diff --check`、`git status --short`。
7. 明确声明未进入 MRT-005/最终视觉，未改 ADR/capability/config/CI/CD/发布，
   未新增依赖。

完成后停止，等待统一验收。
