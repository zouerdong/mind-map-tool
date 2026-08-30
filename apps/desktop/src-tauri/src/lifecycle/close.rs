//! CloseRequestStore（MRT-003 / CR-003）：host 主导的原生关闭状态机。
//!
//! 不变量（任务卡 §3）：
//! - host 掌握最终关闭权：未持有匹配的一次性 permit 时，CloseRequested
//!   一律由调用方 `prevent_close()` 并进入 Hold；
//! - 按真实 `window.label()` 隔离：pending 与 permit 均以 label 为键，
//!   不写死 `main`（MRT-004 多窗口不得重写本状态机）；
//! - 每窗最多一个活动请求：重复 close 复用当前 requestId（newly_created=false
//!   → 调用方不重发事件、不叠 modal）；
//! - response 单次消费：requestId 必须匹配该窗口当前 pending，伪造/跨窗/
//!   过期/重复一律 `INVALID_CLOSE_REQUEST`；
//! - 一次性放行：permit 只放行紧接着的一次原生 close，消费即除名；
//!   `window.close()` 失败由调用方 `rollback_permit`（恢复 pending，可重试），
//!   不得留下"下次关闭无条件放行"的残余状态；
//! - Destroyed 幂等清理 pending 与 permit；
//! - 应用退出逐窗协调：任一受管窗口未取得关闭许可即阻止整次退出。
//!
//! 本 store 不持有文档、路径或文件能力；Discard 分支的 capability revoke
//! 由调用方（lib.rs / ipc 层）在真正放行前对 FileLifecycleService 执行。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// 前端对一次 close request 的处置（与 TS 侧 CloseDisposition 一一对应）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDisposition {
    Clean,
    Saved,
    Discarded,
    Cancelled,
}

impl CloseDisposition {
    /// IPC 字符串 → 枚举（未知值由调用方以稳定错误拒绝）。
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "clean" => Some(Self::Clean),
            "saved" => Some(Self::Saved),
            "discarded" => Some(Self::Discarded),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// resolve 拒绝的唯一稳定错误码（伪造/跨窗/过期/已消费共用；与 TS 契约对应）。
pub const INVALID_CLOSE_REQUEST: &str = "INVALID_CLOSE_REQUEST";

/// CloseRequested 的处置决策。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloseDecision {
    /// 放行本次原生关闭（消费一次性 permit）；disposition 绝非 Cancelled。
    Permit { disposition: CloseDisposition },
    /// 阻止关闭并持有 pending。newly_created=false 表示复用既有请求，
    /// 调用方不得重发事件（前端已有流程在跑）。
    Hold {
        request_id: String,
        newly_created: bool,
    },
}

/// resolve 的结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveOutcome {
    /// 用户取消：pending 已清，不 close、无 permit。
    Cancelled,
    /// 已写入一次性 permit；调用方应执行 window.close()，
    /// 失败必须 rollback_permit 恢复 pending。
    PermitGranted { disposition: CloseDisposition },
}

/// 应用退出（ExitRequested）的协调结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExitGate {
    /// 全部受管窗口均已取得关闭许可（或无窗口）：放行退出。
    Allow,
    /// 阻止退出。new_requests 为本次新建的 (label, requestId)，
    /// 调用方须定向 emit close-requested；已有 pending/permit 的窗口不重建。
    Blocked { new_requests: Vec<(String, String)> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Permit {
    request_id: String,
    disposition: CloseDisposition,
}

/// 纯状态机（Mutex 内 HashMap；不依赖 tauri 类型，cargo test 直接覆盖）。
#[derive(Default)]
pub struct CloseRequestStore {
    pending: Mutex<HashMap<String, String>>,
    permits: Mutex<HashMap<String, Permit>>,
    counter: AtomicU64,
}

impl CloseRequestStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// CloseRequested 主入口。
    /// - 存在 permit → 消费并 Permit（放行；discarded 由调用方在放行前 revoke）；
    /// - 否则 Hold（调用方 prevent_close），建立或复用 pending。
    pub fn on_close_requested(&self, window_label: &str) -> CloseDecision {
        let mut pending = self.pending.lock().unwrap();
        let mut permits = self.permits.lock().unwrap();
        if let Some(permit) = permits.remove(window_label) {
            return CloseDecision::Permit {
                disposition: permit.disposition,
            };
        }
        if let Some(existing) = pending.get(window_label) {
            return CloseDecision::Hold {
                request_id: existing.clone(),
                newly_created: false,
            };
        }
        let id = self.next_request_id();
        pending.insert(window_label.to_string(), id.clone());
        CloseDecision::Hold {
            request_id: id,
            newly_created: true,
        }
    }

    /// 只读命令 platform_pending_close_request 的数据源。
    pub fn pending_request(&self, window_label: &str) -> Option<String> {
        self.pending.lock().unwrap().get(window_label).cloned()
    }

    /// platform_resolve_close_request：校验窗口与 requestId，单次消费。
    /// Cancelled 只清 pending（不 close、无 permit）；其余写入一次性 permit。
    pub fn resolve(
        &self,
        window_label: &str,
        request_id: &str,
        disposition: CloseDisposition,
    ) -> Result<ResolveOutcome, &'static str> {
        let mut pending = self.pending.lock().unwrap();
        let current = pending.get(window_label).ok_or(INVALID_CLOSE_REQUEST)?;
        if current != request_id {
            return Err(INVALID_CLOSE_REQUEST);
        }
        match disposition {
            CloseDisposition::Cancelled => {
                pending.remove(window_label);
                Ok(ResolveOutcome::Cancelled)
            }
            allowed => {
                pending.remove(window_label);
                self.permits.lock().unwrap().insert(
                    window_label.to_string(),
                    Permit {
                        request_id: request_id.to_string(),
                        disposition: allowed,
                    },
                );
                Ok(ResolveOutcome::PermitGranted {
                    disposition: allowed,
                })
            }
        }
    }

    /// window.close() 失败：撤回 permit 并恢复 pending（同 requestId 可重试）。
    /// 返回是否确实撤回了一个 permit（无 permit 时幂等返回 false）。
    pub fn rollback_permit(&self, window_label: &str) -> bool {
        let mut pending = self.pending.lock().unwrap();
        let mut permits = self.permits.lock().unwrap();
        match permits.remove(window_label) {
            Some(permit) => {
                pending.insert(window_label.to_string(), permit.request_id);
                true
            }
            None => false,
        }
    }

    /// Destroyed：幂等清理该窗口全部状态（pending 与未消费 permit）。
    pub fn on_destroyed(&self, window_label: &str) {
        self.pending.lock().unwrap().remove(window_label);
        self.permits.lock().unwrap().remove(window_label);
    }

    /// ExitRequested 协调：全部受管窗口均持有 permit 才放行；
    /// 未决窗口复用既有 pending（不重发），无请求的窗口新建。
    pub fn on_exit_requested(&self, managed_labels: &[String]) -> ExitGate {
        let mut pending = self.pending.lock().unwrap();
        let permits = self.permits.lock().unwrap();
        if managed_labels
            .iter()
            .all(|label| permits.contains_key(label))
        {
            return ExitGate::Allow;
        }
        let mut new_requests = Vec::new();
        for label in managed_labels {
            if permits.contains_key(label) || pending.contains_key(label) {
                continue;
            }
            let id = self.next_request_id();
            pending.insert(label.clone(), id.clone());
            new_requests.push((label.clone(), id));
        }
        ExitGate::Blocked { new_requests }
    }

    fn next_request_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("close-{n}-{}", uuid::Uuid::new_v4().simple())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W1: &str = "main";
    const W2: &str = "editor-2";

    #[test]
    fn r1_first_close_holds_with_new_pending_and_is_visible_in_snapshot() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold {
            request_id,
            newly_created,
        } = s.on_close_requested(W1)
        else {
            panic!("R1：无 permit 时首次 close 必须 Hold（fail closed）");
        };
        assert!(newly_created, "首次 close 必须新建请求");
        assert!(!request_id.is_empty());
        // pending 快照可被前端补读（listener 竞态补偿的数据源）
        assert_eq!(s.pending_request(W1).as_deref(), Some(request_id.as_str()));
    }

    #[test]
    fn r2_repeat_close_reuses_same_request_without_new_one() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold {
            request_id: first, ..
        } = s.on_close_requested(W1)
        else {
            panic!("R2：首次 close 必须 Hold");
        };
        let CloseDecision::Hold {
            request_id: second,
            newly_created,
        } = s.on_close_requested(W1)
        else {
            panic!("R2：pending 未决时重复 close 必须 Hold");
        };
        assert_eq!(second, first, "重复 close 复用同一 requestId");
        assert!(!newly_created, "复用请求不得标记新建（调用方不重发事件）");
        assert_eq!(s.pending_request(W1).as_deref(), Some(first.as_str()));
    }

    #[test]
    fn r2_windows_are_isolated_by_label() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold { request_id: m, .. } = s.on_close_requested(W1) else {
            panic!();
        };
        let CloseDecision::Hold {
            request_id: e,
            newly_created,
        } = s.on_close_requested(W2)
        else {
            panic!();
        };
        assert!(newly_created, "另一窗口的首个 close 是新请求");
        assert_ne!(m, e, "窗口间请求必须隔离");
        assert_eq!(s.pending_request(W1).as_deref(), Some(m.as_str()));
        assert_eq!(s.pending_request(W2).as_deref(), Some(e.as_str()));
    }

    #[test]
    fn r3_forged_request_id_rejected() {
        let s = CloseRequestStore::new();
        s.on_close_requested(W1);
        let err = s
            .resolve(W1, "close-forged", CloseDisposition::Saved)
            .unwrap_err();
        assert_eq!(err, INVALID_CLOSE_REQUEST);
    }

    #[test]
    fn r3_cross_window_resolve_rejected() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold { request_id, .. } = s.on_close_requested(W1) else {
            panic!();
        };
        let err = s
            .resolve(W2, &request_id, CloseDisposition::Saved)
            .unwrap_err();
        assert_eq!(err, INVALID_CLOSE_REQUEST);
    }

    #[test]
    fn r3_replayed_resolve_rejected_after_consumption() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold { request_id, .. } = s.on_close_requested(W1) else {
            panic!();
        };
        s.resolve(W1, &request_id, CloseDisposition::Cancelled)
            .unwrap();
        // 已消费：重放同一 response 一律拒绝
        let err = s
            .resolve(W1, &request_id, CloseDisposition::Cancelled)
            .unwrap_err();
        assert_eq!(err, INVALID_CLOSE_REQUEST);
    }

    #[test]
    fn r3_stale_request_rejected_after_cancel_and_retry_creates_new() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold {
            request_id: stale, ..
        } = s.on_close_requested(W1)
        else {
            panic!();
        };
        s.resolve(W1, &stale, CloseDisposition::Cancelled).unwrap(); // 用户取消
                                                                     // 再次点击关闭 → 新请求（旧 id 不复活）
        let CloseDecision::Hold {
            request_id: fresh,
            newly_created,
        } = s.on_close_requested(W1)
        else {
            panic!();
        };
        assert!(newly_created);
        assert_ne!(fresh, stale);
        let err = s.resolve(W1, &stale, CloseDisposition::Saved).unwrap_err();
        assert_eq!(err, INVALID_CLOSE_REQUEST, "过期请求不得再被接受");
    }

    #[test]
    fn resolve_cancelled_clears_pending_without_permit() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold { request_id, .. } = s.on_close_requested(W1) else {
            panic!();
        };
        assert_eq!(
            s.resolve(W1, &request_id, CloseDisposition::Cancelled)
                .unwrap(),
            ResolveOutcome::Cancelled
        );
        assert_eq!(s.pending_request(W1), None);
        // Cancel 后窗口仍在：再次 close 是全新请求
        assert!(matches!(
            s.on_close_requested(W1),
            CloseDecision::Hold {
                newly_created: true,
                ..
            }
        ));
    }

    #[test]
    fn resolve_discarded_grants_permit_and_close_consumes_it_once() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold { request_id, .. } = s.on_close_requested(W1) else {
            panic!();
        };
        assert_eq!(
            s.resolve(W1, &request_id, CloseDisposition::Discarded)
                .unwrap(),
            ResolveOutcome::PermitGranted {
                disposition: CloseDisposition::Discarded
            }
        );
        assert_eq!(s.pending_request(W1), None, "resolve 后 pending 已清");
        // 第二次 CloseRequested 消费 permit 放行
        assert_eq!(
            s.on_close_requested(W1),
            CloseDecision::Permit {
                disposition: CloseDisposition::Discarded
            }
        );
        // permit 单次消费：再 close 不会无条件放行
        assert!(matches!(
            s.on_close_requested(W1),
            CloseDecision::Hold {
                newly_created: true,
                ..
            }
        ));
    }

    #[test]
    fn r4_rollback_permit_restores_pending_and_close_can_retry() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold { request_id, .. } = s.on_close_requested(W1) else {
            panic!();
        };
        s.resolve(W1, &request_id, CloseDisposition::Saved).unwrap();
        // window.close() 失败 → 回滚
        assert!(s.rollback_permit(W1));
        // pending 恢复为同一请求：窗口仍可重试，无永久放行残余
        assert_eq!(s.pending_request(W1).as_deref(), Some(request_id.as_str()));
        assert_eq!(
            s.resolve(W1, &request_id, CloseDisposition::Saved).unwrap(),
            ResolveOutcome::PermitGranted {
                disposition: CloseDisposition::Saved
            }
        );
        assert_eq!(
            s.on_close_requested(W1),
            CloseDecision::Permit {
                disposition: CloseDisposition::Saved
            }
        );
        // 无 permit 时 rollback 返回 false（幂等）
        assert!(!s.rollback_permit(W1));
    }

    #[test]
    fn r5_destroyed_cleans_all_state_idempotently() {
        let s = CloseRequestStore::new();
        let CloseDecision::Hold { .. } = s.on_close_requested(W1) else {
            panic!();
        };
        let CloseDecision::Hold { request_id: b, .. } = s.on_close_requested(W2) else {
            panic!();
        };
        s.resolve(W2, &b, CloseDisposition::Clean).unwrap(); // W2 留有未消费 permit
        s.on_destroyed(W1);
        s.on_destroyed(W1); // 幂等
        assert_eq!(s.pending_request(W1), None);
        // W2 不受 W1 销毁影响：其 permit 完好（可放行第二次 close）
        assert_eq!(
            s.on_close_requested(W2),
            CloseDecision::Permit {
                disposition: CloseDisposition::Clean
            },
            "W2 不受 W1 销毁影响"
        );
        s.on_destroyed(W2); // 连同未消费 permit 一并清理（幂等）
        assert_eq!(s.pending_request(W2), None);
        // 清理后新 close 是全新请求
        assert!(matches!(
            s.on_close_requested(W1),
            CloseDecision::Hold {
                newly_created: true,
                ..
            }
        ));
    }

    #[test]
    fn x2_exit_blocked_until_every_window_permitted() {
        let s = CloseRequestStore::new();
        let ExitGate::Blocked { new_requests } =
            s.on_exit_requested(&[W1.to_string(), W2.to_string()])
        else {
            panic!("X2：存在未决窗口必须阻止退出");
        };
        assert_eq!(new_requests.len(), 2, "每个窗口建立自己的请求");
        let main_id = new_requests
            .iter()
            .find(|(l, _)| l == W1)
            .unwrap()
            .1
            .clone();
        let editor_id = new_requests
            .iter()
            .find(|(l, _)| l == W2)
            .unwrap()
            .1
            .clone();

        // main 同意保存；editor 取消 → 整次退出仍被阻止
        s.resolve(W1, &main_id, CloseDisposition::Saved).unwrap();
        s.resolve(W2, &editor_id, CloseDisposition::Cancelled)
            .unwrap();
        let ExitGate::Blocked {
            new_requests: retry,
        } = s.on_exit_requested(&[W1.to_string(), W2.to_string()])
        else {
            panic!("X2：任一窗口取消必须阻止整次退出");
        };
        // main 已有 permit（close 进行中）不重建；editor 新建
        assert_eq!(retry.len(), 1);
        assert_eq!(retry[0].0, W2);

        // editor 这次同意 → 全部许可 → 放行退出
        s.resolve(W2, &retry[0].1, CloseDisposition::Discarded)
            .unwrap();
        assert_eq!(
            s.on_exit_requested(&[W1.to_string(), W2.to_string()]),
            ExitGate::Allow
        );
    }

    #[test]
    fn x2_exit_reuses_existing_pending_without_re_emitting() {
        let s = CloseRequestStore::new();
        // 用户先点了窗口关闭按钮（pending 未决），随后触发应用退出
        let CloseDecision::Hold {
            request_id: pending_id,
            ..
        } = s.on_close_requested(W1)
        else {
            panic!();
        };
        let ExitGate::Blocked { new_requests } = s.on_exit_requested(&[W1.to_string()]) else {
            panic!();
        };
        assert!(
            new_requests.is_empty(),
            "已有 pending 的窗口复用请求，不重发事件（newly 请求列表为空）"
        );
        // 该 pending 仍可被应答（复用的是同一请求）
        assert_eq!(
            s.resolve(W1, &pending_id, CloseDisposition::Clean).unwrap(),
            ResolveOutcome::PermitGranted {
                disposition: CloseDisposition::Clean
            }
        );
        assert_eq!(s.on_exit_requested(&[W1.to_string()]), ExitGate::Allow);
    }

    #[test]
    fn x2_exit_allows_when_no_managed_windows() {
        let s = CloseRequestStore::new();
        assert_eq!(s.on_exit_requested(&[]), ExitGate::Allow);
    }
}
