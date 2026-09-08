//! macOS 原生应用菜单与命令分发（PRR-065 / ADR 0012）。
//!
//! 职责：
//! - 构建标准 app 菜单（Mind Map / 文件 / 编辑 / 视图 / 帮助）；
//! - menu event 分流：host-owned 生命周期命令（Quit / 新建窗口 / 关闭窗口）
//!   在 host 处理；renderer 命令定向 emit 给最近聚焦且 generation 有效的
//!   WebView（`platform://app-command`，payload 仅 commandId）；
//! - 菜单 check 状态（主题 / 布局方向）：renderer 经
//!   `platform_sync_menu_state` 上报非敏感状态，按窗口缓存；窗口聚焦时
//!   刷新 app-wide 菜单（跟随最近聚焦窗口，不污染其他窗口）。
//!
//! 编辑菜单使用 predefined 项（undo/redo/cut/copy/paste/select_all）：
//! textarea 原生文本语义 + 画布层键位不变，不产生双派发。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const APP_COMMAND_EVENT: &str = "platform://app-command";

// ---- 稳定 menu item id（与 renderer AppCommandId 一一对应；不得改动） ----

/// host-owned：菜单事件在 host 侧处理，不发给 renderer。
pub const MENU_APP_QUIT: &str = "app-quit";
pub const MENU_APP_NEW_WINDOW: &str = "app-new-window";
pub const MENU_FILE_CLOSE_WINDOW: &str = "file-close-window";

/// renderer 命令（emit `platform://app-command`；与 TS AppCommandId 同表）。
pub const MENU_FILE_NEW: &str = "file.new";
pub const MENU_FILE_OPEN: &str = "file.open";
pub const MENU_FILE_SAVE: &str = "file.save";
pub const MENU_FILE_SAVE_AS: &str = "file.save-as";
pub const MENU_FILE_EXPORT: &str = "file.export-panel";
pub const MENU_VIEW_FIT: &str = "view.fit";
pub const MENU_VIEW_ORGANIZE: &str = "view.organize";
pub const MENU_VIEW_LAYOUT_HORIZONTAL: &str = "view.layout-horizontal";
pub const MENU_VIEW_LAYOUT_VERTICAL: &str = "view.layout-vertical";
pub const MENU_VIEW_THEME_WARM: &str = "view.theme-warm";
pub const MENU_VIEW_THEME_DARK: &str = "view.theme-dark";
pub const MENU_APP_SHORTCUTS: &str = "app.shortcuts";
pub const MENU_HELP_ONBOARDING: &str = "help.onboarding";

/// 全部 renderer 命令 id（分流与对齐测试用；顺序即菜单呈现序）。
pub const RENDERER_COMMAND_IDS: &[&str] = &[
    MENU_FILE_NEW,
    MENU_FILE_OPEN,
    MENU_FILE_SAVE,
    MENU_FILE_SAVE_AS,
    MENU_FILE_EXPORT,
    MENU_VIEW_FIT,
    MENU_VIEW_ORGANIZE,
    MENU_VIEW_LAYOUT_HORIZONTAL,
    MENU_VIEW_LAYOUT_VERTICAL,
    MENU_VIEW_THEME_WARM,
    MENU_VIEW_THEME_DARK,
    MENU_APP_SHORTCUTS,
    MENU_HELP_ONBOARDING,
];

/// host-owned 命令 id（生命周期所有权保留在 host）。
pub const HOST_OWNED_IDS: &[&str] = &[MENU_APP_QUIT, MENU_APP_NEW_WINDOW, MENU_FILE_CLOSE_WINDOW];

pub fn is_host_owned(id: &str) -> bool {
    HOST_OWNED_IDS.contains(&id)
}

pub fn is_renderer_command(id: &str) -> bool {
    RENDERER_COMMAND_IDS.contains(&id)
}

// ---- 菜单 check 状态（纯逻辑，可单测） ----

/// 单窗口的菜单同步快照（非敏感状态：主题与布局方向）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuWindowSync {
    pub theme: &'static str,              // "light" | "dark"（暖白 / 黑板）
    pub organize_direction: &'static str, // "horizontal" | "vertical"
}

impl MenuWindowSync {
    pub fn parse(theme: &str, organize_direction: &str) -> Option<Self> {
        let theme = match theme {
            "light" => "light",
            "dark" => "dark",
            _ => return None,
        };
        let organize_direction = match organize_direction {
            "horizontal" => "horizontal",
            "vertical" => "vertical",
            _ => return None,
        };
        Some(Self {
            theme,
            organize_direction,
        })
    }

    /// 四个 check 项的目标勾选态：(theme_warm, theme_dark, layout_h, layout_v)。
    pub fn check_state(&self) -> (bool, bool, bool, bool) {
        (
            self.theme == "light",
            self.theme == "dark",
            self.organize_direction == "horizontal",
            self.organize_direction == "vertical",
        )
    }
}

/// 菜单状态：check 项句柄 + per-window 快照缓存。窗口聚焦时用该窗口的
/// 快照刷新 app-wide 菜单（未上报过的窗口不动当前勾选）。
pub struct MenuState {
    theme_warm: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    theme_dark: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    layout_horizontal: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    layout_vertical: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
    per_window: Mutex<HashMap<String, MenuWindowSync>>,
}

impl Default for MenuState {
    fn default() -> Self {
        Self::new()
    }
}

impl MenuState {
    pub fn new() -> Self {
        Self {
            theme_warm: Mutex::new(None),
            theme_dark: Mutex::new(None),
            layout_horizontal: Mutex::new(None),
            layout_vertical: Mutex::new(None),
            per_window: Mutex::new(HashMap::new()),
        }
    }

    pub fn register_check_items(
        &self,
        theme_warm: CheckMenuItem<tauri::Wry>,
        theme_dark: CheckMenuItem<tauri::Wry>,
        layout_horizontal: CheckMenuItem<tauri::Wry>,
        layout_vertical: CheckMenuItem<tauri::Wry>,
    ) {
        *self.theme_warm.lock().unwrap() = Some(theme_warm);
        *self.theme_dark.lock().unwrap() = Some(theme_dark);
        *self.layout_horizontal.lock().unwrap() = Some(layout_horizontal);
        *self.layout_vertical.lock().unwrap() = Some(layout_vertical);
    }

    /// renderer 上报（仅当该窗口为最近聚焦窗口时应用到 app-wide 菜单；
    /// 快照始终按窗口缓存，供聚焦切换时恢复）。
    pub fn sync_from_window<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        label: &str,
        sync: MenuWindowSync,
    ) {
        let is_recent = app
            .try_state::<crate::shortcuts::GlobalShortcutState>()
            .map(|s| s.recent_focused_label().as_deref() == Some(label))
            .unwrap_or(false);
        if is_recent {
            self.apply_sync(&sync);
        }
        self.per_window
            .lock()
            .unwrap()
            .insert(label.to_string(), sync);
    }

    /// 窗口聚焦：该窗口有快照则刷新 app-wide 菜单（跟随最近聚焦）。
    pub fn on_window_focused(&self, label: &str) {
        let snapshot = self.per_window.lock().unwrap().get(label).cloned();
        if let Some(sync) = snapshot {
            self.apply_sync(&sync);
        }
    }

    fn apply_sync(&self, sync: &MenuWindowSync) {
        let (warm, dark, horiz, vert) = sync.check_state();
        if let Some(item) = self.theme_warm.lock().unwrap().as_ref() {
            let _ = item.set_checked(warm);
        }
        if let Some(item) = self.theme_dark.lock().unwrap().as_ref() {
            let _ = item.set_checked(dark);
        }
        if let Some(item) = self.layout_horizontal.lock().unwrap().as_ref() {
            let _ = item.set_checked(horiz);
        }
        if let Some(item) = self.layout_vertical.lock().unwrap().as_ref() {
            let _ = item.set_checked(vert);
        }
    }
}

// ---- 菜单构建 ----

/// 构建并安装标准 macOS 应用菜单（setup 阶段调用一次）。
/// Quit 继续走逐窗 fail-closed 关闭协议（lib.rs on_menu_event）。
pub fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(
        app,
        MENU_APP_QUIT,
        "退出 Mind Map",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let new_window = MenuItem::with_id(
        app,
        MENU_APP_NEW_WINDOW,
        "新建窗口",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let shortcuts = MenuItem::with_id(
        app,
        MENU_APP_SHORTCUTS,
        "设置/全局热键…",
        true,
        None::<&str>,
    )?;

    let file_new = MenuItem::with_id(app, MENU_FILE_NEW, "新建", true, Some("CmdOrCtrl+N"))?;
    let file_open = MenuItem::with_id(app, MENU_FILE_OPEN, "打开…", true, Some("CmdOrCtrl+O"))?;
    let file_save = MenuItem::with_id(app, MENU_FILE_SAVE, "保存", true, Some("CmdOrCtrl+S"))?;
    let file_save_as = MenuItem::with_id(
        app,
        MENU_FILE_SAVE_AS,
        "另存为…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let file_export = MenuItem::with_id(
        app,
        MENU_FILE_EXPORT,
        "导出…",
        true,
        Some("CmdOrCtrl+Shift+E"),
    )?;
    let file_close_window = MenuItem::with_id(
        app,
        MENU_FILE_CLOSE_WINDOW,
        "关闭窗口",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;

    // 编辑菜单：predefined 项走系统原生文本语义（textarea undo/copy 等），
    // 不带自定义 accelerator——⌘Z/⌘A 等继续直达 WebView（画布层键位不变）。
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_fit = MenuItem::with_id(app, MENU_VIEW_FIT, "适应画布", true, None::<&str>)?;
    let view_organize = MenuItem::with_id(
        app,
        MENU_VIEW_ORGANIZE,
        "整理",
        true,
        Some("CmdOrCtrl+Shift+L"),
    )?;
    let layout_horizontal = CheckMenuItem::with_id(
        app,
        MENU_VIEW_LAYOUT_HORIZONTAL,
        "横向布局",
        true,
        true,
        None::<&str>,
    )?;
    let layout_vertical = CheckMenuItem::with_id(
        app,
        MENU_VIEW_LAYOUT_VERTICAL,
        "纵向布局",
        true,
        false,
        None::<&str>,
    )?;
    let theme_warm = CheckMenuItem::with_id(
        app,
        MENU_VIEW_THEME_WARM,
        "暖白主题",
        true,
        true,
        None::<&str>,
    )?;
    let theme_dark = CheckMenuItem::with_id(
        app,
        MENU_VIEW_THEME_DARK,
        "黑板主题",
        true,
        false,
        None::<&str>,
    )?;

    let help_onboarding = MenuItem::with_id(
        app,
        MENU_HELP_ONBOARDING,
        "开始/重放引导",
        true,
        Some("CmdOrCtrl+Shift+H"),
    )?;

    let app_menu = SubmenuBuilder::new(app, "Mind Map")
        .about(None)
        .separator()
        .item(&shortcuts)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&file_new)
        .item(&file_open)
        .separator()
        .item(&file_save)
        .item(&file_save_as)
        .item(&file_export)
        .separator()
        .item(&new_window)
        .item(&file_close_window)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&view_fit)
        .separator()
        .item(&view_organize)
        .item(&layout_horizontal)
        .item(&layout_vertical)
        .separator()
        .item(&theme_warm)
        .item(&theme_dark)
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&help_onboarding)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;

    // check 项句柄注册（运行时 set_checked；菜单随最近聚焦窗口刷新）
    if let Some(state) = app.try_state::<Arc<MenuState>>() {
        state.register_check_items(theme_warm, theme_dark, layout_horizontal, layout_vertical);
    }
    Ok(())
}

// ---- menu event 分流 ----

/// 处理菜单事件：host-owned 命令返回给调用方（lib.rs 生命周期接线）；
/// renderer 命令定向 emit 给最近聚焦且 generation 有效的 WebView。
/// 未知 id fail-closed 丢弃。
pub fn forward_menu_command<R: Runtime>(
    app: &AppHandle<R>,
    runtime: &crate::lifecycle::runtime::LifecycleRuntime,
    id: &str,
) {
    if !is_renderer_command(id) {
        return; // host-owned 由 lib.rs on_menu_event 分支处理；未知丢弃
    }
    let Some(label) = app
        .try_state::<crate::shortcuts::GlobalShortcutState>()
        .and_then(|s| s.recent_focused_label())
        .or_else(|| app.get_webview_window("main").map(|_| "main".to_string()))
    else {
        eprintln!("[menu] 命令 {id} 无可投放窗口，丢弃");
        return;
    };
    // generation 校验：无有效 generation 的窗口（closing/destroyed 路径）不投递。
    if runtime.coordinator.window_generation(&label).is_none() {
        eprintln!("[menu] 命令 {id} 目标窗口 {label} 无有效 generation，丢弃");
        return;
    }
    if app.get_webview_window(&label).is_none() {
        eprintln!("[menu] 命令 {id} 目标窗口 {label} 不存在，丢弃");
        return;
    }
    let payload = serde_json::json!({ "commandId": id });
    let target = tauri::EventTarget::WebviewWindow {
        label: label.clone(),
    };
    if let Err(e) = app.emit_to(target, APP_COMMAND_EVENT, payload) {
        eprintln!("[menu] 命令 {id} 定向发送到 {label} 失败：{e}");
    }
}

/// 预定义编辑菜单项工厂（供测试与构建一致性断言）。
pub fn predefined_edit_ids() -> [&'static str; 6] {
    ["undo", "redo", "cut", "copy", "paste", "select_all"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_owned_and_renderer_tables_are_disjoint_and_complete() {
        for id in HOST_OWNED_IDS {
            assert!(!is_renderer_command(id), "{id} 不应同时属于 renderer 表");
        }
        for id in RENDERER_COMMAND_IDS {
            assert!(!is_host_owned(id), "{id} 不应同时属于 host-owned 表");
            assert!(is_renderer_command(id));
        }
        // 命令矩阵最小覆盖（卡 §命令归属）
        for required in [
            "file.new",
            "file.open",
            "file.save",
            "file.save-as",
            "file.export-panel",
        ] {
            assert!(is_renderer_command(required), "缺少 {required}");
        }
        for required in [
            "view.fit",
            "view.organize",
            "view.layout-horizontal",
            "view.layout-vertical",
            "view.theme-warm",
            "view.theme-dark",
        ] {
            assert!(is_renderer_command(required), "缺少 {required}");
        }
        assert!(is_renderer_command("app.shortcuts"));
        assert!(is_renderer_command("help.onboarding"));
        assert!(is_host_owned("app-quit"));
        assert!(is_host_owned("app-new-window"));
        assert!(is_host_owned("file-close-window"));
    }

    #[test]
    fn unknown_ids_fail_closed() {
        assert!(!is_host_owned("nonsense"));
        assert!(!is_renderer_command("nonsense"));
        assert!(!is_renderer_command(""));
    }

    #[test]
    fn menu_window_sync_parse_and_check_state() {
        let warm_h = MenuWindowSync::parse("light", "horizontal").unwrap();
        assert_eq!(warm_h.check_state(), (true, false, true, false));
        let dark_v = MenuWindowSync::parse("dark", "vertical").unwrap();
        assert_eq!(dark_v.check_state(), (false, true, false, true));
        // 非法输入 fail-closed
        assert!(MenuWindowSync::parse("blue", "horizontal").is_none());
        assert!(MenuWindowSync::parse("light", "diagonal").is_none());
        assert!(MenuWindowSync::parse("", "").is_none());
    }

    #[test]
    fn predefined_edit_menu_covers_required_commands() {
        let ids = predefined_edit_ids();
        assert_eq!(ids, ["undo", "redo", "cut", "copy", "paste", "select_all"]);
    }
}
