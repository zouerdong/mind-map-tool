//! FileLifecycleService（MM-060）：文件身份、授权 ledger、句柄与提交的服务层。
//! 对话框等 tauri 依赖留在 ipc 层；本模块纯逻辑，cargo test 直接覆盖
//! 伪造/重放/过期/错 kind/跨窗口/TOCTOU/外部修改矩阵（任务卡步骤⑦）。

pub mod authorization;
pub mod commit;
pub mod error;
pub mod handle;
pub mod identity;
pub mod preferences;

use std::path::{Path, PathBuf};

use authorization::AuthorizationLedger;
use error::{ServiceError, ServiceResult};
use handle::HandleRegistry;
use identity::{canonical_path, display_path, file_sha256, sha256_hex};

pub use authorization::TargetKind;
pub use error::IpcError;

/// 授权有效期（ms）：对话框确认到 commit 的窗口期，防陈旧授权。
pub const AUTHORIZATION_TTL_MS: i64 = 10 * 60 * 1000;

/// 可注入时钟（测试用过期/重放场景）。
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }
}

#[derive(Debug)]
pub struct OpenOutcome {
    pub content_json: String,
    pub document_target_handle: String,
    pub version_token: String,
    pub display_path: String,
}

#[derive(Debug)]
pub struct GrantOutcome {
    pub authorization_ref: String,
    pub display_path: String,
}

#[derive(Debug)]
pub struct Receipt {
    pub document_target_handle: String,
    pub version_token: String,
    pub display_path: String,
}

pub struct FileLifecycleService {
    authorizations: AuthorizationLedger,
    handles: HandleRegistry,
    clock: Box<dyn Clock>,
}

impl FileLifecycleService {
    pub fn new() -> Self {
        Self { authorizations: AuthorizationLedger::new(), handles: HandleRegistry::new(), clock: Box::new(SystemClock) }
    }

    pub fn with_clock(clock: Box<dyn Clock>) -> Self {
        Self { authorizations: AuthorizationLedger::new(), handles: HandleRegistry::new(), clock }
    }

    /// openDocument：读目标 + 签发 handle + token（对话框结果由 ipc 层传入）。
    pub fn open_file(&self, window_label: &str, raw_path: &Path) -> ServiceResult<OpenOutcome> {
        let canon = canonical_path(raw_path)?;
        let bytes = std::fs::read(&canon)
            .map_err(|e| ServiceError::file_io(format!("read {}: {e}", canon.display())))?;
        let content_json = String::from_utf8(bytes).map_err(|_| {
            ServiceError::file_io(format!("{} 不是 UTF-8 文本", canon.display()))
        })?;
        let token = sha256_hex(content_json.as_bytes());
        let handle = self.handles.issue(window_label, canon.clone());
        Ok(OpenOutcome {
            content_json,
            document_target_handle: handle,
            version_token: token,
            display_path: display_path(&canon),
        })
    }

    /// 对话框确认选址后签发一次性授权（记录 TOCTOU 复核基准）。
    pub fn grant_authorization(
        &self,
        window_label: &str,
        kind: TargetKind,
        raw_path: &Path,
    ) -> ServiceResult<GrantOutcome> {
        let (canon, existed, hash_at_grant) = normalize_target(raw_path)?;
        let id = self.authorizations.grant(
            kind,
            canon.clone(),
            existed,
            hash_at_grant,
            self.clock.now_ms(),
            AUTHORIZATION_TTL_MS,
            window_label,
        );
        Ok(GrantOutcome { authorization_ref: id, display_path: display_path(&canon) })
    }

    /// ordinary Save：handle + expectedToken；host 二次验证后原子替换。
    pub fn commit_ordinary(
        &self,
        window_label: &str,
        document_target_handle: &str,
        expected_version_token: &str,
        content_json: &str,
    ) -> ServiceResult<Receipt> {
        let canon = self.handles.validate(document_target_handle, window_label)?;
        // 先复核内容（文件被外部删除/修改 → 稳定冲突码，绝不覆盖）。
        match file_sha256(&canon)? {
            Some(h) if h == expected_version_token => {}
            _ => return Err(ServiceError::target_modified_externally()),
        }
        // 再防 symlink swap：路径身份必须与签发时一致（此时文件必存在）。
        if canonical_path(&canon)? != canon {
            return Err(ServiceError::invalid_handle("目标路径已变化（疑似符号链接替换）"));
        }
        commit::atomic_replace(&canon, content_json.as_bytes())?;
        Ok(Receipt {
            document_target_handle: document_target_handle.to_string(),
            version_token: sha256_hex(content_json.as_bytes()),
            display_path: display_path(&canon),
        })
    }

    /// Save As：redeem 一次性授权 → TOCTOU 复核 → 原子替换 → 签发新 handle。
    pub fn commit_save_as(
        &self,
        window_label: &str,
        authorization_ref: &str,
        content_json: &str,
    ) -> ServiceResult<Receipt> {
        let auth = self
            .authorizations
            .redeem(authorization_ref, TargetKind::Document, window_label, self.clock.now_ms())?;
        verify_target_unchanged(&auth)?;
        commit::atomic_replace(&auth.canonical_path, content_json.as_bytes())?;
        let handle = self.handles.issue(window_label, auth.canonical_path.clone());
        Ok(Receipt {
            document_target_handle: handle,
            version_token: sha256_hex(content_json.as_bytes()),
            display_path: display_path(&auth.canonical_path),
        })
    }

    /// 导出落盘：authorization kind 必须为 Export；TOCTOU 复核；原子替换。
    pub fn commit_export(
        &self,
        window_label: &str,
        authorization_ref: &str,
        bytes: &[u8],
    ) -> ServiceResult<String> {
        let auth = self
            .authorizations
            .redeem(authorization_ref, TargetKind::Export, window_label, self.clock.now_ms())?;
        verify_target_unchanged(&auth)?;
        commit::atomic_replace(&auth.canonical_path, bytes)?;
        Ok(display_path(&auth.canonical_path))
    }

    /// 窗口关闭：撤销其全部授权与句柄。
    pub fn revoke_window(&self, window_label: &str) {
        self.authorizations.revoke_window(window_label);
        self.handles.revoke_window(window_label);
    }
}

impl Default for FileLifecycleService {
    fn default() -> Self {
        Self::new()
    }
}

/// normalize：目标存在 → canonicalize + SHA-256；
/// 目标不存在（新建）→ canonicalize(父目录) + 文件名，父目录必须存在。
fn normalize_target(raw: &Path) -> ServiceResult<(PathBuf, bool, Option<String>)> {
    match file_sha256(raw)? {
        Some(hash) => {
            let canon = canonical_path(raw)?;
            Ok((canon, true, Some(hash)))
        }
        None => {
            let parent = raw.parent().ok_or_else(|| ServiceError::file_io("目标缺少父目录"))?;
            let canon_parent = canonical_path(parent)?;
            let name = raw.file_name().ok_or_else(|| ServiceError::file_io("目标不是文件路径"))?;
            Ok((canon_parent.join(name), false, None))
        }
    }
}

/// TOCTOU 复核：授权时刻的目标状态与现在一致才允许写入；否则绝不覆盖。
fn verify_target_unchanged(auth: &authorization::ValidatedAuthorization) -> ServiceResult<()> {
    // 路径身份复核（防目录被替换为 symlink）。
    let (canon_now, existed_now, hash_now) = normalize_target(&auth.canonical_path)?;
    if canon_now != auth.canonical_path {
        return Err(ServiceError::invalid_target_authorization("目标路径已变化"));
    }
    match (auth.target_existed, auth.target_hash_at_grant.as_deref(), existed_now, hash_now.as_deref()) {
        (false, _, false, _) => Ok(()),                       // 授权时不存在，现在仍不存在
        (false, _, true, _) => Err(ServiceError::target_appeared()),
        (true, Some(g), true, Some(n)) if g == n => Ok(()),   // 内容未变
        (true, _, _, _) => Err(ServiceError::target_modified_externally()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct FixedClock(i64);
    impl Clock for FixedClock {
        fn now_ms(&self) -> i64 {
            self.0
        }
    }

    fn svc_at(t: i64) -> FileLifecycleService {
        FileLifecycleService::with_clock(Box::new(FixedClock(t)))
    }

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    const W1: &str = "main";
    const W2: &str = "editor-2";

    #[test]
    fn open_then_ordinary_save_without_dialog() {
        let dir = tmpdir();
        let path = dir.join("a.json");
        fs::write(&path, r#"{"schemaVersion":1}"#).unwrap();
        let svc = svc_at(0);
        let opened = svc.open_file(W1, &path).unwrap();
        assert_eq!(opened.version_token, sha256_hex(br#"{"schemaVersion":1}"#));

        let receipt =
            svc.commit_ordinary(W1, &opened.document_target_handle, &opened.version_token, r#"{"schemaVersion":2}"#)
                .unwrap();
        // ordinary 成功不重开对话框（无对话框参与），handle 稳定、token 轮换。
        assert_eq!(receipt.document_target_handle, opened.document_target_handle);
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"schemaVersion":2}"#);
    }

    #[test]
    fn save_as_signs_new_handle_then_ordinary_save_reuses_it() {
        let dir = tmpdir();
        let target = dir.join("new.json");
        let svc = svc_at(0);
        let grant = svc.grant_authorization(W1, TargetKind::Document, &target).unwrap();
        let receipt = svc.commit_save_as(W1, &grant.authorization_ref, r#"{"v":1}"#).unwrap();
        assert!(fs::read_to_string(&target).unwrap().contains(r#""v":1"#));

        // Save As 之后的 ordinary save：用新 handle + token，不重开对话框。
        let r2 = svc
            .commit_ordinary(W1, &receipt.document_target_handle, &receipt.version_token, r#"{"v":2}"#)
            .unwrap();
        assert_eq!(r2.document_target_handle, receipt.document_target_handle);
        assert!(fs::read_to_string(&target).unwrap().contains(r#""v":2"#));
    }

    // ---- authorization 拒绝矩阵（任务卡点名四个码） ----

    #[test]
    fn forged_authorization_rejected() {
        let svc = svc_at(0);
        let err = svc.commit_save_as(W1, "auth-forged", "{}").unwrap_err();
        assert_eq!(err.0.code, "INVALID_TARGET_AUTHORIZATION");
    }

    #[test]
    fn replayed_authorization_rejected() {
        let dir = tmpdir();
        let target = dir.join("b.json");
        let svc = svc_at(0);
        let grant = svc.grant_authorization(W1, TargetKind::Document, &target).unwrap();
        svc.commit_save_as(W1, &grant.authorization_ref, "{}").unwrap();
        let err = svc.commit_save_as(W1, &grant.authorization_ref, "{}").unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_CONSUMED");
    }

    #[test]
    fn expired_authorization_rejected() {
        let dir = tmpdir();
        let target = dir.join("c.json");
        let clock = StepClock::new(0);
        let svc = FileLifecycleService::with_clock(Box::new(clock.clone()));
        let grant = svc.grant_authorization(W1, TargetKind::Document, &target).unwrap();
        clock.set(AUTHORIZATION_TTL_MS + 1); // 推进到过期后
        let err = svc.commit_save_as(W1, &grant.authorization_ref, "{}").unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_EXPIRED");
        assert!(!target.exists(), "拒绝时不得创建目标");
    }

    /// 可推进时钟（Arc 共享给服务与测试）。
    #[derive(Clone)]
    struct StepClock(std::sync::Arc<std::sync::Mutex<i64>>);
    impl StepClock {
        fn new(t: i64) -> Self {
            Self(std::sync::Arc::new(std::sync::Mutex::new(t)))
        }
        fn set(&self, v: i64) {
            *self.0.lock().unwrap() = v;
        }
    }
    impl Clock for StepClock {
        fn now_ms(&self) -> i64 {
            *self.0.lock().unwrap()
        }
    }

    #[test]
    fn wrong_kind_authorization_rejected_without_touching_target() {
        let dir = tmpdir();
        let target = dir.join("d.json");
        let svc = svc_at(0);
        // document 授权不能用于 export 提交，反之亦然。
        let doc_grant = svc.grant_authorization(W1, TargetKind::Document, &target).unwrap();
        let err = svc.commit_export(W1, &doc_grant.authorization_ref, b"png").unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_KIND_MISMATCH");
        assert!(!target.exists(), "拒绝时不得创建/覆盖目标");

        let png = dir.join("e.png");
        let exp_grant = svc.grant_authorization(W1, TargetKind::Export, &png).unwrap();
        let err = svc.commit_save_as(W1, &exp_grant.authorization_ref, "{}").unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_KIND_MISMATCH");
        assert!(!png.exists());
    }

    #[test]
    fn cross_window_authorization_and_handle_rejected() {
        let dir = tmpdir();
        let target = dir.join("f.json");
        let svc = svc_at(0);
        let grant = svc.grant_authorization(W1, TargetKind::Document, &target).unwrap();
        let err = svc.commit_save_as(W2, &grant.authorization_ref, "{}").unwrap_err();
        assert_eq!(err.0.code, "INVALID_TARGET_AUTHORIZATION");
        assert!(!target.exists());

        // handle 跨窗口同样拒绝。
        fs::write(&target, "{}").unwrap();
        let opened = svc.open_file(W1, &target).unwrap();
        let err = svc
            .commit_ordinary(W2, &opened.document_target_handle, &opened.version_token, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "INVALID_DOCUMENT_TARGET_HANDLE");
    }

    #[test]
    fn revoked_window_rejects_forged_and_stale_handles() {
        let dir = tmpdir();
        let path = dir.join("g.json");
        fs::write(&path, "{}").unwrap();
        let svc = svc_at(0);
        let opened = svc.open_file(W1, &path).unwrap();
        svc.revoke_window(W1); // 窗口关闭
        let err = svc
            .commit_ordinary(W1, &opened.document_target_handle, &opened.version_token, "{ }")
            .unwrap_err();
        assert_eq!(err.0.code, "INVALID_DOCUMENT_TARGET_HANDLE");
        // 伪造 handle
        let err = svc.commit_ordinary(W1, "doc-forged", "x", "{}").unwrap_err();
        assert_eq!(err.0.code, "INVALID_DOCUMENT_TARGET_HANDLE");
    }

    // ---- TOCTOU / 外部修改 ----

    #[test]
    fn externally_modified_target_blocks_ordinary_save() {
        let dir = tmpdir();
        let path = dir.join("h.json");
        fs::write(&path, "{}").unwrap();
        let svc = svc_at(0);
        let opened = svc.open_file(W1, &path).unwrap();
        fs::write(&path, r#"{"external":true}"#).unwrap(); // 外部修改
        let err = svc
            .commit_ordinary(W1, &opened.document_target_handle, &opened.version_token, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_MODIFIED_EXTERNALLY");
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"external":true}"#, "不得覆盖外部内容");
    }

    #[test]
    fn deleted_target_blocks_ordinary_save() {
        let dir = tmpdir();
        let path = dir.join("i.json");
        fs::write(&path, "{}").unwrap();
        let svc = svc_at(0);
        let opened = svc.open_file(W1, &path).unwrap();
        fs::remove_file(&path).unwrap(); // 外部删除
        let err = svc
            .commit_ordinary(W1, &opened.document_target_handle, &opened.version_token, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_MODIFIED_EXTERNALLY");
    }

    #[test]
    fn target_appearing_after_dialog_blocks_save_as() {
        let dir = tmpdir();
        let target = dir.join("j.json");
        let svc = svc_at(0);
        let grant = svc.grant_authorization(W1, TargetKind::Document, &target).unwrap(); // 不存在
        fs::write(&target, r#"{"suddenly":true}"#).unwrap(); // 目标突然出现
        let err = svc.commit_save_as(W1, &grant.authorization_ref, "{}").unwrap_err();
        assert_eq!(err.0.code, "TARGET_APPEARED");
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"suddenly":true}"#);
    }

    #[test]
    fn externally_modified_existing_target_blocks_save_as() {
        let dir = tmpdir();
        let target = dir.join("k.json");
        fs::write(&target, r#"{"base":1}"#).unwrap();
        let svc = svc_at(0);
        let grant = svc.grant_authorization(W1, TargetKind::Document, &target).unwrap();
        fs::write(&target, r#"{"base":2}"#).unwrap(); // 对话框后外部修改
        let err = svc.commit_save_as(W1, &grant.authorization_ref, "{}").unwrap_err();
        assert_eq!(err.0.code, "TARGET_MODIFIED_EXTERNALLY");
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"base":2}"#);
    }

    #[test]
    fn export_commit_writes_bytes_and_consumes_authorization() {
        let dir = tmpdir();
        let target = dir.join("out.svg");
        let svc = svc_at(0);
        let grant = svc.grant_authorization(W1, TargetKind::Export, &target).unwrap();
        let display = svc.commit_export(W1, &grant.authorization_ref, b"<svg/>").unwrap();
        assert!(display.ends_with("out.svg"));
        assert_eq!(fs::read(&target).unwrap(), b"<svg/>");
        let err = svc.commit_export(W1, &grant.authorization_ref, b"<svg/>").unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_CONSUMED");
    }

    #[test]
    fn open_non_utf8_file_fails_with_io_error() {
        let dir = tmpdir();
        let path = dir.join("bin.json");
        fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        let svc = svc_at(0);
        let err = svc.open_file(W1, &path).unwrap_err();
        assert_eq!(err.0.code, "FILE_IO_ERROR");
    }
}
