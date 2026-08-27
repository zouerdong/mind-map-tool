// Tauri host 层（MM-020 骨架 → MM-060 文件/生命周期装配）。
// 模块：
// - file/      commit protocol、TargetAuthorization ledger、DocumentTargetHandle、偏好
// - lifecycle/ LaunchIntent 队列（cold argv / open-file / second-instance / activation）
// - ipc/       命令薄壳（serde 契约与 packages/platform/src/ipc/types.ts 对齐）
// 禁止：服务器监听、远程 API、遥测。

pub mod file;
pub mod ipc;
pub mod lifecycle;

use std::sync::Arc;

use tauri::{AppHandle, RunEvent};

use file::{FileLifecycleService, SystemClock};
use lifecycle::launch::LaunchIntentStore;

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

pub fn run() {
    let service = Arc::new(FileLifecycleService::new());
    let intents = Arc::new(LaunchIntentStore::new(Box::new(SystemClock)));

    // cold start argv：前端未就绪，只入队（app_ready 快照投递）。
    let cold: Vec<String> = std::env::args().collect();
    for arg in cold.iter().skip(1) {
        intents.ingest_open_file(&std::path::PathBuf::from(arg));
    }

    let service_for_windows = service.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init({
            let intents = intents.clone();
            move |app, argv, _cwd| {
                // warm 期第二实例 argv（Finder 双击文件 / 命令行再次启动）。
                ingest_argv(app, &intents, &argv);
            }
        }))
        .manage(service)
        .manage(intents.clone())
        .on_window_event(move |window, event| {
            // 窗口销毁：撤销其全部授权与句柄（步骤⑤：跨窗口/撤销后 handle 拒绝）。
            if matches!(event, tauri::WindowEvent::Destroyed) {
                service_for_windows.revoke_window(window.label());
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
        ])
        .build(tauri::generate_context!())
        .expect("error while running mindmap desktop")
        .run(move |app, event| match event {
            // macOS：文件打开事件（Finder 双击 / 拖拽到图标）。
            RunEvent::Opened { urls } => {
                for url in &urls {
                    if let Ok(path) = url.to_file_path() {
                        ingest_open_file(app, &intents, &path);
                    }
                }
            }
            // macOS：Dock 点击 / Reopen（无可见窗口时视为 activation）。
            RunEvent::Reopen { has_visible_windows: false, .. } => {
                ingest_activation(app, &intents);
            }
            _ => {}
        });
}
