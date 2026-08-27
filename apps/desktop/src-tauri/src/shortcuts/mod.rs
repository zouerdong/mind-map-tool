//! 全局唤醒热键（MM-088；AC-16 [from-user 2026-08-27]）：
//! 应用运行时任意前台应用下按热键唤起画布（show + focus，不动文档——
//! 与 Dock activation 同语义）。热键存本机偏好（键 `globalShortcut`），
//! 默认占位 `CmdOrCtrl+Alt+Space`（低冲突；**最终键位待键位专项讨论定稿**，
//! 机制与键位解耦：改的是 accelerator 字符串与偏好）。
//! 注册冲突（热键被其他应用占用）稳定返回错误，不崩溃；可经 IPC 换绑。

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::file::preferences::PreferencesStore;
use crate::file::error::{IpcError, ServiceError};

pub const SHORTCUT_PREF_KEY: &str = "globalShortcut";
/// 占位默认（待键位专项讨论定稿）。
pub const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+Alt+Space";

pub struct GlobalShortcutState {
    /// 当前已注册的 accelerator（注册成功才写入）。
    current: Mutex<Option<String>>,
}

impl GlobalShortcutState {
    pub fn new() -> Self {
        Self { current: Mutex::new(None) }
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

/// 唤起主窗口（show + focus；不新建、不动文档——AC-16"不碰 dirty 窗"）。
fn wake(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
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
        .filter(|s| !s.is_empty())
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
            wake(app);
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
    fn parse_accepts_known_and_rejects_garbage() {
        assert!(parse("CmdOrCtrl+Alt+Space").is_ok());
        assert!(parse("CmdOrCtrl+Shift+M").is_ok());
        assert!(parse("not a shortcut").is_err());
    }

    #[test]
    fn default_is_low_conflict_composite() {
        // 占位默认含三个修饰/特殊键组合（单一 Cmd/Alt 常被系统或输入法占用）。
        assert!(DEFAULT_SHORTCUT.matches("+").count() >= 2);
    }
}
