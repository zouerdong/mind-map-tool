//! TargetAuthorization ledger（MM-060 步骤③）：
//! host 侧一次性选址授权。canonical path、kind、expiry、consumed、授权时刻的
//! 目标存在性/SHA-256 全部只存在 host 内存；UI 仅持有 opaque authorizationRef。
//! 消耗（consume）后不可重放；过期/错 kind/跨窗口均稳定错误码拒绝。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
        Self {
            inner: Mutex::new(HashMap::new()),
        }
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
            return Err(ServiceError::authorization_kind_mismatch(
                expected_kind.as_str(),
            ));
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
        self.inner
            .lock()
            .unwrap()
            .retain(|_, a| a.window_label != window_label);
    }

    /// B1A.4:按 plan redeem——在既有校验(expiry/未消耗)之外,还要求
    /// plan 携带的 authorization_ref / window / kind / canonical target
    /// 与 ledger 记录**完全一致**(B1A-F2:plan 不可移花接木);一次性
    /// 消耗语义与 `redeem` 相同(校验通过即标记 consumed)。任何拒绝都
    /// 不改变 ledger 其余状态。
    pub fn redeem_plan(
        &self,
        plan: &AuthorizationPlan,
        now_ms: i64,
    ) -> ServiceResult<ValidatedAuthorization> {
        let mut map = self.inner.lock().unwrap();
        let auth = map
            .get_mut(plan.authorization_ref())
            .ok_or_else(|| ServiceError::invalid_target_authorization("授权不存在或已撤销"))?;
        if auth.window_label != plan.window_label()
            || auth.kind != plan.kind()
            || auth.canonical_path != plan.canonical_target()
        {
            return Err(ServiceError::invalid_target_authorization(
                "plan 与授权绑定不一致",
            ));
        }
        if now_ms > auth.expires_at_ms {
            return Err(ServiceError::authorization_expired());
        }
        if auth.consumed {
            return Err(ServiceError::authorization_consumed());
        }
        auth.consumed = true; // 校验通过即消耗;commit 失败也不返还(防重试绕过 TOCTOU)
        Ok(ValidatedAuthorization {
            canonical_path: auth.canonical_path.clone(),
            target_existed: auth.target_existed,
            target_hash_at_grant: auth.target_hash_at_grant.clone(),
        })
    }

    /// B1.5:Save As 写前 plan——校验授权存在/归属窗口/kind/expiry/未消费,
    /// 返回 canonical target plan。**不消耗授权**(真正消耗仍在 redeem,
    /// 防止 plan 阶段失败把授权烧掉);plan 与后续 redeem 的窗口/kind 校验
    /// 一致,同一授权无法驱动两次有效 commit(redeem 单次消耗)。
    pub fn plan(
        &self,
        authorization_ref: &str,
        expected_kind: TargetKind,
        window_label: &str,
        now_ms: i64,
    ) -> ServiceResult<AuthorizationPlan> {
        let map = self.inner.lock().unwrap();
        let auth = map
            .get(authorization_ref)
            .ok_or_else(|| ServiceError::invalid_target_authorization("授权不存在或已撤销"))?;
        if auth.window_label != window_label {
            return Err(ServiceError::invalid_target_authorization(
                "授权不属于当前窗口",
            ));
        }
        if auth.kind != expected_kind {
            return Err(ServiceError::authorization_kind_mismatch(
                expected_kind.as_str(),
            ));
        }
        if now_ms > auth.expires_at_ms {
            return Err(ServiceError::authorization_expired());
        }
        if auth.consumed {
            return Err(ServiceError::authorization_consumed());
        }
        Ok(AuthorizationPlan {
            authorization_ref: authorization_ref.to_string(),
            window_label: window_label.to_string(),
            kind: auth.kind,
            canonical_target: auth.canonical_path.clone(),
        })
    }
}

/// 授权 plan(Save As 写前取得;B1.5/B1A.4):绑定授权引用/窗口/kind/
/// canonical target。**字段私有**(B1A-F2:不可外部构造或改写),只经
/// `AuthorizationLedger::plan` 产生,向 orchestration 暴露只读 getter;
/// commit 时 `redeem_plan` 逐一复核绑定字段与 ledger 完全一致。
/// plan 不消耗授权;commit 时经 redeem 原子消耗。
#[derive(Debug, Clone)]
pub struct AuthorizationPlan {
    authorization_ref: String,
    window_label: String,
    kind: TargetKind,
    canonical_target: PathBuf,
}

impl AuthorizationPlan {
    pub fn authorization_ref(&self) -> &str {
        &self.authorization_ref
    }

    pub fn window_label(&self) -> &str {
        &self.window_label
    }

    pub fn kind(&self) -> TargetKind {
        self.kind
    }

    pub fn canonical_target(&self) -> &Path {
        &self.canonical_target
    }
}

#[cfg(all(test, unix))]
mod b1a_plan_binding_tests {
    //! B1A.4 负向证明:plan 字段私有化后,在本模块内构造"绑定字段与
    //! ledger 错配"的 plan,证明 redeem_plan 的内部校验仍然存在且写前拒绝。

    use super::*;
    use crate::file::FileLifecycleService;
    use std::path::PathBuf;

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    /// AP1:plan canonical target 与 ledger 授权错配 → 写前稳定拒绝,
    /// 零 commit。(旧实现只消费 authorization_ref,忽略其余绑定字段。)
    #[test]
    fn ap1_plan_canonical_binding_mismatch_rejected_before_write() {
        let dir = tmpdir();
        let target_a = dir.join("a.mm");
        let target_b = dir.join("b.mm");
        let svc = FileLifecycleService::new();
        let grant = svc
            .grant_authorization("main", TargetKind::Document, &target_a)
            .unwrap();
        // 伪造:授权引用真实,canonical target 指向 B
        let forged = AuthorizationPlan {
            authorization_ref: grant.authorization_ref.clone(),
            window_label: "main".to_string(),
            kind: TargetKind::Document,
            canonical_target: target_b.clone(),
        };
        let err = svc
            .commit_save_as_planned("main", &forged, r#"{"v":1}"#)
            .unwrap_err();
        assert_eq!(
            err.0.code, "INVALID_TARGET_AUTHORIZATION",
            "AP1:plan 绑定错配必须写前稳定拒绝"
        );
        assert!(
            !target_a.exists() && !target_b.exists(),
            "AP1:零 commit(任何目标都不得被写)"
        );
    }

    /// AP1 附加:plan 归属窗口与 ledger 不一致 → 同样写前拒绝(不可把
    /// 他人窗口的授权 plan 移花接木到当前窗口)。
    #[test]
    fn ap1_plan_window_binding_mismatch_rejected_before_write() {
        let dir = tmpdir();
        let target_a = dir.join("a.mm");
        let svc = FileLifecycleService::new();
        let grant = svc
            .grant_authorization("main", TargetKind::Document, &target_a)
            .unwrap();
        let forged = AuthorizationPlan {
            authorization_ref: grant.authorization_ref.clone(),
            window_label: "editor-2".to_string(), // 非授权归属窗口
            kind: TargetKind::Document,
            canonical_target: target_a.clone(),
        };
        let err = svc
            .commit_save_as_planned("editor-2", &forged, r#"{"v":1}"#)
            .unwrap_err();
        assert_eq!(err.0.code, "INVALID_TARGET_AUTHORIZATION");
        assert!(!target_a.exists(), "AP1:零 commit");
    }
}
