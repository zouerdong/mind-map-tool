// Tauri host 层（MM-020 骨架 → MM-060 文件/生命周期装配）。
// 模块：
// - file/      commit protocol、TargetAuthorization ledger、DocumentTargetHandle、偏好
// - lifecycle/ LaunchIntent 队列（cold argv / open-file / second-instance / activation）
// - ipc/       命令薄壳（serde 契约与 packages/platform/src/ipc/types.ts 对齐）
// 禁止：服务器监听、远程 API、遥测。

pub mod file;
pub mod ipc;
pub mod lifecycle;
pub mod shortcuts;

use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager, RunEvent};

use file::{FileLifecycleService, SystemClock};
use lifecycle::close::{CloseDecision, CloseDisposition, CloseRequestStore, ExitGate};
use lifecycle::launch::LaunchIntentStore;
use shortcuts::GlobalShortcutState;

/// LaunchIntent 事件源 → 队列 → （warm 期）广播前端。
fn ingest_open_file(app: &AppHandle, store: &LaunchIntentStore, path: &std::path::Path) {
    if let Some(intent) = store.ingest_open_file(path) {
        ipc::emit_launch_intent(app, &intent.to_payload());
    }
}

fn ingest_activation(app: &AppHandle, store: &LaunchIntentStore) {
    if let Some(intent) = store.ingest_activation() {
        ipc::emit_launch_intent(app, &intent.to_payload());
    }
}

/// argv 中提取候选文件路径（cold start 与 second-instance 共用）。
fn ingest_argv(app: &AppHandle, store: &LaunchIntentStore, argv: &[String]) {
    for arg in argv.iter().skip(1) {
        let path = std::path::PathBuf::from(arg);
        ingest_open_file(app, store, &path);
    }
}

/// 构建应用菜单：macOS 标准 app 菜单（About/Services/Hide…）+ 自定义
/// Quit（⌘Q）+ 基础编辑菜单（预定义项，保住 WKWebView 复制/粘贴/撤销）。
fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "app-quit", "退出 Mind Map", true, Some("CmdOrCtrl+Q"))?;
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
        .items(&[&app_menu, &edit_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn run() {
    let service = Arc::new(FileLifecycleService::new());
    let intents = Arc::new(LaunchIntentStore::new(Box::new(SystemClock)));
    let close_store = Arc::new(CloseRequestStore::new());

    // cold start argv：前端未就绪，只入队（app_ready 快照投递）。
    let cold: Vec<String> = std::env::args().collect();
    for arg in cold.iter().skip(1) {
        intents.ingest_open_file(&std::path::PathBuf::from(arg));
    }

    let service_for_windows = service.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init({
            let intents = intents.clone();
            move |app, argv, _cwd| {
                // warm 期第二实例 argv（Finder 双击文件 / 命令行再次启动）。
                ingest_argv(app, &intents, &argv);
            }
        }))
        .manage(service)
        .manage(intents.clone())
        .manage(close_store.clone())
        .manage(GlobalShortcutState::new())
        .setup({
            let intents = intents.clone();
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
                let _ = &intents;
                Ok(())
            }
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "app-quit" {
                for (_, window) in app.webview_windows() {
                    let _ = window.close(); // → CloseRequested → 三分支协议
                }
            }
        })
        .on_window_event({
            let close_store = close_store.clone();
            move |window, event| {
                match event {
                    // 原生关闭（MRT-003）：host fail closed。
                    // - 有一次性 permit：消费放行；discarded 在真正放行前撤销
                    //   该窗口全部文件 capability（不写盘，Destroyed 幂等兜底）；
                    // - 无 permit：prevent_close，建立/复用 pending 并定向 emit
                    //   （复用时事件不重发，前端按 requestId 去重）。
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        match close_store.on_close_requested(window.label()) {
                            CloseDecision::Permit { disposition } => {
                                if disposition == CloseDisposition::Discarded {
                                    service_for_windows.revoke_window(window.label());
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
                    // 窗口销毁：撤销其全部授权与句柄（步骤⑤：跨窗口/撤销后 handle 拒绝）
                    // + 关闭状态幂等清理（MRT-003 R5）。
                    tauri::WindowEvent::Destroyed => {
                        service_for_windows.revoke_window(window.label());
                        close_store.on_destroyed(window.label());
                    }
                    // MM-090-D6：is_focused() 在 macOS 不可靠——事件跟踪供热键分流。
                    tauri::WindowEvent::Focused(focused) => {
                        if let Some(state) = window
                            .app_handle()
                            .try_state::<crate::shortcuts::GlobalShortcutState>()
                        {
                            state
                                .focused
                                .store(*focused, std::sync::atomic::Ordering::SeqCst);
                        }
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ipc::platform_app_ready,
            ipc::platform_ack_launch_intent,
            ipc::platform_open_document,
            ipc::platform_open_path,
            ipc::platform_request_target_authorization,
            ipc::platform_commit_document,
            ipc::platform_commit_export,
            ipc::platform_load_preferences,
            ipc::platform_store_preferences,
            ipc::platform_get_global_shortcut,
            ipc::platform_set_global_shortcut,
            ipc::platform_pending_close_request,
            ipc::platform_resolve_close_request,
        ])
        .build(tauri::generate_context!())
        .expect("error while running mindmap desktop")
        .run({
            let close_store = close_store.clone();
            move |app, event| match event {
                // macOS：文件打开事件（Finder 双击 / 拖拽到图标）。
                RunEvent::Opened { urls } => {
                    for url in &urls {
                        if let Ok(path) = url.to_file_path() {
                            ingest_open_file(app, &intents, &path);
                        }
                    }
                }
                // macOS：Dock 点击 / Reopen（无可见窗口时视为 activation）。
                RunEvent::Reopen {
                    has_visible_windows: false,
                    ..
                } => {
                    ingest_activation(app, &intents);
                }
                // 应用退出（MRT-003 X2）：不绕过逐窗关闭协议。
                // 任一受管窗口未取得关闭许可 → 阻止退出并为未决窗口建立/复用
                // close request（定向 emit；已有请求不重发）。全部许可后放行；
                // 最后一个窗口 Destroyed 后再次 ExitRequested 自然放行。
                RunEvent::ExitRequested { api, .. } => {
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
