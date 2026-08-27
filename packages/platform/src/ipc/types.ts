// IPC 契约（MM-060）：TS 与 Rust host 共享的命令名、事件名与稳定错误码。
// 变更命令/事件/错误码属于对外契约变更，须同步 Rust 侧 ipc 模块与本文件，
// 并在 platform 差异说明中记录。
//
// 载荷编码约定：
// - 文档内容走 UTF-8 JSON 字符串（canonical JSON 本就是文本，避免二进制通道）；
// - 导出产物（SVG/PNG/PDF bytes）走 base64 字符串；
// - 字节/字符串转换只发生在 adapter，port 接口保持 Uint8Array 语义。

/** 授权/提交目标的种类：活文档 vs 导出产物（防错用彼此的授权）。 */
export type TargetKind = "document" | "export";

/** 稳定错误码（跨平台稳定字符串；拼写以任务卡为准，不得重命名）。 */
export const PLATFORM_ERROR_CODES = [
  // TargetAuthorization ledger 拒绝（任务卡点名四个）
  "INVALID_TARGET_AUTHORIZATION",
  "TARGET_AUTHORIZATION_EXPIRED",
  "TARGET_AUTHORIZATION_CONSUMED",
  "TARGET_AUTHORIZATION_KIND_MISMATCH",
  // DocumentTargetHandle 拒绝（伪造/撤销/跨窗口）
  "INVALID_DOCUMENT_TARGET_HANDLE",
  // TOCTOU / 外部修改冲突（绝不覆盖目标）
  "TARGET_MODIFIED_EXTERNALLY",
  "TARGET_APPEARED",
  // 文件读写失败（open 读失败、临时文件写失败等；目标保持原样）
  "FILE_IO_ERROR",
  // 偏好读写失败
  "PREFERENCES_IO_ERROR",
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

/** Rust 命令层返回的结构化错误；TS 侧解析为 PlatformError。 */
export interface PlatformIpcError {
  code: PlatformErrorCode;
  message: string;
}

/** 命令名与 Rust `#[tauri::command]` 注册名一致（snake_case）。 */
export const IPC_COMMANDS = {
  appReady: "platform_app_ready",
  ackLaunchIntent: "platform_ack_launch_intent",
  openDocument: "platform_open_document",
  openPath: "platform_open_path",
  requestTargetAuthorization: "platform_request_target_authorization",
  commitDocument: "platform_commit_document",
  commitExport: "platform_commit_export",
  loadPreferences: "platform_load_preferences",
  storePreferences: "platform_store_preferences",
} as const;

/** Rust → 前端事件（Tauri event）。 */
export const IPC_EVENTS = {
  /** 启动意图 flushed 到前端；payload 为 LaunchIntentPayload。 */
  launchIntent: "platform://launch-intent",
} as const;

// ---- 命令 payload / 返回类型（与 Rust ipc/mod.rs 的 serde 结构一一对应） ----

/** openDocument 的返回；用户取消对话框时为 null（取消不是错误）。 */
export interface OpenedDocumentIpc {
  contentJson: string;
  documentTargetHandle: string;
  versionToken: string;
  displayPath: string;
}

/** requestTargetAuthorization 的返回；取消对话框时为 null。 */
export interface GrantedTargetAuthorization {
  authorizationRef: string;
  displayPath: string;
}

/** commitDocument 的返回（core DocumentSession.saveCompleted 的输入）。 */
export interface CommitReceipt {
  documentTargetHandle: string;
  versionToken: string;
  displayPath: string;
}

/** commitExport 的返回。 */
export interface ExportCommitResult {
  displayPath: string;
}

/** ordinary 保存载荷：opaque handle + 期望 token，host 复核后提交。 */
export interface CommitDocumentOrdinaryPayload {
  kind: "ordinary";
  documentTargetHandle: string;
  expectedVersionToken: string;
  contentJson: string;
}

/** Save As 载荷：一次性授权引用（host ledger 持有全部细节）。 */
export interface CommitDocumentSaveAsPayload {
  kind: "save-as";
  authorizationRef: string;
  contentJson: string;
}

export type CommitDocumentPayload = CommitDocumentOrdinaryPayload | CommitDocumentSaveAsPayload;

/** LaunchIntent 事件 payload（path 已由 host canonicalize）。 */
export interface LaunchIntentPayload {
  intentId: string;
  kind: "open-file" | "activation";
  /** activation 为 null；open-file 为 canonical 绝对路径。 */
  canonicalPath: string | null;
  /** host 侧接收时刻（epoch ms）；等价路径 dedupe 的辅助键。 */
  receivedAt: number;
}
