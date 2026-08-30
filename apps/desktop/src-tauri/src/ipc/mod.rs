//! IPC 命令薄壳（MM-060 步骤①）：serde 契约与 TS 侧
//! packages/platform/src/ipc/types.ts 一一对应（camelCase / kebab-case tag）。
//! 对话框等 tauri 依赖只出现在本层；语义全部在 file/lifecycle 服务层。

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::file::preferences::{PreferencesMap, PreferencesStore};
use crate::file::{FileLifecycleService, TargetKind};
use crate::lifecycle::close::{CloseDisposition, CloseRequestStore, ResolveOutcome};
use crate::lifecycle::launch::{LaunchIntentPayload, LaunchIntentStore};

pub const LAUNCH_INTENT_EVENT: &str = "platform://launch-intent";
pub const CLOSE_REQUEST_EVENT: &str = "platform://close-requested";

// ---- DTO（camelCase，与 TS 对齐） ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocumentDto {
    pub content_json: String,
    pub document_target_handle: String,
    pub version_token: String,
    pub display_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantedAuthorizationDto {
    pub authorization_ref: String,
    pub display_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitReceiptDto {
    pub document_target_handle: String,
    pub version_token: String,
    pub display_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCommitDto {
    pub display_path: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CommitDocumentPayload {
    // 变体字段与 TS camelCase 对齐：容器级 rename_all 只作用于 tag（变体名），
    // 字段需逐变体声明（此前 snake 字段与 TS 不符，真实提交自 MM-060 起从未
    // 反序列化成功——被对话框死锁与 State 类型两层既有缺陷先后掩盖）。
    #[serde(rename_all = "camelCase")]
    Ordinary {
        document_target_handle: String,
        expected_version_token: String,
        content_json: String,
    },
    #[serde(rename_all = "camelCase")]
    SaveAs {
        authorization_ref: String,
        content_json: String,
    },
}

/// close-requested 事件 payload（camelCase，与 TS CloseRequestPayload 对齐）。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequestDto {
    pub request_id: String,
}

// ---- 命令 ----

#[tauri::command]
pub fn platform_app_ready(
    intents: State<'_, std::sync::Arc<LaunchIntentStore>>,
) -> Result<Vec<LaunchIntentPayload>, crate::file::error::IpcError> {
    Ok(intents.snapshot_unacked())
}

#[tauri::command]
pub fn platform_ack_launch_intent(
    intents: State<'_, std::sync::Arc<LaunchIntentStore>>,
    intent_id: String,
) -> Result<(), crate::file::error::IpcError> {
    intents.ack(&intent_id);
    Ok(())
}

/// 打开文档：原生 open 对话框（无扩展名过滤——扩展名是 G2 前用户确认门槛）
/// → 读文件 → 签发 handle + VersionToken。取消返回 null。
/// async command：blocking 对话框必须在非主线程调用（同步命令在主线程
/// 跑，rfd blocking API 会与面板 run loop 互相等待死锁——真实 app 的
/// 对话框自 MM-060 起从未打开过，2026-08-30 MRT-003 实测确认）。
#[tauri::command]
pub async fn platform_open_document(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, std::sync::Arc<FileLifecycleService>>,
) -> Result<Option<OpenedDocumentDto>, crate::file::error::IpcError> {
    let Some(picked) = app.dialog().file().blocking_pick_file() else {
        return Ok(None); // 用户取消不是错误
    };
    let path = picked.into_path().map_err(|e| {
        crate::file::error::IpcError::new("FILE_IO_ERROR", format!("所选路径不可用：{e}"))
    })?;
    Ok(Some(open_path_and_issue(&window, &service, &path)?))
}

/// 按路径打开（launch intent / argv 文件加载，无对话框；MM-080 消费）。
#[tauri::command]
pub fn platform_open_path(
    window: WebviewWindow,
    service: State<'_, std::sync::Arc<FileLifecycleService>>,
    path: String,
) -> Result<OpenedDocumentDto, crate::file::error::IpcError> {
    open_path_and_issue(&window, &service, std::path::Path::new(&path))
}

fn open_path_and_issue(
    window: &WebviewWindow,
    service: &State<'_, std::sync::Arc<FileLifecycleService>>,
    path: &std::path::Path,
) -> Result<OpenedDocumentDto, crate::file::error::IpcError> {
    let outcome = service.open_file(window.label(), path)?;
    Ok(OpenedDocumentDto {
        content_json: outcome.content_json,
        document_target_handle: outcome.document_target_handle,
        version_token: outcome.version_token,
        display_path: outcome.display_path,
    })
}

/// 一次性选址授权：原生 save 对话框（建议名由调用方给出，含扩展名——
/// 扩展名决定权在产品层，host 不做扩展名策略）。
/// async command（同上：blocking 对话框不得在主线程）。
#[tauri::command]
pub async fn platform_request_target_authorization(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, std::sync::Arc<FileLifecycleService>>,
    kind: String,
    suggested_name: String,
) -> Result<Option<GrantedAuthorizationDto>, crate::file::error::IpcError> {
    let kind = match kind.as_str() {
        "document" => TargetKind::Document,
        "export" => TargetKind::Export,
        other => {
            return Err(crate::file::error::IpcError::new(
                "INVALID_TARGET_AUTHORIZATION",
                format!("未知授权种类：{other}"),
            ))
        }
    };
    let mut builder = app.dialog().file();
    if !suggested_name.is_empty() {
        builder = builder.set_file_name(&suggested_name);
    }
    let Some(picked) = builder.blocking_save_file() else {
        return Ok(None); // 用户取消
    };
    let path = picked.into_path().map_err(|e| {
        crate::file::error::IpcError::new("FILE_IO_ERROR", format!("所选路径不可用：{e}"))
    })?;
    let grant = service.grant_authorization(window.label(), kind, &path)?;
    Ok(Some(GrantedAuthorizationDto {
        authorization_ref: grant.authorization_ref,
        display_path: grant.display_path,
    }))
}

#[tauri::command]
pub fn platform_commit_document(
    window: WebviewWindow,
    service: State<'_, std::sync::Arc<FileLifecycleService>>,
    payload: CommitDocumentPayload,
) -> Result<CommitReceiptDto, crate::file::error::IpcError> {
    let receipt = match payload {
        CommitDocumentPayload::Ordinary {
            document_target_handle,
            expected_version_token,
            content_json,
        } => service.commit_ordinary(
            window.label(),
            &document_target_handle,
            &expected_version_token,
            &content_json,
        )?,
        CommitDocumentPayload::SaveAs {
            authorization_ref,
            content_json,
        } => service.commit_save_as(window.label(), &authorization_ref, &content_json)?,
    };
    Ok(CommitReceiptDto {
        document_target_handle: receipt.document_target_handle,
        version_token: receipt.version_token,
        display_path: receipt.display_path,
    })
}

#[tauri::command]
pub fn platform_commit_export(
    window: WebviewWindow,
    service: State<'_, std::sync::Arc<FileLifecycleService>>,
    authorization_ref: String,
    bytes_base64: String,
) -> Result<ExportCommitDto, crate::file::error::IpcError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.as_bytes())
        .map_err(|e| {
            crate::file::error::IpcError::new("FILE_IO_ERROR", format!("base64 解码失败：{e}"))
        })?;
    let display = service.commit_export(window.label(), &authorization_ref, &bytes)?;
    Ok(ExportCommitDto {
        display_path: display,
    })
}

#[tauri::command]
pub fn platform_load_preferences(
    app: AppHandle,
) -> Result<PreferencesMap, crate::file::error::IpcError> {
    let store = preferences_store(&app)?;
    Ok(store.load()?)
}

#[tauri::command]
pub fn platform_store_preferences(
    app: AppHandle,
    delta: PreferencesMap,
) -> Result<(), crate::file::error::IpcError> {
    let store = preferences_store(&app)?;
    store.store(&delta)?;
    Ok(())
}

fn preferences_store(app: &AppHandle) -> Result<PreferencesStore, crate::file::error::IpcError> {
    let dir = app.path().app_config_dir().map_err(|e| {
        crate::file::error::IpcError::new("PREFERENCES_IO_ERROR", format!("无法定位配置目录：{e}"))
    })?;
    Ok(PreferencesStore::new(&dir))
}

// ---- 原生关闭协议（MRT-003） ----

/// 只读快照：当前调用窗口的 pending close request（listener 竞态补偿）。
/// 调用者身份由 Tauri 注入的 WebviewWindow 决定，不接受前端自报 label。
#[tauri::command]
pub fn platform_pending_close_request(
    window: WebviewWindow,
    store: State<'_, std::sync::Arc<CloseRequestStore>>,
) -> Result<Option<CloseRequestDto>, crate::file::error::IpcError> {
    Ok(store
        .pending_request(window.label())
        .map(|request_id| CloseRequestDto { request_id }))
}

/// 应答一次 close request。Cancelled 只清 pending（窗口保持）；
/// 其余写入一次性 permit 并发起 window.close()——失败则回滚 permit、
/// 恢复 pending（窗口保持可重试，返回 WINDOW_CLOSE_FAILED）。
/// discarded 的 capability revoke 在第二次 CloseRequested 真正放行前执行（lib.rs）。
#[tauri::command]
pub fn platform_resolve_close_request(
    window: WebviewWindow,
    store: State<'_, std::sync::Arc<CloseRequestStore>>,
    request_id: String,
    disposition: String,
) -> Result<(), crate::file::error::IpcError> {
    let Some(parsed) = CloseDisposition::parse(&disposition) else {
        return Err(crate::file::error::IpcError::new(
            "INVALID_CLOSE_REQUEST",
            format!("未知处置：{disposition}"),
        ));
    };
    let outcome = store
        .resolve(window.label(), &request_id, parsed)
        .map_err(|code| {
            crate::file::error::IpcError::new(code, "关闭请求不存在、跨窗口、过期或已消费")
        })?;
    if let ResolveOutcome::PermitGranted { .. } = outcome {
        if let Err(e) = window.close() {
            store.rollback_permit(window.label()); // ★ 不留无条件放行残余
            return Err(crate::file::error::IpcError::new(
                "WINDOW_CLOSE_FAILED",
                format!("发起关闭失败：{e}"),
            ));
        }
    }
    Ok(())
}

// ---- 全局热键（MM-088） ----

#[tauri::command]
pub fn platform_get_global_shortcut(
    app: AppHandle,
) -> Result<GlobalShortcutInfo, crate::file::error::IpcError> {
    Ok(GlobalShortcutInfo {
        accelerator: crate::shortcuts::current(&app).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn platform_set_global_shortcut(
    app: AppHandle,
    accelerator: String,
) -> Result<GlobalShortcutInfo, crate::file::error::IpcError> {
    let dir = app.path().app_config_dir().map_err(|e| {
        crate::file::error::IpcError::new("PREFERENCES_IO_ERROR", format!("无法定位配置目录：{e}"))
    })?;
    crate::shortcuts::rebind(&app, &dir, &accelerator)?;
    Ok(GlobalShortcutInfo { accelerator })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutInfo {
    pub accelerator: String,
}

/// warm 期新 intent 到达：入队并广播给前端（early intents 走 app_ready 快照）。
pub fn emit_launch_intent(app: &AppHandle, payload: &LaunchIntentPayload) {
    if let Err(e) = app.emit(LAUNCH_INTENT_EVENT, payload) {
        eprintln!("[lifecycle] emit launch-intent 失败：{e}");
    }
}

/// 定向 emit close-requested：只发给目标窗口，不得全局广播
/// （其他窗口不得收到同一关闭请求；MRT-004 多窗口同样依赖此语义）。
pub fn emit_close_request(app: &AppHandle, window_label: &str, request_id: &str) {
    let payload = CloseRequestDto {
        request_id: request_id.to_string(),
    };
    let target = EventTarget::WebviewWindow {
        label: window_label.to_string(),
    };
    if let Err(e) = app.emit_to(target, CLOSE_REQUEST_EVENT, payload) {
        eprintln!("[lifecycle] emit close-requested 到 {window_label} 失败：{e}");
    }
}
