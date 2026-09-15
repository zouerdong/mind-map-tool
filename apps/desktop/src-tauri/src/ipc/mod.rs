//! IPC 命令薄壳（MM-060 → MRT-004 Wave 2）：serde 契约与 TS 侧
//! packages/platform/src/ipc/types.ts 一一对应（camelCase / kebab-case tag）。
//! 对话框等 tauri 依赖只出现在本层；语义全部在 file/lifecycle 服务层。
//!
//! Wave 2 变更（任务卡 §5C3）：
//! - 新增按窗 bootstrap 命令（caller label 由 WebviewWindow 注入，不接受
//!   前端自报）与 retry/dismiss/blank-window 命令；
//! - `platform_commit_document` 改走 `LifecycleRuntime::commit_document`
//!   （B1A host outcome + registry + post-commit recovery）；
//! - 退役：`platform_app_ready`、`platform_ack_launch_intent`、
//!   `platform_open_document`、`platform_open_path` 与全局
//!   `platform://launch-intent` 广播（旧 renderer 直连 open/ack 路径）。

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::file::preferences::{PreferencesMap, PreferencesStore};
use crate::file::{FileLifecycleService, Receipt, TargetKind};
use crate::lifecycle::close::{CloseDisposition, CloseRequestStore, ResolveOutcome};
use crate::lifecycle::runtime::{
    BootstrapEvent, EmitStatus, HostEffectSink, LaunchErrorEvent, LifecycleRuntime,
};
use std::sync::Arc;

mod save_panel;

pub const WINDOW_BOOTSTRAP_EVENT: &str = "platform://window-bootstrap";
pub const LAUNCH_RETRYABLE_ERROR_EVENT: &str = "platform://launch-retryable-error";
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

/// 「存储为…」统一面板的授权返回（OFR-2026-09-15 出口合并，PRD §8.2）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedSaveGrantDto {
    pub authorization_ref: String,
    pub display_path: String,
    /// "mindmap" | "svg" | "png" | "pdf" | "graph-json"
    pub format: String,
    /// 导出格式且文档从未保存过时的兜底文档授权（同名 .mindmap）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_authorization_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_display_path: Option<String>,
}

impl UnifiedSaveGrantDto {
    fn single(format: &str, grant: crate::file::GrantOutcome) -> Self {
        Self {
            authorization_ref: grant.authorization_ref,
            display_path: grant.display_path,
            format: format.to_string(),
            backup_authorization_ref: None,
            backup_display_path: None,
        }
    }
}

/// commit 契约（Wave 2 §4.3）：bytes 已落盘时 receipt 真实有效；
/// `rebind_state` 区分 registry 换绑/刷新是否完成——`recovery-pending`
/// 不得显示为普通保存失败。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitReceiptDto {
    pub document_target_handle: String,
    pub version_token: String,
    pub display_path: String,
    /// "finalized" | "recovery-pending"
    pub rebind_state: &'static str,
}

impl CommitReceiptDto {
    pub fn finalized(receipt: Receipt) -> Self {
        Self::from_receipt(receipt, "finalized")
    }

    pub fn recovery_pending(receipt: Receipt, _cause: String) -> Self {
        Self::from_receipt(receipt, "recovery-pending")
    }

    fn from_receipt(receipt: Receipt, rebind_state: &'static str) -> Self {
        Self {
            document_target_handle: receipt.document_target_handle,
            version_token: receipt.version_token,
            display_path: receipt.display_path,
            rebind_state,
        }
    }
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

/// renderer 对一次 bootstrap 交付的终态回报（与 TS BootstrapActionOutcome
/// 一一对应；focused-existing/dismissed 属 host）。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RendererOutcomeDto {
    #[serde(rename_all = "camelCase")]
    Opened,
    #[serde(rename_all = "camelCase")]
    BlankCreated,
    #[serde(rename_all = "camelCase")]
    RetryableError { reason: String },
}

/// close-requested 事件 payload（camelCase，与 TS CloseRequestPayload 对齐）。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequestDto {
    pub request_id: String,
}

// ---- 生产 effect sink（副作用在 coordinator lock 外执行） ----

/// `HostEffectSink` 的 Tauri 实现：真实窗口创建/聚焦/定向事件。
pub struct TauriHostEffectSink {
    app: AppHandle,
}

impl TauriHostEffectSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl HostEffectSink for TauriHostEffectSink {
    /// 创建唯一 `editor-*` WebView：复用既有 app URL（devUrl/frontendDist
    /// 由 WebviewUrl::default 解析）与 main 的默认窗口几何。
    fn create_editor_window(&self, label: &str) -> Result<(), String> {
        tauri::WebviewWindowBuilder::new(&self.app, label, tauri::WebviewUrl::default())
            .title("Mind Map")
            .inner_size(1280.0, 800.0)
            .min_inner_size(640.0, 480.0)
            .build()
            .map(|_| ())
            .map_err(|e| format!("创建窗口 {label} 失败：{e}"))
    }

    fn focus_window(&self, label: &str) -> Result<(), String> {
        let window = self
            .app
            .get_webview_window(label)
            .ok_or_else(|| format!("窗口 {label} 不存在"))?;
        window
            .show()
            .map_err(|e| format!("show({label}) 失败：{e}"))?;
        window
            .unminimize()
            .map_err(|e| format!("unminimize({label}) 失败：{e}"))?;
        window
            .set_focus()
            .map_err(|e| format!("set_focus({label}) 失败：{e}"))
    }

    fn emit_bootstrap(&self, label: &str, payload: &BootstrapEvent) -> EmitStatus {
        let Some(window) = self.app.get_webview_window(label) else {
            // 冷启动静态 main 的 WebView 可能尚未创建完成：交付已持久化,
            // 由 renderer ready 快照承接(PR4),不算失败。
            return EmitStatus::WindowNotReady;
        };
        match window.emit(WINDOW_BOOTSTRAP_EVENT, payload) {
            Ok(()) => EmitStatus::Emitted,
            Err(e) => EmitStatus::Failed(format!("emit bootstrap 到 {label} 失败：{e}")),
        }
    }

    fn emit_launch_error(&self, label: &str, payload: &LaunchErrorEvent) {
        let target = EventTarget::WebviewWindow {
            label: label.to_string(),
        };
        if let Err(e) = self
            .app
            .emit_to(target, LAUNCH_RETRYABLE_ERROR_EVENT, payload)
        {
            eprintln!("[lifecycle] emit launch-retryable-error 到 {label} 失败：{e}");
        }
    }

    /// 错误呈现窗口：最近聚焦窗口优先（shortcuts 维护），其次 main，
    /// 其次任一存在窗口；找不到才放弃（不全局广播）。
    fn error_presentation_window(&self) -> Option<String> {
        if let Some(state) = self
            .app
            .try_state::<crate::shortcuts::GlobalShortcutState>()
        {
            if let Some(recent) = state.recent_focused_label() {
                if self.app.get_webview_window(&recent).is_some() {
                    return Some(recent);
                }
            }
        }
        if self.app.get_webview_window("main").is_some() {
            return Some("main".to_string());
        }
        self.app
            .webview_windows()
            .keys()
            .next()
            .map(|k| k.to_string())
    }
}

fn sink_of(app: &AppHandle) -> TauriHostEffectSink {
    TauriHostEffectSink::new(app.clone())
}

// ---- 按窗 bootstrap 命令（§5C3） ----

/// renderer 就绪：返回该窗口未完成 bootstrap 快照（listener-first 协议的
/// snapshot 腿；事件腿为定向 `platform://window-bootstrap`）。caller label
/// 由 WebviewWindow 注入。
#[tauri::command]
pub fn platform_window_ready(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
) -> Result<Vec<BootstrapEvent>, crate::file::error::IpcError> {
    Ok(runtime.window_ready(window.label()))
}

/// renderer 终态回报：校验 label + deliveryId + 窗口状态 + 当前代；
/// opened/blank-created 才 ack；retryable-error 保留错误等待用户。
#[tauri::command]
pub fn platform_complete_window_bootstrap(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
    delivery_id: String,
    outcome: RendererOutcomeDto,
) -> Result<(), crate::file::error::IpcError> {
    let outcome = match outcome {
        RendererOutcomeDto::Opened => crate::lifecycle::launch_coordinator::RendererOutcome::Opened,
        RendererOutcomeDto::BlankCreated => {
            crate::lifecycle::launch_coordinator::RendererOutcome::BlankCreated
        }
        RendererOutcomeDto::RetryableError { reason } => {
            crate::lifecycle::launch_coordinator::RendererOutcome::RetryableError { reason }
        }
    };
    let sink = sink_of(window.app_handle());
    runtime.complete_bootstrap(&sink, window.label(), &delivery_id, outcome)
}

/// 读取该交付绑定的文档（bootstrap open action 的数据源）：host 从
/// delivery 绑定目标读取，不接受 renderer path（§4.2）。
#[tauri::command]
pub fn platform_open_assigned_document(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
    delivery_id: String,
) -> Result<OpenedDocumentDto, crate::file::error::IpcError> {
    let outcome = runtime.open_assigned_document(window.label(), &delivery_id)?;
    Ok(OpenedDocumentDto {
        content_json: outcome.content_json,
        document_target_handle: outcome.document_target_handle,
        version_token: outcome.version_token,
        display_path: outcome.display_path,
    })
}

// ---- retry / dismiss / 错误快照（§5D2；W2R-F1 caller-bound） ----

/// W2R-F1：retry/dismiss/快照全部注入真实 caller `WebviewWindow`——host
/// 校验呈现所有权（caller label + generation），跨窗口动作稳定拒绝。
#[tauri::command]
pub fn platform_retry_launch_intent(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
    intent_id: String,
) -> Result<(), crate::file::error::IpcError> {
    let sink = sink_of(window.app_handle());
    runtime.retry_intent(&sink, window.label(), &intent_id)
}

#[tauri::command]
pub fn platform_dismiss_launch_intent(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
    intent_id: String,
) -> Result<(), crate::file::error::IpcError> {
    let sink = sink_of(window.app_handle());
    runtime.dismiss_intent(&sink, window.label(), &intent_id)
}

#[tauri::command]
pub fn platform_launch_errors(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
) -> Result<Vec<crate::lifecycle::runtime::LaunchErrorSnapshot>, crate::file::error::IpcError> {
    Ok(runtime.launch_errors_snapshot_for(window.label()))
}

// ---- 应用内 open/new 入口（§5C4：工具条请求 host 入队） ----

/// 工具条"打开…"：原生 open 对话框优先展示正式 `.mindmap` 文档，同时保留
/// `.json` 兼容入口；选中文件由 host 解析 identity 入队，不直接替换调用窗口 session。
/// async command：blocking 对话框必须在非主线程调用（同步命令在主线程
/// 跑，rfd blocking API 会与面板 run loop 互相等待死锁——真实 app 的
/// 对话框自 MM-060 起从未打开过，2026-08-30 MRT-003 实测确认）。
#[tauri::command]
pub async fn platform_request_open_intent(
    app: AppHandle,
    runtime: State<'_, Arc<LifecycleRuntime>>,
) -> Result<(), crate::file::error::IpcError> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Mind Map", &["mindmap", "json"])
        .blocking_pick_file()
    else {
        return Ok(()); // 用户取消不是错误
    };
    let path = picked.into_path().map_err(|e| {
        crate::file::error::IpcError::new("FILE_IO_ERROR", format!("所选路径不可用：{e}"))
    })?;
    let sink = sink_of(&app);
    runtime.ingest_open_path(&sink, &path);
    Ok(())
}

/// 应用内"新建窗口"：入队 activation（每 intent 各建一个新空白窗）。
#[tauri::command]
pub fn platform_request_blank_window(
    app: AppHandle,
    runtime: State<'_, Arc<LifecycleRuntime>>,
) -> Result<(), crate::file::error::IpcError> {
    let sink = sink_of(&app);
    runtime.ingest_activation(&sink);
    Ok(())
}

// ---- 文件命令（MM-060；commit 走 runtime，§4.3） ----

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
    // PRR-010 perf 模式：授权完全无对话框——env 指定的精确目标直接批准，
    // 其余目标一律失败（无人值守采样不得落入阻塞式 save dialog）。
    if let Some(probe) = app.try_state::<std::sync::Arc<crate::perf::PerfProbe>>() {
        let save_target = probe.save_target.clone();
        let export_target = probe.export_target.clone();
        let target = match (&kind, save_target, export_target) {
            (TargetKind::Document, Some(save_target), _)
                if probe.scenario == crate::perf::Scenario::Save =>
            {
                save_target
            }
            (TargetKind::Export, _, Some(export_target))
                if probe.scenario == crate::perf::Scenario::PngExport =>
            {
                export_target
            }
            _ => {
                return Err(crate::file::error::IpcError::new(
                    "PERF_PROBE_UNAUTHORIZED_TARGET",
                    "perf 模式只允许 env 声明的精确采样目标",
                ))
            }
        };
        let grant = service.grant_authorization(window.label(), kind, &target)?;
        return Ok(Some(GrantedAuthorizationDto {
            authorization_ref: grant.authorization_ref,
            display_path: grant.display_path,
        }));
    }
    // macOS 文档保存：自承载 NSSavePanel（OFR-2026-09-14 #3 红灯返修）。
    // rfd 在 macOS 把全部 filter 合并进 NSSavePanel allowedFileTypes，系统
    // 不显示格式 popup（2026-09-15 原生 dogfood 实证）。OFR-2026-09-15 定稿：
    // 「保存」仅 .mindmap 单一可编辑格式（无 popup）；统一「存储为…」面板
    // 见 platform_request_unified_save_authorization。导出与其他平台仍走 rfd。
    #[cfg(target_os = "macos")]
    if matches!(&kind, TargetKind::Document) {
        let parent = window.ns_window().map_err(|e| {
            crate::file::error::IpcError::new("FILE_IO_ERROR", format!("窗口句柄不可用：{e}"))
        })?;
        let Some(path) = save_panel::pick_document_save_target(&app, parent, &suggested_name)?
        else {
            return Ok(None); // 用户取消
        };
        let grant = service.grant_authorization(window.label(), kind, &path)?;
        return Ok(Some(GrantedAuthorizationDto {
            authorization_ref: grant.authorization_ref,
            display_path: grant.display_path,
        }));
    }
    let mut builder = app.dialog().file();
    if matches!(&kind, TargetKind::Document) {
        // 非 macOS（Windows 通用保存对话框原生显示 filter 下拉）：单一
        // `.mindmap` 可编辑格式（OFR-2026-09-15 定稿；既有 .json 文档打开
        // 兼容不变）。
        builder = builder.add_filter("Mind Map 文档", &["mindmap"]);
    }
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

/// 「存储为…」统一面板授权（OFR-2026-09-15 出口合并，PRD §8.2）：
/// 另存为与导出合并为单一面板——可编辑文档 .mindmap 与四格式导出产物
/// 分两组呈现。按所选格式签发对应种类的一次性授权（Document/Export）；
/// 选导出格式且文档从未保存过（document_saved=false）时，同时签发同名
/// .mindmap 的兜底文档授权，防止源文档丢失。授权 TTL 过期自然回收，
/// 取消/失败不产生半授权状态。
#[tauri::command]
pub async fn platform_request_unified_save_authorization(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, std::sync::Arc<FileLifecycleService>>,
    suggested_name: String,
    document_saved: bool,
) -> Result<Option<UnifiedSaveGrantDto>, crate::file::error::IpcError> {
    // perf 模式不走统一面板（无人值守采样只用 env 声明的精确目标）。
    if app
        .try_state::<std::sync::Arc<crate::perf::PerfProbe>>()
        .is_some()
    {
        return Err(crate::file::error::IpcError::new(
            "PERF_PROBE_UNAUTHORIZED_TARGET",
            "perf 模式不支持统一存储为面板",
        ));
    }

    /// 由（路径, 格式）组装授权 DTO；导出格式 + 未保存文档时补兜底授权。
    fn grant_for_choice(
        service: &FileLifecycleService,
        window_label: &str,
        path: std::path::PathBuf,
        format_ipc: &str,
        is_document: bool,
        document_saved: bool,
    ) -> Result<UnifiedSaveGrantDto, crate::file::error::IpcError> {
        let kind = if is_document {
            TargetKind::Document
        } else {
            TargetKind::Export
        };
        let grant = service.grant_authorization(window_label, kind, &path)?;
        let mut dto = UnifiedSaveGrantDto::single(format_ipc, grant);
        if !is_document && !document_saved {
            let mut backup = path.clone();
            backup.set_extension("mindmap");
            let backup_grant =
                service.grant_authorization(window_label, TargetKind::Document, &backup)?;
            dto.backup_authorization_ref = Some(backup_grant.authorization_ref);
            dto.backup_display_path = Some(backup_grant.display_path);
        }
        Ok(dto)
    }

    #[cfg(target_os = "macos")]
    {
        let parent = window.ns_window().map_err(|e| {
            crate::file::error::IpcError::new("FILE_IO_ERROR", format!("窗口句柄不可用：{e}"))
        })?;
        let Some(choice) = save_panel::pick_unified_save_target(
            &app,
            parent,
            &suggested_name,
            document_saved,
        )?
        else {
            return Ok(None); // 用户取消
        };
        Ok(Some(grant_for_choice(
            &service,
            window.label(),
            choice.path,
            choice.format.as_ipc_str(),
            choice.format.is_document(),
            document_saved,
        )?))
    }

    #[cfg(not(target_os = "macos"))]
    {
        // 非 macOS：rfd filter 下拉（Windows 通用对话框原生显示）；格式由
        // 最终路径扩展名推断（rfd 不报告所选 filter）。
        let mut builder = app.dialog().file();
        builder = builder
            .add_filter("Mind Map 文档", &["mindmap"])
            .add_filter("SVG", &["svg"])
            .add_filter("PNG 2x", &["png"])
            .add_filter("PDF", &["pdf"])
            .add_filter("Graph JSON", &["graph.json"]);
        if !suggested_name.is_empty() {
            builder = builder.set_file_name(&suggested_name);
        }
        let Some(picked) = builder.blocking_save_file() else {
            return Ok(None); // 用户取消
        };
        let path = picked.into_path().map_err(|e| {
            crate::file::error::IpcError::new("FILE_IO_ERROR", format!("所选路径不可用：{e}"))
        })?;
        let lower = path.to_string_lossy().to_ascii_lowercase();
        let (format_ipc, is_document) = if lower.ends_with(".svg") {
            ("svg", false)
        } else if lower.ends_with(".png") {
            ("png", false)
        } else if lower.ends_with(".pdf") {
            ("pdf", false)
        } else if lower.ends_with(".graph.json") {
            ("graph-json", false)
        } else {
            ("mindmap", true)
        };
        Ok(Some(grant_for_choice(
            &service,
            window.label(),
            path,
            format_ipc,
            is_document,
            document_saved,
        )?))
    }
}

/// 生产提交唯一入口（Wave 2）：ordinary/Save As 均经
/// `LifecycleRuntime::commit_document`（B1A host outcome + registry +
/// post-commit recovery；PostCommit 失败返回真实 receipt +
/// `recovery-pending`）。
#[tauri::command]
pub fn platform_commit_document(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
    payload: CommitDocumentPayload,
) -> Result<CommitReceiptDto, crate::file::error::IpcError> {
    runtime.commit_document(window.label(), payload)
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

// ---- post-commit recovery（§4.3） ----

/// 该窗口 pending recovery 的可见投影（无 token/canonical/capability）。
#[tauri::command]
pub fn platform_pending_recovery(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
) -> Result<Option<crate::lifecycle::runtime::PendingRecoverySnapshot>, crate::file::error::IpcError>
{
    Ok(runtime.pending_recovery(window.label()))
}

/// 一次显式、有限的恢复；成功清 record，失败保持 fail closed 并返回错误。
#[tauri::command]
pub fn platform_resolve_pending_recovery(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
) -> Result<(), crate::file::error::IpcError> {
    runtime.resolve_pending_recovery(window.label())
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

#[tauri::command]
pub fn platform_resolve_shortcut_invocation(
    app: AppHandle,
    invocation_id: String,
    window_id: String,
    generation: u64,
    had_document_focus: bool,
) -> Result<(), crate::file::error::IpcError> {
    crate::shortcuts::resolve_invocation(
        &app,
        &invocation_id,
        &window_id,
        generation,
        had_document_focus,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutInfo {
    pub accelerator: String,
}

// ---- 菜单状态同步（PRR-065 / ADR 0012；非敏感状态单向 renderer → host） ----

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSyncPayload {
    pub theme: String,
    pub organize_direction: String,
}

/// renderer 上报本窗口主题/布局方向：快照按窗口缓存；仅当该窗口为最近
/// 聚焦窗口时应用到 app-wide 菜单（多窗口隔离，聚焦切换时恢复对应快照）。
/// 非法值 fail-closed 返回错误，不落任何状态。
#[tauri::command]
pub fn platform_sync_menu_state(
    window: WebviewWindow,
    state: State<'_, std::sync::Arc<crate::menu::MenuState>>,
    payload: MenuSyncPayload,
) -> Result<(), String> {
    let sync = crate::menu::MenuWindowSync::parse(&payload.theme, &payload.organize_direction)
        .ok_or_else(|| {
            format!(
                "非法菜单状态：theme={} direction={}",
                payload.theme, payload.organize_direction
            )
        })?;
    state.sync_from_window(window.app_handle(), window.label(), sync);
    Ok(())
}

// ---- perf 诊断协议（PRR-010；仅 MINDMAP_PERF_SAMPLE=1 时存在） ----

/// renderer 查询 perf 采样配置：绑定 caller 窗口并返回 host 权威的
/// 窗口 generation。未启用时返回 None（生产路径零开销）。
#[tauri::command]
pub fn platform_get_perf_probe_config(
    window: WebviewWindow,
    runtime: State<'_, Arc<LifecycleRuntime>>,
    probe: State<'_, std::sync::Arc<crate::perf::PerfProbe>>,
) -> Result<Option<crate::perf::PerfProbeConfigDto>, crate::file::error::IpcError> {
    if !probe.bind_or_check_label(window.label()) {
        return Err(crate::file::error::IpcError::new(
            "PERF_PROBE_WINDOW_MISMATCH",
            "perf 采样已绑定到其他窗口",
        ));
    }
    let generation = runtime
        .coordinator
        .window_generation(window.label())
        .ok_or_else(|| {
            crate::file::error::IpcError::new(
                "PERF_PROBE_WINDOW_UNKNOWN",
                format!("窗口未登记：{}", window.label()),
            )
        })?;
    Ok(Some(crate::perf::PerfProbeConfigDto {
        run_id: probe.run_id.clone(),
        scenario: probe.scenario.as_str().to_string(),
        fixture_json: probe.fixture_json.clone(),
        samples: probe.samples,
        window_generation: generation,
    }))
}

/// renderer perf 事件上报（renderer-ready / scenario-result / scenario-failed）。
/// host 校验 run id + caller label + 当前 generation 后输出机器可解析 JSON。
#[tauri::command]
pub fn platform_report_perf_event(
    window: WebviewWindow,
    app: AppHandle,
    runtime: State<'_, Arc<LifecycleRuntime>>,
    payload: crate::perf::PerfEventPayload,
) -> Result<(), String> {
    let generation = runtime.coordinator.window_generation(window.label());
    crate::perf::report_perf_event(&app, window.label(), payload, generation)
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

#[cfg(test)]
mod tests {
    use super::CommitDocumentPayload;

    #[test]
    fn commit_document_payload_accepts_typescript_camel_case_fields() {
        let ordinary: CommitDocumentPayload = serde_json::from_value(serde_json::json!({
            "kind": "ordinary",
            "documentTargetHandle": "handle-1",
            "expectedVersionToken": "version-1",
            "contentJson": "{}"
        }))
        .expect("ordinary payload should deserialize from the TypeScript contract");
        assert!(matches!(
            ordinary,
            CommitDocumentPayload::Ordinary {
                document_target_handle,
                expected_version_token,
                content_json
            } if document_target_handle == "handle-1"
                && expected_version_token == "version-1"
                && content_json == "{}"
        ));

        let save_as: CommitDocumentPayload = serde_json::from_value(serde_json::json!({
            "kind": "save-as",
            "authorizationRef": "authorization-1",
            "contentJson": "{}"
        }))
        .expect("save-as payload should deserialize from the TypeScript contract");
        assert!(matches!(
            save_as,
            CommitDocumentPayload::SaveAs {
                authorization_ref,
                content_json
            } if authorization_ref == "authorization-1" && content_json == "{}"
        ));
    }

    #[test]
    fn renderer_outcome_dto_matches_typescript_discriminated_union() {
        use super::RendererOutcomeDto;
        let opened: RendererOutcomeDto = serde_json::from_value(serde_json::json!({
            "kind": "opened"
        }))
        .expect("opened outcome should deserialize");
        assert!(matches!(opened, RendererOutcomeDto::Opened));
        let retryable: RendererOutcomeDto = serde_json::from_value(serde_json::json!({
            "kind": "retryable-error",
            "reason": "decode failed"
        }))
        .expect("retryable-error outcome should deserialize");
        assert!(matches!(
            retryable,
            RendererOutcomeDto::RetryableError { reason } if reason == "decode failed"
        ));
        let blank: RendererOutcomeDto =
            serde_json::from_value(serde_json::json!({ "kind": "blank-created" }))
                .expect("blank-created outcome should deserialize");
        assert!(matches!(blank, RendererOutcomeDto::BlankCreated));
    }

    #[test]
    fn bootstrap_event_serializes_typescript_shape() {
        use super::BootstrapEvent;
        let open = BootstrapEvent::OpenPath {
            delivery_id: "delivery-1".into(),
            intent_id: "intent-1".into(),
            canonical_path: Some("/tmp/a.mm".into()),
        };
        let json = serde_json::to_value(&open).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "open-path",
                "deliveryId": "delivery-1",
                "intentId": "intent-1",
                "canonicalPath": "/tmp/a.mm"
            })
        );
        let blank = BootstrapEvent::Blank {
            delivery_id: "delivery-2".into(),
            intent_id: "intent-2".into(),
        };
        let json = serde_json::to_value(&blank).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "blank",
                "deliveryId": "delivery-2",
                "intentId": "intent-2"
            })
        );
    }
}
