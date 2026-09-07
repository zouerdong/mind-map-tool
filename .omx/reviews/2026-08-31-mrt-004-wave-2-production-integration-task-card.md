# MRT-004 Wave 2：真实多窗口、生产接线与 macOS 验收任务卡

## 1. 定位

**批次：MRT-004C + MRT-004D + MRT-004E**

**优先级：P0**

**状态：READY — 单次完成、单次统一验收**

**已通过前置：MRT-004 Wave 1（A1 + B/B1/B1A）ACCEPTED**

**后续：MRT-005；最终视觉实现仍不在本卡**

本卡把已经通过纯状态机验收的 WindowRegistry、LaunchCoordinator、
FileIdentity 和 WindowBootstrapAdapter 接入真实 Tauri 生产路径，完成
`editor-*` 多窗口、native source、按窗 bootstrap、保存换绑、可靠终态与
真实 macOS Finder/Dock 验收。

执行 Agent 应连续完成 C → Internal Gate → D → Internal Gate → E，最后
一次性交回。不要在每个小步骤后等待人工验收。

## 2. 必读与工作树规则

开始前完整阅读：

1. 根 `AGENTS.md`。
2. `docs/decisions/0008-window-launch-lifecycle.md`（Accepted 1.0.0）。
3. `docs/architecture/window-launch-lifecycle.md`。
4. `.omx/reviews/2026-08-31-mrt-004b1a-acceptance.md`。
5. `.omx/reviews/2026-08-31-mrt-004b1a-implementation-evidence.md`。
6. `apps/desktop/src-tauri/src/lib.rs`、`ipc/`、`file/`、`lifecycle/`、
   `shortcuts/`，以及 `packages/platform/src/lifecycle/`、
   `apps/desktop/src/app/` 的现有装配与测试。

当前工作树包含前序累计修改。不得还原、覆盖、清理其他 Agent 或审查者的
变更，不得使用 destructive Git 命令。历史 `LaunchIntentStore`/
`TauriLifecycleAdapter` 可以在生产装配中移除，但不要为了“整洁”删除仍被
测试或浏览器 fallback 使用的代码；先迁移真实消费者，再做最小清理。

## 3. 本批完成形态

完成后必须同时成立：

1. Rust host 是 launch intent、窗口 registry、identity reservation 和
   effect execution 的唯一 owner；生产路径不再同时运行旧 launch store。
2. 每个 `main` / `editor-*` WebView 都有自己的 MindMapApp 与
   DocumentSession；任何外部 open/activation 都不会替换另一窗口文档。
3. cold 多文件、warm Opened、single-instance、Reopen 都只进入同一
   coordinator；同 identity 只聚焦既有窗口，不建重复窗。
4. renderer 只处理定向给自己的 bootstrap；listener-first + snapshot +
   deliveryId 去重真实接线。
5. opened/focused-existing/blank-created/dismissed 才 ack；失败保留
   retryable 状态并提供可见 retry/dismiss，不自旋。
6. ordinary Save 与 Save As 生产 IPC 消费 B1A host-only outcome；文件已
   commit 但 registry 未刷新/换绑时，不得显示为普通“保存失败”。
7. Destroyed 同时清 registry、pending rebind、bootstrap、文件 capability
   和 close state；其余窗口 session/dirty/handle 不变。
8. 真实 macOS Finder/Open With、连续文件、重复文件、Dock/icon activation
   和多窗关闭矩阵有可复现证据。

## 4. 不可破坏的不变量

### 4.1 Host 单 owner

- 生产 `lib.rs` 只 manage 一套 launch 状态：`Arc<LaunchCoordinator>`。
- native source 不再先写 `LaunchIntentStore` 再广播给 renderer。
- `TauriLifecycleAdapter` 不得在每个 MindMapApp 中实例化。
- coordinator lock 内禁止 Tauri window API、event emit、文件 I/O、provider
  metadata、dialog、renderer invoke。
- effect 必须先从 reducer 取出，再在锁外执行，再用 correlation result 回报。

### 4.2 路径与能力不回退

- launch intent 内部目标改为或保持 host 无损 `PathBuf`/
  `CanonicalPathKey`；不得把 canonical target 降级为 display string 后再
  转回路径。
- renderer 不得自报 `FileIdentity`、canonical target、window label、
  rebind token 或任意 host capability。
- bootstrap open 建议只携带 `deliveryId + intentId + kind`；renderer 通过
  `deliveryId` 调用 host 读取该交付已绑定的文档，不把路径字符串传回 host。
  若保留 bootstrap 展示路径，也只能展示，不能参与打开或 identity 判定。
- open 内容、handle、token、identity 必须由
  `open_file_with_identity()` 同源产生；返回 renderer 前还要验证它与该
  delivery/registry reservation 属于同一目标。

### 4.3 commit 后状态不可撒谎

- ordinary 必须调用 `commit_ordinary_with_identity()`，再把其 host identity
  交给 coordinator 刷新；不得退回 `commit_ordinary()` + 调用方 path。
- Save As 必须调用 `orchestrate_save_as()`；不得退回生产
  `commit_save_as()` 旁路 registry。
- `CommittedButRebindPending` 表示 bytes 已落盘。renderer 至少取得真实
  receipt 并把已提交快照记为成功，不得继续显示成“文件未保存”。
- host 必须保存 recovery record（window generation、内部 rebind token、
  canonical target、receipt、cause）；rebind token 不能发给 renderer。
- 提供一次显式、有限的 recovery 通道。恢复成功后清 record；失败保持
  fail closed 并继续可见；不得自动无限重试。Destroyed 幂等清理。
- ordinary commit 后 registry refresh 失败也属于“已提交、host identity
  待恢复”，不能丢 receipt 或让用户用旧 token 盲重试覆盖。
- recovery 未完成时，阻止同窗再次保存/换文件，或先完成 host recovery；
  不允许在 registry 仍绑定旧目标时继续普通保存新 handle。

### 4.4 窗口与关闭

- `editor-*` label 只由 WindowRegistry 分配；renderer 不生成 label。
- CreateWindow 前 assignment reservation 已由 Wave 1 建立，不得把预占
  移回 build 成功之后。
- close request 初次被 hold 时不要不可逆地标记 Closing，因为用户仍可
  Cancel；只有一次性 close permit 真正放行原生关闭时才进入 Closing。
- `WindowEvent::Destroyed` 必须组合调用：
  `FileLifecycleService::revoke_window`、`CloseRequestStore::on_destroyed`、
  `LaunchCoordinator::on_destroyed`，随后触发一次非轮询式 drain。
- closing identity 持有到 Destroyed；同 identity open 期间 deferred。

### 4.5 权限与范围

- 窗口创建/聚焦由 host 自定义逻辑完成，不向 renderer 开放通用
  create/destroy 权限。
- 不修改 core schema、export、onboarding 内容、最终视觉、保存队列语义或
  MRT-003 三分支 close 语义。
- 不新增账号、云、遥测、网络端点。

## 5. Phase C：生产 host runtime 与真实窗口

### C1. 建立唯一生产 runtime

建议在 `lifecycle/` 下增加窄组合层，例如 `runtime.rs` / `effect_executor.rs`，
具体文件名可调整，但职责必须分开：

```text
LifecycleRuntime
  coordinator: Arc<LaunchCoordinator>
  file_service: Arc<FileLifecycleService>
  identity_provider: Arc<dyn FileIdentityProvider>
  effect_executor: single-drain gate
  post_commit_recovery: host-only records
```

- 初始化时登记默认 `main` 的 Booting generation。
- 明确定义 startup barrier：带文件 cold start 必须让第一个文件占用 main；
  cold 无文件才把 main 确认为 Blank。不得靠 sleep/“等 100ms”猜测 Opened
  事件时序。
- 对 macOS `RunEvent::Opened` 的实际先后关系先加诊断测试/日志，再选择
  barrier；事实写进最终 evidence。
- 多个 native callback 同时触发 drain 时，single-drain gate 保证同一个
  effect 不执行两次。不得持有 coordinator lock 等待 Tauri API。

### C2. 实现 effect executor

逐类实现并回报真实结果：

- `CreateWindow`：host 用既有 app URL/config 创建唯一 `editor-*`；build
  成功/失败都回报 `WindowCreated`。创建失败必须释放 assignment 并进入
  retryable，不留幽灵窗口。
- `FocusWindow`：查找 label，执行 show + unminimize + set_focus；任一步
  失败返回明确 reason，不 ack。
- `DeliverBootstrap`：只对目标 WebviewWindow emit；snapshot 已持久化，
  event emit 成功不等于 renderer terminal，不得在此 ack。
- `ShowRetryableError`：写入 host 可查询错误快照，并定向通知合适窗口；
  不允许全局广播后让每个窗口都显示同一错误。
- `AckIntent`：增加一次性 ack completion/清理步骤。terminal intent 可以
  保留有限诊断摘要，但不可无限驻留完整队列；重复 ack 不产生第二次副作用。

effect 链执行到稳定等待点后，再调用 `route_next()` 处理下一 intent。禁止
while 空转、sleep、自旋或自动 retry retryable intent。

### C3. 增加按窗 IPC 与 event

至少提供以下语义；名字可微调，但 Rust/TS 契约必须一一对应：

```text
platform_window_ready()
  caller label 由 WebviewWindow 注入
  返回该窗口未完成 bootstrap snapshot

platform_complete_window_bootstrap(deliveryId, outcome)
  caller label 由 WebviewWindow 注入
  校验 label + deliveryId + generation + 当前状态

platform_open_assigned_document(deliveryId)
  host 从 delivery 绑定目标读取，不接受 renderer path
  返回现有 OpenedDocument DTO

platform_retry_launch_intent(intentId)
platform_dismiss_launch_intent(intentId)
  只允许当前可见 error snapshot 的合法动作

platform_request_open_intent()
  host 打开 dialog、解析 identity、入队；不直接替换调用窗口 session

platform_request_blank_window()
  入队 activation；用于应用内“新建窗口”与需要的新空白入口
```

新增事件建议：

```text
platform://window-bootstrap       // target window only
platform://launch-retryable-error // target presentation window only
```

旧 `platform_app_ready`、`platform_ack_launch_intent`、全局
`platform://launch-intent` 在真实装配中必须退役；若为迁移测试暂留，需明确
标记非生产且没有消费者。

### C4. 接入文件生命周期

- bootstrap open：使用 delivery 绑定的无损 target 调
  `open_file_with_identity`；在把文档交给 renderer 前，验证/刷新当前 Loading
  reservation。目标在 enqueue 与读取之间发生替换时，不能让 registry 与
  handle 指向不同对象。
- toolbar Open（Tauri）：改为请求 host 入队。当前 dirty/occupied window
  不被替换；若要复用当前 Blank window，必须新增显式、可测试的 preferred
  blank assignment，不能用 displayPath 判断。
- toolbar New（Tauri）：请求 activation/new blank window；不能把 registry
  仍为 Open 的当前窗口仅在 renderer 内重置成 Blank。浏览器开发 fallback
  可保留现有本地流程。
- ordinary / Save As：按 §4.3 接 host outcome、registry 和 recovery；export
  authorization 保持原样。

### C5. Renderer 装配

- 每个 WebView 只实例化一个 `WindowBootstrapAdapter`。
- React StrictMode mount/unmount 不得造成重复 listener、重复 action 或丢失
  report-pending outcome。
- open-path action 必须 await：host assigned open → schema decode →
  `session.load/adoptOpenedTarget` → UI state/fit view 完成后，才回报 `opened`。
- blank action 只在目标窗口初始 session 已空白时回报 `blank-created`。
- action reject 显示可理解错误并回报 retryable；不得 catch 后回报 opened。
- 移除 MindMapApp 的 `TauriLifecycleAdapter` 全局订阅及基于
  `{windowId:"main", occupiedPath:displayPath}` 的单窗口路由。

## 6. Phase D：native source、可靠终态和多窗兼容

### D1. 所有 native source 进入唯一 ingest

实现一个共享 ingest 流程：provider 在 coordinator lock 外解析 identity，
成功后以 host 无损 target 入队并触发 drain；失败形成可见、可 dismiss 的
retryable source error，不静默忽略。

来源矩阵：

- cold argv：只解析真实候选文件；顺序保持；多个文件 main=A、后续 editor。
- `RunEvent::Opened`：URL 顺序逐条入队；非法/非 file URL 有诊断结果。
- single-instance：有有效文件参数则逐条 open；没有有效文件参数则恰好一个
  activation，不把 flags 当文件。
- `RunEvent::Reopen`：不论 `has_visible_windows`，warm 每次产生一个新空白
  activation；cold 默认 main 由 startup barrier 处理，不能多出空窗。
- app 图标/菜单内 New：走 activation，同一规则。

### D2. retry / dismiss / ack

- create/focus/read/bootstrap report 失败都进入稳定 retryable 状态。
- UI 显示 reason 和“重试 / 放弃”两个最小动作；这是功能性错误 UI，不做
  最终视觉换肤。
- retry 使用同 intentId、原 receivedAt，重新路由一次；失败再次停止。
- dismiss 才进入 dismissed terminal 并 ack once。
- renderer outcome report 失败保留 `report-pending`；明确按钮或窗口 ready
  时可有限重报，不重跑文档 action。
- 添加生产级测试证明 terminal 前零 ack、terminal 后一次清理、重放不二次
  ack、retryable 不自动推进。

### D3. 多窗 close 与 capability

- close request/permit 继续按真实调用窗口 label 隔离。
- discard 只 revoke 当前窗口 file handle/authorization。
- 保存后关闭若命中 post-commit recovery，先完成或明确处理 recovery，不能
  把“已写盘但 registry pending”误判为保存失败后丢弃。
- Destroyed 恢复未终态 assigned intent，并让其他 deferred intent 可继续。

### D4. 全局热键多窗回归

当前快捷键 hardcode `main`，多窗后必须修复：

- host 跟踪最近一次真实 Focused 的 window label，而不是单个全局 bool。
- 已有可用窗口时 show/focus 正确窗口并定向 emit quick-create；不得永远发给
  main。
- 没有可用窗口时通过 coordinator 创建一个空白窗口；不绕过 registry。
- 关闭一个窗口后不得保留指向已销毁 label 的快捷键目标。

不改变用户已确认的默认键位和偏好存储语义。

## 7. Phase E：真实 macOS 验收

### E1. 自动化矩阵

除 Wave 1 全部测试外，至少增加以下生产装配级 fake tests：

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| PR1 | 两个 WebView 启动 | 每窗只读自身 snapshot/target event；无全局 launch subscriber |
| PR2 | event 在 listener 与 snapshot 间到达 | action once、report once |
| PR3 | CreateWindow 失败 | assignment 清理、intent retryable、零 ack |
| PR4 | emit 成功但 renderer 未 terminal | intent 仍 assigned、零 ack |
| PR5 | report 失败后重报 | action 不重跑；同 outcome 有限重报 |
| PR6 | ack completion 重放 | terminal 只清一次，无内存/队列泄漏 |
| F1 | assigned open 目标被替换 | identity/handle/reservation 不错绑 |
| F2 | ordinary commit 后 registry refresh 失败 | receipt 保留、已提交提示、recovery fail closed |
| F3 | Save As `CommittedButRebindPending` | session 记住 commit；token 不出 host；同目标不抢占 |
| N1 | cold argv A/B | main=A、editor=B、顺序稳定、无多余空窗 |
| N2 | Opened A + duplicate A | 一个 owner；第二条 focus existing |
| N3 | single-instance 无文件 | 恰好一个 activation |
| N4 | Reopen visible true/false | warm 每次新空白，不替换其他窗 |
| W1 | A dirty 时 open C | A session/dirty/handle 不变；C 新窗 |
| W2 | Destroyed | 五类状态清理；其他窗零变化；deferred 可继续 |
| C1 | 多窗 close Cancel/Save/Discard | 按 label 隔离；Closing 只在真正放行时建立 |
| H1 | 全局热键 | 目标是最近 focused 活窗；无硬编码 main |

### E2. 真实应用矩阵

用 development 或 unsigned bundle 做真实 macOS 验收，记录 bundle/app hash、
命令、时间、窗口 label/标题和可复现步骤。至少执行：

1. cold 无文件：只有 main 空白窗。
2. cold 连续 A/B：main=A、editor=B，无多余空窗。
3. warm Finder“打开方式”或等价系统 Opened 入口打开 A/B。
4. A loading/open 时再次打开 A，以及 symlink/相对段/中文空格等价入口：
   聚焦同窗，不重复建窗。
5. A dirty 时系统打开 C：A 内容、dirty、handle 不变；C 新窗。
6. Dock/icon warm activation 两次：每次各建一个新空白窗。
7. 分别关闭一个 clean、一个 dirty、一个有 pending save 的窗口；其他窗口
   不变，Cancel 只影响当前窗。
8. 制造一次可恢复 read/create/focus 错误：错误可见；不自动重试；retry 或
   dismiss 行为与 ack 一致。
9. Save As 成功后普通 Save；以及可注入的 post-commit recovery 路径。
10. 多窗下全局热键唤醒/quick-create 目标正确。

如果扩展名/文件关联仍是 G2 未决，Finder 用“打开方式”或 `open -a` 触发
真实应用事件，不修改 `tauri.conf.json` 伪造文件关联。明确记录入口差异。

截图只能证明可见结果，必须同时保存结构化 scenario log；platform fake、
jsdom、单窗口截图都不能替代本矩阵。

## 8. 红灯与内部 Gate

先新增最小生产装配 seam 和红灯，再改实现。红灯证据写入：

`.omx/reviews/2026-08-31-mrt-004-wave-2-red-light-evidence.md`

至少证明旧生产路径的四个事实：

1. 每个 renderer 订阅全局 launch event。
2. listener 安装晚于 snapshot，且 action 开始即 ack。
3. `lib.rs` 生产 commit 绕过 B1A host outcome/coordinator。
4. hardcoded `main` 路由/快捷键在 editor window 下错误。

Internal Gate C：真实窗口 + targeted bootstrap + B1A 文件接线的 fake/integration
矩阵全绿后，执行 Agent 直接进入 D。

Internal Gate D：native source + ack/retry/dismiss + close/hotkey 回归全绿后，
执行 Agent 直接进入真实 E，不等待人工回复。

## 9. 允许与禁止修改

允许：

- `apps/desktop/src-tauri/src/lifecycle/`
- `apps/desktop/src-tauri/src/ipc/`
- `apps/desktop/src-tauri/src/file/`（只限 B1A 生产接线/recovery）
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/shortcuts/`（只限多窗 label 路由）
- `packages/platform/src/lifecycle/`、`packages/platform/src/ipc/`、对应测试
- `packages/platform/src/file/`（只限 commit result/recovery 契约）
- `apps/desktop/src/app/`（bootstrap 装配与最小 retry/dismiss/recovery UI）
- `tests/`、`scripts/` 中与本批直接相关的可重复验收工具
- `docs/architecture/window-launch-lifecycle.md` 与本批 evidence

禁止：

- 修改 Accepted ADR 0008 的决定或 hash。
- 修改 capability、`tauri.conf.json`、CI/CD、发布配置。
- 新增运行时依赖或全局依赖。
- 修改 core schema、export、最终视觉、onboarding 产品内容、文件格式。
- 重写 MRT-001 保存队列/dirty identity 或 MRT-003 close 三分支。
- 恢复 renderer 全局 launch 订阅、displayPath identity、任意 path refresh、
  post-commit abort、同步 ack、自动无限 retry。

## 10. 必须先停下请求负责人授权的情况

命中任一项立即停止，不做变通：

- 需要修改 capability、`tauri.conf.json`、CI/CD、发布配置。
- 需要安装新依赖或改变本机全局环境。
- 需要改变 Accepted ADR、产品“一文档一窗口/同文件聚焦/activation 新空白”
  语义。
- 需要删除文件、目录或 git 历史。
- 无法在不破坏 MRT-001/MRT-003 契约的前提下接线。

普通局部接口、类型、测试 seam 和文件组织由执行 Agent 自主完成，不要以
微小实现选择为由中途停工。

## 11. 验收命令

```bash
pnpm --filter @mindmap/platform test
pnpm test:unit
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
pnpm lint
pnpm quality
pnpm build
pnpm exec prettier --check <Wave 2 变更 TS/TSX/MD>
rustfmt --edition 2021 --check --config skip_children=true <Wave 2 变更 Rust>
git diff --check
git status --short
```

另运行：

- Windows target check；若仍先被 `icons/icon.ico` baseline 阻断，如实记录，
  不修改配置绕过，不声称 Windows 整包已通过。
- Wave 2 变更 Rust 文件的 Windows 同源源码/`cfg` probe；不得只复用 B1 的
  identity.rs 旧探针冒充本批生产 runtime 已跨平台。
- 真实 macOS E1/E2 矩阵。

全量 format 若命中任务范围外既有格式债，只报告 baseline 并执行
changed-scope 格式门禁；不要批量格式化无关文件。

## 12. 完成回报格式

一次性报告：

1. 旧生产路径红灯与根因。
2. 最终 runtime/effect executor/IPC/bootstrap 数据流。
3. startup barrier 的真实事件顺序证据。
4. native source 到 terminal/ack 的完整状态矩阵。
5. open/ordinary/Save As 与 registry 同源绑定和 post-commit recovery。
6. 多窗 close、Destroyed、全局热键回归。
7. PR/F/N/W/C/H 自动化测试映射。
8. 真实 Finder/Dock 多窗口 scenario log、截图索引、bundle hash。
9. 全部门禁、Windows blocker/probe、changed-scope format、
   `git diff --check`、`git status --short`。
10. 变更文件清单与范围声明。
11. 声明没有修改 ADR、capability、配置、CI/CD、发布、最终 UI、core/export/
    文件格式；若命中红线则附负责人事先授权，而不是事后说明。

完成后停止，等待统一验收，不自行进入 MRT-005 或最终视觉实现。
