//! IPC 命令薄壳（MM-060 步骤①）：serde 契约与 TS 侧
//! packages/platform/src/ipc/types.ts 一一对应（camelCase / kebab-case tag）。
//! 对话框等 tauri 依赖只出现在本层；语义全部在 file/lifecycle 服务层。

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::file::preferences::{PreferencesMap, PreferencesStore};
use crate::file::{FileLifecycleService, TargetKind};
use crate::lifecycle::launch::{LaunchIntentPayload, LaunchIntentStore};

pub const LAUNCH_INTENT_EVENT: &str = "platform://launch-intent";

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
    Ordinary {
        document_target_handle: String,
        expected_version_token: String,
        content_json: String,
    },
    SaveAs {
        authorization_ref: String,
        content_json: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAuthorizationRequest {
    pub kind: String, // "document" | "export"
    pub suggested_name: String,
}

// ---- 命令 ----

#[tauri::command]
pub fn platform_app_ready(
    intents: State<'_, LaunchIntentStore>,
) -> Result<Vec<LaunchIntentPayload>, crate::file::error::IpcError> {
    Ok(intents.snapshot_unacked())
}

#[tauri::command]
pub fn platform_ack_launch_intent(
    intents: State<'_, LaunchIntentStore>,
    intent_id: String,
) -> Result<(), crate::file::error::IpcError> {
    intents.ack(&intent_id);
    Ok(())
}

/// 打开文档：原生 open 对话框（无扩展名过滤——扩展名是 G2 前用户确认门槛）
/// → 读文件 → 签发 handle + VersionToken。取消返回 null。
#[tauri::command]
pub fn platform_open_document(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, FileLifecycleService>,
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
    service: State<'_, FileLifecycleService>,
    path: String,
) -> Result<OpenedDocumentDto, crate::file::error::IpcError> {
    open_path_and_issue(&window, &service, std::path::Path::new(&path))
}

fn open_path_and_issue(
    window: &WebviewWindow,
    service: &State<'_, FileLifecycleService>,
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
#[tauri::command]
pub fn platform_request_target_authorization(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, FileLifecycleService>,
    request: TargetAuthorizationRequest,
) -> Result<Option<GrantedAuthorizationDto>, crate::file::error::IpcError> {
    let kind = match request.kind.as_str() {
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
    if !request.suggested_name.is_empty() {
        builder = builder.set_file_name(&request.suggested_name);
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
    service: State<'_, FileLifecycleService>,
    payload: CommitDocumentPayload,
) -> Result<CommitReceiptDto, crate::file::error::IpcError> {
    let receipt = match payload {
        CommitDocumentPayload::Ordinary { document_target_handle, expected_version_token, content_json } => {
            service.commit_ordinary(
                window.label(),
                &document_target_handle,
                &expected_version_token,
                &content_json,
            )?
        }
        CommitDocumentPayload::SaveAs { authorization_ref, content_json } => {
            service.commit_save_as(window.label(), &authorization_ref, &content_json)?
        }
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
    service: State<'_, FileLifecycleService>,
    authorization_ref: String,
    bytes_base64: String,
) -> Result<ExportCommitDto, crate::file::error::IpcError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.as_bytes())
        .map_err(|e| crate::file::error::IpcError::new("FILE_IO_ERROR", format!("base64 解码失败：{e}")))?;
    let display = service.commit_export(window.label(), &authorization_ref, &bytes)?;
    Ok(ExportCommitDto { display_path: display })
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
