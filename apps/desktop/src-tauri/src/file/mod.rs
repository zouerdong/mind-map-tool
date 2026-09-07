//! FileLifecycleService（MM-060）：文件身份、授权 ledger、句柄与提交的服务层。
//! 对话框等 tauri 依赖留在 ipc 层；本模块纯逻辑，cargo test 直接覆盖
//! 伪造/重放/过期/错 kind/跨窗口/TOCTOU/外部修改矩阵（任务卡步骤⑦）。

pub mod authorization;
pub mod commit;
pub mod error;
pub mod handle;
pub mod identity;
pub mod preferences;

use std::io::Read;
use std::path::{Path, PathBuf};

use authorization::AuthorizationLedger;
use error::{ServiceError, ServiceResult};
use handle::HandleRegistry;
use identity::{canonical_path, display_path, file_sha256, platform_provider, sha256_hex};

pub use authorization::AuthorizationPlan;
pub use identity::{
    CanonicalPathKey, FileIdentity, FileIdentityProvider, IdentityAlias, IdentityStrength,
    PlatformPhysicalFileKey,
};

pub use authorization::TargetKind;
pub use error::IpcError;

/// 授权有效期（ms）：对话框确认到 commit 的窗口期，防陈旧授权。
pub const AUTHORIZATION_TTL_MS: i64 = 10 * 60 * 1000;
/// host 在 IPC 前置读取阶段允许的最大文档字节数；与 core 的
/// `LIMITS.maxInputBytes` 保持同一 50MB 边界，避免把超大文件完整读入内存。
pub const MAX_DOCUMENT_BYTES: u64 = 50 * 1024 * 1024;

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

#[derive(Debug, Clone)]
pub struct Receipt {
    pub document_target_handle: String,
    pub version_token: String,
    pub display_path: String,
}

/// B1A.3:open 的 host-only 绑定 outcome。`renderer` 是既有 IPC DTO
/// (content/handle/token/displayPath);`identity` 为 host 内部值,不向前端
/// 序列化(Wave 2 只交给 coordinator)。
#[derive(Debug)]
pub struct OpenHostOutcome {
    pub renderer: OpenOutcome,
    pub identity: FileIdentity,
}

/// B1A.3:ordinary commit 的 host-only 绑定 outcome。identity 的 canonical
/// 恒等于 handle ledger 绑定目标(`canonical_target` 同源提供)。
#[derive(Debug)]
pub struct CommitHostOutcome {
    pub renderer: Receipt,
    pub identity: FileIdentity,
    pub canonical_target: CanonicalPathKey,
}

/// ordinary commit 的结果(Wave 2 §4.3):bytes 落盘后 identity refresh
/// 失败不再是普通错误——文件已提交,receipt 不得丢失,调用方必须进入
/// post-commit recovery,不得提示为可重试覆盖。
#[derive(Debug)]
pub enum OrdinaryCommitResult {
    /// 提交与 identity 刷新全部完成(registry 刷新由调用方在锁内执行)。
    Committed(CommitHostOutcome),
    /// bytes 已落盘,但同流程 identity 刷新失败(fail closed):
    /// 携带真实 receipt 与 handle 绑定的 canonical target。
    CommittedButRefreshPending {
        receipt: Receipt,
        canonical_target: CanonicalPathKey,
        cause: ServiceError,
    },
}

pub struct FileLifecycleService {
    authorizations: AuthorizationLedger,
    handles: HandleRegistry,
    clock: Box<dyn Clock>,
}

impl FileLifecycleService {
    pub fn new() -> Self {
        Self {
            authorizations: AuthorizationLedger::new(),
            handles: HandleRegistry::new(),
            clock: Box::new(SystemClock),
        }
    }

    pub fn with_clock(clock: Box<dyn Clock>) -> Self {
        Self {
            authorizations: AuthorizationLedger::new(),
            handles: HandleRegistry::new(),
            clock,
        }
    }

    /// openDocument：读目标 + 签发 handle + token（对话框结果由 ipc 层传入）。
    pub fn open_file(&self, window_label: &str, raw_path: &Path) -> ServiceResult<OpenOutcome> {
        let provider = platform_provider();
        self.open_file_with_identity(provider.as_ref(), window_label, raw_path)
            .map(|outcome| outcome.renderer)
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
        Ok(GrantOutcome {
            authorization_ref: id,
            display_path: display_path(&canon),
        })
    }

    /// ordinary Save：handle + expectedToken；host 二次验证后原子替换。
    /// (renderer DTO 路径;host-domain 绑定版本见
    /// `commit_ordinary_with_identity`,两者共用同一 core。)
    pub fn commit_ordinary(
        &self,
        window_label: &str,
        document_target_handle: &str,
        expected_version_token: &str,
        content_json: &str,
    ) -> ServiceResult<Receipt> {
        self.commit_ordinary_core(
            window_label,
            document_target_handle,
            expected_version_token,
            content_json,
        )
        .map(|(_, receipt)| receipt)
    }

    /// Save As：redeem 一次性授权 → TOCTOU 复核 → 原子替换 → 签发新 handle。
    pub fn commit_save_as(
        &self,
        window_label: &str,
        authorization_ref: &str,
        content_json: &str,
    ) -> ServiceResult<Receipt> {
        let auth = self.authorizations.redeem(
            authorization_ref,
            TargetKind::Document,
            window_label,
            self.clock.now_ms(),
        )?;
        verify_target_unchanged(&auth)?;
        commit::atomic_replace(&auth.canonical_path, content_json.as_bytes())?;
        let handle = self
            .handles
            .issue(window_label, auth.canonical_path.clone());
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
        let auth = self.authorizations.redeem(
            authorization_ref,
            TargetKind::Export,
            window_label,
            self.clock.now_ms(),
        )?;
        verify_target_unchanged(&auth)?;
        commit::atomic_replace(&auth.canonical_path, bytes)?;
        Ok(display_path(&auth.canonical_path))
    }

    /// 窗口关闭：撤销其全部授权与句柄。
    pub fn revoke_window(&self, window_label: &str) {
        self.authorizations.revoke_window(window_label);
        self.handles.revoke_window(window_label);
    }

    /// 精确撤销单个文档 handle（MRT-004W2R R6：交付校验失败时回收
    /// 刚签发的 capability，不依赖调用方窗口级撤销）。
    pub fn revoke_document_handle(&self, handle: &str) -> bool {
        self.handles.revoke_handle(handle)
    }

    /// 只校验 opaque document handle 的窗口归属与撤销状态，不触碰文件；
    /// runtime 用它保持“窗口已销毁 + 旧 handle”仍返回稳定 capability 错误。
    pub fn validate_document_handle(
        &self,
        window_label: &str,
        document_target_handle: &str,
    ) -> ServiceResult<()> {
        self.handles
            .validate(document_target_handle, window_label)
            .map(|_| ())
    }

    /// 只读诊断：该窗口存活 handle 数量（R6 零残留断言的观测通道）。
    pub fn document_handle_count(&self, window_label: &str) -> usize {
        self.handles.count_for_window(window_label)
    }

    // ---- MRT-004B1/B1A:host-domain 提交边界(B1.5 + B1A-F2) ----

    /// open 的 host-only 绑定 outcome(B1A.3):renderer 只拿 `OpenOutcome`
    /// 投影(handle/token/displayPath);`identity` 由 host 从同一次打开的
    /// 无损 canonical 目标解析,不出 host、不经 displayPath 反推。
    pub fn open_file_with_identity(
        &self,
        provider: &dyn FileIdentityProvider,
        window_label: &str,
        raw_path: &Path,
    ) -> ServiceResult<OpenHostOutcome> {
        let canon = canonical_path(raw_path)?;
        // PRC-020: 单次 open 取得底层 descriptor
        let mut file = std::fs::File::open(&canon)
            .map_err(|e| ServiceError::file_io(format!("open {}: {e}", canon.display())))?;

        // 从同一 descriptor 解析 identity 与有界读取
        let identity = provider
            .resolve_descriptor(&canon, &file)
            .map_err(|e| ServiceError::file_io(e.to_string()))?;
        if identity.canonical().as_path() != canon.as_path() {
            return Err(ServiceError::file_io("open identity 与实际打开目标不一致"));
        }

        let bytes = read_bounded_from_file(&mut file, &canon, MAX_DOCUMENT_BYTES)?;
        let content_json = String::from_utf8(bytes)
            .map_err(|_| ServiceError::file_io(format!("{} 不是 UTF-8 文本", canon.display())))?;
        let token = sha256_hex(content_json.as_bytes());

        // 签发 handle 前做二次验证：当前路径仍指向该 descriptor identity（消除 TOCTOU 竞态）
        let current_identity = provider.resolve_existing(&canon).map_err(|e| {
            ServiceError::file_io(format!("verify target {}: {e}", canon.display()))
        })?;
        if current_identity != identity {
            return Err(ServiceError::file_io(
                "open identity 与实际打开目标不一致（路径底层对象发生变化）",
            ));
        }

        // provider 与打开目标的绑定验证通过后再签发能力，失败路径不留下孤立 handle
        let handle = self.handles.issue(window_label, canon.clone());
        Ok(OpenHostOutcome {
            renderer: OpenOutcome {
                content_json,
                document_target_handle: handle,
                version_token: token,
                display_path: display_path(&canon),
            },
            identity,
        })
    }

    /// ordinary commit 的 host-only 绑定 outcome(B1A-F2/O1):目标只能来自
    /// `HandleRegistry::validate`(handle ledger 绑定的 canonical);提交
    /// 成功后**同一 service 流程**内刷新 identity 并校验其 canonical 与
    /// handle 绑定目标一致。不存在接受任意 path 的 loose refresh API。
    pub fn commit_ordinary_with_identity(
        &self,
        window_label: &str,
        document_target_handle: &str,
        expected_version_token: &str,
        content_json: &str,
    ) -> Result<OrdinaryCommitResult, ServiceError> {
        self.commit_ordinary_with_identity_from(
            &*identity::platform_provider(),
            window_label,
            document_target_handle,
            expected_version_token,
            content_json,
        )
    }

    /// 与运行时注入的 identity provider 同源执行 ordinary commit。
    /// 生产 runtime 必须使用此入口，确保提交后的 refresh 与 open/Save As
    /// 使用同一平台适配器；无注入的旧入口保留给平台无关单元测试。
    pub fn commit_ordinary_with_identity_from(
        &self,
        provider: &dyn FileIdentityProvider,
        window_label: &str,
        document_target_handle: &str,
        expected_version_token: &str,
        content_json: &str,
    ) -> Result<OrdinaryCommitResult, ServiceError> {
        let (canon, receipt) = self.commit_ordinary_core(
            window_label,
            document_target_handle,
            expected_version_token,
            content_json,
        )?;
        let canonical_target = CanonicalPathKey::from_path(canon.clone());
        match provider
            .refresh_after_commit(&canon)
            .map_err(|e| ServiceError::file_io(e.to_string()))
        {
            Ok(identity) => {
                if identity.canonical().as_path() != canon.as_path() {
                    // 内部不变量:刷新身份必须锚定 handle 绑定目标(fail closed)
                    return Ok(OrdinaryCommitResult::CommittedButRefreshPending {
                        receipt,
                        canonical_target,
                        cause: ServiceError::file_io("refreshed identity 与 handle 绑定目标不一致"),
                    });
                }
                Ok(OrdinaryCommitResult::Committed(CommitHostOutcome {
                    renderer: receipt,
                    canonical_target: identity.canonical().clone(),
                    identity,
                }))
            }
            // bytes 已提交:receipt 与目标不得丢失(Wave 2 recovery 通道输入)
            Err(cause) => Ok(OrdinaryCommitResult::CommittedButRefreshPending {
                receipt,
                canonical_target,
                cause,
            }),
        }
    }

    /// ordinary 提交核心(handle 校验 + TOCTOU 复核 + 原子替换)。
    fn commit_ordinary_core(
        &self,
        window_label: &str,
        document_target_handle: &str,
        expected_version_token: &str,
        content_json: &str,
    ) -> ServiceResult<(PathBuf, Receipt)> {
        let canon = self
            .handles
            .validate(document_target_handle, window_label)?;
        // 先复核内容(文件被外部删除/修改 → 稳定冲突码,绝不覆盖)。
        match file_sha256(&canon)? {
            Some(h) if h == expected_version_token => {}
            _ => return Err(ServiceError::target_modified_externally()),
        }
        // 再防 symlink swap:路径身份必须与签发时一致(此时文件必存在)。
        if canonical_path(&canon)? != canon {
            return Err(ServiceError::invalid_handle(
                "目标路径已变化(疑似符号链接替换)",
            ));
        }
        commit::atomic_replace(&canon, content_json.as_bytes())?;
        let receipt = Receipt {
            document_target_handle: document_target_handle.to_string(),
            version_token: sha256_hex(content_json.as_bytes()),
            display_path: display_path(&canon),
        };
        Ok((canon, receipt))
    }

    /// Save As 写前 plan:经授权 ledger 校验窗口/kind/expiry/未消费,
    /// 返回 canonical target(不消耗授权)。
    pub fn plan_document_save_as(
        &self,
        window_label: &str,
        authorization_ref: &str,
    ) -> ServiceResult<AuthorizationPlan> {
        self.authorizations.plan(
            authorization_ref,
            TargetKind::Document,
            window_label,
            self.clock.now_ms(),
        )
    }

    /// 按 plan 提交(B1A.4):先校验 plan 归属当前窗口(调用方 label 与
    /// plan 绑定不得是两个互不校验的字符串),再经 `redeem_plan` 复核
    /// ref/window/kind/canonical target 与 ledger 完全一致(单次消耗),
    /// 然后 TOCTOU 复核 + 原子替换 + 签发新 handle。失败时授权已被
    /// redeem 消耗(既有语义:防重试绕过 TOCTOU),调用方必须按 pre-commit
    /// 规则显式 abort rebind。
    pub fn commit_save_as_planned(
        &self,
        window_label: &str,
        plan: &AuthorizationPlan,
        content_json: &str,
    ) -> ServiceResult<Receipt> {
        if plan.window_label() != window_label {
            return Err(ServiceError::invalid_target_authorization(
                "plan 不属于当前窗口",
            ));
        }
        let auth = self.authorizations.redeem_plan(plan, self.clock.now_ms())?;
        verify_target_unchanged(&auth)?;
        commit::atomic_replace(&auth.canonical_path, content_json.as_bytes())?;
        let handle = self
            .handles
            .issue(window_label, auth.canonical_path.clone());
        Ok(Receipt {
            document_target_handle: handle,
            version_token: sha256_hex(content_json.as_bytes()),
            display_path: display_path(&auth.canonical_path),
        })
    }
}

/// B1.5 编排结果:receipt(handle/token/displayPath)与 host-only 最终身份。
#[derive(Debug)]
pub struct SaveAsOutcome {
    pub receipt: Receipt,
    pub identity: FileIdentity,
}

/// B1A.2 编排错误:按 commit 前后语义分界(host 内部;不映射进 IPC
/// 错误码契约)。调用方必须区分——PreCommit 文件未写、pending 已清理;
/// CommittedButRebindPending 文件已落盘、fail-closed reservation 保留,
/// 不得当作"保存失败、可重试覆盖"。
/// Wave 2 §4.3:CommittedButRebindPending 额外携带 rebind token 与
/// authorized canonical target(host-only),供显式 post-commit recovery
/// 在锁内 finalize;两者都不进 renderer。
#[derive(Debug)]
pub enum SaveAsError {
    /// PreCommit:plan → resolve/bind → prepare → redeem/TOCTOU/commit 任一
    /// 失败;目标文件**未提交**,pending 已按 pre-commit 规则 abort。
    PreCommit(PreCommitError),
    /// PostCommit:目标 bytes **已落盘**,但 identity refresh 或 finalize
    /// 未完成;pending/fail-closed reservation **保留**,调用方不得当作
    /// "保存失败、可重试覆盖"。
    CommittedButRebindPending {
        receipt: Receipt,
        cause: PostCommitCause,
        /// 未终结的 rebind token(fail-closed pending 仍在 registry)。
        token: String,
        /// plan 绑定的 authorized canonical target(恢复 finalize 的锚点)。
        canonical_target: CanonicalPathKey,
    },
}

/// PreCommit 阶段失败细分(文件未写盘)。
#[derive(Debug)]
pub enum PreCommitError {
    /// 授权 plan 失败(不存在/跨窗/kind/过期/已消耗)。
    Plan(ServiceError),
    /// 授权目标 provider 解析失败。
    ResolveTarget(ServiceError),
    /// provider 返回的 canonical 与 plan 绑定不一致(写前拒绝)。
    TargetBindingMismatch,
    /// 写前 reservation 冲突(未产生 pending)。
    Prepare(&'static str),
    /// redeem/TOCTOU/commit 失败;pending 已 abort。
    Commit(ServiceError),
    /// commit 失败且 abort 也失败:组合错误不吞错(pending 可能残留,
    /// fail closed 由 registry 状态保证)。
    CommitAndAbortFailed {
        commit: ServiceError,
        abort: &'static str,
    },
}

/// PostCommit 阶段失败原因(文件已写盘,换绑未完成)。
#[derive(Debug)]
pub enum PostCommitCause {
    /// refresh_after_commit 失败(metadata/IO)。
    RefreshFailed(ServiceError),
    /// refresh 成功但 canonical 与 plan 绑定不一致(写后 fail closed)。
    RefreshedTargetMismatch,
    /// finalize 被 registry 拒绝(占用/一致性;fail closed 保留 pending)。
    FinalizeRejected(&'static str),
}

impl std::fmt::Display for SaveAsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SaveAsError::PreCommit(e) => {
                write!(f, "save-as pre-commit failure (file not written): {e:?}")
            }
            SaveAsError::CommittedButRebindPending { cause, .. } => write!(
                f,
                "save-as committed but rebind pending (fail closed): {cause:?}"
            ),
        }
    }
}

/// host-domain Save As 编排(B1A.2 起以 commit 前后语义分界;Wave 2 直接接线):
///
/// ```text
/// PreCommit(文件未提交;任何失败 → abort pending,授权可能已消耗)
///   1. authorization plan(锁外;失败即返回,不产生 pending token)
///   2. resolve/bind target(锁外 provider;canonical 必须与 plan 一致)
///   3. prepare reservation(锁内;写前全量占用校验)
///   4. redeem/TOCTOU/commit(锁外,真实文件写入)
///        失败 → 显式 abort(锁内,只清 pending);abort 自身失败 → 组合错误
///
/// PostCommit(目标 bytes 已落盘;任何失败 → 不得 abort,fail closed)
///   5. refreshed identity(锁外 provider;canonical 必须与 plan 一致)
///   6. finalize(锁内原子换绑;拒绝 → 保留 pending 返回稳定错误)
/// ```
///
/// 文件 I/O、provider metadata、IPC 均不在 coordinator lock 内;
/// 不根据 receipt 的 displayPath 做 post-hoc identity 判定;
/// 全程以同一 `window_label` 贯穿 plan → token owner → finalize/abort
/// (B1A-F3:caller 绑定,不允许两个互不校验的字符串)。
#[allow(clippy::result_large_err)] // host 内部错误枚举;token/canonical 必须随错误携带(§4.3)
pub fn orchestrate_save_as(
    coordinator: &crate::lifecycle::launch_coordinator::LaunchCoordinator,
    service: &FileLifecycleService,
    provider: &dyn FileIdentityProvider,
    window_label: &str,
    authorization_ref: &str,
    content_json: &str,
) -> Result<SaveAsOutcome, SaveAsError> {
    orchestrate_save_as_with_generation(
        coordinator,
        service,
        provider,
        window_label,
        authorization_ref,
        content_json,
        None,
    )
}

/// Save As 的 generation-bound 变体。`expected_generation` 由 runtime 在
/// 锁外文件 I/O 前捕获；提供时，post-commit finalize 只能作用于该代窗口。
/// 旧的无 generation API 保留给纯文件生命周期测试与其他平台无窗口调用方。
#[allow(clippy::result_large_err)]
pub fn orchestrate_save_as_with_generation(
    coordinator: &crate::lifecycle::launch_coordinator::LaunchCoordinator,
    service: &FileLifecycleService,
    provider: &dyn FileIdentityProvider,
    window_label: &str,
    authorization_ref: &str,
    content_json: &str,
    expected_generation: Option<u64>,
) -> Result<SaveAsOutcome, SaveAsError> {
    // ---- PreCommit ----
    // 1. plan(锁外)
    let plan = service
        .plan_document_save_as(window_label, authorization_ref)
        .map_err(|e| SaveAsError::PreCommit(PreCommitError::Plan(e)))?;
    // 2. target(锁外;provider 给出的 canonical 必须与 plan 绑定一致)
    let target = provider
        .resolve_authorized_target(plan.canonical_target())
        .map_err(|e| {
            SaveAsError::PreCommit(PreCommitError::ResolveTarget(ServiceError::file_io(
                e.to_string(),
            )))
        })?;
    if target.canonical().as_path() != plan.canonical_target() {
        // 写前拒绝:provider 与授权 plan 指向不同目标,零 I/O、零 pending
        return Err(SaveAsError::PreCommit(
            PreCommitError::TargetBindingMismatch,
        ));
    }
    // 3. prepare(锁内)
    let token = coordinator
        .prepare_rebind(window_label, &target)
        .map_err(PreCommitError::Prepare)
        .map_err(SaveAsError::PreCommit)?;
    // 4. commit(锁外;redeem=消耗授权 + TOCTOU + 原子替换)
    let receipt = match service.commit_save_as_planned(window_label, &plan, content_json) {
        Ok(r) => r,
        Err(e) => {
            // pre-commit 失败:显式 abort;abort 自身失败 → 组合错误,不吞错
            return match coordinator.abort_rebind(window_label, &token) {
                Ok(()) => Err(SaveAsError::PreCommit(PreCommitError::Commit(e))),
                Err(abort) => Err(SaveAsError::PreCommit(
                    PreCommitError::CommitAndAbortFailed { commit: e, abort },
                )),
            };
        }
    };
    // ---- PostCommit:目标 bytes 已落盘,以下任何失败不得 abort ----
    // (Wave 2:统一携带 token + plan canonical target,供显式 recovery)
    let pending_error =
        |receipt: Receipt, cause: PostCommitCause| SaveAsError::CommittedButRebindPending {
            receipt,
            cause,
            token: token.clone(),
            canonical_target: CanonicalPathKey::from_path(plan.canonical_target().to_path_buf()),
        };
    // 5. refreshed(锁外;失败 → CommittedButRebindPending,fail closed)
    let refreshed = match provider.refresh_after_commit(plan.canonical_target()) {
        Ok(id) => id,
        Err(e) => {
            return Err(pending_error(
                receipt,
                PostCommitCause::RefreshFailed(ServiceError::file_io(e.to_string())),
            ))
        }
    };
    if refreshed.canonical().as_path() != plan.canonical_target() {
        // 文件已写但 provider 刷新出不同 canonical:写后 fail closed
        return Err(pending_error(
            receipt,
            PostCommitCause::RefreshedTargetMismatch,
        ));
    }
    // 6. finalize(锁内;拒绝 → 保留 pending,错误可区分"已提交未换绑")
    let finalize = match expected_generation {
        Some(generation) => {
            coordinator.finalize_rebind_if_generation(window_label, generation, &token, &refreshed)
        }
        None => coordinator.finalize_rebind(window_label, &token, &refreshed),
    };
    if let Err(code) = finalize {
        return Err(pending_error(
            receipt,
            PostCommitCause::FinalizeRejected(code),
        ));
    }
    Ok(SaveAsOutcome {
        receipt,
        identity: refreshed,
    })
}

/// 从已打开的描述符执行有界读取（PRC-020）：先用 metadata 拒绝明显超限文件，
/// 再以 `take(max + 1)` 防止读取期间文件增长绕过限制。超限时立即失败，不签发 handle。
fn read_bounded_from_file(
    file: &mut std::fs::File,
    canon: &Path,
    max: u64,
) -> ServiceResult<Vec<u8>> {
    let metadata = file
        .metadata()
        .map_err(|e| ServiceError::file_io(format!("read metadata {}: {e}", canon.display())))?;
    if metadata.len() > max {
        return Err(ServiceError::document_too_large(metadata.len(), max));
    }
    let capacity = metadata.len().min(max) as usize;
    let mut bytes = Vec::with_capacity(capacity);
    file.take(max.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| ServiceError::file_io(format!("read {}: {e}", canon.display())))?;
    if bytes.len() as u64 > max {
        return Err(ServiceError::document_too_large(bytes.len() as u64, max));
    }
    Ok(bytes)
}

#[allow(dead_code)]
fn read_bounded_bytes(path: &Path, max: u64) -> ServiceResult<Vec<u8>> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| ServiceError::file_io(format!("read open {}: {e}", path.display())))?;
    read_bounded_from_file(&mut file, path, max)
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
            let parent = raw
                .parent()
                .ok_or_else(|| ServiceError::file_io("目标缺少父目录"))?;
            let canon_parent = canonical_path(parent)?;
            let name = raw
                .file_name()
                .ok_or_else(|| ServiceError::file_io("目标不是文件路径"))?;
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
    match (
        auth.target_existed,
        auth.target_hash_at_grant.as_deref(),
        existed_now,
        hash_now.as_deref(),
    ) {
        (false, _, false, _) => Ok(()), // 授权时不存在，现在仍不存在
        (false, _, true, _) => Err(ServiceError::target_appeared()),
        (true, Some(g), true, Some(n)) if g == n => Ok(()), // 内容未变
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

        let receipt = svc
            .commit_ordinary(
                W1,
                &opened.document_target_handle,
                &opened.version_token,
                r#"{"schemaVersion":2}"#,
            )
            .unwrap();
        // ordinary 成功不重开对话框（无对话框参与），handle 稳定、token 轮换。
        assert_eq!(
            receipt.document_target_handle,
            opened.document_target_handle
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"schemaVersion":2}"#);
    }

    #[test]
    fn bounded_read_rejects_sparse_file_before_allocating_full_contents() {
        let dir = tmpdir();
        let path = dir.join("oversized.mm");
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        file.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        let err = read_bounded_bytes(&path, MAX_DOCUMENT_BYTES).unwrap_err();
        assert_eq!(err.0.code, "DOCUMENT_TOO_LARGE");
    }

    #[test]
    fn open_oversized_document_rejects_before_issuing_handle() {
        let dir = tmpdir();
        let path = dir.join("oversized-open.mm");
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        file.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        let svc = svc_at(0);
        let err = svc.open_file(W1, &path).unwrap_err();
        assert_eq!(err.0.code, "DOCUMENT_TOO_LARGE");
        assert_eq!(svc.document_handle_count(W1), 0);
    }

    #[test]
    fn bounded_read_accepts_exact_limit_and_rejects_growth_over_limit() {
        let dir = tmpdir();
        let path = dir.join("bounded.mm");
        fs::write(&path, b"abcd").unwrap();
        assert_eq!(read_bounded_bytes(&path, 4).unwrap(), b"abcd");
        let err = read_bounded_bytes(&path, 3).unwrap_err();
        assert_eq!(err.0.code, "DOCUMENT_TOO_LARGE");
    }

    #[test]
    fn save_as_signs_new_handle_then_ordinary_save_reuses_it() {
        let dir = tmpdir();
        let target = dir.join("new.json");
        let svc = svc_at(0);
        let grant = svc
            .grant_authorization(W1, TargetKind::Document, &target)
            .unwrap();
        let receipt = svc
            .commit_save_as(W1, &grant.authorization_ref, r#"{"v":1}"#)
            .unwrap();
        assert!(fs::read_to_string(&target).unwrap().contains(r#""v":1"#));

        // Save As 之后的 ordinary save：用新 handle + token，不重开对话框。
        let r2 = svc
            .commit_ordinary(
                W1,
                &receipt.document_target_handle,
                &receipt.version_token,
                r#"{"v":2}"#,
            )
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
        let grant = svc
            .grant_authorization(W1, TargetKind::Document, &target)
            .unwrap();
        svc.commit_save_as(W1, &grant.authorization_ref, "{}")
            .unwrap();
        let err = svc
            .commit_save_as(W1, &grant.authorization_ref, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_CONSUMED");
    }

    #[test]
    fn expired_authorization_rejected() {
        let dir = tmpdir();
        let target = dir.join("c.json");
        let clock = StepClock::new(0);
        let svc = FileLifecycleService::with_clock(Box::new(clock.clone()));
        let grant = svc
            .grant_authorization(W1, TargetKind::Document, &target)
            .unwrap();
        clock.set(AUTHORIZATION_TTL_MS + 1); // 推进到过期后
        let err = svc
            .commit_save_as(W1, &grant.authorization_ref, "{}")
            .unwrap_err();
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
        let doc_grant = svc
            .grant_authorization(W1, TargetKind::Document, &target)
            .unwrap();
        let err = svc
            .commit_export(W1, &doc_grant.authorization_ref, b"png")
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_KIND_MISMATCH");
        assert!(!target.exists(), "拒绝时不得创建/覆盖目标");

        let png = dir.join("e.png");
        let exp_grant = svc
            .grant_authorization(W1, TargetKind::Export, &png)
            .unwrap();
        let err = svc
            .commit_save_as(W1, &exp_grant.authorization_ref, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_AUTHORIZATION_KIND_MISMATCH");
        assert!(!png.exists());
    }

    #[test]
    fn cross_window_authorization_and_handle_rejected() {
        let dir = tmpdir();
        let target = dir.join("f.json");
        let svc = svc_at(0);
        let grant = svc
            .grant_authorization(W1, TargetKind::Document, &target)
            .unwrap();
        let err = svc
            .commit_save_as(W2, &grant.authorization_ref, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "INVALID_TARGET_AUTHORIZATION");
        assert!(!target.exists());

        // handle 跨窗口同样拒绝。
        fs::write(&target, "{}").unwrap();
        let opened = svc.open_file(W1, &target).unwrap();
        let err = svc
            .commit_ordinary(
                W2,
                &opened.document_target_handle,
                &opened.version_token,
                "{}",
            )
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
            .commit_ordinary(
                W1,
                &opened.document_target_handle,
                &opened.version_token,
                "{ }",
            )
            .unwrap_err();
        assert_eq!(err.0.code, "INVALID_DOCUMENT_TARGET_HANDLE");
        // 伪造 handle
        let err = svc
            .commit_ordinary(W1, "doc-forged", "x", "{}")
            .unwrap_err();
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
            .commit_ordinary(
                W1,
                &opened.document_target_handle,
                &opened.version_token,
                "{}",
            )
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_MODIFIED_EXTERNALLY");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"external":true}"#,
            "不得覆盖外部内容"
        );
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
            .commit_ordinary(
                W1,
                &opened.document_target_handle,
                &opened.version_token,
                "{}",
            )
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_MODIFIED_EXTERNALLY");
    }

    #[test]
    fn target_appearing_after_dialog_blocks_save_as() {
        let dir = tmpdir();
        let target = dir.join("j.json");
        let svc = svc_at(0);
        let grant = svc
            .grant_authorization(W1, TargetKind::Document, &target)
            .unwrap(); // 不存在
        fs::write(&target, r#"{"suddenly":true}"#).unwrap(); // 目标突然出现
        let err = svc
            .commit_save_as(W1, &grant.authorization_ref, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_APPEARED");
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"suddenly":true}"#);
    }

    #[test]
    fn externally_modified_existing_target_blocks_save_as() {
        let dir = tmpdir();
        let target = dir.join("k.json");
        fs::write(&target, r#"{"base":1}"#).unwrap();
        let svc = svc_at(0);
        let grant = svc
            .grant_authorization(W1, TargetKind::Document, &target)
            .unwrap();
        fs::write(&target, r#"{"base":2}"#).unwrap(); // 对话框后外部修改
        let err = svc
            .commit_save_as(W1, &grant.authorization_ref, "{}")
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_MODIFIED_EXTERNALLY");
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"base":2}"#);
    }

    #[test]
    fn export_commit_writes_bytes_and_consumes_authorization() {
        let dir = tmpdir();
        let target = dir.join("out.svg");
        let svc = svc_at(0);
        let grant = svc
            .grant_authorization(W1, TargetKind::Export, &target)
            .unwrap();
        let display = svc
            .commit_export(W1, &grant.authorization_ref, b"<svg/>")
            .unwrap();
        assert!(display.ends_with("out.svg"));
        assert_eq!(fs::read(&target).unwrap(), b"<svg/>");
        let err = svc
            .commit_export(W1, &grant.authorization_ref, b"<svg/>")
            .unwrap_err();
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

#[cfg(test)]
mod b1_orchestration_tests {
    //! B1.5 host-domain 编排证明:authorization plan → prepare → 锁外
    //! commit → refreshed identity → finalize/abort 的全链路与失败路径。

    use super::*;
    use crate::lifecycle::launch_coordinator::LaunchCoordinator;
    use crate::lifecycle::window_registry::WindowRegistry;
    use identity::UnixFileIdentityProvider;
    use std::fs;
    use std::path::PathBuf;

    const MAIN: &str = "main";

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    fn blank_coordinator() -> LaunchCoordinator {
        let mut registry = WindowRegistry::new();
        registry.register(MAIN).unwrap();
        registry.mark_blank(MAIN).unwrap();
        LaunchCoordinator::new(registry)
    }

    fn coordinator_with_open(path: &Path) -> (LaunchCoordinator, FileLifecycleService) {
        let svc = FileLifecycleService::new();
        let mut registry = WindowRegistry::new();
        registry.register(MAIN).unwrap();
        let opened = svc
            .open_file_with_identity(&UnixFileIdentityProvider, MAIN, path)
            .unwrap();
        registry
            .begin_loading(MAIN, &opened.identity, "i-1")
            .unwrap();
        registry.mark_open(MAIN).unwrap();
        let c = LaunchCoordinator::new(registry);
        (c, svc)
    }

    #[cfg(unix)]
    #[test]
    fn o2_open_outcome_carries_host_identity_same_source() {
        let dir = tmpdir();
        let path = dir.join("a.mm");
        fs::write(&path, r#"{"v":1}"#).unwrap();
        let svc = FileLifecycleService::new();
        let out = svc
            .open_file_with_identity(&UnixFileIdentityProvider, MAIN, &path)
            .unwrap();
        // identity 与 handle/token 同源:同一 open 解析;canonical 与磁盘一致
        let direct = UnixFileIdentityProvider.resolve_existing(&path).unwrap();
        assert_eq!(out.identity, direct, "O2:host identity 与 open 同源");
        assert!(!out.renderer.document_target_handle.is_empty());
        assert_eq!(out.renderer.version_token, sha256_hex(br#"{"v":1}"#));
    }

    #[cfg(unix)]
    #[test]
    fn u1_untitled_first_save_as_full_orchestration() {
        let dir = tmpdir();
        let target = dir.join("new.mm");
        let svc = FileLifecycleService::new();
        let c = blank_coordinator();
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        let out = orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":1}"#,
        )
        .unwrap();
        // 文件、handle、identity、window state 全部一致
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":1}"#);
        assert!(!out.receipt.document_target_handle.is_empty());
        let record = c.window_record(MAIN).unwrap();
        assert_eq!(
            record.state,
            crate::lifecycle::window_registry::WindowState::Open
        );
        assert_eq!(record.file_identity, Some(out.identity.clone()));
        assert_eq!(
            c.identity_reservation_of(&out.identity).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "U1:adopt 后 identity 归属"
        );
    }

    #[cfg(unix)]
    #[test]
    fn u2_authorization_expired_fails_before_pending() {
        let dir = tmpdir();
        let target = dir.join("new.mm");
        // 时钟推进到过期(StepClock)
        struct StepClock(std::sync::Arc<std::sync::Mutex<i64>>);
        impl Clock for StepClock {
            fn now_ms(&self) -> i64 {
                *self.0.lock().unwrap()
            }
        }
        let clock = std::sync::Arc::new(std::sync::Mutex::new(0i64));
        let svc = FileLifecycleService::with_clock(Box::new(StepClock(clock.clone())));
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        *clock.lock().unwrap() = AUTHORIZATION_TTL_MS + 1;
        let c = blank_coordinator();
        let err = orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            MAIN,
            &grant.authorization_ref,
            "{}",
        )
        .unwrap_err();
        match err {
            SaveAsError::PreCommit(PreCommitError::Plan(e)) => {
                assert_eq!(e.0.code, "TARGET_AUTHORIZATION_EXPIRED")
            }
            other => panic!("U2:应为写前授权层错误,实际 {other:?}"),
        }
        // 未产生 pending;窗口保持 Blank 无 identity
        assert!(!target.exists(), "U2:不得写盘");
        let record = c.window_record(MAIN).unwrap();
        assert_eq!(record.file_identity, None);
    }

    #[cfg(unix)]
    #[test]
    fn a1_authorization_replay_cannot_drive_two_rebinds() {
        let dir = tmpdir();
        let target = dir.join("new.mm");
        let svc = FileLifecycleService::new();
        let c = blank_coordinator();
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        // 第一次成功(redeem 消耗)
        orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":1}"#,
        )
        .unwrap();
        // 同一授权 replay:plan 阶段被拒(consumed),不产生 pending
        let err = orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":2}"#,
        )
        .unwrap_err();
        match err {
            SaveAsError::PreCommit(PreCommitError::Plan(e)) => {
                assert_eq!(e.0.code, "TARGET_AUTHORIZATION_CONSUMED")
            }
            other => panic!("A1:应为写前授权层错误,实际 {other:?}"),
        }
        // pending 无泄漏;文件内容仍是第一次提交
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":1}"#);
    }

    #[cfg(unix)]
    #[test]
    fn s_b3_orchestration_commit_failure_aborts_pending() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, r#"{"v":1}"#).unwrap();
        let target = dir.join("new.mm");
        let (c, svc) = coordinator_with_open(&source);
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        // 授权后目标被外部创建 → commit 失败(TARGET_APPEARED)
        fs::write(&target, r#"{"suddenly":true}"#).unwrap();
        let err = orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":2}"#,
        )
        .unwrap_err();
        match err {
            SaveAsError::PreCommit(PreCommitError::Commit(e)) => {
                assert_eq!(e.0.code, "TARGET_APPEARED")
            }
            other => panic!("S-B3 编排:应为写前 TOCTOU 错误,实际 {other:?}"),
        }
        // abort 后 pending 清理;窗口 identity 不变;外部内容不被覆盖
        let record = c.window_record(MAIN).unwrap();
        let identity_before = record.file_identity.clone().unwrap();
        assert_eq!(
            c.identity_reservation_of(&identity_before).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "S-B3 编排:旧 identity 不变"
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"suddenly":true}"#);
    }

    #[cfg(unix)]
    #[test]
    fn o1_orchestration_ordinary_save_refreshes_physical() {
        let dir = tmpdir();
        let path = dir.join("a.mm");
        fs::write(&path, r#"{"v":1}"#).unwrap();
        let (c, svc) = coordinator_with_open(&path);
        let before = c
            .window_record(MAIN)
            .unwrap()
            .file_identity
            .clone()
            .unwrap();
        // ordinary commit(锁外)+ 绑定 refreshed(同一 service 流程)+ 刷新(锁内)
        let opened = svc.open_file(MAIN, &path).unwrap();
        let out = match svc
            .commit_ordinary_with_identity(
                MAIN,
                &opened.document_target_handle,
                &opened.version_token,
                r#"{"v":2}"#,
            )
            .unwrap()
        {
            OrdinaryCommitResult::Committed(out) => out,
            OrdinaryCommitResult::CommittedButRefreshPending { .. } => {
                panic!("O1:正常提交不得进入 refresh-pending")
            }
        };
        let refreshed = out.identity;
        // O1:host outcome 的 canonical 恒等于 handle ledger 绑定目标
        assert_eq!(
            refreshed.canonical().as_path(),
            path.canonicalize().unwrap().as_path(),
            "O1:identity 只能来自 handle 绑定目标"
        );
        c.refresh_identity_after_commit(MAIN, &refreshed).unwrap();
        assert_eq!(
            before.canonical(),
            refreshed.canonical(),
            "O1:canonical 连续"
        );
        assert_ne!(before.physical(), refreshed.physical(), "O1:physical 轮换");
        assert_eq!(
            c.identity_reservation_of(&refreshed).map(|(l, _)| l),
            Some(MAIN.to_string())
        );
    }
}

#[cfg(all(test, unix))]
mod b1a_red_tests {
    //! MRT-004B1A 红灯:commit 前后语义分界(PC1/PC2)、ordinary identity
    //! 绑定(O1 registry 腿)。O2(open 注入 provider)与 T3-XW(caller
    //! 参数)为签名演进红灯,记录见红灯证据第二阶段。

    use super::*;
    use crate::lifecycle::launch_coordinator::LaunchCoordinator;
    use crate::lifecycle::window_registry::WindowRegistry;
    use identity::{FileIdentityProvider, IdentityError, UnixFileIdentityProvider};
    use std::fs;
    use std::path::PathBuf;

    const MAIN: &str = "main";
    const W2: &str = "editor-9";

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    fn coordinator_open(path: &Path) -> (LaunchCoordinator, FileLifecycleService, FileIdentity) {
        let svc = FileLifecycleService::new();
        let mut registry = WindowRegistry::new();
        registry.register(MAIN).unwrap();
        let opened = svc
            .open_file_with_identity(&UnixFileIdentityProvider, MAIN, path)
            .unwrap();
        let identity = opened.identity.clone();
        registry.begin_loading(MAIN, &identity, "i-1").unwrap();
        registry.mark_open(MAIN).unwrap();
        let c = LaunchCoordinator::new(registry);
        (c, svc, identity)
    }

    /// PC1 注入:refresh_after_commit 失败(其余委托真实 Unix provider)。
    struct FailRefreshProvider;

    impl FileIdentityProvider for FailRefreshProvider {
        fn resolve_existing(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_existing(p)
        }

        fn resolve_authorized_target(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_authorized_target(p)
        }

        fn refresh_after_commit(&self, _p: &Path) -> Result<FileIdentity, IdentityError> {
            Err(IdentityError::Io("injected refresh failure".into()))
        }
    }

    /// PC2 注入:refresh 成功后经 hard link 让 W2 抢占目标 physical alias,
    /// 使随后的 finalize 撞上占用冲突(写后、换绑前)。
    struct HijackOnRefreshProvider<'a> {
        coordinator: &'a LaunchCoordinator,
        link: PathBuf,
    }

    impl FileIdentityProvider for HijackOnRefreshProvider<'_> {
        fn resolve_existing(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_existing(p)
        }

        fn resolve_authorized_target(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_authorized_target(p)
        }

        fn refresh_after_commit(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            let id = UnixFileIdentityProvider.refresh_after_commit(p)?;
            fs::hard_link(p, &self.link).unwrap();
            let link_id = UnixFileIdentityProvider
                .resolve_existing(&self.link)
                .unwrap();
            self.coordinator.with_registry_mut_for_test(|r| {
                r.register(W2).unwrap();
                r.begin_loading(W2, &link_id, "i-hijack").unwrap();
            });
            Ok(id)
        }
    }

    /// PC1:commit 成功后 refresh 失败 → 目标 bytes 已落盘,不得 abort 释放
    /// fail-closed reservation;错误必须可区分"已提交但换绑未完成"。
    #[test]
    fn red_pc1_refresh_failure_after_commit_keeps_fail_closed_reservation() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, r#"{"v":1}"#).unwrap();
        let target = dir.join("new.mm");
        let (c, svc, old_id) = coordinator_open(&source);
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        let err = orchestrate_save_as(
            &c,
            &svc,
            &FailRefreshProvider,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":2}"#,
        )
        .unwrap_err();
        // 文件已提交(语义上不可回滚)
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":2}"#);
        match &err {
            SaveAsError::CommittedButRebindPending { receipt, .. } => {
                assert!(!receipt.document_target_handle.is_empty());
            }
            other => panic!("PC1:应为 CommittedButRebindPending,实际 {other:?}"),
        }
        // 旧窗口 identity 未被伪装完成换绑
        let record = c.window_record(MAIN).unwrap();
        assert_eq!(record.file_identity, Some(old_id.clone()));
        // fail-closed target reservation 保留:同目标 open 不得抢占/建窗
        let target_now = UnixFileIdentityProvider.resolve_existing(&target).unwrap();
        let _intent = c.enqueue(
            crate::lifecycle::launch_coordinator::LaunchIntentKind::OpenFile {
                identity: target_now.clone(),
            },
            Some(target.display().to_string()),
            2000,
        );
        assert!(
            c.route_next().is_empty(),
            "PC1:同目标 open 必须被 pending 拒绝/deferred"
        );
        // 同目标 Save As prepare 同样被拒(pending 保留)
        c.with_registry_mut_for_test(|r| {
            r.register(W2).unwrap();
            r.mark_blank(W2).unwrap();
        });
        assert_eq!(
            c.prepare_rebind(W2, &target_now).unwrap_err(),
            "IDENTITY_ALREADY_RESERVED",
            "PC1:fail-closed 期间同目标不得形成第二个 pending"
        );
        assert_eq!(
            c.pending_rebind_count(),
            1,
            "PC1:fail-closed pending 保留且可诊断"
        );
    }

    /// PC2:commit 成功后 finalize 撞上占用冲突 → 与 PC1 同样 fail closed,
    /// 且错误可区分"已提交但换绑未完成";不得伪装回滚。
    #[test]
    fn red_pc2_finalize_conflict_after_commit_is_committed_not_rollback() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, r#"{"v":1}"#).unwrap();
        let target = dir.join("new.mm");
        let (c, svc, old_id) = coordinator_open(&source);
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        let hijacker = HijackOnRefreshProvider {
            coordinator: &c,
            link: dir.join("link.mm"),
        };
        let err = orchestrate_save_as(
            &c,
            &svc,
            &hijacker,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":2}"#,
        )
        .unwrap_err();
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":2}"#);
        match &err {
            SaveAsError::CommittedButRebindPending { receipt, .. } => {
                assert!(!receipt.document_target_handle.is_empty());
            }
            other => panic!("PC2:应为 CommittedButRebindPending,实际 {other:?}"),
        }
        // 旧 identity 不变;目标未换绑给 MAIN;hijacker 不被驱逐
        let record = c.window_record(MAIN).unwrap();
        assert_eq!(record.file_identity, Some(old_id.clone()));
        let target_now = UnixFileIdentityProvider.resolve_existing(&target).unwrap();
        // 换绑未完成:目标不得归属 MAIN(hard link 注入使 editor-9 持有
        // 同一 physical alias,属注入的事实,而非 MAIN 的换绑)
        assert_ne!(
            c.identity_reservation_of(&target_now).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "PC2:换绑未完成,目标不得归属 MAIN"
        );
        assert_eq!(
            c.pending_rebind_count(),
            1,
            "PC2:finalize 拒绝后 pending 保留(fail closed)"
        );
    }

    /// O1(registry 腿):ordinary refresh 不得把窗口 canonical 锚点换绑到
    /// 外部文件(换文件必须走 Save As finalize_rebind)。
    #[test]
    fn red_o1_ordinary_refresh_cannot_rebind_to_foreign_canonical() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        let b = dir.join("b.mm");
        fs::write(&a, r#"{"v":1}"#).unwrap();
        fs::write(&b, r#"{"v":1}"#).unwrap();
        let (c, svc, _old) = coordinator_open(&a);
        // loose refresh API 已删除(B1A-F2);直接 provider 解析 B 的身份,
        // registry 必须拒绝 canonical 跳变(旧实现在此放行 → 红灯)
        let b_identity = UnixFileIdentityProvider.resolve_existing(&b).unwrap();
        assert_eq!(
            c.refresh_identity_after_commit(MAIN, &b_identity)
                .unwrap_err(),
            "IDENTITY_CANONICAL_MISMATCH",
            "O1:ordinary refresh 不得改变 canonical 锚点"
        );
        // 绑定腿:ordinary commit 的 host outcome 只能给出 handle 绑定的 A
        let reopened = svc.open_file(MAIN, &a).unwrap();
        let out = match svc
            .commit_ordinary_with_identity(
                MAIN,
                &reopened.document_target_handle,
                &reopened.version_token,
                r#"{"v":2}"#,
            )
            .unwrap()
        {
            OrdinaryCommitResult::Committed(out) => out,
            OrdinaryCommitResult::CommittedButRefreshPending { .. } => {
                panic!("O1:正常提交不得进入 refresh-pending")
            }
        };
        assert_eq!(
            out.identity.canonical().as_path(),
            a.canonicalize().unwrap().as_path(),
            "O1:host outcome identity 只能是 handle ledger 的 A"
        );
        assert_eq!(out.canonical_target, out.identity.canonical().clone());
        assert_eq!(
            c.identity_reservation_of(&b_identity),
            None,
            "O1:B 不因 ordinary commit 归属任何窗口"
        );
    }

    /// O2:open 的 host identity 必须来自注入 provider 收到的无损 canonical
    /// Path(不得经 displayPath → PathBuf 反推);identity/handle/token
    /// 属于同一打开目标。
    struct RecordingProvider {
        received: std::sync::Mutex<Vec<PathBuf>>,
    }

    impl FileIdentityProvider for RecordingProvider {
        fn resolve_existing(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            self.received.lock().unwrap().push(p.to_path_buf());
            UnixFileIdentityProvider.resolve_existing(p)
        }

        fn resolve_authorized_target(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            self.received.lock().unwrap().push(p.to_path_buf());
            UnixFileIdentityProvider.resolve_authorized_target(p)
        }

        fn refresh_after_commit(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            self.received.lock().unwrap().push(p.to_path_buf());
            UnixFileIdentityProvider.refresh_after_commit(p)
        }
    }

    #[test]
    fn o2_open_identity_resolved_from_lossless_canonical_path() {
        let dir = tmpdir();
        let real = dir.join("real.mm");
        fs::write(&real, r#"{"v":1}"#).unwrap();
        let link = dir.join("link.mm");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let svc = FileLifecycleService::new();
        let provider = RecordingProvider {
            received: std::sync::Mutex::new(Vec::new()),
        };
        let out = svc.open_file_with_identity(&provider, MAIN, &link).unwrap();
        // provider 收到的必须是已 canonicalize 的无损 Path(symlink 已解析),
        // 与内容读取、handle 签发同一目标
        let canon = real.canonicalize().unwrap();
        assert!(
            !provider.received.lock().unwrap().is_empty(),
            "O2:host 必须经注入 provider 解析 identity(不经 display 反推)"
        );
        for p in provider.received.lock().unwrap().iter() {
            assert_eq!(
                p, &canon,
                "O2:provider 收到无损 canonical Path,不是 display 串重建"
            );
        }
        let direct = UnixFileIdentityProvider.resolve_existing(&canon).unwrap();
        assert_eq!(out.identity, direct, "O2:identity 与 provider 同源");
        assert!(!out.renderer.document_target_handle.is_empty());
        assert_eq!(out.renderer.version_token, sha256_hex(br#"{"v":1}"#));
    }

    /// O2 纵深：即使注入 provider 返回另一个文件的有效 identity，host
    /// outcome 也必须在签发 handle 前拒绝，不能让内容/handle 与 identity
    /// 指向不同 canonical target。
    struct WrongOpenIdentityProvider {
        other: PathBuf,
    }

    impl FileIdentityProvider for WrongOpenIdentityProvider {
        fn resolve_existing(&self, _p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_existing(&self.other)
        }

        fn resolve_authorized_target(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_authorized_target(p)
        }

        fn refresh_after_commit(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.refresh_after_commit(p)
        }
    }

    #[test]
    fn o2_open_rejects_provider_identity_for_another_canonical_target() {
        let dir = tmpdir();
        let opened_path = dir.join("opened.mm");
        let other_path = dir.join("other.mm");
        fs::write(&opened_path, r#"{"opened":true}"#).unwrap();
        fs::write(&other_path, r#"{"other":true}"#).unwrap();
        let svc = FileLifecycleService::new();
        let provider = WrongOpenIdentityProvider { other: other_path };

        let err = svc
            .open_file_with_identity(&provider, MAIN, &opened_path)
            .unwrap_err();
        assert_eq!(err.0.code, "FILE_IO_ERROR");
        assert!(err.0.message.contains("identity 与实际打开目标不一致"));
    }

    /// O1 写后纵深：provider 若返回另一个 canonical，bytes 已提交的事实
    /// 仍必须经 recovery outcome 交付，不能退化成可重试的普通保存失败。
    struct WrongRefreshIdentityProvider {
        other: PathBuf,
    }

    impl FileIdentityProvider for WrongRefreshIdentityProvider {
        fn resolve_existing(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_existing(p)
        }

        fn resolve_authorized_target(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_authorized_target(p)
        }

        fn refresh_after_commit(&self, _p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_existing(&self.other)
        }
    }

    #[test]
    fn o1_refresh_canonical_mismatch_preserves_post_commit_receipt() {
        let dir = tmpdir();
        let path = dir.join("ordinary.mm");
        let other = dir.join("other.mm");
        fs::write(&path, r#"{"v":1}"#).unwrap();
        fs::write(&other, r#"{"other":true}"#).unwrap();
        let svc = FileLifecycleService::new();
        let opened = svc.open_file(MAIN, &path).unwrap();
        let provider = WrongRefreshIdentityProvider { other };

        let result = svc
            .commit_ordinary_with_identity_from(
                &provider,
                MAIN,
                &opened.document_target_handle,
                &opened.version_token,
                r#"{"v":2}"#,
            )
            .unwrap();

        match result {
            OrdinaryCommitResult::CommittedButRefreshPending {
                receipt,
                canonical_target,
                cause,
            } => {
                assert_eq!(receipt.version_token, sha256_hex(br#"{"v":2}"#));
                assert_eq!(canonical_target.as_path(), path.canonicalize().unwrap());
                assert_eq!(cause.0.code, "FILE_IO_ERROR");
                assert!(cause.0.message.contains("绑定目标不一致"));
            }
            OrdinaryCommitResult::Committed(_) => {
                panic!("canonical mismatch 不得伪装为完整提交")
            }
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"v":2}"#);
    }

    /// PF1:redeem/TOCTOU/commit 失败 → 文件未提交、pending 清理、旧
    /// identity 不变(pre-commit 规则;区别于 PC1/PC2 的写后 fail closed)。
    #[test]
    fn pf1_pre_commit_failure_cleans_pending_and_keeps_old_identity() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, r#"{"v":1}"#).unwrap();
        let target = dir.join("new.mm");
        let (c, svc, old_id) = coordinator_open(&source);
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        // 授权后目标被外部创建 → commit 失败(TARGET_APPEARED)
        fs::write(&target, r#"{"suddenly":true}"#).unwrap();
        let err = orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":2}"#,
        )
        .unwrap_err();
        match err {
            SaveAsError::PreCommit(PreCommitError::Commit(e)) => {
                assert_eq!(e.0.code, "TARGET_APPEARED")
            }
            other => panic!("PF1:应为写前 commit 失败,实际 {other:?}"),
        }
        assert_eq!(c.pending_rebind_count(), 0, "PF1:pending 已清理");
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"suddenly":true}"#);
        let record = c.window_record(MAIN).unwrap();
        assert_eq!(record.file_identity, Some(old_id.clone()));
        assert_eq!(
            c.identity_reservation_of(&old_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "PF1:旧 identity 归属不变"
        );
    }

    /// 写前绑定:provider 对授权目标解析出不同 canonical → 写前稳定拒绝,
    /// 零 commit、零 pending(B1A.3:Save As prepare identity 的 canonical
    /// 必须等于 ledger plan 的 canonical target)。
    struct WrongTargetProvider {
        other: PathBuf,
    }

    impl FileIdentityProvider for WrongTargetProvider {
        fn resolve_existing(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_existing(p)
        }

        fn resolve_authorized_target(&self, _p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.resolve_authorized_target(&self.other)
        }

        fn refresh_after_commit(&self, p: &Path) -> Result<FileIdentity, IdentityError> {
            UnixFileIdentityProvider.refresh_after_commit(p)
        }
    }

    #[test]
    fn pre_commit_provider_target_binding_mismatch_rejected_before_write() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, r#"{"v":1}"#).unwrap();
        let target = dir.join("new.mm");
        let decoy = dir.join("decoy.mm");
        let (c, svc, old_id) = coordinator_open(&source);
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        let wrong = WrongTargetProvider {
            other: decoy.clone(),
        };
        let err = orchestrate_save_as(
            &c,
            &svc,
            &wrong,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":2}"#,
        )
        .unwrap_err();
        match err {
            SaveAsError::PreCommit(PreCommitError::TargetBindingMismatch) => {}
            other => panic!("应为写前绑定错配拒绝,实际 {other:?}"),
        }
        assert!(
            !target.exists() && !decoy.exists(),
            "绑定错配:零 commit(任何目标都不得被写)"
        );
        assert_eq!(c.pending_rebind_count(), 0, "绑定错配:零 pending");
        assert_eq!(
            c.window_record(MAIN).unwrap().file_identity,
            Some(old_id.clone()),
            "绑定错配:旧 identity 不变"
        );
    }

    /// AP2:同一授权被第二窗口使用 → 写前拒绝(plan 跨窗校验);至多一个
    /// commit 成功,第二条路径零 pending 泄漏。
    #[test]
    fn ap2_same_authorization_second_window_rejected_single_commit() {
        let dir = tmpdir();
        let target = dir.join("new.mm");
        let svc = FileLifecycleService::new();
        let mut registry = WindowRegistry::new();
        registry.register(MAIN).unwrap();
        registry.mark_blank(MAIN).unwrap();
        registry.register(W2).unwrap();
        registry.mark_blank(W2).unwrap();
        let c = LaunchCoordinator::new(registry);
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        // 第一窗口成功(redeem 消耗)
        orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            MAIN,
            &grant.authorization_ref,
            r#"{"v":1}"#,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":1}"#);
        // 第二窗口同授权:plan 跨窗拒绝,零 commit/零 pending
        let err = orchestrate_save_as(
            &c,
            &svc,
            &UnixFileIdentityProvider,
            W2,
            &grant.authorization_ref,
            r#"{"v":2}"#,
        )
        .unwrap_err();
        match err {
            SaveAsError::PreCommit(PreCommitError::Plan(e)) => {
                assert_eq!(e.0.code, "INVALID_TARGET_AUTHORIZATION")
            }
            other => panic!("AP2:应为写前授权层拒绝,实际 {other:?}"),
        }
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":1}"#);
        assert_eq!(
            c.pending_rebind_count(),
            0,
            "AP2:no pending leak on second path"
        );
        // W2 未被第二路径影响:保持 Blank 无 identity
        let w2 = c.window_record(W2).unwrap();
        assert_eq!(
            w2.file_identity, None,
            "AP2:second window must not be rebound"
        );
    }

    // ---- PRC-020: Descriptor-bound open 协议测试 ----

    struct SwapSimulatingProvider<'a> {
        inner: &'a dyn FileIdentityProvider,
        path_to_swap: PathBuf,
        swapped_identity: FileIdentity,
    }

    impl<'a> FileIdentityProvider for SwapSimulatingProvider<'a> {
        fn resolve_descriptor(
            &self,
            canonical: &Path,
            file: &std::fs::File,
        ) -> Result<FileIdentity, IdentityError> {
            self.inner.resolve_descriptor(canonical, file)
        }

        fn resolve_existing(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
            if path == self.path_to_swap {
                Ok(self.swapped_identity.clone())
            } else {
                self.inner.resolve_existing(path)
            }
        }

        fn resolve_authorized_target(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
            self.inner.resolve_authorized_target(path)
        }

        fn refresh_after_commit(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
            self.inner.refresh_after_commit(path)
        }
    }

    #[test]
    fn prc_020_descriptor_bound_open_detects_path_swap_and_leaves_no_orphan_handle() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("doc.mindmap");
        fs::write(&target, r#"{"version":1,"nodes":[]}"#).unwrap();

        let svc = FileLifecycleService::new();
        let canon = std::fs::canonicalize(&target).unwrap();
        let real_id = UnixFileIdentityProvider.resolve_existing(&canon).unwrap();

        // 构造一个模拟外部进程把 target 替换成另一个新文件的 provider
        let swapped_id =
            FileIdentity::synthetic_with_physical(canon.to_str().unwrap(), 9999, 888888);
        assert_ne!(real_id, swapped_id);

        let swapping_provider = SwapSimulatingProvider {
            inner: &UnixFileIdentityProvider,
            path_to_swap: canon.clone(),
            swapped_identity: swapped_id,
        };

        // 执行打开：底层文件描述符打开真实文件，但在二次验证时发现当前路径物理身份被替换
        let res = svc.open_file_with_identity(&swapping_provider, MAIN, &target);
        let err_msg = res.unwrap_err().0.message;
        assert!(err_msg.contains("open identity 与实际打开目标不一致"));

        // 断言失败路径没有签发 orphan handle
        assert_eq!(
            svc.document_handle_count(MAIN),
            0,
            "失败路径不得残留 orphan handle"
        );
    }

    #[test]
    fn prc_020_descriptor_bound_open_normal_matches_and_issues_handle() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("doc.mindmap");
        fs::write(&target, r#"{"version":1,"nodes":[{"id":"root"}]}"#).unwrap();

        let svc = FileLifecycleService::new();
        let out = svc
            .open_file_with_identity(&UnixFileIdentityProvider, MAIN, &target)
            .unwrap();

        assert_eq!(
            out.renderer.content_json,
            r#"{"version":1,"nodes":[{"id":"root"}]}"#
        );
        assert_eq!(svc.document_handle_count(MAIN), 1);
        assert!(svc
            .validate_document_handle(MAIN, &out.renderer.document_target_handle)
            .is_ok());
    }
}
