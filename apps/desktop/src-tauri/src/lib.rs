// Tauri host 层。MM-020：最小窗口 + 单实例插件。
// MM-060 将加入：文件/对话框 IPC、commit protocol、LaunchRouter、偏好。

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            // MM-060 LaunchRouter 将接管 argv 文件路由；当前仅记录。
            println!("[event] second-instance {:?}", argv);
        }))
        .run(tauri::generate_context!())
        .expect("error while running mindmap desktop");
}
