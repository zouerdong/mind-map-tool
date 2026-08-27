//! Platform file identity（MM-060 步骤②）：
//! - VersionToken = 目标文件字节内容的 SHA-256（hex，小写）；
//! - opaque 引用 id（authorization / handle）用 UUID v4 前缀串，
//!   不可预测、进程内 ledger 查找即真伪判定。

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use super::error::{ServiceError, ServiceResult};

/// canonical path：解析 symlink/相对段；不存在则 Err（file identity 只对存在的文件）。
pub fn canonical_path(path: &Path) -> ServiceResult<PathBuf> {
    std::fs::canonicalize(path)
        .map_err(|e| ServiceError::file_io(format!("canonicalize {}: {e}", path.display())))
}

/// 读文件并计算 SHA-256 VersionToken；文件不存在 → None（调用方判定 TOCTOU）。
pub fn file_sha256(path: &Path) -> ServiceResult<Option<String>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(sha256_hex(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(ServiceError::file_io(format!("read {}: {e}", path.display()))),
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let d = h.finalize();
    let mut s = String::with_capacity(64);
    for b in d {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub fn new_authorization_ref() -> String {
    format!("auth-{}", uuid::Uuid::new_v4())
}

pub fn new_handle_id() -> String {
    format!("doc-{}", uuid::Uuid::new_v4())
}

/// 显示路径：用户可读的绝对路径字符串。
pub fn display_path(path: &Path) -> String {
    path.display().to_string()
}
