//! 全局热键（MM-088；AC-16 [from-user 2026-08-27]）——同键分流
//! （键位专项讨论定稿 2026-08-29，默认 ⌥Space / `Alt+Space`）：
//! - 画布未显示/最小化/失焦 → show + focus 唤醒（不动文档）；
//! - 画布已聚焦 → emit `quick-create`（前端在视口中心建节点并自动进编辑，
//!   「捕捉 idea」成为全局第一动作）。
//!
//! 热键存本机偏好（键 `globalShortcut`），可经 IPC 换绑。
//! 注册冲突（热键被其他应用占用）稳定返回错误，不崩溃。

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::file::error::{IpcError, ServiceError};
use crate::file::preferences::PreferencesStore;

pub const SHORTCUT_PREF_KEY: &str = "globalShortcut";
/// 定稿默认（键位专项讨论 2026-08-29：⌥Space，机器实测空闲）。
pub const DEFAULT_SHORTCUT: &str = "Alt+Space";
/// 机制先行阶段的旧占位默认：读到视同未设置（升级到新默认）。
const LEGACY_DEFAULT: &str = "CmdOrCtrl+Alt+Space";

trait ShortcutRegistrar {
    fn register(&mut self, accelerator: &str) -> Result<(), IpcError>;
    fn unregister(&mut self, accelerator: &str) -> Result<(), IpcError>;
}

/// 换绑事务的纯控制流：新绑定先成功，偏好再写入，最后才释放旧绑定；
/// 写入或旧绑定释放失败时恢复原绑定与原偏好。生产实现只负责把
/// register/unregister 映射到 Tauri plugin，测试可用确定性 fake 验证。
fn transactional_rebind<R: ShortcutRegistrar>(
    registrar: &mut R,
    previous_binding: Option<&str>,
    previous_preference: Option<&str>,
    next: &str,
    persist: &mut impl FnMut(Option<&str>) -> Result<(), ServiceError>,
) -> Result<(), ServiceError> {
    if previous_binding == Some(next) {
        return persist(Some(next));
    }

    registrar.register(next).map_err(ServiceError)?;
    if let Err(error) = persist(Some(next)) {
        let unregister_result = registrar.unregister(next);
        // 旧绑定此时从未释放，不可重复注册；真实插件会把重复注册也
        // 报作冲突，反而把一次成功回滚误报成 ROLLBACK_FAILED。
        let preference_restored = persist(previous_preference).is_ok();
        if unregister_result.is_err() || !preference_restored {
            return Err(ServiceError(IpcError::new(
                "GLOBAL_SHORTCUT_ROLLBACK_FAILED",
                format!("热键偏好写入失败且绑定回滚失败：{}", error.0.message),
            )));
        }
        return Err(error);
    }

    let Some(old) = previous_binding else {
        return Ok(());
    };
    if let Err(error) = registrar.unregister(old) {
        let new_unregistered = registrar.unregister(next).is_ok();
        let old_restored = registrar.register(old).is_ok();
        let preference_restored = persist(previous_preference).is_ok();
        if !(new_unregistered && old_restored && preference_restored) {
            return Err(ServiceError(IpcError::new(
                "GLOBAL_SHORTCUT_ROLLBACK_FAILED",
                format!("旧热键释放失败且换绑事务无法完整回滚：{}", error.message),
            )));
        }
        return Err(ServiceError(error));
    }
    Ok(())
}

pub struct PendingInvocation {
    pub invocation_id: String,
    pub window_label: String,
    pub generation: u64,
    pub created_at: std::time::Instant,
    pub responder: std::sync::mpsc::SyncSender<bool>,
    pub consumed: bool,
}

#[derive(Clone, serde::Serialize)]
pub struct PreFocusProbePayload {
    #[serde(rename = "invocationId")]
    pub invocation_id: String,
    #[serde(rename = "windowId")]
    pub window_id: String,
    pub generation: u64,
}

#[derive(Clone, serde::Serialize)]
pub struct QuickCreatePayload {
    #[serde(rename = "invocationId")]
    pub invocation_id: String,
    pub generation: u64,
}

pub struct GlobalShortcutState {
    /// 启动重试与用户换绑必须串行。否则一次延迟的默认键重试可能在
    /// 用户换绑成功后醒来，注销新绑定并把 current 改回旧默认。
    operation: Mutex<()>,
    /// 当前已注册的 accelerator（注册成功才写入）。
    current: Mutex<Option<String>>,
    /// 最近一次真实 Focused 的窗口 label（MRT-004 Wave 2 D4：多窗热键
    /// 分流目标；取代旧单全局 bool——editor-* 存在时不再硬编码 main）。
    last_focused_label: Mutex<Option<String>>,
    /// 在飞的快捷键调用映射（PRC-030：pre-focus 状态机）。
    pub invocations: Mutex<std::collections::HashMap<String, PendingInvocation>>,
    pub invocation_seq: std::sync::atomic::AtomicU64,
}

impl GlobalShortcutState {
    pub fn new() -> Self {
        Self {
            operation: Mutex::new(()),
            current: Mutex::new(None),
            last_focused_label: Mutex::new(None),
            invocations: Mutex::new(std::collections::HashMap::new()),
            invocation_seq: std::sync::atomic::AtomicU64::new(1),
        }
    }

    /// Focused 事件维护（lib.rs 接线；失焦不清除——保留最近聚焦事实，
    /// 热键唤醒"最近使用的窗口"）。
    pub fn on_focused(&self, label: &str, focused: bool) {
        if focused {
            *self.last_focused_label.lock().unwrap() = Some(label.to_string());
        }
    }

    /// 窗口销毁：不得保留指向已销毁 label 的热键目标（D4）。
    pub fn on_window_destroyed(&self, label: &str) {
        let mut last = self.last_focused_label.lock().unwrap();
        if last.as_deref() == Some(label) {
            *last = None;
        }
        let mut invs = self.invocations.lock().unwrap();
        invs.retain(|_, inv| inv.window_label != label);
    }

    /// 最近聚焦窗口（ipc 错误呈现窗口选择也用它）。
    pub fn recent_focused_label(&self) -> Option<String> {
        self.last_focused_label.lock().unwrap().clone()
    }

    /// 校验并解决快捷键调用的前置焦点结果（PRC-030）。
    pub fn resolve_invocation(
        &self,
        invocation_id: &str,
        window_id: &str,
        generation: u64,
        had_focus: bool,
        current_window_generation: Option<u64>,
    ) -> Result<(), IpcError> {
        let mut lock = self.invocations.lock().unwrap();
        let Some(inv) = lock.get_mut(invocation_id) else {
            return Err(IpcError::new(
                "INVOCATION_NOT_FOUND",
                "快捷键调用不存在或已过期",
            ));
        };
        if inv.consumed {
            return Err(IpcError::new(
                "INVOCATION_ALREADY_CONSUMED",
                "快捷键调用已被消费，禁止重放",
            ));
        }
        if inv.window_label != window_id {
            return Err(IpcError::new(
                "WINDOW_MISMATCH",
                "窗口标识与快捷键调用目标不匹配",
            ));
        }
        if inv.generation != generation {
            return Err(IpcError::new(
                "STALE_WINDOW_GENERATION",
                "窗口代次已过期",
            ));
        }
        if let Some(curr_gen) = current_window_generation {
            if curr_gen != generation {
                return Err(IpcError::new(
                    "STALE_WINDOW_GENERATION",
                    "窗口已重建换代，旧代响应无效",
                ));
            }
        }
        if inv.created_at.elapsed() > std::time::Duration::from_millis(500) {
            return Err(IpcError::new(
                "INVOCATION_EXPIRED",
                "快捷键调用已过期",
            ));
        }
        inv.consumed = true;
        let _ = inv.responder.send(had_focus);
        Ok(())
    }
}

impl Default for GlobalShortcutState {
    fn default() -> Self {
        Self::new()
    }
}

pub fn resolve_invocation(
    app: &AppHandle,
    invocation_id: &str,
    window_id: &str,
    generation: u64,
    had_focus: bool,
) -> Result<(), IpcError> {
    let state = app.state::<GlobalShortcutState>();
    let current_generation = if let Some(runtime) =
        app.try_state::<std::sync::Arc<crate::lifecycle::runtime::LifecycleRuntime>>()
    {
        runtime
            .coordinator
            .window_record(window_id)
            .map(|r| r.generation)
    } else {
        None
    };
    state.resolve_invocation(
        invocation_id,
        window_id,
        generation,
        had_focus,
        current_generation,
    )
}

fn parse(accelerator: &str) -> Result<Shortcut, IpcError> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| IpcError::new("GLOBAL_SHORTCUT_INVALID", format!("热键格式无法解析：{e}")))
}

/// 同键分流与 Pre-Focus 两阶段协议（PRC-030 / ADR 0011）：
/// 目标是**最近真实 Focused 的活动窗口**，不是硬编码 main。
/// 阶段 1：向目标窗口发送 probe，等待调用瞬间的真实焦点状态；此时绝不调用 show/set_focus。
/// 阶段 2：仅当调用发生前已聚焦文档时才发送 quick-create；未聚焦/超时/最小化一律安全唤醒不建点。
fn dispatch(app: &AppHandle) {
    let state = app.state::<GlobalShortcutState>();
    let target = state
        .recent_focused_label()
        .filter(|label| app.get_webview_window(label).is_some())
        .or_else(|| {
            app.get_webview_window("main")
                .is_some()
                .then(|| "main".to_string())
        });

    let Some(label) = target else {
        // 无可用窗口：activation 新空白窗（经唯一 coordinator，D4）。
        if let Some(runtime) =
            app.try_state::<std::sync::Arc<crate::lifecycle::runtime::LifecycleRuntime>>()
        {
            let sink = crate::ipc::TauriHostEffectSink::new(app.clone());
            runtime.ingest_activation(&sink);
        } else {
            eprintln!("[shortcuts] 无窗口且 runtime 不可用，热键动作丢弃");
        }
        return;
    };

    let Some(win) = app.get_webview_window(&label) else {
        return;
    };

    // 检查最小化：最小化状态不可能具有文档焦点，直接安全唤醒（不创建节点）
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let generation = if let Some(runtime) =
        app.try_state::<std::sync::Arc<crate::lifecycle::runtime::LifecycleRuntime>>()
    {
        runtime
            .coordinator
            .window_record(&label)
            .map(|r| r.generation)
            .unwrap_or(1)
    } else {
        1
    };

    let seq = state
        .invocation_seq
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let invocation_id = format!("inv-{}", seq);
    let (tx, rx) = std::sync::mpsc::sync_channel::<bool>(1);

    {
        let mut lock = state.invocations.lock().unwrap();
        // 清理超过 5 秒的残留调用
        lock.retain(|_, inv| inv.created_at.elapsed() < std::time::Duration::from_secs(5));
        lock.insert(
            invocation_id.clone(),
            PendingInvocation {
                invocation_id: invocation_id.clone(),
                window_label: label.clone(),
                generation,
                created_at: std::time::Instant::now(),
                responder: tx,
                consumed: false,
            },
        );
    }

    // 阶段 1：向 renderer 发送 probe（此时绝对不调用 win.show() 或 win.set_focus()）
    let probe = PreFocusProbePayload {
        invocation_id: invocation_id.clone(),
        window_id: label.clone(),
        generation,
    };
    if let Err(e) = win.emit("shortcut://pre-focus-probe", probe) {
        eprintln!("[shortcuts] 发送 pre-focus-probe 失败：{e}");
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    // 阶段 2：异步等待响应（TTL 250ms），决定是否发放 quick-create
    let app_handle = app.clone();
    let win_clone = win.clone();
    let inv_id_clone = invocation_id.clone();
    std::thread::spawn(move || {
        let timeout = std::time::Duration::from_millis(250);
        let had_focus = rx.recv_timeout(timeout).unwrap_or(false);

        if let Some(st) = app_handle.try_state::<GlobalShortcutState>() {
            let mut lock = st.invocations.lock().unwrap();
            lock.remove(&inv_id_clone);
        }

        if had_focus {
            let _ = win_clone.emit(
                "quick-create",
                QuickCreatePayload {
                    invocation_id: inv_id_clone,
                    generation,
                },
            );
        }
        let _ = win_clone.show();
        let _ = win_clone.set_focus();
    });
}

/// 启动时装配：读偏好（无则默认占位）→ 注册（含重试）。
/// MM-090-D7：前一实例退出后热键注销存在滞后（WindowServer 异步），
/// 紧随其后的启动会注册冲突失败且**该实例永久无热键**（用户实测踩到：
/// "⌥Space 无反应"）。后台线程指数退避重试（300ms×2ⁿ×5 次），
/// 不阻塞应用启动；最终失败仅日志（用户可经设置换绑）。
pub fn install(app: &AppHandle, config_dir: &std::path::Path) {
    let accelerator = stored_accelerator(&PreferencesStore::new(config_dir));
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut delay_ms = 300;
        for attempt in 1..=5u32 {
            match register_initial_binding(&handle, &accelerator) {
                Ok(()) => return,
                Err(e) if attempt < 5 => {
                    eprintln!(
                        "[shortcuts] 热键注册失败（第 {attempt} 次，{delay_ms}ms 后重试）：{e}"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                    delay_ms *= 2;
                }
                Err(e) => {
                    eprintln!("[shortcuts] 全局热键注册失败（已重试 5 次，可经设置换绑）：{e}")
                }
            }
        }
    });
}

pub fn stored_accelerator(store: &PreferencesStore) -> String {
    store
        .load()
        .ok()
        .and_then(|m| m.get(SHORTCUT_PREF_KEY).cloned())
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| !s.is_empty() && s != LEGACY_DEFAULT) // 旧占位默认视同未设置
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string())
}

fn register_handler(app: &AppHandle, accelerator: &str) -> Result<(), IpcError> {
    let shortcut = parse(accelerator)?;
    let gs = app.global_shortcut();

    gs.on_shortcut(shortcut, move |app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            dispatch(app);
        }
    })
    .map_err(|_| {
        IpcError::new(
            "GLOBAL_SHORTCUT_CONFLICT",
            format!("热键 {accelerator} 注册失败（可能被其他应用占用）"),
        )
    })?;

    Ok(())
}

fn unregister_binding(app: &AppHandle, accelerator: &str) -> Result<(), IpcError> {
    let shortcut = parse(accelerator)?;
    app.global_shortcut()
        .unregister(shortcut)
        .map_err(|e| IpcError::new("GLOBAL_SHORTCUT_CONFLICT", format!("热键注销失败：{e}")))
}

struct TauriShortcutRegistrar<'a> {
    app: &'a AppHandle,
}

impl ShortcutRegistrar for TauriShortcutRegistrar<'_> {
    fn register(&mut self, accelerator: &str) -> Result<(), IpcError> {
        register_handler(self.app, accelerator)
    }

    fn unregister(&mut self, accelerator: &str) -> Result<(), IpcError> {
        unregister_binding(self.app, accelerator)
    }
}

fn persist_shortcut_preference(
    store: &PreferencesStore,
    accelerator: Option<&str>,
) -> Result<(), ServiceError> {
    let mut delta = std::collections::BTreeMap::new();
    delta.insert(
        SHORTCUT_PREF_KEY.to_string(),
        accelerator.map_or_else(|| serde_json::Value::Null, serde_json::Value::from),
    );
    store.store(&delta).map_err(|e| {
        ServiceError(IpcError::new(
            "PREFERENCES_IO_ERROR",
            format!("热键偏好写入失败：{}", e.0.message),
        ))
    })
}

fn register_initial<R: ShortcutRegistrar>(
    state: &GlobalShortcutState,
    registrar: &mut R,
    accelerator: &str,
) -> Result<(), IpcError> {
    let _operation = state.operation.lock().unwrap();
    // 用户可能在启动重试的退避窗口内已完成换绑；此时旧启动请求已经
    // 过期，必须幂等结束，不能覆盖用户刚写入的选择。
    if state.current.lock().unwrap().is_some() {
        return Ok(());
    }
    registrar.register(accelerator)?;
    *state.current.lock().unwrap() = Some(accelerator.to_string());
    Ok(())
}

fn register_initial_binding(app: &AppHandle, accelerator: &str) -> Result<(), IpcError> {
    let state = app.state::<GlobalShortcutState>();
    let mut registrar = TauriShortcutRegistrar { app };
    register_initial(&state, &mut registrar, accelerator)
}

/// 换绑（IPC）：校验 → 注册 → 持久化偏好；任一步失败都不改 current/偏好。
pub fn rebind(
    app: &AppHandle,
    config_dir: &std::path::Path,
    accelerator: &str,
) -> Result<(), ServiceError> {
    if accelerator.trim().is_empty() {
        return Err(ServiceError(IpcError::new(
            "GLOBAL_SHORTCUT_INVALID",
            "热键不能为空",
        )));
    }
    let store = PreferencesStore::new(config_dir);
    let state = app.state::<GlobalShortcutState>();
    let _operation = state.operation.lock().unwrap();
    let previous_binding = state.current.lock().unwrap().clone();
    let previous_preference = store.load().ok().and_then(|values| {
        values
            .get(SHORTCUT_PREF_KEY)
            .and_then(|v| v.as_str())
            .map(str::to_string)
    });
    let mut registrar = TauriShortcutRegistrar { app };
    let mut persist = |value: Option<&str>| persist_shortcut_preference(&store, value);
    transactional_rebind(
        &mut registrar,
        previous_binding.as_deref(),
        previous_preference.as_deref(),
        accelerator,
        &mut persist,
    )?;
    *state.current.lock().unwrap() = Some(accelerator.to_string());
    Ok(())
}

pub fn current(app: &AppHandle) -> Option<String> {
    app.state::<GlobalShortcutState>()
        .current
        .lock()
        .unwrap()
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> std::path::PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    #[test]
    fn stored_accelerator_falls_back_to_default_and_reads_preference() {
        let dir = tmpdir();
        let store = PreferencesStore::new(&dir);
        assert_eq!(stored_accelerator(&store), DEFAULT_SHORTCUT);

        let mut delta = std::collections::BTreeMap::new();
        delta.insert(
            SHORTCUT_PREF_KEY.to_string(),
            serde_json::json!("CmdOrCtrl+Shift+M"),
        );
        store.store(&delta).unwrap();
        assert_eq!(stored_accelerator(&store), "CmdOrCtrl+Shift+M");
    }

    #[test]
    fn legacy_placeholder_default_migrates_to_new_default() {
        // 机制先行阶段的旧占位不粘住用户偏好（从未真正换绑过的键位升级）。
        let dir = tmpdir();
        let store = PreferencesStore::new(&dir);
        let mut delta = std::collections::BTreeMap::new();
        delta.insert(
            SHORTCUT_PREF_KEY.to_string(),
            serde_json::json!("CmdOrCtrl+Alt+Space"),
        );
        store.store(&delta).unwrap();
        assert_eq!(stored_accelerator(&store), DEFAULT_SHORTCUT);
    }

    #[test]
    fn parse_accepts_known_and_rejects_garbage() {
        assert!(parse("Alt+Space").is_ok());
        assert!(parse("CmdOrCtrl+Shift+M").is_ok());
        assert!(parse("not a shortcut").is_err());
    }

    #[test]
    fn default_is_two_key_combo() {
        // 定稿默认 ⌥Space：单修饰键 + 空格（系统默认空闲；Spotlight/输入法占的是 ⌘/⌃Space）。
        assert_eq!(DEFAULT_SHORTCUT, "Alt+Space");
        assert_eq!(DEFAULT_SHORTCUT.matches('+').count(), 1);
    }

    #[derive(Default)]
    struct FakeRegistrar {
        active: std::collections::BTreeSet<String>,
        fail_register: Option<String>,
        fail_unregister: Option<String>,
    }

    impl ShortcutRegistrar for FakeRegistrar {
        fn register(&mut self, accelerator: &str) -> Result<(), IpcError> {
            if self.fail_register.as_deref() == Some(accelerator) {
                return Err(IpcError::new(
                    "GLOBAL_SHORTCUT_CONFLICT",
                    "injected register failure",
                ));
            }
            if !self.active.insert(accelerator.to_string()) {
                return Err(IpcError::new(
                    "GLOBAL_SHORTCUT_CONFLICT",
                    "injected duplicate registration",
                ));
            }
            Ok(())
        }

        fn unregister(&mut self, accelerator: &str) -> Result<(), IpcError> {
            if self.fail_unregister.as_deref() == Some(accelerator) {
                return Err(IpcError::new(
                    "GLOBAL_SHORTCUT_CONFLICT",
                    "injected unregister failure",
                ));
            }
            self.active.remove(accelerator);
            Ok(())
        }
    }

    #[test]
    fn rebind_registers_new_before_releasing_old_and_rolls_back_preference() {
        let mut registrar = FakeRegistrar {
            active: ["Alt+Space".to_string()].into_iter().collect(),
            ..Default::default()
        };
        let mut persisted = Some("Alt+Space".to_string());
        let mut fail = true;
        let mut persist = |value: Option<&str>| -> Result<(), ServiceError> {
            if fail {
                fail = false;
                return Err(ServiceError(IpcError::new(
                    "PREFERENCES_IO_ERROR",
                    "injected write failure",
                )));
            }
            persisted = value.map(str::to_string);
            Ok(())
        };
        let err = transactional_rebind(
            &mut registrar,
            Some("Alt+Space"),
            Some("Alt+Space"),
            "CmdOrCtrl+Shift+M",
            &mut persist,
        )
        .unwrap_err();
        assert_eq!(err.0.code, "PREFERENCES_IO_ERROR");
        assert_eq!(
            registrar.active.into_iter().collect::<Vec<_>>(),
            vec!["Alt+Space"]
        );
        assert_eq!(persisted.as_deref(), Some("Alt+Space"));
    }

    #[test]
    fn rebind_conflict_keeps_old_binding_and_does_not_write_preference() {
        let mut registrar = FakeRegistrar {
            active: ["Alt+Space".to_string()].into_iter().collect(),
            fail_register: Some("CmdOrCtrl+Shift+B".to_string()),
            ..Default::default()
        };
        let mut writes = 0;
        let mut persist = |_: Option<&str>| -> Result<(), ServiceError> {
            writes += 1;
            Ok(())
        };
        let err = transactional_rebind(
            &mut registrar,
            Some("Alt+Space"),
            Some("Alt+Space"),
            "CmdOrCtrl+Shift+B",
            &mut persist,
        )
        .unwrap_err();
        assert_eq!(err.0.code, "GLOBAL_SHORTCUT_CONFLICT");
        assert_eq!(writes, 0);
        assert!(registrar.active.contains("Alt+Space"));
    }

    #[test]
    fn delayed_initial_retry_does_not_replace_a_completed_rebind() {
        let state = GlobalShortcutState::new();
        *state.current.lock().unwrap() = Some("CmdOrCtrl+Shift+M".to_string());
        let mut registrar = FakeRegistrar {
            active: ["CmdOrCtrl+Shift+M".to_string()].into_iter().collect(),
            ..Default::default()
        };

        register_initial(&state, &mut registrar, DEFAULT_SHORTCUT).unwrap();

        assert_eq!(
            state.current.lock().unwrap().as_deref(),
            Some("CmdOrCtrl+Shift+M")
        );
        assert_eq!(
            registrar.active.into_iter().collect::<Vec<_>>(),
            vec!["CmdOrCtrl+Shift+M"]
        );
    }

    #[test]
    fn pre_focus_resolve_happy_path_forwards_had_focus() {
        let state = GlobalShortcutState::new();
        let (tx, rx) = std::sync::mpsc::sync_channel::<bool>(1);
        state.invocations.lock().unwrap().insert(
            "inv-test-1".to_string(),
            PendingInvocation {
                invocation_id: "inv-test-1".to_string(),
                window_label: "editor-1".to_string(),
                generation: 2,
                created_at: std::time::Instant::now(),
                responder: tx,
                consumed: false,
            },
        );

        let res = state.resolve_invocation("inv-test-1", "editor-1", 2, true, Some(2));
        assert!(res.is_ok());
        assert!(rx.recv().unwrap());
    }

    #[test]
    fn pre_focus_resolve_replay_is_rejected() {
        let state = GlobalShortcutState::new();
        let (tx, rx) = std::sync::mpsc::sync_channel::<bool>(1);
        state.invocations.lock().unwrap().insert(
            "inv-test-2".to_string(),
            PendingInvocation {
                invocation_id: "inv-test-2".to_string(),
                window_label: "main".to_string(),
                generation: 1,
                created_at: std::time::Instant::now(),
                responder: tx,
                consumed: false,
            },
        );

        let res1 = state.resolve_invocation("inv-test-2", "main", 1, false, Some(1));
        assert!(res1.is_ok());
        assert!(!rx.recv().unwrap());

        let res2 = state.resolve_invocation("inv-test-2", "main", 1, false, Some(1));
        assert_eq!(res2.unwrap_err().code, "INVOCATION_ALREADY_CONSUMED");
    }

    #[test]
    fn pre_focus_resolve_window_mismatch_is_rejected() {
        let state = GlobalShortcutState::new();
        let (tx, _rx) = std::sync::mpsc::sync_channel::<bool>(1);
        state.invocations.lock().unwrap().insert(
            "inv-test-3".to_string(),
            PendingInvocation {
                invocation_id: "inv-test-3".to_string(),
                window_label: "main".to_string(),
                generation: 1,
                created_at: std::time::Instant::now(),
                responder: tx,
                consumed: false,
            },
        );

        let res = state.resolve_invocation("inv-test-3", "editor-99", 1, true, Some(1));
        assert_eq!(res.unwrap_err().code, "WINDOW_MISMATCH");
    }

    #[test]
    fn pre_focus_resolve_stale_generation_is_rejected() {
        let state = GlobalShortcutState::new();
        let (tx, _rx) = std::sync::mpsc::sync_channel::<bool>(1);
        state.invocations.lock().unwrap().insert(
            "inv-test-4".to_string(),
            PendingInvocation {
                invocation_id: "inv-test-4".to_string(),
                window_label: "main".to_string(),
                generation: 1,
                created_at: std::time::Instant::now(),
                responder: tx,
                consumed: false,
            },
        );

        // 客户端给的代次与调用时不符
        let res1 = state.resolve_invocation("inv-test-4", "main", 2, true, Some(1));
        assert_eq!(res1.unwrap_err().code, "STALE_WINDOW_GENERATION");

        // 窗口在期间已被销毁并以新代次重建（coordinator 代次已为 2）
        let res2 = state.resolve_invocation("inv-test-4", "main", 1, true, Some(2));
        assert_eq!(res2.unwrap_err().code, "STALE_WINDOW_GENERATION");
    }

    #[test]
    fn pre_focus_resolve_unknown_and_expired_invocations_rejected() {
        let state = GlobalShortcutState::new();
        let res = state.resolve_invocation("inv-ghost", "main", 1, true, None);
        assert_eq!(res.unwrap_err().code, "INVOCATION_NOT_FOUND");

        let (tx, _rx) = std::sync::mpsc::sync_channel::<bool>(1);
        state.invocations.lock().unwrap().insert(
            "inv-expired".to_string(),
            PendingInvocation {
                invocation_id: "inv-expired".to_string(),
                window_label: "main".to_string(),
                generation: 1,
                created_at: std::time::Instant::now() - std::time::Duration::from_millis(600),
                responder: tx,
                consumed: false,
            },
        );
        let res_exp = state.resolve_invocation("inv-expired", "main", 1, true, Some(1));
        assert_eq!(res_exp.unwrap_err().code, "INVOCATION_EXPIRED");
    }

    #[test]
    fn pre_focus_window_destroyed_cleans_pending_invocations() {
        let state = GlobalShortcutState::new();
        let (tx, _rx) = std::sync::mpsc::sync_channel::<bool>(1);
        state.invocations.lock().unwrap().insert(
            "inv-dest".to_string(),
            PendingInvocation {
                invocation_id: "inv-dest".to_string(),
                window_label: "editor-target".to_string(),
                generation: 1,
                created_at: std::time::Instant::now(),
                responder: tx,
                consumed: false,
            },
        );

        state.on_window_destroyed("editor-target");
        assert!(state.invocations.lock().unwrap().is_empty());
    }
}
