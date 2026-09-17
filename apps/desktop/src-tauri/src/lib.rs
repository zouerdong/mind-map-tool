// Tauri host 层（MM-020 骨架 → MM-060 文件/生命周期装配 → MRT-004 Wave 2
// 唯一生产 runtime）。
// 模块：
// - file/      commit protocol、TargetAuthorization ledger、DocumentTargetHandle、偏好
// - lifecycle/ WindowRegistry / LaunchCoordinator / LifecycleRuntime（唯一 owner）
//              + MRT-003 原生关闭状态机；launch.rs 为 MM-060 历史队列（非生产）
// - ipc/       命令薄壳（serde 契约与 packages/platform/src/ipc/types.ts 对齐）
// - shortcuts/ 全局热键（多窗 label 路由，Wave 2 D4）
// 禁止：服务器监听、远程 API、遥测。
//
// Wave 2（§4.1 host 单 owner）：生产只 manage 一套 launch 状态——
// `Arc<LifecycleRuntime>`（内含 Arc<LaunchCoordinator>）。native source
// （cold argv / RunEvent::Opened / single-instance / Reopen / 菜单）全部经
// runtime ingest；不再运行旧 LaunchIntentStore 与全局 launch 广播。

pub mod file;
pub mod ipc;
pub mod lifecycle;
pub mod menu;
pub mod perf;
pub mod shortcuts;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use file::{FileLifecycleService, SystemClock};
use ipc::TauriHostEffectSink;
use lifecycle::close::{CloseDecision, CloseDisposition, CloseRequestStore, ExitGate};
use lifecycle::launch_coordinator::LaunchCoordinator;
use lifecycle::runtime::LifecycleRuntime;
use lifecycle::window_registry::WindowRegistry;
use shortcuts::GlobalShortcutState;

pub fn run() {
    // PRR-067 启动分段：组合根第一行固定进程 origin（OnceLock 首次生效；
    // 普通生产启动仅多一次静态写入，无输出、无 IPC、无行为差异）。
    perf::mark_process_start();
    // PRR-010 perf 诊断模式：仅 MINDMAP_PERF_SAMPLE=1 时激活；生产路径
    // 无此 state，全部 perf IPC 返回未启用。PRR-067：probe 构造提前到
    // 组合根最前，main-entered 分段在其余初始化之前输出。
    let perf_probe = perf::PerfProbe::from_env();
    if let Some(probe) = perf_probe.as_ref() {
        perf::emit_startup_milestone(&probe.run_id, "main-entered");
    }
    let service = Arc::new(FileLifecycleService::new());
    // 唯一生产 launch 状态：registry 先登记默认 main（Booting generation），
    // 再交给 coordinator/runtime（§5C1）。
    let mut registry = WindowRegistry::new();
    registry
        .register("main")
        .expect("冷启动 main 尚未登记（重复注册不可能）");
    let coordinator = Arc::new(LaunchCoordinator::new(registry));
    let runtime = Arc::new(LifecycleRuntime::new(
        coordinator.clone(),
        service.clone(),
        Arc::from(file::identity::platform_provider()),
        Box::new(SystemClock),
    ));
    let close_store = Arc::new(CloseRequestStore::new());

    // cold argv：进程参数即事实（在任何 drain 之前收集；setup 统一入队，
    // 第一个文件占用 main 由路由顺序保证——无 sleep/时序猜测）。
    let cold: Vec<String> = std::env::args().collect();

    let service_for_windows = service.clone();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init({
            let runtime = runtime.clone();
            move |app, argv, _cwd| {
                // warm 期第二实例 argv（Finder 双击文件 / 命令行再次启动）：
                // 有文件逐条 open，无文件恰好一个 activation（N3）。
                let sink = TauriHostEffectSink::new(app.clone());
                runtime.ingest_second_instance(&sink, &argv);
            }
        }))
        .manage(service)
        .manage(runtime.clone())
        .manage(close_store.clone())
        .manage(GlobalShortcutState::new())
        .manage(Arc::new(menu::MenuState::new()));
    // PRR-010 perf state：仅启用时注册。命令签名的 State<Arc<PerfProbe>>
    // 按 TypeId 解析——此前误把 Option<PerfProbe> 交给 manage，命令永远
    // 解析不到 state，invoke 失败被前端 catch 成"未启用"，renderer-ready
    // 静默丢失（PRR-070 真实候选实测暴露；mock 协议测试覆盖不到此接线）。
    // PRR-067：setup 分段需要 run_id，先于 move 进 manage 提取。
    let perf_setup_run_id = perf_probe.as_ref().map(|probe| probe.run_id.clone());
    if let Some(probe) = perf_probe {
        builder = builder.manage(Arc::new(probe));
    }
    builder
        .setup({
            let runtime = runtime.clone();
            move |app| {
                if let Some(run_id) = perf_setup_run_id.as_deref() {
                    perf::emit_startup_milestone(run_id, "setup-started");
                }
                // 全局热键装配（注册失败仅日志，可经设置换绑；MM-088）。
                if let Ok(config_dir) = app.path().app_config_dir() {
                    shortcuts::install(app.handle(), &config_dir);
                }
                // 应用菜单（MRT-003 X2）：macOS 默认菜单的 Quit 是 AppKit
                // PRR-065 / ADR 0012：标准 macOS 应用菜单承载全部命令
                // （Mind Map / 文件 / 编辑 predefined / 视图 / 帮助）；
                // Quit 继续走逐窗 fail-closed 关闭协议。
                menu::install_app_menu(app.handle())?;
                // cold argv 统一入队 + 首次 drain（静态 main WebView 已由
                // builder 创建；emit 未达 listener 由 ready 快照承接）。
                let sink = TauriHostEffectSink::new(app.handle().clone());
                runtime.ingest_argv(&sink, &cold);
                eprintln!(
                    "[lifecycle] setup 完成：cold argv={} 个参数",
                    cold.len() - 1
                );
                if let Some(run_id) = perf_setup_run_id.as_deref() {
                    perf::emit_startup_milestone(run_id, "setup-complete");
                }
                Ok(())
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                menu::MENU_APP_QUIT => {
                    for (_, window) in app.webview_windows() {
                        let _ = window.close(); // → CloseRequested → 三分支协议
                    }
                }
                // 菜单「新建窗口」：activation（同 Dock/图标语义；D1）。
                menu::MENU_APP_NEW_WINDOW => {
                    let sink = TauriHostEffectSink::new(app.clone());
                    if let Some(runtime) = app.try_state::<Arc<LifecycleRuntime>>() {
                        runtime.ingest_activation(&sink);
                    }
                }
                // 关闭最近聚焦窗口（⌘W）：原生 close → CloseRequested 协议。
                menu::MENU_FILE_CLOSE_WINDOW => {
                    let target = app
                        .try_state::<GlobalShortcutState>()
                        .and_then(|s| s.recent_focused_label())
                        .or_else(|| app.get_webview_window("main").map(|_| "main".to_string()));
                    match target
                        .as_deref()
                        .and_then(|label| app.get_webview_window(label))
                    {
                        Some(window) => {
                            let _ = window.close();
                        }
                        None => eprintln!("[menu] 关闭窗口：无可关闭窗口，丢弃"),
                    }
                }
                // renderer 命令：定向投递给最近聚焦且 generation 有效的窗口。
                _ => {
                    // muda 的 CheckMenuItem 会在发送事件前自动 toggle。主题/布局
                    // 是互斥选择；先恢复最近聚焦窗口的权威快照，可避免重复点击
                    // 当前项后菜单错误地变成“无选中”。renderer 执行不同选择后
                    // 会通过 platform_sync_menu_state 上报并刷新为新状态。
                    if menu::is_check_command(&id) {
                        let label = app
                            .try_state::<GlobalShortcutState>()
                            .and_then(|s| s.recent_focused_label())
                            .or_else(|| app.get_webview_window("main").map(|_| "main".to_string()));
                        if let (Some(label), Some(menu_state)) =
                            (label, app.try_state::<Arc<menu::MenuState>>())
                        {
                            menu_state.on_window_focused(&label);
                        }
                    }
                    if let Some(runtime) = app.try_state::<Arc<LifecycleRuntime>>() {
                        menu::forward_menu_command(app, &runtime, &id);
                    }
                }
            }
        })
        .on_window_event({
            let close_store = close_store.clone();
            move |window, event| {
                match event {
                    // 原生关闭（MRT-003 + Wave 2 §4.4）：host fail closed。
                    // - 有一次性 permit：消费放行；discarded 在真正放行前撤销
                    //   该窗口全部文件 capability（不写盘，Destroyed 幂等兜底）；
                    //   **放行时刻**才进入 Closing（Hold/Cancel 不标记——用户
                    //   仍可取消，closing identity 持有到 Destroyed）；
                    // - 无 permit：prevent_close，建立/复用 pending 并定向 emit
                    //   （复用时事件不重发，前端按 requestId 去重）。
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        match close_store.on_close_requested(window.label()) {
                            CloseDecision::Permit { disposition } => {
                                if disposition == CloseDisposition::Discarded {
                                    service_for_windows.revoke_window(window.label());
                                }
                                if let Some(runtime) =
                                    window.app_handle().try_state::<Arc<LifecycleRuntime>>()
                                {
                                    runtime.on_close_permitted(window.label());
                                }
                                // 不 prevent_close：放行本次原生关闭
                            }
                            CloseDecision::Hold {
                                request_id,
                                newly_created,
                            } => {
                                api.prevent_close();
                                if newly_created {
                                    ipc::emit_close_request(
                                        window.app_handle(),
                                        window.label(),
                                        &request_id,
                                    );
                                }
                            }
                        }
                    }
                    // 窗口销毁（§4.4 组合清理）：文件 capability + close state +
                    // registry/pending rebind/bootstrap 交付 + 未终态 intent 恢复
                    // + recovery 记录 + 热键目标，随后一次非轮询 drain。
                    tauri::WindowEvent::Destroyed => {
                        let label = window.label().to_string();
                        let app = window.app_handle();
                        service_for_windows.revoke_window(&label);
                        close_store.on_destroyed(&label);
                        if let Some(state) = app.try_state::<GlobalShortcutState>() {
                            state.on_window_destroyed(&label);
                        }
                        if let Some(menu_state) = app.try_state::<Arc<menu::MenuState>>() {
                            menu_state.on_window_destroyed(&label);
                        }
                        if let Some(runtime) = app.try_state::<Arc<LifecycleRuntime>>() {
                            let sink = TauriHostEffectSink::new(app.clone());
                            runtime.on_window_destroyed(&sink, &label);
                        }
                    }
                    // D4：跟踪最近一次真实 Focused 的窗口 label（多窗热键
                    // 分流目标；失焦不清除）。PRR-065：app-wide 菜单 check
                    // 状态同步跟随最近聚焦窗口的快照。
                    tauri::WindowEvent::Focused(focused) if *focused => {
                        if let Some(state) = window
                            .app_handle()
                            .try_state::<crate::shortcuts::GlobalShortcutState>()
                        {
                            state.on_focused(window.label(), *focused);
                        }
                        if let Some(menu_state) =
                            window.app_handle().try_state::<Arc<menu::MenuState>>()
                        {
                            menu_state.on_window_focused(window.label());
                        }
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 按窗 bootstrap（Wave 2 §5C3）
            ipc::platform_window_ready,
            ipc::platform_complete_window_bootstrap,
            ipc::platform_open_assigned_document,
            ipc::platform_retry_launch_intent,
            ipc::platform_dismiss_launch_intent,
            ipc::platform_launch_errors,
            ipc::platform_request_open_intent,
            ipc::platform_request_blank_window,
            // 文件能力（commit 经 runtime；export authorization 不变）
            ipc::platform_request_target_authorization,
            ipc::platform_request_unified_save_authorization,
            ipc::platform_commit_document,
            ipc::platform_commit_export,
            ipc::platform_pending_recovery,
            ipc::platform_resolve_pending_recovery,
            ipc::platform_load_preferences,
            ipc::platform_store_preferences,
            // 热键 / 原生关闭
            ipc::platform_get_global_shortcut,
            ipc::platform_set_global_shortcut,
            ipc::platform_resolve_shortcut_invocation,
            ipc::platform_pending_close_request,
            ipc::platform_resolve_close_request,
            // 菜单状态同步（PRR-065）
            ipc::platform_sync_menu_state,
            // perf 诊断（PRR-010；未启用时返回 None/错误，不影响生产）
            ipc::platform_get_perf_probe_config,
            ipc::platform_report_perf_event,
        ])
        .build(tauri::generate_context!())
        .expect("error while running mindmap desktop")
        .run({
            let close_store = close_store.clone();
            move |app, event| match event {
                // macOS：文件打开事件（Finder 双击 / 拖拽到图标 / 打开方式）。
                // 诊断日志（C1 startup barrier 事实来源）+ 唯一 ingest。
                // 平台门禁（ADR 0017）：Opened/Reopen 变体仅 macOS 存在；
                // Windows 文件关联打开走 cold argv / single-instance 路径。
                #[cfg(target_os = "macos")]
                RunEvent::Opened { urls } => {
                    let sink = TauriHostEffectSink::new(app.clone());
                    eprintln!("[lifecycle] RunEvent::Opened: {} 个 URL", urls.len());
                    for url in &urls {
                        match url.to_file_path() {
                            Ok(path) => runtime.ingest_open_path(&sink, &path),
                            Err(()) => {
                                eprintln!("[lifecycle] Opened 忽略非 file URL：{url}")
                            }
                        }
                    }
                }
                // macOS：Dock 点击 / Reopen。warm 每次恰好一个新空白
                // activation；cold main 未确认时忽略（startup barrier 承担，
                // 不多出空窗；N4）。
                #[cfg(target_os = "macos")]
                RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } => {
                    let sink = TauriHostEffectSink::new(app.clone());
                    eprintln!("[lifecycle] RunEvent::Reopen(has_visible={has_visible_windows})");
                    runtime.ingest_reopen(&sink, has_visible_windows);
                }
                // 应用退出（MRT-003 X2）：不绕过逐窗关闭协议。
                // 任一受管窗口未取得关闭许可 → 阻止退出并为未决窗口建立/复用
                // close request（定向 emit；已有请求不重发）。全部许可后放行；
                // 最后一个窗口 Destroyed 后再次 ExitRequested 自然放行。
                // 例外（PRR-010）：perf 采样进程由探针自身驱动退出（干净
                // exit code），不进入 dirty 保护——采样会话不是用户文档。
                RunEvent::ExitRequested { api, .. } => {
                    if app.try_state::<Arc<perf::PerfProbe>>().is_some() {
                        return;
                    }
                    let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
                    match close_store.on_exit_requested(&labels) {
                        ExitGate::Allow => {}
                        ExitGate::Blocked { new_requests } => {
                            api.prevent_exit();
                            for (label, request_id) in new_requests {
                                ipc::emit_close_request(app, &label, &request_id);
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
