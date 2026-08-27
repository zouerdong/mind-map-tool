// @mindmap/platform — 平台适配层（MM-060）。
// 禁止依赖：React / React Flow / DOM（check-boundaries 强制）。
// 组成：
// - ipc/            TS↔Rust 命令/事件/稳定错误码契约
// - file/           FilePort（open/授权/ordinary/save-as/export 提交）+ Tauri adapter
// - lifecycle/      LaunchRouter 状态机 + Tauri 装配（AppReady/ack 协议）
// - preferences/    偏好 port + Tauri adapter
// Windows 适配器在本包内预留 port 结构（PRD §1.1 移植就绪约束）；
// 平台差异说明见 docs/quality/evidence/mm-060-*.json 与包 README。

export const PLATFORM_PACKAGE_VERSION = "0.1.0-mm060";

// IPC 契约
export * from "./ipc/types.js";
export { PlatformError, toPlatformError } from "./file/errors.js";

// 文件能力
export type {
  CommitDocumentOrdinaryRequest,
  CommitDocumentRequest,
  CommitDocumentSaveAsRequest,
  DocumentTargetHandle,
  FilePort,
  OpenedDocument,
  TargetAuthorizationRef,
  VersionToken,
} from "./file/types.js";
export {
  asDocumentTargetHandle,
  asTargetAuthorizationRef,
  asVersionToken,
} from "./file/types.js";
export { TauriFileAdapter } from "./file/tauri-file-adapter.js";

// 生命周期
export {
  decideWindowAction,
  intentDedupeKey,
  LaunchRouter,
} from "./lifecycle/launch-router.js";
export type {
  LaunchActionHandler,
} from "./lifecycle/tauri-adapter.js";
export { TauriLifecycleAdapter } from "./lifecycle/tauri-adapter.js";
export type { WindowAction, WindowContext } from "./lifecycle/launch-router.js";

// 偏好
export type { PreferencesPort, PreferencesSnapshot, PreferenceValue } from "./preferences/types.js";
export { TauriPreferencesAdapter } from "./preferences/tauri-adapter.js";
