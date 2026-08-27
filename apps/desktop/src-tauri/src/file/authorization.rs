//! TargetAuthorization ledger（MM-060 步骤③）：
//! host 侧一次性选址授权。canonical path、kind、expiry、consumed、授权时刻的
//! 目标存在性/SHA-256 全部只存在 host 内存；UI 仅持有 opaque authorizationRef。
//! 消耗（consume）后不可重放；过期/错 kind/跨窗口均稳定错误码拒绝。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use super::error::{ServiceError, ServiceResult};
use super::identity;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    Document,
    Export,
}

impl TargetKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TargetKind::Document => "document",
            TargetKind::Export => "export",
        }
    }
}

#[derive(Debug)]
pub struct TargetAuthorization {
    pub kind: TargetKind,
    pub canonical_path: PathBuf,
    /// 授权（对话框确认）时刻目标是否存在。
    pub target_existed: bool,
    /// 存在时的 SHA-256（TOCTOU 复核基准）。
    pub target_hash_at_grant: Option<String>,
    pub granted_at_ms: i64,
    pub expires_at_ms: i64,
    pub consumed: bool,
    /// 签发窗口；跨窗口使用被拒绝。
    pub window_label: String,
}

#[derive(Default)]
pub struct AuthorizationLedger {
    inner: Mutex<HashMap<String, TargetAuthorization>>,
}

/// 校验通过的授权（已从 ledger 视角确认），供 commit 流程使用。
pub struct ValidatedAuthorization {
    pub canonical_path: PathBuf,
    pub target_existed: bool,
    pub target_hash_at_grant: Option<String>,
}

impl AuthorizationLedger {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    /// 签发授权：记录授权时刻的目标状态；TTL 由调用方（时钟注入）决定。
    #[allow(clippy::too_many_arguments)]
    pub fn grant(
        &self,
        kind: TargetKind,
        canonical_path: PathBuf,
        target_existed: bool,
        target_hash_at_grant: Option<String>,
        granted_at_ms: i64,
        ttl_ms: i64,
        window_label: &str,
    ) -> String {
        let id = identity::new_authorization_ref();
        let auth = TargetAuthorization {
            kind,
            canonical_path,
            target_existed,
            target_hash_at_grant,
            granted_at_ms,
            expires_at_ms: granted_at_ms + ttl_ms,
            consumed: false,
            window_label: window_label.to_string(),
        };
        self.inner.lock().unwrap().insert(id.clone(), auth);
        id
    }

    /// 校验并原子标记 consumed；任何拒绝都不改变 ledger 其余状态。
    pub fn redeem(
        &self,
        authorization_ref: &str,
        expected_kind: TargetKind,
        window_label: &str,
        now_ms: i64,
    ) -> ServiceResult<ValidatedAuthorization> {
        let mut map = self.inner.lock().unwrap();
        let auth = map
            .get_mut(authorization_ref)
            .ok_or_else(|| ServiceError::invalid_target_authorization("授权不存在或已撤销"))?;
        if auth.window_label != window_label {
            return Err(ServiceError::invalid_target_authorization(
                "授权不属于当前窗口",
            ));
        }
        if auth.kind != expected_kind {
            return Err(ServiceError::authorization_kind_mismatch(expected_kind.as_str()));
        }
        if now_ms > auth.expires_at_ms {
            return Err(ServiceError::authorization_expired());
        }
        if auth.consumed {
            return Err(ServiceError::authorization_consumed());
        }
        auth.consumed = true; // 校验通过即消耗；commit 失败也不返还（防重试绕过 TOCTOU）
        Ok(ValidatedAuthorization {
            canonical_path: auth.canonical_path.clone(),
            target_existed: auth.target_existed,
            target_hash_at_grant: auth.target_hash_at_grant.clone(),
        })
    }

    /// 撤销某窗口全部授权（窗口关闭）。
    pub fn revoke_window(&self, window_label: &str) {
        self.inner.lock().unwrap().retain(|_, a| a.window_label != window_label);
    }
}
