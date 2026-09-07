//! 生命周期模块：host 侧启动协调、原生关闭状态机、窗口注册状态机与
//! 生产 LifecycleRuntime（MRT-004A 起；Wave 2 接线）。
//! `launch.rs` 的 LaunchIntentStore 是 MM-060 历史队列：生产装配已由
//! LifecycleRuntime/launch_coordinator 取代（MRT-004 Wave 2），仅保留
//! 供既有单元测试与审计对照。

pub mod close;
pub mod launch;
pub mod launch_coordinator;
pub mod runtime;
pub mod window_registry;
