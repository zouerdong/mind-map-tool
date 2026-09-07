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
  // host 有界读取拒绝超出 50MB 的文档
  "DOCUMENT_TOO_LARGE",
  // 偏好读写失败
  "PREFERENCES_IO_ERROR",
  // 偏好 JSON 结构损坏；应用可回退默认值并在下一次写入时修复
  "PREFERENCES_CORRUPT",
  // 全局热键（MM-088）：被其他应用占用 / 格式无法解析
  "GLOBAL_SHORTCUT_CONFLICT",
  "GLOBAL_SHORTCUT_INVALID",
  "GLOBAL_SHORTCUT_ROLLBACK_FAILED",
  // 原生关闭协议（MRT-003）
  "INVALID_CLOSE_REQUEST",
  "WINDOW_CLOSE_FAILED",
  // 窗口启动协议（MRT-004 Wave 2）：交付不存在/跨窗口/过期/已完成
  "STALE_BOOTSTRAP_COMPLETION",
  // retry/dismiss 只允许当前可见错误上的意图（Wave 2 §5D2）
  "INVALID_INTENT_ACTION",
  // post-commit recovery 未完成时阻止同窗再次保存（Wave 2 §4.3）
  "RECOVERY_PENDING",
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

/** Rust 命令层返回的结构化错误；TS 侧解析为 PlatformError。 */
export interface PlatformIpcError {
  code: PlatformErrorCode;
  message: string;
}

/** 命令名与 Rust `#[tauri::command]` 注册名一致（snake_case）。 */
export const IPC_COMMANDS = {
  // 按窗 bootstrap（MRT-004 Wave 2 §5C3；caller label 由 host 注入）
  windowReady: "platform_window_ready",
  completeWindowBootstrap: "platform_complete_window_bootstrap",
  openAssignedDocument: "platform_open_assigned_document",
  retryLaunchIntent: "platform_retry_launch_intent",
  dismissLaunchIntent: "platform_dismiss_launch_intent",
  launchErrors: "platform_launch_errors",
  requestOpenIntent: "platform_request_open_intent",
  requestBlankWindow: "platform_request_blank_window",
  pendingRecovery: "platform_pending_recovery",
  resolvePendingRecovery: "platform_resolve_pending_recovery",
  // 文件能力（commit 经 host runtime，Wave 2 §4.3）
  requestTargetAuthorization: "platform_request_target_authorization",
  commitDocument: "platform_commit_document",
  commitExport: "platform_commit_export",
  loadPreferences: "platform_load_preferences",
  storePreferences: "platform_store_preferences",
  getGlobalShortcut: "platform_get_global_shortcut",
  setGlobalShortcut: "platform_set_global_shortcut",
  pendingCloseRequest: "platform_pending_close_request",
  resolveCloseRequest: "platform_resolve_close_request",
} as const;

/** Rust → 前端事件（Tauri event；均为定向 emit，不全局广播）。 */
export const IPC_EVENTS = {
  /** 定向给本窗口的 bootstrap 交付；payload 为 WindowBootstrap。 */
  windowBootstrap: "platform://window-bootstrap",
  /** 定向给呈现窗口的 retryable launch 错误；payload 见 LaunchRetryableErrorEvent。 */
  launchRetryableError: "platform://launch-retryable-error",
  /** host 发起原生关闭请求（定向窗口）；payload 为 CloseRequestPayload。 */
  closeRequested: "platform://close-requested",
} as const;

// ---- 命令 payload / 返回类型（与 Rust ipc/mod.rs 的 serde 结构一一对应） ----

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
  /**
   * Wave 2 §4.3：bytes 已落盘时 receipt 真实有效。
   * - "finalized"：registry 换绑/刷新完成；
   * - "recovery-pending"：已提交但 host 恢复未完成——不得显示为普通
   *   保存失败；该窗口再次保存会被 RECOVERY_PENDING 拒绝直至恢复完成。
   */
  rebindState: "finalized" | "recovery-pending";
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

// ---- 按窗 bootstrap / retryable 错误 / recovery（MRT-004 Wave 2） ----

/** platform_open_assigned_document 的返回（host 从 delivery 绑定目标读取）。 */
export interface OpenedDocumentIpc {
  contentJson: string;
  documentTargetHandle: string;
  versionToken: string;
  displayPath: string;
}

/** `platform://launch-retryable-error` 事件 payload（定向呈现窗口）。 */
export interface LaunchRetryableErrorEvent {
  intentId: string;
  reason: string;
}

/** platform_launch_errors 的返回条目（host 可查询错误快照）。
 * W2R-F1：快照已按 caller 呈现所有权过滤——本窗口只能看到"呈现窗口
 * 是自己且 generation 匹配"的错误；以下呈现/origin 字段为 host 绑定
 * 事实的可见投影（只读诊断），不构成任何动作参数（retry/dismiss 的
 * caller 由 host 侧 WebviewWindow 注入）。 */
export interface LaunchRetryableError {
  intentId: string;
  reason: string;
  kind: "open-file" | "activation" | "source" | "unknown";
  receivedAt: number;
  /** 呈现窗口 label（唯一拥有者；null = host-only 未呈现）。 */
  presentationWindowLabel: string | null;
  /** 呈现绑定时的窗口 generation（诊断投影）。 */
  presentationWindowGeneration: number;
  /** origin Failed 窗口（该错误由哪个窗口的 bootstrap 失败产生）。 */
  originFailedWindowLabel: string | null;
}

/** platform_pending_recovery 的返回（renderer 可见投影；无 token/canonical）。 */
export interface PendingRecovery {
  displayPath: string;
  cause: string;
}

// ---- 原生关闭协议（MRT-003 / CR-003） ----

/**
 * 前端对一次 close request 的处置。
 * - clean：session clean 且无 pending save，直接放行
 * - saved：真实保存成功且 session 已 clean 后放行
 * - discarded：不写盘丢弃（host 在真正放行前撤销该窗口 capability）
 * - cancelled：取消本次关闭（零副作用）
 */
export type CloseDisposition = "clean" | "saved" | "discarded" | "cancelled";

/** close-requested 事件与 pending 快照共用的 payload。 */
export interface CloseRequestPayload {
  requestId: string;
}

/** platform_pending_close_request 的返回；无活动请求时为 null。 */
export type PendingCloseRequest = CloseRequestPayload | null;
