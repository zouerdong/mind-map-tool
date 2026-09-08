//! PRR-010 perf 诊断模式（仅 `MINDMAP_PERF_SAMPLE=1` 时激活）。
//!
//! 协议（指南 §4.1）：
//! - host 启动时从 env 读取 run id 与场景；renderer 经 typed IPC
//!   `platform_get_perf_probe_config` 取得配置（含 host 权威的窗口
//!   generation），在 React mount + 两帧 + 画布可交互后上报
//!   `renderer-ready`；
//! - host 校验 run id / caller label / window generation 后向 stdout
//!   输出唯一机器可解析 JSON line（lifecycle 日志全部走 stderr，
//!   stdout 只承载 perf 事件）；
//! - `launch` 场景在 renderer-ready 输出后退出进程；`rss` 场景由 host
//!   在 renderer-ready 之后采样自身驻留内存；`canvas`/`edit`/`save`/
//!   `png-export` 场景等 renderer 上报 `scenario-result` 后退出——
//!   sampler 始终等待子进程真实退出；
//! - `save`/`png-export` 的授权走 env 精确目标旁路（无对话框），任何
//!   其他目标的授权请求在 perf 模式下直接失败，不弹 UI。
//!
//! 该模块不开放为普通用户命令，不接入网络，不影响生产路径
//! （env 未设置时 `PerfProbe` 不存在，全部命令返回未启用）。

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const ENV_ENABLED: &str = "MINDMAP_PERF_SAMPLE";
pub const ENV_RUN_ID: &str = "MINDMAP_PERF_RUN_ID";
pub const ENV_SCENARIO: &str = "MINDMAP_PERF_SCENARIO";
pub const ENV_FIXTURE: &str = "MINDMAP_PERF_FIXTURE";
pub const ENV_SAVE_TARGET: &str = "MINDMAP_PERF_SAVE_TARGET";
pub const ENV_EXPORT_TARGET: &str = "MINDMAP_PERF_EXPORT_TARGET";
pub const ENV_SAMPLES: &str = "MINDMAP_PERF_SAMPLES";

/// rss 场景 renderer-ready 后的稳定等待（ms）。质量规范（docs/quality/
/// v1-quality-gates.md）要求窗口稳定 30 秒后采样；PRR-066 前的 2s 不满足
/// 协议。事件携带 `settleMs` 供 runner 与 verify-evidence 复核声明值。
const RSS_SETTLE_MS: u64 = 30_000;
const RSS_SAMPLE_INTERVAL_MS: u64 = 250;
/// runner/verifier 校验稳定窗声明值的下限（与 RSS_SETTLE_MS 同源协议）。
pub const RSS_MIN_SETTLE_MS: u64 = 30_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scenario {
    Launch,
    Rss,
    Canvas,
    Edit,
    Save,
    PngExport,
}

impl Scenario {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "launch" => Some(Self::Launch),
            "rss" => Some(Self::Rss),
            "canvas" => Some(Self::Canvas),
            "edit" => Some(Self::Edit),
            "save" => Some(Self::Save),
            "png-export" => Some(Self::PngExport),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Launch => "launch",
            Self::Rss => "rss",
            Self::Canvas => "canvas",
            Self::Edit => "edit",
            Self::Save => "save",
            Self::PngExport => "png-export",
        }
    }
}

/// perf 采样会话状态（lib.rs 在 env 门控下 manage；否则不存在）。
pub struct PerfProbe {
    pub run_id: String,
    pub scenario: Scenario,
    pub fixture_json: Option<String>,
    pub save_target: Option<PathBuf>,
    pub export_target: Option<PathBuf>,
    pub samples: u32,
    /// 唯一采样窗口（第一个查询 config 的 caller label；跨窗口查询拒绝）。
    bound_label: Mutex<Option<String>>,
    /// renderer-ready 是否已输出过（每 run 只允许一次）。
    ready_emitted: Mutex<bool>,
}

impl PerfProbe {
    /// 从进程 env 构造。`MINDMAP_PERF_SAMPLE=1` 且 run id 非空才启用；
    /// 场景缺省 `launch`；非法场景返回 None（fail closed，不猜默认值）。
    pub fn from_env() -> Option<Self> {
        if std::env::var(ENV_ENABLED).ok().as_deref() != Some("1") {
            return None;
        }
        let run_id = std::env::var(ENV_RUN_ID).ok()?;
        if run_id.trim().is_empty() {
            return None;
        }
        let scenario = match std::env::var(ENV_SCENARIO) {
            Ok(value) => Scenario::parse(&value)?,
            Err(_) => Scenario::Launch,
        };
        let fixture_json = std::env::var(ENV_FIXTURE)
            .ok()
            .and_then(|path| std::fs::read_to_string(PathBuf::from(path)).ok());
        let samples = std::env::var(ENV_SAMPLES)
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(20);
        Some(Self {
            run_id,
            scenario,
            fixture_json,
            save_target: std::env::var(ENV_SAVE_TARGET).ok().map(PathBuf::from),
            export_target: std::env::var(ENV_EXPORT_TARGET).ok().map(PathBuf::from),
            samples,
            bound_label: Mutex::new(None),
            ready_emitted: Mutex::new(false),
        })
    }

    /// 绑定或校验采样窗口；返回是否允许该 caller 继续采样。
    pub fn bind_or_check_label(&self, label: &str) -> bool {
        let mut bound = self.bound_label.lock().unwrap();
        match bound.as_deref() {
            None => {
                *bound = Some(label.to_string());
                true
            }
            Some(existing) => existing == label,
        }
    }

    /// renderer-ready 每个采样窗口只输出一次。
    pub fn try_claim_ready(&self) -> bool {
        let mut emitted = self.ready_emitted.lock().unwrap();
        if *emitted {
            false
        } else {
            *emitted = true;
            true
        }
    }

    pub fn has_emitted_ready(&self) -> bool {
        *self.ready_emitted.lock().unwrap()
    }
}

/// stdout 唯一 JSON line（sampler 只接受整行 JSON 对象）。
fn emit_perf_line(value: &serde_json::Value) {
    println!("{value}");
}

// ==================== PRR-067 启动分段（perf-only） ====================
//
// 归因协议：`spawn → host main → Tauri setup → renderer` 的分段事件只在
// `MINDMAP_PERF_SAMPLE=1` 时输出；origin 是 `lib::run()` 入口（组合根第一
// 行，距真正的 exec 只差一个薄 main 调用，差异为微秒级函数调用）。跨进程
// monotonic 不可直接相减：host 事件只声明本进程 elapsed；sampler 侧用接收
// 时刻形成端到端界限。普通生产启动不调用 mark/emit，零行为差异。

/// `lib::run()` 入口 Instant（首次调用 mark 时固定；perf 模式专用）。
static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// 在组合根第一行标记进程起点（perf 模式下由 lib.rs 调用；重复调用无效果）。
pub fn mark_process_start() {
    let _ = PROCESS_START.set(Instant::now());
}

/// 构造启动分段事件（不打印；返回 JSON 供测试断言形状）。
pub fn startup_milestone_line(run_id: &str, milestone: &str) -> serde_json::Value {
    let host_elapsed_ms = PROCESS_START
        .get()
        .map(|start| start.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    let wall_clock_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    serde_json::json!({
        "runId": run_id,
        "milestone": milestone,
        "pid": std::process::id(),
        "hostElapsedMs": (host_elapsed_ms * 10.0).round() / 10.0,
        "wallClockMs": wall_clock_ms,
    })
}

/// 输出一条启动分段事件（仅 perf 模式调用；stdout 与其余 perf 事件同通道）。
pub fn emit_startup_milestone(run_id: &str, milestone: &str) {
    emit_perf_line(&startup_milestone_line(run_id, milestone));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfProbeConfigDto {
    pub run_id: String,
    pub scenario: String,
    pub fixture_json: Option<String>,
    pub samples: u32,
    pub window_generation: u64,
}

/// perf 事件上报 payload（renderer → host；serde 契约与 TS 侧对齐：
/// JS 端 reportPerfEvent 以 camelCase 发送，字段必须 rename）。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfEventPayload {
    pub run_id: String,
    pub window_generation: u64,
    pub milestone: String,
    pub data: Option<serde_json::Value>,
}

/// 校验并转发 renderer perf 事件。caller label 由 Tauri 注入的
/// `WebviewWindow` 提供（不接受前端自报）。返回 Err(reason) 时 renderer
/// 收到可读错误（不中断进程，场景由 sampler 超时判定失败）。
pub fn report_perf_event(
    app: &AppHandle,
    caller_label: &str,
    payload: PerfEventPayload,
    current_generation: Option<u64>,
) -> Result<(), String> {
    let Some(probe) = app.try_state::<std::sync::Arc<PerfProbe>>() else {
        return Err("perf probe not enabled".to_string());
    };
    if payload.run_id != probe.run_id {
        return Err(format!(
            "runId mismatch: expected {}, got {}",
            probe.run_id, payload.run_id
        ));
    }
    if !probe.bind_or_check_label(caller_label) {
        return Err("perf probe bound to another window".to_string());
    }
    match current_generation {
        Some(generation) if generation == payload.window_generation => {}
        other => {
            return Err(format!(
                "windowGeneration mismatch: reported {}, registry {:?}",
                payload.window_generation, other
            ));
        }
    }

    match payload.milestone.as_str() {
        "renderer-ready" => {
            if !probe.try_claim_ready() {
                return Err("renderer-ready already emitted for this run".to_string());
            }
            // PRR-067：附带 renderer 早期分段（data 可空；向后兼容——
            // 旧 renderer/测试不发送 data 时字段为 null，sampler 忽略）。
            emit_perf_line(&serde_json::json!({
                "runId": payload.run_id,
                "windowGeneration": payload.window_generation,
                "milestone": "renderer-ready",
                "data": payload.data.clone().unwrap_or(serde_json::Value::Null),
            }));
            match probe.scenario {
                Scenario::Launch => app.exit(0),
                Scenario::Rss => spawn_rss_sampling(app.clone(), &probe, payload),
                _ => {}
            }
            Ok(())
        }
        "scenario-result" => {
            if !probe.has_emitted_ready() {
                return Err("scenario-result before renderer-ready".to_string());
            }
            if matches!(probe.scenario, Scenario::Launch | Scenario::Rss) {
                return Err(format!(
                    "scenario-result is not valid for {}",
                    probe.scenario.as_str()
                ));
            }
            let data = payload.data.clone().unwrap_or(serde_json::Value::Null);
            emit_perf_line(&serde_json::json!({
                "runId": payload.run_id,
                "windowGeneration": payload.window_generation,
                "milestone": "scenario-result",
                "scenario": probe.scenario.as_str(),
                "data": data,
            }));
            app.exit(0);
            Ok(())
        }
        "scenario-failed" => {
            let reason = payload
                .data
                .and_then(|d| d.get("reason").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_else(|| "unknown".to_string());
            emit_perf_line(&serde_json::json!({
                "runId": payload.run_id,
                "windowGeneration": payload.window_generation,
                "milestone": "scenario-failed",
                "scenario": probe.scenario.as_str(),
                "reason": reason,
            }));
            app.exit(1);
            Ok(())
        }
        other => Err(format!("unknown perf milestone: {other}")),
    }
}

/// renderer-ready 后采样自身 RSS（`ps` 只读本进程；无新依赖、无权限提升）。
fn spawn_rss_sampling(app: AppHandle, probe: &PerfProbe, payload: PerfEventPayload) {
    let run_id = payload.run_id;
    let generation = payload.window_generation;
    let samples = probe.samples.clamp(1, 64);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(RSS_SETTLE_MS));
        for _ in 0..samples {
            if let Some(kb) = read_self_rss_kb() {
                emit_perf_line(&serde_json::json!({
                    "runId": run_id,
                    "windowGeneration": generation,
                    "milestone": "rss-sample",
                    "rssKb": kb,
                    "settleMs": RSS_SETTLE_MS,
                }));
            }
            std::thread::sleep(Duration::from_millis(RSS_SAMPLE_INTERVAL_MS));
        }
        emit_perf_line(&serde_json::json!({
            "runId": run_id,
            "windowGeneration": generation,
            "milestone": "rss-complete",
            "settleMs": RSS_SETTLE_MS,
        }));
        app.exit(0);
    });
}

/// 当前进程驻留内存（KB）。`ps` 失败时返回 None（样本缺失由 sampler
/// 判 INCOMPLETE，不填默认值）。
fn read_self_rss_kb() -> Option<i64> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().parse::<i64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_env_requires_explicit_enable_and_run_id() {
        // 未启用 → None
        std::env::remove_var(ENV_ENABLED);
        assert!(PerfProbe::from_env().is_none());
        // 启用但无 run id → None
        std::env::set_var(ENV_ENABLED, "1");
        std::env::remove_var(ENV_RUN_ID);
        assert!(PerfProbe::from_env().is_none());
        std::env::remove_var(ENV_ENABLED);
    }

    #[test]
    fn scenario_parse_rejects_unknown() {
        assert_eq!(Scenario::parse("launch"), Some(Scenario::Launch));
        assert_eq!(Scenario::parse("png-export"), Some(Scenario::PngExport));
        assert_eq!(Scenario::parse("nonsense"), None);
    }

    /// PRR-066：RSS 稳定窗必须满足质量规范的 30 秒下限；事件声明的
    /// settleMs 以该常数为唯一来源（runner/verifier 校验声明值 ≥30s）。
    #[test]
    fn rss_settle_window_meets_thirty_second_minimum() {
        const {
            assert!(
                RSS_SETTLE_MS >= RSS_MIN_SETTLE_MS,
                "RSS_SETTLE_MS 必须不小于 30s 稳定窗（docs/quality/v1-quality-gates.md）"
            );
        }
    }

    #[test]
    fn bound_label_is_single_window() {
        let probe = PerfProbe {
            run_id: "run-1".into(),
            scenario: Scenario::Launch,
            fixture_json: None,
            save_target: None,
            export_target: None,
            samples: 4,
            bound_label: Mutex::new(None),
            ready_emitted: Mutex::new(false),
        };
        assert!(probe.bind_or_check_label("main"));
        assert!(probe.bind_or_check_label("main"));
        assert!(!probe.bind_or_check_label("editor-1"));
        // renderer-ready 只输出一次
        assert!(probe.try_claim_ready());
        assert!(!probe.try_claim_ready());
    }

    #[test]
    fn read_self_rss_kb_returns_positive_value() {
        let kb = read_self_rss_kb().expect("ps should report rss for the test process");
        assert!(kb > 0);
    }

    /// PRR-067：分段事件必须声明 runId/milestone/pid/hostElapsedMs/wallClockMs；
    /// 未 mark_process_start 时 hostElapsedMs 为 0（不 panic、不伪造单调值）。
    #[test]
    fn startup_milestone_line_shape_and_unmarked_behavior() {
        let line = startup_milestone_line("run-x", "main-entered");
        assert_eq!(line["runId"], "run-x");
        assert_eq!(line["milestone"], "main-entered");
        assert!(line["pid"].as_u64().unwrap() > 0);
        assert!(line["wallClockMs"].as_u64().unwrap() > 0);
        // OnceLock 是进程级静态：本测试进程未标记（或被其他测试标记）都
        // 必须输出有限数值；未标记时恰为 0。
        let elapsed = line["hostElapsedMs"].as_f64().unwrap();
        assert!(elapsed.is_finite() && elapsed >= 0.0);
    }

    /// PRR-067：mark 后 elapsed 单调不减（同进程两次采样）。
    #[test]
    fn startup_milestone_elapsed_monotonic_after_mark() {
        mark_process_start();
        let first = startup_milestone_line("run-y", "setup-started")["hostElapsedMs"]
            .as_f64()
            .unwrap();
        std::thread::sleep(Duration::from_millis(5));
        let second = startup_milestone_line("run-y", "setup-complete")["hostElapsedMs"]
            .as_f64()
            .unwrap();
        assert!(second >= first, "host elapsed 必须单调不减");
    }
}
