# MRT-004 Wave 2 红灯证据（旧生产路径四事实）

日期：2026-08-31。基线：MRT-004 Wave 1（A1+B/B1/B1A）ACCEPTED 后的工作树
（HEAD 8394f10 + 未提交 Wave 1 变更）。

方法：任务卡 §8 要求"先新增最小生产装配 seam 和红灯，再改实现"。事实
1/2 以临时 TS 红测驱动（断言 Wave 2 期望行为，旧实现上失败），事实 3/4
为生产装配代码的 grep 可复现证据（Rust 侧行为在 cargo test 中不可运行
——生产路径需要 AppHandle；代码引用即事实本身）。

## 事实 1：每个 renderer 订阅全局 launch event

红测文件（临时）：`packages/platform/test/red-wave2-legacy-launch.test.ts`
（跑出输出后删除；被测生产路径本批退役，测试无长期对象）。

命令与输出（2026-08-31 09:15 本机）：

```text
$ pnpm exec vitest run --root . packages/platform/test/red-wave2-legacy-launch.test.ts
 × 红灯 1：多 WebView 重复消费全局 launch event
   → expected [ 'w1:intent-1', 'w2:intent-1' ] to have a length of 1 but got 2
```

根因（代码事实）：

- `apps/desktop/src/app/mindmap-app.tsx:512`：每个 `MindMapApp` 实例都
  `new TauriLifecycleAdapter(...)`（C5 要移除的装配）。
- `packages/platform/src/lifecycle/tauri-adapter.ts:43`：`listen(
  IPC_EVENTS.launchIntent, ...)` 是 **app 级全局订阅**（非
  `emit_to`/targeted）。
- `apps/desktop/src-tauri/src/ipc/mod.rs:326-328`：`emit_launch_intent`
  用 `app.emit(LAUNCH_INTENT_EVENT, ...)` 全局广播。

两个 WebView 并存时同一条 intent 被两个 router 各消费一次（各 ack 一次、
各执行一次窗口动作）。Wave 1 状态机（`LaunchCoordinator` 串行路由 +
`Effect::AckIntent` 恰好一次）在生产中并未接线。

## 事实 2：listener 安装晚于 snapshot，且 action 开始即 ack

同一红测文件：

```text
 × 红灯 2：快照先注入、listener 后装 + action 开始即 ack
   → expected 3 to be less than 0
```

`3` 是 `listener-installed` 的序，`0` 是 `snapshot-injected` 的序——
旧实现快照注入在前、listener 安装在后，与 A1 `WindowBootstrapAdapter`
的 listener-first 协议顺序相反。注册间隙到达的 intent 只能依赖重取。

根因（代码事实）：

- `tauri-adapter.ts:40-45`：`start()` 先 `invoke(appReady)` 并把快照注入
  router（`for (const intent of flushed) this.router.onIntent(intent)`），
  之后才安装 listener。
- `launch-router.ts:113-118`：`dispatch()` 同步调用 `onWindowAction`
  （fire-and-forget 异步 action）后**立即** `onAck(intent.intentId)`——
  action 尚未终态即 ack。与 ADR 0008 §7"renderer 完成 openPathFlow 后
  回报 awaitable terminal outcome；不得用'异步动作已开始'代替 terminal
  outcome"直接冲突。

## 事实 3：lib.rs 生产 commit 绕过 B1A host outcome/coordinator

命令与输出：

```text
$ grep -n "commit_ordinary\b\|commit_save_as\b" apps/desktop/src-tauri/src/ipc/mod.rs
187:        } => service.commit_ordinary(
196:        } => service.commit_save_as(window.label(), &authorization_ref, &content_json)?,

$ grep -rn "commit_ordinary_with_identity\|orchestrate_save_as" apps/desktop/src-tauri/src \
    | grep -v "file/mod.rs" | grep -v test
（无输出 = 生产装配零接线）
```

`platform_commit_document`（ipc/mod.rs:176-203）仍使用 renderer-DTO 路径
`commit_ordinary()` / `commit_save_as()`：提交结果不产生 host identity、
不刷新/换绑 `WindowRegistry`、不消费 `CommitHostOutcome` /
`orchestrate_save_as` 的 PreCommit/PostCommit 分界。B1A 验收明确列为本批
前置（B1A acceptance "Wave 2 前置提醒"）。

## 事实 4：hardcoded `main` 路由/快捷键在 editor window 下错误

命令与输出：

```text
$ grep -n '"main"' apps/desktop/src-tauri/src/shortcuts/mod.rs
55:    if let Some(win) = app.get_webview_window("main") {

$ grep -n 'windowId: "main"' apps/desktop/src/app/mindmap-app.tsx
513:      () => [{ windowId: "main", occupiedPath: session.displayPath, dirty: session.isDirty }],
```

- 全局热键 dispatch（shortcuts/mod.rs:54-65）永远 show/focus/emit
  `quick-create` 给 `main`；editor-* 窗口存在时目标错误（D4）。
- 旧单窗口路由以 `{windowId: "main", occupiedPath: displayPath}` 描述
  全部窗口事实：displayPath（展示字符串）参与同文件判定、多窗事实
  不存在（ADR 0008 §8 禁止 displayPath 参与 identity）。

## 结论

四事实分别对应任务卡 §4.1（host 单 owner）、§4.2（可靠交付与终态）、
§4.3（commit 同源绑定）、§4.4/D4（多窗路由）。Wave 2 实现以
`LifecycleRuntime` + effect executor + targeted IPC 取代上述路径；
本文件记录的红测对象（`TauriLifecycleAdapter` 生产装配）随实现退役，
断言语义由新的生产装配级 fake tests（PR1-PR6）承接。
