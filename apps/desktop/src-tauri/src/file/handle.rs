//! DocumentTargetHandle registry（MM-060 步骤④⑤）：
//! 绑定 window/session 的 opaque 句柄。openDocument / 成功 Save As 签发；
//! ordinary Save 用 handle + expectedVersionToken 提交，不重开对话框。
//! 伪造（不在 registry）、跨窗口、窗口关闭撤销均拒绝。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use super::error::{ServiceError, ServiceResult};
use super::identity;

#[derive(Debug, Clone)]
pub struct DocumentHandleRecord {
    pub window_label: String,
    pub canonical_path: PathBuf,
}

#[derive(Default)]
pub struct HandleRegistry {
    inner: Mutex<HashMap<String, DocumentHandleRecord>>,
}

impl HandleRegistry {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    /// 签发新 handle（每次 open / Save As 成功各签发一个；旧的不失效，
    /// window 关闭统一撤销；ordinary 提交时以 handle 查 registry 判真伪）。
    pub fn issue(&self, window_label: &str, canonical_path: PathBuf) -> String {
        let id = identity::new_handle_id();
        self.inner.lock().unwrap().insert(
            id.clone(),
            DocumentHandleRecord { window_label: window_label.to_string(), canonical_path },
        );
        id
    }

    /// 校验 handle 属于当前窗口；返回其 canonical path。
    pub fn validate(&self, handle: &str, window_label: &str) -> ServiceResult<PathBuf> {
        let map = self.inner.lock().unwrap();
        let rec = map
            .get(handle)
            .ok_or_else(|| ServiceError::invalid_handle("句柄不存在或已撤销"))?;
        if rec.window_label != window_label {
            return Err(ServiceError::invalid_handle("句柄不属于当前窗口"));
        }
        Ok(rec.canonical_path.clone())
    }

    /// 撤销某窗口全部句柄（窗口关闭；session 结束随进程消亡）。
    pub fn revoke_window(&self, window_label: &str) {
        self.inner.lock().unwrap().retain(|_, r| r.window_label != window_label);
    }
}
