// 桌面组合根（Rust 侧）：窗口生命周期、事件路由的宿主。
// 禁止：服务器监听、远程 API、遥测。文件能力由 MM-060 以最小权限加入。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mindmap_desktop_lib::run()
}
