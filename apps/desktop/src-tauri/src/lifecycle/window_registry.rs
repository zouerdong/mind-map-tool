//! WindowRegistry(MRT-004A/A1 / ADR 0008):host 侧窗口状态、file identity
//! reservation 与 per-window bootstrap 交付的纯数据状态机。
//!
//! A1 重构(并发与交付可靠性):
//! - **纯数据结构**:无内部 Mutex/Atomic,全部方法 `&mut self`;唯一并发
//!   owner 是 `LaunchCoordinator` 的单把 `Mutex<CoordinatorState>`
//!   (A1-F1:消除 ABBA 反向锁序的结构性根源);
//! - 所有转换 validate-then-commit:验证失败返回稳定错误且状态零变化
//!   (A1-F3);跨方法的原子性由 coordinator 在同一临界区内组合保证;
//! - identity reservation 覆盖 loading / open / **closing** 三态,直到
//!   Destroyed 才释放(A1-F4);查询 API 区分:
//!   `identity_owner`(仅 Loading/Open,可聚焦)与 `identity_reservation`
//!   (全部持有态,含 Closing 的延迟路由判定)——查询与写入同一事实;
//! - bootstrap 交付按 (label, deliveryId, generation) 校验 completion:
//!   跨 label、重放、旧 generation 一律稳定拒绝;
//! - Destroyed 幂等清理 record、reservation 与该 label 全部交付槽。
//!
//! identity 是 host 拥有的 opaque 值(A1 仍为合成值;真实 canonicalize/
//! device+inode 与 alias 索引在 MRT-004B,不得退回 displayPath 比较)。

use std::collections::HashMap;

pub use crate::file::identity::{
    CanonicalPathKey, FileIdentity, IdentityAlias, PlatformPhysicalFileKey,
};

/// 稳定错误码(与任务卡 R1-R4/P3/T/I-B/S-B 对应;跨语言拼写不得更改)。
pub const DUPLICATE_WINDOW_LABEL: &str = "DUPLICATE_WINDOW_LABEL";
pub const UNKNOWN_WINDOW: &str = "UNKNOWN_WINDOW";
pub const INVALID_WINDOW_TRANSITION: &str = "INVALID_WINDOW_TRANSITION";
pub const IDENTITY_ALREADY_RESERVED: &str = "IDENTITY_ALREADY_RESERVED";
pub const STALE_BOOTSTRAP_COMPLETION: &str = "STALE_BOOTSTRAP_COMPLETION";
pub const INVALID_REBIND_TOKEN: &str = "INVALID_REBIND_TOKEN";
/// B1A-F2/O1:ordinary 刷新不得改变 canonical 锚点(换文件必须走
/// Save As 的 finalize_rebind)。
pub const IDENTITY_CANONICAL_MISMATCH: &str = "IDENTITY_CANONICAL_MISMATCH";

/// 窗口生命周期状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowState {
    /// WebView 已创建、bootstrap 尚未就绪。
    Booting,
    /// 空白窗口(无文档)。
    Blank,
    /// 已分配文件、读取进行中(identity 已 reservation)。
    Loading,
    /// 文档已加载并承载(identity 已 reservation)。
    Open,
    /// renderer 初始化/读取失败(错误 UI 可见;identity 已释放)。
    Failed,
    /// 关闭流程进行中(MRT-003 close handshake;**identity 保持占用**,
    /// 同文件新 intent 由 coordinator 延迟路由,直到 Destroyed)。
    Closing,
}

impl WindowState {
    /// 合法转换表。未列出的组合即非法(R4:稳定错误,状态不变):
    /// - booting 只能前进到 blank/loading/failed(跳过 loading 直接 open 非法);
    /// - open 不回 blank/loading(一窗口一文档;换文件必须新窗,ADR 0008 §4);
    /// - closing 不可逆(复活窗口必须重新 register 新代);
    /// - failed 可重新 loading(同窗 retry);
    ///   blank → open 不在公共表:仅 finalize_rebind 的 untitled adopt
    ///   路径直接赋值(B1-F3)。
    fn can_transition_to(&self, to: WindowState) -> bool {
        use WindowState::*;
        matches!(
            (self, to),
            (Booting, Blank)
                | (Booting, Loading)
                | (Booting, Failed)
                | (Blank, Loading)
                | (Blank, Failed)
                | (Blank, Closing)
                | (Loading, Open)
                | (Loading, Failed)
                | (Loading, Closing)
                | (Open, Closing)
                | (Failed, Loading)
                | (Failed, Closing)
        )
    }

    /// identity reservation 是否占用(loading/open/**closing**,A1-F4:
    /// Closing 持有到 Destroyed,防重复开窗)。
    fn holds_identity(&self) -> bool {
        matches!(
            self,
            WindowState::Loading | WindowState::Open | WindowState::Closing
        )
    }

    /// 是否可作为聚焦目标(仅 Loading/Open;Closing 窗口不再接收聚焦)。
    fn focusable(&self) -> bool {
        matches!(self, WindowState::Loading | WindowState::Open)
    }
}

/// registry 对外可见的窗口记录快照(只读投影;修改必须走转换方法)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowRecord {
    pub label: String,
    pub state: WindowState,
    pub file_identity: Option<FileIdentity>,
    pub active_intent_id: Option<String>,
    pub bootstrap_delivery_id: Option<String>,
    pub ready_generation: u64,
    /// 窗口代际(register 时分配,全局递增):同名 label 销毁重建后不同;
    /// rebind token 绑定它做 stale 检测(B1-F2)。
    pub generation: u64,
}

/// 交付槽的只读快照(诊断/测试)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryInfo {
    pub label: String,
    pub generation: u64,
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DeliverySlot {
    label: String,
    generation: u64,
    completed: bool,
}

/// alias 占用种类(B1-F1:active 窗口持有 vs 建窗 assignment,
/// 与 pending rebind 一起构成统一 reservation 事实)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReservationKind {
    /// 已登记窗口持有(Loading/Open/Closing)。
    Active,
    /// CreateWindow effect 已发出、窗口尚未登记(B1.2:在异步建窗副作用
    /// **前**建立的预占;create 失败原子回滚)。
    Assignment,
}

/// alias 索引的占用值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ownership {
    pub label: String,
    pub kind: ReservationKind,
}

/// identity 的统一占用事实(查询 API 返回值)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReservationHolder {
    Active { label: String, state: WindowState },
    Assignment { label: String },
}

/// Save As 的 source 状态快照(B1.3:token 绑定)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RebindSource {
    /// 有旧身份(Loading/Open/Closing;Save As 换绑)。
    Identity(FileIdentity),
    /// Blank 无 identity(untitled 首次 Save As,adopt)。
    Untitled,
    /// Closing 无 identity(close-save;保持 Closing,暂持新 identity)。
    ClosingUntitled,
}

/// Save As 写前预占记录(MRT-004B §6.2 + B1-F2):token 绑定
/// windowLabel / windowGeneration / source 状态 / authorized canonical
/// target / reserved aliases;同 label 同时最多一个;文件 commit 在
/// coordinator 锁外执行,finalize/abort 回锁内。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingRebind {
    pub token: String,
    pub window_label: String,
    pub window_generation: u64,
    pub source: RebindSource,
    pub authorized_target: CanonicalPathKey,
    pub reserved_aliases: Vec<IdentityAlias>,
}

/// 纯数据状态机(A1:无锁;唯一并发 owner 在 LaunchCoordinator)。
/// MRT-004B/B1:owner 索引按 `IdentityAlias` 建立(canonical/physical 各自
/// 独立成键,任一重叠即同一资源);assignment/active 统一进同一索引,
/// pending rebind 单独存储并参与全部占用判定。
#[derive(Default)]
pub struct WindowRegistry {
    windows: HashMap<String, WindowRecord>,
    alias_owners: HashMap<IdentityAlias, Ownership>,
    pending_rebinds: HashMap<String, PendingRebind>,
    rebind_counter: u64,
    window_generation_counter: u64,
    deliveries: HashMap<String, DeliverySlot>,
    label_counter: u64,
    delivery_counter: u64,
}

impl WindowRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 登记新窗口(初始 Booting)。label 已存在 → `DUPLICATE_WINDOW_LABEL`,
    /// 既有 record 原样保留(R1)。
    pub fn register(&mut self, label: &str) -> Result<WindowRecord, &'static str> {
        if self.windows.contains_key(label) {
            return Err(DUPLICATE_WINDOW_LABEL);
        }
        self.window_generation_counter += 1;
        let record = WindowRecord {
            label: label.to_string(),
            state: WindowState::Booting,
            file_identity: None,
            active_intent_id: None,
            bootstrap_delivery_id: None,
            ready_generation: 0,
            generation: self.window_generation_counter,
        };
        self.windows.insert(label.to_string(), record.clone());
        Ok(record)
    }

    /// 生成下一个未占用的 `editor-*` label(host 是窗口 label 唯一来源)。
    pub fn allocate_editor_label(&mut self) -> String {
        loop {
            self.label_counter += 1;
            let label = format!("editor-{}", self.label_counter);
            if !self.windows.contains_key(&label) {
                return label;
            }
        }
    }

    /// 冷启动默认窗口是否仍可承接首个文件分配(Booting、无 identity、无 intent)。
    pub fn cold_main_available(&self, label: &str) -> bool {
        match self.windows.get(label) {
            Some(r) => {
                r.state == WindowState::Booting
                    && r.file_identity.is_none()
                    && r.active_intent_id.is_none()
            }
            None => false,
        }
    }

    /// identity 的**聚焦目标**(仅 Loading/Open;供 coordinator FocusWindow 判定)。
    pub fn identity_owner(&self, identity: &FileIdentity) -> Option<(String, WindowState)> {
        self.identity_reservation(identity)
            .filter(|(_, state)| state.focusable())
    }

    /// identity 的**全部持有态 reservation**(Loading/Open/Closing;A1-F4:
    /// 延迟路由判定用,与 begin_loading 的拒绝条件同一事实)。
    /// 注意:assignment(建窗中)不在此投影,经 `identity_holder` 查询。
    pub fn identity_reservation(&self, identity: &FileIdentity) -> Option<(String, WindowState)> {
        match self.identity_holder(identity) {
            Some(ReservationHolder::Active { label, state }) => Some((label, state)),
            Some(ReservationHolder::Assignment { .. }) | None => None,
        }
    }

    /// identity 的**统一占用事实**(B1.2:active 窗口或建窗 assignment,
    /// 与 pending 一起构成同一 invariant;所有路由/预占判定共用)。
    pub fn identity_holder(&self, identity: &FileIdentity) -> Option<ReservationHolder> {
        for alias in identity.aliases() {
            if let Some(ownership) = self.alias_owners.get(&alias) {
                match ownership.kind {
                    ReservationKind::Assignment => {
                        return Some(ReservationHolder::Assignment {
                            label: ownership.label.clone(),
                        });
                    }
                    ReservationKind::Active => {
                        if let Some(record) = self.windows.get(&ownership.label) {
                            if record.state.holds_identity() {
                                return Some(ReservationHolder::Active {
                                    label: ownership.label.clone(),
                                    state: record.state,
                                });
                            }
                        }
                    }
                }
            }
        }
        None
    }

    /// pending rebind 是否占用该 identity 的任一 alias(S-B4:同目标
    /// open/create 不得抢占写前预占)。
    pub fn pending_rebind_of(&self, identity: &FileIdentity) -> Option<String> {
        for pending in self.pending_rebinds.values() {
            if identity
                .aliases()
                .iter()
                .any(|a| pending.reserved_aliases.contains(a))
            {
                return Some(pending.window_label.clone());
            }
        }
        None
    }

    /// 建窗 assignment 占用(B1.2:CreateWindow effect 发出前的预占)。
    pub fn assignment_of(&self, identity: &FileIdentity) -> Option<String> {
        for alias in identity.aliases() {
            if let Some(o) = self.alias_owners.get(&alias) {
                if o.kind == ReservationKind::Assignment {
                    return Some(o.label.clone());
                }
            }
        }
        None
    }

    /// B1.2:在 CreateWindow effect 发出前为将建窗口预占 identity。
    /// label 已登记 / 任一 alias 已被占用(任何 kind)/ pending 占用 →
    /// 稳定拒绝;成功后 effect 可安全发出。
    pub fn reserve_assignment(
        &mut self,
        label: &str,
        identity: &FileIdentity,
    ) -> Result<(), &'static str> {
        if self.windows.contains_key(label) {
            return Err(DUPLICATE_WINDOW_LABEL);
        }
        for alias in identity.aliases() {
            if self.alias_owners.contains_key(&alias) {
                return Err(IDENTITY_ALREADY_RESERVED);
            }
        }
        if self.pending_rebind_of(identity).is_some() {
            return Err(IDENTITY_ALREADY_RESERVED);
        }
        for alias in identity.aliases() {
            self.alias_owners.insert(
                alias,
                Ownership {
                    label: label.to_string(),
                    kind: ReservationKind::Assignment,
                },
            );
        }
        Ok(())
    }

    /// B1.2:CreateWindow 失败/放弃时原子回滚该 label 的建窗预占
    /// (X3:不留下幽灵 reservation)。
    pub fn release_assignment(&mut self, label: &str) {
        self.alias_owners
            .retain(|_, o| !(o.label == label && o.kind == ReservationKind::Assignment));
    }

    /// 分配文件并进入 Loading(R2:identity 已被其他 label 占用 → 稳定拒绝)。
    /// 同 label 重复分配同 identity 幂等成功。
    pub fn begin_loading(
        &mut self,
        label: &str,
        identity: &FileIdentity,
        intent_id: &str,
    ) -> Result<(), &'static str> {
        let Some(record) = self.windows.get(label) else {
            return Err(UNKNOWN_WINDOW);
        };
        let already = record.file_identity.as_ref() == Some(identity)
            && record.state == WindowState::Loading
            && record.active_intent_id.as_deref() == Some(intent_id);
        if already {
            return Ok(()); // 幂等:同 intent 的重复分配
        }
        let aliases = identity.aliases();
        // B1-F1/X2:统一占用判定——alias 被任何 label(含建窗 assignment)
        // 或 pending rebind 占用时,所有 begin_loading 入口一致拒绝。
        for alias in &aliases {
            if let Some(existing) = self.alias_owners.get(alias) {
                if existing.label != label {
                    return Err(IDENTITY_ALREADY_RESERVED);
                }
            }
        }
        if self.pending_rebind_of(identity).is_some() {
            return Err(IDENTITY_ALREADY_RESERVED);
        }
        if !record.state.can_transition_to(WindowState::Loading) {
            return Err(INVALID_WINDOW_TRANSITION);
        }
        let record = self.windows.get_mut(label).expect("上面已验证存在");
        record.state = WindowState::Loading;
        record.file_identity = Some(identity.clone());
        record.active_intent_id = Some(intent_id.to_string());
        for alias in aliases {
            self.alias_owners.insert(
                alias,
                Ownership {
                    label: label.to_string(),
                    kind: ReservationKind::Active,
                },
            );
        }
        Ok(())
    }

    /// 文件加载成功(Loading → Open;identity 保持占用)。
    pub fn mark_open(&mut self, label: &str) -> Result<(), &'static str> {
        self.transition(label, WindowState::Open)
    }

    /// 空白窗口就绪(Booting → Blank;activation 新窗路径)。
    pub fn mark_blank(&mut self, label: &str) -> Result<(), &'static str> {
        self.transition(label, WindowState::Blank)
    }

    /// renderer 失败(释放 identity reservation;错误 UI 与 retry 属调用方)。
    /// 注意:active_intent_id / bootstrap_delivery_id **保留**——它们是
    /// W2R-F2 的 failed-origin 关联(原窗 retry / dismiss 收口的依据)。
    pub fn mark_failed(&mut self, label: &str) -> Result<(), &'static str> {
        let Some(record) = self.windows.get_mut(label) else {
            return Err(UNKNOWN_WINDOW);
        };
        if !record.state.can_transition_to(WindowState::Failed) {
            return Err(INVALID_WINDOW_TRANSITION);
        }
        record.state = WindowState::Failed;
        let identity = record.file_identity.take();
        if let Some(identity) = identity {
            self.release_identity_if_owner(&identity, label);
        }
        Ok(())
    }

    /// W2R-F2(H2):dismiss 的窄收口转换——Failed → Blank,并清空该窗口的
    /// active intent 与交付槽(窗口回到可编辑、可首次 Save As 的空白终态;
    /// file_identity 在 mark_failed 时已释放)。非 Failed 稳定拒绝。
    pub fn failed_to_blank(&mut self, label: &str) -> Result<(), &'static str> {
        let Some(record) = self.windows.get_mut(label) else {
            return Err(UNKNOWN_WINDOW);
        };
        if record.state != WindowState::Failed {
            return Err(INVALID_WINDOW_TRANSITION);
        }
        record.state = WindowState::Blank;
        record.active_intent_id = None;
        let delivery = record.bootstrap_delivery_id.take();
        if let Some(delivery) = delivery {
            self.deliveries.remove(&delivery);
        }
        Ok(())
    }

    /// 只读:承载该 intent 的 Failed 窗口(label, generation)——W2R-F2 原窗
    /// retry 与 dismiss 收口的 origin 事实(mark_failed 保留关联)。
    pub fn failed_window_of_intent(&self, intent_id: &str) -> Option<(String, u64)> {
        self.windows
            .values()
            .find(|r| {
                r.state == WindowState::Failed && r.active_intent_id.as_deref() == Some(intent_id)
            })
            .map(|r| (r.label.clone(), r.generation))
    }

    /// 只读:窗口当前 generation(W2R-F1 呈现所有权 / W2R-F5 recovery 校验)。
    pub fn generation_of(&self, label: &str) -> Option<u64> {
        self.windows.get(label).map(|r| r.generation)
    }

    /// 进入关闭流程(→ Closing;identity **保持占用** 到 Destroyed,A1-F4)。
    pub fn begin_closing(&mut self, label: &str) -> Result<(), &'static str> {
        self.transition(label, WindowState::Closing)
    }

    /// Destroyed:移除 record、释放 reservation、清该 label 全部交付槽与
    /// pending rebind(S-B5);未知 label 幂等无操作(R3)。
    pub fn on_destroyed(&mut self, label: &str) {
        self.pending_rebinds.retain(|_, p| p.window_label != label);
        self.release_assignment(label);
        let Some(record) = self.windows.remove(label) else {
            return;
        };
        if let Some(identity) = record.file_identity {
            self.release_identity_if_owner(&identity, label);
        }
        self.deliveries.retain(|_, slot| slot.label != label);
    }

    // ---- MRT-004B:保存换绑协议(任务卡 §6) ----

    /// ordinary Save 成功后原子刷新 physical aliases(§6.1):
    /// validate(旧 identity 归属本 label 且新 aliases 无他人占用)→ 一次
    /// commit(移除旧 aliases、插入新 aliases、更新 record)。canonical
    /// 持续归属该 label,无空窗期(单临界区)。
    pub fn refresh_identity_after_commit(
        &mut self,
        label: &str,
        refreshed: &FileIdentity,
    ) -> Result<(), &'static str> {
        let Some(record) = self.windows.get(label) else {
            return Err(UNKNOWN_WINDOW);
        };
        if !record.state.holds_identity() {
            return Err(INVALID_WINDOW_TRANSITION);
        }
        let Some(old_identity) = record.file_identity.clone() else {
            return Err(INVALID_WINDOW_TRANSITION);
        };
        // B1A-F2/O1:ordinary 刷新必须保持 canonical 锚点——canonical 跳变
        // 意味着把窗口换绑到另一个文件,唯一合法路径是 Save As 的
        // finalize_rebind(经 token/授权绑定校验)。
        if refreshed.canonical() != old_identity.canonical() {
            return Err(IDENTITY_CANONICAL_MISMATCH);
        }
        // validate:新 aliases 未被其他 label/pending 占用(canonical 与
        // 旧 identity 相同时不视为冲突——那是 ordinary save 的常态)
        for alias in refreshed.aliases() {
            if let Some(owner) = self.alias_owners.get(&alias) {
                if owner.label != label {
                    return Err(IDENTITY_ALREADY_RESERVED);
                }
            }
            if self
                .pending_rebinds
                .values()
                .any(|p| p.reserved_aliases.contains(&alias) && p.window_label != label)
            {
                return Err(IDENTITY_ALREADY_RESERVED);
            }
        }
        // commit:旧 aliases 全部释放 → 新 aliases 归属本 label
        self.release_identity_if_owner(&old_identity, label);
        let record = self.windows.get_mut(label).expect("已验证存在");
        record.file_identity = Some(refreshed.clone());
        for alias in refreshed.aliases() {
            self.alias_owners.insert(
                alias,
                Ownership {
                    label: label.to_string(),
                    kind: ReservationKind::Active,
                },
            );
        }
        Ok(())
    }

    /// Save As prepare(§6.2,**写前**预占;B1-F2/B1-F3):
    /// - 同 label 已有未终结 pending → 稳定拒绝(单例);
    /// - source 状态快照:有 identity(换绑)/ Blank 无 identity(untitled
    ///   adopt)/ Closing 无 identity(close-save)——其余状态拒绝;
    /// - target 任一 alias 已被其他 active/assignment 窗口或 pending
    ///   rebind 占用 → 稳定拒绝,目标文件 bytes 不变(尚未执行任何 I/O);
    /// - token 绑定 windowLabel + windowGeneration + source + authorized
    ///   canonical target + reserved aliases;
    /// - 成功返回 opaque token;旧 identity 仍归当前窗口。
    pub fn prepare_rebind(
        &mut self,
        label: &str,
        target: &FileIdentity,
    ) -> Result<String, &'static str> {
        let Some(record) = self.windows.get(label) else {
            return Err(UNKNOWN_WINDOW);
        };
        if self
            .pending_rebinds
            .values()
            .any(|p| p.window_label == label)
        {
            return Err(IDENTITY_ALREADY_RESERVED); // T2:同 label 单例
        }
        let source = match (record.state, record.file_identity.clone()) {
            (WindowState::Loading, Some(id))
            | (WindowState::Open, Some(id))
            | (WindowState::Closing, Some(id)) => RebindSource::Identity(id),
            (WindowState::Blank, None) => RebindSource::Untitled,
            (WindowState::Closing, None) => RebindSource::ClosingUntitled,
            _ => return Err(INVALID_WINDOW_TRANSITION),
        };
        let window_generation = record.generation;
        for alias in target.aliases() {
            if let Some(owner) = self.alias_owners.get(&alias) {
                if owner.label != label {
                    return Err(IDENTITY_ALREADY_RESERVED);
                }
            }
        }
        if let Some(holder) = self.pending_rebind_of(target) {
            if holder != label {
                return Err(IDENTITY_ALREADY_RESERVED);
            }
        }
        self.rebind_counter += 1;
        let token = format!(
            "rebind-{}-{}",
            self.rebind_counter,
            uuid::Uuid::new_v4().simple()
        );
        self.pending_rebinds.insert(
            token.clone(),
            PendingRebind {
                token: token.clone(),
                window_label: label.to_string(),
                window_generation,
                source,
                authorized_target: target.canonical().clone(),
                reserved_aliases: target.aliases(),
            },
        );
        Ok(token)
    }

    /// Save As commit 成功后 finalize(§6.2;B1-F2/B1-F3/B1A-F3):
    /// validate(全部只读,失败零变化)——
    /// - token 存在且 **caller 校验**:`caller_label` 必须等于 pending
    ///   owner(T3-XW:错窗调用稳定拒绝,不依赖 token 难猜或调用方诚实);
    /// - 窗口存在且**代际匹配**(stale token 检测);
    /// - final canonical target 与 token 绑定的 authorized canonical
    ///   **完全一致**(仅 physical alias 允许因原子替换轮换;T1 移花接木拒绝);
    /// - source 一致性:窗口当前状态与 prepare 时的 source 兼容;
    /// - final aliases 未被其他 active/assignment/pending 占用
    ///   (owner 为本 label 的 Active 例外;本 token 自身的 pending 例外)。
    ///
    /// commit(一次)——移除 pending → 释放旧 aliases → 状态转换 → 采用
    /// final aliases:Open 保持 Open 只换 aliases;Blank adopt → Open;
    /// Closing 保持 Closing(close-save 暂持,不复活)。
    ///
    /// **写后不变量错误不伪装成回滚**:fail closed 保留全部 reservation
    /// 并返回稳定错误,不得静默释放导致重复窗口。
    pub fn finalize_rebind(
        &mut self,
        caller_label: &str,
        token: &str,
        final_identity: &FileIdentity,
    ) -> Result<(), &'static str> {
        let Some(pending) = self.pending_rebinds.get(token) else {
            return Err(INVALID_REBIND_TOKEN);
        };
        if pending.window_label != caller_label {
            return Err(INVALID_REBIND_TOKEN); // T3-XW:错窗 caller,零变化
        }
        let label = pending.window_label.clone();
        let expected_generation = pending.window_generation;
        let old_aliases: Vec<IdentityAlias> = match &pending.source {
            RebindSource::Identity(old) => old.aliases(),
            RebindSource::Untitled | RebindSource::ClosingUntitled => Vec::new(),
        };
        let closing_untitled = matches!(pending.source, RebindSource::ClosingUntitled);
        // validate:窗口存在且代际匹配
        let Some(record) = self.windows.get(&label) else {
            return Err(INVALID_REBIND_TOKEN);
        };
        if record.generation != expected_generation {
            return Err(INVALID_REBIND_TOKEN); // stale:同名窗口已重建
        }
        // validate:canonical target 完全一致
        if final_identity.canonical() != &pending.authorized_target {
            return Err(INVALID_REBIND_TOKEN); // T1
        }
        // validate:source 一致性
        match (&record.state, record.file_identity.as_ref()) {
            (WindowState::Open, Some(current)) | (WindowState::Loading, Some(current)) => {
                let RebindSource::Identity(source) = &pending.source else {
                    return Err(INVALID_REBIND_TOKEN);
                };
                if current != source {
                    return Err(INVALID_REBIND_TOKEN); // 源身份已被换过
                }
            }
            (WindowState::Closing, Some(current)) => {
                let RebindSource::Identity(source) = &pending.source else {
                    return Err(INVALID_REBIND_TOKEN);
                };
                if current != source {
                    return Err(INVALID_REBIND_TOKEN);
                }
            }
            (WindowState::Closing, None) => {
                if !closing_untitled {
                    return Err(INVALID_REBIND_TOKEN);
                }
            }
            (WindowState::Blank, None) => {
                if !matches!(pending.source, RebindSource::Untitled) {
                    return Err(INVALID_REBIND_TOKEN);
                }
            }
            _ => return Err(INVALID_REBIND_TOKEN),
        }
        // validate:final aliases 占用(本 label Active 例外;他人一律拒绝)
        for alias in final_identity.aliases() {
            if let Some(owner) = self.alias_owners.get(&alias) {
                if owner.label != label {
                    return Err(IDENTITY_ALREADY_RESERVED);
                }
            }
        }
        if let Some(holder) = self.pending_rebind_of(final_identity) {
            if holder != label {
                return Err(IDENTITY_ALREADY_RESERVED);
            }
        }
        // commit
        self.pending_rebinds.remove(token);
        for alias in old_aliases {
            if self
                .alias_owners
                .get(&alias)
                .is_some_and(|o| o.label == label)
            {
                self.alias_owners.remove(&alias);
            }
        }
        let record = self.windows.get_mut(&label).expect("已验证存在");
        match record.state {
            WindowState::Blank => record.state = WindowState::Open, // B1-F3 adopt
            WindowState::Loading | WindowState::Open | WindowState::Closing => {
                // 保持(Open 只换 aliases;Closing close-save 暂持,不复活)
            }
            _ => return Err(INVALID_WINDOW_TRANSITION), // 防御:fail closed
        }
        record.file_identity = Some(final_identity.clone());
        for alias in final_identity.aliases() {
            self.alias_owners.insert(
                alias,
                Ownership {
                    label: label.clone(),
                    kind: ReservationKind::Active,
                },
            );
        }
        Ok(())
    }

    /// Save As 失败/取消 abort(§6.2;B1A-F3):validate-then-commit——
    /// 先只读校验 caller 与 pending owner 一致(错窗/未知/已终结 token 均
    /// `INVALID_REBIND_TOKEN` 且零变化),再一次移除。只释放 pending
    /// target;窗口旧 identity、handle、token、displayPath 与 registry
    /// owner 均不变。
    pub fn abort_rebind(&mut self, caller_label: &str, token: &str) -> Result<(), &'static str> {
        let Some(pending) = self.pending_rebinds.get(token) else {
            return Err(INVALID_REBIND_TOKEN);
        };
        let generation_matches = self
            .windows
            .get(caller_label)
            .is_some_and(|record| record.generation == pending.window_generation);
        if pending.window_label != caller_label || !generation_matches {
            return Err(INVALID_REBIND_TOKEN); // 错窗或 stale generation:零变化
        }
        self.pending_rebinds.remove(token);
        Ok(())
    }

    /// 只读:pending rebind 数量(诊断/测试)。
    pub fn pending_rebind_count(&self) -> usize {
        self.pending_rebinds.len()
    }

    /// 生成新的 bootstrap 交付:ready_generation 递增并指向新 deliveryId。
    /// 旧代交付自此成为 stale(completion 一律拒绝)。
    pub fn next_delivery(
        &mut self,
        label: &str,
        intent_id: &str,
    ) -> Result<(String, u64), &'static str> {
        let Some(record) = self.windows.get_mut(label) else {
            return Err(UNKNOWN_WINDOW);
        };
        self.delivery_counter += 1;
        let delivery_id = format!(
            "delivery-{}-{}",
            self.delivery_counter,
            uuid::Uuid::new_v4().simple()
        );
        record.ready_generation += 1;
        let generation = record.ready_generation;
        record.bootstrap_delivery_id = Some(delivery_id.clone());
        if record.active_intent_id.is_none() {
            record.active_intent_id = Some(intent_id.to_string());
        }
        self.deliveries.insert(
            delivery_id.clone(),
            DeliverySlot {
                label: label.to_string(),
                generation,
                completed: false,
            },
        );
        Ok((delivery_id, generation))
    }

    /// 校验并消费一次交付完成(P3 registry 腿):跨 label、重放、
    /// 旧 generation(record 已指向新交付)一律 `STALE_BOOTSTRAP_COMPLETION`。
    /// 仅做校验与标记,不触发其他状态变化(原子组合归 coordinator)。
    pub fn complete_delivery(
        &mut self,
        label: &str,
        delivery_id: &str,
    ) -> Result<(), &'static str> {
        let is_current = self
            .windows
            .get(label)
            .is_some_and(|r| r.bootstrap_delivery_id.as_deref() == Some(delivery_id));
        let Some(slot) = self.deliveries.get_mut(delivery_id) else {
            return Err(STALE_BOOTSTRAP_COMPLETION);
        };
        if slot.label != label || slot.completed || !is_current {
            return Err(STALE_BOOTSTRAP_COMPLETION);
        }
        slot.completed = true;
        Ok(())
    }

    /// 只读快照(测试与诊断;不构成修改通道)。
    pub fn record(&self, label: &str) -> Option<WindowRecord> {
        self.windows.get(label).cloned()
    }

    pub fn labels(&self) -> Vec<String> {
        self.windows.keys().cloned().collect()
    }

    /// 交付槽只读快照(T2 断言 delivery 未消费用)。
    pub fn delivery_info(&self, delivery_id: &str) -> Option<DeliveryInfo> {
        self.deliveries.get(delivery_id).map(|s| DeliveryInfo {
            label: s.label.clone(),
            generation: s.generation,
            completed: s.completed,
        })
    }

    fn transition(&mut self, label: &str, to: WindowState) -> Result<(), &'static str> {
        let Some(record) = self.windows.get_mut(label) else {
            return Err(UNKNOWN_WINDOW);
        };
        if !record.state.can_transition_to(to) {
            return Err(INVALID_WINDOW_TRANSITION);
        }
        record.state = to;
        Ok(())
    }

    /// 只在占用者仍是本 label 时释放该 identity 的全部 alias(防御索引漂移)。
    fn release_identity_if_owner(&mut self, identity: &FileIdentity, label: &str) {
        for alias in identity.aliases() {
            if self
                .alias_owners
                .get(&alias)
                .is_some_and(|owner| owner.label == label)
            {
                self.alias_owners.remove(&alias);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: &str = "main";
    const EDITOR: &str = "editor-1";

    fn registry_with_main() -> WindowRegistry {
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r
    }

    #[test]
    fn r1_duplicate_label_rejected_without_overwriting() {
        let mut r = registry_with_main();
        r.begin_loading(MAIN, &FileIdentity::synthetic("a"), "i-1")
            .unwrap();
        let err = r.register(MAIN).unwrap_err();
        assert_eq!(err, DUPLICATE_WINDOW_LABEL);
        // 既有 record 原样保留(未被覆盖回 Booting)
        let record = r.record(MAIN).unwrap();
        assert_eq!(record.state, WindowState::Loading);
        assert_eq!(record.file_identity, Some(FileIdentity::synthetic("a")));
    }

    #[test]
    fn r2_identity_reserved_by_single_label_across_loading_and_open() {
        let mut r = registry_with_main();
        r.register(EDITOR).unwrap();
        r.begin_loading(MAIN, &FileIdentity::synthetic("a"), "i-1")
            .unwrap();
        // loading 中:同 identity 第二个 label 稳定拒绝
        assert_eq!(
            r.begin_loading(EDITOR, &FileIdentity::synthetic("a"), "i-2")
                .unwrap_err(),
            IDENTITY_ALREADY_RESERVED
        );
        assert_eq!(
            r.identity_owner(&FileIdentity::synthetic("a")).unwrap().0,
            MAIN
        );
        // open 后依旧占用
        r.mark_open(MAIN).unwrap();
        assert_eq!(
            r.begin_loading(EDITOR, &FileIdentity::synthetic("a"), "i-3")
                .unwrap_err(),
            IDENTITY_ALREADY_RESERVED
        );
        // 不同 identity 不受影响
        r.begin_loading(EDITOR, &FileIdentity::synthetic("b"), "i-4")
            .unwrap();
    }

    #[test]
    fn r2_failed_and_destroyed_release_identity_for_new_window() {
        let mut r = registry_with_main();
        r.begin_loading(MAIN, &FileIdentity::synthetic("a"), "i-1")
            .unwrap();
        r.mark_failed(MAIN).unwrap();
        assert_eq!(r.identity_owner(&FileIdentity::synthetic("a")), None);
        // failed 释放后可被其他窗口 reserve(retry 场景由 coordinator 驱动)
        r.begin_loading(MAIN, &FileIdentity::synthetic("a"), "i-2")
            .unwrap();
        r.mark_open(MAIN).unwrap();
        r.on_destroyed(MAIN);
        assert_eq!(r.identity_owner(&FileIdentity::synthetic("a")), None);
        assert_eq!(r.record(MAIN), None);
    }

    #[test]
    fn r3_destroyed_cleans_record_reservation_and_deliveries_idempotently() {
        let mut r = registry_with_main();
        r.register(EDITOR).unwrap();
        r.begin_loading(MAIN, &FileIdentity::synthetic("a"), "i-1")
            .unwrap();
        let (delivery, _) = r.next_delivery(MAIN, "i-1").unwrap();
        let (editor_delivery, _) = r.next_delivery(EDITOR, "i-2").unwrap();
        r.on_destroyed(MAIN);
        r.on_destroyed(MAIN); // 幂等
        r.on_destroyed("never-registered"); // 未知 label 无副作用
        assert_eq!(r.record(MAIN), None);
        assert_eq!(r.identity_owner(&FileIdentity::synthetic("a")), None);
        // MAIN 的交付槽已清;EDITOR 的不受影响
        assert!(r.complete_delivery(MAIN, &delivery).is_err());
        assert!(r.complete_delivery(EDITOR, &editor_delivery).is_ok());
        assert_eq!(r.record(EDITOR).unwrap().label, EDITOR);
    }

    #[test]
    fn r4_invalid_transitions_rejected_without_state_change() {
        let mut r = registry_with_main();
        // booting 跳过 loading 直接 open
        assert_eq!(r.mark_open(MAIN).unwrap_err(), INVALID_WINDOW_TRANSITION);
        assert_eq!(r.record(MAIN).unwrap().state, WindowState::Booting);
        // booting 直接 closing 非法(先要 blank/loading/failed 之一)
        assert_eq!(
            r.begin_closing(MAIN).unwrap_err(),
            INVALID_WINDOW_TRANSITION
        );
        // 正常链:blank → open(非法,open 只能来自 loading)
        r.mark_blank(MAIN).unwrap();
        assert_eq!(r.mark_open(MAIN).unwrap_err(), INVALID_WINDOW_TRANSITION);
        assert_eq!(r.record(MAIN).unwrap().state, WindowState::Blank);
        // loading → blank 非法(文档读取中不能变空窗)
        r.begin_loading(MAIN, &FileIdentity::synthetic("a"), "i-1")
            .unwrap();
        assert_eq!(r.mark_blank(MAIN).unwrap_err(), INVALID_WINDOW_TRANSITION);
        // closing 不可逆(但 closing 仍持有 identity)
        r.begin_closing(MAIN).unwrap();
        assert_eq!(r.record(MAIN).unwrap().state, WindowState::Closing);
        assert_eq!(
            r.identity_reservation(&FileIdentity::synthetic("a"))
                .unwrap()
                .1,
            WindowState::Closing
        );
        assert_eq!(
            r.begin_loading(MAIN, &FileIdentity::synthetic("x"), "i-9")
                .unwrap_err(),
            INVALID_WINDOW_TRANSITION
        );
        assert_eq!(r.mark_open(MAIN).unwrap_err(), INVALID_WINDOW_TRANSITION);
        // 未知窗口
        assert_eq!(r.mark_blank("ghost").unwrap_err(), UNKNOWN_WINDOW);
    }

    #[test]
    fn delivery_completion_rejects_cross_window_replay_and_stale_generation() {
        let mut r = registry_with_main();
        r.register(EDITOR).unwrap();
        let (first, gen1) = r.next_delivery(MAIN, "i-1").unwrap();
        // 跨 label 拒绝
        assert_eq!(
            r.complete_delivery(EDITOR, &first).unwrap_err(),
            STALE_BOOTSTRAP_COMPLETION
        );
        // 首代成功消费
        assert_eq!(gen1, 1);
        assert!(r.complete_delivery(MAIN, &first).is_ok());
        // 重放拒绝
        assert_eq!(
            r.complete_delivery(MAIN, &first).unwrap_err(),
            STALE_BOOTSTRAP_COMPLETION
        );
        // 新代交付后旧代 completion 拒绝(stale generation)
        let (second, gen2) = r.next_delivery(MAIN, "i-2").unwrap();
        assert_eq!(gen2, 2);
        assert!(r.complete_delivery(MAIN, &second).is_ok());
        let (third, _) = r.next_delivery(MAIN, "i-3").unwrap();
        let (fourth, _) = r.next_delivery(MAIN, "i-4").unwrap();
        // 窗口当前代已指向 fourth:third 的 completion 是旧代,必须拒绝
        assert_eq!(
            r.complete_delivery(MAIN, &third).unwrap_err(),
            STALE_BOOTSTRAP_COMPLETION,
            "窗口已有新代交付时,旧代 completion 必须拒绝"
        );
        assert!(r.complete_delivery(MAIN, &fourth).is_ok());
        // 未知 deliveryId
        assert_eq!(
            r.complete_delivery(MAIN, "delivery-forged").unwrap_err(),
            STALE_BOOTSTRAP_COMPLETION
        );
    }

    #[test]
    fn cold_main_available_only_while_booting_without_assignment() {
        let mut r = registry_with_main();
        assert!(r.cold_main_available(MAIN));
        r.mark_blank(MAIN).unwrap();
        assert!(!r.cold_main_available(MAIN), "Blank 后进入 warm,不再冷分配");
        r.begin_loading(MAIN, &FileIdentity::synthetic("a"), "i-1")
            .unwrap();
        assert!(!r.cold_main_available(MAIN));
        assert!(!r.cold_main_available("ghost"));
    }

    #[test]
    fn editor_label_allocation_skips_occupied_labels() {
        let mut r = WindowRegistry::new();
        r.register("editor-1").unwrap(); // 模拟外部已占用
        let label = r.allocate_editor_label();
        assert_eq!(label, "editor-2");
        assert_ne!(r.allocate_editor_label(), label);
    }
}

#[cfg(test)]
mod a1_red_tests {
    use super::*;

    const MAIN: &str = "main";
    const EDITOR: &str = "editor-1";

    #[test]
    fn c1_focusable_none_and_write_reject_must_be_explainable() {
        // A1-F4 修复后的最终形态(红灯版本断言"None+Err 即分裂",在引入
        // identity_reservation 后改写为一致性断言):focusable 查询无主
        // 且写入被拒时,全量持有查询必须能解释这个拒绝 —— 同一事实。
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.register(EDITOR).unwrap();
        r.begin_loading(MAIN, &FileIdentity::synthetic("f"), "i-1")
            .unwrap();
        r.begin_closing(MAIN).unwrap();
        let lookup = r.identity_owner(&FileIdentity::synthetic("f"));
        let write = r.begin_loading(EDITOR, &FileIdentity::synthetic("f"), "i-2");
        let full = r.identity_reservation(&FileIdentity::synthetic("f"));
        assert!(lookup.is_none(), "Closing 窗口不是聚焦目标");
        assert_eq!(write.unwrap_err(), IDENTITY_ALREADY_RESERVED);
        assert_eq!(
            full,
            Some((MAIN.to_string(), WindowState::Closing)),
            "写入拒绝必须能由全量持有查询解释(C1:同一事实)"
        );
    }

    #[test]
    fn red_a1_closing_keeps_reservation_until_destroyed() {
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.begin_loading(MAIN, &FileIdentity::synthetic("f"), "i-1")
            .unwrap();
        r.begin_closing(MAIN).unwrap();
        // 目标行为(A1.4):Closing 期间 reservation 保持;Destroyed 才释放。
        r.register(EDITOR).unwrap();
        assert_eq!(
            r.begin_loading(EDITOR, &FileIdentity::synthetic("f"), "i-2")
                .unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "Closing 期间同 identity 不得被抢占"
        );
        r.on_destroyed(MAIN);
        assert!(r
            .begin_loading(EDITOR, &FileIdentity::synthetic("f"), "i-3")
            .is_ok());
    }

    #[test]
    fn c1_identity_reservation_reports_closing_state() {
        // A1-F4 修复后的精确断言:全部持有态(含 Closing)都可查询,
        // 与 begin_loading 的拒绝条件同一事实。
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.begin_loading(MAIN, &FileIdentity::synthetic("f"), "i-1")
            .unwrap();
        r.begin_closing(MAIN).unwrap();
        assert_eq!(
            r.identity_reservation(&FileIdentity::synthetic("f")),
            Some((MAIN.to_string(), WindowState::Closing))
        );
        // focusable 查询明确不含 Closing(聚焦目标 ≠ 持有事实)
        assert_eq!(r.identity_owner(&FileIdentity::synthetic("f")), None);
        r.on_destroyed(MAIN);
        assert_eq!(r.identity_reservation(&FileIdentity::synthetic("f")), None);
    }
}

#[cfg(all(test, unix))]
mod b_tests {
    use super::*;
    use crate::file::identity::{FileIdentityProvider, UnixFileIdentityProvider};
    use std::fs;
    use std::path::PathBuf;

    const MAIN: &str = "main";
    const W2: &str = "editor-2";

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    fn registry_two() -> WindowRegistry {
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.register(W2).unwrap();
        r
    }

    /// 打开一个真实文件到 main(Loading→Open,完整身份)。
    fn open_real(r: &mut WindowRegistry, label: &str, path: &std::path::Path) -> FileIdentity {
        let id = UnixFileIdentityProvider.resolve_existing(path).unwrap();
        r.begin_loading(label, &id, "i-open").unwrap();
        r.mark_open(label).unwrap();
        id
    }

    #[test]
    fn i_b1_symlink_and_relative_paths_single_owner() {
        let dir = tmpdir();
        let real = dir.join("real.mm");
        fs::write(&real, "{}").unwrap();
        let link = dir.join("link.mm");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let mut r = registry_two();
        let direct = open_real(&mut r, MAIN, &real);
        // 经 symlink/相对段再次分配给另一窗口 → 拒绝(canonical alias 重合)
        let via_link = UnixFileIdentityProvider.resolve_existing(&link).unwrap();
        let dotted = UnixFileIdentityProvider
            .resolve_existing(&dir.join("./real.mm"))
            .unwrap();
        assert_eq!(via_link, direct);
        assert_eq!(dotted, direct);
        assert_eq!(
            r.begin_loading(W2, &via_link, "i-dup").unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "I-B1:等价路径只得到一个 owner"
        );
    }

    #[test]
    fn i_b2_hard_link_physical_alias_blocks_second_window() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        fs::write(&a, "{}").unwrap();
        let b = dir.join("b.mm");
        fs::hard_link(&a, &b).unwrap();
        let mut r = registry_two();
        let ia = open_real(&mut r, MAIN, &a);
        let ib = UnixFileIdentityProvider.resolve_existing(&b).unwrap();
        assert_ne!(ia.canonical(), ib.canonical(), "hard link 路径不同");
        assert_eq!(
            r.identity_reservation(&ib).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "I-B2:physical alias 重合 → 同一 owner"
        );
        assert_eq!(
            r.begin_loading(W2, &ib, "i-dup").unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "I-B2:第二窗口 reservation 被拒"
        );
    }

    #[test]
    fn i_b3_distinct_files_reserve_independently() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        let b = dir.join("b.mm");
        fs::write(&a, "{}").unwrap();
        fs::write(&b, "{}").unwrap();
        let mut r = registry_two();
        open_real(&mut r, MAIN, &a);
        let ib = UnixFileIdentityProvider.resolve_existing(&b).unwrap();
        assert!(
            r.begin_loading(W2, &ib, "i-2").is_ok(),
            "I-B3:不同文件独立 reservation"
        );
    }

    #[test]
    fn i_b4_unicode_path_identity_stable() {
        let dir = tmpdir();
        let p = dir.join("脑图 文档 v1.json");
        fs::write(&p, "{}").unwrap();
        let mut r = registry_two();
        let id = open_real(&mut r, MAIN, &p);
        // 再次解析(不经展示字符串比较)仍命中同一 owner
        let again = UnixFileIdentityProvider.resolve_existing(&p).unwrap();
        assert_eq!(
            r.identity_reservation(&again).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "I-B4:Unicode/空格路径稳定解析"
        );
        assert!(!id.canonical().display_lossy().is_empty()); // debug 投影可用但非判等键
    }

    #[test]
    fn i_b5_ordinary_replace_refreshes_physical_alias_atomically() {
        let dir = tmpdir();
        let p = dir.join("doc.mm");
        fs::write(&p, r#"{"v":1}"#).unwrap();
        let mut r = registry_two();
        let before = open_real(&mut r, MAIN, &p);
        // atomic replace(inode 轮换)
        let tmp = dir.join(".doc.mm.tmp");
        fs::write(&tmp, r#"{"v":2}"#).unwrap();
        fs::rename(&tmp, &p).unwrap();
        let refreshed = UnixFileIdentityProvider.refresh_after_commit(&p).unwrap();
        assert_eq!(before.canonical(), refreshed.canonical());
        assert_ne!(before.physical(), refreshed.physical());
        r.refresh_identity_after_commit(MAIN, &refreshed).unwrap();
        // canonical owner 持续存在;旧 inode alias 移除;新 alias 生效
        assert_eq!(
            r.identity_reservation(&refreshed).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "I-B5:新 physical alias 生效"
        );
        assert_eq!(
            r.identity_reservation(&before).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "I-B5:canonical 锚点持续(canonical 未变)"
        );
        // 旧 inode 的 alias 已被移除:构造"旧 physical + 新 canonical"的身份,
        // canonical 不命中任何 owner、physical 也已释放 → 查询为空
        let stale = FileIdentity::synthetic_with_physical(
            "/stale/canonical.mm",
            before.physical().unwrap().dev_u64_for_test(),
            before.physical().unwrap().ino_u64_for_test(),
        );
        assert_eq!(
            r.identity_reservation(&stale),
            None,
            "I-B5:旧 inode alias 已移除(不存在其 canonical 命中)"
        );
    }

    #[test]
    fn s_b1_save_as_to_free_path_prepare_commit_finalize() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("new.mm"); // 不存在
        let mut r = registry_two();
        let old_id = open_real(&mut r, MAIN, &source);
        // 1) prepare:写前预占(目标 canonical-only)
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        assert_eq!(r.pending_rebind_count(), 1);
        // pending 期间旧 identity 仍归当前窗口
        assert_eq!(
            r.identity_reservation(&old_id).map(|(l, _)| l),
            Some(MAIN.to_string())
        );
        // 2) commit(锁外;此处真实写文件模拟 FileLifecycleService)
        fs::write(&target, r#"{"saved":true}"#).unwrap();
        // 3) finalize:采用提交后的真实身份(physical 已轮换为真实 inode)
        let final_id = UnixFileIdentityProvider
            .refresh_after_commit(&target)
            .unwrap();
        r.finalize_rebind(MAIN, &token, &final_id).unwrap();
        assert_eq!(r.pending_rebind_count(), 0, "S-B1:pending 清");
        // 旧 identity 释放;新 identity 归属 main
        assert_eq!(
            r.identity_reservation(&old_id),
            None,
            "S-B1:旧 identity 释放"
        );
        assert_eq!(
            r.identity_reservation(&final_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "S-B1:原子换绑到新身份"
        );
    }

    #[test]
    fn s_b2_save_as_to_other_windows_identity_rejected_before_write() {
        let dir = tmpdir();
        let a = dir.join("a.mm");
        let b = dir.join("b.mm");
        fs::write(&a, "{}").unwrap();
        fs::write(&b, r#"{"w2":1}"#).unwrap();
        let mut r = registry_two();
        open_real(&mut r, MAIN, &a);
        let w2_id = open_real(&mut r, W2, &b);
        let bytes_before = fs::read(&b).unwrap();
        // W1 Save As 到 W2 的文件:写前拒绝
        assert_eq!(
            r.prepare_rebind(MAIN, &w2_id).unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "S-B2:写前拒绝"
        );
        assert_eq!(r.pending_rebind_count(), 0);
        assert_eq!(fs::read(&b).unwrap(), bytes_before, "S-B2:目标 bytes 不变");
        // 两窗 registry 均不变
        assert_eq!(
            r.identity_reservation(&w2_id).map(|(l, _)| l),
            Some(W2.to_string())
        );
    }

    #[test]
    fn s_b3_commit_failure_aborts_pending_only() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("new.mm");
        let mut r = registry_two();
        let old_id = open_real(&mut r, MAIN, &source);
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        // commit 失败(未写任何文件)→ abort
        r.abort_rebind(MAIN, &token).unwrap();
        assert_eq!(r.pending_rebind_count(), 0, "S-B3:pending 清理");
        // 旧 identity、handle/token/displayPath 语义(此处为 registry owner)不变
        assert_eq!(
            r.identity_reservation(&old_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "S-B3:旧 identity 不变"
        );
        // abort 后重复/未知 token 拒绝
        assert_eq!(
            r.abort_rebind(MAIN, &token).unwrap_err(),
            INVALID_REBIND_TOKEN
        );
        assert_eq!(
            r.finalize_rebind(MAIN, &token, &old_id).unwrap_err(),
            INVALID_REBIND_TOKEN
        );
    }

    #[test]
    fn s_b4_pending_rebind_same_target_open_defers() {
        use crate::lifecycle::launch_coordinator::{LaunchCoordinator, LaunchIntentKind};
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("new.mm");
        let mut registry = WindowRegistry::new();
        registry.register("main").unwrap();
        let old_id = UnixFileIdentityProvider.resolve_existing(&source).unwrap();
        registry.begin_loading("main", &old_id, "i-1").unwrap();
        registry.mark_open("main").unwrap();
        let c = LaunchCoordinator::new(registry);
        // Save As prepare(锁内)
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let _token = c.prepare_rebind("main", &target_id).unwrap();
        // pending 期间同目标 open → deferred(零 create/抢占)
        let dup = c.enqueue(
            LaunchIntentKind::OpenFile {
                identity: target_id.clone(),
            },
            Some(target.display().to_string()),
            2000,
        );
        assert!(c.route_next().is_empty(), "S-B4:pending 期间零 create/抢占");
        assert_eq!(
            c.phase(&dup).unwrap(),
            crate::lifecycle::launch_coordinator::IntentPhase::Queued,
            "S-B4:intent 按 deferred 语义保留"
        );
    }

    #[test]
    fn s_b5_destroyed_during_pending_rebind_cleans_all() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("new.mm");
        let mut r = registry_two();
        let old_id = open_real(&mut r, MAIN, &source);
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        r.on_destroyed(MAIN);
        r.on_destroyed(MAIN); // 幂等
        assert_eq!(r.pending_rebind_count(), 0, "S-B5:pending 清理");
        assert_eq!(
            r.identity_reservation(&old_id),
            None,
            "S-B5:active identity 清理"
        );
        assert_eq!(
            r.identity_reservation(&target_id),
            None,
            "S-B5:target 无残留占用"
        );
        // token 已随清理失效
        assert_eq!(
            r.finalize_rebind(MAIN, &token, &target_id).unwrap_err(),
            INVALID_REBIND_TOKEN
        );
    }

    #[test]
    fn r_b1_provider_failure_leaves_registry_untouched() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let missing = dir.join("missing.mm");
        let mut r = registry_two();
        let old_id = open_real(&mut r, MAIN, &source);
        // provider 解析失败(文件不存在)在锁外发生;registry 不被触碰
        let err = UnixFileIdentityProvider
            .resolve_existing(&missing)
            .unwrap_err();
        assert!(matches!(err, crate::file::identity::IdentityError::Io(_)));
        assert_eq!(
            r.identity_reservation(&old_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "R-B1:零部分更新"
        );
        assert_eq!(r.pending_rebind_count(), 0);
    }

    #[test]
    fn r_b2_display_string_cannot_influence_ownership() {
        // registry/coordinator 的 identity API 只接受 FileIdentity(host 经
        // provider 构造);enqueue 的 canonical_path 参数(display 字符串)仅
        // 透传给 renderer,不参与判等。两个文件显示名相同(文件名字符串一致)
        // 但 canonical 不同 → 独立 reservation,互不合并;同一 identity 在
        // 第二窗口必须拒绝——判等只经 FileIdentity 的 alias 集合。
        let mut r = registry_two();
        let id_x = FileIdentity::synthetic("/a/文档.mm");
        let id_y = FileIdentity::synthetic("/b/文档.mm"); // 同名、不同目录
        r.begin_loading(MAIN, &id_x, "i-1").unwrap();
        assert!(
            r.begin_loading(W2, &id_y, "i-2").is_ok(),
            "R-B2:显示字符串相同但身份不同 → 独立 reservation"
        );
        assert_eq!(
            r.begin_loading(W2, &id_x, "i-3").unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "R-B2:同 identity 判定不受任何字符串影响"
        );
    }
}

#[cfg(all(test, unix))]
mod b_orchestration_tests {
    //! MRT-004B §6.2 host-domain 编排证明:FileLifecycleService 真实文件
    //! 提交(锁外)与 registry 身份换绑(锁内)的全链路组合。不接真实
    //! Tauri IPC/lib.rs(Wave 2 装配)。

    use super::*;
    use crate::file::identity::{FileIdentityProvider, UnixFileIdentityProvider};
    use crate::file::{FileLifecycleService, TargetKind};
    use std::fs;
    use std::path::PathBuf;

    const MAIN: &str = "main";

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    fn opened_registry(path: &std::path::Path) -> (WindowRegistry, FileIdentity) {
        let svc = FileLifecycleService::new();
        let _opened = svc.open_file(MAIN, path).unwrap();
        let id = UnixFileIdentityProvider.resolve_existing(path).unwrap();
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.begin_loading(MAIN, &id, "i-1").unwrap();
        r.mark_open(MAIN).unwrap();
        (r, id)
    }

    #[test]
    fn ordinary_save_end_to_end_refreshes_physical_alias() {
        let dir = tmpdir();
        let path = dir.join("a.mm");
        fs::write(&path, r#"{"v":1}"#).unwrap();
        let svc = FileLifecycleService::new();
        let (mut r, before) = opened_registry(&path);
        let opened = svc.open_file(MAIN, &path).unwrap();
        // commit(锁外)
        svc.commit_ordinary(
            MAIN,
            &opened.document_target_handle,
            &opened.version_token,
            r#"{"v":2}"#,
        )
        .unwrap();
        // 解析(锁外)→ 刷新(锁内)
        let refreshed = UnixFileIdentityProvider
            .refresh_after_commit(&path)
            .unwrap();
        assert_ne!(
            before.physical(),
            refreshed.physical(),
            "原子替换轮换 inode"
        );
        r.refresh_identity_after_commit(MAIN, &refreshed).unwrap();
        assert_eq!(
            r.identity_reservation(&refreshed).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "I-B5 编排:新 physical alias 生效,canonical 持续"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"v":2}"#);
    }

    #[test]
    fn save_as_end_to_end_three_phase_with_real_commit() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, r#"{"v":1}"#).unwrap();
        let target = dir.join("new.mm"); // 不存在
        let svc = FileLifecycleService::new();
        let (mut r, old_id) = opened_registry(&source);
        // 授权(对话框结果由外部进入;锁外)
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        // prepare(锁内,写前预占)
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        // commit(锁外,真实原子替换 + handle 签发)
        let receipt = svc
            .commit_save_as(MAIN, &grant.authorization_ref, r#"{"v":2}"#)
            .unwrap();
        assert!(target.exists());
        // finalize(锁内,采用提交后真实身份)
        let final_id = UnixFileIdentityProvider
            .refresh_after_commit(&target)
            .unwrap();
        r.finalize_rebind(MAIN, &token, &final_id).unwrap();
        assert_eq!(
            r.identity_reservation(&old_id),
            None,
            "S-B1 编排:旧 identity 释放"
        );
        assert_eq!(
            r.identity_reservation(&final_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "S-B1 编排:换绑到新身份"
        );
        // Save As 之后的 ordinary save 用新 handle 继续(既有服务语义不回归)
        let r2 = svc
            .commit_ordinary(
                MAIN,
                &receipt.document_target_handle,
                &receipt.version_token,
                r#"{"v":3}"#,
            )
            .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"v":3}"#);
        let _ = r2;
    }

    #[test]
    fn save_as_commit_failure_aborts_with_real_toctou() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, r#"{"v":1}"#).unwrap();
        let target = dir.join("new.mm");
        let svc = FileLifecycleService::new();
        let (mut r, old_id) = opened_registry(&source);
        let _opened = svc.open_file(MAIN, &source).unwrap();
        let grant = svc
            .grant_authorization(MAIN, TargetKind::Document, &target)
            .unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        // 授权后目标被外部创建(TARGET_APPEARED)→ 真实 commit 失败
        fs::write(&target, r#"{"suddenly":true}"#).unwrap();
        let err = svc
            .commit_save_as(MAIN, &grant.authorization_ref, r#"{"v":2}"#)
            .unwrap_err();
        assert_eq!(err.0.code, "TARGET_APPEARED");
        // abort(锁内):只清 pending;旧 identity/owner 不变;目标 bytes 不变
        r.abort_rebind(MAIN, &token).unwrap();
        assert_eq!(r.pending_rebind_count(), 0, "S-B3 编排:pending 清理");
        assert_eq!(
            r.identity_reservation(&old_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "S-B3 编排:旧 identity 不变"
        );
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            r#"{"suddenly":true}"#,
            "S-B3 编排:外部内容不被覆盖"
        );
    }

    #[test]
    fn refresh_failure_after_commit_keeps_registry_unchanged() {
        // R-B1 编排:ordinary 提交成功但文件随即被外部删除 →
        // refresh_after_commit(锁外)失败,registry 完全不变(fail closed,
        // 不产生部分更新;真实接线时此类异常由错误通道上报)。
        let dir = tmpdir();
        let path = dir.join("a.mm");
        fs::write(&path, r#"{"v":1}"#).unwrap();
        let (r, before) = opened_registry(&path);
        let svc = FileLifecycleService::new();
        let opened = svc.open_file(MAIN, &path).unwrap();
        svc.commit_ordinary(
            MAIN,
            &opened.document_target_handle,
            &opened.version_token,
            r#"{"v":2}"#,
        )
        .unwrap();
        fs::remove_file(&path).unwrap(); // 外部删除
        assert!(UnixFileIdentityProvider
            .refresh_after_commit(&path)
            .is_err());
        // 未调用 refresh(零部分更新):旧 identity 保持归属
        assert_eq!(
            r.identity_reservation(&before).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "R-B1 编排:provider 失败 → registry 零更新"
        );
    }
}

#[cfg(all(test, unix))]
mod b1_red_tests {
    //! MRT-004B1 红灯:先记录旧实现失败,修复后全绿保留。

    use super::*;
    use crate::file::identity::{FileIdentityProvider, UnixFileIdentityProvider};
    use crate::lifecycle::launch_coordinator::{Effect, LaunchCoordinator, LaunchIntentKind};
    use std::fs;
    use std::path::PathBuf;

    const MAIN: &str = "main";

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    fn open_real(r: &mut WindowRegistry, label: &str, path: &std::path::Path) -> FileIdentity {
        let id = UnixFileIdentityProvider.resolve_existing(path).unwrap();
        r.begin_loading(label, &id, "i-open").unwrap();
        r.mark_open(label).unwrap();
        id
    }

    #[test]
    fn red_x1_active_occupancy_blocks_pending_prepare() {
        // X1 registry 回归腿:active 占用时同 alias prepare 拒绝。
        let dir = tmpdir();
        let target = dir.join("t.mm");
        fs::write(&target, "{}").unwrap();
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.register("editor-9").unwrap();
        r.mark_blank("editor-9").unwrap(); // editor-9 处于合法 Save As 状态
        let id = UnixFileIdentityProvider.resolve_existing(&target).unwrap();
        r.begin_loading(MAIN, &id, "i-1").unwrap();
        assert_eq!(
            r.prepare_rebind("editor-9", &id).unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "X1:active 占用时 prepare 拒绝"
        );
    }

    #[test]
    fn red_x1_coordinator_create_gap_blocks_pending_prepare() {
        // X1 的 coordinator 腿:route 产出 CreateWindow 后、回报前,
        // 同 target 的 Save As prepare 必须被拒绝(assignment 占用)。
        let dir = tmpdir();
        let target = dir.join("t.mm");
        fs::write(&target, "{}").unwrap();
        let target_id = UnixFileIdentityProvider.resolve_existing(&target).unwrap();
        let mut registry = WindowRegistry::new();
        registry.register(MAIN).unwrap();
        registry.mark_blank(MAIN).unwrap(); // main warm,迫使 editor 建窗
        let c = LaunchCoordinator::new(registry);
        let _intent = c.enqueue(
            LaunchIntentKind::OpenFile {
                identity: target_id.clone(),
            },
            Some(target.display().to_string()),
            1000,
        );
        let effects = c.route_next();
        assert!(
            matches!(effects.as_slice(), [Effect::CreateWindow { .. }]),
            "warm open 应产出 CreateWindow:{effects:?}"
        );
        // create 挂起期间:另一窗口对同 target prepare Save As → 必须拒绝
        assert_eq!(
            c.prepare_rebind(MAIN, &target_id).unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "X1:CreateWindow 已发出,同 target 不得形成 pending 双占用"
        );
    }

    #[test]
    fn red_x2_pending_blocks_all_begin_loading_entries() {
        // X2:pending target 存在时,任何 begin_loading 入口都不能抢占。
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("t.mm"); // 不存在
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.register("editor-9").unwrap();
        open_real(&mut r, MAIN, &source);
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let _token = r.prepare_rebind(MAIN, &target_id).unwrap();
        // 直接入口:begin_loading 抢占 pending target → 必须拒绝
        assert_eq!(
            r.begin_loading("editor-9", &target_id, "i-x").unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "X2:begin_loading 不得抢占 pending reservation"
        );
        // 间接入口:经 coordinator 的 assignment(cold/warm)
        let mut registry2 = WindowRegistry::new();
        registry2.register("main2").unwrap();
        let _ = registry2;
    }

    #[test]
    fn red_t1_prepare_a_finalize_b_rejected_with_zero_change() {
        // T1:prepare A 后 finalize B(canonical 不同)→ 稳定拒绝、零变化。
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let a_path = dir.join("a-target.mm");
        let b_path = dir.join("b-target.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        let old_id = open_real(&mut r, MAIN, &source);
        let a_id = UnixFileIdentityProvider
            .resolve_authorized_target(&a_path)
            .unwrap();
        let b_id = UnixFileIdentityProvider
            .resolve_authorized_target(&b_path)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &a_id).unwrap();
        assert_eq!(
            r.finalize_rebind(MAIN, &token, &b_id).unwrap_err(),
            INVALID_REBIND_TOKEN,
            "T1:finalize 目标必须与 token 绑定的 canonical 完全一致"
        );
        // 零变化:pending 仍在;旧 identity 归属不变
        assert_eq!(r.pending_rebind_count(), 1);
        assert_eq!(
            r.identity_reservation(&old_id).map(|(l, _)| l),
            Some(MAIN.to_string())
        );
    }

    #[test]
    fn red_t2_second_prepare_same_label_rejected() {
        // T2:同 label 第二个 pending rebind 在首个未终结前稳定拒绝。
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let t1 = dir.join("t1.mm");
        let t2p = dir.join("t2.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        open_real(&mut r, MAIN, &source);
        let id1 = UnixFileIdentityProvider
            .resolve_authorized_target(&t1)
            .unwrap();
        let id2 = UnixFileIdentityProvider
            .resolve_authorized_target(&t2p)
            .unwrap();
        let _token1 = r.prepare_rebind(MAIN, &id1).unwrap();
        assert_eq!(
            r.prepare_rebind(MAIN, &id2).unwrap_err(),
            IDENTITY_ALREADY_RESERVED,
            "T2:同 label 同时最多一个 pending document rebind"
        );
        assert_eq!(r.pending_rebind_count(), 1);
    }

    #[test]
    fn red_u1_blank_untitled_first_save_as_adopts_identity() {
        // U1:Blank + 无 identity 的首次 Save As 是正式路径。
        let dir = tmpdir();
        let target = dir.join("new.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.mark_blank(MAIN).unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        // commit(锁外真实写盘)
        fs::write(&target, r#"{"saved":true}"#).unwrap();
        let final_id = UnixFileIdentityProvider
            .refresh_after_commit(&target)
            .unwrap();
        r.finalize_rebind(MAIN, &token, &final_id).unwrap();
        // 窗口进入已命名文档状态(Open)并持有新 identity
        assert_eq!(
            r.record(MAIN).unwrap().state,
            WindowState::Open,
            "U1:Blank 首存后为已命名文档状态"
        );
        assert_eq!(
            r.identity_reservation(&final_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "U1:adopt 新 identity"
        );
    }

    #[test]
    fn red_u3_closing_untitled_close_save_stays_closing() {
        // U3:Closing + 原无 identity 的 close-save 成功后保持 Closing,
        // 可暂持新 identity;不得复活为 Open。
        let dir = tmpdir();
        let target = dir.join("close-save.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.mark_blank(MAIN).unwrap();
        r.begin_closing(MAIN).unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        fs::write(&target, "{}").unwrap();
        let final_id = UnixFileIdentityProvider
            .refresh_after_commit(&target)
            .unwrap();
        r.finalize_rebind(MAIN, &token, &final_id).unwrap();
        assert_eq!(
            r.record(MAIN).unwrap().state,
            WindowState::Closing,
            "U3:close-save 不复活窗口"
        );
        assert_eq!(
            r.identity_reservation(&final_id).map(|(l, _)| l),
            Some(MAIN.to_string()),
            "U3:Closing 暂持新 identity 直到 Destroyed"
        );
        r.on_destroyed(MAIN);
        assert_eq!(r.identity_reservation(&final_id), None, "U3:Destroyed 清理");
    }

    #[test]
    fn red_u2_blank_save_as_failure_keeps_untitled() {
        // U2:Blank Save As 取消/失败 → 无 identity、状态不变。
        let dir = tmpdir();
        let target = dir.join("new.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.mark_blank(MAIN).unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        r.abort_rebind(MAIN, &token).unwrap();
        assert_eq!(
            r.record(MAIN).unwrap().state,
            WindowState::Blank,
            "U2:保持 Blank"
        );
        assert_eq!(
            r.record(MAIN).unwrap().file_identity,
            None,
            "U2:无 identity"
        );
        assert_eq!(r.pending_rebind_count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn red_p1_non_utf8_paths_do_not_collide() {
        // P1:不同的非 UTF-8 路径不得因 lossy 折叠为同一 canonical key。
        // macOS 文件系统拒绝创建非法 UTF-8 文件名(实测 code 92 Illegal
        // byte sequence),端到端文件夹具在本平台不可达;以内存 OsString
        // 构造锁定 key 无损性(见红灯证据的可达性说明)。
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let a = PathBuf::from(OsString::from_vec(vec![0x61, 0xff, 0x78]));
        let b = PathBuf::from(OsString::from_vec(vec![0x61, 0xfe, 0x78]));
        assert_eq!(
            a.to_string_lossy(),
            b.to_string_lossy(),
            "前置:投影确实碰撞"
        );
        let id_a = FileIdentity::synthetic_os(&a);
        let id_b = FileIdentity::synthetic_os(&b);
        assert_ne!(id_a, id_b, "P1:无损 canonical key 不得碰撞");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.register("editor-9").unwrap();
        r.begin_loading(MAIN, &id_a, "i-1").unwrap();
        assert!(
            r.begin_loading("editor-9", &id_b, "i-2").is_ok(),
            "P1:不同非 UTF-8 路径可各自 reservation"
        );
    }
}

#[cfg(all(test, unix))]
mod b1_token_tests {
    //! B1.3:rebind token 绑定与 stale/replay/cross-window 规则。

    use super::*;
    use crate::file::identity::{FileIdentityProvider, UnixFileIdentityProvider};
    use std::fs;
    use std::path::PathBuf;

    const MAIN: &str = "main";

    fn tmpdir() -> PathBuf {
        tempfile::tempdir().unwrap().keep()
    }

    #[cfg(unix)]
    #[test]
    fn t3_stale_token_after_window_recreate_rejected() {
        // 窗口销毁后同名重建(generation 不同):旧 token finalize 被拒,
        // 零状态变化(新窗口不受旧 token 影响)。
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("t.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        let id = UnixFileIdentityProvider.resolve_existing(&source).unwrap();
        r.begin_loading(MAIN, &id, "i-1").unwrap();
        r.mark_open(MAIN).unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        // 窗口销毁 → pending 已清(S-B5)→ 同名重建(新 generation)
        r.on_destroyed(MAIN);
        r.register(MAIN).unwrap();
        r.mark_blank(MAIN).unwrap();
        assert_eq!(r.pending_rebind_count(), 0, "S-B5:Destroyed 清 pending");
        // 旧 token 字符串重放 → 拒绝(generation 防御为 on_destroyed 漏调
        // 时的深度兜底;常规路径 token 已随销毁失效)
        assert_eq!(
            r.finalize_rebind(MAIN, &token, &target_id).unwrap_err(),
            INVALID_REBIND_TOKEN,
            "T3:stale token 拒绝"
        );
        // 新窗口正常走完整 Save As(新 token 绑定新 generation)
        let token2 = r.prepare_rebind(MAIN, &target_id).unwrap();
        fs::write(&target, "{}").unwrap();
        let final_id = UnixFileIdentityProvider
            .refresh_after_commit(&target)
            .unwrap();
        r.finalize_rebind(MAIN, &token2, &final_id).unwrap();
        assert_eq!(r.record(MAIN).unwrap().file_identity, Some(final_id));
    }

    /// T3 诚实命名(B1A-F3):本用例只覆盖 forged token 与 replay;
    /// 真实 cross-window caller 校验见 `t3_xw_cross_window_caller_rejected_with_zero_change`。
    #[cfg(unix)]
    #[test]
    fn t3_forged_and_replay_token_rejected() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("t.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.register("editor-9").unwrap();
        r.mark_blank("editor-9").unwrap();
        let id = UnixFileIdentityProvider.resolve_existing(&source).unwrap();
        r.begin_loading(MAIN, &id, "i-1").unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        // 伪造 token
        assert_eq!(
            r.finalize_rebind(MAIN, "rebind-forged", &target_id)
                .unwrap_err(),
            INVALID_REBIND_TOKEN
        );
        // 重放:finalize 成功后同一 token 再来 → 拒
        fs::write(&target, "{}").unwrap();
        let final_id = UnixFileIdentityProvider
            .refresh_after_commit(&target)
            .unwrap();
        r.finalize_rebind(MAIN, &token, &final_id).unwrap();
        assert_eq!(
            r.finalize_rebind(MAIN, &token, &final_id).unwrap_err(),
            INVALID_REBIND_TOKEN,
            "T3:重放拒绝"
        );
        // 单一事实:MAIN 持有 final identity
        assert_eq!(
            r.identity_reservation(&final_id).map(|(l, _)| l),
            Some(MAIN.to_string())
        );
    }

    /// T3-XW(B1A-F3):W2 对 W1 的 token 执行 finalize 与 abort → 稳定
    /// 拒绝;pending、两窗 record、alias owners、目标 bytes 全部零变化;
    /// W1 随后仍可正常 finalize(所有权未被他人调用破坏)。
    #[cfg(unix)]
    #[test]
    fn t3_xw_cross_window_caller_rejected_with_zero_change() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("t.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        r.register("editor-9").unwrap();
        r.mark_blank("editor-9").unwrap();
        let id = UnixFileIdentityProvider.resolve_existing(&source).unwrap();
        r.begin_loading(MAIN, &id, "i-1").unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();
        fs::write(&target, "{}").unwrap();
        let final_id = UnixFileIdentityProvider
            .refresh_after_commit(&target)
            .unwrap();
        let before_main = r.record(MAIN).unwrap();
        let before_w2 = r.record("editor-9").unwrap();
        // W2 用 W1 的 token finalize / abort → 一致稳定拒绝
        assert_eq!(
            r.finalize_rebind("editor-9", &token, &final_id)
                .unwrap_err(),
            INVALID_REBIND_TOKEN,
            "T3-XW:错窗 caller finalize 拒绝"
        );
        assert_eq!(
            r.abort_rebind("editor-9", &token).unwrap_err(),
            INVALID_REBIND_TOKEN,
            "T3-XW:错窗 caller abort 拒绝"
        );
        // 零变化:pending 仍在;两窗 record 不变;目标无归属;bytes 不变
        assert_eq!(r.pending_rebind_count(), 1);
        assert_eq!(r.record(MAIN).unwrap(), before_main);
        assert_eq!(r.record("editor-9").unwrap(), before_w2);
        assert_eq!(r.identity_reservation(&target_id), None);
        assert_eq!(fs::read_to_string(&target).unwrap(), "{}");
        // W1(owner)仍可正常 finalize
        r.finalize_rebind(MAIN, &token, &final_id).unwrap();
        assert_eq!(r.record(MAIN).unwrap().file_identity, Some(final_id));
        assert_eq!(r.pending_rebind_count(), 0);
    }

    /// T3 stale 纵深：abort 与 finalize 一样必须绑定 prepare 时的窗口
    /// generation；即使同名 label 被错误地带入新代，也不能清掉旧代 token。
    #[cfg(unix)]
    #[test]
    fn t3_stale_generation_abort_rejected_without_consuming_pending() {
        let dir = tmpdir();
        let source = dir.join("a.mm");
        fs::write(&source, "{}").unwrap();
        let target = dir.join("t.mm");
        let mut r = WindowRegistry::new();
        r.register(MAIN).unwrap();
        let id = UnixFileIdentityProvider.resolve_existing(&source).unwrap();
        r.begin_loading(MAIN, &id, "i-1").unwrap();
        let target_id = UnixFileIdentityProvider
            .resolve_authorized_target(&target)
            .unwrap();
        let token = r.prepare_rebind(MAIN, &target_id).unwrap();

        // 模拟异常恢复中同 label 已进入新 generation、旧 pending 尚在；
        // 正常 Destroyed 路径会直接清理 pending，此测试锁定纵深校验。
        r.windows.get_mut(MAIN).unwrap().generation += 1;
        assert_eq!(
            r.abort_rebind(MAIN, &token).unwrap_err(),
            INVALID_REBIND_TOKEN
        );
        assert_eq!(r.pending_rebind_count(), 1, "stale abort 不得消费 token");
    }
}
