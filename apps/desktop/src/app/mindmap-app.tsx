// MindMapApp（MM-080 组合根主体）：core session + 画布 + 文件流 + 导出 +
// 引导偏好 + 按窗 bootstrap + 快捷键 + dirty 确认/错误 UI + 窗口标题。
// MRT-004 Wave 2：每个 WebView 一个 WindowBootstrapAdapter（targeted
// 交付）；工具条 Open/New 经 host launch intent；启动/打开/关闭/热键路由
// 全部由 Rust host 单 owner 决定（ADR 0008）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeDocument,
  emptyDocument,
  type OrganizeCommandResult,
  type OrganizeDirection,
} from "@mindmap/core";
import {
  createOnboardingPreferences,
  EditorCanvas,
  GeometryBarrier,
  OnboardingFlow,
  type OnboardingObservation,
} from "@mindmap/ui";
import { AppNotice } from "./app-notice.js";
import {
  createAppCommandListenerBridge,
  type AppCommandHandlers,
  dispatchAppCommand,
  shouldDispatchShortcutViaKeydown,
  shortcutActionToCommandId,
} from "./app-commands.js";
import {
  createTauriBootstrapPorts,
  WindowBootstrapAdapter,
  type BootstrapActionOutcome,
  type CloseDisposition,
  type LaunchRetryableError,
  type PendingRecovery,
  type WindowBootstrap,
} from "@mindmap/platform";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ObservedDocumentSession, type ObservationSink } from "./observed-session.js";
import type { AppPorts } from "./ports.js";
import { isTauriRuntime } from "./ports.js";
import {
  newDocumentFlow,
  openDocumentFlow,
  saveAsFlow,
  saveFlow,
  whenSavesSettled,
} from "./file-commands.js";
import { EXPORT_PANEL_FORMATS, exportFlow, type ExportFormat } from "./export-commands.js";
import { normalizeShortcut } from "./keyboard.js";

type Notice = { tone: "info" | "error"; text: string } | null;
type PendingConfirm = {
  message: string;
  onConfirm: () => void;
} | null;

/** pending-save gate（MRT-001A）的非致命提示：不弹 discard、不替换文档。 */
const SAVE_BUSY_NOTICE = "保存尚未完成，请稍后再新建或打开。";

// 每 WebView 一个 bootstrap adapter（模块级单例：StrictMode 重挂载复用；
// 窗口销毁随 WebView 进程终止）。null 仅出现在浏览器 dev。
// W2R P4：单例不捕获任何已失效的实例 closure——action 与 report-error
// 均经"当前挂载实现"持有者解析（重挂载/热替换后指向新实例，旧 session
// 不再被写入，report 状态进入当前组件）。
let windowBootstrapAdapter: WindowBootstrapAdapter | null = null;
let windowBootstrapStart: Promise<void> | null = null;
let currentBootstrapAction:
  ((bootstrap: WindowBootstrap) => Promise<BootstrapActionOutcome>) | null = null;
let currentReportError: ((deliveryId: string, error: unknown) => void) | null = null;

function isSaveInProgress(r: { kind: string; code?: string }): boolean {
  return r.kind === "error" && r.code === "SAVE_IN_PROGRESS";
}

/** report-pending 交付的 outcome 描述（W2R R3 UI；功能性文案，非最终视觉）。 */
function describeOutcome(outcome: { kind: string; reason?: string }): string {
  if (outcome.kind === "opened") return "文档已打开，回报未送达";
  if (outcome.kind === "blank-created") return "空白窗口已就绪，回报未送达";
  return `打开失败（${outcome.reason ?? "未知原因"}），回报未送达`;
}

/** 原生关闭三分支 modal 的阶段（MRT-003 / CR-003）。 */
type CloseState =
  | { requestId: string; phase: "deciding" | "saving" | "awaiting-save" | "closing" }
  | {
      requestId: string;
      phase: "retry-close";
      disposition: Exclude<CloseDisposition, "cancelled">;
    }
  | null;

export interface MindMapAppProps {
  ports: AppPorts;
}

export function MindMapApp({ ports }: MindMapAppProps) {
  // 观察广播：session（画布命令/undo/redo）+ 保存/导出 → OnboardingFlow；
  // 同时驱动 App 重渲染（session 是可变容器，dirty/标题需要信号）。
  const observers = useRef(new Set<ObservationSink>());
  const [, refresh] = useState(0);
  const broadcast = useCallback((o: OnboardingObservation) => {
    for (const cb of observers.current) cb(o);
    refresh((n) => n + 1);
  }, []);
  const observeCommands = useCallback((cb: ObservationSink) => {
    observers.current.add(cb);
    return () => {
      observers.current.delete(cb);
    };
  }, []);

  const session = useMemo(
    () => new ObservedDocumentSession(emptyDocument(), broadcast),
    [broadcast],
  );

  const [revision, setRevision] = useState(0);
  // 视野框架化信号（EditorCanvas：仅文档加载时 frame 内容，建点不动镜头）
  const [fitViewSignal, setFitViewSignal] = useState(0);
  const [replaySignal, setReplaySignal] = useState(0);
  const [organizeSignal, setOrganizeSignal] = useState(0);
  const [organizeDirection, setOrganizeDirection] = useState<OrganizeDirection>("horizontal");
  // 快捷建节点信号（⌥Space 同键分流，键位定稿 2026-08-29）：Rust 侧判断
  // 画布已聚焦时 emit `quick-create`，此处自增信号驱动画布建节点+进编辑。
  const [quickCreateSignal, setQuickCreateSignal] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirm>(null);
  // 原生关闭三分支（MRT-003）：closeState 同步镜像到 ref，供 async 流程
  // 在 await 之后读取最新阶段（等待保存/取消竞态判定）。
  const [closeState, setCloseState] = useState<CloseState>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeStateRef = useRef<CloseState>(null);
  const applyCloseState = useCallback((next: CloseState) => {
    closeStateRef.current = next;
    setCloseState(next);
  }, []);
  /** 读取当前活动 close request id（函数封装打破 ref.current 的跨 await 收窄）。 */
  const activeCloseRequestId = useCallback(() => closeStateRef.current?.requestId ?? null, []);
  const [exportPanel, setExportPanel] = useState(false);
  const [shortcutPanel, setShortcutPanel] = useState(false);
  const [shortcutValue, setShortcutValue] = useState("");
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  // MRT-004 Wave 2 §5D2/§4.3：host launch retryable 错误与 post-commit
  // recovery 的最小功能性 UI（不做最终视觉换肤）。
  const [launchErrors, setLaunchErrors] = useState<LaunchRetryableError[]>([]);
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecovery | null>(null);
  // W2R R3：bootstrap 交付的 report 失败（report-pending）可见 + 显式
  // 一次重报（不自动 timer、不自旋）。
  const [pendingReports, setPendingReports] = useState<
    { deliveryId: string; outcomeText: string }[]
  >([]);
  const onPreferenceWarning = useCallback((text: string) => {
    setNotice({ tone: "error", text });
  }, []);
  const bump = useCallback(() => {
    setRevision((r) => r + 1);
    refresh((n) => n + 1);
  }, []);

  const activeEditorRef = useRef<{ flush(): void } | null>(null);

  const geometryBarrier = useMemo(() => {
    return new GeometryBarrier({
      session,
      getMetricsState: () =>
        ports.fontMetricsState?.() ?? ports.renderer.fontMetricsState?.() ?? "ready",
      whenMetricsReady: () =>
        ports.whenMetricsReady?.() ??
        ports.renderer.whenMetricsReady?.() ??
        Promise.resolve(ports.fonts),
      getFallbackFonts: () => ports.fonts,
      onCommitted: () => bump(),
      onError: (err) => {
        setNotice({
          tone: "error",
          text: `字体资源加载失败，无法提交几何变更：${err instanceof Error ? err.message : String(err)}`,
        });
      },
    });
  }, [bump, ports, session]);

  // PRR-066 / ADR 0011 动态加载分支：导出资源（export chunk、三份 WOFF2、
  // resvg WASM）不再在 mount 后无条件预热——空白画布 RSS 与启动计时不得
  // 被未使用的导出栈占用。首个依赖真实字体度量的意图由 GeometryBarrier
  // 自动启动一次 in-flight 加载并恰好提交一次（见 geometry-barrier.ts）；
  // Save/Close-Save/Export 等待同一次加载。此处仅保留卸载清理。
  useEffect(() => () => geometryBarrier.dispose(), [geometryBarrier]);

  const deps = useMemo(() => ({ filePort: ports.filePort }), [ports.filePort]);

  // PRR-010 perf 诊断探针：mount 后启动；未启用（无 MINDMAP_PERF_SAMPLE
  // env 的普通用户/浏览器 dev 路径）时 no-op。场景文档加载复用与 open
  // 相同的 load + fitView 信号路径。动态 import：诊断代码不占首屏 entry
  // 预算（RLS-013/PRR-020）。
  useEffect(() => {
    void import("./perf-probe.js").then((mod) =>
      mod.runPerfProbe({
        session,
        filePort: ports.filePort,
        renderer: ports.renderer,
        loadDocument: (doc) => {
          session.load(doc);
          bump();
          setFitViewSignal((n) => n + 1);
        },
        notifySaved: () => session.notifySaved(),
        notifyExported: () => session.notifyExported(),
      }),
    );
    // 单次启动：探针自身幂等（StrictMode 复用模块级单例），依赖只取首帧引用。
  }, []);
  const onboardingPreferences = useMemo(
    () => createOnboardingPreferences(ports.preferences),
    [ports.preferences],
  );

  const confirmDiscard = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({
          message,
          onConfirm: () => {
            setConfirmState(null);
            resolve(true);
          },
        });
        // 取消/关闭即放弃确认 → resolve(false) 由下面渲染的取消按钮承担
        (window as unknown as { __pendingDiscard?: (v: boolean) => void }).__pendingDiscard =
          resolve;
      }),
    [],
  );
  const cancelDiscard = useCallback(() => {
    setConfirmState(null);
    (window as unknown as { __pendingDiscard?: (v: boolean) => void }).__pendingDiscard?.(false);
    delete (window as unknown as { __pendingDiscard?: (v: boolean) => void }).__pendingDiscard;
  }, []);

  // ---- 动作（工具条/快捷键/launch 共用） ----

  const handleResultNotice = useCallback(
    (result: { kind: string; message?: string; code?: string }, okText?: string) => {
      if (result.kind === "ok" && okText) setNotice({ tone: "info", text: okText });
      else if (result.kind === "conflict" || result.kind === "error")
        setNotice({ tone: "error", text: result.message ?? result.code ?? "操作失败" });
    },
    [],
  );

  const onNew = useCallback(async () => {
    // MRT-004 Wave 2 §5C4（Tauri）：New = 新空白窗口（activation 语义）；
    // 当前窗口（含 dirty/已打开）不被替换，无 discard 确认。浏览器 dev
    // 保留本地新建流程。
    if (!ports.isBrowserDev) {
      try {
        await ports.launch.requestBlankWindow();
      } catch (e) {
        setNotice({
          tone: "error",
          text: `新建窗口失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
      return;
    }
    // pending-save gate（MRT-001A）：不弹 discard 确认，保存链自然终态后可重试
    if (session.hasPendingSaves) {
      setNotice({ tone: "info", text: SAVE_BUSY_NOTICE });
      return;
    }
    if (session.isDirty) {
      const ok = await confirmDiscard("当前文档有未保存修改，确定丢弃并新建吗？");
      if (!ok) return;
    }
    const result = await newDocumentFlow(session, async () => true);
    if (result.kind === "ok") {
      bump();
      setFitViewSignal((n) => n + 1);
      setNotice({ tone: "info", text: "已新建空白文档" });
    } else if (isSaveInProgress(result)) {
      setNotice({ tone: "info", text: SAVE_BUSY_NOTICE }); // 确认等待期间保存进入 pending：兜底 gate
    }
  }, [bump, confirmDiscard, ports, session]);

  const onOpen = useCallback(async () => {
    // MRT-004 Wave 2 §5C4（Tauri）：Open = 请求 host 入队（原生对话框由
    // host 打开）；当前窗口（含 dirty）不被替换，新文件开新窗。浏览器 dev
    // 保留本地打开流程。
    if (!ports.isBrowserDev) {
      try {
        await ports.launch.requestOpenIntent();
      } catch (e) {
        setNotice({
          tone: "error",
          text: `打开失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
      return;
    }
    // pending-save gate（MRT-001A）：不弹 discard、不打开文件对话框
    if (session.hasPendingSaves) {
      setNotice({ tone: "info", text: SAVE_BUSY_NOTICE });
      return;
    }
    if (session.isDirty) {
      const ok = await confirmDiscard("当前文档有未保存修改，打开其他文件将丢弃这些修改。继续吗？");
      if (!ok) return;
    }
    const result = await openDocumentFlow(session, deps);
    if (isSaveInProgress(result)) {
      setNotice({ tone: "info", text: SAVE_BUSY_NOTICE }); // 对话框期间保存进入 pending：兜底 gate
      return;
    }
    handleResultNotice(
      result,
      result.kind === "ok" ? `已打开 ${result.value?.displayPath ?? ""}` : undefined,
    );
    bump();
    if (result.kind === "ok") setFitViewSignal((n) => n + 1);
  }, [bump, confirmDiscard, deps, handleResultNotice, ports, session]);

  /** §4.3：PostCommit 失败时 receipt 真实有效——已提交快照记为成功，
   * 同时呈现恢复状态（不得显示为普通保存失败）。 */
  const reportSaveResult = useCallback(
    (result: {
      kind: string;
      message?: string;
      code?: string;
      value?: { receipt: { displayPath: string; rebindState?: string } };
    }) => {
      if (result.kind === "ok" && result.value) {
        session.notifySaved();
        const { receipt } = result.value;
        if (receipt.rebindState === "recovery-pending") {
          setNotice({
            tone: "info",
            text: `已保存 ${receipt.displayPath}（窗口文件状态恢复待完成）`,
          });
          void refreshRecovery();
        } else {
          setNotice({ tone: "info", text: `已保存 ${receipt.displayPath}` });
        }
      } else if (result.kind === "conflict" || result.kind === "error") {
        handleResultNotice(result);
      }
    },
    [handleResultNotice, session],
  );

  const onSave = useCallback(async () => {
    try {
      activeEditorRef.current?.flush();
      await geometryBarrier.flush();
    } catch (e) {
      setNotice({
        tone: "error",
        text: `字体资源加载失败，无法保存文档：${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    reportSaveResult(await saveFlow(session, deps));
    bump();
  }, [bump, deps, geometryBarrier, reportSaveResult, session]);

  const onSaveAs = useCallback(async () => {
    try {
      activeEditorRef.current?.flush();
      await geometryBarrier.flush();
    } catch (e) {
      setNotice({
        tone: "error",
        text: `字体资源加载失败，无法另存文档：${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    reportSaveResult(await saveAsFlow(session, deps, "未命名.mindmap"));
    bump();
  }, [bump, deps, geometryBarrier, reportSaveResult, session]);

  // ---- 原生关闭三分支控制器（MRT-003 / CR-003）----
  // host fail-closed 持有 pending request；此处只做应答：clean 直接放行；
  // dirty 弹 Save/Discard/Cancel；pending save 受控等待现有保存链自然终态。
  const closePort = ports.closeLifecycle;

  const handleCloseRequest = useCallback(
    async (request: { requestId: string }) => {
      // 同窗最多一个活动请求：已有流程在跑时忽略后续到达（gate 已按
      // requestId 去重，此处对事件/snapshot 双源与极端重放兜底）。
      // 读取收敛到局部变量，避免 ref.current 的类型收窄跨 await 泄漏。
      if (closeStateRef.current !== null) return;
      setCloseError(null);
      if (!session.isDirty && !session.hasPendingSaves) {
        try {
          await closePort.resolve(request.requestId, "clean"); // 正常路径不弹 modal
        } catch (e) {
          setCloseError(e instanceof Error ? e.message : String(e));
          applyCloseState({
            requestId: request.requestId,
            phase: "retry-close",
            disposition: "clean",
          });
        }
        return;
      }
      if (session.hasPendingSaves) {
        // 保存进行中：受控等待（不轮询、不 timeout、不得销毁可能提交文件的
        // 窗口）；Discard 暂不可执行，Cancel 仍可取消本次关闭。
        applyCloseState({ requestId: request.requestId, phase: "awaiting-save" });
        await whenSavesSettled(session);
        if (activeCloseRequestId() !== request.requestId) return; // 已被取消
        if (session.hasPendingSaves) return; // fail closed：保存链仍 pending，保持等待态
        if (!session.isDirty) {
          // 等待的保存已完成且 session clean：保存成功语义，放行
          try {
            await closePort.resolve(request.requestId, "saved");
            applyCloseState(null);
          } catch (e) {
            setCloseError(e instanceof Error ? e.message : String(e));
            applyCloseState({
              requestId: request.requestId,
              phase: "retry-close",
              disposition: "saved",
            });
          }
          return;
        }
        applyCloseState({ requestId: request.requestId, phase: "deciding" });
        return;
      }
      applyCloseState({ requestId: request.requestId, phase: "deciding" });
    },
    [activeCloseRequestId, applyCloseState, closePort, session],
  );

  /** Save 分支：复用既有 saveFlow 等真实终态；成功且 clean 才放行（任务卡 §4.4）。 */
  const handleCloseSave = useCallback(async () => {
    const current = closeStateRef.current;
    if (!current || current.phase !== "deciding") return;
    setCloseError(null);
    applyCloseState({ requestId: current.requestId, phase: "saving" }); // 锁定防重复提交
    try {
      activeEditorRef.current?.flush();
      await geometryBarrier.flush();
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
      applyCloseState({ requestId: current.requestId, phase: "deciding" });
      return;
    }
    const result = await saveFlow(session, deps);
    if (result.kind === "cancelled") {
      // Save As 被用户取消：保持 modal 与窗口，可再次选择
      applyCloseState({ requestId: current.requestId, phase: "deciding" });
      return;
    }
    if (result.kind !== "ok") {
      // conflict/只读/IO 失败：显示稳定错误，保持 modal 与窗口
      setCloseError(result.message);
      applyCloseState({ requestId: current.requestId, phase: "deciding" });
      return;
    }
    session.notifySaved();
    setNotice({
      tone: "info",
      text:
        result.value.receipt.rebindState === "recovery-pending"
          ? `已保存 ${result.value.receipt.displayPath}（窗口文件状态恢复待完成）`
          : `已保存 ${result.value.receipt.displayPath}`,
    });
    if (session.isDirty || session.hasPendingSaves) {
      // 保存期间又产生编辑：回执只确认冻结快照，不误清 dirty；允许再次决定
      setCloseError("保存后文档仍有未保存修改，请再次保存或选择其他分支。");
      applyCloseState({ requestId: current.requestId, phase: "deciding" });
      return;
    }
    try {
      await closePort.resolve(current.requestId, "saved");
      // 已应答放行：保持锁定态直至窗口 Destroyed；若 host close 失败会
      // reject（WINDOW_CLOSE_FAILED），由下方 catch 回到 deciding 重试。
      applyCloseState({ requestId: current.requestId, phase: "closing" });
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
      applyCloseState({
        requestId: current.requestId,
        phase: "retry-close",
        disposition: "saved",
      });
    }
  }, [applyCloseState, closePort, deps, session]);

  /** Discard 分支：不写盘、不触碰 FilePort；host 在真正放行前撤销窗口 capability。 */
  const handleCloseDiscard = useCallback(async () => {
    const current = closeStateRef.current;
    if (!current || current.phase !== "deciding") return;
    try {
      await closePort.resolve(current.requestId, "discarded");
      applyCloseState({ requestId: current.requestId, phase: "closing" });
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
      applyCloseState({
        requestId: current.requestId,
        phase: "retry-close",
        disposition: "discarded",
      });
    }
  }, [applyCloseState, closePort]);

  /** host 发起第二次 close 失败后的显式重试；保持原 disposition 语义。 */
  const handleCloseRetry = useCallback(async () => {
    const current = closeStateRef.current;
    if (!current || current.phase !== "retry-close") return;
    setCloseError(null);
    try {
      await closePort.resolve(current.requestId, current.disposition);
      applyCloseState({ requestId: current.requestId, phase: "closing" });
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
    }
  }, [applyCloseState, closePort]);

  /** Cancel 分支：零写盘、零 capability 撤销、dirty 不变；ack 后清 modal。 */
  const handleCloseCancel = useCallback(async () => {
    const current = closeStateRef.current;
    if (!current || current.phase === "closing") return;
    try {
      await closePort.resolve(current.requestId, "cancelled");
      applyCloseState(null);
      setCloseError(null);
    } catch (e) {
      // host 未确认取消时必须保留流程；否则 pending request 无事件可重发，
      // 用户会失去重试入口并被永久卡在 fail-closed 窗口。
      setCloseError(e instanceof Error ? e.message : String(e));
    }
  }, [applyCloseState, closePort]);
  const onExport = useCallback(
    async (format: ExportFormat) => {
      try {
        // 当前编辑文字先 flush（所有格式共用——Graph JSON 的 snapshot 同样
        // 必须包含未提交的编辑中文字）。
        activeEditorRef.current?.flush();
        // Graph JSON 本身不依赖字体；但若 flush 后仍有 geometry intent，
        // session 尚未包含用户眼前的节点/文字。此时必须先收敛，失败就阻止
        // 导出，绝不能用“成功”掩盖旧快照或空图。
        if (format !== "graph-json" || geometryBarrier.hasPendingIntents()) {
          await geometryBarrier.flush();
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        setNotice({
          tone: "error",
          text:
            format === "graph-json"
              ? `当前有尚未完成的编辑，无法导出准确的 Graph JSON：${detail}`
              : `字体资源加载失败，无法导出：${detail}`,
        });
        return;
      }
      const result = await exportFlow(
        session,
        { filePort: ports.filePort, renderer: ports.renderer },
        format,
      );
      if (result.kind === "ok") {
        session.notifyExported();
        setNotice({ tone: "info", text: `已导出 ${result.displayPath}` });
        setExportPanel(false);
      } else if (result.kind !== "cancelled") {
        setNotice({ tone: "error", text: result.message });
      }
    },
    [geometryBarrier, ports.filePort, ports.renderer, session],
  );

  // 全局热键设置（MM-088；默认 ⌥Space，键位专项讨论定稿 2026-08-29）。
  const openShortcutPanel = useCallback(async () => {
    setShortcutError(null);
    setShortcutValue((await ports.globalShortcut.get()).accelerator);
    setShortcutPanel(true);
  }, [ports.globalShortcut]);

  const applyShortcut = useCallback(async () => {
    try {
      const r = await ports.globalShortcut.set(shortcutValue.trim());
      setShortcutValue(r.accelerator);
      setShortcutError(null);
      setShortcutPanel(false);
      setNotice({ tone: "info", text: `全局唤起热键已设为 ${r.accelerator}` });
    } catch (e) {
      setShortcutError(e instanceof Error ? e.message : String(e)); // 冲突/格式错误稳定提示
    }
  }, [ports.globalShortcut, shortcutValue]);

  // 一键整理（VRA-030 / VRA-060 / VRA-070）：信号触发 EditorCanvas 协调动画与 MoveNodes 提交。
  // 三态：moved / no-op / 结构化失败（COORD_LIMIT 不动文档与历史）。
  const onOrganize = useCallback(() => {
    setOrganizeSignal((n) => n + 1);
  }, []);

  const handleOrganizeResult = useCallback(
    (result: OrganizeCommandResult) => {
      if (result.status === "moved") {
        bump();
        setNotice({ tone: "info", text: "已整理为分层布局（⌘Z 可撤销）" });
      } else if (result.status === "no-op") {
        setNotice({ tone: "info", text: "已经是整理好的布局" });
      } else {
        setNotice({
          tone: "error",
          text: `整理失败：文档规模超出画布坐标上限（${result.error.span.toFixed(0)} > ${result.error.max}），未改动文档`,
        });
      }
    },
    [bump],
  );

  // ---- 单一命令 dispatcher（PRR-065 / ADR 0012） ----
  // 原生菜单事件（app-command bridge）、应用级快捷键（浏览器 dev keydown）
  // 与既有 UI 回调全部经由 dispatchCommand；业务逻辑零复制。
  // close modal 是文件生命周期的互斥决策面；禁止其背后的 New/Open/Save
  // 命令制造新的文档或保存竞态。Cancel 后恢复正常（原快捷键守卫语义）。
  const commandHandlers = useMemo<AppCommandHandlers>(
    () => ({
      "file.new": () => void onNew(),
      "file.open": () => void onOpen(),
      "file.save": () => void onSave(),
      "file.save-as": () => void onSaveAs(),
      "file.export-panel": () => setExportPanel((v) => !v),
      "view.fit": () => setFitViewSignal((n) => n + 1),
      "view.organize": () => onOrganize(),
      "view.layout-horizontal": () => setOrganizeDirection("horizontal"),
      "view.layout-vertical": () => setOrganizeDirection("vertical"),
      "view.theme-warm": () => {
        if (session.current.document.document.theme === "light") return;
        session.commit({ kind: "SetDocumentStyle", theme: "light" });
        bump();
      },
      "view.theme-dark": () => {
        if (session.current.document.document.theme === "dark") return;
        session.commit({ kind: "SetDocumentStyle", theme: "dark" });
        bump();
      },
      "app.shortcuts": () => void openShortcutPanel(),
      "help.onboarding": () => {
        setReplaySignal((n) => n + 1);
      },
      // OFR-2026-09-14 #5（负责人 dogfood：整理后按 ⌘Z 无法回到凌乱态）——
      // 生产环境 ⌘Z/⌘⇧Z 由编辑菜单自定义项 accelerator 拦截产生唯一 menu
      // event（不再依赖画布焦点收到 keydown：点击浮动按钮/工具条后焦点在
      // 按钮上，画布 handler 永远收不到）。文本编辑中保持原生文本撤销；
      // 否则 session 文档撤销/重做（画布经 revision 重投影，多节点位移
      // 由 MotionCoordinator reverseTo 平滑接续）。
      "edit.undo": () => {
        const active = document.activeElement;
        if (
          (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
          typeof document.execCommand === "function"
        ) {
          document.execCommand("undo");
          return;
        }
        if (session.undo()) bump();
      },
      "edit.redo": () => {
        const active = document.activeElement;
        if (
          (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
          typeof document.execCommand === "function"
        ) {
          document.execCommand("redo");
          return;
        }
        if (session.redo()) bump();
      },
    }),
    [onNew, onOpen, onSave, onSaveAs, onOrganize, openShortcutPanel, session, bump],
  );
  const dispatchCommand = useCallback(
    (id: string): boolean => {
      if (closeStateRef.current !== null) return false;
      return dispatchAppCommand(id, commandHandlers);
    },
    [commandHandlers],
  );

  // ---- 全局快捷键（输入/IME 隔离见 keyboard.ts） ----
  // exactly-once 分工（ADR 0012 §5）：Tauri 生产环境应用级快捷键由 macOS
  // 原生菜单 accelerator 拦截（唯一 menu event）；keydown 仅浏览器 dev 派发。
  useEffect(() => {
    if (!shouldDispatchShortcutViaKeydown(isTauriRuntime())) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const shortcut = normalizeShortcut(e);
      if (!shortcut) return;
      e.preventDefault();
      dispatchCommand(shortcutActionToCommandId(shortcut.action));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatchCommand]);

  // ---- 原生菜单命令桥接（Tauri 生产：host 定向 emit → dispatcher） ----
  const dispatchCommandRef = useRef(dispatchCommand);
  dispatchCommandRef.current = dispatchCommand;
  useEffect(() => {
    if (!isTauriRuntime()) return; // 浏览器 dev 无原生菜单
    // webview 定向 listener：只收发给本 WebView 的事件（多窗口不串扰；
    // tauri v2 中 emit_to(WebviewWindow) 的事件不触发普通全局 listen）。
    // webviewWindow API 动态 import：不占 entry 预算（RLS-013）；测试 mock
    // 环境无 getCurrentWebviewWindow 时回退普通 listen（行为等价）。
    const listenWebview: (
      event: string,
      handler: (payload: { payload: unknown }) => void,
    ) => Promise<() => void> = async (event, handler) => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const webview = getCurrentWebviewWindow();
        if (webview) {
          return webview.listen(event, (e) => handler({ payload: e.payload }));
        }
      } catch {
        /* fallthrough：mock 环境无 webview window */
      }
      return listen(event, (e) => handler({ payload: e.payload }));
    };
    return createAppCommandListenerBridge(
      (id) => dispatchCommandRef.current(id),
      listenWebview,
      (error) =>
        setNotice({
          tone: "error",
          text: `原生命令菜单连接失败：${error instanceof Error ? error.message : String(error)}`,
        }),
    );
  }, []);

  // ---- 浏览器 dev / 测试命令通道（PRR-065） ----
  // 生产（Tauri）命令经原生菜单；浏览器 dev 无菜单，暴露非可见的
  // dispatch 通道供开发调试与 jsdom 集成测试驱动（view.fit / app.shortcuts
  // 等无键盘绑定的命令）。不构成 WebView chrome。
  useEffect(() => {
    if (!ports.isBrowserDev) return;
    const w = window as typeof window & {
      __mmDispatchAppCommand?: (id: string) => boolean;
    };
    w.__mmDispatchAppCommand = (id: string) => dispatchCommandRef.current(id);
    return () => {
      delete w.__mmDispatchAppCommand;
    };
  }, [ports.isBrowserDev]);

  // ---- 全局热键 Pre-Focus 两阶段协议（PRC-030 / ADR 0011）：
  // 阶段 1：响应 host 的 pre-focus probe，此时 host 尚未聚焦窗口，读取真实 document.hasFocus()；
  // 阶段 2：仅当 host 验证 pre-focus 且判定可建点后，接收 quick-create 事件驱动画布。
  useEffect(() => {
    if (!isTauriRuntime()) return; // 浏览器 dev 无原生热键

    const unlistenProbe = listen<{
      invocationId: string;
      windowId: string;
      generation: number;
    }>("shortcut://pre-focus-probe", async (event) => {
      const { invocationId, windowId, generation } = event.payload;
      const hadDocumentFocus = document.hasFocus() && document.visibilityState === "visible";
      try {
        await invoke("platform_resolve_shortcut_invocation", {
          invocationId,
          windowId,
          generation,
          hadDocumentFocus,
        });
      } catch {
        // probe 响应过期、窗口已销毁或失效，静默忽略
      }
    });

    const unlistenQuickCreate = listen("quick-create", () => {
      setQuickCreateSignal((n) => n + 1);
    });

    return () => {
      void unlistenProbe.then((dispose) => dispose());
      void unlistenQuickCreate.then((dispose) => dispose());
    };
  }, []);

  // ---- dirty 关闭保护（仅 browser-dev fallback；native 由 MRT-003 host 协议负责） ----
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [session]);

  // ---- 原生关闭协议接线（MRT-003）：host 定向 close-requested → 三分支 ----
  useEffect(() => {
    const port = ports.closeLifecycle;
    void port.start((request) => {
      void handleCloseRequest(request);
    });
    return () => {
      void port.stop();
    };
  }, [ports.closeLifecycle, handleCloseRequest]);

  // ---- 窗口标题（dirty 指示 + 文档名） ----
  useEffect(() => {
    const name = session.displayPath?.split(/[\\/]/).pop() ?? "未命名";
    document.title = `${session.isDirty ? "● " : ""}${name} — Mind Map`;
  });

  // ---- 按窗 bootstrap 装配（MRT-004 Wave 2 §5C5；ADR 0008 §6-7） ----
  // 每 WebView 恰好一个 WindowBootstrapAdapter：模块级单例，React
  // StrictMode mount/unmount 不重复 listener、不丢 report-pending
  // （adapter dispose 属于窗口销毁语义，进程随 WebView 终止，无需卸载）。
  // W2R P4：单例不得捕获已失效的 session/ports closure——action 经 ref
  // 每次解析到**当前**挂载的处理函数（StrictMode 重挂载/热替换后交付
  // 进入当前 session，旧 session 不再被写入）。
  const handleBootstrapAction = useCallback(
    async (bootstrap: WindowBootstrap): Promise<BootstrapActionOutcome> => {
      if (bootstrap.kind === "blank") {
        // blank 只在目标窗口初始 session 已空白时回报（§5C5）
        if (!session.isDirty && session.displayPath === null) {
          return { kind: "blank-created" };
        }
        throw new Error("窗口已承载文档，不能作为空白窗口完成初始化");
      }
      const opened = await invoke<{
        contentJson: string;
        documentTargetHandle: string;
        versionToken: string;
        displayPath: string;
      }>("platform_open_assigned_document", { deliveryId: bootstrap.deliveryId }).catch((e) => {
        // invoke reject 是 {code,message} 形状（不经 FilePort 的错误映射）；
        // 提取 message，避免 reason 退化为 "[object Object]"（§5D2 reason 可见）。
        const message =
          typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : String(e);
        throw new Error(`读取启动文档失败：${message}`);
      });
      const decoded = decodeDocument(new TextEncoder().encode(opened.contentJson));
      if (!decoded.ok) {
        throw new Error(
          decoded.error.code === "FUTURE_VERSION"
            ? "文档来自更新版本，无法打开（不会覆盖原文件）。"
            : "文件不是有效的脑图文档。",
        );
      }
      // 二次 gate：core load() 原子 fail-closed（保存 pending 时不替换）
      const loaded = session.load(decoded.doc);
      if (loaded.kind !== "replaced") throw new Error("保存尚未完成，无法加载启动文件");
      session.adoptOpenedTarget(
        opened.documentTargetHandle as never,
        opened.versionToken as never,
        opened.displayPath,
      );
      bump();
      setFitViewSignal((n) => n + 1);
      setNotice({ tone: "info", text: `已打开 ${opened.displayPath}` });
      return { kind: "opened" };
    },
    [bump, session],
  );

  const refreshLaunchErrors = useCallback(async () => {
    try {
      setLaunchErrors(await ports.launch.launchErrors());
    } catch {
      // 快照查询失败不阻塞；下次定向事件会再刷新
    }
  }, [ports.launch]);

  const refreshRecovery = useCallback(async () => {
    try {
      setPendingRecovery(await ports.launch.pendingRecovery());
    } catch {
      // 同上
    }
  }, [ports.launch]);

  const onRetryLaunchError = useCallback(
    async (intentId: string) => {
      try {
        await ports.launch.retryLaunchIntent(intentId);
      } catch (e) {
        setNotice({
          tone: "error",
          text: `重试失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
      void refreshLaunchErrors();
    },
    [ports.launch, refreshLaunchErrors],
  );

  const onDismissLaunchError = useCallback(
    async (intentId: string) => {
      try {
        await ports.launch.dismissLaunchIntent(intentId);
      } catch (e) {
        setNotice({
          tone: "error",
          text: `放弃失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
      void refreshLaunchErrors();
    },
    [ports.launch, refreshLaunchErrors],
  );

  /** 一次显式、有限的 post-commit recovery（§4.3；不自动重试）。 */
  const onResolveRecovery = useCallback(async () => {
    try {
      await ports.launch.resolvePendingRecovery();
      setNotice({ tone: "info", text: "窗口文件状态恢复完成" });
    } catch (e) {
      setNotice({
        tone: "error",
        text: `恢复失败（保持待恢复）：${e instanceof Error ? e.message : String(e)}`,
      });
    }
    void refreshRecovery();
  }, [ports.launch, refreshRecovery]);

  /** W2R R3：显式一次重报——每个 pending delivery 至多重报一次；成功后
   * 清提示；action 不重跑（adapter 缓存 outcome）。无自动 timer。 */
  const onRetryPendingReports = useCallback(async () => {
    const adapter = windowBootstrapAdapter;
    if (!adapter) return;
    try {
      await adapter.retryPendingReports();
    } catch {
      // retryPendingReports 不抛（report 失败经 onReportError 呈现）
    }
    setPendingReports(
      adapter.pendingReports().map((p) => ({
        deliveryId: p.deliveryId,
        outcomeText: describeOutcome(p.outcome),
      })),
    );
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    // W2R P4：当前挂载的实现注册到模块级持有者（adapter 单例经它们解析，
    // 不捕获失效实例的 closure；StrictMode 重挂载后指向新实例）。
    currentBootstrapAction = handleBootstrapAction;
    currentReportError = (deliveryId, error) => {
      setNotice({
        tone: "error",
        text: `启动动作回报失败（${deliveryId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      setPendingReports(
        (windowBootstrapAdapter?.pendingReports() ?? []).map((p) => ({
          deliveryId: p.deliveryId,
          outcomeText: describeOutcome(p.outcome),
        })),
      );
    };
    if (!windowBootstrapAdapter) {
      windowBootstrapAdapter = new WindowBootstrapAdapter(
        createTauriBootstrapPorts(),
        (bootstrap) =>
          currentBootstrapAction
            ? currentBootstrapAction(bootstrap)
            : Promise.reject(new Error("bootstrap action 未就绪")),
        {
          // report 失败不得静默（A1-F2 语义的 UI 呈现；W2R R3：delivery
          // 级 report-pending 进入可重报状态）
          onReportError: (deliveryId, error) => currentReportError?.(deliveryId, error),
        },
      );
      windowBootstrapStart = windowBootstrapAdapter.start();
    }
    void windowBootstrapStart?.catch((e) => {
      // 错误详情必须可见（MM-090-D2 教训：吞错掩盖装配失败根因）
      setNotice({
        tone: "error",
        text: `窗口启动装配失败：${e instanceof Error ? e.message : String(e)}`,
      });
    });
    // 定向 retryable-error 事件（只发呈现窗口）→ 拉取快照显示
    const unlisten = listen("platform://launch-retryable-error", () => {
      void refreshLaunchErrors();
    });
    void refreshLaunchErrors();
    void refreshRecovery();
    setPendingReports(
      (windowBootstrapAdapter?.pendingReports() ?? []).map((p) => ({
        deliveryId: p.deliveryId,
        outcomeText: describeOutcome(p.outcome),
      })),
    );
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [handleBootstrapAction, refreshLaunchErrors, refreshRecovery]);

  const theme = session.current.document.document.theme;
  // DFR-030 / ADR 0012 v1.1.0：≥2 节点时显示浮动整理入口（0/1 节点不显示）；
  // 与系统菜单「视图 → 整理 ⇧⌘L」共用同一 dispatcher，不产生第二份业务逻辑。
  const nodeCount = session.current.document.document.nodes.length;

  // PRR-065：菜单 check 状态同步（非敏感：主题/布局方向）。挂载与变化时
  // 上报 host；host 按窗口缓存并在聚焦切换时刷新 app-wide 菜单。失败
  // 只影响勾选显示，不阻塞编辑。Promise.resolve 包装：测试 mock 的
  // invoke 可能不返回 Promise，容错不阻塞主流程。
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void Promise.resolve(
      invoke("platform_sync_menu_state", { payload: { theme, organizeDirection } }),
    ).catch(() => {});
  }, [theme, organizeDirection]);

  return (
    // PRR-065 / ADR 0012：生产内容区零常驻 chrome——EditorCanvas 直接占满
    // 原生标题栏以下全部区域；命令经原生菜单/快捷键进入 dispatchCommand。
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <EditorCanvas
        session={session}
        fonts={ports.fonts}
        geometryBarrier={geometryBarrier}
        activeEditorRef={activeEditorRef}
        revision={revision}
        quickCreateSignal={quickCreateSignal}
        fitViewSignal={fitViewSignal}
        organizeSignal={organizeSignal}
        organizeDirection={organizeDirection}
        onOrganizeResult={handleOrganizeResult}
      />

      <AppNotice notice={notice} theme={theme} onDismiss={() => setNotice(null)} />

      {nodeCount >= 2 ? (
        <button
          type="button"
          data-testid="organize-fab"
          title="整理（⇧⌘L）"
          onClick={() => dispatchCommand("view.organize")}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 25,
            font: "inherit",
            fontSize: 13,
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${theme === "dark" ? "#35312A" : "#E3DFD5"}`,
            background: theme === "dark" ? "#201D17" : "#FFFDF9",
            color: theme === "dark" ? "#EFEAE0" : "#3B372F",
            boxShadow: "0 6px 18px rgba(0,0,0,.12)",
            cursor: "pointer",
          }}
        >
          整理 ⇧⌘L
        </button>
      ) : null}

      {/* bootstrap report-pending（W2R R3）：动作已完成但终态回报未送达
            host——显式一次重报；不自动 timer、不重跑 action。 */}
      {pendingReports.length > 0 ? (
        <div
          role="alert"
          data-testid="pending-reports"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 35,
            maxWidth: "80%",
            boxShadow: "0 8px 24px rgba(0,0,0,.2)",
            borderRadius: 10,
            padding: "9px 14px",
            background: "#6b4f00",
            color: "#fff",
            fontSize: 13,
            display: "grid",
            gap: 6,
          }}
        >
          {pendingReports.map((report) => (
            <div key={report.deliveryId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span data-testid={`pending-report-${report.deliveryId}`}>
                {`启动回报待重发（${report.deliveryId}）：${report.outcomeText}`}
              </span>
            </div>
          ))}
          <div>
            <button
              type="button"
              data-testid="retry-bootstrap-report"
              onClick={() => void onRetryPendingReports()}
            >
              重试启动回报
            </button>
          </div>
        </div>
      ) : null}

      {/* host launch retryable 错误（MRT-004 Wave 2 §5D2）：最小功能性
            错误 UI——reason + 重试/放弃；不自动重试、不自旋。 */}
      {launchErrors.length > 0 ? (
        <div
          role="alert"
          data-testid="launch-errors"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 35,
            maxWidth: "80%",
            boxShadow: "0 8px 24px rgba(0,0,0,.2)",
            borderRadius: 10,
            padding: "9px 14px",
            background: "#5a2119",
            color: "#fff",
            fontSize: 13,
            display: "grid",
            gap: 6,
          }}
        >
          {launchErrors.map((error) => (
            <div key={error.intentId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span data-testid={`launch-error-${error.intentId}`}>
                {`打开操作失败：${error.reason}`}
              </span>
              <button
                type="button"
                aria-label="重试打开"
                onClick={() => void onRetryLaunchError(error.intentId)}
              >
                重试
              </button>
              <button
                type="button"
                aria-label="放弃打开"
                onClick={() => void onDismissLaunchError(error.intentId)}
              >
                放弃
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* post-commit recovery（§4.3）：已写入目标文件、窗口状态恢复待
            完成——不显示为保存失败；提供一次显式恢复。 */}
      {pendingRecovery ? (
        <div
          role="status"
          data-testid="pending-recovery"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 35,
            maxWidth: "80%",
            boxShadow: "0 8px 24px rgba(0,0,0,.2)",
            borderRadius: 10,
            padding: "9px 14px",
            background: "#6b4f00",
            color: "#fff",
            fontSize: 13,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span>{`已保存 ${pendingRecovery.displayPath}；${pendingRecovery.cause}。完成恢复前本窗口暂不能再次保存。`}</span>
          <button
            type="button"
            data-testid="resolve-recovery"
            onClick={() => void onResolveRecovery()}
          >
            完成恢复
          </button>
        </div>
      ) : null}

      {exportPanel ? (
        <div
          role="dialog"
          aria-label="导出"
          data-testid="export-panel"
          style={{
            position: "absolute",
            right: 12,
            top: 12,
            padding: 12,
            border: `1px solid ${theme === "dark" ? "#35312A" : "#E3DFD5"}`,
            background: theme === "dark" ? "#211E18" : "#FFFDF9",
            color: theme === "dark" ? "#EFEAE0" : "#3B372F",
            borderRadius: 8,
            display: "grid",
            gap: 8,
            zIndex: 35,
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          }}
        >
          <strong>导出当前脑图</strong>
          {EXPORT_PANEL_FORMATS.map(({ format: f, label }) => (
            <button
              key={f}
              type="button"
              onClick={() => void onExport(f)}
              data-testid={`export-${f}`}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={() => setExportPanel(false)}>
            取消
          </button>
        </div>
      ) : null}

      {shortcutPanel ? (
        <div
          role="dialog"
          aria-label="全局热键设置"
          data-testid="shortcut-panel"
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              background: "#fff",
              color: "#1f2328",
              padding: 16,
              borderRadius: 8,
              minWidth: 320,
            }}
          >
            <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>全局唤起热键</h2>
            <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 8px" }}>
              画布未在前台时按此热键唤起；画布已聚焦时同键直接新建 idea（默认 ⌥Space，2026-08-29
              定稿）。
            </p>
            <input
              aria-label="热键组合（accelerator 格式，如 Alt+Space）"
              value={shortcutValue}
              onChange={(e) => setShortcutValue(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: 6, marginBottom: 8 }}
              data-testid="shortcut-input"
            />
            {shortcutError ? (
              <p
                role="alert"
                data-testid="shortcut-error"
                style={{ color: "#b62324", fontSize: 12, margin: "0 0 8px" }}
              >
                {shortcutError}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShortcutPanel(false)}>
                取消
              </button>
              <button
                type="button"
                onClick={() => void applyShortcut()}
                data-testid="shortcut-apply"
              >
                应用
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {closeState ? (
        <div
          role="alertdialog"
          aria-label="关闭确认"
          data-testid="close-dialog"
          data-phase={closeState.phase}
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.4)",
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: "#fff",
              color: "#1f2328",
              padding: 16,
              borderRadius: 8,
              maxWidth: 380,
            }}
          >
            <p>
              {closeState.phase === "awaiting-save"
                ? "保存尚未完成，正在等待保存结束……（可取消本次关闭）"
                : closeState.phase === "saving"
                  ? "正在保存……"
                  : closeState.phase === "closing"
                    ? "正在关闭窗口……"
                    : closeState.phase === "retry-close"
                      ? "窗口关闭失败。你可以重试关闭，或取消本次关闭。"
                      : "当前文档有未保存修改。关闭前要保存吗？"}
            </p>
            {closeError ? (
              <p role="alert" data-testid="close-error" style={{ color: "#b62324", fontSize: 13 }}>
                {closeError}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {closeState.phase === "retry-close" ? (
                <button
                  type="button"
                  data-testid="close-retry"
                  aria-label="重试关闭"
                  onClick={() => void handleCloseRetry()}
                >
                  重试关闭
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid="close-save"
                    aria-label="保存并关闭"
                    disabled={closeState.phase !== "deciding"}
                    onClick={() => void handleCloseSave()}
                  >
                    保存…
                  </button>
                  <button
                    type="button"
                    data-testid="close-discard"
                    aria-label="不保存并关闭"
                    disabled={closeState.phase !== "deciding"}
                    onClick={() => void handleCloseDiscard()}
                  >
                    不保存
                  </button>
                </>
              )}
              <button
                type="button"
                data-testid="close-cancel"
                aria-label="取消关闭"
                disabled={closeState.phase === "closing"}
                onClick={() => void handleCloseCancel()}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmState ? (
        <div
          role="alertdialog"
          aria-label="未保存确认"
          data-testid="dirty-confirm"
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              background: "#fff",
              color: "#1f2328",
              padding: 16,
              borderRadius: 8,
              maxWidth: 360,
            }}
          >
            <p>{confirmState.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={cancelDiscard} data-testid="confirm-cancel">
                取消
              </button>
              <button
                type="button"
                data-testid="confirm-discard"
                onClick={() => {
                  setNotice(null);
                  confirmState.onConfirm();
                }}
              >
                丢弃修改
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* PRR-065：始终挂载以消费偏好损坏警告、恢复进度；中断引导不自动
          呈现（ADR 0012 §7），仅 help.onboarding（帮助菜单 / ⌘⇧H）显式
          replay。OFR-2026-09-14 #7（负责人 dogfood：开局没看到新手指引
          →不知道快捷键）：首次使用（偏好 not-started）启动自动呈现
          welcome，完成/跳过后永不再自动弹出。 */}
      <OnboardingFlow
        observeCommands={observeCommands}
        preferences={onboardingPreferences}
        theme={theme}
        replaySignal={replaySignal}
        presentRestoredState={false}
        presentOnFirstRun
        onPreferenceWarning={onPreferenceWarning}
      />
    </div>
  );
}
