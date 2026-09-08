//! DocumentTargetHandle registry（MM-060 步骤④⑤ → PRR-050 active-session）：
//! 绑定 window/session 的 opaque 句柄。openDocument / 成功 Save As 签发；
//! ordinary Save 用 handle + expectedVersionToken 提交，不重开对话框。
//! 伪造（不在 registry）、跨窗口、窗口关闭撤销均拒绝。
//!
//! PRR-050（RLS-012）：每个窗口同一时刻**最多一个 active document handle**
//!（外加被显式建模的 in-flight transition）。新 handle 签发（open / Save As）
//! 与旧 active handle 的撤销发生在同一临界区（replace-and-revoke）——
//! 掌握旧 opaque handle/token 的 renderer 不能继续对旧路径 ordinary save。
//! record 额外绑定签发时的窗口 generation：窗口重建（Destroyed 清理遗漏的
//! 竞态）后，旧 generation 的 handle 即使仍在 map 中也会被 validate 拒绝。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use super::error::{ServiceError, ServiceResult};
use super::identity;

#[derive(Debug, Clone)]
pub struct DocumentHandleRecord {
    pub window_label: String,
    pub canonical_path: PathBuf,
    /// 签发时的窗口 generation（PRR-050：旧代 handle 不得用于同名新窗）。
    pub window_generation: u64,
    /// 同窗 binding 序号（诊断：观察 active 替换历史）。
    pub binding_id: u64,
}

#[derive(Default)]
struct RegistryState {
    handles: HashMap<String, DocumentHandleRecord>,
    /// window_label → 当前唯一 active handle id。
    active: HashMap<String, String>,
    next_binding: u64,
}

#[derive(Default)]
pub struct HandleRegistry {
    inner: Mutex<RegistryState>,
}

impl HandleRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(RegistryState::default()),
        }
    }

    /// 签发新 handle 并在同一临界区撤销该窗口旧的 active handle
    /// （replace-and-revoke：Save As / open 完成后旧 handle 立即失效）。
    pub fn issue(
        &self,
        window_label: &str,
        canonical_path: PathBuf,
        window_generation: u64,
    ) -> String {
        let mut st = self.inner.lock().unwrap();
        if let Some(old_active) = st.active.remove(window_label) {
            st.handles.remove(&old_active);
        }
        st.next_binding += 1;
        let binding_id = st.next_binding;
        let id = identity::new_handle_id();
        st.handles.insert(
            id.clone(),
            DocumentHandleRecord {
                window_label: window_label.to_string(),
                canonical_path,
                window_generation,
                binding_id,
            },
        );
        st.active.insert(window_label.to_string(), id.clone());
        id
    }

    /// 兼容入口：不带 generation（视为第 1 代；仅测试/旧调用使用）。
    pub fn issue_at_generation_1(&self, window_label: &str, canonical_path: PathBuf) -> String {
        self.issue(window_label, canonical_path, 1)
    }

    /// 校验 handle 属于当前窗口、仍为该窗口的 active handle，且（提供
    /// current_generation 时）未跨窗口重建代。返回其 canonical path。
    pub fn validate(
        &self,
        handle: &str,
        window_label: &str,
        current_generation: Option<u64>,
    ) -> ServiceResult<PathBuf> {
        let st = self.inner.lock().unwrap();
        let rec = st
            .handles
            .get(handle)
            .ok_or_else(|| ServiceError::invalid_handle("句柄不存在或已撤销"))?;
        if rec.window_label != window_label {
            return Err(ServiceError::invalid_handle("句柄不属于当前窗口"));
        }
        if st.active.get(window_label).map(String::as_str) != Some(handle) {
            return Err(ServiceError::invalid_handle(
                "句柄已被更新的文档目标取代（active handle 已替换）",
            ));
        }
        if let Some(generation) = current_generation {
            if rec.window_generation != generation {
                return Err(ServiceError::invalid_handle(
                    "句柄绑定的是旧窗口代，不能用于同名新窗口",
                ));
            }
        }
        Ok(rec.canonical_path.clone())
    }

    /// 撤销某窗口全部句柄与 active 绑定（窗口关闭；session 结束随进程消亡）。
    pub fn revoke_window(&self, window_label: &str) {
        let mut st = self.inner.lock().unwrap();
        st.handles.retain(|_, r| r.window_label != window_label);
        st.active.remove(window_label);
    }

    /// 精确撤销单个 handle（MRT-004W2R R6：open 竞态中签发、随后交付校验
    /// 失败的孤立 capability 不得存活）。返回是否确实移除。
    pub fn revoke_handle(&self, handle: &str) -> bool {
        let mut st = self.inner.lock().unwrap();
        let removed = st.handles.remove(handle).is_some();
        st.active.retain(|_, active| active != handle);
        removed
    }

    /// 只读诊断：该窗口当前存活的 handle 数量（PRR-050：稳定窗口恒为
    /// 0 或 1——多个即存在 orphan/stale capability；测试/证据观测通道）。
    pub fn count_for_window(&self, window_label: &str) -> usize {
        self.inner
            .lock()
            .unwrap()
            .handles
            .values()
            .filter(|r| r.window_label == window_label)
            .count()
    }

    /// 只读诊断：该窗口当前 active handle id（断言 replace-and-revoke 的
    /// 直接观察通道）。
    pub fn active_handle_for_window(&self, window_label: &str) -> Option<String> {
        self.inner.lock().unwrap().active.get(window_label).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(name: &str) -> PathBuf {
        PathBuf::from(format!("/tmp/prr050/{name}"))
    }

    #[test]
    fn issue_replaces_and_revokes_previous_active_handle() {
        let registry = HandleRegistry::new();
        let h1 = registry.issue("main", path("a.mindmap"), 1);
        let h2 = registry.issue("main", path("b.mindmap"), 1);
        // 旧 handle 立即失效（active 已替换）
        assert!(registry.validate(&h1, "main", Some(1)).is_err());
        assert!(registry.validate(&h2, "main", Some(1)).is_ok());
        // 稳定窗口最多一个存活 handle
        assert_eq!(registry.count_for_window("main"), 1);
        assert_eq!(registry.active_handle_for_window("main"), Some(h2));
    }

    #[test]
    fn old_generation_handle_rejected_for_rebuilt_window() {
        let registry = HandleRegistry::new();
        let h1 = registry.issue("main", path("a.mindmap"), 1);
        // 窗口重建：generation 2（模拟 Destroyed 清理遗漏的竞态残留）
        assert!(registry.validate(&h1, "main", Some(2)).is_err());
        // 不带 generation 的调用（测试兼容口）仍查 active 归属
        assert!(registry.validate(&h1, "main", None).is_ok());
    }

    #[test]
    fn cross_window_and_unknown_handles_rejected() {
        let registry = HandleRegistry::new();
        let h1 = registry.issue("main", path("a.mindmap"), 1);
        assert!(registry.validate(&h1, "editor-1", Some(1)).is_err());
        assert!(registry.validate("forged", "main", Some(1)).is_err());
    }

    #[test]
    fn revoke_window_clears_active_binding() {
        let registry = HandleRegistry::new();
        let h1 = registry.issue("main", path("a.mindmap"), 1);
        registry.revoke_window("main");
        assert!(registry.validate(&h1, "main", Some(1)).is_err());
        assert_eq!(registry.count_for_window("main"), 0);
        assert_eq!(registry.active_handle_for_window("main"), None);
    }

    #[test]
    fn revoke_handle_removes_active_reference() {
        let registry = HandleRegistry::new();
        let h1 = registry.issue("main", path("a.mindmap"), 1);
        assert!(registry.revoke_handle(&h1));
        assert_eq!(registry.active_handle_for_window("main"), None);
        // 二次撤销幂等返回 false
        assert!(!registry.revoke_handle(&h1));
    }
}
