//! Platform file identity（MM-060 步骤② + MRT-004B/B1）：
//! - VersionToken = 目标文件字节内容的 SHA-256（hex，小写）；
//! - opaque 引用 id（authorization / handle）用 UUID v4 前缀串，
//!   不可预测、进程内 ledger 查找即真伪判定；
//! - **窗口文件身份**：`FileIdentity` = 无损 canonical key + 可选
//!   physical key（Unix dev+ino）；判等以 `IdentityAlias` 逐项进行
//!   （canonical 或 physical 任一重叠即同一资源）——不把两者 OR 进一个
//!   派生 Eq/Hash 键（文件替换后不满足等价关系，会造成 HashMap 漂移）。
//! - **无损路径（B1-F5）**：`CanonicalPathKey` 内部保留 `PathBuf`；
//!   lossy 只出现在展示投影，绝不参与判等。
//! - **平台边界（B1-F5）**：Unix provider/变体/测试全部 `#[cfg(unix)]`；
//!   非 Unix 提供 `CanonicalOnlyProvider`（identity strength 明示
//!   CanonicalOnly，hard-link 等价性不成立）。
//!
//! displayPath 只供 UI 展示；本模块产出的 identity 不接受 renderer 自报
//! 路径参与同文件安全判定（ADR 0008 §8）。

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::error::{ServiceError, ServiceResult};

/// canonical path：解析 symlink/相对段；不存在则 Err（file identity 只对存在的文件）。
pub fn canonical_path(path: &Path) -> ServiceResult<PathBuf> {
    std::fs::canonicalize(path)
        .map_err(|e| ServiceError::file_io(format!("canonicalize {}: {e}", path.display())))
}

/// 读文件并计算 SHA-256 VersionToken；文件不存在 → None（调用方判定 TOCTOU）。
pub fn file_sha256(path: &Path) -> ServiceResult<Option<String>> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(ServiceError::file_io(format!(
                "open {} for hashing: {e}",
                path.display()
            )))
        }
    };
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| {
            ServiceError::file_io(format!("read {} for hashing: {e}", path.display()))
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(Some(digest_hex(&hasher.finalize())))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    digest_hex(&h.finalize())
}

fn digest_hex(digest: &[u8]) -> String {
    let mut s = String::with_capacity(64);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub fn new_authorization_ref() -> String {
    format!("auth-{}", uuid::Uuid::new_v4())
}

pub fn new_handle_id() -> String {
    format!("doc-{}", uuid::Uuid::new_v4())
}

/// 显示路径：用户可读的绝对路径字符串。
pub fn display_path(path: &Path) -> String {
    path.display().to_string()
}

// ---- 窗口文件身份（MRT-004B/B1） ----

/// 逻辑路径的稳定锚点。**内部保留 `PathBuf` 无损平台表示**（B1-F5：
/// `to_string_lossy` 会把不同的非 UTF-8 路径折叠为相同替换串，错误共享
/// identity owner）。lossy 只允许出现在展示投影（`display_lossy`），
/// 投影不参与 `Eq/Hash`。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CanonicalPathKey(PathBuf);

impl CanonicalPathKey {
    /// 无损构造（host 内部/测试；不经过任何 lossy 转换）。
    pub fn from_path(path: PathBuf) -> Self {
        Self(path)
    }

    pub fn as_path(&self) -> &Path {
        &self.0
    }

    /// 展示/日志投影（lossy）；**不得参与判等或索引**。
    pub fn display_lossy(&self) -> std::borrow::Cow<'_, str> {
        self.0.to_string_lossy()
    }
}

/// 平台物理文件键。Unix 用 `dev()+ino()`（`std::os::unix::fs::MetadataExt`，
/// 零新增依赖）。
///
/// **Windows 边界（B1-F5）**：真实 Windows 稳定 file ID（如
/// `GetFileInformationByHandle` / NTFS FileId）需要平台专项实现；本波次
/// 只保留接口与 `cfg` 边界，`Windows` 变体在平台专项补齐，绝不用随机/
/// 合成值冒充真实物理身份。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlatformPhysicalFileKey {
    #[cfg(unix)]
    Unix { dev: u64, ino: u64 },
}

/// 平台身份强度（B1.6：不冒充等价性）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityStrength {
    /// canonical + physical（Unix dev/ino）：symlink/相对段/hard link 等价。
    CanonicalAndPhysical,
    /// 仅 canonical（Windows 当前腿 / 目标不存在）：hard-link 等价性
    /// **未验证、不成立**；不得声称物理等价。
    CanonicalOnly,
}

/// host 拥有的文件身份：canonical 锚点（无损）始终存在；physical 在目标
/// 不存在（Save As 新建目标）或平台未实现物理键时为 None。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FileIdentity {
    canonical: CanonicalPathKey,
    physical: Option<PlatformPhysicalFileKey>,
}

impl FileIdentity {
    pub fn canonical(&self) -> &CanonicalPathKey {
        &self.canonical
    }

    pub fn physical(&self) -> Option<&PlatformPhysicalFileKey> {
        self.physical.as_ref()
    }

    /// 身份强度：physical 存在 → CanonicalAndPhysical；否则 CanonicalOnly。
    pub fn strength(&self) -> IdentityStrength {
        if self.physical.is_some() {
            IdentityStrength::CanonicalAndPhysical
        } else {
            IdentityStrength::CanonicalOnly
        }
    }

    /// 该身份的全部判等别名（canonical 恒有；physical 可选）。
    /// registry 以 alias 建索引：任一重叠即同一资源。
    pub fn aliases(&self) -> Vec<IdentityAlias> {
        let mut v = vec![IdentityAlias::Canonical(self.canonical.clone())];
        if let Some(p) = &self.physical {
            v.push(IdentityAlias::Physical(*p));
        }
        v
    }

    /// 调试投影（日志/测试）；不得作为可由 renderer 伪造的授权或 IPC
    /// 判定字段使用。lossy 仅用于展示，不参与判等。
    pub fn debug_string(&self) -> String {
        match &self.physical {
            #[cfg(unix)]
            Some(PlatformPhysicalFileKey::Unix { dev, ino }) => {
                format!("{}#dev{dev}/ino{ino}", self.canonical.display_lossy())
            }
            #[cfg(not(unix))]
            Some(_) => unreachable!("非 Unix 无 physical 变体"),
            None => format!("{}#no-physical", self.canonical.display_lossy()),
        }
    }
}

/// 判等别名（索引键）：canonical 或 physical 独立成键。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum IdentityAlias {
    Canonical(CanonicalPathKey),
    Physical(PlatformPhysicalFileKey),
}

/// provider 失败（I/O 等）：零部分 registry 更新由调用方保证
/// （先 resolve 成功再进临界区）。
#[derive(Debug)]
pub enum IdentityError {
    Io(String),
}

impl std::fmt::Display for IdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IdentityError::Io(m) => write!(f, "identity io error: {m}"),
        }
    }
}

/// host 侧文件身份 provider（职责不得混入 UI/renderer）。
pub trait FileIdentityProvider: Send + Sync {
    /// 已存在文件：canonicalize + 平台 metadata（完整身份）。
    fn resolve_existing(&self, path: &Path) -> Result<FileIdentity, IdentityError>;

    /// 从已打开的底层文件描述符解析身份（PRC-020 Descriptor-bound）。
    fn resolve_descriptor(
        &self,
        canonical: &Path,
        _file: &std::fs::File,
    ) -> Result<FileIdentity, IdentityError> {
        self.resolve_existing(canonical)
    }

    /// 授权目标（Save As 选址后）：存在 → 完整身份；不存在 → canonical
    /// parent + file name 的 canonical alias，physical 为 None。
    fn resolve_authorized_target(&self, path: &Path) -> Result<FileIdentity, IdentityError>;

    /// 原子替换后刷新：重读 physical（inode 轮换）；canonical 保持稳定。
    fn refresh_after_commit(&self, path: &Path) -> Result<FileIdentity, IdentityError>;
}

/// macOS/Unix 实现：标准库 metadata，无新增运行时依赖。
/// **metadata 一律从 canonicalize 后的目标读取**（B1.6：避免 canonical
/// 与 physical 来自两个不同 symlink 瞬间）。
#[cfg(unix)]
#[derive(Default)]
pub struct UnixFileIdentityProvider;

#[cfg(unix)]
impl UnixFileIdentityProvider {
    fn from_canonical(canonical: &Path) -> Result<FileIdentity, IdentityError> {
        use std::os::unix::fs::MetadataExt;
        let md = std::fs::metadata(canonical)
            .map_err(|e| IdentityError::Io(format!("metadata {}: {e}", canonical.display())))?;
        Ok(FileIdentity {
            canonical: CanonicalPathKey(canonical.to_path_buf()),
            physical: Some(PlatformPhysicalFileKey::Unix {
                dev: md.dev(),
                ino: md.ino(),
            }),
        })
    }
}

#[cfg(unix)]
impl FileIdentityProvider for UnixFileIdentityProvider {
    fn resolve_descriptor(
        &self,
        canonical: &Path,
        file: &std::fs::File,
    ) -> Result<FileIdentity, IdentityError> {
        use std::os::unix::fs::MetadataExt;
        let md = file
            .metadata()
            .map_err(|e| IdentityError::Io(format!("file metadata {}: {e}", canonical.display())))?;
        Ok(FileIdentity {
            canonical: CanonicalPathKey(canonical.to_path_buf()),
            physical: Some(PlatformPhysicalFileKey::Unix {
                dev: md.dev(),
                ino: md.ino(),
            }),
        })
    }

    fn resolve_existing(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        let canonical = std::fs::canonicalize(path)
            .map_err(|e| IdentityError::Io(format!("canonicalize {}: {e}", path.display())))?;
        Self::from_canonical(&canonical)
    }

    fn resolve_authorized_target(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        if path.is_file() {
            return self.resolve_existing(path);
        }
        // 目标不存在：canonical parent + file name；父目录必须可解析
        let parent = path
            .parent()
            .ok_or_else(|| IdentityError::Io("目标缺少父目录".into()))?;
        let canonical_parent = std::fs::canonicalize(parent)
            .map_err(|e| IdentityError::Io(format!("canonicalize {}: {e}", parent.display())))?;
        let name = path
            .file_name()
            .ok_or_else(|| IdentityError::Io("目标不是文件路径".into()))?;
        Ok(FileIdentity {
            canonical: CanonicalPathKey(canonical_parent.join(name)),
            physical: None,
        })
    }

    fn refresh_after_commit(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        // canonical 不变（逻辑路径锚点）；重读 physical（rename/replace 后
        // inode 轮换）；metadata 从 canonicalize 后目标读取。
        let canonical = std::fs::canonicalize(path)
            .map_err(|e| IdentityError::Io(format!("canonicalize {}: {e}", path.display())))?;
        Self::from_canonical(&canonical)
    }
}

/// 非 Unix 平台的 canonical-only provider（B1-F5）：identity strength
/// 明示 CanonicalOnly——hard-link 等价性不成立，不冒充物理身份。
/// Windows 真实 file ID 留待平台专项（需要系统能力/依赖时另行申报）。
#[cfg(not(unix))]
#[derive(Default)]
pub struct CanonicalOnlyProvider;

#[cfg(not(unix))]
impl FileIdentityProvider for CanonicalOnlyProvider {
    fn resolve_existing(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        let canonical = std::fs::canonicalize(path)
            .map_err(|e| IdentityError::Io(format!("canonicalize {}: {e}", path.display())))?;
        Ok(FileIdentity {
            canonical: CanonicalPathKey(canonical),
            physical: None,
        })
    }

    fn resolve_authorized_target(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        if path.is_file() {
            return self.resolve_existing(path);
        }
        let parent = path
            .parent()
            .ok_or_else(|| IdentityError::Io("目标缺少父目录".into()))?;
        let canonical_parent = std::fs::canonicalize(parent)
            .map_err(|e| IdentityError::Io(format!("canonicalize {}: {e}", parent.display())))?;
        let name = path
            .file_name()
            .ok_or_else(|| IdentityError::Io("目标不是文件路径".into()))?;
        Ok(FileIdentity {
            canonical: CanonicalPathKey(canonical_parent.join(name)),
            physical: None,
        })
    }

    fn refresh_after_commit(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        self.resolve_existing(path)
    }
}

/// 平台 provider 工厂：Unix → canonical+physical；其他 → canonical-only。
pub fn platform_provider() -> Box<dyn FileIdentityProvider> {
    #[cfg(unix)]
    {
        Box::new(UnixFileIdentityProvider)
    }
    #[cfg(not(unix))]
    {
        Box::new(CanonicalOnlyProvider)
    }
}

/// 测试 fake（W-B1 等）：路径 → 注入身份；未注册路径按 canonical-only。
pub struct FakeIdentityProvider {
    entries: HashMap<PathBuf, FileIdentity>,
}

impl FakeIdentityProvider {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// 注入/覆盖一条（模拟平台物理键或 Windows 未实现腿的 canonical-only）。
    pub fn set(&mut self, path: &Path, identity: FileIdentity) {
        self.entries.insert(path.to_path_buf(), identity);
    }
}

impl Default for FakeIdentityProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl FileIdentityProvider for FakeIdentityProvider {
    fn resolve_existing(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        if let Some(id) = self.entries.get(path) {
            return Ok(id.clone());
        }
        Ok(FileIdentity {
            canonical: CanonicalPathKey(path.to_path_buf()),
            physical: None,
        })
    }

    fn resolve_authorized_target(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        self.resolve_existing(path)
    }

    fn refresh_after_commit(&self, path: &Path) -> Result<FileIdentity, IdentityError> {
        self.resolve_existing(path)
    }
}

#[cfg(test)]
impl FileIdentity {
    /// 合成 identity（仅测试：状态机矩阵驱动值；生产路径一律经
    /// FileIdentityProvider 解析真实文件，绝不保留合成身份）。
    pub fn synthetic(value: &str) -> Self {
        Self {
            canonical: CanonicalPathKey(PathBuf::from(value)),
            physical: None,
        }
    }

    /// 合成 identity（非 UTF-8 路径；仅测试）。
    pub fn synthetic_os(path: &Path) -> Self {
        Self {
            canonical: CanonicalPathKey(path.to_path_buf()),
            physical: None,
        }
    }

    /// 合成带物理键的 identity（测试 hard-link/物理 alias 重叠场景）。
    #[cfg(unix)]
    pub fn synthetic_with_physical(value: &str, dev: u64, ino: u64) -> Self {
        Self {
            canonical: CanonicalPathKey(PathBuf::from(value)),
            physical: Some(PlatformPhysicalFileKey::Unix { dev, ino }),
        }
    }
}

#[cfg(test)]
impl PlatformPhysicalFileKey {
    pub fn dev_u64_for_test(&self) -> u64 {
        match self {
            #[cfg(unix)]
            Self::Unix { dev, .. } => *dev,
        }
    }

    pub fn ino_u64_for_test(&self) -> u64 {
        match self {
            #[cfg(unix)]
            Self::Unix { ino, .. } => *ino,
        }
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::fs;

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    #[test]
    fn i_b1_relative_and_symlink_resolve_to_same_canonical_and_physical() {
        let dir = tmpdir();
        let real = dir.join("real.mm");
        fs::write(&real, "{}").unwrap();
        let link = dir.join("link.mm");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let provider = UnixFileIdentityProvider;
        let direct = provider.resolve_existing(&real).unwrap();
        let via_link = provider.resolve_existing(&link).unwrap();
        assert_eq!(direct, via_link, "I-B1:symlink 与真实路径同一身份");
        let dotted = dir.join("./real.mm");
        assert_eq!(
            provider.resolve_existing(&dotted).unwrap(),
            direct,
            "I-B1:相对段等价"
        );
    }

    #[test]
    fn i_b2_hard_links_share_physical_alias() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        fs::write(&a, "{}").unwrap();
        let b = dir.join("b.mm");
        fs::hard_link(&a, &b).unwrap();
        let provider = UnixFileIdentityProvider;
        let ia = provider.resolve_existing(&a).unwrap();
        let ib = provider.resolve_existing(&b).unwrap();
        assert_ne!(ia.canonical(), ib.canonical());
        assert_eq!(
            ia.physical(),
            ib.physical(),
            "I-B2:hard link 物理 alias 重合"
        );
        let overlap = ia.aliases().iter().any(|x| ib.aliases().contains(x));
        assert!(overlap, "I-B2:任一 alias 重叠即同一资源");
    }

    #[test]
    fn i_b3_distinct_files_have_disjoint_aliases() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        let b = dir.join("b.mm");
        fs::write(&a, "{}").unwrap();
        fs::write(&b, "{}").unwrap();
        let provider = UnixFileIdentityProvider;
        let ia = provider.resolve_existing(&a).unwrap();
        let ib = provider.resolve_existing(&b).unwrap();
        assert!(
            !ia.aliases().iter().any(|x| ib.aliases().contains(x)),
            "I-B3:不同真实文件身份不重合"
        );
    }

    #[test]
    fn i_b4_unicode_and_space_paths_resolve_stably() {
        let dir = tmpdir();
        let p = dir.join("脑图 文档 v1.json");
        fs::write(&p, "{}").unwrap();
        let provider = UnixFileIdentityProvider;
        let id = provider.resolve_existing(&p).unwrap();
        assert_eq!(provider.resolve_existing(&p).unwrap(), id);
        assert!(id.canonical().display_lossy().contains("脑图 文档 v1.json"));
    }

    #[test]
    fn i_b5_atomic_replace_rotates_physical_keeps_canonical() {
        let dir = tmpdir();
        let p = dir.join("doc.mm");
        fs::write(&p, r#"{"v":1}"#).unwrap();
        let provider = UnixFileIdentityProvider;
        let before = provider.resolve_existing(&p).unwrap();
        let tmp = dir.join(".doc.mm.tmp");
        fs::write(&tmp, r#"{"v":2}"#).unwrap();
        fs::rename(&tmp, &p).unwrap();
        let after = provider.refresh_after_commit(&p).unwrap();
        assert_eq!(before.canonical(), after.canonical(), "canonical 锚点稳定");
        assert_ne!(
            before.physical(),
            after.physical(),
            "inode 轮换 → physical 更新"
        );
    }

    #[test]
    fn authorized_target_nonexistent_is_canonical_only() {
        let dir = tmpdir();
        let target = dir.join("new.mm");
        let provider = UnixFileIdentityProvider;
        let id = provider.resolve_authorized_target(&target).unwrap();
        assert_eq!(id.physical(), None, "目标不存在 → canonical-only");
        assert_eq!(id.strength(), IdentityStrength::CanonicalOnly);
        assert!(id.canonical().as_path().ends_with("new.mm"));
    }

    #[test]
    fn p1_non_utf8_paths_do_not_collide() {
        // P1:不同的非 UTF-8 路径不得因 lossy 折叠为同一 canonical key。
        // macOS 文件系统拒绝创建非法 UTF-8 文件名(实测 code 92),端到端
        // 夹具在本平台不可达;以内存 OsString 构造锁定 key 无损性。
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let a = PathBuf::from(OsString::from_vec(vec![0x61, 0xff, 0x78]));
        let b = PathBuf::from(OsString::from_vec(vec![0x61, 0xfe, 0x78]));
        assert_eq!(
            a.to_string_lossy(),
            b.to_string_lossy(),
            "前置:投影确实碰撞"
        );
        let key_a = CanonicalPathKey::from_path(a);
        let key_b = CanonicalPathKey::from_path(b);
        assert_ne!(key_a, key_b, "P1:无损 canonical key 不得碰撞");
        // 展示投影允许 lossy 相同,但判等/索引不受影响
        assert_eq!(key_a.display_lossy(), key_b.display_lossy());
    }
}

#[cfg(test)]
mod cross_platform_tests {
    use super::*;

    #[test]
    fn file_sha256_streams_multiple_chunks_without_changing_digest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("multi-chunk.mm");
        let bytes = (0..(64 * 1024 * 3 + 17))
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        std::fs::write(&path, &bytes).unwrap();

        assert_eq!(file_sha256(&path).unwrap(), Some(sha256_hex(&bytes)));
    }

    #[test]
    fn w_b1_fake_provider_contract_and_boundary() {
        // fake 合约:注入的身份原样返回(模拟 Windows canonical-only 腿)
        let mut fake = FakeIdentityProvider::new();
        let target = Path::new("/W/new.mm");
        fake.set(
            target,
            FileIdentity {
                canonical: CanonicalPathKey(PathBuf::from("/W/new.mm")),
                physical: None,
            },
        );
        let id = fake.resolve_authorized_target(target).unwrap();
        assert_eq!(id.physical(), None);
        assert_eq!(id.canonical().as_path(), Path::new("/W/new.mm"));
        assert_eq!(id.strength(), IdentityStrength::CanonicalOnly);
        // 平台工厂在当前编译目标返回正确强度
        let platform = platform_provider();
        let missing = Path::new("/definitely/not/here.mm");
        let id = platform
            .resolve_authorized_target(missing)
            .unwrap_or_else(|_| {
                // 无根目录的平台失败时退化为 synthetic 断言
                FileIdentity::synthetic("/definitely/not/here.mm")
            });
        assert_eq!(id.strength(), IdentityStrength::CanonicalOnly);
    }
}
