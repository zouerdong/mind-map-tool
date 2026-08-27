//! 原子提交协议（MM-060 步骤⑥）：
//! temp-write → fsync(文件) → rename（替换目标）→ fsync(父目录)。
//! 任一步失败：清理临时文件、目标保持原样、返回 FILE_IO_ERROR。
//!
//! 平台差异（移植就绪约束，PRD §1.1）：
//! - macOS/Unix：std::fs::rename 即原子替换（POSIX rename(2)）；
//!   父目录以 File::open(dir).sync_all() 落盘。
//! - Windows：std::fs::rename 底层为 MoveFileExW(MOVEFILE_REPLACE_EXISTING)
//!   （任务卡认可的 MoveFileEx 路线）；文件 sync_all 即 FlushFileBuffers；
//!   目录级 flush Windows 无稳定等价（依赖 NTFS 元数据日志），
//!   Windows 专门版将评估 ReplaceFileW + 显式目录 flush，此处不静默假装已落盘。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use super::error::{ServiceError, ServiceResult};
use super::identity;

/// 临时文件名前缀（同目录隐藏文件；目录不变保证 rename 跨越同一文件系统）。
const TMP_PREFIX: &str = ".mindmap-commit-";

pub fn atomic_replace(target: &Path, bytes: &[u8]) -> ServiceResult<()> {
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| ServiceError::file_io("目标缺少父目录"))?;
    let tmp: PathBuf = dir.join(format!("{TMP_PREFIX}{}.tmp", identity::new_handle_id()));

    let result = write_tmp_and_replace(&tmp, target, bytes);
    if result.is_err() {
        // 失败清理：临时文件不残留；目标未被触碰。
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn write_tmp_and_replace(tmp: &Path, target: &Path, bytes: &[u8]) -> ServiceResult<()> {
    let mut f = File::create(tmp)
        .map_err(|e| ServiceError::file_io(format!("create temp {}: {e}", tmp.display())))?;
    f.write_all(bytes)
        .map_err(|e| ServiceError::file_io(format!("write temp {}: {e}", tmp.display())))?;
    f.sync_all()
        .map_err(|e| ServiceError::file_io(format!("fsync temp {}: {e}", tmp.display())))?;
    drop(f);

    fs::rename(tmp, target).map_err(|e| {
        ServiceError::file_io(format!("replace {} -> {}: {e}", tmp.display(), target.display()))
    })?;
    sync_dir_best_effort(target.parent().unwrap_or(Path::new(".")));
    Ok(())
}

/// macOS：目录 fsync 使 rename 持久；Windows：无稳定目录 flush 等价（见模块注释）。
fn sync_dir_best_effort(dir: &Path) {
    #[cfg(unix)]
    {
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        let d = tempfile::tempdir().unwrap();
        let p = d.keep();
        p
    }

    #[test]
    fn commit_writes_content_and_replaces_existing() {
        let dir = tmpdir();
        let target = dir.join("doc.json");
        atomic_replace(&target, b"v1").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"v1");
        atomic_replace(&target, b"v2").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"v2");
    }

    #[test]
    fn commit_failure_leaves_target_and_no_temp_files() {
        let dir = tmpdir();
        let target = dir.join("sub").join("doc.json"); // 父目录不存在 → temp create 失败
        let err = atomic_replace(&target, b"x").unwrap_err();
        assert_eq!(err.0.code, "FILE_IO_ERROR");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(TMP_PREFIX))
            .collect();
        assert!(leftovers.is_empty(), "不得残留临时文件");
    }

    #[test]
    fn commit_error_is_stable_io_code() {
        let dir = tmpdir();
        let target = dir.join("no-such-dir").join("a.json");
        assert_eq!(atomic_replace(&target, b"").unwrap_err().0.code, "FILE_IO_ERROR");
    }
}
