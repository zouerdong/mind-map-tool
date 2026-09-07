//! 稳定错误（MM-060）：code 是跨平台契约（与 packages/platform/src/ipc/types.ts
//! 的 PLATFORM_ERROR_CODES 一一对应，不得重命名）；message 仅供日志。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl IpcError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for IpcError {}

/// 服务层错误：以稳定 code 携带；进入 IPC 层转为 IpcError。
#[derive(Debug, Clone)]
pub struct ServiceError(pub IpcError);

impl ServiceError {
    pub fn invalid_target_authorization(msg: impl Into<String>) -> Self {
        Self(IpcError::new("INVALID_TARGET_AUTHORIZATION", msg))
    }
    pub fn authorization_expired() -> Self {
        Self(IpcError::new(
            "TARGET_AUTHORIZATION_EXPIRED",
            "授权已过期，请重新选择目标",
        ))
    }
    pub fn authorization_consumed() -> Self {
        Self(IpcError::new(
            "TARGET_AUTHORIZATION_CONSUMED",
            "授权已被使用，请重新选择目标",
        ))
    }
    pub fn authorization_kind_mismatch(expected: &str) -> Self {
        Self(IpcError::new(
            "TARGET_AUTHORIZATION_KIND_MISMATCH",
            format!("授权种类不匹配（需要 {expected}）"),
        ))
    }
    pub fn invalid_handle(msg: impl Into<String>) -> Self {
        Self(IpcError::new("INVALID_DOCUMENT_TARGET_HANDLE", msg))
    }
    pub fn target_modified_externally() -> Self {
        Self(IpcError::new(
            "TARGET_MODIFIED_EXTERNALLY",
            "目标已被外部修改，未覆盖；请重新打开或另存",
        ))
    }
    pub fn target_appeared() -> Self {
        Self(IpcError::new(
            "TARGET_APPEARED",
            "选择时目标不存在，现在已出现；未覆盖；请重新选择",
        ))
    }
    pub fn file_io(msg: impl Into<String>) -> Self {
        Self(IpcError::new("FILE_IO_ERROR", msg))
    }
    pub fn document_too_large(bytes: u64, max: u64) -> Self {
        Self(IpcError::new(
            "DOCUMENT_TOO_LARGE",
            format!("文档大小 {bytes} bytes 超过上限 {max} bytes"),
        ))
    }
    pub fn preferences_io(msg: impl Into<String>) -> Self {
        Self(IpcError::new("PREFERENCES_IO_ERROR", msg))
    }
    pub fn preferences_corrupt(msg: impl Into<String>) -> Self {
        Self(IpcError::new("PREFERENCES_CORRUPT", msg))
    }
}

impl From<ServiceError> for IpcError {
    fn from(e: ServiceError) -> Self {
        e.0
    }
}

impl From<std::io::Error> for ServiceError {
    fn from(e: std::io::Error) -> Self {
        ServiceError::file_io(format!("io: {e}"))
    }
}

pub type ServiceResult<T> = Result<T, ServiceError>;
