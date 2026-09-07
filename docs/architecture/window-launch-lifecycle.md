# 窗口与启动生命周期(MRT-004 Wave 1 已接受基础)

> 验收状态：**MRT-004 Wave 1（A1 + B/B1/B1A）ACCEPTED**。A1 的单 owner、原子 reducer、Closing 延迟路由和 bootstrap 可靠重报，以及 B/B1/B1A 的 assignment、untitled、无损 identity、保存换绑、commit phase、host outcome 与 token caller 校验，已于 2026-08-31 完成统一验收。详见 `.omx/reviews/2026-08-31-mrt-004b1a-acceptance.md`。
> **Wave 2（C/D/E）首轮生产接线已实现但未通过统一验收**：单 owner 与主要
> 数据流可保留，按窗错误 ownership、Failed 窗口恢复、report 重报、startup
> barrier 原子性、recovery/capability 竞态及 native 证据进入 MRT-004W2R；
> W2R 主体已实现，但 2026-08-31 统一验收发现 commit/assigned-open 的
> generation 线性化缺口，以及 native S9/S10 verdict 假绿；进入
> MRT-004W2R2 最终收口。当前不得把 Wave 2 或 MRT-004 标为 Accepted，也
> 不得进入 MRT-005。

本文记录**已落地**的窗口注册、启动协调与 per-window bootstrap 纯状态机。
决策依据见 `docs/decisions/0008-window-launch-lifecycle.md`(Accepted 1.0.0)。

## 当前已接受事实(截至 MRT-004 Wave 1)

以下组件为**纯状态机**,不依赖 Tauri / React / OS API,由单元测试锁定:

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| `WindowRegistry` | `apps/desktop/src-tauri/src/lifecycle/window_registry.rs` | 窗口状态转换表、file identity reservation、bootstrap 交付代际 |
| `LaunchCoordinator` | `apps/desktop/src-tauri/src/lifecycle/launch_coordinator.rs` | intent 队列排序、路由决策、effect 生成与 correlation、ack |
| `WindowBootstrapAdapter` | `packages/platform/src/lifecycle/window-bootstrap.ts` | renderer 侧 listener-first bootstrap 消费与终态回报 |

尚未接线(见"未完成"):真实多窗口、Finder/Dock 原生事件、Tauri IPC 命令、
错误 UI。生产 `MindMapApp` 仍运行 MM-060 的单窗口 `LaunchRouter`/
`TauriLifecycleAdapter`,其已知缺陷(同步 ack、快照先于 listener、
displayPath 判定同文件)由新状态机取代,MRT-004C/D 切换装配。

## WindowRecord 状态机

```
register(label) ──► booting ──► blank ──► closing ──► (Destroyed 移除)
                      │           │
                      ▼           ▼
                   loading ──► open ──► closing
                      │           │
                      ▼           └─(不可回 blank/loading:换文件必须新窗)
                    failed ◄──────┘
                      │
                      ▼ (retry)
                   loading
```

- 转换只能经显式方法(`begin_loading` / `mark_open` / `mark_blank` /
  `mark_failed` / `begin_closing`);非法组合返回
  `INVALID_WINDOW_TRANSITION`,状态不变。
- **A1 起:identity reservation 覆盖 loading / open / closing 三态,直到
  Destroyed 才释放**(A1-F4)。`failed` 释放;同 identity 任一时刻至多
  归属一个 label(`IDENTITY_ALREADY_RESERVED`)。
- 查询 API 区分两个事实:`identity_owner`(仅 Loading/Open——聚焦目标)
  与 `identity_reservation`(全部持有态——路由/预占判定);查询与写入
  使用同一份索引,不再出现"查询无主、写入被拒"的分裂。
- `FileIdentity` 为 host 拥有的真实身份(canonical `PathBuf` 无损 +
  Unix physical;B1 起)。**displayPath/lossy 字符串永远不参与同文件
  安全判定,只用于展示与日志。**
## 并发所有权与原子性(A1)

- `WindowRegistry` 是**纯数据结构**(无内部 Mutex/Atomic,全部
  `&mut self`);`LaunchCoordinator` 持有唯一一把
  `Mutex<CoordinatorState>`,统一拥有 registry / intents / order /
  in-flight / 计数器。不存在任何多锁组合,反向锁序结构性不可能(A1-F1)。
- 所有 completion(validate-then-commit):前置条件在同一临界区内全部
  只读验证通过后才一次提交;失败时完整状态零变化(A1-F3)。
  - CreateWindow 成功:label 未登记 + identity 无持有冲突(只读预检)
    → register → begin_loading(reservation)→ next_delivery → phase 推进。
  - renderer outcome:assigned 匹配 → 窗口状态匹配(只读)→ 交付当前代
    校验 → mark_open/mark_blank/mark_failed + intent 终态。
- 副作用只能以 effect 形式返回,调用方在锁释放后执行;锁内无
  OS/IPC/文件 IO。
- 多线程并发 smoke(L2)作补充;结构保证来自单锁设计本身。

## Closing identity 延迟路由(A1)

- Closing 窗口持有 identity 到 Destroyed;同 identity 的重复 open intent
  在此期间 **deferred**:零 create、零 focus、零 ack,intent 留在队列
  (不阻塞其他 identity 的 intent);Destroyed 后由下一次 `route_next()`
  以同 intentId 恢复。无 sleep/轮询/自旋。
- Destroyed 同时把 assigned/交付/聚焦等待于该窗口的非终态 intent 恢复
  排队(同 intentId、同 receivedAt),不丢失(T4/C3)。

## bootstrap 交付可靠性(A1)

renderer 本地每交付阶段:

```
queued(事件/快照双达) → processing(action 恰好一次)
  → report-pending(outcome 已缓存;report 成功 → reported;失败保留)
```

- `reportOutcome` 失败不吞错:经 `onReportError` 回调与
  `pendingReports()` 快照可观察;`retryPendingReports()` 每次 pending
  至多重报一次(不重跑 action、不自旋)。
- report 语义为 at-least-once:report-pending 期间的同 delivery 重发只
  重报缓存 outcome;host 侧 correlation 对 terminal 后重放幂等拒绝。
- `start()` 重复调用稳定拒绝;snapshot 失败先卸载 listener 再抛(无泄漏)。
- `dispose()` 后不接新 delivery,未开始的 queue 交付被丢弃(由 host
  Destroyed 恢复路径承接);进行中的 action 完成后 outcome 保留待报。
- 判别联合 payload(open-path 必带 `canonicalPath` 与 `intentId`);
  renderer outcome 收窄为 `opened | blank-created | retryable-error`,
  与 Rust `RendererOutcome` 一一对应(focused-existing/dismissed 属 host)。

## LaunchIntent 状态机

```
queued ──route_next──► routing ──交付成功──► assigned ──renderer──► terminal
                         │                      │
                         ├─create/focus/交付失败─►────────────┐
                         └─renderer retryable-error───────────►┤
                                                              ▼
                                                      retryable-error
                                                        │         │
                                              retry(同ID)┘         └dismiss
                                                   ▼                    ▼
                                                queued              terminal(dismissed)
```

- terminal 仅四种:`opened` / `focused-existing` / `blank-created` /
  `dismissed`;每种恰好产出一个 `AckIntent`。
- `retryable-error` 不是 ack 条件;不自动重试(不自旋),错误经
  `ShowRetryableError` 可见,由用户 retry(同 intentId 重新排队)或 dismiss。

## Effect 与 correlation

coordinator 只生成 effect,不直接执行副作用:

```
CreateWindow{intentId, label}          host 创建 editor-* WebView
FocusWindow{intentId, label}           同 identity 已 open/loading 时聚焦
DeliverBootstrap{intentId, label, deliveryId, kind, path}
AckIntent{intentId}                    终态确认(恰好一次)
ShowRetryableError{intentId, reason}   错误可见化
```

effect 回报必须过 correlation:intent 必须是当前 in-flight、处于预期
`Awaiting` 步,且 label / deliveryId 完全一致;重放、跨窗、乱序、类型
不匹配一律 `INVALID_EFFECT_COMPLETION`,状态不变。

串行语义:同一时刻最多一个 **routing** intent(队列按
`receivedAt + intentId` 稳定排序);routing 期间后续 intent 零副作用。
`assigned` 与 `retryable-error` 是稳定等待点,占位释放——读取进行中即可
聚焦同文件窗口或创建下一窗。

## 路由决策(队首 open-file)

1. identity 已被 open/loading 窗口占用 → `FocusWindow`(不建重复窗)。
2. 默认 `main` 仍为 booting 且无任何分配(冷启动窗口期)→ 分配给 main,
   同时立即 reservation identity(ADR 0008 §8)。
3. 否则 → `CreateWindow editor-*`(warm 不复用任何 occupied/dirty 窗)。

activation 每个 intent 各创建一个新空白窗,与既有窗口状态无关。

## Per-window bootstrap(TS)

```
install targeted listener → read own pending snapshot → dedupe deliveryId
→ await renderer action → report terminal / retryable outcome
```

- listener-first:先订阅再读快照,注册间隙到达的事件不丢(事件与快照
  双达按 deliveryId 恰好执行一次)。
- action 必须返回 Promise 终态;resolve 前零 report(不提前 ack)。
- action reject → `retryable-error`(原因字符串化,不吞信息),不自动重试。
- dispose 后忽略新 delivery;进行中的 action 继续完成并 report
  (host 需要终态,否则 intent 永久悬挂——显式策略)。

## MRT-004B：真实 FileIdentity 与 alias 索引（已接受）

身份模型(`apps/desktop/src-tauri/src/file/identity.rs`):

```text
FileIdentity
  canonical: CanonicalPathKey        // canonicalize 后的路径;逻辑锚点,恒存在
  physical?:  PlatformPhysicalFileKey // Unix: dev()+ino();目标不存在或平台未实现时 None

IdentityAlias = Canonical(key) | Physical(key)   // 独立成键
```

- registry 的 owner 索引按 `IdentityAlias` 建立:canonical 与 physical 各自
  是独立条目,**任一 alias 重叠即同一资源**(symlink/相对段经 canonical
  重合;hard link 经 physical 重合)。不把两者 OR 进一个派生 Eq/Hash 键
  (文件替换后不满足等价关系,会漂移 HashMap)。
- `FileIdentityProvider`(可注入;职责不进 UI/renderer):
  `resolve_existing` / `resolve_authorized_target`(目标不存在 →
  canonical-only)/ `refresh_after_commit`(physical 重读,canonical 稳定)。
- macOS/Unix 实现用 `std::os::unix::fs::MetadataExt`,零新增依赖。
- **Windows 边界**:`PlatformPhysicalFileKey` 仅 `Unix` 变体;Windows
  稳定 file ID 需要平台专项(`GetFileInformationByHandle` 等),本波次
  **未完成**,Windows 腿为 canonical-only(可由 fake provider 测试合约),
  不冒充已验证的 Windows 等价性——Wave 2/平台专项处理。

## MRT-004B：保存换绑协议（已接受）

ordinary Save(§6.1):文件服务按 handle + expected token 校验并原子替换
(锁外)→ `refresh_after_commit` 解析(锁外)→ `refresh_identity_after_commit`
(锁内单临界区):移除旧 physical alias、注册新 physical alias,canonical
持续归属该 label,无空窗期。写前校验失败 / 外部修改冲突 / handle 拒绝时
registry 完全不变。

Save As 三段式(§6.2;文件 I/O 一律在 coordinator state lock 外):

```text
prepare_rebind(label, targetIdentity)   锁内:写前预占 target aliases(opaque token)
  → perform authorized file commit      锁外:FileLifecycleService.commit_save_as
  → success: finalize_rebind(token, finalIdentity)
            锁内:原子移除旧 aliases + pending → 采用提交后真实 aliases
    failure/cancel: abort_rebind(token)
            锁内:只清 pending;旧 identity/handle/token/displayPath 不变
```

- prepare 在任何写入前检查 target aliases(其他 open/loading/closing
  窗口或 pending rebind 占用 → `IDENTITY_ALREADY_RESERVED`,目标 bytes
  不变)。
- pending 期间同目标 open/create 被 coordinator **deferred**(S-B4)。
- finalize 的写后不变量错误 fail closed:保留全部 reservation 并返回
  稳定错误,不伪装成回滚、不静默释放(避免重复窗口)。
- Destroyed 清理 active identity、该 label 全部 pending rebind 与交付槽
  (幂等)。
- host-domain 编排测试(window_registry `b_orchestration_tests`)以真实
  `FileLifecycleService` 提交验证全链路;生产 IPC/lib.rs 装配属 Wave 2。

## B1：统一 reservation 与 token 绑定（已接受）

- **统一 reservation**:`alias_owners` 值为 `Ownership{label,
  kind: Active|Assignment}`;CreateWindow effect **发出前**经
  `reserve_assignment` 预留(建窗窗口的 identity 预占),create 失败
  `release_assignment` 原子回滚。pending rebind 保存在独立表中，但
  `begin_loading`/assignment/prepare/finalize/refresh/路由入口均检查它，
  共同维护“任一 alias 同时最多一个有效 reservation”的不变量。
- **token 绑定与单例**:`PendingRebind` 绑定 windowLabel +
  windowGeneration(register 递增,stale 检测)+ source 状态快照 +
  authorized canonical target + reserved aliases;同 label 同时最多一个
  pending;finalize 的 canonical 必须与 token 完全一致(仅 physical 允许
  因原子替换轮换);错 token/重放/stale 零状态变化。finalize/abort 的
  caller label 校验见 B1A 段。
- **untitled / close-save**(窄转换,不改 ADR 产品语义):Blank 无
  identity → Save As 成功 adopt → Open(仅 finalize 路径);Open/Loading/
  Closing 有 identity → 保持原状态只换 aliases;Closing 无 identity →
  close-save 成功保持 Closing 暂持新 identity(不复活),Destroyed 清理;
  失败/取消全部零变化。
- **host-domain 提交编排**(`file/mod.rs`,B1A 起 commit 前后语义分界,
  见 B1A 段):`AuthorizationLedger::plan`(写前校验窗口/kind/expiry/
  未消费,不消耗)→ `prepare_rebind`(锁内)→ `commit_save_as_planned`
  (锁外 redeem/TOCTOU/原子替换)→ `refresh_after_commit`(锁外)→
  `finalize_rebind`(锁内)。
- **无损路径与平台边界**:`CanonicalPathKey(PathBuf)`;lossy 仅
  `display_lossy` 投影(不参与 Eq/Hash);metadata 从 canonicalize 后
  目标读取;Unix provider/变体/测试完整 `#[cfg(unix)]`;非 Unix
  `CanonicalOnlyProvider` + `IdentityStrength` 明示(canonical-only 腿
  的 hard-link 等价性不成立)。Windows 整 crate 编译仍被既有
  `icons/icon.ico` baseline blocker 阻断;identity 源码已用独立探针在
  Windows target 编译通过(cfg 证明,见 B1 红灯证据)。

## B1A：commit 前后语义分界、host outcome 绑定与 token caller 校验（已接受）

- **commit 前后语义分界(B1A-F1)**:`orchestrate_save_as` 分两段——
  **PreCommit**(plan → resolve/bind → prepare → redeem/TOCTOU/commit)
  任何失败 → abort pending、文件未提交,错误为
  `SaveAsError::PreCommit{Plan|ResolveTarget|TargetBindingMismatch|
  Prepare|Commit|CommitAndAbortFailed}`(abort 自身失败以组合错误上报,
  不吞错);**PostCommit**(文件 bytes 已落盘)refresh 失败/canonical 与
  plan 不一致/finalize 拒绝 → 一律 `CommittedButRebindPending{receipt,
  cause}` 并**保留** fail-closed pending reservation,不得 abort、不得
  提示为可重试覆盖。
- **host identity 与文件能力同源(B1A-F2)**:
  - open:`open_file_with_identity(provider, label, path)` 返回
    `OpenHostOutcome{renderer: OpenOutcome, identity}`;canonicalize
    一次后内容读取、handle 签发与 provider 解析共用同一无损 `PathBuf`,
    不经 displayPath 反推(`outcome_display_path_of` 已删除);
  - ordinary:`commit_ordinary_with_identity` 返回
    `CommitHostOutcome{renderer: Receipt, identity, canonical_target}`;
    目标只来自 `HandleRegistry::validate`,提交成功后同一 service 流程
    刷新 identity 并校验 canonical 与 handle 绑定一致;公开 loose
    `refreshed_identity_after_commit(path)` 已删除;
  - registry:`refresh_identity_after_commit` 新增 canonical 连续性校验
    (`IDENTITY_CANONICAL_MISMATCH`),ordinary 刷新不得换绑 canonical,
    换文件唯一路径是 Save As `finalize_rebind`;
  - plan:`AuthorizationPlan` 字段私有 + 只读 getter;`redeem_plan`
    复核 ref/window/kind/canonical target 与 ledger 完全一致;
    `commit_save_as_planned` 先校验 plan 归属当前窗口。
- **token caller 校验(B1A-F3)**:`finalize_rebind(caller_label, token,
  identity)` / `abort_rebind(caller_label, token)`:validate-then-commit,
  caller 与 pending owner 不符 → `INVALID_REBIND_TOKEN` 且零变化;
  generation stale 防御保留;orchestration 以同一 window_label 贯穿
  plan → token owner → finalize/abort。IPC DTO 不新增 FileIdentity、
  canonical target 或 rebind token。

## Wave 2 生产接线(已实现,待统一验收)

上述"未完成"清单已由 Wave 2 全部实现(派发时基线见任务卡
`.omx/reviews/2026-08-31-mrt-004-wave-2-production-integration-task-card.md`)。

**LifecycleRuntime**(`lifecycle/runtime.rs`)是生产 host 的唯一组合层:
持有 `Arc<LaunchCoordinator>`、`Arc<FileLifecycleService>`、identity
provider、post-commit recovery 记录与 single-drain gate;`lib.rs` 只 manage
一个 runtime(旧 `LaunchIntentStore`/全局 `platform://launch-intent` 广播/
`platform_app_ready`+`platform_ack_launch_intent` 均已退役)。

- **effect executor**:effect 从 reducer 取出后经 `HostEffectSink` 在锁外
  执行(生产 `TauriHostEffectSink`/测试 fake),结果以 correlation 回报;
  `DeliverBootstrap` 的 `WindowNotReady`(冷启动静态 main 的 WebView 未
  就绪)视为交付成功——snapshot 已持久化,由 renderer ready 快照承接
  (PR4)。`AckIntent` 经 `complete_ack` 一次性移出队列,仅保留容量 32 的
  诊断摘要(重复 ack 零副作用)。
- **startup barrier**(基于事件事实,无延时):argv 在进程启动时收集、
  setup 统一入队;`platform_window_ready("main")` 返回空快照且无任何
  open-file intent 时才 `mark_blank`。macOS LaunchServices cold open 实测
  (`docs/quality/evidence/wave2/mrt-004-wave2-cold-opened-order.log`):
  argv=0,文件经 `RunEvent::Opened` 到达且早于 renderer ready → main 承载
  首文件,无多余空窗;ready 先行的竞态降级(文件开新窗)由 fake test 锁定。
- **native source 唯一 ingest**:argv(只解析真实候选)/`RunEvent::Opened`
  (provider 解析失败形成可见可 dismiss 的 source error)/single-instance
  (无文件参数恰好一个 activation)/`Reopen`(warm 每次一个新空白
  activation;cold main 未确认时忽略)全部经 runtime 入队并 drain。
- **IPC**(§5C3):`platform_window_ready` / `platform_complete_window_bootstrap`
  / `platform_open_assigned_document`(只认 deliveryId,不接受 renderer
  path)/`platform_retry_launch_intent` / `platform_dismiss_launch_intent`
  /`platform_launch_errors` /`platform_request_open_intent`(host 对话框+
  入队)/`platform_request_blank_window` /`platform_pending_recovery`
  /`platform_resolve_pending_recovery`;事件 `platform://window-bootstrap`
  与 `platform://launch-retryable-error` 均定向 emit。工具条 Open/New
  (Tauri)改请求 host intent,不再由 renderer 直连打开
  (`TauriFileAdapter.openDocument/openPath` 保留契约但稳定报退役错误)。
- **commit 生产接线**(§4.3):ordinary 经 `commit_ordinary_with_identity`
  (refresh 失败返回 `CommittedButRefreshPending`+真实 receipt),Save As
  经 `orchestrate_save_as`(`CommittedButRebindPending` 携带 host-only
  rebind token+canonical target);两者进入 runtime 的 post-commit
  recovery(label+generation 绑定,Destroyed 幂等清理),renderer 收到
  `rebindState: "recovery-pending"` 的真实 receipt(不显示为保存失败);
  recovery 未完成时同窗再次保存被 `RECOVERY_PENDING` 拒绝;显式恢复 =
  锁外刷新+锁内 finalize/refresh,失败保持 fail closed。
- **多窗 close**(§4.4):close permit 真正放行时才 `begin_closing`
  (Hold/Cancel 不标记);`Destroyed` 组合调用
  `FileLifecycleService::revoke_window`+`CloseRequestStore::on_destroyed`
  +`LaunchCoordinator::on_destroyed`+recovery 清理+热键目标清理,随后
  一次非轮询 drain。
- **热键多窗路由**(D4):`GlobalShortcutState` 跟踪最近真实 Focused 的
  window label(取代单 bool);dispatch 定向最近活窗(销毁即清,不再
  硬编码 main);无可用窗口时经 coordinator activation 建空白窗。
- **renderer**(§5C5):每 WebView 一个 `WindowBootstrapAdapter`(模块级
  单例,StrictMode 重挂载不重复 listener/不丢 report-pending);open
  action 全程 await(host 分配读取→decode→load/adopt→UI 完成后才回报
  opened);blank 只在初始 session 空白时回报;最小功能性 retry/dismiss
  与 recovery UI(非最终视觉)。

真实 macOS 矩阵证据:`docs/quality/evidence/wave2/mrt-004-wave2-macos-e2e.json`
(bundle hash、10 场景、截图索引、host 日志)。

## W2R 修复(2026-08-31,MRT-004W2R)

Wave 2 首轮验收的 W2R-F1~F7 已修复(任务卡
`.omx/reviews/2026-08-31-mrt-004w2r-lifecycle-isolation-and-native-evidence-task-card.md`):

- **caller-bound launch error**(F1):错误记录绑定呈现窗口
  (label+generation);`platform_launch_errors`/`retry`/`dismiss` 注入
  真实 caller `WebviewWindow`,跨窗查询/动作稳定拒绝且零变化;呈现窗口
  Destroyed 后转移到另一活窗(更新 generation)或保持 host-only,绝不退
  化为全局可查。origin Failed 窗口随记录持久化。
- **Failed 窗口生命周期**(F2):retry 经 `retry_failed_in_place` 在原
  Failed 窗原位恢复(重新解析目标 → Failed→Loading→同窗 Open,零新窗);
  dismiss 在同一临界区完成 `failed_to_blank` 窄转换(清 active intent/
  交付槽,窗口回到可编辑、可首次 Save As 的 Blank)。
- **report-pending 生产入口**(F3):adapter 单例经"当前挂载实现"持有者
  解析 action/report-error(不捕获失效 closure);pending delivery 有
  可见 UI 与显式一次重报(action 不重跑、无自动 timer)。
- **原子 startup barrier**(F4):`confirm_startup_blank` 单锁完成
  "读快照 + 验证无 open + 确认 Blank";`mark_blank` 亦有 open-intent
  守卫——检查与写入间入队的 native open 不再被挤去新窗。
- **generation 封闭**(F5):recovery 记录绑定 generation,入口校验 →
  锁外刷新 → 回写前再校验 → compare-and-remove;per-window gate 串行
  同窗 commit/recovery;记录插入不覆盖(fail closed)。
- **assigned open 零残留**(F6):读取期间窗口 Destroyed 时,本次签发的
  handle 被精确撤销(`revoke_document_handle`)——不留下能驱动同名新代
  窗口的孤立 capability。
- **E2 门禁**(F7):十场景三连跑全 PASS(退出码 0);verdict 仅由结构化
  facts 计算;截图过 image-stats 有效性门禁(DARK/跨场景重复即 FAIL);
  MANUAL/SKIP 不存在,缺口以 note 显式记录(Save As 面板确认在本环境
  不可驱动——rfd blocking 面板冻结态,CGEvent/Return/AXPress 均无效;
  recovery 注入需亚毫秒故障窗口,由 F2/F3/R5 测试锁定)。
  驱动通道:`open -a --stderr` 启动 + `caffeinate -d` 保活 + swift 直连
  AX(`scripts/quality/ax-driver.swift`)与 CGEvent 真实鼠标/键盘。
- **Windows**(F7):主 crate target check 仍被既有 `icons/icon.ico`
  baseline 阻断(如实记录);同源 probe 一条命令
  (`scripts/quality/windows-probe.mjs`)可重复:生产 lifecycle/file +
  ipc DTO 在 `x86_64-pc-windows-msvc` 编译通过,raw log 与源码 SHA-256
  清单入库 `docs/quality/evidence/wave2/mrt-004w2r-windows-*`。
