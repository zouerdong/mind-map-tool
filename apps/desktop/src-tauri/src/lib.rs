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
pub mod perf;
pub mod shortcuts;

use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager, RunEvent};

use file::{FileLifecycleService, SystemClock};
use ipc::TauriHostEffectSink;
use lifecycle::close::{CloseDecision, CloseDisposition, CloseRequestStore, ExitGate};
use lifecycle::launch_coordinator::LaunchCoordinator;
use lifecycle::runtime::LifecycleRuntime;
use lifecycle::window_registry::WindowRegistry;
use shortcuts::GlobalShortcutState;

/// 构建应用菜单：macOS 标准 app 菜单（About/Services/Hide…）+ 自定义
/// Quit（⌘Q）+「文件」子菜单（新建窗口：activation 语义，同 Dock/图标）+
/// 基础编辑菜单（预定义项，保住 WKWebView 复制/粘贴/撤销）。
/// 注意：菜单项不设 accelerator——画布内 ⌘N/⌘O 等由 renderer 键位表
/// （shortcut-table.md）派发，避免系统级抢占改变既有键位语义。
fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "app-quit", "退出 Mind Map", true, Some("CmdOrCtrl+Q"))?;
    let new_window = MenuItem::with_id(app, "app-new-window", "新建窗口", true, None::<&str>)?;
    let app_menu = SubmenuBuilder::new(app, "Mind Map")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "文件").item(&new_window).build()?;
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn run() {
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

    // PRR-010 perf 诊断模式：仅 MINDMAP_PERF_SAMPLE=1 时激活；生产路径
    // 无此 state，全部 perf IPC 返回未启用。
    let perf_probe = perf::PerfProbe::from_env();

    // cold argv：进程参数即事实（在任何 drain 之前收集；setup 统一入队，
    // 第一个文件占用 main 由路由顺序保证——无 sleep/时序猜测）。
    let cold: Vec<String> = std::env::args().collect();

    let service_for_windows = service.clone();

    tauri::Builder::default()
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
        .manage(perf_probe)
        .setup({
            let runtime = runtime.clone();
            move |app| {
                // 全局热键装配（注册失败仅日志，可经设置换绑；MM-088）。
                if let Ok(config_dir) = app.path().app_config_dir() {
                    shortcuts::install(app.handle(), &config_dir);
                }
                // 应用菜单（MRT-003 X2）：macOS 默认菜单的 Quit 是 AppKit
                // 预定义项——⌘Q 直接 terminate，绕过 CloseRequested/
                // ExitRequested，dirty 文档会被无提示杀死。替换为自定义
                // Quit 项：菜单事件逐窗 window.close()，走与红关闭按钮
                // 完全相同的 fail-closed 关闭协议。
                install_app_menu(app.handle())?;
                // cold argv 统一入队 + 首次 drain（静态 main WebView 已由
                // builder 创建；emit 未达 listener 由 ready 快照承接）。
                let sink = TauriHostEffectSink::new(app.handle().clone());
                runtime.ingest_argv(&sink, &cold);
                eprintln!(
                    "[lifecycle] setup 完成：cold argv={} 个参数",
                    cold.len() - 1
                );
                Ok(())
            }
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "app-quit" => {
                    for (_, window) in app.webview_windows() {
                        let _ = window.close(); // → CloseRequested → 三分支协议
                    }
                }
                // 菜单「新建窗口」：activation（同 Dock/图标语义；D1）。
                "app-new-window" => {
                    let sink = TauriHostEffectSink::new(app.clone());
                    if let Some(runtime) = app.try_state::<Arc<LifecycleRuntime>>() {
                        runtime.ingest_activation(&sink);
                    }
                }
                _ => {}
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
                        if let Some(runtime) = app.try_state::<Arc<LifecycleRuntime>>() {
                            let sink = TauriHostEffectSink::new(app.clone());
                            runtime.on_window_destroyed(&sink, &label);
                        }
                    }
                    // D4：跟踪最近一次真实 Focused 的窗口 label（多窗热键
                    // 分流目标；失焦不清除）。
                    tauri::WindowEvent::Focused(focused) if *focused => {
                        if let Some(state) = window
                            .app_handle()
                            .try_state::<crate::shortcuts::GlobalShortcutState>()
                        {
                            state.on_focused(window.label(), *focused);
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
