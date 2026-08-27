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
import { TauriLifecycleAdapter, type WindowAction } from "@mindmap/platform";
import { ObservedDocumentSession, type ObservationSink } from "./observed-session.js";
import type { AppPorts } from "./ports.js";
import { isTauriRuntime } from "./ports.js";
import {
  newDocumentFlow,
  openDocumentFlow,
  openPathFlow,
  saveAsFlow,
  saveFlow,
} from "./file-commands.js";
import { exportFlow, type ExportFormat } from "./export-commands.js";
import { normalizeShortcut } from "./keyboard.js";

type Notice = { tone: "info" | "error"; text: string } | null;
type PendingConfirm = {
  message: string;
  onConfirm: () => void;
} | null;

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
  const [replaySignal, setReplaySignal] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirm>(null);
  const [exportPanel, setExportPanel] = useState(false);
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

  const handleResultNotice = useCallback((result: { kind: string; message?: string; code?: string }, okText?: string) => {
    if (result.kind === "ok" && okText) setNotice({ tone: "info", text: okText });
    else if (result.kind === "conflict" || result.kind === "error")
      setNotice({ tone: "error", text: result.message ?? result.code ?? "操作失败" });
  }, []);

  const onNew = useCallback(async () => {
    if (session.isDirty) {
      const ok = await confirmDiscard("当前文档有未保存修改，确定丢弃并新建吗？");
      if (!ok) return;
    }
    await newDocumentFlow(session, async () => true);
    bump();
    setNotice({ tone: "info", text: "已新建空白文档" });
  }, [bump, confirmDiscard, session]);

  const onOpen = useCallback(async () => {
    if (session.isDirty) {
      const ok = await confirmDiscard("当前文档有未保存修改，打开其他文件将丢弃这些修改。继续吗？");
      if (!ok) return;
    }
    const result = await openDocumentFlow(session, deps);
    handleResultNotice(result, result.kind === "ok" ? `已打开 ${result.value?.displayPath ?? ""}` : undefined);
    bump();
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

  const onExport = useCallback(
    async (format: ExportFormat) => {
      const result = await exportFlow(session, { filePort: ports.filePort, renderer: ports.renderer }, format);
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

  // 一键整理（MM-085）：纯函数布局 → 单条 MoveNodes（可 undo、进历史）。
  // bump 驱动画布重投影（外部 revision 信号——session.commit 不经画布内部通道）。
  const onOrganize = useCallback(() => {
    const cmd = organizeCommand(session.current.document);
    if (cmd) {
      session.commit(cmd);
      bump();
    }
    setNotice(cmd ? { tone: "info", text: "已整理为垂直树（⌘Z 可撤销）" } : { tone: "info", text: "已经是整理好的布局" });
  }, [bump, session]);

  // ---- 全局快捷键（输入/IME 隔离见 keyboard.ts） ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const shortcut = normalizeShortcut(e);
      if (!shortcut) return;
      e.preventDefault();
      switch (shortcut.action) {
        case "new": void onNew(); break;
        case "open": void onOpen(); break;
        case "save": void onSave(); break;
        case "save-as": void onSaveAs(); break;
        case "export-panel": setExportPanel((v) => !v); break;
        case "replay-onboarding": setReplaySignal((n) => n + 1); break;
        case "organize": onOrganize(); break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNew, onOpen, onSave, onSaveAs, onOrganize]);

  // ---- dirty 关闭保护（浏览器语义；native 窗口拦截见 MM-080 回报缺口） ----
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [session]);

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
          if (session.isDirty) {
            const ok = await confirmDiscard("当前文档有未保存修改，打开启动文件将丢弃这些修改。继续吗？");
            if (!ok) return;
          }
          const result = await openPathFlow(session, deps, action.canonicalPath);
          if (result.kind !== "ok") setNotice({ tone: "error", text: result.kind === "error" ? result.message : "启动文件无法读取" });
          bump();
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
    void adapter.start().catch(() => {
      setNotice({ tone: "error", text: "启动路由初始化失败" });
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
        <button type="button" onClick={() => void onNew()} data-onboarding-anchor="app.new">新建</button>
        <button type="button" onClick={() => void onOpen()} data-onboarding-anchor="app.open">打开…</button>
        <button type="button" onClick={() => void onSave()} data-onboarding-anchor="app.save">保存</button>
        <button type="button" onClick={() => void onSaveAs()}>另存为…</button>
        <button type="button" onClick={onOrganize} data-onboarding-anchor="app.organize" title="整理为垂直树（⌘⇧L）">
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
        <button type="button" onClick={() => setReplaySignal((n) => n + 1)}>重放引导</button>
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
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)} style={{ marginLeft: 8 }}>
            ×
          </button>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <EditorCanvas
          session={session}
          fonts={ports.fonts}
          revision={revision}
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
              <button key={f} type="button" onClick={() => void onExport(f)} data-testid={`export-${f}`}>
                {f.toUpperCase()}
              </button>
            ))}
            <button type="button" onClick={() => setExportPanel(false)}>取消</button>
          </div>
        ) : null}
      </div>

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
          <div style={{ background: "#fff", color: "#1f2328", padding: 16, borderRadius: 8, maxWidth: 360 }}>
            <p>{confirmState.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={cancelDiscard} data-testid="confirm-cancel">取消</button>
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
