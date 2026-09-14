//! macOS 文档保存面板：`.mindmap` / `.json` 可见格式选择（OFR-2026-09-14 #3）。
//!
//! 背景：tauri-plugin-dialog（rfd 0.16）在 macOS 把全部 filter 合并进
//! `NSSavePanel allowedFileTypes`，系统不会因此显示格式 popup（vendored
//! `rfd-0.16.0/src/backend/macos/file_dialog/panel_ffi.rs` `add_filters`；
//! 2026-09-15 原生 dogfood S5 #3 红灯实证面板 AX 树无任何格式控件）。
//! 本模块自承载 NSSavePanel accessory view（「格式：」+ NSPopUpButton），
//! 切换实时更新 name field 扩展名，保证覆盖确认与最终文件名一致。
//! 两种扩展名写入同一份 canonical JSON，host 不做扩展名策略（与 open
//! 对话框接受范围一致）。仅 macOS 使用；其他平台仍走 rfd（Windows 通用
//! 保存对话框原生显示 filter 下拉）。

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
        NSModalResponseOK, NSPopUpButton, NSSavePanel, NSTextField, NSView, NSWindow,
    };
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};

    use crate::file::error::IpcError;

    const EXT_MINDMAP: &str = "mindmap";
    const EXT_JSON: &str = "json";

    /// 把文件名扩展名换成所选格式；未带已知扩展名时直接追加。
    /// 保留用户输入的基础名与大小写；已带其他扩展名（如 `.txt`）不剥除。
    fn swap_extension(name: &str, ext: &str) -> String {
        let lower = name.to_ascii_lowercase();
        for known in [EXT_MINDMAP, EXT_JSON] {
            let suffix = format!(".{known}");
            if lower.ends_with(&suffix) {
                return format!("{}.{ext}", &name[..name.len() - suffix.len()]);
            }
        }
        format!("{name}.{ext}")
    }

    struct FormatDelegateIvars {
        panel: Retained<NSSavePanel>,
    }

    define_class!(
        // SAFETY:
        // - 超类 NSObject 没有子类化要求；
        // - FormatDelegate 不实现 Drop；
        // - 仅在主线程创建与使用（ivars 持有 NSSavePanel，MainThreadOnly）。
        #[unsafe(super(objc2_foundation::NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "MindMapSaveFormatDelegate"]
        #[ivars = FormatDelegateIvars]
        struct FormatDelegate;

        impl FormatDelegate {
            // 格式切换 → 同步更换 name field 扩展名（覆盖确认与最终文件名
            // 保持一致；用户随后手工改扩展名仍以用户输入为准）。
            #[unsafe(method(formatChanged:))]
            fn format_changed(&self, sender: &NSPopUpButton) {
                let ext = if sender.indexOfSelectedItem() == 1 {
                    EXT_JSON
                } else {
                    EXT_MINDMAP
                };
                let panel = &self.ivars().panel;
                let current = panel.nameFieldStringValue().to_string();
                let renamed = swap_extension(&current, ext);
                panel.setNameFieldStringValue(&NSString::from_str(&renamed));
            }
        }
    );

    impl FormatDelegate {
        fn new(mtm: MainThreadMarker, panel: Retained<NSSavePanel>) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(FormatDelegateIvars { panel });
            unsafe { msg_send![super(this), init] }
        }
    }

    /// 主线程入口：构建并以 sheet 形式运行文档保存面板。
    /// 返回用户选择的路径；取消返回 None。
    fn run_panel_on_main(
        mtm: MainThreadMarker,
        parent: Option<Retained<NSWindow>>,
        suggested_name: &str,
    ) -> Option<PathBuf> {
        let panel = NSSavePanel::savePanel(mtm);
        panel.setCanCreateDirectories(true);
        // 两种扩展名均为合法输入（用户手改扩展名同样接受，与旧 rfd 路径一致）。
        let allowed = [
            NSString::from_str(EXT_MINDMAP),
            NSString::from_str(EXT_JSON),
        ];
        #[allow(deprecated)]
        panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&allowed)));
        panel.setNameFieldStringValue(&NSString::from_str(suggested_name));

        // accessory view：负责人要求的可见格式选择（OFR-2026-09-14 #3）。
        let container: Retained<NSView> = NSView::initWithFrame(
            mtm.alloc(),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(300.0, 30.0)),
        );
        let label = NSTextField::labelWithString(&NSString::from_str("格式："), mtm);
        label.setFrame(NSRect::new(NSPoint::new(0.0, 4.0), NSSize::new(46.0, 22.0)));
        let popup = NSPopUpButton::initWithFrame_pullsDown(
            mtm.alloc(),
            NSRect::new(NSPoint::new(48.0, 1.0), NSSize::new(240.0, 27.0)),
            false,
        );
        popup.addItemWithTitle(&NSString::from_str("Mind Map 文档 (.mindmap)"));
        popup.addItemWithTitle(&NSString::from_str("JSON (.json)"));
        // 建议名已为 .json 时默认选中 JSON，与 name field 保持一致。
        if suggested_name.to_ascii_lowercase().ends_with(".json") {
            popup.selectItemAtIndex(1);
        }
        let delegate = FormatDelegate::new(mtm, panel.clone());
        unsafe {
            // SAFETY: delegate 存活至 runModal 返回（下方 drop），panel 持有
            // accessory view；NSControl 的 target 为弱引用，生命周期已覆盖。
            let target: *const AnyObject = Retained::as_ptr(&delegate).cast();
            popup.setTarget(Some(&*target));
            popup.setAction(Some(sel!(formatChanged:)));
        }
        container.addSubview(&label);
        container.addSubview(&popup);
        panel.setAccessoryView(Some(&container));

        // 与旧 rfd 路径一致：有父窗口时以 sheet 呈现并 modal 等待。
        let response = match parent {
            Some(parent) => {
                let completion = StackBlock::new(|_: isize| {});
                panel.beginSheetModalForWindow_completionHandler(&parent, &completion);
                panel.runModal()
            }
            None => panel.runModal(),
        };
        // delegate 必须存活到 modal 结束（popup target 为弱引用）。
        drop(delegate);

        if response == NSModalResponseOK {
            panel
                .URL()
                .and_then(|url| url.path())
                .map(|p| PathBuf::from(p.to_string()))
        } else {
            None
        }
    }

    /// 任意线程入口：调度到主线程运行 sheet 并阻塞等待结果。
    pub fn pick_document_save_target(
        app: &tauri::AppHandle,
        parent_ns_window: *mut c_void,
        suggested_name: &str,
    ) -> Result<Option<PathBuf>, IpcError> {
        let (tx, rx) = mpsc::channel();
        let suggested = suggested_name.to_string();
        let parent_addr = parent_ns_window as usize;
        app.run_on_main_thread(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mtm =
                    MainThreadMarker::new().expect("run_on_main_thread 必须在主线程执行");
                // SAFETY: 指针来自 tauri WebviewWindow::ns_window()；调用方在
                // 命令线程阻塞等待结果，窗口在面板 modal 期间保持存活。
                let parent = unsafe { Retained::retain(parent_addr as *mut NSWindow) };
                run_panel_on_main(mtm, parent, &suggested)
            }));
            let _ = tx.send(outcome);
        })
        .map_err(|e| IpcError::new("FILE_IO_ERROR", format!("保存面板调度失败：{e}")))?;
        match rx.recv() {
            Ok(Ok(path)) => Ok(path),
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

    #[cfg(test)]
    mod tests {
        use super::swap_extension;

        #[test]
        fn swaps_known_extensions_case_insensitively() {
            assert_eq!(swap_extension("未命名.mindmap", "json"), "未命名.json");
            assert_eq!(swap_extension("未命名.json", "mindmap"), "未命名.mindmap");
            assert_eq!(swap_extension("a.JSON", "mindmap"), "a.mindmap");
            assert_eq!(swap_extension("dir.dot.json", "mindmap"), "dir.dot.mindmap");
        }

        #[test]
        fn appends_when_no_known_extension() {
            assert_eq!(swap_extension("未命名", "mindmap"), "未命名.mindmap");
            assert_eq!(swap_extension("notes.txt", "json"), "notes.txt.json");
        }
    }
}

#[cfg(target_os = "macos")]
pub use imp::pick_document_save_target;
