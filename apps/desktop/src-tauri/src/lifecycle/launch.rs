//! LaunchIntentStore（MM-060 步骤⑨⑩）：LaunchIntent → queue → AppReady →
//! normalize/dedupe → WindowAction → ack 的 host 侧队列。
//!
//! - 不可信输入（argv / open-file / second-instance）在此 canonicalize；
//!   不存在的路径忽略（argv 噪音），无法 canonicalize 的忽略；
//! - dedupe 是队列级合并：同键 intent 未被 ack 前重复到达只保留一个
//!   （cold argv 与 open-file 事件对同一文件的重复投递）；
//!   ack 之后同路径到达视为新的用户动作（再次双击文件）；
//! - app_ready 返回未 ack 快照（不清队列，前端重连可幂等重取）；
//!   ack 后移除；激活（activation）无路径键，不参与去重。
//!
//! 平台差异：macOS 大小写不敏感卷的路径等价（/Users vs /users）未做
//! 大小写折叠，记入平台差异说明（PRD §1.1 Windows 移植时一并处理）。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

use crate::file::Clock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentKind {
    OpenFile,
    Activation,
}

impl IntentKind {
    fn as_str(&self) -> &'static str {
        match self {
            IntentKind::OpenFile => "open-file",
            IntentKind::Activation => "activation",
        }
    }
}

#[derive(Debug, Clone)]
pub struct LaunchIntent {
    pub intent_id: String,
    pub kind: IntentKind,
    pub canonical_path: Option<PathBuf>,
    pub received_at_ms: i64,
}

/// 发送给前端的 payload（字段 camelCase，与 TS LaunchIntentPayload 对齐）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchIntentPayload {
    pub intent_id: String,
    pub kind: &'static str,
    pub canonical_path: Option<String>,
    pub received_at: i64,
}

impl LaunchIntent {
    pub fn to_payload(&self) -> LaunchIntentPayload {
        LaunchIntentPayload {
            intent_id: self.intent_id.clone(),
            kind: self.kind.as_str(),
            canonical_path: self.canonical_path.as_ref().map(|p| p.display().to_string()),
            received_at: self.received_at_ms,
        }
    }

    fn dedupe_key(&self) -> Option<String> {
        self.canonical_path.as_ref().map(|p| format!("{}:{}", self.kind.as_str(), p.display()))
    }
}

pub struct LaunchIntentStore {
    queue: Mutex<Vec<LaunchIntent>>,
    counter: AtomicU64,
    clock: Box<dyn Clock>,
}

impl LaunchIntentStore {
    pub fn new(clock: Box<dyn Clock>) -> Self {
        Self { queue: Mutex::new(Vec::new()), counter: AtomicU64::new(0), clock }
    }

    /// open-file 输入：路径必须存在且可 canonicalize；队列级去重。
    /// 返回 None 表示被忽略（不存在/不可规范化/队列中已有等价未 ack intent）。
    pub fn ingest_open_file(&self, raw_path: &Path) -> Option<LaunchIntent> {
        if !raw_path.is_file() {
            return None; // argv 噪音（flag、目录、不存在路径）
        }
        let canon = std::fs::canonicalize(raw_path).ok()?;
        let intent = LaunchIntent {
            intent_id: self.next_id(),
            kind: IntentKind::OpenFile,
            canonical_path: Some(canon),
            received_at_ms: self.clock.now_ms(),
        };
        self.push_if_new(intent)
    }

    /// activation（Dock/任务栏点击且无文件）。
    pub fn ingest_activation(&self) -> Option<LaunchIntent> {
        let intent = LaunchIntent {
            intent_id: self.next_id(),
            kind: IntentKind::Activation,
            canonical_path: None,
            received_at_ms: self.clock.now_ms(),
        };
        self.push_if_new(intent)
    }

    /// AppReady：返回未 ack 快照；队列保留（前端断线重连可幂等重取）。
    pub fn snapshot_unacked(&self) -> Vec<LaunchIntentPayload> {
        self.queue.lock().unwrap().iter().map(|i| i.to_payload()).collect()
    }

    /// ack：移除未确认 intent；幂等（未知/已移除 id 均成功）。
    pub fn ack(&self, intent_id: &str) {
        self.queue.lock().unwrap().retain(|i| i.intent_id != intent_id);
    }

    pub fn unacked_len(&self) -> usize {
        self.queue.lock().unwrap().len()
    }

    fn push_if_new(&self, intent: LaunchIntent) -> Option<LaunchIntent> {
        let mut queue = self.queue.lock().unwrap();
        if let Some(key) = intent.dedupe_key() {
            let dup = queue.iter().any(|q| q.dedupe_key().as_deref() == Some(key.as_str()));
            if dup {
                return None; // 队列级合并：同键未 ack 已存在
            }
        }
        queue.push(intent.clone());
        Some(intent)
    }

    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("intent-{n}-{}", uuid::Uuid::new_v4().simple())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct FixedClock(i64);
    impl Clock for FixedClock {
        fn now_ms(&self) -> i64 {
            self.0
        }
    }

    fn store() -> LaunchIntentStore {
        LaunchIntentStore::new(Box::new(FixedClock(1000)))
    }

    fn tmpfile(name: &str) -> PathBuf {
        let dir = tempfile::tempdir().unwrap().keep();
        let p = dir.join(name);
        fs::write(&p, "{}").unwrap();
        p
    }

    #[test]
    fn cold_argv_file_ingested_and_snapshot_unacked() {
        let s = store();
        let f = tmpfile("a.json");
        let intent = s.ingest_open_file(&f).unwrap();
        assert_eq!(intent.kind, IntentKind::OpenFile);
        let snap = s.snapshot_unacked();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].kind, "open-file");
        assert_eq!(snap[0].canonical_path.as_deref(), Some(f.canonicalize().unwrap().to_str().unwrap()));
    }

    #[test]
    fn nonexistent_path_ignored() {
        let s = store();
        assert!(s.ingest_open_file(Path::new("/no/such/file.json")).is_none());
        assert_eq!(s.unacked_len(), 0);
    }

    #[test]
    fn equivalent_paths_dedupe_via_canonicalize() {
        let s = store();
        let f = tmpfile("b.json");
        let dir = f.parent().unwrap();
        // 同一文件经相对段/父引用表达 → canonicalize 后同键。
        let equiv = dir.join(format!("./{}/../b.json", dir.file_name().unwrap().to_string_lossy()));
        assert!(s.ingest_open_file(&f).is_some());
        assert!(s.ingest_open_file(&equiv).is_none(), "等价路径应合并");
        assert_eq!(s.unacked_len(), 1);
    }

    #[test]
    fn ack_is_idempotent_and_reopens_route_after_ack() {
        let s = store();
        let f = tmpfile("c.json");
        let i1 = s.ingest_open_file(&f).unwrap();
        s.ack(&i1.intent_id);
        s.ack(&i1.intent_id); // 幂等
        assert_eq!(s.unacked_len(), 0);
        // ack 后同路径再次到达 = 新的用户动作。
        assert!(s.ingest_open_file(&f).is_some());
        assert_eq!(s.unacked_len(), 1);
    }

    #[test]
    fn activation_not_deduped() {
        let s = store();
        assert!(s.ingest_activation().is_some());
        assert!(s.ingest_activation().is_some());
        assert_eq!(s.unacked_len(), 2);
    }

    #[test]
    fn consecutive_multiple_files_all_queued() {
        let s = store();
        let f1 = tmpfile("d1.json");
        let f2 = tmpfile("d2.json");
        assert!(s.ingest_open_file(&f1).is_some());
        assert!(s.ingest_open_file(&f2).is_some());
        assert_eq!(s.snapshot_unacked().len(), 2);
    }

    #[test]
    fn snapshot_keeps_queue_until_acked() {
        let s = store();
        let f = tmpfile("e.json");
        let i = s.ingest_open_file(&f).unwrap();
        assert_eq!(s.snapshot_unacked().len(), 1);
        assert_eq!(s.snapshot_unacked().len(), 1); // 重取不清队列
        s.ack(&i.intent_id);
        assert_eq!(s.snapshot_unacked().len(), 0);
    }
}
