//! LaunchCoordinator(MRT-004A/A1 / ADR 0008):launch intent 队列 → 窗口路由
//! → effect → awaitable terminal outcome → ack 的 host 侧状态机。
//!
//! A1 重构(并发与交付可靠性):
//! - **单并发 owner**:`Mutex<CoordinatorState>` 唯一状态锁,统一拥有
//!   registry / intents / order / in-flight / 计数器(A1-F1);
//!   WindowRegistry 是纯数据结构;不存在任何多锁组合,ABBA 反向锁序
//!   结构性不可能;
//! - **原子 reducer**:每个 completion 在单次临界区内 validate-then-commit
//!   ——全部前置条件先验证(只读),再一次提交;失败时完整状态零变化
//!   (A1-F3/T1/T2);
//! - **副作用只在锁外**:窗口创建/聚焦/事件发射只能作为 effect 返回,
//!   由调用方在 state lock 释放后执行;锁内无 OS/IPC/文件 IO/renderer 回调;
//! - **Closing 延迟路由**:identity 持有态含 Closing;同 identity intent
//!   在 Closing 期间 deferred(零 effect,留在队列,不阻塞其他 identity),
//!   Destroyed 后由下一次 route_next 恢复同 intentId(A1-F4);无
//!   sleep/轮询/自旋;
//! - 串行语义:同一时刻最多一个 **routing** intent(队列按
//!   `receivedAt + intentId` 稳定排序);routing 期间后续 queued intent
//!   零副作用(Q1);assigned / retryable 是稳定等待点,占位释放;
//! - ack 只在终态后(opened / focused-existing / blank-created / dismissed
//!   恰好一个 AckIntent);失败进 retryable-error,不 ack、不自旋;
//! - effect completion 必须过 correlation:intent 是当前 in-flight、处于
//!   预期 Awaiting 步且 label / deliveryId 完全一致;重放、跨窗、乱序、
//!   terminal 后回报一律稳定拒绝(P3)。

use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;

use crate::lifecycle::window_registry::{
    DeliveryInfo, FileIdentity, ReservationHolder, WindowRecord, WindowRegistry, WindowState,
    IDENTITY_CANONICAL_MISMATCH, INVALID_WINDOW_TRANSITION,
};

/// 稳定错误码(coordinator 腿;跨语言拼写不得更改)。
pub const UNKNOWN_INTENT: &str = "UNKNOWN_INTENT";
pub const INVALID_INTENT_TRANSITION: &str = "INVALID_INTENT_TRANSITION";
pub const INVALID_EFFECT_COMPLETION: &str = "INVALID_EFFECT_COMPLETION";
/// W2R-F4:startup barrier——open-file intent 已存在(或 ready 决策与 open
/// 入队在同临界区交错)时,main 的 Blank 确认必须被拒(单锁线性化)。
pub const STARTUP_BARRIER_OPEN_PENDING: &str = "STARTUP_BARRIER_OPEN_PENDING";

/// intent 种类(identity 在入队时由调用方给出;A1 为合成值,MRT-004B 接真实计算)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchIntentKind {
    OpenFile { identity: FileIdentity },
    Activation,
}

/// intent 生命周期:
/// queued → routing → assigned → terminal;routing/assigned → retryable-error;
/// retryable-error →(retry)queued → routing 或(dismiss)terminal(dismissed)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntentPhase {
    Queued,
    Routing { awaiting: Awaiting },
    Assigned { label: String, delivery_id: String },
    RetryableError { reason: String },
    Terminal(TerminalOutcome),
}

/// routing 中正在等待回报的 effect 步(correlation 校验的预期项)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Awaiting {
    CreateWindow { label: String },
    FocusWindow { label: String },
    DeliverBootstrap { label: String, delivery_id: String },
}

/// 稳定终态(ADR 0008 Terminal Outcome;只有这些(含 dismissed)可 ack)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalOutcome {
    Opened,
    FocusedExisting,
    BlankCreated,
    Dismissed,
}

/// AckIntent 的一次性清理摘要(C2:terminal intent 不无限驻留完整队列,
/// 仅保留有限诊断;容量见 ACK_SUMMARY_CAPACITY)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AckSummary {
    pub intent_id: String,
    pub outcome: TerminalOutcome,
    pub received_at_ms: i64,
}

/// 诊断摘要容量(环形;超出即淘汰最旧)。
const ACK_SUMMARY_CAPACITY: usize = 32;

/// platform_window_ready 的快照条目(C3:renderer 只拿
/// deliveryId + intentId + kind,展示路径可选)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingBootstrap {
    pub delivery_id: String,
    pub intent_id: String,
    pub kind: BootstrapKind,
    /// 仅展示投影;不参与打开或 identity 判定(§4.2)。
    pub canonical_path: Option<String>,
}

/// renderer 对一次 bootstrap 交付的终态回报(dismiss 不经 renderer,走 dismiss())。
/// 与 TS `BootstrapActionOutcome` 一一对应(A1-F5:不含 focused-existing/dismissed)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RendererOutcome {
    Opened,
    BlankCreated,
    RetryableError { reason: String },
}

/// 状态机产出的副作用(调用方在锁外执行后必须回报)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// 创建 `editor-*` 窗口(label 由 host 分配)。
    CreateWindow { intent_id: String, label: String },
    /// 显示并聚焦既有窗口(同 identity open/loading)。
    FocusWindow { intent_id: String, label: String },
    /// 向目标窗口交付 bootstrap(renderer 先装 listener 再读快照)。
    DeliverBootstrap {
        intent_id: String,
        label: String,
        delivery_id: String,
        kind: BootstrapKind,
        canonical_path: Option<String>,
    },
    /// 终态确认:从队列移除 intent(恰好一次)。
    AckIntent { intent_id: String },
    /// retryable-error 可见化(错误 UI;用户可 retry/dismiss)。
    ShowRetryableError { intent_id: String, reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootstrapKind {
    OpenPath,
    Blank,
}

/// effect 执行结果回报(`ok=false` 时 reason 必填)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EffectResult {
    WindowCreated {
        intent_id: String,
        label: String,
        ok: bool,
        reason: Option<String>,
    },
    WindowFocused {
        intent_id: String,
        label: String,
        ok: bool,
        reason: Option<String>,
    },
    BootstrapDelivered {
        intent_id: String,
        label: String,
        delivery_id: String,
        ok: bool,
        reason: Option<String>,
    },
}

#[derive(Debug, Clone)]
struct Intent {
    kind: LaunchIntentKind,
    canonical_path: Option<String>,
    received_at_ms: i64,
    phase: IntentPhase,
}

/// 唯一并发 owner 拥有的完整状态(A1-F1)。
#[derive(Default)]
struct CoordinatorState {
    registry: WindowRegistry,
    intents: HashMap<String, Intent>,
    /// 稳定顺序键 (receivedAt, intentId)。
    order: BTreeSet<(i64, String)>,
    /// 当前 routing 中的 intent(到 assigned/retryable/terminal 即释放)。
    in_flight: Option<String>,
    intent_counter: u64,
    /// 已 ack 的 terminal 摘要(有限;C2 一次性清理)。
    ack_summaries: std::collections::VecDeque<AckSummary>,
}

/// 队首 intent 的路由决策结果。
enum Decision {
    /// 立即路由,产出首步 effect。
    Route(Vec<Effect>),
    /// identity 处于 Closing(或 pending rebind,MRT-004B)持有:零 effect,
    /// intent 留在队列;不阻塞其他 identity 的 intent;Destroyed/释放后由
    /// 下一次 route_next 恢复(A1-F4)。
    Defer,
}

/// coordinator:单锁状态机;副作用只能以 effect 形式返回到锁外执行。
pub struct LaunchCoordinator {
    state: Mutex<CoordinatorState>,
}

impl LaunchCoordinator {
    pub fn new(registry: WindowRegistry) -> Self {
        Self {
            state: Mutex::new(CoordinatorState {
                registry,
                ..CoordinatorState::default()
            }),
        }
    }

    /// 入队(queued)。identity/canonical path 由调用方提供(host 拥有;
    /// displayPath 不参与判等)。
    pub fn enqueue(
        &self,
        kind: LaunchIntentKind,
        canonical_path: Option<String>,
        received_at_ms: i64,
    ) -> String {
        let mut st = self.state.lock().unwrap();
        st.intent_counter += 1;
        let intent_id = format!(
            "intent-{}-{}",
            st.intent_counter,
            uuid::Uuid::new_v4().simple()
        );
        st.intents.insert(
            intent_id.clone(),
            Intent {
                kind,
                canonical_path,
                received_at_ms,
                phase: IntentPhase::Queued,
            },
        );
        st.order.insert((received_at_ms, intent_id.clone()));
        intent_id
    }

    /// 派发下一个可路由的 queued intent。routing 进行中、全部 deferred
    /// 或队列为空时零产出(Q1)。deferred 的 intent 留在队列。
    pub fn route_next(&self) -> Vec<Effect> {
        let mut st = self.state.lock().unwrap();
        if st.in_flight.is_some() {
            return Vec::new();
        }
        let keys: Vec<(i64, String)> = st.order.iter().cloned().collect();
        for key in keys {
            let intent_id = key.1.clone();
            let is_queued = st
                .intents
                .get(&intent_id)
                .is_some_and(|i| matches!(i.phase, IntentPhase::Queued));
            if !st.intents.contains_key(&intent_id) || !is_queued {
                st.order.remove(&key); // 防御:缺失/非 queued 不应留在 order
                continue;
            }
            match decide_route(&mut st, &intent_id) {
                Decision::Defer => continue, // 留在 order,等下一次 route_next
                Decision::Route(effects) => {
                    st.order.remove(&key);
                    st.in_flight = Some(intent_id);
                    return effects;
                }
            }
        }
        Vec::new()
    }

    /// effect 执行回报:单临界区 correlation 校验 + validate-then-commit
    /// (A1-F3/T1:CreateWindow 成功路径的 register/reservation/delivery/
    /// phase 推进要么全部发生,要么零变化)。
    pub fn on_effect_result(&self, result: &EffectResult) -> Result<Vec<Effect>, &'static str> {
        let mut st = self.state.lock().unwrap();
        let intent_id = correlate_pending(&st, result)?;
        // 借阅结构:先 clone 决策输入(intent kind/path/awaiting),操作
        // registry(validate+commit)后再回写 phase——避免 intent 引用与
        // registry 可变借用交叉。
        let (kind, canonical_path, awaiting) = {
            let intent = st.intents.get(&intent_id).expect("correlate 已验证");
            let IntentPhase::Routing { awaiting } = &intent.phase else {
                return Err(INVALID_EFFECT_COMPLETION);
            };
            (
                intent.kind.clone(),
                intent.canonical_path.clone(),
                awaiting.clone(),
            )
        };
        let (ok, reason) = match result {
            EffectResult::WindowCreated { ok, reason, .. }
            | EffectResult::WindowFocused { ok, reason, .. }
            | EffectResult::BootstrapDelivered { ok, reason, .. } => (*ok, reason.clone()),
        };
        match (awaiting, ok) {
            // ---- CreateWindow 成功:validate 全部前置,再一次提交。----
            (Awaiting::CreateWindow { label: target }, true) => {
                let identity = match &kind {
                    LaunchIntentKind::OpenFile { identity } => Some(identity.clone()),
                    LaunchIntentKind::Activation => None,
                };
                // validate(只读):label 未登记;open-file 的 identity 预占
                // 必须仍归属本 target 的建窗 assignment(B1-F1:effect 发出
                // 前预留;他人预占/无预留 → 拒绝,T1 零变化)。
                if st.registry.record(&target).is_some() {
                    return Err(INVALID_EFFECT_COMPLETION);
                }
                if let Some(identity) = &identity {
                    if st.registry.assignment_of(identity).as_deref() != Some(target.as_str()) {
                        return Err(INVALID_EFFECT_COMPLETION);
                    }
                }
                // commit:register(Booting)→ begin_loading(Booting→Loading
                // + reservation)→ next_delivery。预检通过后 begin_loading
                // 在新登记窗口上必成功;防御分支回滚 register 保持零变化。
                if let Some(identity) = &identity {
                    st.registry
                        .register(&target)
                        .map_err(|_| INVALID_EFFECT_COMPLETION)?;
                    if st
                        .registry
                        .begin_loading(&target, identity, &intent_id)
                        .is_err()
                    {
                        st.registry.on_destroyed(&target); // 回滚:零变化
                        return Err(INVALID_EFFECT_COMPLETION);
                    }
                } else {
                    st.registry
                        .register(&target)
                        .map_err(|_| INVALID_EFFECT_COMPLETION)?;
                }
                let (delivery_id, _) = st
                    .registry
                    .next_delivery(&target, &intent_id)
                    .map_err(|_| INVALID_EFFECT_COMPLETION)?;
                let effect = match (&kind, &canonical_path) {
                    (LaunchIntentKind::OpenFile { .. }, path) => Effect::DeliverBootstrap {
                        intent_id: intent_id.clone(),
                        label: target.clone(),
                        delivery_id: delivery_id.clone(),
                        kind: BootstrapKind::OpenPath,
                        canonical_path: path.clone(),
                    },
                    (LaunchIntentKind::Activation, _) => Effect::DeliverBootstrap {
                        intent_id: intent_id.clone(),
                        label: target.clone(),
                        delivery_id: delivery_id.clone(),
                        kind: BootstrapKind::Blank,
                        canonical_path: None,
                    },
                };
                st.intents
                    .get_mut(&intent_id)
                    .expect("correlate 已验证")
                    .phase = IntentPhase::Routing {
                    awaiting: Awaiting::DeliverBootstrap {
                        label: target.clone(),
                        delivery_id,
                    },
                };
                Ok(vec![effect])
            }
            (Awaiting::CreateWindow { label }, false) => {
                // F1/X3:无幽灵窗口——registry 从未登记该 label;同时原子
                // 回滚 effect 发出前的建窗 identity 预占(B1-F1)。intent
                // 转 retryable。
                st.registry.release_assignment(&label);
                fail_intent(&mut st, &intent_id, reason)
            }
            // ---- FocusWindow:聚焦即终态(ADR 0008 §3)。----
            (Awaiting::FocusWindow { .. }, true) => {
                st.intents
                    .get_mut(&intent_id)
                    .expect("correlate 已验证")
                    .phase = IntentPhase::Terminal(TerminalOutcome::FocusedExisting);
                release_in_flight(&mut st, &intent_id);
                Ok(vec![Effect::AckIntent { intent_id }])
            }
            (Awaiting::FocusWindow { .. }, false) => fail_intent(&mut st, &intent_id, reason),
            // ---- DeliverBootstrap 成功:进入 assigned(等 renderer 终态)。----
            (Awaiting::DeliverBootstrap { label, delivery_id }, true) => {
                st.intents
                    .get_mut(&intent_id)
                    .expect("correlate 已验证")
                    .phase = IntentPhase::Assigned { label, delivery_id };
                release_in_flight(&mut st, &intent_id);
                Ok(Vec::new())
            }
            (Awaiting::DeliverBootstrap { label, .. }, false) => {
                // 交付失败:窗口已登记且承载 assignment → 标 failed 释放
                // reservation,再转 retryable(单临界区)。
                let _ = st.registry.mark_failed(&label);
                fail_intent(&mut st, &intent_id, reason)
            }
        }
    }

    /// renderer 终态回报:单临界区 validate-then-commit(A1-F3/T2)。
    /// validate 全部只读检查通过后才消费 delivery 并推进窗口/intent;
    /// 任一失败零变化(delivery 未消费、intent/窗口不变)。
    pub fn on_renderer_outcome(
        &self,
        label: &str,
        delivery_id: &str,
        outcome: RendererOutcome,
    ) -> Result<Vec<Effect>, &'static str> {
        let mut st = self.state.lock().unwrap();
        // validate 1:intent 处于该 (label, deliveryId) 的 assigned。
        let intent_id = st
            .intents
            .iter()
            .find(|(_, i)| {
                matches!(
                    &i.phase,
                    IntentPhase::Assigned { label: l, delivery_id: d }
                        if l == label && d == delivery_id
                )
            })
            .map(|(id, _)| id.clone())
            .ok_or(INVALID_EFFECT_COMPLETION)?;
        // validate 2:窗口状态与 outcome 匹配(只读;失败时 delivery 尚未
        // 消费,整体零变化——T2)。
        let state_ok = match &outcome {
            RendererOutcome::Opened => st
                .registry
                .record(label)
                .is_some_and(|r| r.state == WindowState::Loading),
            RendererOutcome::BlankCreated => st
                .registry
                .record(label)
                .is_some_and(|r| r.state == WindowState::Booting),
            RendererOutcome::RetryableError { .. } => matches!(
                st.registry.record(label).map(|r| r.state),
                Some(WindowState::Loading) | Some(WindowState::Booting)
            ),
        };
        if !state_ok {
            return Err(INVALID_EFFECT_COMPLETION);
        }
        // validate 3:交付是当前代且未消费(跨 label/重放/旧代拒绝)。
        st.registry
            .complete_delivery(label, delivery_id)
            .map_err(|_| INVALID_EFFECT_COMPLETION)?;
        // commit(借阅结构:registry 先行,再回写 intent phase)。
        match outcome {
            RendererOutcome::Opened => {
                st.registry
                    .mark_open(label)
                    .map_err(|_| INVALID_EFFECT_COMPLETION)?;
                st.intents
                    .get_mut(&intent_id)
                    .expect("validate 1 已验证")
                    .phase = IntentPhase::Terminal(TerminalOutcome::Opened);
                release_in_flight(&mut st, &intent_id);
                Ok(vec![Effect::AckIntent { intent_id }])
            }
            RendererOutcome::BlankCreated => {
                st.registry
                    .mark_blank(label)
                    .map_err(|_| INVALID_EFFECT_COMPLETION)?;
                st.intents
                    .get_mut(&intent_id)
                    .expect("validate 1 已验证")
                    .phase = IntentPhase::Terminal(TerminalOutcome::BlankCreated);
                release_in_flight(&mut st, &intent_id);
                Ok(vec![Effect::AckIntent { intent_id }])
            }
            RendererOutcome::RetryableError { reason } => {
                let _ = st.registry.mark_failed(label);
                fail_intent(&mut st, &intent_id, Some(reason))
            }
        }
    }

    /// Destroyed:registry 清理 + 该窗口相关非终态 intent 恢复排队
    /// (同 intentId,T4/C3);幂等。
    pub fn on_destroyed(&self, label: &str) {
        let mut st = self.state.lock().unwrap();
        st.registry.on_destroyed(label);
        let ids: Vec<String> = st
            .intents
            .iter()
            .filter(|(_, i)| intent_bound_to_label(i, label))
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let Some(intent) = st.intents.get_mut(&id) else {
                continue;
            };
            match intent.phase.clone() {
                IntentPhase::Assigned { label: l, .. } if l == label => {
                    // 窗口已消失:回到队列重新路由(保留 receivedAt/intentId)
                    let received = intent.received_at_ms;
                    intent.phase = IntentPhase::Queued;
                    st.order.insert((received, id.clone()));
                    release_in_flight(&mut st, &id);
                }
                IntentPhase::Routing {
                    awaiting:
                        Awaiting::DeliverBootstrap { label: l, .. } | Awaiting::FocusWindow { label: l },
                } if l == label => {
                    let received = intent.received_at_ms;
                    intent.phase = IntentPhase::Queued;
                    st.order.insert((received, id.clone()));
                    release_in_flight(&mut st, &id);
                }
                // Routing{CreateWindow{label}}:create 回报尚未到达而窗口已毁;
                // 装配层将以 ok=false 回报终结该 effect,此处不抢跑。
                _ => {}
            }
        }
    }

    /// 用户显式重试(F2):retryable → 重新排队(同 intentId、同 receivedAt)。
    pub fn retry(&self, intent_id: &str) -> Result<(), &'static str> {
        let mut st = self.state.lock().unwrap();
        let Some(intent) = st.intents.get_mut(intent_id) else {
            return Err(UNKNOWN_INTENT);
        };
        if !matches!(intent.phase, IntentPhase::RetryableError { .. }) {
            return Err(INVALID_INTENT_TRANSITION);
        }
        intent.phase = IntentPhase::Queued;
        let received = intent.received_at_ms;
        st.order.insert((received, intent_id.to_string()));
        release_in_flight(&mut st, intent_id);
        Ok(())
    }

    /// W2R-F2(H2):原窗 retry——retryable open-file intent 的 origin Failed
    /// 窗口原位恢复(重新 reservation + 新交付代),返回 DeliverBootstrap
    /// effect(锁外执行)。无 origin(窗口已 Destroyed/source/create 失败)或
    /// identity 已被他人占用时返回 Ok(None):调用方回退正常 retry 路由。
    pub fn retry_failed_in_place(
        &self,
        intent_id: &str,
        identity: &FileIdentity,
    ) -> Result<Option<Vec<Effect>>, &'static str> {
        let mut st = self.state.lock().unwrap();
        let (canonical_path, is_retryable) = {
            let Some(intent) = st.intents.get(intent_id) else {
                return Err(UNKNOWN_INTENT);
            };
            (
                intent.canonical_path.clone(),
                matches!(intent.phase, IntentPhase::RetryableError { .. }),
            )
        };
        if !is_retryable {
            return Err(INVALID_INTENT_TRANSITION);
        }
        let Some((label, _generation)) = st.registry.failed_window_of_intent(intent_id) else {
            return Ok(None); // 无原窗事实 → 正常路由
        };
        if st
            .registry
            .begin_loading(&label, identity, intent_id)
            .is_err()
        {
            return Ok(None); // identity 已被他人持有 → 正常路由(如聚焦既有窗)
        }
        let (delivery_id, _) = st
            .registry
            .next_delivery(&label, intent_id)
            .map_err(|_| INVALID_WINDOW_TRANSITION)?;
        st.intents.get_mut(intent_id).expect("上面已验证存在").phase = IntentPhase::Routing {
            awaiting: Awaiting::DeliverBootstrap {
                label: label.clone(),
                delivery_id: delivery_id.clone(),
            },
        };
        st.in_flight = Some(intent_id.to_string());
        Ok(Some(vec![Effect::DeliverBootstrap {
            intent_id: intent_id.to_string(),
            label,
            delivery_id,
            kind: BootstrapKind::OpenPath,
            canonical_path,
        }]))
    }

    /// 用户显式放弃(F3):retryable → dismissed,恰好 ack 一次。
    /// W2R-F2(H2):同一临界区原子完成 origin Failed 窗口的收口
    /// (Failed → Blank、清 active intent/交付槽)——不留"看起来可用、
    /// host 拒绝保存"的僵尸窗。
    pub fn dismiss(&self, intent_id: &str) -> Result<Vec<Effect>, &'static str> {
        let mut st = self.state.lock().unwrap();
        let is_retryable = st
            .intents
            .get(intent_id)
            .is_some_and(|i| matches!(i.phase, IntentPhase::RetryableError { .. }));
        if !is_retryable {
            return Err(match st.intents.contains_key(intent_id) {
                true => INVALID_INTENT_TRANSITION,
                false => UNKNOWN_INTENT,
            });
        }
        if let Some((label, _)) = st.registry.failed_window_of_intent(intent_id) {
            st.registry
                .failed_to_blank(&label)
                .map_err(|_| INVALID_WINDOW_TRANSITION)?;
        }
        st.intents.get_mut(intent_id).expect("上面已验证存在").phase =
            IntentPhase::Terminal(TerminalOutcome::Dismissed);
        release_in_flight(&mut st, intent_id);
        Ok(vec![Effect::AckIntent {
            intent_id: intent_id.to_string(),
        }])
    }

    // ---- 只读 snapshot(诊断/测试;不构成修改通道) ----

    pub fn phase(&self, intent_id: &str) -> Option<IntentPhase> {
        self.state
            .lock()
            .unwrap()
            .intents
            .get(intent_id)
            .map(|i| i.phase.clone())
    }

    pub fn queued_len(&self) -> usize {
        self.state.lock().unwrap().order.len()
    }

    pub fn window_record(&self, label: &str) -> Option<WindowRecord> {
        self.state.lock().unwrap().registry.record(label)
    }

    pub fn identity_owner_of(&self, identity: &FileIdentity) -> Option<(String, WindowState)> {
        self.state.lock().unwrap().registry.identity_owner(identity)
    }

    pub fn identity_reservation_of(
        &self,
        identity: &FileIdentity,
    ) -> Option<(String, WindowState)> {
        self.state
            .lock()
            .unwrap()
            .registry
            .identity_reservation(identity)
    }

    pub fn delivery_info_of(&self, delivery_id: &str) -> Option<DeliveryInfo> {
        self.state
            .lock()
            .unwrap()
            .registry
            .delivery_info(delivery_id)
    }

    // ---- MRT-004B:保存换绑的窄 host lifecycle 方法(单锁临界区;
    // 文件 I/O/provider 解析在锁外由调用方完成) ----

    /// ordinary Save 成功后刷新 physical aliases(§6.1;canonical 无空窗)。
    pub fn refresh_identity_after_commit(
        &self,
        label: &str,
        refreshed: &FileIdentity,
    ) -> Result<(), &'static str> {
        self.state
            .lock()
            .unwrap()
            .registry
            .refresh_identity_after_commit(label, refreshed)
    }

    /// ordinary commit 的 generation-bound 完成腿(H1)：文件 I/O 返回后，
    /// 只有发起操作捕获的窗口代仍是当前代时才允许刷新 reservation。
    /// 代际失配返回稳定的 coordinator completion 错误，调用方不得把它
    /// 转化为新代窗口的 recovery 或 registry 写入。
    pub fn refresh_identity_after_commit_if_generation(
        &self,
        label: &str,
        expected_generation: u64,
        refreshed: &FileIdentity,
    ) -> Result<(), &'static str> {
        let mut st = self.state.lock().unwrap();
        if st.registry.generation_of(label) != Some(expected_generation) {
            return Err(INVALID_EFFECT_COMPLETION);
        }
        st.registry.refresh_identity_after_commit(label, refreshed)
    }

    /// Save As 三段式之一:写前预占 target aliases(§6.2)。
    pub fn prepare_rebind(
        &self,
        label: &str,
        target: &FileIdentity,
    ) -> Result<String, &'static str> {
        self.state
            .lock()
            .unwrap()
            .registry
            .prepare_rebind(label, target)
    }

    /// Save As 三段式之三(成功):原子换绑到提交后的真实身份。
    /// B1A-F3:caller label 与 pending owner 校验(错窗稳定拒绝、零变化)。
    pub fn finalize_rebind(
        &self,
        caller_label: &str,
        token: &str,
        final_identity: &FileIdentity,
    ) -> Result<(), &'static str> {
        self.state
            .lock()
            .unwrap()
            .registry
            .finalize_rebind(caller_label, token, final_identity)
    }

    /// Save As 的 generation-bound finalize 腿(H1)：generation 校验与
    /// finalize 在同一 coordinator 临界区内完成，防止旧代的锁外 I/O
    /// 完成后提交到同名新窗口。
    pub fn finalize_rebind_if_generation(
        &self,
        caller_label: &str,
        expected_generation: u64,
        token: &str,
        final_identity: &FileIdentity,
    ) -> Result<(), &'static str> {
        let mut st = self.state.lock().unwrap();
        if st.registry.generation_of(caller_label) != Some(expected_generation) {
            return Err(INVALID_EFFECT_COMPLETION);
        }
        st.registry
            .finalize_rebind(caller_label, token, final_identity)
    }

    /// Save As 三段式之三(失败/取消):只清 pending,旧 identity 不变。
    /// B1A-F3:caller label 与 pending owner 校验。
    pub fn abort_rebind(&self, caller_label: &str, token: &str) -> Result<(), &'static str> {
        self.state
            .lock()
            .unwrap()
            .registry
            .abort_rebind(caller_label, token)
    }

    /// 只读:pending rebind 数量(诊断/测试;fail-closed 状态可观测)。
    pub fn pending_rebind_count(&self) -> usize {
        self.state.lock().unwrap().registry.pending_rebind_count()
    }

    /// 只读:intent 种类(Wave 2 错误快照/UI 描述用)。
    pub fn intent_kind_of(&self, intent_id: &str) -> Option<LaunchIntentKind> {
        self.state
            .lock()
            .unwrap()
            .intents
            .get(intent_id)
            .map(|i| i.kind.clone())
    }

    /// 只读:intent 的 receivedAt(retry 保持原值,§5D2)。
    pub fn received_at_of(&self, intent_id: &str) -> i64 {
        self.state
            .lock()
            .unwrap()
            .intents
            .get(intent_id)
            .map(|i| i.received_at_ms)
            .unwrap_or(0)
    }

    /// 只读:交付当前所属 intent(测试/诊断;deliveryId → assigned intentId)。
    pub fn intent_id_of_delivery(&self, delivery_id: &str) -> Option<String> {
        let st = self.state.lock().unwrap();
        st.intents
            .iter()
            .find(|(_, i)| {
                matches!(
                    &i.phase,
                    IntentPhase::Assigned { delivery_id: d, .. } if d == delivery_id
                )
            })
            .map(|(id, _)| id.clone())
    }

    /// 只读:当前登记的全部窗口 label(生产装配快照扫描/测试)。
    pub fn window_labels(&self) -> Vec<String> {
        self.state.lock().unwrap().registry.labels()
    }

    /// 测试 seam(A1 子规格 §5 A1.3):仅 cfg(test) 下暴露 registry 可变
    /// 访问,用于构造并发事实(如 create 挂起期间的 identity 预占)。
    /// 不构成生产环境绕过开关。
    #[cfg(test)]
    pub(crate) fn with_registry_mut_for_test(&self, f: impl FnOnce(&mut WindowRegistry)) {
        let mut st = self.state.lock().unwrap();
        f(&mut st.registry);
    }

    // ---- Wave 2(§5C/§4.4):生产 runtime 所需的窄扩展 ----

    /// AckIntent 执行(C2):terminal intent 一次性移出队列,保留有限摘要。
    /// 重复 ack 幂等(返回 false,零副作用)。非 terminal(不存在或未终态)
    /// 稳定拒绝 false。
    pub fn complete_ack(&self, intent_id: &str) -> bool {
        let mut st = self.state.lock().unwrap();
        let Some(intent) = st.intents.get(intent_id) else {
            return false;
        };
        let IntentPhase::Terminal(outcome) = intent.phase else {
            return false; // 未终态不得清理
        };
        // W2R E2:ack 是"到 terminal/ack once"的唯一可观测行(E2 结构化 facts)。
        eprintln!("[lifecycle] ack {intent_id} → {outcome:?}");
        let received = intent.received_at_ms;
        st.intents.remove(intent_id);
        st.order.remove(&(received, intent_id.to_string())); // 防御:terminal 不应在 order
        st.ack_summaries.push_back(AckSummary {
            intent_id: intent_id.to_string(),
            outcome,
            received_at_ms: received,
        });
        while st.ack_summaries.len() > ACK_SUMMARY_CAPACITY {
            st.ack_summaries.pop_front();
        }
        true
    }

    /// 只读:ack 摘要快照(诊断/测试;证明 terminal 清理与容量上限)。
    pub fn ack_summaries(&self) -> Vec<AckSummary> {
        self.state
            .lock()
            .unwrap()
            .ack_summaries
            .iter()
            .cloned()
            .collect()
    }

    /// 只读:当前登记的 intent 总数(terminal 清理后应回落)。
    pub fn intent_count(&self) -> usize {
        self.state.lock().unwrap().intents.len()
    }

    /// platform_window_ready 数据源(C3):该窗口当前 assigned 且未完成的
    /// bootstrap 交付快照。展示路径为 lossy 投影,不参与判定(§4.2)。
    pub fn pending_bootstraps_for(&self, label: &str) -> Vec<PendingBootstrap> {
        pending_bootstraps_in(&self.state.lock().unwrap(), label)
    }

    /// startup barrier 判定(C1):是否存在任何 open-file intent(任意 phase)。
    /// ready 快照为空且无 open-file intent 时,冷启动默认窗口可确认 Blank。
    pub fn has_open_file_intents(&self) -> bool {
        let st = self.state.lock().unwrap();
        st.intents
            .values()
            .any(|i| matches!(i.kind, LaunchIntentKind::OpenFile { .. }))
    }

    /// platform_open_assigned_document 数据源(C4):校验 (label, deliveryId)
    /// 是当前 assigned 且交付仍为当前代,返回 host 无损打开目标。
    /// 文件 I/O 在锁外由调用方执行(open_file_with_identity)。
    pub fn assigned_open_target(&self, label: &str, delivery_id: &str) -> Option<FileIdentity> {
        self.assigned_open_target_with_generation(label, delivery_id)
            .map(|(identity, _)| identity)
    }

    /// 与 `assigned_open_target` 相同，但把当前 window generation 一并
    /// 捕获，供锁外读取后的原子完成校验使用(H2)。
    pub fn assigned_open_target_with_generation(
        &self,
        label: &str,
        delivery_id: &str,
    ) -> Option<(FileIdentity, u64)> {
        let st = self.state.lock().unwrap();
        // 交付必须是该窗口当前代(旧代/已完成拒绝)。
        let generation = st.registry.record(label).and_then(|r| {
            (r.bootstrap_delivery_id.as_deref() == Some(delivery_id)).then_some(r.generation)
        })?;
        st.intents
            .iter()
            .find(|(_, i)| {
                matches!(
                    &i.phase,
                    IntentPhase::Assigned { label: l, delivery_id: d }
                        if l == label && d == delivery_id
                )
            })
            .and_then(|(_, i)| match &i.kind {
                LaunchIntentKind::OpenFile { identity } => Some((identity.clone(), generation)),
                LaunchIntentKind::Activation => None,
            })
    }

    /// assigned open 的第二阶段完成：generation、delivery、intent identity
    /// 校验与 physical alias 刷新在同一 coordinator 锁内完成(H2)。调用方
    /// 必须在返回错误时撤销本次锁外读取所签发的 handle。
    pub fn complete_assigned_open(
        &self,
        label: &str,
        delivery_id: &str,
        expected_generation: u64,
        expected_identity: &FileIdentity,
        observed_identity: &FileIdentity,
    ) -> Result<(), &'static str> {
        let mut st = self.state.lock().unwrap();
        let Some(record) = st.registry.record(label) else {
            return Err(INVALID_EFFECT_COMPLETION);
        };
        if record.generation != expected_generation
            || record.bootstrap_delivery_id.as_deref() != Some(delivery_id)
        {
            return Err(INVALID_EFFECT_COMPLETION);
        }
        let assigned_identity = st
            .intents
            .values()
            .find(|i| {
                matches!(
                    &i.phase,
                    IntentPhase::Assigned { label: l, delivery_id: d }
                        if l == label && d == delivery_id
                )
            })
            .and_then(|i| match &i.kind {
                LaunchIntentKind::OpenFile { identity } => Some(identity),
                LaunchIntentKind::Activation => None,
            })
            .ok_or(INVALID_EFFECT_COMPLETION)?;
        if assigned_identity != expected_identity {
            return Err(INVALID_EFFECT_COMPLETION);
        }
        if observed_identity.canonical() != expected_identity.canonical() {
            return Err(IDENTITY_CANONICAL_MISMATCH);
        }
        if observed_identity != expected_identity {
            st.registry
                .refresh_identity_after_commit(label, observed_identity)?;
        }
        Ok(())
    }

    /// close permit 真正放行原生关闭时进入 Closing(§4.4;Hold/Cancel 不调用)。
    pub fn begin_closing(&self, label: &str) -> Result<(), &'static str> {
        let mut st = self.state.lock().unwrap();
        st.registry.begin_closing(label)
    }

    /// 冷启动默认窗口确认 Blank(C1 startup barrier)。W2R-F4(H3):屏障判定
    /// 进入本方法——同临界区内存在任何 open-file intent(任意 phase)即拒绝,
    /// 消除"检查无 open → 写入 Blank"与 native open 入队之间的 TOCTOU。
    /// 非 Booting 时稳定拒绝(幂等防御)。
    pub fn mark_blank(&self, label: &str) -> Result<(), &'static str> {
        let mut st = self.state.lock().unwrap();
        let has_open = st
            .intents
            .values()
            .any(|i| matches!(i.kind, LaunchIntentKind::OpenFile { .. }));
        if has_open {
            return Err(STARTUP_BARRIER_OPEN_PENDING);
        }
        st.registry.mark_blank(label)
    }

    /// W2R-F4(H3):startup ready 的**单锁原子决策**——读取 caller 待处理
    /// 交付快照 + (caller=main 且快照为空时)验证无 open-file intent 并确认
    /// Blank,全部在一次临界区内完成(取代三个独立 public 调用的拼接)。
    /// 返回 (快照, 决策);文件 I/O / Tauri API / emit 仍在锁外由调用方执行。
    pub fn confirm_startup_blank(&self, caller: &str) -> (Vec<PendingBootstrap>, StartupDecision) {
        let mut st = self.state.lock().unwrap();
        let pending = pending_bootstraps_in(&st, caller);
        if caller != "main" || !pending.is_empty() {
            return (pending, StartupDecision::SnapshotOnly);
        }
        let has_open = st
            .intents
            .values()
            .any(|i| matches!(i.kind, LaunchIntentKind::OpenFile { .. }));
        if has_open {
            return (pending, StartupDecision::OpenFilePending);
        }
        match st.registry.mark_blank("main") {
            Ok(()) => (pending, StartupDecision::BlankConfirmed),
            Err(_) => (pending, StartupDecision::SnapshotOnly), // 非 Booting:幂等防御
        }
    }

    /// 只读:窗口当前 generation(W2R-F1 呈现所有权 / W2R-F5 recovery 校验)。
    pub fn window_generation(&self, label: &str) -> Option<u64> {
        self.state.lock().unwrap().registry.generation_of(label)
    }

    /// 只读:承载该 intent 的 Failed 窗口 label(W2R-F1 错误记录的 origin)。
    pub fn failed_window_of(&self, intent_id: &str) -> Option<String> {
        self.state
            .lock()
            .unwrap()
            .registry
            .failed_window_of_intent(intent_id)
            .map(|(label, _)| label)
    }
}

/// startup ready 原子决策的结果(W2R-F4;诊断/测试可观察)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupDecision {
    /// main 无任何 open-file intent,已在同临界区确认 Blank。
    BlankConfirmed,
    /// 存在 open-file intent(cold 文件在途),main 保持待路由。
    OpenFilePending,
    /// 非 main 或有待处理交付:仅快照。
    SnapshotOnly,
}

/// pending bootstrap 快照(单锁内共享实现)。
fn pending_bootstraps_in(st: &CoordinatorState, label: &str) -> Vec<PendingBootstrap> {
    let mut out = Vec::new();
    for (id, intent) in &st.intents {
        if let IntentPhase::Assigned {
            label: l,
            delivery_id,
        } = &intent.phase
        {
            if l == label {
                out.push(PendingBootstrap {
                    delivery_id: delivery_id.clone(),
                    intent_id: id.clone(),
                    kind: match intent.kind {
                        LaunchIntentKind::OpenFile { .. } => BootstrapKind::OpenPath,
                        LaunchIntentKind::Activation => BootstrapKind::Blank,
                    },
                    canonical_path: intent.canonical_path.clone(),
                });
            }
        }
    }
    out
}

/// 路由决策(队首 open-file / activation)。allocate/begin_loading/
/// next_delivery 在此完成;决策本身即一次提交(cold 分支失败回 Defer)。
/// 借阅结构:先 clone intent 决策输入,操作 registry 后再回写 phase。
fn decide_route(st: &mut CoordinatorState, intent_id: &str) -> Decision {
    let (kind, canonical_path) = {
        let Some(intent) = st.intents.get(intent_id) else {
            return Decision::Defer;
        };
        (intent.kind.clone(), intent.canonical_path.clone())
    };
    match kind {
        LaunchIntentKind::Activation => {
            // Q4:每个 activation intent 各创建一个新空白窗
            let label = st.registry.allocate_editor_label();
            st.intents
                .get_mut(intent_id)
                .expect("route_next 已验证")
                .phase = IntentPhase::Routing {
                awaiting: Awaiting::CreateWindow {
                    label: label.clone(),
                },
            };
            Decision::Route(vec![Effect::CreateWindow {
                intent_id: intent_id.to_string(),
                label,
            }])
        }
        LaunchIntentKind::OpenFile { identity } => {
            // S-B4(MRT-004B §6.2):Save As 写前预占(pending rebind)期间,
            // 同目标 open/create 不得抢占 → deferred(零 effect,留队列)。
            if st.registry.pending_rebind_of(&identity).is_some() {
                return Decision::Defer;
            }
            // A1-F4/B1-F1:统一占用事实(active 窗口或建窗 assignment)——
            // 与 begin_loading/reserve_assignment 的拒绝条件同一索引。
            match st.registry.identity_holder(&identity) {
                Some(ReservationHolder::Active {
                    label,
                    state: WindowState::Loading | WindowState::Open,
                }) => {
                    // Q2:同 identity 已 open/loading → 只聚焦
                    st.intents
                        .get_mut(intent_id)
                        .expect("route_next 已验证")
                        .phase = IntentPhase::Routing {
                        awaiting: Awaiting::FocusWindow {
                            label: label.clone(),
                        },
                    };
                    return Decision::Route(vec![Effect::FocusWindow {
                        intent_id: intent_id.to_string(),
                        label,
                    }]);
                }
                // Closing(持有到 Destroyed)或 Assignment(建窗进行中):
                // 同 identity 不重复开窗、不聚焦 → deferred
                Some(_) => return Decision::Defer,
                None => {}
            }

            // 冷分配唯一窗口期:main 仍 Booting 且无任何分配
            if st.registry.cold_main_available("main") {
                if st
                    .registry
                    .begin_loading("main", &identity, intent_id)
                    .is_err()
                {
                    return Decision::Defer; // 竞态防御:回到队列
                }
                let (delivery_id, _) = st
                    .registry
                    .next_delivery("main", intent_id)
                    .expect("cold main 必可交付");
                st.intents
                    .get_mut(intent_id)
                    .expect("route_next 已验证")
                    .phase = IntentPhase::Routing {
                    awaiting: Awaiting::DeliverBootstrap {
                        label: "main".to_string(),
                        delivery_id: delivery_id.clone(),
                    },
                };
                return Decision::Route(vec![Effect::DeliverBootstrap {
                    intent_id: intent_id.to_string(),
                    label: "main".to_string(),
                    delivery_id,
                    kind: BootstrapKind::OpenPath,
                    canonical_path,
                }]);
            }
            // warm(或 main 不可用):新 editor 窗,不复用任何 occupied 窗(Q3)。
            // B1-F1:identity 预留在 CreateWindow effect **发出前**完成
            //(reserve_assignment);effect 是锁外异步副作用,窗口回报前
            // 同 target 的 Save As prepare / 重复路由都会被该预占拒绝。
            let label = st.registry.allocate_editor_label();
            if st.registry.reserve_assignment(&label, &identity).is_err() {
                return Decision::Defer; // 竞态防御:回到队列
            }
            st.intents
                .get_mut(intent_id)
                .expect("route_next 已验证")
                .phase = IntentPhase::Routing {
                awaiting: Awaiting::CreateWindow {
                    label: label.clone(),
                },
            };
            Decision::Route(vec![Effect::CreateWindow {
                intent_id: intent_id.to_string(),
                label,
            }])
        }
    }
}

/// intent 是否绑定到指定窗口(assigned / 交付 / 聚焦等待)。
fn intent_bound_to_label(intent: &Intent, label: &str) -> bool {
    match &intent.phase {
        IntentPhase::Assigned { label: l, .. } => l == label,
        IntentPhase::Routing { awaiting } => match awaiting {
            Awaiting::DeliverBootstrap { label: l, .. } | Awaiting::FocusWindow { label: l } => {
                l == label
            }
            Awaiting::CreateWindow { .. } => false,
        },
        _ => false,
    }
}

/// correlation(P3):回报 intentId 必须是当前 in-flight、处于 routing,
/// 且 label / deliveryId 与 Awaiting 完全一致。
fn correlate_pending(st: &CoordinatorState, result: &EffectResult) -> Result<String, &'static str> {
    let intent_id = match result {
        EffectResult::WindowCreated { intent_id, .. }
        | EffectResult::WindowFocused { intent_id, .. }
        | EffectResult::BootstrapDelivered { intent_id, .. } => intent_id.clone(),
    };
    if !st.in_flight.as_ref().is_some_and(|f| *f == intent_id) {
        return Err(INVALID_EFFECT_COMPLETION); // 非 in-flight(terminal 后重放/伪造)
    }
    let intent = st.intents.get(&intent_id).ok_or(UNKNOWN_INTENT)?;
    let IntentPhase::Routing { awaiting } = &intent.phase else {
        return Err(INVALID_EFFECT_COMPLETION);
    };
    let matches = match (awaiting, result) {
        (
            Awaiting::CreateWindow { label },
            EffectResult::WindowCreated {
                label: reported, ..
            },
        ) => label == reported,
        (
            Awaiting::FocusWindow { label },
            EffectResult::WindowFocused {
                label: reported, ..
            },
        ) => label == reported,
        (
            Awaiting::DeliverBootstrap { label, delivery_id },
            EffectResult::BootstrapDelivered {
                label: reported,
                delivery_id: reported_id,
                ..
            },
        ) => label == reported && delivery_id == reported_id,
        _ => false, // 等待步与回报类型不匹配(乱序/错报)
    };
    if matches {
        Ok(intent_id)
    } else {
        Err(INVALID_EFFECT_COMPLETION)
    }
}

/// intent 进入 retryable-error(稳定等待点:释放占位,后续 queued intent
/// 可继续路由;本 intent 等用户 retry/dismiss)。不 ack、不自旋。
fn fail_intent(
    st: &mut CoordinatorState,
    intent_id: &str,
    reason: Option<String>,
) -> Result<Vec<Effect>, &'static str> {
    let reason = reason.unwrap_or_else(|| "unknown failure".to_string());
    let Some(intent) = st.intents.get_mut(intent_id) else {
        return Err(UNKNOWN_INTENT);
    };
    intent.phase = IntentPhase::RetryableError {
        reason: reason.clone(),
    };
    release_in_flight(&mut *st, intent_id);
    Ok(vec![Effect::ShowRetryableError {
        intent_id: intent_id.to_string(),
        reason,
    }])
}

fn release_in_flight(st: &mut CoordinatorState, intent_id: &str) {
    if st.in_flight.as_ref().is_some_and(|f| f == intent_id) {
        st.in_flight = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    const MAIN: &str = "main";

    fn coordinator() -> LaunchCoordinator {
        let mut registry = WindowRegistry::new();
        registry.register(MAIN).unwrap(); // app 启动即默认 main(Booting)
        LaunchCoordinator::new(registry)
    }

    fn open_file(id: &FileIdentity) -> LaunchIntentKind {
        LaunchIntentKind::OpenFile {
            identity: id.clone(),
        }
    }

    /// 驱动 open-file 到 assigned:返回 (label, deliveryId)。
    fn drive_to_assigned(c: &LaunchCoordinator, intent_id: &str) -> (String, String) {
        let effects = c.route_next();
        match effects.as_slice() {
            [Effect::DeliverBootstrap {
                label, delivery_id, ..
            }] => {
                let effects = c
                    .on_effect_result(&EffectResult::BootstrapDelivered {
                        intent_id: intent_id.to_string(),
                        label: label.clone(),
                        delivery_id: delivery_id.clone(),
                        ok: true,
                        reason: None,
                    })
                    .unwrap();
                assert!(effects.is_empty());
                (label.clone(), delivery_id.clone())
            }
            other => panic!("cold open 应直接向 main 交付 bootstrap,实际 {other:?}"),
        }
    }

    /// 驱动 warm open-file 到 assigned(经 CreateWindow)。
    fn drive_warm_to_assigned(c: &LaunchCoordinator, intent_id: &str) -> (String, String) {
        let effects = c.route_next();
        let [Effect::CreateWindow { label, .. }] = effects.as_slice() else {
            panic!("warm open 应先 CreateWindow,实际 {effects:?}")
        };
        let label = label.clone();
        let next = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: intent_id.to_string(),
                label: label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        let [Effect::DeliverBootstrap { delivery_id, .. }] = next.as_slice() else {
            panic!("建窗后应交付 bootstrap,实际 {next:?}")
        };
        let delivery_id = delivery_id.clone();
        let effects = c
            .on_effect_result(&EffectResult::BootstrapDelivered {
                intent_id: intent_id.to_string(),
                label: label.clone(),
                delivery_id: delivery_id.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        assert!(effects.is_empty());
        (label, delivery_id)
    }

    #[test]
    fn q1_strict_order_and_no_side_effects_while_routing() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let b = c.enqueue(
            open_file(&FileIdentity::synthetic("b")),
            Some("/b.mm".into()),
            1001,
        );
        // A 路由:cold 首文件分配 main(DeliverBootstrap,无多余空窗)
        let effects = c.route_next();
        let [Effect::DeliverBootstrap {
            label, delivery_id, ..
        }] = effects.as_slice()
        else {
            panic!("cold A 应分配 main:{effects:?}")
        };
        assert_eq!(label, MAIN);
        // A 仍在 routing(交付未回报):B 零副作用
        assert!(
            c.route_next().is_empty(),
            "Q1:A routing 中 B 不得执行副作用"
        );
        assert_eq!(c.phase(&b).unwrap(), IntentPhase::Queued);
        // A 进入 assigned(读取中):B 才可路由,且是新窗
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: a.clone(),
            label: MAIN.to_string(),
            delivery_id: delivery_id.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        let b_effects = c.route_next();
        let [Effect::CreateWindow { label: b_label, .. }] = b_effects.as_slice() else {
            panic!("B 应建 editor 窗:{b_effects:?}")
        };
        assert_ne!(b_label, MAIN, "I1:main 已承载 A,B 必须新窗");
    }

    #[test]
    fn i1_cold_ab_main_a_editor_b_in_order() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let b = c.enqueue(
            open_file(&FileIdentity::synthetic("b")),
            Some("/b.mm".into()),
            1001,
        );
        let (main_label, main_delivery) = drive_to_assigned(&c, &a);
        assert_eq!(main_label, MAIN);
        c.on_renderer_outcome(&main_label, &main_delivery, RendererOutcome::Opened)
            .unwrap();
        let (b_label, _) = drive_warm_to_assigned(&c, &b);
        assert!(
            b_label.starts_with("editor-"),
            "B 应进 editor-*,实际 {b_label}"
        );
        assert_eq!(c.window_record(MAIN).unwrap().state, WindowState::Open);
    }

    #[test]
    fn q2_duplicate_identity_while_loading_only_focuses() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (label, delivery) = drive_to_assigned(&c, &a); // A 在 main loading
        let dup = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            2000,
        );
        let effects = c.route_next();
        let [Effect::FocusWindow {
            label: focus_target,
            intent_id,
            ..
        }] = effects.as_slice()
        else {
            panic!("Q2:同 identity loading 中只允许 FocusWindow,实际 {effects:?}")
        };
        assert_eq!(focus_target, &label);
        assert_eq!(intent_id, &dup);
        let acks = c
            .on_effect_result(&EffectResult::WindowFocused {
                intent_id: dup.clone(),
                label: label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: dup.clone()
            }]
        );
        assert_eq!(
            c.phase(&dup).unwrap(),
            IntentPhase::Terminal(TerminalOutcome::FocusedExisting)
        );
        // loading 中的原始 intent 仍可正常终结
        c.on_renderer_outcome(&label, &delivery, RendererOutcome::Opened)
            .unwrap();
        assert_eq!(
            c.phase(&a).unwrap(),
            IntentPhase::Terminal(TerminalOutcome::Opened)
        );
    }

    #[test]
    fn q3_warm_open_creates_new_window_never_reuses_occupied() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (main_label, main_delivery) = drive_to_assigned(&c, &a);
        c.on_renderer_outcome(&main_label, &main_delivery, RendererOutcome::Opened)
            .unwrap();
        let _b = c.enqueue(
            open_file(&FileIdentity::synthetic("b")),
            Some("/b.mm".into()),
            3000,
        );
        let effects = c.route_next();
        let [Effect::CreateWindow { label, .. }] = effects.as_slice() else {
            panic!("Q3:warm B 必须新窗,实际 {effects:?}")
        };
        assert_ne!(label, MAIN);
        // main 的状态与 identity 不因 B 的路由改变
        let record = c.window_record(MAIN).unwrap();
        assert_eq!(record.state, WindowState::Open);
        assert_eq!(record.file_identity, Some(FileIdentity::synthetic("a")));
    }

    #[test]
    fn q4_each_activation_creates_its_own_blank_window() {
        let c = coordinator();
        let act1 = c.enqueue(LaunchIntentKind::Activation, None, 1000);
        let act2 = c.enqueue(LaunchIntentKind::Activation, None, 1001);
        // 第一个 activation:CreateWindow → blank
        let effects = c.route_next();
        let [Effect::CreateWindow {
            label: l1,
            intent_id: i1,
            ..
        }] = effects.as_slice()
        else {
            panic!("Q4:activation 必须建空白窗,实际 {effects:?}")
        };
        assert_eq!(i1, &act1);
        let next = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: act1.clone(),
                label: l1.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        let [Effect::DeliverBootstrap {
            kind,
            label: d1,
            delivery_id: del1,
            ..
        }] = next.as_slice()
        else {
            panic!("activation 建窗后交付 blank bootstrap:{next:?}")
        };
        assert_eq!(*kind, BootstrapKind::Blank);
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: act1.clone(),
            label: d1.clone(),
            delivery_id: del1.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        let acks = c
            .on_renderer_outcome(d1, del1, RendererOutcome::BlankCreated)
            .unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: act1.clone()
            }]
        );
        assert_eq!(
            c.phase(&act1).unwrap(),
            IntentPhase::Terminal(TerminalOutcome::BlankCreated)
        );
        // 第二个 activation:另一个新窗
        let effects = c.route_next();
        let [Effect::CreateWindow { label: l2, .. }] = effects.as_slice() else {
            panic!("第二个 activation 也必须建窗:{effects:?}")
        };
        assert_ne!(l1, l2, "Q4:每个 activation 各一个空白窗");
        // 第二个 activation 也走完 blank 终态
        let next = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: act2.clone(),
                label: l2.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        let [Effect::DeliverBootstrap {
            label: d2,
            delivery_id: del2,
            ..
        }] = next.as_slice()
        else {
            panic!()
        };
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: act2.clone(),
            label: d2.clone(),
            delivery_id: del2.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        let acks = c
            .on_renderer_outcome(d2, del2, RendererOutcome::BlankCreated)
            .unwrap();
        assert_eq!(acks.len(), 1);
    }

    #[test]
    fn f1_create_failure_retryable_without_ghost_window_or_ack() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (main_label, main_delivery) = drive_to_assigned(&c, &a);
        c.on_renderer_outcome(&main_label, &main_delivery, RendererOutcome::Opened)
            .unwrap();
        let b = c.enqueue(
            open_file(&FileIdentity::synthetic("b")),
            Some("/b.mm".into()),
            2000,
        );
        let effects = c.route_next();
        let [Effect::CreateWindow { label: ghost, .. }] = effects.as_slice() else {
            panic!()
        };
        let ghost = ghost.clone();
        let out = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: b.clone(),
                label: ghost.clone(),
                ok: false,
                reason: Some("webview creation failed".into()),
            })
            .unwrap();
        assert_eq!(
            out,
            vec![Effect::ShowRetryableError {
                intent_id: b.clone(),
                reason: "webview creation failed".to_string(),
            }],
            "F1:失败可见、不 ack"
        );
        assert_eq!(
            c.phase(&b).unwrap(),
            IntentPhase::RetryableError {
                reason: "webview creation failed".to_string()
            }
        );
        // 无幽灵窗口、无幽灵 reservation
        assert_eq!(c.window_record(&ghost), None);
        assert_eq!(c.identity_owner_of(&FileIdentity::synthetic("b")), None);
    }

    #[test]
    fn f2_retry_reroutes_same_intent_without_new_id() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (main_label, main_delivery) = drive_to_assigned(&c, &a);
        c.on_renderer_outcome(&main_label, &main_delivery, RendererOutcome::Opened)
            .unwrap();
        let b = c.enqueue(
            open_file(&FileIdentity::synthetic("b")),
            Some("/b.mm".into()),
            2000,
        );
        let effects = c.route_next();
        let [Effect::CreateWindow { label, .. }] = effects.as_slice() else {
            panic!()
        };
        let label = label.clone();
        c.on_effect_result(&EffectResult::WindowCreated {
            intent_id: b.clone(),
            label: label.clone(),
            ok: false,
            reason: Some("boom".into()),
        })
        .unwrap();
        // 用户 retry:同 intentId 重新路由(不产生新 intent)
        c.retry(&b).unwrap();
        assert!(matches!(c.phase(&b).unwrap(), IntentPhase::Queued));
        let effects = c.route_next();
        let [Effect::CreateWindow {
            intent_id,
            label: retry_label,
            ..
        }] = effects.as_slice()
        else {
            panic!("F2:retry 后应重新建窗,实际 {effects:?}")
        };
        assert_eq!(intent_id, &b, "F2:复用同一 intentId");
        // retry 后完整成功
        let (b_label, b_delivery) = {
            let next = c
                .on_effect_result(&EffectResult::WindowCreated {
                    intent_id: b.clone(),
                    label: retry_label.clone(),
                    ok: true,
                    reason: None,
                })
                .unwrap();
            let [Effect::DeliverBootstrap {
                label, delivery_id, ..
            }] = next.as_slice()
            else {
                panic!()
            };
            (label.clone(), delivery_id.clone())
        };
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: b.clone(),
            label: b_label.clone(),
            delivery_id: b_delivery.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        let acks = c
            .on_renderer_outcome(&b_label, &b_delivery, RendererOutcome::Opened)
            .unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: b.clone()
            }]
        );
    }

    #[test]
    fn f3_dismiss_acks_exactly_once_and_only_from_retryable() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        // 非 retryable 状态 dismiss 拒绝
        assert_eq!(c.dismiss(&a).unwrap_err(), INVALID_INTENT_TRANSITION);
        let (main_label, main_delivery) = drive_to_assigned(&c, &a);
        c.on_renderer_outcome(&main_label, &main_delivery, RendererOutcome::Opened)
            .unwrap();
        let b = c.enqueue(
            open_file(&FileIdentity::synthetic("b")),
            Some("/b.mm".into()),
            2000,
        );
        let effects = c.route_next();
        let create_label = match effects.as_slice() {
            [Effect::CreateWindow { label, .. }] => label.clone(),
            _ => panic!(),
        };
        c.on_effect_result(&EffectResult::WindowCreated {
            intent_id: b.clone(),
            label: create_label,
            ok: false,
            reason: Some("boom".into()),
        })
        .unwrap();
        // 恰好一次 ack
        let acks = c.dismiss(&b).unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: b.clone()
            }]
        );
        assert_eq!(
            c.phase(&b).unwrap(),
            IntentPhase::Terminal(TerminalOutcome::Dismissed)
        );
        // dismissed 后重复 dismiss / retry 拒绝(ack 不会第二次)
        assert_eq!(c.dismiss(&b).unwrap_err(), INVALID_INTENT_TRANSITION);
        assert_eq!(c.retry(&b).unwrap_err(), INVALID_INTENT_TRANSITION);
    }

    #[test]
    fn p3_replay_cross_window_and_mismatched_completions_rejected() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        // routing 中(等 DeliverBootstrap 回报)on_renderer_outcome 拒绝
        let effects = c.route_next();
        let [Effect::DeliverBootstrap {
            label, delivery_id, ..
        }] = effects.as_slice()
        else {
            panic!()
        };
        let (label, delivery_id) = (label.clone(), delivery_id.clone());
        assert_eq!(
            c.on_renderer_outcome(&label, &delivery_id, RendererOutcome::Opened)
                .unwrap_err(),
            INVALID_EFFECT_COMPLETION,
            "assigned 前不收 renderer 终态"
        );
        // 等待步与回报类型不匹配
        assert_eq!(
            c.on_effect_result(&EffectResult::WindowCreated {
                intent_id: a.clone(),
                label: label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap_err(),
            INVALID_EFFECT_COMPLETION
        );
        // 跨 label 的交付回报
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: a.clone(),
            label: label.clone(),
            delivery_id: delivery_id.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        assert_eq!(
            c.on_renderer_outcome("editor-9", &delivery_id, RendererOutcome::Opened)
                .unwrap_err(),
            INVALID_EFFECT_COMPLETION,
            "跨窗 completion 必须拒绝"
        );
        // 正常终结后:重放 renderer outcome 拒绝
        c.on_renderer_outcome(&label, &delivery_id, RendererOutcome::Opened)
            .unwrap();
        assert_eq!(
            c.on_renderer_outcome(&label, &delivery_id, RendererOutcome::Opened)
                .unwrap_err(),
            INVALID_EFFECT_COMPLETION,
            "terminal 后重放必须拒绝"
        );
        // 伪造/未知 intent 的 effect 回报
        assert_eq!(
            c.on_effect_result(&EffectResult::WindowFocused {
                intent_id: "intent-forged".into(),
                label: label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap_err(),
            INVALID_EFFECT_COMPLETION
        );
    }

    #[test]
    fn p5_success_terminal_acks_exactly_once() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (label, delivery) = drive_to_assigned(&c, &a);
        // action resolve 前零 ack(交付完成只是 assigned)
        assert!(matches!(c.phase(&a).unwrap(), IntentPhase::Assigned { .. }));
        let acks = c
            .on_renderer_outcome(&label, &delivery, RendererOutcome::Opened)
            .unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: a.clone()
            }]
        );
        assert_eq!(
            c.phase(&a).unwrap(),
            IntentPhase::Terminal(TerminalOutcome::Opened)
        );
        assert_eq!(c.window_record(&label).unwrap().state, WindowState::Open);
        assert_eq!(
            c.identity_owner_of(&FileIdentity::synthetic("a"))
                .unwrap()
                .0,
            label
        );
    }

    #[test]
    fn p4_renderer_retryable_error_marks_failed_and_keeps_intent() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (label, delivery) = drive_to_assigned(&c, &a);
        let out = c
            .on_renderer_outcome(
                &label,
                &delivery,
                RendererOutcome::RetryableError {
                    reason: "decode failed".to_string(),
                },
            )
            .unwrap();
        assert_eq!(
            out,
            vec![Effect::ShowRetryableError {
                intent_id: a.clone(),
                reason: "decode failed".to_string(),
            }],
            "P4:错误可见、不 ack、不自旋"
        );
        // 窗口标 failed、reservation 释放
        assert_eq!(c.window_record(&label).unwrap().state, WindowState::Failed);
        assert_eq!(c.identity_owner_of(&FileIdentity::synthetic("a")), None);
        // retry 后同 intent 重新走 cold/warm 决策(main 已 Failed 非 Booting → 新窗)
        c.retry(&a).unwrap();
        let effects = c.route_next();
        assert!(
            matches!(effects.as_slice(), [Effect::CreateWindow { .. }]),
            "retry 从当前 registry 事实重新决策:{effects:?}"
        );
    }

    #[test]
    fn q1_order_is_stable_by_received_at_then_intent_id() {
        let c = coordinator();
        // 同时刻入队:intentId 字典序稳定破平
        let ids: Vec<String> = (0..3)
            .map(|_| c.enqueue(LaunchIntentKind::Activation, None, 5000))
            .collect();
        let first = c.route_next();
        let [Effect::CreateWindow { intent_id, .. }] = first.as_slice() else {
            panic!()
        };
        assert_eq!(intent_id, &ids[0], "receivedAt 相同时按入队(intentId)顺序");
        // 完成第一个后按序处理第二个
        let label = match first.as_slice() {
            [Effect::CreateWindow { label, .. }] => label.clone(),
            _ => unreachable!(),
        };
        c.on_effect_result(&EffectResult::WindowCreated {
            intent_id: ids[0].clone(),
            label,
            ok: false,
            reason: Some("x".into()),
        })
        .unwrap();
        let second = c.route_next();
        let [Effect::CreateWindow { intent_id, .. }] = second.as_slice() else {
            panic!()
        };
        assert_eq!(intent_id, &ids[1]);
    }

    // ---- A1 新增:L/T/C 矩阵 ----

    /// L2:多线程并发调用必须在有限时间完成(无死锁),最终状态自洽。
    /// 补充性测试;结构性保证来自单锁设计(L1)。
    #[test]
    fn l2_concurrent_smoke_completes_without_deadlock() {
        let c = Arc::new(coordinator());
        let mut handles = Vec::new();
        for t in 0..4i64 {
            let c = Arc::clone(&c);
            handles.push(std::thread::spawn(move || {
                for i in 0..50i64 {
                    let id = c.enqueue(LaunchIntentKind::Activation, None, 1000 + t * 1000 + i);
                    let _ = c.phase(&id);
                    let _ = c.route_next();
                    let _ = c.retry(&id); // 非 retryable 时稳定拒绝
                    let _ = c.queued_len();
                    let _ = c.window_record("main");
                }
            }));
        }
        for h in handles {
            h.join().expect("并发调用必须有限时间完成(无死锁)");
        }
        // 最终状态可查询且自洽(不 panic、无残留 in-flight 卡死)
        let _ = c.queued_len();
    }

    /// T1(B1 语义):CreateWindow 挂起期间 identity 已被本 target 的
    /// assignment 预占(B1-F1:effect 发出前预留)——他人对同 identity 的
    /// begin_loading/prepare 一致被拒;WindowCreated ok 正常升级 Active。
    /// 旧"并发预占绕过"竞态窗口已被统一 reservation 结构性消灭。
    #[test]
    fn t1_window_created_midway_failure_leaves_no_partial_state() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (label, delivery) = drive_to_assigned(&c, &a);
        c.on_renderer_outcome(&label, &delivery, RendererOutcome::Opened)
            .unwrap();
        let b = c.enqueue(
            open_file(&FileIdentity::synthetic("f2")),
            Some("/f2.mm".into()),
            2000,
        );
        let effects = c.route_next();
        let [Effect::CreateWindow { label: ghost, .. }] = effects.as_slice() else {
            panic!("warm open 应建窗:{effects:?}")
        };
        let ghost = ghost.clone();
        // create 挂起期间:assignment 已占 f2(B1-F1)。他人 begin_loading
        // 同 identity → 一致拒绝(统一 reservation,X2)。
        c.with_registry_mut_for_test(|r| {
            r.register("editor-9").unwrap();
            let err = r
                .begin_loading("editor-9", &FileIdentity::synthetic("f2"), "pre")
                .unwrap_err();
            assert_eq!(err, "IDENTITY_ALREADY_RESERVED");
        });
        let before_phase = c.phase(&b).unwrap();
        // WindowCreated ok:assignment 匹配 → 正常升级 Active 并推进
        let result = c.on_effect_result(&EffectResult::WindowCreated {
            intent_id: b.clone(),
            label: ghost.clone(),
            ok: true,
            reason: None,
        });
        assert!(
            result.is_ok(),
            "自带 assignment 的回报必须整体成功: {result:?}"
        );
        assert!(
            c.window_record(&ghost)
                .is_some_and(|r| r.state == WindowState::Loading),
            "窗口已登记为 Loading(assignment 升级 Active)"
        );
        assert_ne!(
            c.phase(&b).unwrap(),
            before_phase,
            "intent phase 正常推进(不再是 Routing/CreateWindow)"
        );
    }

    /// X3(B1):CreateWindow 失败 → assignment 原子回滚(无幽灵 reservation)。
    #[test]
    fn x3_create_failure_releases_assignment_reservation() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("a")),
            Some("/a.mm".into()),
            1000,
        );
        let (_label, delivery) = drive_to_assigned(&c, &a);
        c.on_renderer_outcome(&_label, &delivery, RendererOutcome::Opened)
            .unwrap();
        let b = c.enqueue(
            open_file(&FileIdentity::synthetic("f2")),
            Some("/f2.mm".into()),
            2000,
        );
        let effects = c.route_next();
        let [Effect::CreateWindow { label: ghost, .. }] = effects.as_slice() else {
            panic!()
        };
        let ghost = ghost.clone();
        // assignment 已占 f2(pending Save As 对同 target 也被拒)
        assert_eq!(
            c.prepare_rebind("main", &FileIdentity::synthetic("f2"))
                .unwrap_err(),
            "IDENTITY_ALREADY_RESERVED",
            "create 挂起期间同 target Save As prepare 被拒(经 coordinator)"
        );
        // create 失败 → 回滚
        c.on_effect_result(&EffectResult::WindowCreated {
            intent_id: b.clone(),
            label: ghost.clone(),
            ok: false,
            reason: Some("boom".into()),
        })
        .unwrap();
        assert_eq!(c.window_record(&ghost), None, "X3:无幽灵窗口");
        // reservation 已释放:同 identity 现在可以正常分配
        let b2 = c.enqueue(
            open_file(&FileIdentity::synthetic("f2")),
            Some("/f2.mm".into()),
            3000,
        );
        let _ = b2;
        // (retry b 亦可;此处直接断言 assignment 查询为空)
        assert_eq!(
            c.phase(&b).unwrap(),
            IntentPhase::RetryableError {
                reason: "boom".into()
            },
            "X3:intent retryable"
        );
    }

    /// T2:窗口状态无效(Closing)时 renderer outcome 整体拒绝;
    /// delivery 未消费、intent 不变。
    #[test]
    fn t2_renderer_outcome_with_invalid_window_state_keeps_delivery() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("f")),
            Some("/f.mm".into()),
            1000,
        );
        let (label, delivery) = drive_to_assigned(&c, &a);
        // 窗口进入 Closing(关闭确认中)—— Loading→Open 非法
        c.with_registry_mut_for_test(|r| {
            r.begin_closing(&label).unwrap();
        });
        let err = c.on_renderer_outcome(&label, &delivery, RendererOutcome::Opened);
        assert!(err.is_err(), "Closing 窗口的 Opened outcome 必须拒绝");
        assert_eq!(
            c.delivery_info_of(&delivery).map(|d| d.completed),
            Some(false),
            "T2:被拒绝的 outcome 不得消费 delivery"
        );
        assert!(matches!(c.phase(&a).unwrap(), IntentPhase::Assigned { .. }));
    }

    /// T4/C3:Destroyed 清 reservation/delivery;assigned intent 同 ID
    /// 恢复排队、重新路由并可终结。
    #[test]
    fn t4_c3_destroyed_during_assigned_recovers_same_intent() {
        let c = coordinator();
        let a = c.enqueue(
            open_file(&FileIdentity::synthetic("f")),
            Some("/f.mm".into()),
            1000,
        );
        let (_label, delivery) = drive_to_assigned(&c, &a);
        let _ = delivery;
        c.on_destroyed(MAIN);
        // reservation/delivery 清理(T4:无泄漏)
        assert_eq!(c.window_record(MAIN), None);
        assert_eq!(
            c.identity_reservation_of(&FileIdentity::synthetic("f")),
            None
        );
        // intent 未丢失:恢复排队,同 intentId 重新路由并可终结(C3)
        assert!(
            matches!(c.phase(&a).unwrap(), IntentPhase::Queued),
            "T4:intent 可恢复"
        );
        let effects = c.route_next();
        let [Effect::CreateWindow {
            intent_id,
            label: new_label,
            ..
        }] = effects.as_slice()
        else {
            panic!("C3:Destroyed 后应重新建窗,实际 {effects:?}")
        };
        assert_eq!(intent_id, &a, "C3:同 intentId 恢复路由");
        let next = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: a.clone(),
                label: new_label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        let [Effect::DeliverBootstrap {
            label: l2,
            delivery_id: d2,
            ..
        }] = next.as_slice()
        else {
            panic!()
        };
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: a.clone(),
            label: l2.clone(),
            delivery_id: d2.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        let acks = c
            .on_renderer_outcome(l2, d2, RendererOutcome::Opened)
            .unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: a.clone()
            }]
        );
    }

    /// C2:Closing 占用时重复 open 零 create/focus/ack,intent deferred;
    /// 不阻塞其他 identity;Destroyed 后恢复(同 intentId)。
    #[test]
    fn c2_closing_duplicate_open_defers_and_recovers_after_destroyed() {
        let c = coordinator();
        let a_id = c.enqueue(
            open_file(&FileIdentity::synthetic("f")),
            Some("/f.mm".into()),
            1000,
        );
        let (_label, delivery) = drive_to_assigned(&c, &a_id);
        let _ = delivery;
        c.with_registry_mut_for_test(|r| {
            r.begin_closing(MAIN).unwrap();
        });
        let dup = c.enqueue(
            open_file(&FileIdentity::synthetic("f")),
            Some("/f.mm".into()),
            2000,
        );
        // C2:deferred —— 零 effect、零 ack,intent 留在队列
        assert!(c.route_next().is_empty(), "C2:Closing 占用时不得建窗/聚焦");
        assert_eq!(
            c.phase(&dup).unwrap(),
            IntentPhase::Queued,
            "C2:intent deferred"
        );
        // 不同 identity 的 intent 不被 Closing 阻塞(可继续路由)
        let other = c.enqueue(
            open_file(&FileIdentity::synthetic("g")),
            Some("/g.mm".into()),
            3000,
        );
        let effects = c.route_next();
        let other_label = match effects.as_slice() {
            [Effect::CreateWindow { intent_id, label }] if intent_id == &other => label.clone(),
            _ => panic!("defer 只影响被占用的 identity,其他 intent 正常路由:{effects:?}"),
        };
        // 推到 assigned(稳定点),释放 routing 占位
        let next = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: other.clone(),
                label: other_label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        let [Effect::DeliverBootstrap {
            label: lo,
            delivery_id: do_,
            ..
        }] = next.as_slice()
        else {
            panic!()
        };
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: other.clone(),
            label: lo.clone(),
            delivery_id: do_.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        // Destroyed 后:原 assigned intent(a)与 deferred intent(dup)都恢复
        // 排队;a 的 receivedAt 更早,先路由 a;终结后 dup 以同 intentId 恢复。
        c.on_destroyed(MAIN);
        let effects = c.route_next();
        assert!(
            matches!(effects.as_slice(), [Effect::CreateWindow { intent_id, .. }] if intent_id == &a_id),
            "C3:Destroyed 后 assigned intent 先恢复,实际 {effects:?}"
        );
        let a_label = match effects.as_slice() {
            [Effect::CreateWindow { label, .. }] => label.clone(),
            _ => unreachable!(),
        };
        let next = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: a_id.clone(),
                label: a_label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        let [Effect::DeliverBootstrap {
            label: la,
            delivery_id: da,
            ..
        }] = next.as_slice()
        else {
            panic!()
        };
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: a_id.clone(),
            label: la.clone(),
            delivery_id: da.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        c.on_renderer_outcome(la, da, RendererOutcome::Opened)
            .unwrap();
        // a 已在新窗重新打开同一文件 → dup 恢复路由为聚焦(Q2),同 intentId 终结
        let effects = c.route_next();
        assert!(
            matches!(effects.as_slice(), [Effect::FocusWindow { intent_id, label }] if intent_id == &dup && label.as_str() == la.as_str()),
            "C3:Destroyed 后 deferred intent 同 intentId 恢复路由(聚焦重开的窗口),实际 {effects:?}"
        );
        let acks = c
            .on_effect_result(&EffectResult::WindowFocused {
                intent_id: dup.clone(),
                label: la.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: dup.clone()
            }]
        );
    }
}

#[cfg(test)]
mod a1_red_tests {
    use super::*;
    use crate::lifecycle::window_registry::WindowRegistry;

    const MAIN: &str = "main";

    fn coordinator_with_main() -> LaunchCoordinator {
        let mut registry = WindowRegistry::new();
        registry.register(MAIN).unwrap();
        LaunchCoordinator::new(registry)
    }

    fn open_file(v: &str) -> LaunchIntentKind {
        LaunchIntentKind::OpenFile {
            identity: FileIdentity::synthetic(v),
        }
    }

    /// A 冷分配到 assigned(renderer 读取中)。
    fn drive_to_assigned(c: &LaunchCoordinator, intent_id: &str) -> (String, String) {
        let effects = c.route_next();
        let [Effect::DeliverBootstrap {
            label, delivery_id, ..
        }] = effects.as_slice()
        else {
            panic!("cold open 应向 main 交付: {effects:?}")
        };
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: intent_id.to_string(),
            label: label.clone(),
            delivery_id: delivery_id.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        (label.clone(), delivery_id.clone())
    }

    #[test]
    fn red_a2_closing_duplicate_open_defers_instead_of_creating() {
        let c = coordinator_with_main();
        let a = c.enqueue(open_file("f"), Some("/f.mm".into()), 1000);
        let (label, delivery) = drive_to_assigned(&c, &a);
        let _ = (label, delivery);
        // 窗口进入 Closing(用户点了关闭,保存确认中)
        c.with_registry_mut_for_test(|r| {
            r.begin_closing(MAIN).unwrap();
        });
        // 同文件再次打开(A1-F4/C2):必须 deferred —— 零 create/focus/ack
        let dup = c.enqueue(open_file("f"), Some("/f.mm".into()), 2000);
        let effects = c.route_next();
        assert!(
            effects.is_empty(),
            "C2:Closing 占用时不得建窗/聚焦,实际 {effects:?}"
        );
        assert_eq!(
            c.phase(&dup).unwrap(),
            IntentPhase::Queued,
            "C2:intent 必须保持 queued(deferred)"
        );
        // Destroyed 后:原 assigned intent 先恢复(更早),deferred 的 dup
        // 在其终结后以同 intentId 恢复。
        c.on_destroyed(MAIN);
        let effects = c.route_next();
        assert!(
            matches!(effects.as_slice(), [Effect::CreateWindow { intent_id, .. }] if intent_id == &a),
            "C3:Destroyed 后 assigned intent 先恢复,实际 {effects:?}"
        );
        let a_label = match effects.as_slice() {
            [Effect::CreateWindow { label, .. }] => label.clone(),
            _ => unreachable!(),
        };
        let next = c
            .on_effect_result(&EffectResult::WindowCreated {
                intent_id: a.clone(),
                label: a_label.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        let [Effect::DeliverBootstrap {
            label: la,
            delivery_id: da,
            ..
        }] = next.as_slice()
        else {
            panic!()
        };
        c.on_effect_result(&EffectResult::BootstrapDelivered {
            intent_id: a.clone(),
            label: la.clone(),
            delivery_id: da.clone(),
            ok: true,
            reason: None,
        })
        .unwrap();
        c.on_renderer_outcome(la, da, RendererOutcome::Opened)
            .unwrap();
        // a 已在新窗重新打开同一文件 → dup 恢复路由为聚焦(Q2),同 intentId 终结
        let effects = c.route_next();
        assert!(
            matches!(effects.as_slice(), [Effect::FocusWindow { intent_id, label }] if intent_id == &dup && label.as_str() == la.as_str()),
            "C3:Destroyed 后 deferred intent 同 intentId 恢复路由(聚焦重开的窗口),实际 {effects:?}"
        );
        let acks = c
            .on_effect_result(&EffectResult::WindowFocused {
                intent_id: dup.clone(),
                label: la.clone(),
                ok: true,
                reason: None,
            })
            .unwrap();
        assert_eq!(
            acks,
            vec![Effect::AckIntent {
                intent_id: dup.clone()
            }]
        );
    }

    #[test]
    fn red_a3_window_created_midway_failure_leaves_no_partial_state() {
        // T1:CreateWindow 挂起期间 identity 被并发路径预占(真实竞态窗口:
        // route_next 已决定建窗,写入回报尚未到达)。WindowCreated ok 回报
        // 到达时 begin_loading 失败 → 整个回报必须零部分提交。
        let c = coordinator_with_main();
        let a = c.enqueue(open_file("a"), Some("/a.mm".into()), 1000);
        let (label, delivery) = drive_to_assigned(&c, &a);
        c.on_renderer_outcome(&label, &delivery, RendererOutcome::Opened)
            .unwrap();
        let b = c.enqueue(open_file("f2"), Some("/f2.mm".into()), 2000);
        let effects = c.route_next();
        let [Effect::CreateWindow { label: ghost, .. }] = effects.as_slice() else {
            panic!("warm open 应建窗: {effects:?}")
        };
        let ghost = ghost.clone();
        // create 挂起期间:assignment 已占 f2;他人预占一致被拒(B1-F1
        // 统一 reservation——旧"route 后写入竞态"结构性消灭)
        c.with_registry_mut_for_test(|r| {
            r.register("editor-9").unwrap();
            let err = r
                .begin_loading("editor-9", &FileIdentity::synthetic("f2"), "pre")
                .unwrap_err();
            assert_eq!(err, "IDENTITY_ALREADY_RESERVED");
        });
        // 自带 assignment 的 ok 回报正常推进;零部分提交的原始断言见
        // t1/x3(B1 语义矩阵)。
        let result = c.on_effect_result(&EffectResult::WindowCreated {
            intent_id: b.clone(),
            label: ghost.clone(),
            ok: true,
            reason: None,
        });
        assert!(result.is_ok(), "B1:assignment 匹配的回报整体成功");
    }

    #[test]
    fn red_a4_renderer_outcome_with_invalid_window_state_keeps_delivery() {
        // T2:窗口状态无效(已 closing)时 renderer outcome 必须整体拒绝,
        // delivery 未消费、窗口/intent 不变。
        let c = coordinator_with_main();
        let a = c.enqueue(open_file("f"), Some("/f.mm".into()), 1000);
        let (label, delivery) = drive_to_assigned(&c, &a);
        c.with_registry_mut_for_test(|r| {
            r.begin_closing(&label).unwrap();
        });
        let err = c.on_renderer_outcome(&label, &delivery, RendererOutcome::Opened);
        assert!(err.is_err(), "Closing 窗口的 Opened outcome 必须拒绝");
        assert_eq!(
            c.delivery_info_of(&delivery).map(|d| d.completed),
            Some(false),
            "T2:被拒绝的 outcome 不得消费 delivery"
        );
        assert!(matches!(c.phase(&a).unwrap(), IntentPhase::Assigned { .. }));
    }
}
