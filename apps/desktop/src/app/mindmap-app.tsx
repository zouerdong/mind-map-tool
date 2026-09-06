// MindMapApp（MM-080 组合根主体）：core session + 画布 + 文件流 + 导出 +
// 引导偏好 + 启动路由 + 快捷键 + dirty 确认/错误 UI + 窗口标题。
// 单窗口策略（v1）：launch 文件在主窗口承载（dirty 先确认）；多窗口需
// host create-window 权限，属后续范围（记录于 MM-080 回报）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyDocument, organizeCommand } from "@mindmap/core";
import {
  createOnboardingPreferences,
  EditorCanvas,
  OnboardingFlow,
  ThemeToggle,
  type OnboardingObservation,
} from "@mindmap/ui";
import { TauriLifecycleAdapter, type CloseDisposition, type WindowAction } from "@mindmap/platform";
import { listen } from "@tauri-apps/api/event";
import { ObservedDocumentSession, type ObservationSink } from "./observed-session.js";
import type { AppPorts } from "./ports.js";
import { isTauriRuntime } from "./ports.js";
import {
  newDocumentFlow,
  openDocumentFlow,
  openPathFlow,
  saveAsFlow,
  saveFlow,
  whenSavesSettled,
} from "./file-commands.js";
import { exportFlow, type ExportFormat } from "./export-commands.js";
import { normalizeShortcut } from "./keyboard.js";

type Notice = { tone: "info" | "error"; text: string } | null;
type PendingConfirm = {
  message: string;
  onConfirm: () => void;
} | null;

/** pending-save gate（MRT-001A）的非致命提示：不弹 discard、不替换文档。 */
const SAVE_BUSY_NOTICE = "保存尚未完成，请稍后再新建或打开。";

function isSaveInProgress(r: { kind: string; code?: string }): boolean {
  return r.kind === "error" && r.code === "SAVE_IN_PROGRESS";
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
  const bump = useCallback(() => {
    setRevision((r) => r + 1);
    refresh((n) => n + 1);
  }, []);

  const deps = useMemo(() => ({ filePort: ports.filePort }), [ports.filePort]);
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
  }, [bump, confirmDiscard, session]);

  const onOpen = useCallback(async () => {
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
  }, [bump, confirmDiscard, deps, handleResultNotice, session]);

  const onSave = useCallback(async () => {
    const result = await saveFlow(session, deps);
    if (result.kind === "ok") {
      session.notifySaved();
      setNotice({ tone: "info", text: `已保存 ${result.value.receipt.displayPath}` });
    } else handleResultNotice(result);
    bump();
  }, [bump, deps, handleResultNotice, session]);

  const onSaveAs = useCallback(async () => {
    const result = await saveAsFlow(session, deps, `未命名.json`);
    if (result.kind === "ok") {
      session.notifySaved();
      setNotice({ tone: "info", text: `已保存 ${result.value.receipt.displayPath}` });
    } else handleResultNotice(result);
    bump();
  }, [bump, deps, handleResultNotice, session]);

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
    setNotice({ tone: "info", text: `已保存 ${result.value.receipt.displayPath}` });
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
    [ports.filePort, ports.renderer, session],
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

  // 一键整理（VRA-030：DAG 分层、默认横向）：纯函数布局 → 单条 MoveNodes（可 undo、进历史）。
  // 三态：moved / no-op / 结构化失败（COORD_LIMIT 不动文档与历史）。
  // bump 驱动画布重投影（外部 revision 信号——session.commit 不经画布内部通道）。
  const onOrganize = useCallback(() => {
    const result = organizeCommand(session.current.document);
    if (result.status === "moved") {
      session.commit(result.command);
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
  }, [bump, session]);

  // ---- 全局快捷键（输入/IME 隔离见 keyboard.ts） ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const shortcut = normalizeShortcut(e);
      if (!shortcut) return;
      e.preventDefault();
      // close modal 是文件生命周期的互斥决策面；禁止其背后的 New/Open/Save
      // 快捷键制造新的文档或保存竞态。Cancel 后恢复正常。
      if (closeStateRef.current !== null) return;
      switch (shortcut.action) {
        case "new":
          void onNew();
          break;
        case "open":
          void onOpen();
          break;
        case "save":
          void onSave();
          break;
        case "save-as":
          void onSaveAs();
          break;
        case "export-panel":
          setExportPanel((v) => !v);
          break;
        case "replay-onboarding":
          setReplaySignal((n) => n + 1);
          break;
        case "organize":
          onOrganize();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNew, onOpen, onSave, onSaveAs, onOrganize]);

  // ---- 全局热键同键分流（Tauri）：画布已聚焦时的 quick-create 事件 ----
  useEffect(() => {
    if (!isTauriRuntime()) return; // 浏览器 dev 无原生热键
    const unlisten = listen("quick-create", () => {
      // MM-090-D8 终案（用户决策 2026-08-29：回归原设计）：⌥Space 直达
      // 画布建点+进编辑（textarea 挂载即重试抢焦）；编辑态时本信号由
      // 画布解释为「焦点修复」（极端情况再按一次=聚焦，不盲建）。
      setQuickCreateSignal((n) => n + 1);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
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

  // ---- launch 路由（Tauri）：AppReady → intent → 单窗口策略 ----
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const handleAction = (action: WindowAction) => {
      void (async () => {
        if (action.type === "open-in-window" || action.type === "open-new-window") {
          // pending-save gate（MRT-001A）：launch open 同样 fail closed
          if (session.hasPendingSaves) {
            setNotice({ tone: "info", text: SAVE_BUSY_NOTICE });
            return;
          }
          if (session.isDirty) {
            const ok = await confirmDiscard(
              "当前文档有未保存修改，打开启动文件将丢弃这些修改。继续吗？",
            );
            if (!ok) return;
          }
          const result = await openPathFlow(session, deps, action.canonicalPath);
          if (isSaveInProgress(result)) {
            setNotice({ tone: "info", text: SAVE_BUSY_NOTICE });
            return;
          }
          if (result.kind !== "ok")
            setNotice({
              tone: "error",
              text: result.kind === "error" ? result.message : "启动文件无法读取",
            });
          bump();
          if (result.kind === "ok") setFitViewSignal((n) => n + 1);
        } else if (action.type === "new-blank-window") {
          void onNew();
        }
        // focus-existing / none：无需动作
      })();
    };
    const adapter = new TauriLifecycleAdapter(
      () => [{ windowId: "main", occupiedPath: session.displayPath, dirty: session.isDirty }],
      handleAction,
    );
    void adapter.start().catch((e) => {
      // 错误详情必须可见（MM-090-D2 排查：吞错曾掩盖 launch 路由失败根因）
      setNotice({
        tone: "error",
        text: `启动路由初始化失败：${e instanceof Error ? e.message : String(e)}`,
      });
    });
    return () => {
      void adapter.stop();
    };
  }, [session]); // 依赖刻意只有 session（adapter 内部闭包读取最新 action 依赖的简化：单窗口策略下足够）

  const theme = session.current.document.document.theme;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        role="toolbar"
        aria-label="主工具条"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(127,127,127,0.35)",
          flex: "0 0 auto",
        }}
      >
        <button type="button" onClick={() => void onNew()} data-onboarding-anchor="app.new">
          新建
        </button>
        <button type="button" onClick={() => void onOpen()} data-onboarding-anchor="app.open">
          打开…
        </button>
        <button type="button" onClick={() => void onSave()} data-onboarding-anchor="app.save">
          保存
        </button>
        <button type="button" onClick={() => void onSaveAs()}>
          另存为…
        </button>
        <button
          type="button"
          onClick={onOrganize}
          data-onboarding-anchor="app.organize"
          title="整理为垂直树（⌘⇧L）"
        >
          整理
        </button>
        <button type="button" onClick={() => setExportPanel((v) => !v)} aria-expanded={exportPanel}>
          导出
        </button>
        <ThemeToggle
          currentTheme={theme}
          onCommand={(cmd) => {
            session.commit(cmd);
            bump();
          }}
        />
        <button type="button" onClick={() => setReplaySignal((n) => n + 1)}>
          重放引导
        </button>
        <button type="button" onClick={() => void openShortcutPanel()} title="全局唤起热键设置">
          热键…
        </button>
        <span aria-live="polite" style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>
          {`${session.isDirty ? "未保存" : "已保存"} · ${ports.isBrowserDev ? "浏览器 dev（fake 端口）" : "桌面"}`}
        </span>
      </header>

      {notice ? (
        <div
          role="status"
          data-testid="app-notice"
          style={{
            padding: "6px 10px",
            background: notice.tone === "error" ? "#b62324" : "#1f6feb",
            color: "#fff",
            fontSize: 13,
          }}
        >
          {notice.text}
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
            style={{ marginLeft: 8 }}
          >
            ×
          </button>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <EditorCanvas
          session={session}
          fonts={ports.fonts}
          revision={revision}
          quickCreateSignal={quickCreateSignal}
          fitViewSignal={fitViewSignal}
          positionTransitionMs={320}
        />
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
              border: "1px solid rgba(127,127,127,0.5)",
              background: theme === "dark" ? "#0d1117" : "#fff",
              color: theme === "dark" ? "#e6edf3" : "#1f2328",
              borderRadius: 8,
              display: "grid",
              gap: 8,
            }}
          >
            <strong>导出当前脑图</strong>
            {(["svg", "png", "pdf"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => void onExport(f)}
                data-testid={`export-${f}`}
              >
                {f.toUpperCase()}
              </button>
            ))}
            <button type="button" onClick={() => setExportPanel(false)}>
              取消
            </button>
          </div>
        ) : null}
      </div>

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

      <OnboardingFlow
        observeCommands={observeCommands}
        preferences={onboardingPreferences}
        theme={theme}
        replaySignal={replaySignal}
      />
    </div>
  );
}
