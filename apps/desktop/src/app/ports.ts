// 端口装配（MM-080 ①⑥⑦）：按运行环境选择 Tauri 或浏览器 fake。
// 浏览器 dev（vite dev server，无 Tauri WebView）使用 fake 端口；
// Tauri WebView 用 MM-060 适配器 + export renderer（字体/wasm 经 vite 资源加载）。

import type {
  CloseLifecyclePort,
  FilePort,
  LaunchRetryableError,
  PendingRecovery,
  PreferencesPort,
} from "@mindmap/platform";
import {
  PlatformError,
  TauriCloseLifecycleAdapter,
  TauriFileAdapter,
  TauriPreferencesAdapter,
  toPlatformError,
} from "@mindmap/platform";
import { invoke } from "@tauri-apps/api/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";
import type { ExportRenderer as NativeExportRenderer } from "@mindmap/export";
import type { ExportRendererLike } from "./export-commands.js";

/** 全局热键读写（MM-088；accelerator 字符串，键位专项讨论后可改）。 */
export interface GlobalShortcutPort {
  get(): Promise<{ accelerator: string }>;
  set(accelerator: string): Promise<{ accelerator: string }>;
}

/**
 * host launch 通道（MRT-004 Wave 2）：工具条"打开…/新建窗口"请求 host
 * 入队（不直接替换当前窗口 session），以及 retry/dismiss/recovery 的
 * 显式动作。浏览器 dev 无此通道（fake 返回无操作）。
 */
export interface LaunchPort {
  /** 原生 open 对话框由 host 打开；选中文件由 host 解析 identity 入队。 */
  requestOpenIntent(): Promise<void>;
  /** 入队 activation：新建一个空白窗口。 */
  requestBlankWindow(): Promise<void>;
  /** host 可查询 retryable launch 错误快照。 */
  launchErrors(): Promise<LaunchRetryableError[]>;
  retryLaunchIntent(intentId: string): Promise<void>;
  dismissLaunchIntent(intentId: string): Promise<void>;
  /** 本窗口 pending post-commit recovery 的可见投影。 */
  pendingRecovery(): Promise<PendingRecovery | null>;
  resolvePendingRecovery(): Promise<void>;
}

export type FontMetricsState = "pending" | "ready" | "failed";

export interface AppPorts {
  filePort: FilePort;
  preferences: PreferencesPort;
  renderer: ExportRendererLike;
  /** EditorCanvas 的共享 layout 字体度量（与导出同源）。 */
  fonts: FontResolver;
  globalShortcut: GlobalShortcutPort;
  /** 原生关闭协议（MRT-003）：浏览器 dev 的 fake 不触发原生关闭。 */
  closeLifecycle: CloseLifecyclePort;
  /** host launch 通道（MRT-004 Wave 2；浏览器 dev 为 fake）。 */
  launch: LaunchPort;
  /** 浏览器 dev 模式（无原生对话框/文件系统）。 */
  readonly isBrowserDev: boolean;
  /** 字体度量就绪状态（PRC-025）。 */
  fontMetricsState?(): FontMetricsState;
  /** 等待真实字体度量就绪（PRC-025）。 */
  whenMetricsReady?(): Promise<FontResolver>;
}

/** Tauri 全局热键 port（invoke IPC）。 */
class TauriGlobalShortcut implements GlobalShortcutPort {
  async get() {
    return invoke<{ accelerator: string }>("platform_get_global_shortcut");
  }
  async set(accelerator: string) {
    return invoke<{ accelerator: string }>("platform_set_global_shortcut", { accelerator });
  }
}

/** Tauri launch port（MRT-004 Wave 2 §5C3/§5D2；W2R-F1 caller 隐式注入）。
 * W2R H1：全部 invoke reject 统一映射为 PlatformError（同 TauriFileAdapter
 * 的 call 约定）——retry/dismiss/recovery/report 的失败 UI 不得退化为
 * "[object Object]"。 */
export class TauriLaunchPort implements LaunchPort {
  private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return (await invoke<T>(command, args)) as T;
    } catch (raw) {
      throw toPlatformError(raw);
    }
  }

  async requestOpenIntent() {
    await this.call("platform_request_open_intent");
  }
  async requestBlankWindow() {
    await this.call("platform_request_blank_window");
  }
  async launchErrors() {
    return this.call<LaunchRetryableError[]>("platform_launch_errors");
  }
  async retryLaunchIntent(intentId: string) {
    await this.call("platform_retry_launch_intent", { intentId });
  }
  async dismissLaunchIntent(intentId: string) {
    await this.call("platform_dismiss_launch_intent", { intentId });
  }
  async pendingRecovery() {
    return this.call<PendingRecovery | null>("platform_pending_recovery");
  }
  async resolvePendingRecovery() {
    await this.call("platform_resolve_pending_recovery");
  }
}

/** 浏览器 dev 的内存实现（不真实注册）。 */
export class FakeGlobalShortcut implements GlobalShortcutPort {
  accelerator = "Alt+Space";
  conflictWith: string | null = null; // 测试模拟冲突
  async get() {
    return { accelerator: this.accelerator };
  }
  async set(accelerator: string) {
    if (this.conflictWith !== null && accelerator === this.conflictWith)
      throw new PlatformError(
        "GLOBAL_SHORTCUT_CONFLICT",
        `热键 ${accelerator} 注册失败（可能被其他应用占用）`,
      );
    this.accelerator = accelerator;
    return { accelerator };
  }
}

/** 浏览器 dev 的假字体度量（CJK≈1em、ASCII≈0.55em 近似；与导出尺寸可能略偏，仅限 dev 预览）。 */
const DEV_FONTS: FontResolver = {
  regular: () => ({
    advance: (ch: string, size: number) => size * (ch.charCodeAt(0) > 0xff ? 1 : 0.55),
    ascentRatio: 0.8,
  }),
  bold: () => ({
    advance: (ch: string, size: number) => size * (ch.charCodeAt(0) > 0xff ? 1 : 0.55),
    ascentRatio: 0.8,
  }),
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createAppPorts(): Promise<AppPorts> {
  if (isTauriRuntime()) {
    // 不在启动关键路径等待动态导出 chunk、三份字体或 resvg WASM；
    // renderer 会在首帧之后由 MindMapApp warmup，导出动作也会按需兜底加载。
    const renderer = createTauriExportRenderer();
    return {
      filePort: new TauriFileAdapter(),
      preferences: new TauriPreferencesAdapter(),
      renderer,
      fonts: renderer.fonts(),
      globalShortcut: new TauriGlobalShortcut(),
      closeLifecycle: new TauriCloseLifecycleAdapter(),
      launch: new TauriLaunchPort(),
      isBrowserDev: false,
      fontMetricsState: () => renderer.fontMetricsState?.() ?? "pending",
      whenMetricsReady: () => renderer.whenMetricsReady?.() ?? Promise.resolve(renderer.fonts()),
    };
  }
  const {
    FakeCloseLifecyclePort,
    FakeExportRenderer,
    FakeFilePort,
    FakeLaunchPort,
    FakePreferencesPort,
  } = await import("./fake-ports.js");
  const renderer = new FakeExportRenderer();
  return {
    filePort: new FakeFilePort(),
    preferences: new FakePreferencesPort(),
    renderer,
    fonts: renderer.fonts(),
    globalShortcut: new FakeGlobalShortcut(),
    closeLifecycle: new FakeCloseLifecyclePort(),
    launch: new FakeLaunchPort(),
    isBrowserDev: true,
    fontMetricsState: () => renderer.fontMetricsState?.() ?? "ready",
    whenMetricsReady: () => renderer.whenMetricsReady?.() ?? Promise.resolve(renderer.fonts()),
  };
}

// Tauri：字体与 resvg wasm 经 vite ?url 资源（构建拷入 dist）按需 fetch。
import notoRegularUrl from "../../../../assets/fonts/noto-sans-sc-regular.otf?url";
import notoBoldUrl from "../../../../assets/fonts/noto-sans-sc-bold.otf?url";
import lxgwUrl from "../../../../assets/fonts/lxgw-wenkai-regular.ttf?url";
import resvgWasmUrl from "@resvg/resvg-wasm/index_bg.wasm?url";

function createTauriExportRenderer(): ExportRendererLike {
  return new LazyTauriExportRenderer();
}

/**
 * Tauri 导出资源的延迟 owner：实例本身在启动时只创建 fallback font proxy，
 * 动态 JS、字体和 WASM 只在首帧后 warmup 或第一次导出时进入加载路径。
 */
class LazyTauriExportRenderer implements ExportRendererLike {
  private renderer: NativeExportRenderer | null = null;
  private loading: Promise<NativeExportRenderer> | null = null;
  private resolvedFonts: FontResolver = DEV_FONTS;
  private metricsState: FontMetricsState = "pending";
  private readonly metricsReadyPromise: Promise<FontResolver>;
  private resolveMetricsReady!: (fonts: FontResolver) => void;
  private rejectMetricsReady!: (error: unknown) => void;
  private readonly fontProxy: FontResolver = {
    regular: (fontId) => this.resolvedFonts.regular(fontId),
    bold: (fontId) => this.resolvedFonts.bold(fontId),
  };

  constructor() {
    this.metricsReadyPromise = new Promise<FontResolver>((resolve, reject) => {
      this.resolveMetricsReady = resolve;
      this.rejectMetricsReady = reject;
    });
  }

  fontMetricsState(): FontMetricsState {
    return this.metricsState;
  }

  whenMetricsReady(): Promise<FontResolver> {
    if (this.metricsState === "ready") return Promise.resolve(this.resolvedFonts);
    if (this.metricsState === "failed") return Promise.reject(new Error("字体资源加载失败"));
    return this.metricsReadyPromise;
  }

  private load(): Promise<NativeExportRenderer> {
    if (this.renderer) return Promise.resolve(this.renderer);
    if (this.loading) return this.loading;
    this.loading = this.loadResources()
      .then((renderer) => {
        this.renderer = renderer;
        this.resolvedFonts = renderer.fontResolver();
        this.metricsState = "ready";
        this.resolveMetricsReady(this.resolvedFonts);
        return renderer;
      })
      .catch((error) => {
        this.loading = null;
        this.metricsState = "failed";
        this.rejectMetricsReady(error);
        throw error;
      });
    return this.loading;
  }

  private async loadResources(): Promise<NativeExportRenderer> {
    const [{ createExportRenderer }, resvgWasm] = await Promise.all([
      import("@mindmap/export"),
      fetch(resvgWasmUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`resvg WASM 加载失败：HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((bytes) => new Uint8Array(bytes))
        .catch(() => undefined),
    ]);
    const fetchBytes = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`字体资源加载失败：HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    };
    const [notoRegular, notoBold, lxgw] = await Promise.all([
      fetchBytes(notoRegularUrl),
      fetchBytes(notoBoldUrl),
      fetchBytes(lxgwUrl),
    ]);
    return createExportRenderer(
      resvgWasm === undefined
        ? { fonts: fontBundle(notoRegular, notoBold, lxgw) }
        : { fonts: fontBundle(notoRegular, notoBold, lxgw), resvgWasm },
    );
  }

  warmup(): void {
    void this.load().catch(() => {
      // 首帧之后的预热失败不阻塞编辑；导出调用会再次尝试并返回可读错误。
    });
  }

  whenReady(): Promise<void> {
    return this.load().then(() => undefined);
  }

  async buildScene(doc: unknown) {
    return (await this.load()).buildScene(doc as never) as never;
  }

  renderSvg(scene: unknown) {
    return this.load().then((renderer) => renderer.renderSvg(scene as never));
  }

  async renderPng(svg: Uint8Array, scene: unknown) {
    const result = await (await this.load()).renderPng(svg, scene as never);
    if (!result.ok) throw new Error(`PNG 渲染失败：${JSON.stringify(result.error)}`);
    return result.bytes;
  }

  async renderPdf(scene: unknown) {
    const result = await (await this.load()).renderPdf(scene as never);
    if (!result.ok) throw new Error(result.error.message);
    return result.bytes;
  }

  fonts(): FontResolver {
    return this.fontProxy;
  }
}

function fontBundle(notoRegular: Uint8Array, notoBold: Uint8Array, lxgw: Uint8Array) {
  return {
    "noto-sans-sc-regular": notoRegular,
    "noto-sans-sc-bold": notoBold,
    "lxgw-wenkai-regular": lxgw,
  };
}
