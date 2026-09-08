// PRR-067 renderer 早期分段（纯本地，零 IPC）。
//
// 本模块必须保持在 entry（main.tsx）import 列表第一位：模块体执行即
// 采样 renderer monotonic 时刻（相对 navigationStart），先于 React 与
// 应用模块图初始化。window load 事件补 page-load-complete 时刻。
// 不上报、不打印；perf 会话建立后由 perf-probe 随 renderer-ready 一次性
// 交给 host。普通生产启动只多两次内存赋值与一次一次性事件监听，
// 无输出、无 IPC、无渲染差异。
//
// 诚实边界：jsStartedSinceNavigationMs 是"本模块 init"时刻，比 bundle
// 真正第一行晚若干模块初始化（数量级：微秒~毫秒）；跨进程不可与 host
// monotonic 相减，只作为 renderer origin 内的分段。

export interface RendererEarlyTiming {
  jsStartedSinceNavigationMs: number;
  loadEventSinceNavigationMs: number | null;
}

const earlyTiming: RendererEarlyTiming = {
  jsStartedSinceNavigationMs: performance.now(),
  loadEventSinceNavigationMs: null,
};

if (document.readyState === "complete") {
  earlyTiming.loadEventSinceNavigationMs = performance.now();
} else {
  window.addEventListener(
    "load",
    () => {
      earlyTiming.loadEventSinceNavigationMs = performance.now();
    },
    { once: true },
  );
}

/** 收集 renderer 早期分段（perf 会话内由 runPerfProbe 使用）。 */
export function collectPerfEarlyTiming(): RendererEarlyTiming {
  return { ...earlyTiming };
}
