//! macOS 保存面板（自承载 NSSavePanel + accessory 格式选择）。
//!
//! 背景：tauri-plugin-dialog（rfd 0.16）在 macOS 把全部 filter 合并进
//! `NSSavePanel allowedFileTypes`，系统不会因此显示格式 popup（vendored
//! `rfd-0.16.0/src/backend/macos/file_dialog/panel_ffi.rs` `add_filters`；
//! 2026-09-15 原生 dogfood S5 #3 红灯实证面板 AX 树无任何格式控件）。
//!
//! 两个入口（OFR-2026-09-15 负责人定稿，PRD §8.2 出口合并）：
//! - `pick_document_save_target`：「保存/保存副本」——仅 `.mindmap` 单一
//!   可编辑格式，无格式 popup；
//! - `pick_unified_save_target`：「存储为…」（另存为与导出合并）——五格式
//!   分两组（可编辑文档 .mindmap；导出产物 SVG/PNG/PDF/Graph JSON），
//!   切换实时联动 name field 扩展名（覆盖确认与最终文件名一致）；选导出
//!   格式且文档从未保存过时显示"将同时保留可编辑源文件"提示（调用方据此
//!   生成双授权）。仅 macOS 使用；其他平台仍走 rfd（Windows 通用对话框
//!   原生显示 filter 下拉）。

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::path::PathBuf;
    use std::sync::mpsc;

    use block2::StackBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSModalResponseOK, NSMenuItem, NSPopUpButton, NSSavePanel, NSTextField, NSView, NSWindow,
    };
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};

    use crate::file::error::IpcError;

    /// 「存储为…」面板的可选格式（分两组：可编辑文档 / 导出产物）。
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum UnifiedFormat {
        Mindmap,
        Svg,
        Png,
        Pdf,
        GraphJson,
    }

    impl UnifiedFormat {
        /// 稳定扩展名；Graph JSON 为双段 `.graph.json`（与 exportSuggestedName 契约一致）。
        pub fn ext(self) -> &'static str {
            match self {
                Self::Mindmap => "mindmap",
                Self::Svg => "svg",
                Self::Png => "png",
                Self::Pdf => "pdf",
                Self::GraphJson => "graph.json",
            }
        }

        /// IPC 契约值（camelCase DTO 的 format 字段）。
        pub fn as_ipc_str(self) -> &'static str {
            match self {
                Self::Mindmap => "mindmap",
                Self::Svg => "svg",
                Self::Png => "png",
                Self::Pdf => "pdf",
                Self::GraphJson => "graph-json",
            }
        }

        /// 是否可编辑文档格式（= 文档授权；其余走导出授权）。
        pub fn is_document(self) -> bool {
            matches!(self, Self::Mindmap)
        }
    }

    /// 用户在「存储为…」面板的最终选择。
    #[derive(Debug)]
    pub struct UnifiedChoice {
        pub path: PathBuf,
        pub format: UnifiedFormat,
    }

    /// 已知的可交换扩展名（长后缀优先：`.graph.json` 先于 `.json`）。
    const KNOWN_EXTS: [&str; 6] = ["graph.json", "mindmap", "svg", "png", "pdf", "json"];

    /// 把文件名扩展名换成所选格式；未带已知扩展名时直接追加。
    /// 保留用户输入的基础名与大小写；已带其他扩展名（如 `.txt`）不剥除。
    fn swap_extension(name: &str, ext: &str) -> String {
        let lower = name.to_ascii_lowercase();
        for known in KNOWN_EXTS {
            let suffix = format!(".{known}");
            if lower.ends_with(&suffix) {
                return format!("{}.{ext}", &name[..name.len() - suffix.len()]);
            }
        }
        format!("{name}.{ext}")
    }

    /// popup 行索引 → 格式（索引 1 是分组分隔线，不可选）。
    fn format_for_index(index: usize) -> UnifiedFormat {
        match index {
            0 => UnifiedFormat::Mindmap,
            2 => UnifiedFormat::Svg,
            3 => UnifiedFormat::Png,
            4 => UnifiedFormat::Pdf,
            5 => UnifiedFormat::GraphJson,
            _ => UnifiedFormat::Mindmap, // 防御：分隔线不可选，理论上不可达
        }
    }

    struct FormatDelegateIvars {
        panel: Retained<NSSavePanel>,
        hint: Retained<NSTextField>,
        /// 文档是否已有保存目标（决定"补写源文件"提示是否出现）。
        document_saved: bool,
    }

    define_class!(
        // SAFETY:
        // - 超类 NSObject 没有子类化要求；
        // - FormatDelegate 不实现 Drop；
        // - 仅在主线程创建与使用（ivars 持有 NSSavePanel/NSTextField，MainThreadOnly）。
        #[unsafe(super(objc2_foundation::NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "MindMapSaveFormatDelegate"]
        #[ivars = FormatDelegateIvars]
        struct FormatDelegate;

        impl FormatDelegate {
            // 格式切换 → 同步更换 name field 扩展名（覆盖确认与最终文件名
            // 保持一致；用户随后手工改扩展名仍以用户输入为准），并按
            // PRD §8.2 兜底规则刷新"补写源文件"提示。
            #[unsafe(method(formatChanged:))]
            fn format_changed(&self, sender: &NSPopUpButton) {
                let format = format_for_index(sender.indexOfSelectedItem().max(0) as usize);
                let panel = &self.ivars().panel;
                let current = panel.nameFieldStringValue().to_string();
                let renamed = swap_extension(&current, format.ext());
                panel.setNameFieldStringValue(&NSString::from_str(&renamed));
                let show_hint = !format.is_document() && !self.ivars().document_saved;
                self.ivars().hint.setHidden(!show_hint);
            }
        }
    );

    impl FormatDelegate {
        fn new(
            mtm: MainThreadMarker,
            panel: Retained<NSSavePanel>,
            hint: Retained<NSTextField>,
            document_saved: bool,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(FormatDelegateIvars {
                panel,
                hint,
                document_saved,
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    /// 调度到主线程运行面板并阻塞等待结果（公共骨架）。
    fn run_on_main<T: Send + 'static>(
        app: &tauri::AppHandle,
        parent_ns_window: *mut c_void,
        body: impl FnOnce(MainThreadMarker, Option<Retained<NSWindow>>) -> T + Send + 'static,
    ) -> Result<T, IpcError> {
        let (tx, rx) = mpsc::channel();
        let parent_addr = parent_ns_window as usize;
        app.run_on_main_thread(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mtm =
                    MainThreadMarker::new().expect("run_on_main_thread 必须在主线程执行");
                // SAFETY: 指针来自 tauri WebviewWindow::ns_window()；调用方在
                // 命令线程阻塞等待结果，窗口在面板 modal 期间保持存活。
                let parent = unsafe { Retained::retain(parent_addr as *mut NSWindow) };
                body(mtm, parent)
            }));
            let _ = tx.send(outcome);
        })
        .map_err(|e| IpcError::new("FILE_IO_ERROR", format!("保存面板调度失败：{e}")))?;
        match rx.recv() {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_panic)) => Err(IpcError::new(
                "FILE_IO_ERROR",
                "保存面板在主线程异常终止".to_string(),
            )),
            Err(_) => Err(IpcError::new(
                "FILE_IO_ERROR",
                "保存面板结果通道中断".to_string(),
            )),
        }
    }

    /// 以 sheet 呈现并 modal 等待（与旧 rfd 路径一致）。
    fn present(panel: &NSSavePanel, parent: Option<Retained<NSWindow>>) -> isize {
        match parent {
            Some(parent) => {
                let completion = StackBlock::new(|_: isize| {});
                panel.beginSheetModalForWindow_completionHandler(&parent, &completion);
                panel.runModal()
            }
            None => panel.runModal(),
        }
    }

    fn panel_url_path(panel: &NSSavePanel, response: isize) -> Option<PathBuf> {
        if response != NSModalResponseOK {
            return None;
        }
        panel
            .URL()
            .and_then(|url| url.path())
            .map(|p| PathBuf::from(p.to_string()))
    }

    /// 「保存」文档面板：单一 `.mindmap` 可编辑格式（OFR-2026-09-15 定稿，
    /// 不再提供 `.json` 选项；既有 .json 文档打开兼容不变）。
    pub fn pick_document_save_target(
        app: &tauri::AppHandle,
        parent_ns_window: *mut c_void,
        suggested_name: &str,
    ) -> Result<Option<PathBuf>, IpcError> {
        let suggested = suggested_name.to_string();
        run_on_main(app, parent_ns_window, move |mtm, parent| {
            let panel = NSSavePanel::savePanel(mtm);
            panel.setCanCreateDirectories(true);
            let allowed = [NSString::from_str("mindmap")];
            #[allow(deprecated)]
            panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&allowed)));
            panel.setNameFieldStringValue(&NSString::from_str(&suggested));
            let response = present(&panel, parent);
            panel_url_path(&panel, response)
        })
    }

    /// 「存储为…」统一面板：五格式分两组 + 扩展名联动 + 补写提示。
    /// `document_saved` 决定"将同时保留可编辑源文件"提示的可见性（调用方
    /// 据此规则同时签发文档兜底授权）。
    pub fn pick_unified_save_target(
        app: &tauri::AppHandle,
        parent_ns_window: *mut c_void,
        suggested_name: &str,
        document_saved: bool,
    ) -> Result<Option<UnifiedChoice>, IpcError> {
        let suggested = suggested_name.to_string();
        run_on_main(app, parent_ns_window, move |mtm, parent| {
            let panel = NSSavePanel::savePanel(mtm);
            panel.setCanCreateDirectories(true);
            // 五种扩展名均为合法输入（用户手改扩展名同样接受）。
            let allowed: Vec<Retained<NSString>> = KNOWN_EXTS
                .iter()
                .map(|e| NSString::from_str(e))
                .collect();
            #[allow(deprecated)]
            panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&allowed)));
            panel.setNameFieldStringValue(&NSString::from_str(&suggested));

            // accessory view：「格式：」popup（分两组）+ 兜底提示行。
            let container: Retained<NSView> = NSView::initWithFrame(
                mtm.alloc(),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(340.0, 52.0)),
            );
            let label = NSTextField::labelWithString(&NSString::from_str("格式："), mtm);
            label.setFrame(NSRect::new(NSPoint::new(0.0, 26.0), NSSize::new(46.0, 22.0)));
            let popup = NSPopUpButton::initWithFrame_pullsDown(
                mtm.alloc(),
                NSRect::new(NSPoint::new(48.0, 23.0), NSSize::new(280.0, 27.0)),
                false,
            );
            popup.addItemWithTitle(&NSString::from_str("Mind Map 文档 (.mindmap)"));
            if let Some(menu) = popup.menu() {
                menu.addItem(&NSMenuItem::separatorItem(mtm));
            }
            popup.addItemWithTitle(&NSString::from_str("SVG (.svg)"));
            popup.addItemWithTitle(&NSString::from_str("PNG 2x (.png)"));
            popup.addItemWithTitle(&NSString::from_str("PDF (.pdf)"));
            popup.addItemWithTitle(&NSString::from_str("Graph JSON (.graph.json)"));
            let hint = NSTextField::labelWithString(
                &NSString::from_str("导出格式不能重新打开编辑；将同时保留可编辑源文件 (.mindmap)"),
                mtm,
            );
            hint.setFrame(NSRect::new(NSPoint::new(48.0, 2.0), NSSize::new(330.0, 18.0)));
            hint.setHidden(true); // 初始为文档格式，提示不显示
            let delegate = FormatDelegate::new(mtm, panel.clone(), hint.clone(), document_saved);
            unsafe {
                // SAFETY: delegate 存活至 runModal 返回（下方 drop），panel 持有
                // accessory view；NSControl 的 target 为弱引用，生命周期已覆盖。
                let target: *const AnyObject = Retained::as_ptr(&delegate).cast();
                popup.setTarget(Some(&*target));
                popup.setAction(Some(sel!(formatChanged:)));
            }
            container.addSubview(&label);
            container.addSubview(&popup);
            container.addSubview(&hint);
            panel.setAccessoryView(Some(&container));

            let response = present(&panel, parent);
            let format = format_for_index(popup.indexOfSelectedItem().max(0) as usize);
            // delegate 必须存活到 modal 结束（popup target 为弱引用）。
            drop(delegate);
            panel_url_path(&panel, response).map(|path| UnifiedChoice { path, format })
        })
    }

    #[cfg(test)]
    mod tests {
        use super::{format_for_index, swap_extension, UnifiedFormat};

        #[test]
        fn swaps_known_extensions_case_insensitively() {
            assert_eq!(swap_extension("未命名.mindmap", "svg"), "未命名.svg");
            assert_eq!(swap_extension("未命名.graph.json", "mindmap"), "未命名.mindmap");
            assert_eq!(swap_extension("a.JSON", "pdf"), "a.pdf");
            assert_eq!(swap_extension("图.png", "graph.json"), "图.graph.json");
            // 长后缀优先：`.graph.json` 整体被替换，不产生 `图.graph.svg`
            assert_eq!(swap_extension("图.graph.json", "svg"), "图.svg");
        }

        #[test]
        fn appends_when_no_known_extension() {
            assert_eq!(swap_extension("未命名", "mindmap"), "未命名.mindmap");
            assert_eq!(swap_extension("notes.txt", "pdf"), "notes.txt.pdf");
        }

        #[test]
        fn popup_index_maps_around_separator() {
            assert_eq!(format_for_index(0), UnifiedFormat::Mindmap);
            assert_eq!(format_for_index(2), UnifiedFormat::Svg);
            assert_eq!(format_for_index(3), UnifiedFormat::Png);
            assert_eq!(format_for_index(4), UnifiedFormat::Pdf);
            assert_eq!(format_for_index(5), UnifiedFormat::GraphJson);
            assert!(UnifiedFormat::Mindmap.is_document());
            assert!(!UnifiedFormat::Svg.is_document());
        }
    }
}

#[cfg(target_os = "macos")]
// 类型名不出现在调用方签名中（值语义消费），只导出函数入口。
pub use imp::{pick_document_save_target, pick_unified_save_target};
