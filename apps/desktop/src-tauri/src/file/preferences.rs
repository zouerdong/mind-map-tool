//! 偏好存储（MM-060 步骤⑧）：host app config dir 下的独立 JSON 文件，
//! 绝不进入脑图文档（PRD/ADR 0003）。写入走原子替换（复用 commit 协议）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::commit;
use super::error::{ServiceError, ServiceResult};

/// 值域与 TS 侧 PreferenceValue 对齐（string/number/boolean/null）。
pub type PreferencesMap = BTreeMap<String, Value>;

pub struct PreferencesStore {
    path: PathBuf,
}

impl PreferencesStore {
    pub fn new(config_dir: &Path) -> Self {
        Self { path: config_dir.join("preferences.json") }
    }

    pub fn load(&self) -> ServiceResult<PreferencesMap> {
        match std::fs::read(&self.path) {
            Ok(bytes) => {
                let v: Value = serde_json::from_slice(&bytes).map_err(|e| {
                    ServiceError::preferences_io(format!("偏好文件损坏：{e}"))
                })?;
                let obj = v.as_object().ok_or_else(|| {
                    ServiceError::preferences_io("偏好文件顶层必须是对象")
                })?;
                Ok(obj.iter().filter(|(_, v)| is_scalar(v)).map(|(k, v)| (k.clone(), v.clone())).collect())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(PreferencesMap::new()),
            Err(e) => Err(ServiceError::preferences_io(format!("读取偏好失败：{e}"))),
        }
    }

    /// delta 合并：出现的键覆盖；null 值删除键。
    pub fn store(&self, delta: &PreferencesMap) -> ServiceResult<()> {
        let mut current = self.load()?;
        for (k, v) in delta {
            if v.is_null() {
                current.remove(k);
            } else if is_scalar(v) {
                current.insert(k.clone(), v.clone());
            } else {
                return Err(ServiceError::preferences_io(format!("偏好值必须是标量：{k}")));
            }
        }
        let bytes = serde_json::to_vec_pretty(&json!(current))
            .map_err(|e| ServiceError::preferences_io(format!("序列化偏好失败：{e}")))?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| ServiceError::preferences_io(format!("创建配置目录失败：{e}")))?;
        }
        commit::atomic_replace(&self.path, &bytes)
            .map_err(|e| ServiceError::preferences_io(format!("写入偏好失败：{}", e.0.message)))
    }
}

fn is_scalar(v: &Value) -> bool {
    v.is_string() || v.is_number() || v.is_boolean() || v.is_null()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    #[test]
    fn load_missing_returns_empty_and_store_merge_roundtrip() {
        let dir = tmpdir();
        let store = PreferencesStore::new(&dir);
        assert!(store.load().unwrap().is_empty());

        let mut delta = PreferencesMap::new();
        delta.insert("theme".into(), json!("dark"));
        delta.insert("onboardingDone".into(), json!(true));
        store.store(&delta).unwrap();

        let loaded = store.load().unwrap();
        assert_eq!(loaded.get("theme"), Some(&json!("dark")));
        assert_eq!(loaded.get("onboardingDone"), Some(&json!(true)));

        // 覆盖 + null 删除
        let mut d2 = PreferencesMap::new();
        d2.insert("theme".into(), json!("light"));
        d2.insert("onboardingDone".into(), json!(null));
        store.store(&d2).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.get("theme"), Some(&json!("light")));
        assert!(!loaded.contains_key("onboardingDone"));
    }

    #[test]
    fn non_scalar_value_rejected() {
        let dir = tmpdir();
        let store = PreferencesStore::new(&dir);
        let mut delta = PreferencesMap::new();
        delta.insert("bad".into(), json!([1, 2]));
        let err = store.store(&delta).unwrap_err();
        assert_eq!(err.0.code, "PREFERENCES_IO_ERROR");
    }

    #[test]
    fn corrupted_file_fails_closed() {
        let dir = tmpdir();
        std::fs::write(dir.join("preferences.json"), "not json").unwrap();
        let store = PreferencesStore::new(&dir);
        let err = store.load().unwrap_err();
        assert_eq!(err.0.code, "PREFERENCES_IO_ERROR");
    }
}
