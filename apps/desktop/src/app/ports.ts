// 端口装配（MM-080 ①⑥⑦）：按运行环境选择 Tauri 或浏览器 fake。
// 浏览器 dev（vite dev server，无 Tauri WebView）使用 fake 端口；
// Tauri WebView 用 MM-060 适配器 + export renderer（字体/wasm 经 vite 资源加载）。

import type { CloseLifecyclePort, FilePort, PreferencesPort } from "@mindmap/platform";
import {
  PlatformError,
  TauriCloseLifecycleAdapter,
  TauriFileAdapter,
  TauriPreferencesAdapter,
} from "@mindmap/platform";
import { invoke } from "@tauri-apps/api/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";
import type { ExportRendererLike } from "./export-commands.js";
import {
  FakeCloseLifecyclePort,
  FakeExportRenderer,
  FakeFilePort,
  FakePreferencesPort,
} from "./fake-ports.js";

/** 全局热键读写（MM-088；accelerator 字符串，键位专项讨论后可改）。 */
export interface GlobalShortcutPort {
  get(): Promise<{ accelerator: string }>;
  set(accelerator: string): Promise<{ accelerator: string }>;
}

export interface AppPorts {
  filePort: FilePort;
  preferences: PreferencesPort;
  renderer: ExportRendererLike;
  /** EditorCanvas 的共享 layout 字体度量（与导出同源）。 */
  fonts: FontResolver;
  globalShortcut: GlobalShortcutPort;
  /** 原生关闭协议（MRT-003）：浏览器 dev 的 fake 不触发原生关闭。 */
  closeLifecycle: CloseLifecyclePort;
  /** 浏览器 dev 模式（无原生对话框/文件系统）。 */
  readonly isBrowserDev: boolean;
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
    const renderer = await createTauriExportRenderer();
    return {
      filePort: new TauriFileAdapter(),
      preferences: new TauriPreferencesAdapter(),
      renderer,
      fonts: renderer.fonts(),
      globalShortcut: new TauriGlobalShortcut(),
      closeLifecycle: new TauriCloseLifecycleAdapter(),
      isBrowserDev: false,
    };
  }
  return {
    filePort: new FakeFilePort(),
    preferences: new FakePreferencesPort(),
    renderer: new FakeExportRenderer(),
    fonts: DEV_FONTS,
    globalShortcut: new FakeGlobalShortcut(),
    closeLifecycle: new FakeCloseLifecyclePort(),
    isBrowserDev: true,
  };
}

// Tauri：字体与 resvg wasm 经 vite ?url 资源（构建拷入 dist）按需 fetch。
import notoRegularUrl from "../../../../assets/fonts/noto-sans-sc-regular.otf?url";
import notoBoldUrl from "../../../../assets/fonts/noto-sans-sc-bold.otf?url";
import lxgwUrl from "../../../../assets/fonts/lxgw-wenkai-regular.ttf?url";
import resvgWasmUrl from "@resvg/resvg-wasm/index_bg.wasm?url";

async function createTauriExportRenderer(): Promise<ExportRendererLike> {
  const [{ createExportRenderer }, resvgWasm] = await Promise.all([
    import("@mindmap/export"),
    fetch(resvgWasmUrl)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint8Array(b))
      .catch(() => undefined),
  ]);
  const fetchBytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const [notoRegular, notoBold, lxgw] = await Promise.all([
    fetchBytes(notoRegularUrl),
    fetchBytes(notoBoldUrl),
    fetchBytes(lxgwUrl),
  ]);
  const renderer = await createExportRenderer(
    resvgWasm === undefined
      ? { fonts: fontBundle(notoRegular, notoBold, lxgw) }
      : { fonts: fontBundle(notoRegular, notoBold, lxgw), resvgWasm },
  );
  return {
    buildScene: async (doc) => renderer.buildScene(doc as never) as never,
    renderSvg: (scene) => renderer.renderSvg(scene as never),
    renderPng: async (svg, scene) => {
      const r = await renderer.renderPng(svg as never, scene as never);
      if (!r.ok) throw new Error(`PNG 渲染失败：${JSON.stringify(r.error)}`);
      return r.bytes;
    },
    renderPdf: async (scene) => {
      const r = await renderer.renderPdf(scene as never);
      if (!r.ok) throw new Error(r.error.message);
      return r.bytes;
    },
    fonts: () => renderer.fontResolver(),
  };
}

function fontBundle(notoRegular: Uint8Array, notoBold: Uint8Array, lxgw: Uint8Array) {
  return {
    "noto-sans-sc-regular": notoRegular,
    "noto-sans-sc-bold": notoBold,
    "lxgw-wenkai-regular": lxgw,
  };
}
