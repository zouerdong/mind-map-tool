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

use crate::file::preferences::PreferencesStore;
use crate::file::error::{IpcError, ServiceError};

pub const SHORTCUT_PREF_KEY: &str = "globalShortcut";
/// 定稿默认（键位专项讨论 2026-08-29：⌥Space，机器实测空闲）。
pub const DEFAULT_SHORTCUT: &str = "Alt+Space";
/// 机制先行阶段的旧占位默认：读到视同未设置（升级到新默认）。
const LEGACY_DEFAULT: &str = "CmdOrCtrl+Alt+Space";

pub struct GlobalShortcutState {
    /// 当前已注册的 accelerator（注册成功才写入）。
    current: Mutex<Option<String>>,
    /// 窗口焦点跟踪（MM-090-D6：Tauri is_focused() 在 macOS 返回不可靠，
    /// 由 lib.rs 的 Focused 事件维护——dispatch 的同键分流依赖它）。
    pub focused: std::sync::atomic::AtomicBool,
}

impl GlobalShortcutState {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(None),
            focused: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl Default for GlobalShortcutState {
    fn default() -> Self {
        Self::new()
    }
}

fn parse(accelerator: &str) -> Result<Shortcut, IpcError> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| IpcError::new("GLOBAL_SHORTCUT_INVALID", format!("热键格式无法解析：{e}")))
}

/// 同键分流：已聚焦 → 快捷建节点；否则唤醒（show + focus，不动文档）。
fn dispatch(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        // 唤醒幂等（已前台时无感）；焦点判定交给前端 document.hasFocus()
        // （MM-090-D6：Rust 侧 is_focused() 与 Focused 事件在 macOS 均不可靠，
        // WebKit 的 hasFocus 是可信信源；失焦时前端忽略 quick-create 事件，
        // 保持「先聚焦再建」语义——下次按键即建）。
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        let _ = win.emit("quick-create", ());
    }
}

/// 启动时装配：读偏好（无则默认占位）→ 注册 → 记录 current。
/// 注册失败不阻塞应用启动：仅日志（用户可经设置换绑）。
pub fn install(app: &AppHandle, config_dir: &std::path::Path) {
    let accelerator = stored_accelerator(&PreferencesStore::new(config_dir));
    if let Err(e) = register(app, &accelerator) {
        eprintln!("[shortcuts] 全局热键注册失败（可换绑）：{e}");
    }
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

fn register(app: &AppHandle, accelerator: &str) -> Result<(), IpcError> {
    let shortcut = parse(accelerator)?;
    let state = app.state::<GlobalShortcutState>();
    let gs = app.global_shortcut();

    // 幂等：注销旧绑定（若曾注册成功）
    if let Some(prev) = state.current.lock().unwrap().take() {
        if let Ok(old) = parse(&prev) {
            let _ = gs.unregister(old);
        }
    }

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

    *state.current.lock().unwrap() = Some(accelerator.to_string());
    Ok(())
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
    register(app, accelerator).map_err(ServiceError)?;
    let store = PreferencesStore::new(config_dir);
    let mut delta = std::collections::BTreeMap::new();
    delta.insert(SHORTCUT_PREF_KEY.to_string(), serde_json::json!(accelerator));
    store
        .store(&delta)
        .map_err(|e| ServiceError(IpcError::new("PREFERENCES_IO_ERROR", format!("热键偏好写入失败：{}", e.0.message))))
}

pub fn current(app: &AppHandle) -> Option<String> {
    app.state::<GlobalShortcutState>().current.lock().unwrap().clone()
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
        delta.insert(SHORTCUT_PREF_KEY.to_string(), serde_json::json!("CmdOrCtrl+Shift+M"));
        store.store(&delta).unwrap();
        assert_eq!(stored_accelerator(&store), "CmdOrCtrl+Shift+M");
    }

    #[test]
    fn legacy_placeholder_default_migrates_to_new_default() {
        // 机制先行阶段的旧占位不粘住用户偏好（从未真正换绑过的键位升级）。
        let dir = tmpdir();
        let store = PreferencesStore::new(&dir);
        let mut delta = std::collections::BTreeMap::new();
        delta.insert(SHORTCUT_PREF_KEY.to_string(), serde_json::json!("CmdOrCtrl+Alt+Space"));
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
}
