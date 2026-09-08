//! LifecycleRuntime(MRT-004 Wave 2 §5C1):生产 host runtime 与 effect
//! executor——把 Wave 1 已验收的纯状态机(WindowRegistry/LaunchCoordinator)
//! 接入真实窗口/文件/native source 路径的唯一组合层。
//!
//! 职责边界(任务卡 §5C):
//! - **host 单 owner**(§4.1):runtime 持有 `Arc<LaunchCoordinator>`、
//!   `Arc<FileLifecycleService>`、identity provider 与 post-commit
//!   recovery 记录;生产装配只 manage 一个 runtime,不再运行旧
//!   `LaunchIntentStore`;
//! - **effect executor**(C2):`CreateWindow/FocusWindow/DeliverBootstrap/
//!   ShowRetryableError/AckIntent` 的真实副作用经 `HostEffectSink` 执行
//!   (生产 Tauri/测试 fake);effect 先从 reducer 取出、在锁外执行、再以
//!   correlation result 回报——coordinator lock 内零 Tauri API/emit/
//!   文件 I/O/dialog;
//! - **single-drain gate**(C1):多个 native callback 同时触发 drain 时,
//!   同一 effect 不执行两次;drain 是"路由到稳定等待点"的有限循环,
//!   无空转、无 sleep、无自动 retry;
//! - **startup barrier**(C1):冷启动带文件必须让第一个文件占用 main;
//!   无文件才确认 main Blank;判定基于事件事实(argv 在进程启动时即存在、
//!   coordinator 队列状态),不靠延时猜测 Opened 时序(实测顺序见
//!   Wave 2 evidence);
//! - **post-commit recovery**(§4.3):`CommittedButRebindPending` /
//!   `CommittedButRefreshPending` 的 host-only 记录与一次显式有限恢复
//!   通道;rebind token 不出 host。
//!
//! 本模块不直接依赖 tauri(副作用全部经 `HostEffectSink`);生产 sink 在
//! ipc 层,fake sink 在测试。

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::file::error::IpcError;
use crate::file::identity::{CanonicalPathKey, FileIdentity, FileIdentityProvider};
use crate::file::{
    orchestrate_save_as_with_generation, Clock, CommitHostOutcome, FileLifecycleService,
    OpenOutcome, OrdinaryCommitResult, PreCommitError, Receipt, SaveAsError,
};
use crate::lifecycle::launch_coordinator::{
    self, AckSummary, BootstrapKind, Effect, EffectResult, LaunchCoordinator, LaunchIntentKind,
    PendingBootstrap, RendererOutcome, StartupDecision,
};
use crate::lifecycle::window_registry::WindowState;
use crate::lifecycle::window_registry::IDENTITY_CANONICAL_MISMATCH;

/// 稳定错误码(TS `PLATFORM_ERROR_CODES` 对齐;拼写不得更改)。
pub const STALE_BOOTSTRAP_COMPLETION: &str = "STALE_BOOTSTRAP_COMPLETION";
pub const INVALID_INTENT_ACTION: &str = "INVALID_INTENT_ACTION";
pub const RECOVERY_PENDING: &str = "RECOVERY_PENDING";

// ---- 副作用 sink(§4.1:全部在 coordinator lock 外调用) ----

/// 定向 bootstrap 事件的执行状态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmitStatus {
    /// 已 emit 到目标窗口。
    Emitted,
    /// 窗口尚未创建(冷启动静态 main 先于 WebView 就绪):交付已持久化,
    /// 由 renderer `platform_window_ready` 快照承接——不算失败(PR4)。
    WindowNotReady,
    /// emit 失败(窗口存在但 IPC 层故障)→ retryable。
    Failed(String),
}

/// renderer 侧 bootstrap 事件 payload(serde camelCase/kebab-case,与 TS
/// `WindowBootstrap` 判别联合一一对应;canonicalPath 仅展示投影,§4.2)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BootstrapEvent {
    #[serde(rename_all = "camelCase")]
    OpenPath {
        delivery_id: String,
        intent_id: String,
        canonical_path: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Blank {
        delivery_id: String,
        intent_id: String,
    },
}

impl BootstrapEvent {
    fn from_pending(p: &PendingBootstrap) -> Self {
        match p.kind {
            BootstrapKind::OpenPath => Self::OpenPath {
                delivery_id: p.delivery_id.clone(),
                intent_id: p.intent_id.clone(),
                canonical_path: p.canonical_path.clone(),
            },
            BootstrapKind::Blank => Self::Blank {
                delivery_id: p.delivery_id.clone(),
                intent_id: p.intent_id.clone(),
            },
        }
    }
}

/// 定向 retryable-error 事件 payload。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchErrorEvent {
    pub intent_id: String,
    pub reason: String,
}

/// host 可查询的 retryable 错误快照(intent 级;kind 供 UI 描述)。
/// W2R-F1(H1):错误记录为 caller-bound——呈现所有权(窗口 label+generation)
/// 决定唯一可见窗口;origin Failed 窗口供诊断/收口;快照查询与 retry/dismiss
/// 动作都按 caller 校验,不再全局可消费。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchErrorSnapshot {
    pub intent_id: String,
    pub reason: String,
    /// "open-file" | "activation" | "source"。
    pub kind: &'static str,
    pub received_at_ms: i64,
    /// 呈现窗口(唯一拥有者);None = host-only 未呈现(呈现窗口销毁且无
    /// 可转移目标)——任何窗口都查不到,只能等待转移或进程内后续动作。
    pub presentation_window_label: Option<String>,
    /// 呈现绑定时的窗口 generation(同名窗口重建后失配 → 不可见)。
    pub presentation_window_generation: u64,
    /// origin Failed 窗口(该错误由哪个窗口的 bootstrap 失败产生;
    /// source/create 失败无 origin)。
    pub origin_failed_window_label: Option<String>,
    /// source 错误的原始路径(retry 重新解析用;不序列化进 renderer)。
    #[serde(skip)]
    pub raw_path: Option<std::path::PathBuf>,
}

impl PartialEq for LaunchErrorSnapshot {
    fn eq(&self, other: &Self) -> bool {
        self.intent_id == other.intent_id
            && self.reason == other.reason
            && self.kind == other.kind
            && self.received_at_ms == other.received_at_ms
            && self.presentation_window_label == other.presentation_window_label
            && self.presentation_window_generation == other.presentation_window_generation
            && self.origin_failed_window_label == other.origin_failed_window_label
    }
}

impl Eq for LaunchErrorSnapshot {}

/// effect 副作用注入(生产 Tauri / 测试 fake)。所有方法不得触碰
/// coordinator 内部锁(runtime 已保证调用点在锁外)。
pub trait HostEffectSink: Send + Sync {
    /// 创建唯一 `editor-*` WebView(与既有 app URL/默认窗口配置一致)。
    fn create_editor_window(&self, label: &str) -> Result<(), String>;
    /// show + unminimize + set_focus;任一步失败返回明确 reason。
    fn focus_window(&self, label: &str) -> Result<(), String>;
    /// 只对目标 WebviewWindow emit bootstrap。
    fn emit_bootstrap(&self, label: &str, payload: &BootstrapEvent) -> EmitStatus;
    /// 定向 emit retryable error(呈现窗口)。
    fn emit_launch_error(&self, label: &str, payload: &LaunchErrorEvent);
    /// 选择错误呈现窗口(最近聚焦窗口优先,其次 main,其次任一存在窗口;
    /// 不做全局广播——§5C2)。
    fn error_presentation_window(&self) -> Option<String>;
}

/// `Arc` 转发(生产/测试共享同一 sink 实例)。
impl<T: HostEffectSink + ?Sized> HostEffectSink for Arc<T> {
    fn create_editor_window(&self, label: &str) -> Result<(), String> {
        (**self).create_editor_window(label)
    }
    fn focus_window(&self, label: &str) -> Result<(), String> {
        (**self).focus_window(label)
    }
    fn emit_bootstrap(&self, label: &str, payload: &BootstrapEvent) -> EmitStatus {
        (**self).emit_bootstrap(label, payload)
    }
    fn emit_launch_error(&self, label: &str, payload: &LaunchErrorEvent) {
        (**self).emit_launch_error(label, payload)
    }
    fn error_presentation_window(&self) -> Option<String> {
        (**self).error_presentation_window()
    }
}

// ---- post-commit recovery(§4.3;host-only,rebind token 不出 host) ----

/// recovery 记录:bytes 已落盘、registry 换绑/刷新未完成的 fail-closed
/// 事实。绑定 window label + generation(Destroyed 幂等清理)。
#[derive(Debug, Clone)]
pub struct PostCommitRecovery {
    pub window_label: String,
    pub window_generation: u64,
    pub receipt: Receipt,
    pub kind: RecoveryKind,
}

#[derive(Debug, Clone)]
pub enum RecoveryKind {
    /// Save As:fail-closed pending rebind 仍在 registry;恢复 = 刷新 +
    /// finalize_rebind(token 不出 host)。
    SaveAsRebind {
        token: String,
        canonical_target: CanonicalPathKey,
    },
    /// ordinary:registry 刷新未完成;恢复 = 刷新 + refresh_identity_after_commit。
    OrdinaryRefresh { canonical_target: CanonicalPathKey },
}

/// renderer 可见的 recovery 投影(无 token/canonical/capability)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRecoverySnapshot {
    pub display_path: String,
    pub cause: String,
}

/// 一次 host 操作的最小绑定(H1)：锁外 I/O 前捕获窗口 label + generation；
/// 所有写后 registry/recovery 副作用都必须通过这份绑定回到当前代。
#[derive(Debug, Clone, PartialEq, Eq)]
struct OperationBinding {
    window_label: String,
    window_generation: u64,
}

// ---- runtime ----

/// 生产 host runtime(§5C1 结构;单实例,由 lib.rs manage)。
pub struct LifecycleRuntime {
    pub coordinator: Arc<LaunchCoordinator>,
    pub file_service: Arc<FileLifecycleService>,
    provider: Arc<dyn FileIdentityProvider>,
    clock: Box<dyn Clock>,
    /// single-drain gate:并发 native callback 串行化,同一 effect 不重复。
    drain_gate: Mutex<()>,
    /// retryable launch 错误快照(intentId/sourceId → 快照)。
    launch_errors: Mutex<BTreeMap<String, LaunchErrorSnapshot>>,
    /// post-commit recovery(window label → 记录;同窗同时至多一条)。
    recoveries: Mutex<HashMap<String, PostCommitRecovery>>,
    /// W2R-F5(H4):同窗 commit/recovery 串行门(per-window;其他窗口并行)。
    commit_gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// 窗口 Destroyed 与锁外操作完成之间的短临界区；不跨文件 I/O，
    /// 只保证 generation 校验、recovery 记录和销毁清理不会交叉。
    lifecycle_gate: Mutex<()>,
    source_error_counter: std::sync::atomic::AtomicU64,
}

impl LifecycleRuntime {
    /// 初始化。默认 `main` 的 Booting generation 登记由调用方在构造
    /// registry 时完成(lib.rs);runtime 不重复登记。
    pub fn new(
        coordinator: Arc<LaunchCoordinator>,
        file_service: Arc<FileLifecycleService>,
        provider: Arc<dyn FileIdentityProvider>,
        clock: Box<dyn Clock>,
    ) -> Self {
        Self {
            coordinator,
            file_service,
            provider,
            clock,
            drain_gate: Mutex::new(()),
            launch_errors: Mutex::new(BTreeMap::new()),
            recoveries: Mutex::new(HashMap::new()),
            commit_gates: Mutex::new(HashMap::new()),
            lifecycle_gate: Mutex::new(()),
            source_error_counter: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// W2R-F5(H4):同窗串行门——commit 与 recovery resolve 在同一窗口上
    /// 互斥(其他窗口不受影响);Destroyed 清理不取门(不得阻塞 UI 线程),
    /// 其正确性由 generation 校验保证。
    fn window_gate(&self, label: &str) -> Arc<Mutex<()>> {
        let mut gates = self.commit_gates.lock().unwrap();
        gates
            .entry(label.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// 捕获一份写后操作绑定。旧代 recovery 若因异常路径残留，在新代
    /// 开始新操作前清除；当前代 recovery 仍然阻止保存。
    fn begin_operation_binding(&self, label: &str) -> Result<OperationBinding, IpcError> {
        let _lifecycle = self
            .lifecycle_gate
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let Some(generation) = self.coordinator.window_generation(label) else {
            return Err(IpcError::new("FILE_IO_ERROR", "当前窗口不存在，操作已失效"));
        };
        let mut recoveries = self.recoveries.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(record) = recoveries.get(label) {
            if record.window_generation == generation {
                return Err(IpcError::new(
                    RECOVERY_PENDING,
                    "该窗口有未完成的保存恢复，请先完成恢复",
                ));
            }
            recoveries.remove(label);
        }
        Ok(OperationBinding {
            window_label: label.to_string(),
            window_generation: generation,
        })
    }

    /// 错误呈现所有权绑定(W2R-F1):选择呈现窗口并捕获其当前 generation。
    /// 呈现窗口必须真实存在,否则 host-only(None)。
    fn presentation_binding(&self, sink: &dyn HostEffectSink) -> (Option<String>, u64) {
        match sink.error_presentation_window() {
            Some(label) => {
                let generation = self.coordinator.window_generation(&label).unwrap_or(0);
                (Some(label), generation)
            }
            None => (None, 0),
        }
    }

    /// 记录/覆盖错误快照并定向 emit(呈现窗口唯一可见)。
    fn record_launch_error(&self, sink: &dyn HostEffectSink, mut snapshot: LaunchErrorSnapshot) {
        let (label, generation) = self.presentation_binding(sink);
        snapshot.presentation_window_label = label.clone();
        snapshot.presentation_window_generation = generation;
        let event = LaunchErrorEvent {
            intent_id: snapshot.intent_id.clone(),
            reason: snapshot.reason.clone(),
        };
        self.launch_errors
            .lock()
            .unwrap()
            .insert(snapshot.intent_id.clone(), snapshot);
        if let Some(label) = label {
            sink.emit_launch_error(&label, &event);
        } else {
            eprintln!(
                "[lifecycle] 错误 {} 暂无可呈现窗口(host-only):{}",
                event.intent_id, event.reason
            );
        }
    }

    /// caller 是否拥有该错误(呈现所有权校验):呈现窗口 == caller 且
    /// generation 与当前一致(同名窗口重建后失配 → 不拥有)。
    fn caller_owns_error(&self, caller: &str, snapshot: &LaunchErrorSnapshot) -> bool {
        snapshot.presentation_window_label.as_deref() == Some(caller)
            && self
                .coordinator
                .window_generation(caller)
                .is_some_and(|g| g == snapshot.presentation_window_generation)
    }

    // ---- D1:native source 唯一 ingest ----

    /// argv(cold start):只解析真实候选文件(存在且是文件),顺序保持;
    /// flags/目录/不存在路径忽略(诊断日志)。cold 入队发生在任何 drain
    /// 之前(setup 时统一 drain),第一个文件占用 main 由路由事实保证。
    pub fn ingest_argv(&self, sink: &dyn HostEffectSink, argv: &[String]) {
        for arg in argv.iter().skip(1) {
            let path = std::path::PathBuf::from(arg);
            if !path.is_file() {
                eprintln!("[lifecycle] argv 忽略非候选参数：{}", path.display());
                continue;
            }
            self.ingest_open_path(sink, &path);
        }
    }

    /// single-instance(warm 第二实例):有有效文件参数则逐条 open;没有
    /// 则恰好一个 activation(不把 flags 当文件,D1/N3)。
    pub fn ingest_second_instance(&self, sink: &dyn HostEffectSink, argv: &[String]) {
        let files: Vec<std::path::PathBuf> = argv
            .iter()
            .skip(1)
            .map(std::path::PathBuf::from)
            .filter(|p| p.is_file())
            .collect();
        if files.is_empty() {
            eprintln!("[lifecycle] second-instance 无文件参数 → 恰好一个 activation");
            self.enqueue_activation(sink);
            return;
        }
        for path in files {
            self.ingest_open_path(sink, &path);
        }
    }

    /// 系统 open 入口(`RunEvent::Opened`/Finder/工具条请求):provider 在
    /// coordinator lock 外解析 identity;成功以 host 无损 target 入队并
    /// drain;失败形成可见、可 dismiss 的 retryable source error,不静默
    /// 忽略(D1)。
    pub fn ingest_open_path(&self, sink: &dyn HostEffectSink, path: &Path) {
        match self.provider.resolve_existing(path) {
            Ok(identity) => {
                eprintln!(
                    "[lifecycle] open-file 入队：{}",
                    identity.canonical().display_lossy()
                );
                self.enqueue_open_identity(sink, identity);
            }
            Err(e) => {
                eprintln!("[lifecycle] open-file 解析失败：{} ({e})", path.display());
                self.report_source_error(sink, path, e.to_string());
            }
        }
    }

    /// macOS Reopen(Dock/图标点击):warm(有可见窗口)每次恰好一个新空白
    /// activation;无可见窗口且冷启动 main 尚未确认时忽略(不多出空窗,
    /// main 由 startup barrier 处理;D1/N4)。
    pub fn ingest_reopen(&self, sink: &dyn HostEffectSink, has_visible_windows: bool) {
        if has_visible_windows {
            eprintln!("[lifecycle] Reopen(warm) → 一个新空白 activation");
            self.enqueue_activation(sink);
            return;
        }
        let cold_main_pending = self
            .coordinator
            .window_record("main")
            .is_some_and(|r| r.state == WindowState::Booting);
        if cold_main_pending {
            eprintln!("[lifecycle] Reopen(cold main 未确认) → 忽略，由 startup barrier 承担");
            return;
        }
        eprintln!("[lifecycle] Reopen(无可用窗口) → 一个新空白 activation");
        self.enqueue_activation(sink);
    }

    /// 工具条/菜单"新建窗口"与应用内激活入口:activation 每 intent 各建
    /// 新空白窗(Q4)。
    pub fn ingest_activation(&self, sink: &dyn HostEffectSink) {
        self.enqueue_activation(sink);
    }

    fn enqueue_open_identity(&self, sink: &dyn HostEffectSink, identity: FileIdentity) {
        let display = identity.canonical().display_lossy().to_string();
        self.coordinator.enqueue(
            LaunchIntentKind::OpenFile { identity },
            Some(display),
            self.clock.now_ms(),
        );
        self.drain(sink);
    }

    fn enqueue_activation(&self, sink: &dyn HostEffectSink) {
        self.coordinator
            .enqueue(LaunchIntentKind::Activation, None, self.clock.now_ms());
        self.drain(sink);
    }

    /// source 解析失败的可见错误(runtime 级伪 id;retry 重新解析,
    /// dismiss 清除;不进 coordinator——identity 不存在无法构造 intent)。
    /// W2R-F1:与 intent 错误同一呈现所有权协议。
    fn report_source_error(&self, sink: &dyn HostEffectSink, raw: &Path, reason: String) {
        let n = self
            .source_error_counter
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let id = format!("source-{n}-{}", uuid::Uuid::new_v4().simple());
        let message = format!("无法打开 {}：{reason}", raw.display());
        self.record_launch_error(
            sink,
            LaunchErrorSnapshot {
                intent_id: id,
                reason: message,
                kind: "source",
                received_at_ms: self.clock.now_ms(),
                presentation_window_label: None,
                presentation_window_generation: 0,
                origin_failed_window_label: None,
                raw_path: Some(raw.to_path_buf()),
            },
        );
    }

    // ---- C1/C2:drain 与 effect executor ----

    /// 路由到稳定等待点:反复 `route_next` 直到无新 effect。single-drain
    /// gate 保证并发触发串行;每轮 routing 必推进到 assigned/retryable/
    /// terminal 之一,循环有限(§5C2 禁 while 空转/sleep/自动 retry)。
    pub fn drain(&self, sink: &dyn HostEffectSink) {
        let _guard = self.drain_gate.lock().unwrap_or_else(|p| p.into_inner());
        loop {
            let effects = self.coordinator.route_next();
            if effects.is_empty() {
                return;
            }
            self.execute_effects(sink, effects);
        }
    }

    /// 执行一批 effect:副作用在锁外执行,结果经 correlation 回报;回报
    /// 产生的新 effect(ack/error/下一交付)立即链式执行(深度受状态机
    /// 链长限制,≤3)。
    fn execute_effects(&self, sink: &dyn HostEffectSink, effects: Vec<Effect>) {
        for effect in effects {
            match effect {
                Effect::CreateWindow { intent_id, label } => {
                    eprintln!("[lifecycle] effect CreateWindow {label}");
                    let result = sink.create_editor_window(&label);
                    let next = self
                        .coordinator
                        .on_effect_result(&EffectResult::WindowCreated {
                            intent_id,
                            label,
                            ok: result.is_ok(),
                            reason: result.err(),
                        })
                        .unwrap_or_else(|code| {
                            eprintln!("[lifecycle] CreateWindow 回报被拒（{code}）");
                            Vec::new()
                        });
                    self.execute_effects(sink, next);
                }
                Effect::FocusWindow { intent_id, label } => {
                    eprintln!("[lifecycle] effect FocusWindow {label}");
                    let result = sink.focus_window(&label);
                    let next = self
                        .coordinator
                        .on_effect_result(&EffectResult::WindowFocused {
                            intent_id,
                            label,
                            ok: result.is_ok(),
                            reason: result.err(),
                        })
                        .unwrap_or_else(|code| {
                            eprintln!("[lifecycle] FocusWindow 回报被拒（{code}）");
                            Vec::new()
                        });
                    self.execute_effects(sink, next);
                }
                Effect::DeliverBootstrap {
                    intent_id,
                    label,
                    delivery_id,
                    kind,
                    canonical_path,
                } => {
                    eprintln!("[lifecycle] effect DeliverBootstrap {label} {delivery_id}");
                    let payload = match kind {
                        BootstrapKind::OpenPath => BootstrapEvent::OpenPath {
                            delivery_id: delivery_id.clone(),
                            intent_id: intent_id.clone(),
                            canonical_path,
                        },
                        BootstrapKind::Blank => BootstrapEvent::Blank {
                            delivery_id: delivery_id.clone(),
                            intent_id: intent_id.clone(),
                        },
                    };
                    let status = sink.emit_bootstrap(&label, &payload);
                    let (ok, reason) = match status {
                        EmitStatus::Emitted | EmitStatus::WindowNotReady => (true, None),
                        EmitStatus::Failed(reason) => (false, Some(reason)),
                    };
                    // WindowNotReady 也算交付成功:snapshot 已持久化,由
                    // renderer ready 快照承接;emit 成功 ≠ renderer terminal
                    // (ack 条件是 renderer outcome,PR4)。
                    let next = self
                        .coordinator
                        .on_effect_result(&EffectResult::BootstrapDelivered {
                            intent_id,
                            label,
                            delivery_id,
                            ok,
                            reason,
                        })
                        .unwrap_or_else(|code| {
                            eprintln!("[lifecycle] DeliverBootstrap 回报被拒（{code}）");
                            Vec::new()
                        });
                    self.execute_effects(sink, next);
                }
                Effect::AckIntent { intent_id } => {
                    // 一次性清理;重复 ack 零副作用(C2)。
                    self.coordinator.complete_ack(&intent_id);
                    self.launch_errors.lock().unwrap().remove(&intent_id);
                }
                Effect::ShowRetryableError { intent_id, reason } => {
                    eprintln!("[lifecycle] retryable-error {intent_id}: {reason}");
                    let kind = match self.coordinator.intent_kind_of(&intent_id) {
                        Some(LaunchIntentKind::OpenFile { .. }) => "open-file",
                        Some(LaunchIntentKind::Activation) => "activation",
                        None => "unknown",
                    };
                    let received = self.coordinator.received_at_of(&intent_id);
                    // W2R-F1:错误绑定唯一呈现窗口;origin Failed 窗口一并记录
                    //(W2R-F2 原窗 retry/dismiss 收口的诊断事实)。
                    let origin = self.coordinator.failed_window_of(&intent_id);
                    if let Some(origin) = &origin {
                        eprintln!("[lifecycle] retryable-error origin 窗口: {origin}");
                    }
                    self.record_launch_error(
                        sink,
                        LaunchErrorSnapshot {
                            intent_id: intent_id.clone(),
                            reason: reason.clone(),
                            kind,
                            received_at_ms: received,
                            presentation_window_label: None,
                            presentation_window_generation: 0,
                            origin_failed_window_label: origin,
                            raw_path: None,
                        },
                    );
                }
            }
        }
    }

    // ---- C3/C5:renderer bootstrap 数据源 ----

    /// `platform_window_ready`:返回该窗口未完成 bootstrap 快照;快照为空
    /// 且无任何 open-file intent 时,冷启动默认 main 确认 Blank。
    /// W2R-F4(H3):读快照 + 判定 + 确认 Blank 经 `confirm_startup_blank`
    /// **单锁原子决策**——native open 与 ready 的交错只能得到单一线性化
    /// 结果(open 先入临界区 → main 承载文件,不得随后 Blank;Blank 先
    /// 线性化 → 后到 open 走新窗)。无 sleep/时序猜测。
    pub fn window_ready(&self, caller_label: &str) -> Vec<BootstrapEvent> {
        let (pending, decision) = self.coordinator.confirm_startup_blank(caller_label);
        eprintln!(
            "[lifecycle] window_ready {caller_label}: {} 个待处理交付（decision={decision:?}）",
            pending.len()
        );
        match decision {
            StartupDecision::BlankConfirmed => {
                eprintln!("[lifecycle] 冷启动 main 确认 Blank（无文件 intent）");
            }
            StartupDecision::OpenFilePending => {
                eprintln!("[lifecycle] main ready 时存在 open-file intent，保持待路由");
            }
            StartupDecision::SnapshotOnly => {}
        }
        pending.iter().map(BootstrapEvent::from_pending).collect()
    }

    /// `platform_complete_window_bootstrap`:coordinator 内校验
    /// (label, deliveryId, 窗口状态, 交付当前代)并 validate-then-commit;
    /// ack effect 链与后续排队 intent 在锁外执行。
    pub fn complete_bootstrap(
        &self,
        sink: &dyn HostEffectSink,
        caller_label: &str,
        delivery_id: &str,
        outcome: RendererOutcome,
    ) -> Result<(), IpcError> {
        let effects = self
            .coordinator
            .on_renderer_outcome(caller_label, delivery_id, outcome)
            .map_err(|code| {
                IpcError::new(
                    STALE_BOOTSTRAP_COMPLETION,
                    format!("交付不存在、跨窗口、过期或已完成（{code}）"),
                )
            })?;
        self.execute_effects(sink, effects);
        self.drain(sink); // 占位释放后可能有待路由 intent
        Ok(())
    }

    /// `platform_open_assigned_document`(C4/F1):host 从 delivery 绑定的
    /// 无损目标读取;不接受 renderer path。读取在锁外
    /// (open_file_with_identity:内容/handle/identity 同源);读取前后各
    /// 一次锁内校验——目标在 enqueue 与读取之间被替换时,registry 与
    /// handle 不得指向不同对象(physical 轮换 → 原子刷新 reservation;
    /// canonical 跳变 → 拒绝交付)。
    /// W2R-F5(H4/R6):读取期间窗口 Destroyed 时,本次签发的 handle 必须
    /// **精确撤销**——它签发于 revoke_window 之后,错过 Destroyed 清理,
    /// 不回收将成为能驱动同名新代窗口的孤立 capability(零残留)。
    pub fn open_assigned_document(
        &self,
        caller_label: &str,
        delivery_id: &str,
    ) -> Result<OpenOutcome, IpcError> {
        // 校验 1(锁内):交付当前 assigned 且为当前代。
        let (identity, expected_generation) = self
            .coordinator
            .assigned_open_target_with_generation(caller_label, delivery_id)
            .ok_or_else(|| {
                IpcError::new(
                    STALE_BOOTSTRAP_COMPLETION,
                    "交付不存在、不属于该窗口或已不是当前代",
                )
            })?;
        // 读取(锁外):canonicalize 一次,内容/handle/identity 同源。
        // PRR-050:handle 以交付当前代签发(replace-and-revoke 旧 active)。
        let opened = self
            .file_service
            .open_file_with_identity_at_generation(
                self.provider.as_ref(),
                caller_label,
                identity.canonical().as_path(),
                expected_generation,
            )
            .map_err(|e| IpcError::new(&e.0.code, e.0.message))?;
        // 校验 2(锁内):generation、delivery、intent identity 与 physical
        // rotation 刷新在同一 coordinator 临界区内完成(H2)。
        if let Err(code) = self.coordinator.complete_assigned_open(
            caller_label,
            delivery_id,
            expected_generation,
            &identity,
            &opened.identity,
        ) {
            self.file_service
                .revoke_document_handle(&opened.renderer.document_target_handle);
            if code == IDENTITY_CANONICAL_MISMATCH {
                return Err(IpcError::new(
                    "FILE_IO_ERROR",
                    "打开目标与分配身份不一致（目标已被替换）",
                ));
            }
            return Err(IpcError::new(
                STALE_BOOTSTRAP_COMPLETION,
                "读取期间交付已失效（窗口被销毁、重建或重置）",
            ));
        }
        Ok(opened.renderer)
    }

    // ---- D2/W2R-F1/W2R-F2:retry / dismiss(caller-bound) ----

    /// `platform_retry_launch_intent`:同 intentId、原 receivedAt 重新路由。
    /// W2R-F1:仅错误记录的呈现窗口(caller label + generation 匹配)可动作。
    /// W2R-F2:open-file 且 origin Failed 窗口仍存活 → 原窗原位恢复
    /// (Failed→Loading→同窗 Open);否则正常路由(必要时新窗)。
    pub fn retry_intent(
        &self,
        sink: &dyn HostEffectSink,
        caller_label: &str,
        intent_id: &str,
    ) -> Result<(), IpcError> {
        let snapshot = self.ensure_owned_retryable(caller_label, intent_id)?;
        if snapshot.kind == "source" {
            // source 错误没有 coordinator intent:retry = 以原始路径重新解析
            // 入队(同 D1 ingest 语义;再次失败重新形成可见错误)。
            let raw = snapshot.raw_path.clone();
            self.launch_errors.lock().unwrap().remove(intent_id);
            if let Some(raw) = raw {
                self.ingest_open_path(sink, &raw);
            }
            return Ok(());
        }
        // open-file 原窗 retry:重新解析目标(锁外;文件可能已恢复/轮换),
        // 再经单锁原位恢复。解析失败保持错误可见并更新原因。
        if let Some(old_identity_path) =
            self.coordinator
                .intent_kind_of(intent_id)
                .and_then(|kind| match kind {
                    LaunchIntentKind::OpenFile { identity } => Some(identity),
                    LaunchIntentKind::Activation => None,
                })
        {
            let refreshed = self
                .provider
                .resolve_existing(old_identity_path.canonical().as_path())
                .map_err(|e| {
                    self.update_error_reason(intent_id, &format!("重试失败：{e}"));
                    IpcError::new(INVALID_INTENT_ACTION, format!("重试失败：{e}"))
                })?;
            if let Some(effects) = self
                .coordinator
                .retry_failed_in_place(intent_id, &refreshed)
                .map_err(|code| IpcError::new(INVALID_INTENT_ACTION, describe_intent_error(code)))?
            {
                self.launch_errors.lock().unwrap().remove(intent_id);
                self.execute_effects(sink, effects); // DeliverBootstrap → 同窗新交付
                return Ok(());
            }
        }
        self.coordinator
            .retry(intent_id)
            .map_err(|code| IpcError::new(INVALID_INTENT_ACTION, describe_intent_error(code)))?;
        self.launch_errors.lock().unwrap().remove(intent_id);
        self.drain(sink); // 失败再次停止;无自动重试循环
        Ok(())
    }

    /// `platform_dismiss_launch_intent`:dismissed terminal 并恰好 ack 一次。
    /// W2R-F1:caller 呈现所有权校验;W2R-F2:origin Failed 窗口同临界区
    /// 收口为可用 Blank(清 active intent/交付槽)。
    pub fn dismiss_intent(
        &self,
        sink: &dyn HostEffectSink,
        caller_label: &str,
        intent_id: &str,
    ) -> Result<(), IpcError> {
        let snapshot = self.ensure_owned_retryable(caller_label, intent_id)?;
        if snapshot.kind == "source" {
            self.launch_errors.lock().unwrap().remove(intent_id);
            return Ok(()); // source 错误无 coordinator intent,清除即终态
        }
        let effects = self
            .coordinator
            .dismiss(intent_id)
            .map_err(|code| IpcError::new(INVALID_INTENT_ACTION, describe_intent_error(code)))?;
        self.launch_errors.lock().unwrap().remove(intent_id);
        self.execute_effects(sink, effects); // AckIntent 一次性清理
        Ok(())
    }

    /// 只允许"caller 当前拥有的可见错误"上的动作(W2R-F1:呈现所有权;
    /// §5C3 只允许当前可见 error snapshot 的合法动作)。
    fn ensure_owned_retryable(
        &self,
        caller_label: &str,
        intent_id: &str,
    ) -> Result<LaunchErrorSnapshot, IpcError> {
        let snapshot = self.launch_errors.lock().unwrap().get(intent_id).cloned();
        if let Some(snapshot) = snapshot {
            if self.caller_owns_error(caller_label, &snapshot) {
                return Ok(snapshot);
            }
            return Err(IpcError::new(
                INVALID_INTENT_ACTION,
                "该错误不属于当前窗口（跨窗口 retry/dismiss 被拒绝）",
            ));
        }
        Err(IpcError::new(
            INVALID_INTENT_ACTION,
            "该意图当前没有可见错误（不可 retry/dismiss）",
        ))
    }

    /// retry 重新解析失败时保持错误可见并更新原因(不吞错、不自动重试)。
    fn update_error_reason(&self, intent_id: &str, reason: &str) {
        let mut errors = self.launch_errors.lock().unwrap();
        if let Some(snapshot) = errors.get_mut(intent_id) {
            snapshot.reason = reason.to_string();
        }
    }

    /// `platform_launch_errors`(W2R-F1):只返回 caller 当前 generation
    /// 所拥有的错误(呈现所有权;host-only 记录与他人的错误不可见)。
    pub fn launch_errors_snapshot_for(&self, caller_label: &str) -> Vec<LaunchErrorSnapshot> {
        self.launch_errors
            .lock()
            .unwrap()
            .values()
            .filter(|s| self.caller_owns_error(caller_label, s))
            .cloned()
            .collect()
    }

    // ---- C4:文件生命周期接线(§4.3) ----

    /// 生产 commit 唯一入口:ordinary 经 `commit_ordinary_with_identity`,
    /// Save As 经 `orchestrate_save_as`;host identity 交给 coordinator
    /// 刷新/换绑;PostCommit 失败进入 recovery(fail closed),renderer 收到
    /// 真实 receipt + `recovery-pending`(不显示为普通保存失败)。
    pub fn commit_document(
        &self,
        caller_label: &str,
        payload: crate::ipc::CommitDocumentPayload,
    ) -> Result<crate::ipc::CommitReceiptDto, IpcError> {
        // W2R-F5(H4):同窗 commit/recovery 串行(锁外文件 I/O 期间,同窗
        // 第二次 commit 不得与本次并发进入)。
        let gate = self.window_gate(caller_label);
        let _gate = gate.lock().unwrap_or_else(|p| p.into_inner());
        // 窗口已销毁时保留 ordinary handle 的稳定 capability 错误语义，
        // 同时不让一个理论上仍存活的 handle 在无窗口状态下进入文件 I/O。
        if self.coordinator.window_generation(caller_label).is_none() {
            if let crate::ipc::CommitDocumentPayload::Ordinary {
                document_target_handle,
                ..
            } = &payload
            {
                self.file_service
                    .validate_document_handle(caller_label, document_target_handle)
                    .map_err(|e| IpcError::new(&e.0.code, e.0.message))?;
            }
            return Err(IpcError::new("FILE_IO_ERROR", "当前窗口不存在，操作已失效"));
        }
        // §4.3/H1:在任何锁外文件 I/O 前捕获 label + generation。
        let binding = self.begin_operation_binding(caller_label)?;
        match payload {
            crate::ipc::CommitDocumentPayload::Ordinary {
                document_target_handle,
                expected_version_token,
                content_json,
            } => match self
                .file_service
                .commit_ordinary_with_identity_at_generation(
                    self.provider.as_ref(),
                    caller_label,
                    Some(binding.window_generation),
                    &document_target_handle,
                    &expected_version_token,
                    &content_json,
                ) {
                Ok(OrdinaryCommitResult::Committed(outcome)) => {
                    self.finish_ordinary_commit(&binding, outcome)
                }
                Ok(OrdinaryCommitResult::CommittedButRefreshPending {
                    receipt,
                    canonical_target,
                    cause,
                }) => {
                    let cause_text = cause.0.message.clone();
                    let recorded = self.record_recovery_bound(
                        &binding,
                        receipt.clone(),
                        RecoveryKind::OrdinaryRefresh { canonical_target },
                    );
                    if recorded {
                        Ok(crate::ipc::CommitReceiptDto::recovery_pending(
                            receipt, cause_text,
                        ))
                    } else {
                        Ok(crate::ipc::CommitReceiptDto::finalized(receipt))
                    }
                }
                Err(e) => Err(IpcError::new(&e.0.code, e.0.message)),
            },
            crate::ipc::CommitDocumentPayload::SaveAs {
                authorization_ref,
                content_json,
            } => match orchestrate_save_as_with_generation(
                &self.coordinator,
                &self.file_service,
                self.provider.as_ref(),
                caller_label,
                &authorization_ref,
                &content_json,
                Some(binding.window_generation),
            ) {
                Ok(outcome) => Ok(crate::ipc::CommitReceiptDto::finalized(outcome.receipt)),
                Err(SaveAsError::CommittedButRebindPending {
                    receipt,
                    cause,
                    token,
                    canonical_target,
                }) => {
                    let cause_text = format!("{cause:?}");
                    let recorded = self.record_recovery_bound(
                        &binding,
                        receipt.clone(),
                        RecoveryKind::SaveAsRebind {
                            token,
                            canonical_target,
                        },
                    );
                    if recorded {
                        Ok(crate::ipc::CommitReceiptDto::recovery_pending(
                            receipt, cause_text,
                        ))
                    } else {
                        Ok(crate::ipc::CommitReceiptDto::finalized(receipt))
                    }
                }
                Err(SaveAsError::PreCommit(e)) => Err(pre_commit_ipc_error(e)),
            },
        }
    }

    /// ordinary 成功路径:registry 刷新(锁内)失败也属"已提交、待恢复"
    /// ——不丢 receipt、不误报保存失败(§4.3/F2)。
    fn finish_ordinary_commit(
        &self,
        binding: &OperationBinding,
        outcome: CommitHostOutcome,
    ) -> Result<crate::ipc::CommitReceiptDto, IpcError> {
        match self
            .coordinator
            .refresh_identity_after_commit_if_generation(
                &binding.window_label,
                binding.window_generation,
                &outcome.identity,
            ) {
            Ok(()) => Ok(crate::ipc::CommitReceiptDto::finalized(outcome.renderer)),
            Err(launch_coordinator::INVALID_EFFECT_COMPLETION) => {
                // bytes 已提交，但原窗口已经销毁/重建；旧 receipt 如实返回，
                // 不把恢复记录写进同名新代。
                Ok(crate::ipc::CommitReceiptDto::finalized(outcome.renderer))
            }
            Err(code) => {
                let recorded = self.record_recovery_bound(
                    binding,
                    outcome.renderer.clone(),
                    RecoveryKind::OrdinaryRefresh {
                        canonical_target: outcome.canonical_target.clone(),
                    },
                );
                if recorded {
                    Ok(crate::ipc::CommitReceiptDto::recovery_pending(
                        outcome.renderer,
                        format!("registry 刷新被拒（{code}）"),
                    ))
                } else {
                    Ok(crate::ipc::CommitReceiptDto::finalized(outcome.renderer))
                }
            }
        }
    }

    /// W2R-F5(H4):recovery 记录绑定"记录时刻的窗口 generation",且
    /// **不得覆盖**同窗既有记录(并发路径由 per-window gate 串行,此处为
    /// 防御性 compare-and-keep);窗口已不存在(Destroyed 竞态)则不记录
    /// (记录对该窗口已无意义,receipt 仍如实返回)。
    fn record_recovery_bound(
        &self,
        binding: &OperationBinding,
        receipt: Receipt,
        kind: RecoveryKind,
    ) -> bool {
        let _lifecycle = self
            .lifecycle_gate
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if self.coordinator.window_generation(&binding.window_label)
            != Some(binding.window_generation)
        {
            eprintln!(
                "[lifecycle] 窗口 {} generation 已变化，recovery 不记录（receipt 仍返回）",
                binding.window_label
            );
            return false;
        }
        let mut recoveries = self.recoveries.lock().unwrap_or_else(|p| p.into_inner());
        if recoveries.contains_key(&binding.window_label) {
            eprintln!(
                "[lifecycle] 窗口 {} 已有 recovery 记录，新记录被拒绝（fail closed，不覆盖）",
                binding.window_label
            );
            return false;
        }
        recoveries.insert(
            binding.window_label.clone(),
            PostCommitRecovery {
                window_label: binding.window_label.clone(),
                window_generation: binding.window_generation,
                receipt,
                kind,
            },
        );
        true
    }

    /// 测试/旧内部调用的便捷包装；生产 commit 必须传入显式 binding。
    #[cfg(test)]
    fn record_recovery(&self, label: &str, receipt: Receipt, kind: RecoveryKind) {
        let Some(generation) = self.coordinator.window_generation(label) else {
            eprintln!("[lifecycle] 窗口 {label} 已销毁，recovery 不记录（receipt 仍返回）");
            return;
        };
        let _ = self.record_recovery_bound(
            &OperationBinding {
                window_label: label.to_string(),
                window_generation: generation,
            },
            receipt,
            kind,
        );
    }

    /// `platform_pending_recovery`:renderer 可见投影(无 token/canonical)。
    /// W2R-F5:generation 失配(同名窗口已重建)的旧记录不可见。
    pub fn pending_recovery(&self, caller_label: &str) -> Option<PendingRecoverySnapshot> {
        let _lifecycle = self
            .lifecycle_gate
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let recoveries = self.recoveries.lock().unwrap_or_else(|p| p.into_inner());
        let record = recoveries.get(caller_label)?;
        if self.coordinator.window_generation(caller_label) != Some(record.window_generation) {
            return None;
        }
        let cause = match &record.kind {
            RecoveryKind::SaveAsRebind { .. } => {
                "已写入目标文件；窗口文件状态恢复待完成（另存为换绑）"
            }
            RecoveryKind::OrdinaryRefresh { .. } => {
                "已写入目标文件；窗口文件状态恢复待完成（保存刷新）"
            }
        };
        Some(PendingRecoverySnapshot {
            display_path: record.receipt.display_path.clone(),
            cause: cause.to_string(),
        })
    }

    /// `platform_resolve_pending_recovery`(§4.3:一次显式、有限的恢复)。
    /// W2R-F5(H4)全部 generation 校验:入口(记录 vs 当前窗口)→ 锁外
    /// provider 刷新 → 回写前再校验(记录仍存在且同代)→ 成功清理
    /// compare-and-remove(只删除本代记录,不误删同名新代窗口的记录)。
    /// 失败保持 fail closed 并返回错误(不自动重试)。幂等:无记录即成功。
    pub fn resolve_pending_recovery(&self, caller_label: &str) -> Result<(), IpcError> {
        let gate = self.window_gate(caller_label);
        let _gate = gate.lock().unwrap_or_else(|p| p.into_inner());
        let Some(record) = self
            .recoveries
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(caller_label)
            .cloned()
        else {
            return Ok(()); // 幂等:无记录
        };
        // 入口校验:记录绑定 generation == 当前窗口 generation。
        if self.coordinator.window_generation(caller_label) != Some(record.window_generation) {
            return Err(IpcError::new(
                RECOVERY_PENDING,
                "恢复记录已过期（窗口已销毁或重建），保持 fail closed",
            ));
        }
        let target = match &record.kind {
            RecoveryKind::SaveAsRebind {
                canonical_target, ..
            }
            | RecoveryKind::OrdinaryRefresh { canonical_target } => canonical_target.clone(),
        };
        // 锁外刷新(文件 metadata I/O 不进 coordinator lock)。
        let refreshed = self
            .provider
            .refresh_after_commit(target.as_path())
            .map_err(|e| IpcError::new(RECOVERY_PENDING, format!("恢复失败（刷新身份）：{e}")))?;
        if refreshed.canonical() != &target {
            return Err(IpcError::new(
                RECOVERY_PENDING,
                "恢复失败：目标 canonical 与恢复记录不一致（fail closed）",
            ));
        }
        // 回写前再校验:刷新期间记录未变(同 label 且同 generation)。
        // Destroyed 竞态下记录可能已被清理或被新代记录取代——两者都不得
        // 由本次(旧代)恢复继续作用。
        {
            let _lifecycle = self
                .lifecycle_gate
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            let recoveries = self.recoveries.lock().unwrap_or_else(|p| p.into_inner());
            match recoveries.get(caller_label) {
                Some(current) if current.window_generation == record.window_generation => {}
                _ => {
                    return Err(IpcError::new(
                        RECOVERY_PENDING,
                        "恢复期间记录已变化（窗口销毁/重建），本次恢复中止（fail closed）",
                    ));
                }
            }
        }
        let _lifecycle = self
            .lifecycle_gate
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if self.coordinator.window_generation(caller_label) != Some(record.window_generation) {
            return Err(IpcError::new(
                RECOVERY_PENDING,
                "恢复期间窗口代际已变化，本次恢复中止（fail closed）",
            ));
        }
        match &record.kind {
            RecoveryKind::SaveAsRebind { token, .. } => {
                // finalize 校验 caller label + token + window generation(B1A-F3)。
                self.coordinator
                    .finalize_rebind_if_generation(
                        caller_label,
                        record.window_generation,
                        token,
                        &refreshed,
                    )
                    .map_err(|code| {
                        IpcError::new(RECOVERY_PENDING, format!("恢复失败（finalize {code}）"))
                    })?;
            }
            RecoveryKind::OrdinaryRefresh { .. } => {
                self.coordinator
                    .refresh_identity_after_commit_if_generation(
                        caller_label,
                        record.window_generation,
                        &refreshed,
                    )
                    .map_err(|code| {
                        IpcError::new(
                            RECOVERY_PENDING,
                            format!("恢复失败（registry 刷新 {code}）"),
                        )
                    })?;
            }
        }
        // compare-and-remove:只清理本代记录(新代记录不得被旧恢复误删)。
        {
            let mut recoveries = self.recoveries.lock().unwrap_or_else(|p| p.into_inner());
            let matches = recoveries
                .get(caller_label)
                .is_some_and(|r| r.window_generation == record.window_generation);
            if matches {
                recoveries.remove(caller_label);
            }
        }
        eprintln!("[lifecycle] 窗口 {caller_label} post-commit recovery 完成");
        Ok(())
    }

    // ---- §4.4:窗口生命周期接线 ----

    /// 一次性 close permit 真正放行原生关闭时进入 Closing(Hold/Cancel
    /// 不调用:用户仍可取消,不得不可逆标记)。
    pub fn on_close_permitted(&self, label: &str) {
        if let Err(code) = self.coordinator.begin_closing(label) {
            // Booting 窗口无合法 Closing 转换(随后 Destroyed 直接清理);
            // 其余拒绝为防御路径,仅诊断。
            eprintln!("[lifecycle] begin_closing({label}) 被拒（{code}）");
        }
    }

    /// `WindowEvent::Destroyed` 的 runtime 组合清理(§4.4):
    /// coordinator.on_destroyed(registry/pending rebind/bootstrap 交付 +
    /// 未终态 intent 恢复排队);文件 capability 与 close state 由 lib.rs
    /// 同时组合调用;随后一次非轮询 drain 让恢复/deferred intent 继续。
    /// recovery 幂等清理。
    /// W2R-F1:呈现于该窗口的错误按明确规则**转移**到另一活窗(更新
    /// generation 并定向 emit);无可转移目标时保持 host-only 未呈现——
    /// 绝不退化为所有窗口可查。
    pub fn on_window_destroyed(&self, sink: &dyn HostEffectSink, label: &str) {
        {
            let _lifecycle = self
                .lifecycle_gate
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            self.recoveries
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(label);
            self.coordinator.on_destroyed(label);
        }
        let mut to_transfer: Vec<LaunchErrorSnapshot> = Vec::new();
        {
            let errors = self.launch_errors.lock().unwrap();
            for snapshot in errors.values() {
                if snapshot.presentation_window_label.as_deref() == Some(label) {
                    to_transfer.push(snapshot.clone());
                }
            }
        }
        if !to_transfer.is_empty() {
            match self.presentation_binding(sink) {
                (Some(target), generation) => {
                    eprintln!(
                        "[lifecycle] {label} 销毁：{} 个错误转移到呈现窗口 {target}",
                        to_transfer.len()
                    );
                    for snapshot in to_transfer {
                        let event = LaunchErrorEvent {
                            intent_id: snapshot.intent_id.clone(),
                            reason: snapshot.reason.clone(),
                        };
                        let mut errors = self.launch_errors.lock().unwrap();
                        if let Some(record) = errors.get_mut(&snapshot.intent_id) {
                            record.presentation_window_label = Some(target.clone());
                            record.presentation_window_generation = generation;
                        }
                        drop(errors);
                        sink.emit_launch_error(&target, &event);
                    }
                }
                (None, _) => {
                    eprintln!(
                        "[lifecycle] {label} 销毁：{} 个错误保持 host-only（无可呈现窗口）",
                        to_transfer.len()
                    );
                    let mut errors = self.launch_errors.lock().unwrap();
                    for snapshot in &to_transfer {
                        if let Some(record) = errors.get_mut(&snapshot.intent_id) {
                            record.presentation_window_label = None;
                            record.presentation_window_generation = 0;
                        }
                    }
                }
            }
        }
        self.drain(sink);
    }

    // ---- 诊断(测试/evidence) ----

    pub fn recovery_labels(&self) -> Vec<String> {
        self.recoveries.lock().unwrap().keys().cloned().collect()
    }

    /// 测试 seam:直读指定窗口的 recovery 记录 generation(W2R-F5 断言)。
    #[cfg(test)]
    pub fn recovery_generation_of(&self, label: &str) -> Option<u64> {
        self.recoveries
            .lock()
            .unwrap()
            .get(label)
            .map(|r| r.window_generation)
    }

    /// 测试 seam:不经 commit 入口直接记录 recovery(构造"同窗已有记录/
    /// 同名新代记录"的竞态事实;生产路径由 per-window gate + 入口 gate
    /// 使其不可达)。
    #[cfg(test)]
    pub fn record_recovery_for_test(&self, label: &str, receipt: Receipt, kind: RecoveryKind) {
        self.record_recovery(label, receipt, kind);
    }

    pub fn ack_summaries(&self) -> Vec<AckSummary> {
        self.coordinator.ack_summaries()
    }

    /// 测试辅助:直接入队(绕过 provider)并 drain;返回 intentId。
    #[cfg(test)]
    pub fn enqueue_for_test(
        &self,
        sink: &dyn HostEffectSink,
        kind: LaunchIntentKind,
        received_at_ms: i64,
    ) -> String {
        let display = match &kind {
            LaunchIntentKind::OpenFile { identity } => {
                Some(identity.canonical().display_lossy().to_string())
            }
            LaunchIntentKind::Activation => None,
        };
        let id = self.coordinator.enqueue(kind, display, received_at_ms);
        self.drain(sink);
        id
    }

    /// 测试辅助:错误快照只读。
    #[cfg(test)]
    pub fn launch_error_of(&self, intent_id: &str) -> Option<LaunchErrorSnapshot> {
        self.launch_errors.lock().unwrap().get(intent_id).cloned()
    }
}

fn describe_intent_error(code: &str) -> String {
    match code {
        launch_coordinator::UNKNOWN_INTENT => "意图不存在".to_string(),
        launch_coordinator::INVALID_INTENT_TRANSITION => {
            "意图当前状态不允许该操作（仅可见错误可重试/放弃）".to_string()
        }
        _ => code.to_string(),
    }
}

fn pre_commit_ipc_error(e: PreCommitError) -> IpcError {
    match e {
        PreCommitError::Plan(ref err)
        | PreCommitError::ResolveTarget(ref err)
        | PreCommitError::Commit(ref err) => IpcError::new(&err.0.code, err.0.message.clone()),
        PreCommitError::Prepare(code) => IpcError::new(code, format!("写前目标占用冲突（{code}）")),
        PreCommitError::TargetBindingMismatch => {
            IpcError::new("INVALID_TARGET_AUTHORIZATION", "授权目标与解析身份不一致")
        }
        PreCommitError::CommitAndAbortFailed { commit, abort } => IpcError::new(
            &commit.0.code,
            format!("{}；且清理失败（{abort}）", commit.0.message),
        ),
    }
}

#[cfg(all(test, unix))]
mod wave2_tests {
    //! MRT-004 Wave 2 生产装配级 fake tests(任务卡 §7 E1 矩阵)。
    //!
    //! 生产语义经 `HostEffectSink` fake + 真实 `LifecycleRuntime`/
    //! `LaunchCoordinator`/`WindowRegistry`/`FileLifecycleService`/
    //! Unix provider 驱动;窗口创建/聚焦/定向事件为记录型 fake,证明
    //! PR/F/N/W/C/H 矩阵。平台绑定(cfg unix)同 B 系列。

    use super::*;
    use crate::file::identity::{FileIdentityProvider, UnixFileIdentityProvider};
    use crate::lifecycle::close::{CloseDecision, CloseRequestStore};
    use crate::lifecycle::launch_coordinator::{IntentPhase, TerminalOutcome};
    use crate::lifecycle::window_registry::WindowRegistry;
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};

    // ---- 可编程 fake sink ----

    #[derive(Default)]
    struct FakeSink {
        windows: Mutex<HashSet<String>>,
        created: Mutex<Vec<String>>,
        create_fail: Mutex<HashMap<String, String>>,
        focused: Mutex<Vec<String>>,
        focus_fail: Mutex<HashMap<String, String>>,
        bootstraps: Mutex<Vec<(String, BootstrapEvent)>>,
        emit_fail: Mutex<HashMap<String, String>>,
        error_events: Mutex<Vec<(String, LaunchErrorEvent)>>,
        recent_focus: Mutex<Option<String>>,
    }

    impl FakeSink {
        fn with_main() -> Arc<Self> {
            let s = Arc::new(Self::default());
            s.windows.lock().unwrap().insert("main".to_string());
            s
        }

        fn inject_create_failure(&self, label: &str, reason: &str) {
            self.create_fail
                .lock()
                .unwrap()
                .insert(label.to_string(), reason.to_string());
        }

        fn created_labels(&self) -> Vec<String> {
            self.created.lock().unwrap().clone()
        }

        fn bootstrap_targets(&self) -> Vec<String> {
            self.bootstraps
                .lock()
                .unwrap()
                .iter()
                .map(|(l, _)| l.clone())
                .collect()
        }
    }

    impl HostEffectSink for FakeSink {
        fn create_editor_window(&self, label: &str) -> Result<(), String> {
            if let Some(reason) = self.create_fail.lock().unwrap().get(label) {
                return Err(reason.clone());
            }
            self.windows.lock().unwrap().insert(label.to_string());
            self.created.lock().unwrap().push(label.to_string());
            Ok(())
        }

        fn focus_window(&self, label: &str) -> Result<(), String> {
            if let Some(reason) = self.focus_fail.lock().unwrap().get(label) {
                return Err(reason.clone());
            }
            self.focused.lock().unwrap().push(label.to_string());
            Ok(())
        }

        fn emit_bootstrap(&self, label: &str, payload: &BootstrapEvent) -> EmitStatus {
            if !self.windows.lock().unwrap().contains(label) {
                return EmitStatus::WindowNotReady;
            }
            if let Some(reason) = self.emit_fail.lock().unwrap().get(label) {
                return EmitStatus::Failed(reason.clone());
            }
            self.bootstraps
                .lock()
                .unwrap()
                .push((label.to_string(), payload.clone()));
            EmitStatus::Emitted
        }

        fn emit_launch_error(&self, label: &str, payload: &LaunchErrorEvent) {
            self.error_events
                .lock()
                .unwrap()
                .push((label.to_string(), payload.clone()));
        }

        fn error_presentation_window(&self) -> Option<String> {
            let recent = self.recent_focus.lock().unwrap().clone();
            let windows = self.windows.lock().unwrap();
            if let Some(label) = recent {
                if windows.contains(&label) {
                    return Some(label);
                }
            }
            if windows.contains("main") {
                return Some("main".to_string());
            }
            windows.iter().next().cloned()
        }
    }

    /// refresh 可切换失败的 provider(F2/F3 注入;resolve/判等委托 Unix)。
    struct SwitchableProvider {
        fail_refresh: AtomicBool,
    }

    impl FileIdentityProvider for SwitchableProvider {
        fn resolve_existing(
            &self,
            p: &Path,
        ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
            UnixFileIdentityProvider.resolve_existing(p)
        }
        fn resolve_authorized_target(
            &self,
            p: &Path,
        ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
            UnixFileIdentityProvider.resolve_authorized_target(p)
        }
        fn refresh_after_commit(
            &self,
            p: &Path,
        ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
            if self.fail_refresh.load(Ordering::SeqCst) {
                return Err(crate::file::identity::IdentityError::Io(
                    "injected refresh failure".into(),
                ));
            }
            UnixFileIdentityProvider.refresh_after_commit(p)
        }
    }

    struct FixedClock(i64);
    impl Clock for FixedClock {
        fn now_ms(&self) -> i64 {
            self.0
        }
    }

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    fn tmpfile(dir: &std::path::Path, name: &str, content: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, content).unwrap();
        p
    }

    fn runtime_with(
        provider: Arc<dyn FileIdentityProvider>,
    ) -> (Arc<LifecycleRuntime>, Arc<FakeSink>) {
        let mut registry = WindowRegistry::new();
        registry.register("main").unwrap();
        let coordinator = Arc::new(LaunchCoordinator::new(registry));
        let service = Arc::new(FileLifecycleService::new());
        let runtime = Arc::new(LifecycleRuntime::new(
            coordinator,
            service,
            provider,
            Box::new(FixedClock(1000)),
        ));
        (runtime, FakeSink::with_main())
    }

    fn default_runtime() -> (Arc<LifecycleRuntime>, Arc<FakeSink>) {
        runtime_with(Arc::new(UnixFileIdentityProvider))
    }

    /// ingest 一个真实文件并推进到 assigned;返回 (intentId, label, deliveryId)。
    /// 交付经 window_ready 快照取得(与真实 renderer 相同通道)。
    fn drive_to_assigned(
        runtime: &LifecycleRuntime,
        sink: &FakeSink,
        path: &Path,
    ) -> (String, String, String) {
        runtime.ingest_open_path(sink, path);
        let mut found = None;
        let mut labels = runtime.coordinator.window_labels();
        labels.sort();
        for label in labels {
            let events = runtime.window_ready(&label);
            if let Some(event) = events.first() {
                let delivery = match event {
                    BootstrapEvent::OpenPath { delivery_id, .. } => delivery_id.clone(),
                    BootstrapEvent::Blank { delivery_id, .. } => delivery_id.clone(),
                };
                found = Some((label, delivery));
                break;
            }
        }
        let (label, delivery) = found.expect("ingest 后必须有窗口收到交付");
        let intent_id = runtime
            .coordinator
            .intent_id_of_delivery(&delivery)
            .expect("交付必须有 intent");
        (intent_id, label, delivery)
    }

    fn complete_opened(runtime: &LifecycleRuntime, sink: &FakeSink, label: &str, delivery: &str) {
        runtime
            .complete_bootstrap(sink, label, delivery, RendererOutcome::Opened)
            .unwrap();
    }

    // ---- PR1/PR2/PR4:targeted bootstrap 与可靠交付 ----

    /// PR1:两个 WebView 并存,各自 ready 只读自身 snapshot;bootstrap 事件
    /// 只定向目标窗口(fake sink 记录证明无全局广播语义)。
    #[test]
    fn pr1_two_webviews_read_own_snapshot_and_events_are_targeted() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
        let b = tmpfile(&dir, "b.mm", r#"{"v":1}"#);
        let (runtime, sink) = default_runtime();
        let (_ia, la, da) = drive_to_assigned(&runtime, &sink, &a);
        complete_opened(&runtime, &sink, &la, &da);
        let (_ib, lb, _db) = drive_to_assigned(&runtime, &sink, &b);
        assert_eq!(la, "main", "PR1:第一个文件占用 main");
        assert_ne!(lb, "main", "PR1:第二个文件新窗");
        // 各窗 ready 快照只含自身交付
        let main_events = runtime.window_ready("main");
        assert!(main_events.is_empty(), "main 的交付已完成,快照为空");
        let editor_events = runtime.window_ready(&lb);
        assert_eq!(editor_events.len(), 1, "editor 只读自身 pending");
        // emit 记录:main 只收过 main 的,editor 只收过 editor 的
        let targets = sink.bootstrap_targets();
        assert!(targets.iter().all(|t| t == "main" || t == &lb));
        assert_eq!(
            targets.iter().filter(|t| *t == &lb).count(),
            1,
            "PR1:editor 的交付恰好定向一次"
        );
    }

    /// PR2/PR4:事件已在 listener 与 snapshot 之间到达(emit 成功),
    /// renderer 未 terminal 时 intent 仍 assigned、零 ack;快照幂等重读
    /// 不产生第二个 intent/delivery。
    #[test]
    fn pr2_pr4_emit_ok_but_renderer_silent_keeps_assigned_zero_ack() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
        let (runtime, sink) = default_runtime();
        let (intent, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
        assert_eq!(label, "main");
        // emit 已成功(fake sink 记录),renderer 未回报:
        assert_eq!(sink.bootstrap_targets(), vec!["main".to_string()]);
        assert_eq!(
            runtime.coordinator.phase(&intent),
            Some(IntentPhase::Assigned {
                label: "main".into(),
                delivery_id: delivery.clone(),
            })
        );
        assert!(runtime.ack_summaries().is_empty(), "PR4:零 ack");
        // 快照幂等:重读同交付,不产生第二个 intent
        let again = runtime.window_ready("main");
        assert_eq!(again.len(), 1);
        assert_eq!(
            runtime.coordinator.intent_id_of_delivery(&delivery),
            Some(intent.clone()),
            "PR2:重复快照不产生第二个 intent"
        );
        let before = runtime.coordinator.intent_count();
        let _ = runtime.window_ready("main");
        assert_eq!(runtime.coordinator.intent_count(), before);
    }

    /// PR5:host 幂等重放:complete 成功后同 outcome 重放被拒,ack 只一次
    /// (renderer 侧"action 不重跑、有限重报"由 window-bootstrap B2-B5 锁定)。
    #[test]
    fn pr5_outcome_replay_rejected_after_terminal_single_ack() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
        let (runtime, sink) = default_runtime();
        let (_i, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
        complete_opened(&runtime, &sink, &label, &delivery);
        let summaries = runtime.ack_summaries();
        assert_eq!(summaries.len(), 1, "PR5:恰好一次 ack");
        let err = runtime
            .complete_bootstrap(&sink, &label, &delivery, RendererOutcome::Opened)
            .unwrap_err();
        assert_eq!(err.code, STALE_BOOTSTRAP_COMPLETION);
        assert_eq!(runtime.ack_summaries().len(), 1, "PR5:重放不产生第二次 ack");
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Open
        );
    }

    /// PR6:ack completion 一次性清理;terminal 摘要容量有限(无队列泄漏)。
    #[test]
    fn pr6_ack_completion_clears_once_with_bounded_summary() {
        let (runtime, sink) = default_runtime();
        // 构造 40 个 activation → blank 流程终态
        let provider = UnixFileIdentityProvider;
        let _ = provider;
        for n in 0..40 {
            let dir = tmpdir();
            let f = tmpfile(&dir, &format!("f{n}.mm"), "{}");
            let (intent, label, delivery) = drive_to_assigned(&runtime, &sink, &f);
            let _ = intent;
            // blank 交付需要窗口状态 Booting;open 走 opened
            complete_opened(&runtime, &sink, &label, &delivery);
        }
        let summaries = runtime.ack_summaries();
        assert_eq!(summaries.len(), 32, "PR6:摘要容量 32(40 条截断)");
        assert!(
            runtime.coordinator.intent_count() <= 1,
            "PR6:terminal intent 已清理,不驻留队列(剩余为非终态)"
        );
        // 对同一 summary 的 intent 再 complete_ack → false(一次性)
        let first = &summaries[0];
        assert!(!runtime.coordinator.complete_ack(&first.intent_id));
    }

    // ---- PR3:create 失败 ----

    #[test]
    fn pr3_create_failure_releases_assignment_intent_retryable_zero_ack() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
        let b = tmpfile(&dir, "b.mm", r#"{"v":1}"#);
        let (runtime, sink) = default_runtime();
        let (_ia, la, da) = drive_to_assigned(&runtime, &sink, &a);
        complete_opened(&runtime, &sink, &la, &da);
        // 注入:新建窗口失败
        sink.inject_create_failure("editor-1", "webview boom");
        runtime.ingest_open_path(&sink, &b);
        let error_snapshot = runtime.launch_errors_snapshot_for("main");
        assert!(
            !error_snapshot.is_empty(),
            "PR3:create 失败必须形成可见 retryable 错误"
        );
        // PR3:失败 intent 零 ack(已有 ack 只属于先前成功的 main open)
        let retryable = error_snapshot[0].intent_id.clone();
        assert!(runtime
            .ack_summaries()
            .iter()
            .all(|s| s.intent_id != retryable));
        assert!(
            sink.created_labels().is_empty(),
            "PR3:无真实建窗成功记录(main 是静态窗,不在 created)"
        );
        assert!(matches!(
            runtime.coordinator.phase(&retryable),
            Some(IntentPhase::RetryableError { .. })
        ));
        // retry(create 恢复)→ 成功建窗并最终 opened
        sink.create_fail.lock().unwrap().clear();
        runtime.retry_intent(&sink, "main", &retryable).unwrap();
        let created = sink.created_labels();
        assert_eq!(created.len(), 1, "PR3:retry 后成功建一个窗");
        let editor = &created[0];
        let pending = runtime.window_ready(editor);
        let d = delivery_of(&pending[0]);
        runtime.open_assigned_document(editor, &d).unwrap();
        runtime
            .complete_bootstrap(&sink, editor, &d, RendererOutcome::Opened)
            .unwrap();
        let b_id = UnixFileIdentityProvider.resolve_existing(&b).unwrap();
        assert_eq!(
            runtime.coordinator.identity_owner_of(&b_id).unwrap().0,
            editor.as_str()
        );
    }

    // ---- F1:assigned open 目标被替换 ----

    /// F1a:physical 轮换(外部原子替换)→ 交付继续,registry reservation
    /// 原子刷新到新 physical(registry 与 handle 同指)。
    #[test]
    fn f1a_physical_rotation_refreshes_reservation_same_target() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
        let (runtime, sink) = default_runtime();
        let (_intent, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
        // enqueue 与读取之间:外部原子替换(inode 轮换)
        let tmp = dir.join(".a.mm.swp");
        fs::write(&tmp, r#"{"v":2}"#).unwrap();
        fs::rename(&tmp, &a).unwrap();
        let opened = runtime
            .open_assigned_document(&label, &delivery)
            .expect("physical 轮换不改变 canonical,交付必须继续");
        assert_eq!(
            opened.version_token,
            crate::file::identity::sha256_hex(br#"{"v":2}"#)
        );
        // registry reservation 已指向新 physical:以新 identity 查询命中 main
        let fresh = UnixFileIdentityProvider.resolve_existing(&a).unwrap();
        assert_eq!(
            runtime
                .coordinator
                .identity_reservation_of(&fresh)
                .map(|(l, _)| l),
            Some("main".to_string()),
            "F1a:registry 与 handle 同指新身份"
        );
        complete_opened(&runtime, &sink, &label, &delivery);
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Open
        );
    }

    /// F1b:canonical 跳变(路径被 symlink 替换指向别处)→ 拒绝交付,
    /// identity/handle/reservation 不错绑。
    #[test]
    fn f1b_canonical_swap_rejects_delivery_without_cross_binding() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        let other = tmpfile(&dir, "other.mm", r#"{"v":9}"#);
        fs::write(&a, r#"{"v":1}"#).unwrap();
        let (runtime, sink) = default_runtime();
        let (_intent, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
        // 替换:symlink 指向 other → canonicalize 结果改变
        fs::remove_file(&a).unwrap();
        std::os::unix::fs::symlink(&other, &a).unwrap();
        let err = runtime
            .open_assigned_document(&label, &delivery)
            .unwrap_err();
        assert_eq!(err.code, "FILE_IO_ERROR");
        assert!(err.message.contains("已被替换"));
        // registry 仍持有原 canonical identity,未错绑 other
        let other_id = UnixFileIdentityProvider.resolve_existing(&other).unwrap();
        assert_eq!(
            runtime.coordinator.identity_reservation_of(&other_id),
            None,
            "F1b:other 不因替换被归属任何窗口"
        );
    }

    // ---- F2/F3:post-commit recovery ----

    /// F2:ordinary bytes 已提交但 registry 刷新被拒(注入:窗口 registry
    /// 承载另一 canonical,refresh 因 IDENTITY_CANONICAL_MISMATCH 拒绝——
    /// 窗口在场时真实可达的拒绝路径)→ receipt 保留、DTO 标记
    /// recovery-pending、recovery fail closed(阻止同窗再次保存),恢复
    /// 失败保持可见。
    #[test]
    fn f2_ordinary_refresh_failure_keeps_receipt_recovery_fail_closed() {
        let dir = tmpdir();
        let f = tmpfile(&dir, "f.mm", r#"{"v":1}"#);
        let g = tmpfile(&dir, "g.mm", r#"{"v":1}"#);
        let (runtime, sink) = default_runtime();
        // main 承载 G(registry 事实);handle 绑定 F(service 事实)→
        // commit 后 refresh 必然 canonical mismatch
        let g_id = UnixFileIdentityProvider.resolve_existing(&g).unwrap();
        runtime.coordinator.with_registry_mut_for_test(|r| {
            r.begin_loading("main", &g_id, "i-g").unwrap();
            r.mark_open("main").unwrap();
        });
        let opened = runtime.file_service.open_file("main", &f).unwrap();
        let _ = sink;
        let dto = runtime
            .commit_document(
                "main",
                crate::ipc::CommitDocumentPayload::Ordinary {
                    document_target_handle: opened.document_target_handle.clone(),
                    expected_version_token: opened.version_token.clone(),
                    content_json: r#"{"v":2}"#.to_string(),
                },
            )
            .expect("F2:bytes 已提交不得报普通保存失败");
        assert_eq!(dto.rebind_state, "recovery-pending", "F2:已提交提示");
        assert!(!dto.document_target_handle.is_empty(), "F2:receipt 保留");
        assert_eq!(fs::read_to_string(&f).unwrap(), r#"{"v":2}"#, "F2:已落盘");
        assert_eq!(runtime.recovery_labels(), vec!["main".to_string()]);
        // fail closed:同窗再次保存被阻止
        let err = runtime
            .commit_document(
                "main",
                crate::ipc::CommitDocumentPayload::Ordinary {
                    document_target_handle: dto.document_target_handle.clone(),
                    expected_version_token: dto.version_token.clone(),
                    content_json: "{}".to_string(),
                },
            )
            .unwrap_err();
        assert_eq!(err.code, RECOVERY_PENDING);
        // 恢复失败(canonical mismatch 持续)保持 fail closed,不自动清除
        let err = runtime.resolve_pending_recovery("main").unwrap_err();
        assert_eq!(err.code, RECOVERY_PENDING);
        assert_eq!(runtime.recovery_labels().len(), 1, "F2:失败不清 record");
        let _ = sink;
    }

    /// F3:Save As `CommittedButRebindPending` —— session 记住 commit
    /// (真实 receipt + recovery-pending);rebind token 不出 host;
    /// 同目标 open deferred;显式恢复成功后清 record、identity 归属窗口。
    #[test]
    fn f3_save_as_committed_pending_hides_token_and_recovers() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
        let target = dir.join("new.mm");
        let provider = Arc::new(SwitchableProvider {
            fail_refresh: AtomicBool::new(false),
        });
        let (runtime, sink) = runtime_with(provider.clone());
        let (_intent, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
        let _opened = runtime.open_assigned_document(&label, &delivery).unwrap();
        complete_opened(&runtime, &sink, &label, &delivery);
        let grant = runtime
            .file_service
            .grant_authorization("main", crate::file::TargetKind::Document, &target)
            .unwrap();
        // 注入:commit 后 refresh 失败 → CommittedButRebindPending
        provider.fail_refresh.store(true, Ordering::SeqCst);
        let dto = runtime
            .commit_document(
                "main",
                crate::ipc::CommitDocumentPayload::SaveAs {
                    authorization_ref: grant.authorization_ref.clone(),
                    content_json: r#"{"v":2}"#.to_string(),
                },
            )
            .expect("F3:bytes 已提交,不得报普通保存失败");
        assert_eq!(dto.rebind_state, "recovery-pending");
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":2}"#);
        // fail-closed pending 保留:同目标 open deferred(零建窗/抢占)
        assert_eq!(runtime.coordinator.pending_rebind_count(), 1);
        runtime.ingest_open_path(&sink, &target);
        assert!(
            sink.created_labels().is_empty(),
            "F3:pending 期间同目标不得建窗"
        );
        // 显式恢复(刷新恢复成功)→ finalize → record 清、identity 归 main
        provider.fail_refresh.store(false, Ordering::SeqCst);
        runtime.resolve_pending_recovery("main").unwrap();
        assert_eq!(runtime.coordinator.pending_rebind_count(), 0);
        assert!(runtime.recovery_labels().is_empty());
        let final_id = UnixFileIdentityProvider.resolve_existing(&target).unwrap();
        assert_eq!(
            runtime
                .coordinator
                .identity_reservation_of(&final_id)
                .map(|(l, _)| l),
            Some("main".to_string()),
            "F3:恢复后目标归属 main"
        );
        // DTO 契约:renderer 拿不到 rebind token(字段只有
        // handle/versionToken/displayPath/rebindState——类型层保证,断言序列化)
        let json = serde_json::to_value(&dto).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("DTO 是对象")
            .keys()
            .map(|k| k.as_str())
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["displayPath", "documentTargetHandle", "rebindState", "versionToken"],
            "F3:renderer DTO 只含 handle/token/displayPath/rebindState——rebind token/canonical 不出 host"
        );
    }

    // ---- N 系:native source ----

    /// N1:cold argv A/B —— main=A、editor=B、顺序稳定、无多余空窗。
    #[test]
    fn n1_cold_argv_ab_main_a_editor_b_no_extra_windows() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", "{}");
        let b = tmpfile(&dir, "b.mm", "{}");
        let (runtime, sink) = default_runtime();
        let argv = vec![
            "MindMap.app".to_string(),
            a.display().to_string(),
            b.display().to_string(),
        ];
        runtime.ingest_argv(&sink, &argv);
        let created = sink.created_labels();
        assert_eq!(created.len(), 1, "N1:只建一个 editor 窗");
        let editor = &created[0];
        // A 分配 main,B 分配 editor,顺序稳定
        let main_pending = runtime.window_ready("main");
        assert_eq!(main_pending.len(), 1);
        let editor_pending = runtime.window_ready(editor);
        assert_eq!(editor_pending.len(), 1);
        complete_opened(&runtime, &sink, "main", &delivery_of(&main_pending[0]));
        complete_opened(&runtime, &sink, editor, &delivery_of(&editor_pending[0]));
        let a_id = UnixFileIdentityProvider.resolve_existing(&a).unwrap();
        let b_id = UnixFileIdentityProvider.resolve_existing(&b).unwrap();
        assert_eq!(
            runtime.coordinator.identity_owner_of(&a_id).unwrap().0,
            "main"
        );
        assert_eq!(
            runtime.coordinator.identity_owner_of(&b_id).unwrap().0,
            editor.as_str()
        );
        // argv 噪音(flags/不存在)不产生 intent
        let before = runtime.coordinator.intent_count();
        runtime.ingest_argv(
            &sink,
            &["app".into(), "--flag".into(), "/no/such.mm".into()],
        );
        assert_eq!(runtime.coordinator.intent_count(), before);
    }

    fn delivery_of(event: &BootstrapEvent) -> String {
        match event {
            BootstrapEvent::OpenPath { delivery_id, .. }
            | BootstrapEvent::Blank { delivery_id, .. } => delivery_id.clone(),
        }
    }

    /// N2:Opened A + duplicate A —— 一个 owner;第二条 focus existing,
    /// 不建重复窗、不 ack 之前的 loading intent。
    #[test]
    fn n2_opened_a_then_duplicate_a_focuses_existing() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", "{}");
        let (runtime, sink) = default_runtime();
        let (first, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
        // A 仍 loading 中,重复 open 到达:
        runtime.ingest_open_path(&sink, &a);
        assert_eq!(sink.focused.lock().unwrap().len(), 1, "N2:聚焦既有窗口");
        assert!(sink.created_labels().is_empty(), "N2:不建重复窗");
        assert_eq!(
            runtime.coordinator.phase(&first),
            Some(IntentPhase::Assigned {
                label: label.clone(),
                delivery_id: delivery.clone()
            }),
            "N2:原始 intent 不被 duplicate 抢走"
        );
        // 原始 intent 正常终结(complete_ack 一次性清理:phase 清空、摘要留痕)
        complete_opened(&runtime, &sink, &label, &delivery);
        assert_eq!(runtime.coordinator.phase(&first), None);
        assert!(runtime
            .ack_summaries()
            .iter()
            .any(|s| s.intent_id == first && s.outcome == TerminalOutcome::Opened));
        // duplicate(focus)intent 已 terminal 并 ack,不重复副作用
        assert!(sink.focused.lock().unwrap().len() == 1);
    }

    /// N3:single-instance 无文件参数 → 恰好一个 activation(不把 flags 当文件)。
    #[test]
    fn n3_second_instance_without_files_single_activation() {
        let (runtime, sink) = default_runtime();
        runtime.ingest_second_instance(&sink, &["app".into(), "--hidden".into()]);
        assert_eq!(sink.created_labels().len(), 1, "N3:恰好一个新空白窗");
        // blank 交付经 ready 快照
        let editor = &sink.created_labels()[0];
        let pending = runtime.window_ready(editor);
        assert_eq!(pending.len(), 1);
        assert!(matches!(pending[0], BootstrapEvent::Blank { .. }));
        runtime
            .complete_bootstrap(
                sink.as_ref(),
                editor,
                &delivery_of(&pending[0]),
                RendererOutcome::BlankCreated,
            )
            .unwrap();
        assert_eq!(
            runtime.coordinator.window_record(editor).unwrap().state,
            WindowState::Blank
        );
    }

    /// N4:Reopen —— warm 每次一个新空白(不替换其他窗);cold main 未确认
    /// 时忽略(不多空窗);main 已 Blank 后(无可见窗语义)再 activation。
    #[test]
    fn n4_reopen_warm_blank_cold_ignored() {
        let (runtime, sink) = default_runtime();
        // cold:main Booting 未确认 → 忽略
        runtime.ingest_reopen(sink.as_ref(), false);
        assert!(
            sink.created_labels().is_empty(),
            "N4:cold main 未确认时 Reopen 忽略"
        );
        // main 确认 Blank(无文件)
        let pending = runtime.window_ready("main");
        assert!(pending.is_empty());
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Blank,
            "N4:startup barrier 确认 Blank"
        );
        // warm:每次一个新空白
        runtime.ingest_reopen(sink.as_ref(), true);
        runtime.ingest_reopen(sink.as_ref(), true);
        assert_eq!(sink.created_labels().len(), 2, "N4:两次 Reopen 两个新窗");
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Blank,
            "N4:main 不被 Reopen 替换"
        );
        // 无可见窗口(全关)语义:main 非 Booting → activation
        runtime.ingest_reopen(sink.as_ref(), false);
        assert_eq!(sink.created_labels().len(), 3);
    }

    /// startup barrier:cold 无文件 → main Blank;此后 open 走新窗不抢 main。
    #[test]
    fn startup_barrier_blank_then_open_creates_editor() {
        let dir = tmpdir();
        let c = tmpfile(&dir, "c.mm", "{}");
        let (runtime, sink) = default_runtime();
        let pending = runtime.window_ready("main");
        assert!(pending.is_empty());
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Blank
        );
        runtime.ingest_open_path(&sink, &c);
        assert_eq!(sink.created_labels().len(), 1, "Blank 后 open 走新窗");
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Blank,
            "main 保持 Blank 不被抢占"
        );
    }

    /// startup barrier:ready 先于 Opened 到达(mark blank 已发生)→
    /// 后到文件开新窗(降级正确,无丢失)。
    #[test]
    fn startup_barrier_blank_race_degrades_to_new_window() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", "{}");
        let (runtime, sink) = default_runtime();
        let _ = runtime.window_ready("main"); // 先 ready(无文件)→ Blank
        runtime.ingest_open_path(&sink, &a); // Opened 后到
        assert_eq!(sink.created_labels().len(), 1);
        let editor = &sink.created_labels()[0];
        let pending = runtime.window_ready(editor);
        complete_opened(&runtime, &sink, editor, &delivery_of(&pending[0]));
        assert_eq!(
            runtime.coordinator.window_record(editor).unwrap().state,
            WindowState::Open
        );
    }

    // ---- W 系:多窗兼容 ----

    /// W1:A 已 open 时外部 open C —— A 的 identity/状态不变;C 新窗。
    #[test]
    fn w1_open_c_while_a_open_keeps_a_and_new_window_for_c() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
        let c = tmpfile(&dir, "c.mm", r#"{"v":1}"#);
        let (runtime, sink) = default_runtime();
        let (_ia, _la, da) = drive_to_assigned(&runtime, &sink, &a);
        let opened_a = runtime.open_assigned_document("main", &da).unwrap();
        complete_opened(&runtime, &sink, "main", &da);
        let a_before = runtime.coordinator.window_record("main").unwrap();
        runtime.ingest_open_path(&sink, &c);
        assert_eq!(sink.created_labels().len(), 1, "W1:C 新窗");
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap(),
            a_before,
            "W1:A 的 registry 事实不变"
        );
        // A 的 handle 仍有效(未被外部 open 触碰)
        let receipt = runtime
            .commit_document(
                "main",
                crate::ipc::CommitDocumentPayload::Ordinary {
                    document_target_handle: opened_a.document_target_handle.clone(),
                    expected_version_token: opened_a.version_token.clone(),
                    content_json: r#"{"v":2}"#.to_string(),
                },
            )
            .unwrap();
        assert_eq!(receipt.rebind_state, "finalized");
        assert_eq!(fs::read_to_string(&a).unwrap(), r#"{"v":2}"#);
    }

    /// W2:Destroyed 五类组合清理;其他窗零变化;deferred intent 可继续。
    #[test]
    fn w2_destroyed_combined_cleanup_other_windows_untouched() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", "{}");
        let c = tmpfile(&dir, "c.mm", "{}");
        let (runtime, sink) = default_runtime();
        let close_store = CloseRequestStore::new();
        // main=A;editor-1=C
        let (_ia, _la, da) = drive_to_assigned(&runtime, &sink, &a);
        let opened_main = runtime.open_assigned_document("main", &da).unwrap();
        complete_opened(&runtime, &sink, "main", &da);
        let (_ic, lc, dc) = drive_to_assigned(&runtime, &sink, &c);
        let opened_editor = runtime.open_assigned_document(&lc, &dc).unwrap();
        complete_opened(&runtime, &sink, &lc, &dc);
        let editor_before = runtime.coordinator.window_record(&lc).unwrap();
        // main 进入 Closing(close permit 放行语义)
        let CloseDecision::Hold { request_id, .. } = close_store.on_close_requested("main") else {
            panic!();
        };
        close_store
            .resolve(
                "main",
                &request_id,
                crate::lifecycle::close::CloseDisposition::Saved,
            )
            .unwrap();
        runtime.on_close_permitted("main");
        // Closing 期间同 identity(A)重复 open → deferred
        runtime.ingest_open_path(&sink, &a);
        let created_before_destroy = sink.created_labels().len();
        // Destroyed 组合清理(lib.rs 同序)
        runtime.file_service.revoke_window("main");
        close_store.on_destroyed("main");
        runtime.on_window_destroyed(sink.as_ref(), "main");
        runtime.on_window_destroyed(sink.as_ref(), "main"); // 幂等
                                                            // ① registry 清理 ② main 的 close pending/permit 清理
        assert_eq!(runtime.coordinator.window_record("main"), None);
        assert_eq!(close_store.pending_request("main"), None);
        // ③ main 的 handle 失效(file capability)
        let err = runtime
            .commit_document(
                "main",
                crate::ipc::CommitDocumentPayload::Ordinary {
                    document_target_handle: opened_main.document_target_handle.clone(),
                    expected_version_token: opened_main.version_token.clone(),
                    content_json: "{}".to_string(),
                },
            )
            .unwrap_err();
        assert_eq!(err.code, "INVALID_DOCUMENT_TARGET_HANDLE");
        // ④ 其他窗零变化:record/handle 不变
        assert_eq!(
            runtime.coordinator.window_record(&lc).unwrap(),
            editor_before,
            "W2:editor 零变化"
        );
        let receipt = runtime
            .commit_document(
                &lc,
                crate::ipc::CommitDocumentPayload::Ordinary {
                    document_target_handle: opened_editor.document_target_handle.clone(),
                    expected_version_token: opened_editor.version_token.clone(),
                    content_json: r#"{"v":2}"#.to_string(),
                },
            )
            .unwrap();
        assert_eq!(receipt.rebind_state, "finalized", "W2:editor 保存不受影响");
        // ⑤ deferred intent(A 的重复 open)恢复:Destroyed 后重新路由建窗
        assert!(
            sink.created_labels().len() > created_before_destroy,
            "W2:deferred intent 在 Destroyed 后恢复路由"
        );
    }

    // ---- C1:多窗 close ----

    /// C1:close request/permit 按真实 label 隔离;Hold/Cancel 不进入
    /// Closing;permit 放行才 Closing;closing identity 持有(deferred)。
    #[test]
    fn c1_close_isolated_by_label_and_closing_only_on_permit() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", "{}");
        let b = tmpfile(&dir, "b.mm", "{}");
        let (runtime, sink) = default_runtime();
        let close_store = CloseRequestStore::new();
        let (_ia, _la, da) = drive_to_assigned(&runtime, &sink, &a);
        complete_opened(&runtime, &sink, "main", &da);
        let (_ib, lb, db) = drive_to_assigned(&runtime, &sink, &b);
        complete_opened(&runtime, &sink, &lb, &db);
        // main:Hold → Cancel → 未进入 Closing
        let CloseDecision::Hold {
            request_id: m1,
            newly_created: n1,
        } = close_store.on_close_requested("main")
        else {
            panic!();
        };
        assert!(n1);
        let CloseDecision::Hold {
            newly_created: n2, ..
        } = close_store.on_close_requested("main")
        else {
            panic!();
        };
        assert!(!n2, "C1:重复 close 复用请求");
        close_store
            .resolve(
                "main",
                &m1,
                crate::lifecycle::close::CloseDisposition::Cancelled,
            )
            .unwrap();
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Open,
            "C1:Cancel 不进入 Closing"
        );
        // editor 同时 Hold:请求隔离
        let CloseDecision::Hold { request_id: e1, .. } = close_store.on_close_requested(&lb) else {
            panic!();
        };
        assert_ne!(m1, e1, "C1:窗口间请求隔离");
        // main:Save → permit 放行 → Closing;同 identity 重复 open deferred
        close_store
            .resolve(
                "main",
                &m1,
                crate::lifecycle::close::CloseDisposition::Saved,
            )
            .unwrap_err(); // 已消费(Cancelled 后 m1 过期)→ 新请求
        let CloseDecision::Hold { request_id: m2, .. } = close_store.on_close_requested("main")
        else {
            panic!();
        };
        close_store
            .resolve(
                "main",
                &m2,
                crate::lifecycle::close::CloseDisposition::Saved,
            )
            .unwrap();
        runtime.on_close_permitted("main");
        assert_eq!(
            runtime.coordinator.window_record("main").unwrap().state,
            WindowState::Closing,
            "C1:permit 放行才 Closing"
        );
        let created_before = sink.created_labels().len();
        let focused_before = sink.focused.lock().unwrap().len();
        runtime.ingest_open_path(&sink, &a);
        assert_eq!(
            (
                sink.created_labels().len(),
                sink.focused.lock().unwrap().len()
            ),
            (created_before, focused_before),
            "C1:Closing 窗口持有 identity 时，重复 open 只能入队，不能创建或聚焦窗口"
        );
        let a_id = UnixFileIdentityProvider.resolve_existing(&a).unwrap();
        assert_eq!(
            runtime
                .coordinator
                .identity_reservation_of(&a_id)
                .map(|(l, _)| l),
            Some("main".to_string()),
            "C1:closing identity 持有到 Destroyed"
        );
        assert!(
            runtime.coordinator.queued_len() >= 1,
            "C1:同 identity open deferred 在队列"
        );
        // editor 窗口状态不受 main 关闭影响
        assert_eq!(
            runtime.coordinator.window_record(&lb).unwrap().state,
            WindowState::Open
        );
    }

    // ---- D2:read 失败 → retryable → retry 恢复 ----

    #[test]
    fn read_failure_reports_retryable_and_user_retry_recovers() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        fs::write(&a, "{}").unwrap();
        let (runtime, sink) = default_runtime();
        let (intent, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
        // 读取时文件被删 → open_assigned_document 失败 → renderer action
        // reject → 报 retryable-error
        fs::remove_file(&a).unwrap();
        let err = runtime
            .open_assigned_document(&label, &delivery)
            .unwrap_err();
        assert_eq!(err.code, "FILE_IO_ERROR");
        runtime
            .complete_bootstrap(
                sink.as_ref(),
                &label,
                &delivery,
                RendererOutcome::RetryableError {
                    reason: err.message.clone(),
                },
            )
            .unwrap();
        assert!(matches!(
            runtime.coordinator.phase(&intent),
            Some(IntentPhase::RetryableError { .. })
        ));
        assert!(
            !runtime.launch_errors_snapshot_for("main").is_empty(),
            "错误可见"
        );
        assert!(runtime.ack_summaries().is_empty(), "失败不 ack");
        // 文件恢复后用户 retry:同 intentId 重新路由并成功
        fs::write(&a, r#"{"v":1}"#).unwrap();
        runtime
            .retry_intent(sink.as_ref(), "main", &intent)
            .unwrap();
        assert!(
            runtime.launch_errors_snapshot_for("main").is_empty(),
            "retry 清除错误"
        );
        // W2R-F2:原窗 main 原位恢复(Failed→Loading→Open),不新建 editor
        assert!(
            sink.created_labels().is_empty(),
            "D2/W2R-F2:retry 复用原 Failed 窗口"
        );
        let pending = runtime.window_ready("main");
        assert_eq!(pending.len(), 1);
        let d2 = delivery_of(&pending[0]);
        runtime.open_assigned_document("main", &d2).unwrap();
        runtime
            .complete_bootstrap(sink.as_ref(), "main", &d2, RendererOutcome::Opened)
            .unwrap();
        assert!(
            runtime
                .ack_summaries()
                .iter()
                .any(|s| s.intent_id == intent && s.outcome == TerminalOutcome::Opened),
            "D2:retry 后同 intentId 终结并恰好 ack"
        );
    }

    /// D2:dismiss 才进入 dismissed terminal 并恰好 ack 一次;retry/dismiss
    /// 只允许可见错误上的动作。
    #[test]
    fn dismiss_from_visible_error_acks_once_and_guards_actions() {
        let dir = tmpdir();
        let a = tmpfile(&dir, "a.mm", "{}");
        let b = tmpfile(&dir, "b.mm", "{}");
        let (runtime, sink) = default_runtime();
        let (_ia, la, da) = drive_to_assigned(&runtime, &sink, &a);
        complete_opened(&runtime, &sink, &la, &da);
        sink.inject_create_failure("editor-1", "boom");
        runtime.ingest_open_path(&sink, &b);
        let error = runtime.launch_errors_snapshot_for("main")[0]
            .intent_id
            .clone();
        // 未知 intent 的 retry/dismiss 拒绝
        let err = runtime
            .retry_intent(sink.as_ref(), "main", "intent-forged")
            .unwrap_err();
        assert_eq!(err.code, INVALID_INTENT_ACTION);
        // 已完成(非可见错误)intent 的动作拒绝
        let err = runtime
            .dismiss_intent(sink.as_ref(), "main", &_ia)
            .unwrap_err();
        assert_eq!(err.code, INVALID_INTENT_ACTION);
        // dismiss:恰好一次 ack(此前 main 的 opened ack 已存在,只 +1)
        let acks_before = runtime.ack_summaries().len();
        runtime
            .dismiss_intent(sink.as_ref(), "main", &error)
            .unwrap();
        assert_eq!(runtime.ack_summaries().len(), acks_before + 1);
        assert!(runtime
            .ack_summaries()
            .iter()
            .any(|s| s.intent_id == error && s.outcome == TerminalOutcome::Dismissed));
        assert!(runtime.launch_errors_snapshot_for("main").is_empty());
        // 重复 dismiss 拒绝(错误已不可见)
        let err = runtime
            .dismiss_intent(sink.as_ref(), "main", &error)
            .unwrap_err();
        assert_eq!(err.code, INVALID_INTENT_ACTION);
        assert_eq!(runtime.ack_summaries().len(), acks_before + 1, "不二次 ack");
    }

    // ---- H1(语义腿;dispatch 生产装配的 AppHandle 不可单测,同语义经
    //      GlobalShortcutState 单测 + sink error_presentation_window) ----

    #[test]
    fn h1_recent_focused_label_drives_target_not_hardcoded_main() {
        let state = crate::shortcuts::GlobalShortcutState::new();
        assert_eq!(state.recent_focused_label(), None);
        state.on_focused("editor-1", true);
        assert_eq!(state.recent_focused_label().as_deref(), Some("editor-1"));
        // 失焦不清除(最近使用事实);销毁才清除
        state.on_focused("editor-1", false);
        assert_eq!(state.recent_focused_label().as_deref(), Some("editor-1"));
        state.on_focused("main", true);
        state.on_window_destroyed("main");
        assert_eq!(
            state.recent_focused_label(),
            None,
            "H1:销毁窗口不得保留为热键目标"
        );
        state.on_focused("editor-1", true);
        state.on_window_destroyed("editor-1");
        assert_eq!(state.recent_focused_label(), None);
        // fake sink 的呈现窗口语义与 dispatch 相同(最近 focused 优先)
        let sink = FakeSink::with_main();
        *sink.recent_focus.lock().unwrap() = Some("editor-2".to_string());
        sink.windows.lock().unwrap().insert("editor-2".to_string());
        assert_eq!(
            sink.error_presentation_window().as_deref(),
            Some("editor-2")
        );
    }

    // ---- single-drain gate(§5C1) ----

    /// 并发 native callback 同时触发 drain:同一 effect 不执行两次
    /// (create 恰好一次;窗口标签唯一)。
    #[test]
    fn concurrent_drain_single_create_per_intent() {
        let (runtime, sink) = default_runtime();
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let runtime = runtime.clone();
                let sink = sink.clone();
                std::thread::spawn(move || {
                    runtime.ingest_activation(sink.as_ref());
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        // 4 个 activation intent → 恰好 4 个不同标签的建窗,无重复标签
        let created = sink.created_labels();
        assert_eq!(created.len(), 4);
        let unique: HashSet<_> = created.iter().cloned().collect();
        assert_eq!(unique.len(), 4, "无重复建窗");
    }

    /// source 解析失败(系统 open 的文件消失)→ 可见可 dismiss 的 source
    /// error;不静默忽略。
    #[test]
    fn source_error_visible_and_dismissable() {
        let (runtime, sink) = default_runtime();
        let missing = std::path::PathBuf::from("/definitely/not/here.mm");
        runtime.ingest_open_path(sink.as_ref(), &missing);
        let errors = runtime.launch_errors_snapshot_for("main");
        assert_eq!(errors.len(), 1, "D1:source 失败可见");
        assert_eq!(errors[0].kind, "source");
        assert!(
            !sink.error_events.lock().unwrap().is_empty(),
            "定向通知了呈现窗口"
        );
        runtime
            .dismiss_intent(sink.as_ref(), "main", &errors[0].intent_id)
            .unwrap();
        assert!(runtime.launch_errors_snapshot_for("main").is_empty());
    }

    mod w2r_red_tests {
        //! MRT-004W2R 红灯（任务卡 §4 R1～R6）：按目标语义断言，先在当前
        //! 实现上真实失败；修复后保留为回归。纯签名演进腿（snapshot/retry/
        //! dismiss 注入 caller）在红灯证据中以编译缺口记录。

        use super::*;
        use crate::file::identity::UnixFileIdentityProvider;
        use crate::lifecycle::launch_coordinator::LaunchIntentKind;
        use std::fs;
        use std::sync::atomic::{AtomicBool, Ordering};

        /// 把 main 上的 open 交付推进到 retryable-error（read 失败）并返回
        /// (intentId, deliveryId)：窗口进 Failed、identity 释放、错误可见。
        fn fail_open_on_main(
            runtime: &LifecycleRuntime,
            sink: &FakeSink,
            path: &Path,
        ) -> (String, String) {
            let (intent, label, delivery) = drive_to_assigned(runtime, sink, path);
            assert_eq!(label, "main");
            fs::remove_file(path).unwrap();
            let err = runtime
                .open_assigned_document(&label, &delivery)
                .unwrap_err();
            runtime
                .complete_bootstrap(
                    sink,
                    &label,
                    &delivery,
                    RendererOutcome::RetryableError {
                        reason: err.message.clone(),
                    },
                )
                .unwrap();
            (intent, delivery)
        }

        // ---- R1:launch error 按呈现窗口隔离 ----

        /// R1(可编译腿):错误快照必须携带呈现所有权(呈现窗口 label+generation、
        /// origin Failed 窗口),否则 snapshot/action 无法按 caller 收紧——
        /// 当前 DTO 无这些字段,serde 投影必然缺键。
        #[test]
        fn r1_red_error_snapshot_carries_presentation_ownership() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", "{}");
            let (runtime, sink) = default_runtime();
            fail_open_on_main(&runtime, &sink, &a);
            let snapshot = runtime.launch_errors_snapshot_for("main");
            assert_eq!(snapshot.len(), 1);
            let json = serde_json::to_value(&snapshot[0]).unwrap();
            let obj = json.as_object().expect("快照是对象");
            assert!(
                obj.contains_key("presentationWindowLabel")
                    && obj.contains_key("presentationWindowGeneration"),
                "R1:错误记录必须绑定呈现窗口(当前键:{:?})",
                obj.keys().collect::<Vec<_>>()
            );
            assert!(
                obj.contains_key("originFailedWindowLabel"),
                "R1:错误记录必须记录 origin Failed 窗口(H2 原窗恢复依据)"
            );
        }

        // ---- R2:Failed 窗口生命周期 ----

        /// R2a:read 失败后 retry 必须复用原 Failed 窗口(Failed→Loading→Open),
        /// 不得多建 editor、不得留僵尸窗。当前实现 retry 走 warm 路由新建窗。
        #[test]
        fn r2a_red_retry_reuses_failed_window_without_new_editor() {
            let dir = tmpdir();
            let a = dir.join("a.mm");
            fs::write(&a, r#"{"v":1}"#).unwrap();
            let (runtime, sink) = default_runtime();
            let (intent, delivery) = fail_open_on_main(&runtime, &sink, &a);
            assert_eq!(
                runtime.coordinator.window_record("main").unwrap().state,
                WindowState::Failed
            );
            // 文件恢复,用户 retry
            fs::write(&a, r#"{"v":1}"#).unwrap();
            runtime
                .retry_intent(sink.as_ref(), "main", &intent)
                .unwrap();
            let created = sink.created_labels();
            assert!(
                created.is_empty(),
                "R2:retry 必须复用原 Failed 窗口,不得新建(实际建了 {created:?})"
            );
            // 原窗完成 Failed→Loading→Open:新交付在 main 上
            let pending = runtime.window_ready("main");
            assert_eq!(pending.len(), 1, "R2:原窗收到新交付");
            let d2 = delivery_of(&pending[0]);
            assert_ne!(d2, delivery);
            runtime.open_assigned_document("main", &d2).unwrap();
            runtime
                .complete_bootstrap(sink.as_ref(), "main", &d2, RendererOutcome::Opened)
                .unwrap();
            assert_eq!(
                runtime.coordinator.window_record("main").unwrap().state,
                WindowState::Open,
                "R2:原窗原位恢复为 Open"
            );
        }

        /// R2b:dismiss 后原窗口必须成为可用 Blank(可编辑、可首次 Save As),
        /// active intent/delivery 清空。当前实现窗口停在 Failed,Save As 被拒。
        #[test]
        fn r2b_red_dismiss_failed_window_becomes_usable_blank() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", "{}");
            let (runtime, sink) = default_runtime();
            let (intent, _delivery) = fail_open_on_main(&runtime, &sink, &a);
            runtime
                .dismiss_intent(sink.as_ref(), "main", &intent)
                .unwrap();
            let record = runtime.coordinator.window_record("main").unwrap();
            assert_eq!(
                record.state,
                WindowState::Blank,
                "R2:dismiss 后原窗必须进入 Blank 终态(实际 {:?})",
                record.state
            );
            assert_eq!(record.active_intent_id, None, "R2:active intent 清空");
            assert_eq!(record.bootstrap_delivery_id, None, "R2:交付槽清空");
            // 可首次 Save As(Blank + 无 identity → untitled adopt 合法)
            let target = dir.join("saved.mm");
            let target_id = UnixFileIdentityProvider
                .resolve_authorized_target(&target)
                .unwrap();
            runtime
                .coordinator
                .prepare_rebind("main", &target_id)
                .expect("R2:dismiss 后的 Blank 窗口必须可首次 Save As");
        }

        // ---- R4:startup barrier 原子交错 ----

        /// R4:ready 的"确认无 open → mark Blank"若由多次独立加锁拼接,native
        /// open 可在检查后、写入前入队。复现生产 runtime 修复前的三段组合
        /// (window_ready = pending_bootstraps_for + has_open_file_intents +
        /// mark_blank),在检查与写入之间注入 enqueue:open 已先获得临界区,
        /// 随后的 Blank 确认必须被拒绝(单锁线性化),不得把首文件挤去新窗。
        #[test]
        fn r4_red_open_enqueued_between_ready_check_and_blank_must_block_blank() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", "{}");
            let (runtime, _sink) = default_runtime();
            let c = &runtime.coordinator;
            // 旧 window_ready 的三段(修复前逐段加锁):
            let pending = c.pending_bootstraps_for("main");
            assert!(pending.is_empty()); // lock 1
            assert!(!c.has_open_file_intents()); // lock 2(检查通过)
                                                 // ← native open 在检查与写入之间线性化(enqueue 即临界区事实)
            let identity = UnixFileIdentityProvider.resolve_existing(&a).unwrap();
            let _id = c.enqueue(
                LaunchIntentKind::OpenFile { identity },
                Some(a.display().to_string()),
                2000,
            );
            // lock 3 的 Blank 确认必须感知同临界区内的 open 事实并拒绝
            let blank = c.mark_blank("main");
            assert!(
                blank.is_err(),
                "R4:open 已入队后,ready 的 Blank 确认必须被原子决策拒绝"
            );
        }

        // ---- R5:recovery generation 与记录替换 ----

        /// R5:旧 recovery(记录的 generation 已过期——同名窗口已重建新代并重新
        /// 打开同一文件)不得修改新代 registry、不得被当作成功清理。当前实现
        /// 按 label 无条件刷新+删除:stale 记录会驱动新代窗口的 registry。
        #[test]
        fn r5_red_stale_recovery_must_not_touch_new_generation_registry() {
            let dir = tmpdir();
            let f = tmpfile(&dir, "f.mm", r#"{"v":1}"#);
            let g = tmpfile(&dir, "g.mm", r#"{"v":1}"#);
            let (runtime, sink) = default_runtime();
            // editor-1 已建窗并承载 G;handle 绑定 F → commit 后 refresh 因
            // canonical mismatch 进入 recovery(窗口在场的真实拒绝路径)
            sink.windows.lock().unwrap().insert("editor-1".to_string());
            let g_id = UnixFileIdentityProvider.resolve_existing(&g).unwrap();
            runtime.coordinator.with_registry_mut_for_test(|r| {
                r.register("editor-1").unwrap();
                r.begin_loading("editor-1", &g_id, "i-g").unwrap();
                r.mark_open("editor-1").unwrap();
            });
            let opened = runtime
                .file_service
                .open_file_at_generation(
                    "editor-1",
                    &f,
                    runtime.coordinator.window_generation("editor-1").unwrap(),
                )
                .unwrap();
            let dto = runtime
                .commit_document(
                    "editor-1",
                    crate::ipc::CommitDocumentPayload::Ordinary {
                        document_target_handle: opened.document_target_handle.clone(),
                        expected_version_token: opened.version_token.clone(),
                        content_json: r#"{"v":2}"#.to_string(),
                    },
                )
                .unwrap();
            assert_eq!(dto.rebind_state, "recovery-pending");
            assert_eq!(
                runtime.recovery_labels(),
                vec!["editor-1".to_string()],
                "R5 前置:旧代 recovery 记录存在"
            );
            let old_generation = runtime.recovery_generation_of("editor-1").unwrap();
            // 竞态事实:同名窗口已重建(新 generation)并重新承载 recovery 目标
            // 同一 canonical F——旧实现按 label 刷新会成功作用于新代窗口
            let f_id = UnixFileIdentityProvider.resolve_existing(&f).unwrap();
            runtime.coordinator.with_registry_mut_for_test(|r| {
                r.on_destroyed("editor-1");
                r.register("editor-1").unwrap();
                r.begin_loading("editor-1", &f_id, "i-2").unwrap();
                r.mark_open("editor-1").unwrap();
            });
            let new_generation = runtime
                .coordinator
                .window_record("editor-1")
                .unwrap()
                .generation;
            assert_ne!(old_generation, new_generation);
            let registry_before = runtime.coordinator.window_record("editor-1").unwrap();
            // 旧 recovery 的 resolve:必须因 generation 过期 fail closed
            let result = runtime.resolve_pending_recovery("editor-1");
            assert!(
                result.is_err(),
                "R5:stale generation 的 recovery 必须 fail closed(旧记录不得作用于新代窗口)"
            );
            assert_eq!(
                runtime.coordinator.window_record("editor-1").unwrap(),
                registry_before,
                "R5:新代窗口 registry 不得被旧 recovery 修改"
            );
            assert_eq!(
                runtime
                    .coordinator
                    .window_record("editor-1")
                    .unwrap()
                    .generation,
                new_generation
            );
            // 旧记录保留(fail closed,不得被当作成功清理;不误删新代事实)
            assert_eq!(
                runtime.recovery_generation_of("editor-1"),
                Some(old_generation),
                "R5:stale 记录保持可见的 fail-closed 状态"
            );
        }

        // ---- R6:assigned open capability 失效竞态 ----

        /// 在 identity 解析与 handle 签发之间注入 Destroyed(等价 lib.rs 的
        /// revoke_window + runtime.on_window_destroyed 顺序):最终调用返回
        /// stale,且不得留下错过 Destroyed 清理的孤立 handle——重建同名窗口后,
        /// 该 handle 不得能驱动新代窗口的提交。
        struct DestroyingProvider {
            armed: AtomicBool,
            service: Arc<crate::file::FileLifecycleService>,
            coordinator: Arc<crate::lifecycle::launch_coordinator::LaunchCoordinator>,
        }

        impl FileIdentityProvider for DestroyingProvider {
            fn resolve_existing(
                &self,
                p: &Path,
            ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
                if self.armed.swap(false, Ordering::SeqCst) {
                    // 模拟 lib.rs Destroyed 组合(先撤销 capability,再清 registry)
                    self.service.revoke_window("main");
                    self.coordinator.on_destroyed("main");
                }
                UnixFileIdentityProvider.resolve_existing(p)
            }
            fn resolve_authorized_target(
                &self,
                p: &Path,
            ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
                UnixFileIdentityProvider.resolve_authorized_target(p)
            }
            fn refresh_after_commit(
                &self,
                p: &Path,
            ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
                UnixFileIdentityProvider.refresh_after_commit(p)
            }
        }

        #[test]
        fn r6_red_destroyed_during_open_leaves_no_orphan_handle() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
            let mut registry = crate::lifecycle::window_registry::WindowRegistry::new();
            registry.register("main").unwrap();
            let coordinator =
                Arc::new(crate::lifecycle::launch_coordinator::LaunchCoordinator::new(registry));
            let service = Arc::new(crate::file::FileLifecycleService::new());
            let provider = Arc::new(DestroyingProvider {
                armed: AtomicBool::new(false),
                service: service.clone(),
                coordinator: coordinator.clone(),
            });
            let runtime = Arc::new(LifecycleRuntime::new(
                coordinator.clone(),
                service.clone(),
                provider.clone(),
                Box::new(FixedClock(1000)),
            ));
            let sink = FakeSink::with_main();
            // A 分配到 main(cold;provider 未武装)
            let (intent, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
            let _ = intent;
            assert_eq!(label, "main");
            // 读取期间窗口 Destroyed(armed provider 注入)→ 返回 stale
            provider.armed.store(true, Ordering::SeqCst);
            let err = runtime
                .open_assigned_document("main", &delivery)
                .unwrap_err();
            assert_eq!(err.code, STALE_BOOTSTRAP_COMPLETION);
            // R6:handle 签发(revoke 之后)错过 Destroyed 清理 → 孤立 capability
            // 残留(任务卡:必须能直接观察 handle 数量;Destroyed 后应零残留)。
            assert_eq!(
                service.document_handle_count("main"),
                0,
                "R6:交付失效后该窗口不得残留孤立 handle(实际 {} 个)",
                service.document_handle_count("main")
            );
        }

        fn delivery_of(event: &BootstrapEvent) -> String {
            match event {
                BootstrapEvent::OpenPath { delivery_id, .. }
                | BootstrapEvent::Blank { delivery_id, .. } => delivery_id.clone(),
            }
        }

        // ---- R1 绿灯:呈现所有权隔离 / 跨窗动作拒绝 / 销毁转移 ----

        /// main 与 editor-1 并存:editor-1 的 read 失败只对 editor-1 可见;
        /// main 的 retry/dismiss 稳定拒绝且零状态变化;editor-1 原窗 retry 成功。
        #[test]
        fn r1_error_visibility_and_actions_bound_to_presentation_window() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", "{}");
            let b = dir.join("b.mm");
            fs::write(&b, "{}").unwrap();
            let (runtime, sink) = default_runtime();
            // main 承载 A
            let (_ia, la, da) = drive_to_assigned(&runtime, &sink, &a);
            complete_opened(&runtime, &sink, &la, &da);
            // editor-1 承载 B 的读取将失败;呈现窗口 = 最近聚焦的 editor-1
            sink.windows.lock().unwrap().insert("editor-1".to_string());
            *sink.recent_focus.lock().unwrap() = Some("editor-1".to_string());
            let (intent, label, delivery) = drive_to_assigned(&runtime, &sink, &b);
            assert_eq!(label, "editor-1");
            fs::remove_file(&b).unwrap();
            let err = runtime
                .open_assigned_document(&label, &delivery)
                .unwrap_err();
            runtime
                .complete_bootstrap(
                    sink.as_ref(),
                    &label,
                    &delivery,
                    RendererOutcome::RetryableError {
                        reason: err.message.clone(),
                    },
                )
                .unwrap();
            // 快照隔离:main 空,editor-1 只见自己的错误
            assert!(
                runtime.launch_errors_snapshot_for("main").is_empty(),
                "R1:main 不得看到 editor-1 的错误"
            );
            let editor_errors = runtime.launch_errors_snapshot_for("editor-1");
            assert_eq!(editor_errors.len(), 1, "R1:错误由呈现窗口唯一拥有");
            assert_eq!(
                editor_errors[0].origin_failed_window_label.as_deref(),
                Some("editor-1")
            );
            // 跨窗动作:main 用 editor-1 的 intentId retry/dismiss 稳定拒绝 + 零变化
            let acks_before = runtime.ack_summaries().len();
            let e1 = runtime
                .retry_intent(sink.as_ref(), "main", &intent)
                .unwrap_err();
            assert_eq!(e1.code, INVALID_INTENT_ACTION);
            let e2 = runtime
                .dismiss_intent(sink.as_ref(), "main", &intent)
                .unwrap_err();
            assert_eq!(e2.code, INVALID_INTENT_ACTION);
            assert_eq!(
                runtime.launch_errors_snapshot_for("editor-1").len(),
                1,
                "R1:跨窗拒绝后错误保持可见"
            );
            assert!(matches!(
                runtime.coordinator.phase(&intent),
                Some(IntentPhase::RetryableError { .. })
            ));
            assert_eq!(runtime.ack_summaries().len(), acks_before, "R1:零 ack 变化");
            // editor-1 自己的 retry 合法:原窗原位恢复
            fs::write(&b, r#"{"v":1}"#).unwrap();
            runtime
                .retry_intent(sink.as_ref(), "editor-1", &intent)
                .unwrap();
            assert!(
                runtime.launch_errors_snapshot_for("editor-1").is_empty(),
                "R1:合法 retry 清除错误"
            );
            let pending = runtime.window_ready("editor-1");
            assert_eq!(pending.len(), 1, "R1:原窗收到新交付");
            let d2 = delivery_of(&pending[0]);
            runtime.open_assigned_document("editor-1", &d2).unwrap();
            runtime
                .complete_bootstrap(sink.as_ref(), "editor-1", &d2, RendererOutcome::Opened)
                .unwrap();
            assert_eq!(
                runtime.coordinator.window_record("editor-1").unwrap().state,
                WindowState::Open
            );
            // main 全程零变化
            assert_eq!(
                runtime.coordinator.window_record("main").unwrap().state,
                WindowState::Open
            );
        }

        /// 呈现窗口 Destroyed:错误按明确规则转移到另一活窗(更新 generation
        /// 并定向 emit);无活窗时保持 host-only——绝不退化为所有窗口可查。
        #[test]
        fn r1_destroyed_presentation_window_transfers_then_host_only() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", "{}");
            let (runtime, sink) = default_runtime();
            let (_i, la, da) = drive_to_assigned(&runtime, &sink, &a);
            complete_opened(&runtime, &sink, &la, &da);
            // 制造一个 main 呈现的错误(create 失败)
            sink.inject_create_failure("editor-1", "boom");
            let missing = dir.join("missing-source.mm");
            let _ = missing;
            runtime.ingest_open_path(sink.as_ref(), &dir.join("nope.mm"));
            let errors = runtime.launch_errors_snapshot_for("main");
            assert_eq!(errors.len(), 1, "R1 前置:source 错误呈现于 main");
            let intent = errors[0].intent_id.clone();
            // main 销毁 → 转移到另一活窗;此处无其他已登记窗口(错误产生时
            // create 未成功)→ host-only,任何窗口不可见
            sink.windows.lock().unwrap().remove("main");
            runtime.on_window_destroyed(sink.as_ref(), "main");
            assert!(
                runtime.launch_errors_snapshot_for("main").is_empty(),
                "R1:host-only 记录任何窗口不可见"
            );
            // main 重建后错误不得自动复活为全局可见(呈现仍为 None)
            runtime.coordinator.with_registry_mut_for_test(|r| {
                r.register("main").unwrap();
            });
            sink.windows.lock().unwrap().insert("main".to_string());
            assert!(
                runtime.launch_errors_snapshot_for("main").is_empty(),
                "R1:host-only 未呈现,重建窗口也不得看到"
            );
            // 转移腿:呈现窗口销毁且存在其他活窗 → 转移 + generation 更新
            // (重建后的 main 上制造第二个 source 错误,呈现于 main)
            runtime.ingest_open_path(sink.as_ref(), &dir.join("nope-2.mm"));
            let errors = runtime.launch_errors_snapshot_for("main");
            assert!(!errors.is_empty(), "R1 前置 2");
            let intent2 = errors[0].intent_id.clone();
            assert_ne!(intent2, intent);
            sink.windows.lock().unwrap().remove("main");
            // 预置一个已登记活窗承接转移
            runtime.coordinator.with_registry_mut_for_test(|r| {
                r.register("editor-9").unwrap();
            });
            sink.windows.lock().unwrap().insert("editor-9".to_string());
            *sink.recent_focus.lock().unwrap() = Some("editor-9".to_string());
            runtime.on_window_destroyed(sink.as_ref(), "main");
            let transferred = runtime.launch_errors_snapshot_for("editor-9");
            assert!(
                transferred.iter().any(|e| e.intent_id == intent2),
                "R1:错误转移到活窗 editor-9"
            );
            assert!(
                runtime.launch_errors_snapshot_for("main").is_empty(),
                "R1:销毁窗口不再可见"
            );
            // 转移后新呈现窗口可以动作(dismiss)
            runtime
                .dismiss_intent(sink.as_ref(), "editor-9", &intent2)
                .unwrap();
            assert!(runtime.launch_errors_snapshot_for("editor-9").is_empty());
        }

        // ---- R4 绿灯:真实 runtime 的两种合法线性化 ----

        #[test]
        fn r4_startup_barrier_linearizes_both_orders_via_real_runtime() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", "{}");
            let (runtime, sink) = default_runtime();
            // 顺序 1:open 先获得临界区 → main 承载文件,不得 Blank
            let (_i, label, delivery) = drive_to_assigned(&runtime, &sink, &a);
            assert_eq!(label, "main");
            let snapshot = runtime.window_ready("main");
            assert_eq!(snapshot.len(), 1, "R4:main 收到文件交付而非 Blank");
            assert_eq!(
                runtime.coordinator.window_record("main").unwrap().state,
                WindowState::Loading
            );
            runtime.open_assigned_document("main", &delivery).unwrap();
            complete_opened(&runtime, &sink, "main", &delivery);
            // 顺序 2:ready 先线性化(main Blank)→ 后到 open 走新窗
            let c = tmpfile(&dir, "c.mm", "{}");
            let (runtime2, sink2) = default_runtime();
            let pending = runtime2.window_ready("main");
            assert!(pending.is_empty());
            assert_eq!(
                runtime2.coordinator.window_record("main").unwrap().state,
                WindowState::Blank
            );
            runtime2.ingest_open_path(&sink2, &c);
            assert_eq!(sink2.created_labels().len(), 1, "R4:后到 open 开新窗");
            assert_eq!(
                runtime2.coordinator.window_record("main").unwrap().state,
                WindowState::Blank,
                "R4:已确认 Blank 的 main 不被抢占"
            );
        }

        // ---- R5 绿灯:记录不覆盖 / 锁外刷新期间 Destroyed 不得误删新代记录 ----

        /// 闸门 provider:armed 后的**首个** refresh 调用阻塞到 release(其余
        /// 调用直接放行)——确定性构造"锁外 I/O 期间 Destroyed"交错,无 sleep。
        struct LatchProvider {
            armed: AtomicBool,
            taken: AtomicBool,
            gate: std::sync::Mutex<bool>,
            cond: std::sync::Condvar,
        }

        impl LatchProvider {
            fn new() -> Self {
                Self {
                    armed: AtomicBool::new(false),
                    taken: AtomicBool::new(false),
                    gate: std::sync::Mutex::new(false),
                    cond: std::sync::Condvar::new(),
                }
            }

            fn wait_taken(&self) {
                while !self.taken.load(Ordering::SeqCst) {
                    std::thread::yield_now();
                }
            }

            fn release(&self) {
                let mut g = self.gate.lock().unwrap();
                *g = true;
                self.cond.notify_all();
            }
        }

        impl FileIdentityProvider for LatchProvider {
            fn resolve_existing(
                &self,
                p: &Path,
            ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
                UnixFileIdentityProvider.resolve_existing(p)
            }
            fn resolve_authorized_target(
                &self,
                p: &Path,
            ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
                UnixFileIdentityProvider.resolve_authorized_target(p)
            }
            fn refresh_after_commit(
                &self,
                p: &Path,
            ) -> Result<FileIdentity, crate::file::identity::IdentityError> {
                if self.armed.load(Ordering::SeqCst) && !self.taken.swap(true, Ordering::SeqCst) {
                    let mut g = self.gate.lock().unwrap();
                    while !*g {
                        g = self.cond.wait(g).unwrap();
                    }
                }
                UnixFileIdentityProvider.refresh_after_commit(p)
            }
        }

        fn receipt_of(display: &str) -> crate::file::Receipt {
            crate::file::Receipt {
                document_target_handle: "doc-test".to_string(),
                version_token: "tok-test".to_string(),
                display_path: display.to_string(),
            }
        }

        /// R1 red:ordinary commit 在 provider refresh 的锁外闸门暂停时，旧
        /// 窗口被销毁并以同名新代重建；提交完成不得把 recovery 写入新代。
        #[test]
        fn r1_old_generation_ordinary_commit_cannot_recover_new_generation() {
            let dir = tmpdir();
            let path = tmpfile(&dir, "ordinary.mm", r#"{"v":1}"#);
            let provider = Arc::new(LatchProvider::new());
            let (runtime, sink) = runtime_with(provider.clone());
            let (_intent, label, delivery) = drive_to_assigned(&runtime, &sink, &path);
            let opened = runtime.open_assigned_document(&label, &delivery).unwrap();
            complete_opened(&runtime, &sink, &label, &delivery);
            let old_generation = runtime.coordinator.window_generation("main").unwrap();

            provider.armed.store(true, Ordering::SeqCst);
            let rt = runtime.clone();
            let handle = opened.document_target_handle.clone();
            let token = opened.version_token.clone();
            let join = std::thread::spawn(move || {
                rt.commit_document(
                    "main",
                    crate::ipc::CommitDocumentPayload::Ordinary {
                        document_target_handle: handle,
                        expected_version_token: token,
                        content_json: r#"{"v":2}"#.to_string(),
                    },
                )
            });
            provider.wait_taken();

            runtime.file_service.revoke_window("main");
            sink.windows.lock().unwrap().remove("main");
            runtime.on_window_destroyed(sink.as_ref(), "main");
            runtime.coordinator.with_registry_mut_for_test(|registry| {
                registry.register("main").unwrap();
                registry.mark_blank("main").unwrap();
            });
            sink.windows.lock().unwrap().insert("main".to_string());
            let new_generation = runtime.coordinator.window_generation("main").unwrap();
            assert_ne!(old_generation, new_generation);

            provider.release();
            let receipt = join.join().unwrap().unwrap();
            assert_eq!(receipt.rebind_state, "finalized");
            assert!(runtime.recovery_labels().is_empty());
            assert!(runtime.pending_recovery("main").is_none());
            assert_eq!(
                runtime.coordinator.window_record("main").unwrap().state,
                WindowState::Blank
            );
        }

        /// R1 red:Save As 的目标 bytes 已落盘但旧代在 refresh 前销毁；
        /// stale finalize/recovery 必须 fail closed，不能污染新代窗口。
        #[test]
        fn r1_old_generation_save_as_cannot_rebind_new_generation() {
            let dir = tmpdir();
            let target = dir.join("save-as.mm");
            let provider = Arc::new(LatchProvider::new());
            let (runtime, sink) = runtime_with(provider.clone());
            runtime.window_ready("main"); // 冷启动 main 确认 Blank
            let grant = runtime
                .file_service
                .grant_authorization("main", crate::file::TargetKind::Document, &target)
                .unwrap();
            let old_generation = runtime.coordinator.window_generation("main").unwrap();

            provider.armed.store(true, Ordering::SeqCst);
            let rt = runtime.clone();
            let authorization_ref = grant.authorization_ref.clone();
            let join = std::thread::spawn(move || {
                rt.commit_document(
                    "main",
                    crate::ipc::CommitDocumentPayload::SaveAs {
                        authorization_ref,
                        content_json: r#"{"v":1}"#.to_string(),
                    },
                )
            });
            provider.wait_taken();

            runtime.file_service.revoke_window("main");
            sink.windows.lock().unwrap().remove("main");
            runtime.on_window_destroyed(sink.as_ref(), "main");
            runtime.coordinator.with_registry_mut_for_test(|registry| {
                registry.register("main").unwrap();
                registry.mark_blank("main").unwrap();
            });
            sink.windows.lock().unwrap().insert("main".to_string());
            let new_generation = runtime.coordinator.window_generation("main").unwrap();
            assert_ne!(old_generation, new_generation);

            provider.release();
            let receipt = join.join().unwrap().unwrap();
            assert_eq!(receipt.rebind_state, "finalized");
            assert!(target.exists());
            assert_eq!(runtime.coordinator.pending_rebind_count(), 0);
            assert!(runtime.recovery_labels().is_empty());
            assert!(runtime.pending_recovery("main").is_none());
            assert_eq!(
                runtime.coordinator.window_record("main").unwrap().state,
                WindowState::Blank
            );
        }

        #[test]
        fn r5_record_insert_never_overwrites_existing() {
            let (runtime, _sink) = default_runtime();
            let _ = runtime.window_ready("main"); // main Blank(generation 就绪)
            let f = std::env::temp_dir().join("w2r-r5-a.mm");
            fs::write(&f, "{}").unwrap();
            let target = UnixFileIdentityProvider
                .resolve_existing(&f)
                .unwrap()
                .canonical()
                .clone();
            runtime.record_recovery_for_test(
                "main",
                receipt_of("/old.mm"),
                RecoveryKind::OrdinaryRefresh {
                    canonical_target: target.clone(),
                },
            );
            runtime.record_recovery_for_test(
                "main",
                receipt_of("/new.mm"),
                RecoveryKind::OrdinaryRefresh {
                    canonical_target: target,
                },
            );
            // 第二笔不得覆盖既有记录(fail closed,保留第一笔)
            assert_eq!(runtime.recovery_labels().len(), 1);
            assert_eq!(
                runtime.pending_recovery("main").unwrap().display_path,
                "/old.mm",
                "R5:同窗已有 recovery 时新记录被拒绝,不覆盖"
            );
        }

        /// 锁外刷新阻塞期间:窗口 Destroyed + 同名新代窗口记录了自己的
        /// recovery → 旧 resolve 必须中止,且 compare-and-remove 不得删除
        /// 新代记录(无 sleep;Condvar 闸门 + taken 自旋)。
        #[test]
        fn r5_destroyed_during_refresh_does_not_delete_new_generation_record() {
            let dir = tmpdir();
            let f = tmpfile(&dir, "f.mm", r#"{"v":1}"#);
            let provider = Arc::new(LatchProvider::new());
            let mut registry = crate::lifecycle::window_registry::WindowRegistry::new();
            registry.register("main").unwrap();
            let coordinator =
                Arc::new(crate::lifecycle::launch_coordinator::LaunchCoordinator::new(registry));
            let service = Arc::new(crate::file::FileLifecycleService::new());
            let runtime = Arc::new(LifecycleRuntime::new(
                coordinator.clone(),
                service,
                provider.clone(),
                Box::new(FixedClock(1000)),
            ));
            let sink = FakeSink::with_main();
            let _ = runtime.window_ready("main"); // main Blank,gen g1
            let target = UnixFileIdentityProvider
                .resolve_existing(&f)
                .unwrap()
                .canonical()
                .clone();
            let old_generation = runtime.coordinator.window_generation("main").unwrap();
            runtime.record_recovery_for_test(
                "main",
                receipt_of("/old.mm"),
                RecoveryKind::OrdinaryRefresh {
                    canonical_target: target.clone(),
                },
            );
            // 线程 A:resolve 在锁外刷新处阻塞
            provider.armed.store(true, Ordering::SeqCst);
            let rt = runtime.clone();
            let handle = std::thread::spawn(move || rt.resolve_pending_recovery("main"));
            provider.wait_taken();
            // 主线程:Destroyed 清理 + 同名新代窗口 + 新代自己的 recovery 记录
            runtime.on_window_destroyed(sink.as_ref(), "main");
            runtime.coordinator.with_registry_mut_for_test(|r| {
                r.register("main").unwrap();
                r.mark_blank("main").unwrap();
            });
            let new_generation = runtime.coordinator.window_generation("main").unwrap();
            assert_ne!(old_generation, new_generation);
            runtime.record_recovery_for_test(
                "main",
                receipt_of("/new.mm"),
                RecoveryKind::OrdinaryRefresh {
                    canonical_target: target,
                },
            );
            provider.release();
            let result = handle.join().unwrap();
            assert!(
                result.is_err(),
                "R5:记录变化后旧 resolve 必须 fail closed 中止"
            );
            assert_eq!(
                runtime.recovery_generation_of("main"),
                Some(new_generation),
                "R5:旧 resolve 不得删除新 generation 的 recovery 记录"
            );
            assert_eq!(
                runtime.pending_recovery("main").unwrap().display_path,
                "/new.mm",
                "R5:新代记录完整保留"
            );
        }

        // ---- R2 补:dismiss 零副作用重放 / ack once(既有语义回归) ----

        #[test]
        fn r2_dismiss_replay_zero_side_effects_and_single_ack() {
            let dir = tmpdir();
            let a = tmpfile(&dir, "a.mm", "{}");
            let (runtime, sink) = default_runtime();
            let (intent, _d) = fail_open_on_main(&runtime, &sink, &a);
            let acks_before = runtime.ack_summaries().len();
            runtime
                .dismiss_intent(sink.as_ref(), "main", &intent)
                .unwrap();
            assert_eq!(runtime.ack_summaries().len(), acks_before + 1);
            // 重放:错误已不可见 → 拒绝,零副作用
            let err = runtime
                .dismiss_intent(sink.as_ref(), "main", &intent)
                .unwrap_err();
            assert_eq!(err.code, INVALID_INTENT_ACTION);
            let err = runtime
                .retry_intent(sink.as_ref(), "main", &intent)
                .unwrap_err();
            assert_eq!(err.code, INVALID_INTENT_ACTION);
            assert_eq!(
                runtime.ack_summaries().len(),
                acks_before + 1,
                "R2:不二次 ack"
            );
            // 窗口保持可用 Blank(不被重放破坏)
            assert_eq!(
                runtime.coordinator.window_record("main").unwrap().state,
                WindowState::Blank
            );
        }

        // ---- PRR-050:document handle active-session 生命周期(RLS-012) ----

        mod prr050_tests {
            use super::*;

            fn open_at_current_generation(
                runtime: &Arc<LifecycleRuntime>,
                label: &str,
                path: &std::path::Path,
            ) -> crate::file::OpenOutcome {
                let generation = runtime.coordinator.window_generation(label).unwrap();
                runtime
                    .file_service
                    .open_file_at_generation(label, path, generation)
                    .unwrap()
            }

            fn ordinary(
                handle: &str,
                token: &str,
                content: &str,
            ) -> crate::ipc::CommitDocumentPayload {
                crate::ipc::CommitDocumentPayload::Ordinary {
                    document_target_handle: handle.to_string(),
                    expected_version_token: token.to_string(),
                    content_json: content.to_string(),
                }
            }

            fn save_as(
                authorization_ref: &str,
                content: &str,
            ) -> crate::ipc::CommitDocumentPayload {
                crate::ipc::CommitDocumentPayload::SaveAs {
                    authorization_ref: authorization_ref.to_string(),
                    content_json: content.to_string(),
                }
            }

            fn read(path: &std::path::Path) -> String {
                std::fs::read_to_string(path).unwrap()
            }

            /// 红灯 1:同窗 Save As 成功后,旧 handle + 旧 token 保存旧文件必须
            /// 返回 INVALID_DOCUMENT_TARGET_HANDLE,旧文件不被改写;新 handle
            /// 可继续 ordinary save。窗口内恒最多一个 active handle。
            #[test]
            fn prr050_old_handle_invalid_after_same_window_save_as() {
                let dir = tmpdir();
                let old_target = tmpfile(&dir, "old.mm", r#"{"v":1}"#);
                let new_target = dir.join("new.mm");
                let (runtime, _sink) = default_runtime();
                runtime.window_ready("main");

                let opened = open_at_current_generation(&runtime, "main", &old_target);
                let grant = runtime
                    .file_service
                    .grant_authorization("main", crate::file::TargetKind::Document, &new_target)
                    .unwrap();
                let receipt = runtime
                    .commit_document("main", save_as(&grant.authorization_ref, r#"{"v":2}"#))
                    .unwrap();
                assert_eq!(receipt.rebind_state, "finalized");

                // 旧 handle + 旧 token 重放保存旧文件 → capability 错误
                let err = runtime
                    .commit_document(
                        "main",
                        ordinary(
                            &opened.document_target_handle,
                            &opened.version_token,
                            r#"{"hijack":true}"#,
                        ),
                    )
                    .unwrap_err();
                assert_eq!(err.code, "INVALID_DOCUMENT_TARGET_HANDLE");
                assert_eq!(
                    read(&old_target),
                    r#"{"v":1}"#,
                    "旧目标不得被旧 handle 改写"
                );

                // 稳定窗口恒 ≤1 active handle,且 active 即新 handle
                assert_eq!(runtime.file_service.document_handle_count("main"), 1);
                assert_eq!(
                    runtime
                        .file_service
                        .active_document_handle("main")
                        .as_deref(),
                    Some(receipt.document_target_handle.as_str())
                );

                // 新 handle ordinary save 正常
                let again = runtime
                    .commit_document(
                        "main",
                        ordinary(
                            &receipt.document_target_handle,
                            &receipt.version_token,
                            r#"{"v":3}"#,
                        ),
                    )
                    .unwrap();
                assert_eq!(again.rebind_state, "finalized");
                assert_eq!(read(&new_target), r#"{"v":3}"#);
            }

            /// 红灯 2:窗口重建(Destroyed → 同名新代)后,旧代 handle 不能
            /// 驱动新代窗口的 ordinary save——即使 registry 清理存在竞态残留。
            #[test]
            fn prr050_old_generation_handle_rejected_for_rebuilt_window() {
                let dir = tmpdir();
                let target = tmpfile(&dir, "f.mm", r#"{"v":1}"#);
                let (runtime, sink) = default_runtime();
                runtime.window_ready("main");
                let opened = open_at_current_generation(&runtime, "main", &target);

                // 窗口销毁并同名重建(模拟清理竞态:只重建,revoke_window 视为漏调用)
                sink.windows.lock().unwrap().remove("main");
                runtime.on_window_destroyed(sink.as_ref(), "main");
                runtime.coordinator.with_registry_mut_for_test(|registry| {
                    registry.register("main").unwrap();
                    registry.mark_blank("main").unwrap();
                });
                sink.windows.lock().unwrap().insert("main".to_string());

                let err = runtime
                    .commit_document(
                        "main",
                        ordinary(
                            &opened.document_target_handle,
                            &opened.version_token,
                            r#"{"v":2}"#,
                        ),
                    )
                    .unwrap_err();
                assert_eq!(err.code, "INVALID_DOCUMENT_TARGET_HANDLE");
                assert_eq!(read(&target), r#"{"v":1}"#);
            }

            /// 红灯 3:窗口关闭后 handle 全部失效(跨窗口/重放/关闭后续用)。
            #[test]
            fn prr050_handles_invalid_after_window_close() {
                let dir = tmpdir();
                let target = tmpfile(&dir, "f.mm", r#"{"v":1}"#);
                let (runtime, _sink) = default_runtime();
                runtime.window_ready("main");
                let opened = open_at_current_generation(&runtime, "main", &target);

                runtime.file_service.revoke_window("main");
                let err = runtime
                    .commit_document(
                        "main",
                        ordinary(
                            &opened.document_target_handle,
                            &opened.version_token,
                            r#"{"v":2}"#,
                        ),
                    )
                    .unwrap_err();
                assert_eq!(err.code, "INVALID_DOCUMENT_TARGET_HANDLE");
                assert_eq!(runtime.file_service.document_handle_count("main"), 0);
            }

            /// 红灯 4:同窗重新打开另一文档(open)同样 replace-and-revoke——
            /// open 后旧文档 handle 不能再保存旧文档。
            #[test]
            fn prr050_old_handle_invalid_after_reopen_in_same_window() {
                let dir = tmpdir();
                let a = tmpfile(&dir, "a.mm", r#"{"a":1}"#);
                let b = tmpfile(&dir, "b.mm", r#"{"b":1}"#);
                let (runtime, _sink) = default_runtime();
                runtime.window_ready("main");

                let first = open_at_current_generation(&runtime, "main", &a);
                let _second = open_at_current_generation(&runtime, "main", &b);

                let err = runtime
                    .commit_document(
                        "main",
                        ordinary(
                            &first.document_target_handle,
                            &first.version_token,
                            r#"{"a":2}"#,
                        ),
                    )
                    .unwrap_err();
                assert_eq!(err.code, "INVALID_DOCUMENT_TARGET_HANDLE");
                assert_eq!(read(&a), r#"{"a":1}"#);
                assert_eq!(
                    runtime
                        .file_service
                        .active_document_handle("main")
                        .as_deref(),
                    Some(_second.document_target_handle.as_str())
                );
            }

            /// 红灯 5:并发 ordinary save 与 close/reopen——in-flight 提交按当时代
            /// 完成,窗口重建后旧 handle 立即失效,新 open 的 handle 正常工作。
            #[test]
            fn prr050_concurrent_save_and_reopen_replaces_active_handle() {
                let dir = tmpdir();
                let a = tmpfile(&dir, "a.mm", r#"{"v":1}"#);
                let b = tmpfile(&dir, "b.mm", r#"{"w":1}"#);
                let provider = Arc::new(LatchProvider::new());
                let (runtime, sink) = runtime_with(provider.clone());
                runtime.window_ready("main");
                let opened = open_at_current_generation(&runtime, "main", &a);

                // ordinary save 卡在锁外 refresh(LatchProvider armed)
                provider.armed.store(true, Ordering::SeqCst);
                let rt = runtime.clone();
                let handle = opened.document_target_handle.clone();
                let token = opened.version_token.clone();
                let join = std::thread::spawn(move || {
                    rt.commit_document("main", ordinary(&handle, &token, r#"{"v":2}"#))
                });
                provider.wait_taken();

                // 并发 close + 同名重建 + 打开新文档（registry 完整绑定 b，与生产 open 路径一致）
                runtime.file_service.revoke_window("main");
                sink.windows.lock().unwrap().remove("main");
                runtime.on_window_destroyed(sink.as_ref(), "main");
                let b_id = UnixFileIdentityProvider.resolve_existing(&b).unwrap();
                runtime.coordinator.with_registry_mut_for_test(|registry| {
                    registry.register("main").unwrap();
                    registry.begin_loading("main", &b_id, "i-b").unwrap();
                    registry.mark_open("main").unwrap();
                });
                sink.windows.lock().unwrap().insert("main".to_string());
                let reopened = open_at_current_generation(&runtime, "main", &b);

                provider.release();
                let outcome = join.join().unwrap();
                // in-flight 提交按当时代完成:a 已写入(receipt 如实),不污染新代
                let receipt = outcome.unwrap();
                assert_eq!(receipt.rebind_state, "finalized");
                assert_eq!(read(&a), r#"{"v":2}"#);
                assert!(runtime.pending_recovery("main").is_none());

                // 旧 handle 在新代不可用;新 handle 是唯一 active 且可保存
                let err = runtime
                    .commit_document(
                        "main",
                        ordinary(
                            &opened.document_target_handle,
                            &receipt.version_token,
                            r#"{"v":3}"#,
                        ),
                    )
                    .unwrap_err();
                assert_eq!(err.code, "INVALID_DOCUMENT_TARGET_HANDLE");
                assert_eq!(read(&a), r#"{"v":2}"#);
                assert_eq!(runtime.file_service.document_handle_count("main"), 1);
                let ok = runtime
                    .commit_document(
                        "main",
                        ordinary(
                            &reopened.document_target_handle,
                            &reopened.version_token,
                            r#"{"w":2}"#,
                        ),
                    )
                    .unwrap();
                assert_eq!(ok.rebind_state, "finalized");
                assert_eq!(read(&b), r#"{"w":2}"#);
            }
        }
    }
}
