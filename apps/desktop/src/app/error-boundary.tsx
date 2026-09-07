// 崩溃黑匣子（MM-090 后续）：此前全 app 无 error boundary——任何渲染异常
// 导致 React 整树卸载成白屏且零线索（用户实测「唤醒后一张白布，全无反应」）。
// 两道防线：
// ① AppErrorBoundary 捕获 React 渲染/生命周期错误；
// ② installGlobalErrorTrap 捕获边界外的同步/异步错误（事件回调、promise），
//    直接写 DOM——即使 React 根已卸载，错误信息仍留在屏幕上可读、可截图。
// 两处都 console.error 留底（Tauri dev 下进终端；WKWebView 可经 Safari 查看）。

import { Component, type ErrorInfo, type ReactNode } from "react";

function formatError(label: string, error: unknown, extra?: string): string {
  const msg =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : String(error);
  return `[${label}] ${msg}${extra ? `\n${extra}` : ""}`;
}

function paintFatal(text: string): void {
  let host = document.getElementById("fatal-error");
  if (!host) {
    host = document.createElement("pre");
    host.id = "fatal-error";
    host.setAttribute(
      "style",
      [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "margin:0",
        "padding:24px",
        "background:#ffffff",
        "color:#b00020",
        "font:13px/1.5 monospace",
        "white-space:pre-wrap",
        "overflow:auto",
      ].join(";"),
    );
    // 可关闭：错误已留 console，遮挡层不应把后续交互也堵死
    const dismiss = document.createElement("button");
    dismiss.textContent = "关闭错误提示";
    dismiss.setAttribute(
      "style",
      "position:fixed;top:8px;right:8px;z-index:2147483647;padding:6px 10px;",
    );
    dismiss.onclick = () => {
      host?.remove();
      dismiss.remove();
    };
    document.body.appendChild(dismiss);
    document.body.appendChild(host);
  }
  host.textContent = text;
}

/** 全局兜底：渲染到独立 DOM 节点，不依赖 React 存活。 */
export function installGlobalErrorTrap(): void {
  window.onerror = (message, source, lineno, colno, error) => {
    const text = formatError(
      "window.onerror",
      error ?? message,
      `at ${source ?? "?"}:${lineno ?? "?"}:${colno ?? "?"}`,
    );
    console.error(text);
    paintFatal(text);
  };
  window.onunhandledrejection = (event) => {
    const text = formatError("unhandledrejection", event.reason);
    console.error(text);
    paintFatal(text);
  };
}

interface BoundaryState {
  fatal: string | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { fatal: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { fatal: formatError("render", error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const text = formatError("render", error, info.componentStack ?? "");
    console.error(text);
    paintFatal(text); // 双写：React 卸载后全局层仍可继续覆盖后续错误
  }

  override render(): ReactNode {
    if (this.state.fatal !== null) {
      return (
        <main style={{ padding: 24, fontFamily: "monospace", color: "#b00020" }}>
          <h1>应用发生错误（请整屏截图反馈）</h1>
          <pre style={{ whiteSpace: "pre-wrap" }}>{this.state.fatal}</pre>
        </main>
      );
    }
    return this.props.children;
  }
}
